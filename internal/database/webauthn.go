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
	webAuthnUsername    = "user"
	webAuthnDisplayName = "Media Viewer User"
)

// WebAuthnCredential represents a WebAuthn credential record stored in the database.
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

// WebAuthnUser wraps a User and their WebAuthn credentials for authentication.
type WebAuthnUser struct {
	user        *User
	credentials []webauthn.Credential
}

// WebAuthnID returns the user's WebAuthn ID.
func (u *WebAuthnUser) WebAuthnID() []byte { return []byte(fmt.Sprintf("%d", u.user.ID)) }

// WebAuthnName returns the user's WebAuthn name.
func (u *WebAuthnUser) WebAuthnName() string { return webAuthnUsername }

// WebAuthnDisplayName returns the user's WebAuthn display name.
func (u *WebAuthnUser) WebAuthnDisplayName() string { return webAuthnDisplayName }

// WebAuthnCredentials returns the user's WebAuthn credentials.
func (u *WebAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

// WebAuthnIcon returns the user's WebAuthn icon (empty).
func (u *WebAuthnUser) WebAuthnIcon() string { return "" }

// GetUser returns the underlying User struct.
func (u *WebAuthnUser) GetUser() *User { return u.user }

// InitWebAuthnSchema initializes the WebAuthn database schema.
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

	_, err := d.writer.ExecContext(ctx, schema)
	if err != nil {
		logging.Error("Failed to initialize WebAuthn schema: %v", err)
		return err
	}

	logging.Debug("WebAuthn schema initialized successfully")
	return nil
}

// SaveWebAuthnCredential saves a new WebAuthn credential for a user.
func (d *Database) SaveWebAuthnCredential(ctx context.Context, userID int64, cred *webauthn.Credential, name string) error {
	done := observeQuery("save_webauthn_credential")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var transportsJSON []byte
	var err error
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

	_, err = d.writer.ExecContext(ctx, `
		INSERT INTO webauthn_credentials
		(user_id, credential_id, public_key, attestation_type, aaguid, sign_count, name, transports)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		userID, cred.ID, cred.PublicKey, cred.AttestationType,
		cred.Authenticator.AAGUID, cred.Authenticator.SignCount,
		name, string(transportsJSON),
	)

	if err != nil {
		logging.Error("Failed to save WebAuthn credential: %v", err)
		done(err)
		return fmt.Errorf("failed to save credential: %w", err)
	}

	logging.Info("Saved new WebAuthn credential for user %d: %s", userID, name)
	done(nil)
	return nil
}

// GetWebAuthnCredentials returns all WebAuthn credentials for a user.
func (d *Database) GetWebAuthnCredentials(ctx context.Context, userID int64) ([]webauthn.Credential, error) {
	done := observeQuery("get_webauthn_credentials")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.reader.QueryContext(ctx, `
		SELECT credential_id, public_key, attestation_type, aaguid, sign_count, transports
		FROM webauthn_credentials
		WHERE user_id = ?
	`, userID)
	if err != nil {
		logging.Error("Failed to query WebAuthn credentials: %v", err)
		done(err)
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

		err := rows.Scan(&cred.ID, &cred.PublicKey, &cred.AttestationType,
			&aaguid, &cred.Authenticator.SignCount, &transportsJSON)
		if err != nil {
			logging.Warn("Failed to scan credential row: %v", err)
			continue
		}

		cred.Authenticator.AAGUID = aaguid
		cred.Authenticator.CloneWarning = false

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
		done(err)
		return nil, err
	}

	done(nil)
	return credentials, nil
}

// GetWebAuthnUser returns the WebAuthnUser for authentication.
func (d *Database) GetWebAuthnUser(ctx context.Context) (*WebAuthnUser, error) {
	done := observeQuery("get_webauthn_user")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var user User
	var createdAt, updatedAt int64
	err := d.reader.QueryRowContext(ctx,
		"SELECT id, created_at, updated_at FROM users LIMIT 1",
	).Scan(&user.ID, &createdAt, &updatedAt)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			done(err)
			return nil, fmt.Errorf("no user found")
		}
		logging.Error("Failed to get user for WebAuthn: %v", err)
		done(err)
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	user.CreatedAt = time.Unix(createdAt, 0)
	user.UpdatedAt = time.Unix(updatedAt, 0)

	credentials, err := d.GetWebAuthnCredentials(ctx, user.ID)
	if err != nil {
		logging.Warn("Failed to get credentials for user: %v", err)
		credentials = []webauthn.Credential{}
	}

	done(nil)
	return &WebAuthnUser{
		user:        &user,
		credentials: credentials,
	}, nil
}

// UpdateCredentialSignCount updates the sign count for a WebAuthn credential.
func (d *Database) UpdateCredentialSignCount(ctx context.Context, credentialID []byte, signCount uint32) error {
	done := observeQuery("update_credential_sign_count")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.writer.ExecContext(ctx, `
		UPDATE webauthn_credentials
		SET sign_count = ?, last_used_at = strftime('%s', 'now')
		WHERE credential_id = ?
	`, signCount, credentialID)

	if err != nil {
		logging.Warn("Failed to update credential sign count: %v", err)
	}

	done(err)
	return err
}

// DeleteWebAuthnCredential deletes a WebAuthn credential for a user.
func (d *Database) DeleteWebAuthnCredential(ctx context.Context, userID, credentialID int64) error {
	done := observeQuery("delete_webauthn_credential")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	result, err := d.writer.ExecContext(ctx, `
		DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?
	`, credentialID, userID)
	if err != nil {
		logging.Error("Failed to delete WebAuthn credential: %v", err)
		done(err)
		return fmt.Errorf("failed to delete credential: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		err = fmt.Errorf("credential not found")
		done(err)
		return err
	}

	logging.Info("Deleted WebAuthn credential ID %d for user %d", credentialID, userID)
	done(nil)
	return nil
}

// ListWebAuthnCredentials returns all WebAuthnCredential records for a user.
func (d *Database) ListWebAuthnCredentials(ctx context.Context, userID int64) ([]WebAuthnCredential, error) {
	done := observeQuery("list_webauthn_credentials")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.reader.QueryContext(ctx, `
		SELECT id, user_id, credential_id, name, sign_count, created_at, last_used_at
		FROM webauthn_credentials
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		logging.Error("Failed to list WebAuthn credentials: %v", err)
		done(err)
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

		err := rows.Scan(&cred.ID, &cred.UserID, &cred.CredentialID,
			&cred.Name, &cred.SignCount, &createdAt, &lastUsedAt)
		if err != nil {
			logging.Warn("Failed to scan credential metadata: %v", err)
			continue
		}

		cred.CreatedAt = time.Unix(createdAt, 0)
		cred.LastUsedAt = time.Unix(lastUsedAt, 0)
		credentials = append(credentials, cred)
	}

	rowsErr := rows.Err()
	done(rowsErr)
	return credentials, rowsErr
}

// SaveWebAuthnSession saves a WebAuthn session with a TTL.
func (d *Database) SaveWebAuthnSession(ctx context.Context, sessionID string, data []byte, ttl time.Duration) error {
	done := observeQuery("save_webauthn_session")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	expiresAt := time.Now().Add(ttl)

	_, err := d.writer.ExecContext(ctx, `
		INSERT OR REPLACE INTO webauthn_sessions (session_id, session_data, expires_at)
		VALUES (?, ?, ?)
	`, sessionID, data, expiresAt.Unix())

	if err != nil {
		logging.Error("Failed to save WebAuthn session: %v", err)
	}

	done(err)
	return err
}

// GetWebAuthnSession retrieves and deletes a WebAuthn session by ID.
func (d *Database) GetWebAuthnSession(ctx context.Context, sessionID string) ([]byte, error) {
	done := observeQuery("get_webauthn_session")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var data []byte
	var expiresAt int64

	err = tx.QueryRowContext(ctx, `
		SELECT session_data, expires_at FROM webauthn_sessions WHERE session_id = ?
	`, sessionID).Scan(&data, &expiresAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			err = fmt.Errorf("session not found")
			done(err)
			return nil, err
		}
		logging.Error("Failed to get WebAuthn session: %v", err)
		done(err)
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	_, delErr := tx.ExecContext(ctx, "DELETE FROM webauthn_sessions WHERE session_id = ?", sessionID)
	if delErr != nil {
		logging.Warn("Failed to delete WebAuthn session after retrieval: %v", delErr)
	}

	if commitErr := tx.Commit(); commitErr != nil {
		logging.Warn("Failed to commit WebAuthn session deletion: %v", commitErr)
	}

	if time.Now().Unix() > expiresAt {
		err = fmt.Errorf("session expired")
		done(err)
		return nil, err
	}

	done(nil)
	return data, nil
}

// CleanExpiredWebAuthnSessions removes expired WebAuthn sessions.
func (d *Database) CleanExpiredWebAuthnSessions(ctx context.Context) error {
	done := observeQuery("clean_expired_webauthn_sessions")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	result, err := d.writer.ExecContext(ctx, "DELETE FROM webauthn_sessions WHERE expires_at < ?", time.Now().Unix())
	if err != nil {
		logging.Error("Failed to clean expired WebAuthn sessions: %v", err)
		done(err)
		return err
	}

	if rows, _ := result.RowsAffected(); rows > 0 {
		logging.Debug("Cleaned %d expired WebAuthn sessions", rows)
	}

	done(nil)
	return nil
}

// HasWebAuthnCredentials checks if any WebAuthn credentials exist.
func (d *Database) HasWebAuthnCredentials(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	err := d.reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM webauthn_credentials").Scan(&count)
	if err != nil {
		logging.Debug("Failed to count WebAuthn credentials: %v", err)
		return false
	}
	return count > 0
}

// CountWebAuthnCredentials returns the total number of WebAuthn credentials.
func (d *Database) CountWebAuthnCredentials(ctx context.Context) int {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	err := d.reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM webauthn_credentials").Scan(&count)
	if err != nil {
		logging.Debug("Failed to count WebAuthn credentials: %v", err)
		return 0
	}
	return count
}
