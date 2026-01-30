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

// SessionDuration is the length of time a session remains valid.
const SessionDuration = 7 * 24 * time.Hour // 7 days

// InitAuthTables creates the authentication tables.
// func (d *Database) InitAuthTables() error {
// 	d.mu.Lock()
// 	defer d.mu.Unlock()

// 	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
// 	defer cancel()

// 	schema := `
// 	CREATE TABLE IF NOT EXISTS users (
// 		id INTEGER PRIMARY KEY AUTOINCREMENT,
// 		password_hash TEXT NOT NULL,
// 		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
// 		updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
// 	);

// 	CREATE TABLE IF NOT EXISTS sessions (
// 		id INTEGER PRIMARY KEY AUTOINCREMENT,
// 		user_id INTEGER NOT NULL,
// 		token TEXT NOT NULL UNIQUE,
// 		expires_at INTEGER NOT NULL,
// 		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
// 		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
// 	);

// 	CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
// 	CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
// 	`

// 	_, err := d.db.ExecContext(ctx, schema)
// 	return err
// }

// HasUsers checks if a user exists (single-user app).
func (d *Database) HasUsers() bool {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	var count int
	err := d.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return false
	}
	return count > 0
}

// CreateUser creates the single user with the given password.
func (d *Database) CreateUser(password string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("create_user", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
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
func (d *Database) ValidatePassword(password string) (*User, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("validate_password", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
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
func (d *Database) CreateSession(userID int64) (*Session, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("create_session", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
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

	expiresAt := time.Now().Add(SessionDuration)

	result, err := d.db.ExecContext(ctx,
		"INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
		userID, tokenHash, expiresAt.Unix(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	id, _ := result.LastInsertId()

	return &Session{
		ID:        id,
		UserID:    userID,
		Token:     token, // Return unhashed token to client
		ExpiresAt: expiresAt,
		CreatedAt: time.Now(),
	}, nil
}

// ValidateSession checks if a session token is valid.
func (d *Database) ValidateSession(token string) (*User, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("validate_session", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
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
		// Clean up expired session in background - don't block validation
		go func() {
			if delErr := d.deleteSessionByHash(tokenHash); delErr != nil {
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

// deleteSessionByHash removes a session by its hashed token.
func (d *Database) deleteSessionByHash(tokenHash string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, "DELETE FROM sessions WHERE token = ?", tokenHash)
	return err
}

// DeleteSession removes a session.
func (d *Database) DeleteSession(token string) error {
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return fmt.Errorf("invalid token format: %w", err)
	}
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])

	return d.deleteSessionByHash(tokenHash)
}

// DeleteAllSessions removes all sessions (used when password is changed).
func (d *Database) DeleteAllSessions() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, "DELETE FROM sessions")
	return err
}

// CleanExpiredSessions removes all expired sessions.
func (d *Database) CleanExpiredSessions() error {
	start := time.Now()
	var err error
	defer func() { recordQuery("clean_expired_sessions", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	_, err = d.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at < ?", time.Now().Unix())
	return err
}

// UpdatePassword updates the user's password and invalidates all sessions.
func (d *Database) UpdatePassword(newPassword string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("update_password", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
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
