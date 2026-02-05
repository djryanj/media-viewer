package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"media-viewer/internal/logging"
)

const (
	// webAuthnUsername is the username for the single-user WebAuthn implementation
	webAuthnUsername = "user"
	// webAuthnDisplayName is the display name for the single-user WebAuthn implementation
	webAuthnDisplayName = "Media Viewer User"
)

// WebAuthnCredential represents a stored passkey credential
type WebAuthnCredential struct {
	ID              int64     `json:"id"`
	UserID          int64     `json:"userId"`
	CredentialID    []byte    `json:"credentialId"`
	PublicKey       []byte    `json:"publicKey"`
	AttestationType string    `json:"attestationType"`
	AAGUID          []byte    `json:"aaguid"`
	SignCount       uint32    `json:"signCount"`
	Name            string    `json:"name"`
	CreatedAt       time.Time `json:"createdAt"`
	LastUsedAt      time.Time `json:"lastUsedAt"`
}

// WebAuthnUser implements webauthn.User interface for our single-user app
type WebAuthnUser struct {
	user        *User
	credentials []webauthn.Credential
}

// WebAuthnID returns the user's ID as bytes
func (u *WebAuthnUser) WebAuthnID() []byte {
	return []byte(fmt.Sprintf("%d", u.user.ID))
}

// WebAuthnName returns a human-readable name
func (u *WebAuthnUser) WebAuthnName() string {
	return webAuthnUsername
}

// WebAuthnDisplayName returns the display name
func (u *WebAuthnUser) WebAuthnDisplayName() string {
	return webAuthnDisplayName
}

// WebAuthnCredentials returns all credentials for this user
func (u *WebAuthnUser) WebAuthnCredentials() []webauthn.Credential {
	return u.credentials
}

// WebAuthnIcon returns an icon URL (deprecated but required by interface)
func (u *WebAuthnUser) WebAuthnIcon() string {
	return ""
}

// GetUser returns the underlying User
func (u *WebAuthnUser) GetUser() *User {
	return u.user
}

// InitWebAuthnSchema adds the WebAuthn tables if they don't exist
func (d *Database) InitWebAuthnSchema() error {
	logging.Debug("Initializing WebAuthn database schema...")

	schema := `
	CREATE TABLE IF NOT EXISTS webauthn_credentials (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		credential_id BLOB NOT NULL UNIQUE,
		public_key BLOB NOT NULL,
		attestation_type TEXT NOT NULL,
		aaguid BLOB,
		sign_count INTEGER NOT NULL DEFAULT 0,
		name TEXT NOT NULL DEFAULT 'Passkey',
		transports TEXT,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		last_used_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
	CREATE INDEX IF NOT EXISTS idx_webauthn_credential_id ON webauthn_credentials(credential_id);

	CREATE TABLE IF NOT EXISTS webauthn_sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL UNIQUE,
		session_data BLOB NOT NULL,
		expires_at INTEGER NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);

	CREATE INDEX IF NOT EXISTS idx_webauthn_session_id ON webauthn_sessions(session_id);
	CREATE INDEX IF NOT EXISTS idx_webauthn_session_expires ON webauthn_sessions(expires_at);
	`

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := d.db.ExecContext(ctx, schema)
	if err != nil {
		logging.Error("Failed to initialize WebAuthn schema: %v", err)
		return err
	}

	logging.Debug("WebAuthn schema initialized successfully")
	return nil
}

// SaveWebAuthnCredential stores a new passkey credential
func (d *Database) SaveWebAuthnCredential(ctx context.Context, userID int64, cred *webauthn.Credential, name string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("save_webauthn_credential", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Serialize transports to JSON
	var transportsJSON []byte
	if len(cred.Transport) > 0 {
		transports := make([]string, len(cred.Transport))
		for i, t := range cred.Transport {
			transports[i] = string(t)
		}
		transportsJSON, err = json.Marshal(transports)
		if err != nil {
			logging.Warn("Failed to marshal transports: %v", err)
			transportsJSON = []byte("[]")
		}
	} else {
		transportsJSON = []byte("[]")
	}

	_, err = d.db.ExecContext(ctx, `
		INSERT INTO webauthn_credentials
		(user_id, credential_id, public_key, attestation_type, aaguid, sign_count, name, transports)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		userID,
		cred.ID,
		cred.PublicKey,
		cred.AttestationType,
		cred.Authenticator.AAGUID,
		cred.Authenticator.SignCount,
		name,
		string(transportsJSON),
	)

	if err != nil {
		logging.Error("Failed to save WebAuthn credential: %v", err)
		return fmt.Errorf("failed to save credential: %w", err)
	}

	logging.Info("Saved new WebAuthn credential for user %d: %s", userID, name)
	return nil
}

// GetWebAuthnCredentials returns all credentials for a user
func (d *Database) GetWebAuthnCredentials(ctx context.Context, userID int64) ([]webauthn.Credential, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("get_webauthn_credentials", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.db.QueryContext(ctx, `
		SELECT credential_id, public_key, attestation_type, aaguid, sign_count, transports
		FROM webauthn_credentials
		WHERE user_id = ?
	`, userID)
	if err != nil {
		logging.Error("Failed to query WebAuthn credentials: %v", err)
		return nil, fmt.Errorf("failed to query credentials: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			logging.Error("Error closing rows: %v", closeErr)
		}
	}()

	var credentials []webauthn.Credential
	for rows.Next() {
		var cred webauthn.Credential
		var aaguid []byte
		var transportsJSON sql.NullString

		err := rows.Scan(
			&cred.ID,
			&cred.PublicKey,
			&cred.AttestationType,
			&aaguid,
			&cred.Authenticator.SignCount,
			&transportsJSON,
		)
		if err != nil {
			logging.Warn("Failed to scan credential row: %v", err)
			continue
		}

		cred.Authenticator.AAGUID = aaguid
		cred.Authenticator.CloneWarning = false

		// Parse transports
		if transportsJSON.Valid && transportsJSON.String != "" {
			var transports []string
			if jsonErr := json.Unmarshal([]byte(transportsJSON.String), &transports); jsonErr == nil {
				for _, t := range transports {
					cred.Transport = append(cred.Transport, protocol.AuthenticatorTransport(t))
				}
			}
		}

		credentials = append(credentials, cred)
	}

	if err := rows.Err(); err != nil {
		logging.Error("Error iterating credential rows: %v", err)
		return nil, err
	}

	return credentials, nil
}

// GetWebAuthnUser returns a WebAuthnUser for the single user with all their credentials
func (d *Database) GetWebAuthnUser(ctx context.Context) (*WebAuthnUser, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("get_webauthn_user", start, err) }()

	d.mu.RLock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Get the single user
	var user User
	var createdAt, updatedAt int64
	err = d.db.QueryRowContext(ctx,
		"SELECT id, created_at, updated_at FROM users LIMIT 1",
	).Scan(&user.ID, &createdAt, &updatedAt)

	d.mu.RUnlock()

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("no user found")
		}
		logging.Error("Failed to get user for WebAuthn: %v", err)
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	user.CreatedAt = time.Unix(createdAt, 0)
	user.UpdatedAt = time.Unix(updatedAt, 0)

	// Get credentials (separate query to avoid lock issues)
	credentials, err := d.GetWebAuthnCredentials(ctx, user.ID)
	if err != nil {
		logging.Warn("Failed to get credentials for user: %v", err)
		credentials = []webauthn.Credential{}
	}

	return &WebAuthnUser{
		user:        &user,
		credentials: credentials,
	}, nil
}

// UpdateCredentialSignCount updates the sign count after successful authentication
func (d *Database) UpdateCredentialSignCount(ctx context.Context, credentialID []byte, signCount uint32) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("update_credential_sign_count", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err = d.db.ExecContext(ctx, `
		UPDATE webauthn_credentials
		SET sign_count = ?, last_used_at = strftime('%s', 'now')
		WHERE credential_id = ?
	`, signCount, credentialID)

	if err != nil {
		logging.Warn("Failed to update credential sign count: %v", err)
	}

	return err
}

// DeleteWebAuthnCredential removes a passkey
func (d *Database) DeleteWebAuthnCredential(ctx context.Context, userID, credentialID int64) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("delete_webauthn_credential", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	result, err := d.db.ExecContext(ctx, `
		DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?
	`, credentialID, userID)
	if err != nil {
		logging.Error("Failed to delete WebAuthn credential: %v", err)
		return fmt.Errorf("failed to delete credential: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("credential not found")
	}

	logging.Info("Deleted WebAuthn credential ID %d for user %d", credentialID, userID)
	return nil
}

// ListWebAuthnCredentials returns credential metadata for display
func (d *Database) ListWebAuthnCredentials(ctx context.Context, userID int64) ([]WebAuthnCredential, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("list_webauthn_credentials", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.db.QueryContext(ctx, `
		SELECT id, user_id, credential_id, name, sign_count, created_at, last_used_at
		FROM webauthn_credentials
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		logging.Error("Failed to list WebAuthn credentials: %v", err)
		return nil, fmt.Errorf("failed to query credentials: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			logging.Error("Error closing rows: %v", closeErr)
		}
	}()

	var credentials []WebAuthnCredential
	for rows.Next() {
		var cred WebAuthnCredential
		var createdAt, lastUsedAt int64

		err := rows.Scan(
			&cred.ID,
			&cred.UserID,
			&cred.CredentialID,
			&cred.Name,
			&cred.SignCount,
			&createdAt,
			&lastUsedAt,
		)
		if err != nil {
			logging.Warn("Failed to scan credential metadata: %v", err)
			continue
		}

		cred.CreatedAt = time.Unix(createdAt, 0)
		cred.LastUsedAt = time.Unix(lastUsedAt, 0)
		credentials = append(credentials, cred)
	}

	return credentials, rows.Err()
}

// SaveWebAuthnSession stores challenge data for WebAuthn ceremonies
func (d *Database) SaveWebAuthnSession(ctx context.Context, sessionID string, data []byte, ttl time.Duration) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("save_webauthn_session", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	expiresAt := time.Now().Add(ttl)

	_, err = d.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO webauthn_sessions (session_id, session_data, expires_at)
		VALUES (?, ?, ?)
	`, sessionID, data, expiresAt.Unix())

	if err != nil {
		logging.Error("Failed to save WebAuthn session: %v", err)
	}

	return err
}

// GetWebAuthnSession retrieves and deletes challenge data
func (d *Database) GetWebAuthnSession(ctx context.Context, sessionID string) ([]byte, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("get_webauthn_session", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var data []byte
	var expiresAt int64

	err = d.db.QueryRowContext(ctx, `
		SELECT session_data, expires_at FROM webauthn_sessions WHERE session_id = ?
	`, sessionID).Scan(&data, &expiresAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("session not found")
		}
		logging.Error("Failed to get WebAuthn session: %v", err)
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	// Delete the session (one-time use)
	_, delErr := d.db.ExecContext(ctx, "DELETE FROM webauthn_sessions WHERE session_id = ?", sessionID)
	if delErr != nil {
		logging.Warn("Failed to delete WebAuthn session after retrieval: %v", delErr)
	}

	// Check expiration
	if time.Now().Unix() > expiresAt {
		return nil, fmt.Errorf("session expired")
	}

	return data, nil
}

// CleanExpiredWebAuthnSessions removes expired challenge sessions
func (d *Database) CleanExpiredWebAuthnSessions(ctx context.Context) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("clean_expired_webauthn_sessions", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	result, err := d.db.ExecContext(ctx, "DELETE FROM webauthn_sessions WHERE expires_at < ?", time.Now().Unix())
	if err != nil {
		logging.Error("Failed to clean expired WebAuthn sessions: %v", err)
		return err
	}

	if rows, _ := result.RowsAffected(); rows > 0 {
		logging.Debug("Cleaned %d expired WebAuthn sessions", rows)
	}

	return nil
}

// HasWebAuthnCredentials checks if any passkeys are registered
func (d *Database) HasWebAuthnCredentials(ctx context.Context) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	err := d.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM webauthn_credentials").Scan(&count)
	if err != nil {
		logging.Debug("Failed to count WebAuthn credentials: %v", err)
		return false
	}
	return count > 0
}

// CountWebAuthnCredentials returns the number of registered passkeys
func (d *Database) CountWebAuthnCredentials(ctx context.Context) int {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	err := d.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM webauthn_credentials").Scan(&count)
	if err != nil {
		logging.Debug("Failed to count WebAuthn credentials: %v", err)
		return 0
	}
	return count
}
