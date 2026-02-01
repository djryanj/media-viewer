package database

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"

	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

// User represents the single user account in the system.
type User struct {
	ID           int64     `json:"id"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// Session represents an authenticated user session.
type Session struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"userId"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
}

// DefaultSessionDuration is the default session length if not configured.
const DefaultSessionDuration = 5 * time.Minute

// sessionDuration is the configured session duration (set via SetSessionDuration).
var sessionDuration = DefaultSessionDuration

// SetSessionDuration configures the session duration.
func SetSessionDuration(d time.Duration) {
	if d < 1*time.Minute {
		logging.Warn("Session duration too short (%v), using minimum of 1 minute", d)
		d = 1 * time.Minute
	}
	sessionDuration = d
	logging.Info("Session duration set to %v", sessionDuration)
}

// GetSessionDuration returns the current session duration.
func GetSessionDuration() time.Duration {
	return sessionDuration
}

// HasUsers checks if a user exists (single-user app).
func (d *Database) HasUsers(ctx context.Context) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	err := d.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return false
	}
	return count > 0
}

// CreateUser creates the single user with the given password.
func (d *Database) CreateUser(ctx context.Context, password string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("create_user", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Hash the password
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	_, err = d.db.ExecContext(ctx,
		"INSERT INTO users (password_hash) VALUES (?)",
		string(hash),
	)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

// ValidatePassword checks the password and returns the user if valid.
func (d *Database) ValidatePassword(ctx context.Context, password string) (*User, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("validate_password", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var user User
	var createdAt, updatedAt int64

	err = d.db.QueryRowContext(ctx,
		"SELECT id, password_hash, created_at, updated_at FROM users LIMIT 1",
	).Scan(&user.ID, &user.PasswordHash, &createdAt, &updatedAt)

	if err != nil {
		err = fmt.Errorf("invalid password")
		return nil, err
	}

	// Check password
	if err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		err = fmt.Errorf("invalid password")
		return nil, err
	}

	user.CreatedAt = time.Unix(createdAt, 0)
	user.UpdatedAt = time.Unix(updatedAt, 0)

	return &user, nil
}

// CreateSession creates a new session for a user.
func (d *Database) CreateSession(ctx context.Context, userID int64) (*Session, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("create_session", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Generate random token
	tokenBytes := make([]byte, 32)
	if _, err = rand.Read(tokenBytes); err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	// Hash the token for storage
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])
	token := hex.EncodeToString(tokenBytes)

	expiresAt := time.Now().Add(sessionDuration)

	result, err := d.db.ExecContext(ctx,
		"INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
		userID, tokenHash, expiresAt.Unix(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	id, _ := result.LastInsertId()

	//nolint:contextcheck // Metrics update uses background context for reliability
	d.updateActiveSessionsMetric()

	return &Session{
		ID:        id,
		UserID:    userID,
		Token:     token, // Return unhashed token to client
		ExpiresAt: expiresAt,
		CreatedAt: time.Now(),
	}, nil
}

// ValidateSession checks if a session token is valid.
func (d *Database) ValidateSession(ctx context.Context, token string) (*User, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("validate_session", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Hash the token for lookup
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		err = fmt.Errorf("invalid token format")
		return nil, err
	}
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])

	var userID int64
	var expiresAt int64

	err = d.db.QueryRowContext(ctx,
		"SELECT user_id, expires_at FROM sessions WHERE token = ?",
		tokenHash,
	).Scan(&userID, &expiresAt)

	if err != nil {
		err = fmt.Errorf("invalid session")
		return nil, err
	}

	// Check expiration
	if time.Now().Unix() > expiresAt {
		// Clean up expired session in background
		//nolint:contextcheck // Intentionally using background context for fire-and-forget cleanup
		go func() {
			bgCtx, bgCancel := context.WithTimeout(context.Background(), defaultTimeout)
			defer bgCancel()
			if delErr := d.deleteSessionByHash(bgCtx, tokenHash); delErr != nil {
				logging.Error("failed to delete expired session: %v", delErr)
			}
		}()
		err = fmt.Errorf("session expired")
		return nil, err
	}

	// Get user
	var user User
	var createdAtU, updatedAtU int64
	err = d.db.QueryRowContext(ctx,
		"SELECT id, created_at, updated_at FROM users WHERE id = ?",
		userID,
	).Scan(&user.ID, &createdAtU, &updatedAtU)

	if err != nil {
		err = fmt.Errorf("user not found")
		return nil, err
	}

	user.CreatedAt = time.Unix(createdAtU, 0)
	user.UpdatedAt = time.Unix(updatedAtU, 0)

	return &user, nil
}

// ExtendSession extends the expiration time of an existing session.
func (d *Database) ExtendSession(ctx context.Context, token string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("extend_session", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Hash the token for lookup
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return fmt.Errorf("invalid token format: %w", err)
	}
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])

	newExpiresAt := time.Now().Add(sessionDuration)

	result, err := d.db.ExecContext(ctx,
		"UPDATE sessions SET expires_at = ? WHERE token = ? AND expires_at > ?",
		newExpiresAt.Unix(), tokenHash, time.Now().Unix(),
	)
	if err != nil {
		return fmt.Errorf("failed to extend session: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("session not found or expired")
	}

	return nil
}

// deleteSessionByHash removes a session by its hashed token.
func (d *Database) deleteSessionByHash(ctx context.Context, tokenHash string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, "DELETE FROM sessions WHERE token = ?", tokenHash)
	return err
}

// DeleteSession removes a session.
func (d *Database) DeleteSession(ctx context.Context, token string) error {
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return fmt.Errorf("invalid token format: %w", err)
	}
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])

	err = d.deleteSessionByHash(ctx, tokenHash)
	if err == nil {
		//nolint:contextcheck // Metrics update uses background context for reliability
		d.updateActiveSessionsMetric()
	}
	return err
}

// DeleteAllSessions removes all sessions (used when password is changed).
func (d *Database) DeleteAllSessions(ctx context.Context) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, "DELETE FROM sessions")
	return err
}

// CleanExpiredSessions removes all expired sessions.
func (d *Database) CleanExpiredSessions(ctx context.Context) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("clean_expired_sessions", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	result, err := d.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at < ?", time.Now().Unix())
	if err == nil {
		if rows, _ := result.RowsAffected(); rows > 0 {
			logging.Debug("Cleaned %d expired sessions", rows)
		}
		//nolint:contextcheck // Metrics update uses background context for reliability
		d.updateActiveSessionsMetric()
	}
	return err
}

// UpdatePassword updates the user's password and invalidates all sessions.
func (d *Database) UpdatePassword(ctx context.Context, newPassword string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("update_password", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Update the single user's password
	result, err := d.db.ExecContext(ctx,
		"UPDATE users SET password_hash = ?, updated_at = strftime('%s', 'now')",
		string(hash),
	)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		err = fmt.Errorf("no user found")
		return err
	}

	// Invalidate all sessions
	if _, delErr := d.db.ExecContext(ctx, "DELETE FROM sessions"); delErr != nil {
		logging.Warn("failed to invalidate sessions: %v", delErr)
	}

	return nil
}

// updateActiveSessionsMetric updates the active sessions gauge.
func (d *Database) updateActiveSessionsMetric() {
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	var count int
	err := d.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sessions WHERE expires_at > ?",
		time.Now().Unix(),
	).Scan(&count)
	if err != nil {
		logging.Debug("Failed to count active sessions: %v", err)
		return
	}
	metrics.ActiveSessions.Set(float64(count))
}
