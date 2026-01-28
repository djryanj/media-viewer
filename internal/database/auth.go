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

// User represents a user account in the system.
type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
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
func (d *Database) InitAuthTables() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);

	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		token TEXT NOT NULL UNIQUE,
		expires_at INTEGER NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
	CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
	`

	_, err := d.db.ExecContext(ctx, schema)
	return err
}

// HasUsers checks if any users exist.
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

// CreateUser creates a new user with hashed password.
func (d *Database) CreateUser(username, password string) error {
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
		"INSERT INTO users (username, password_hash) VALUES (?, ?)",
		username, string(hash),
	)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

// ValidateUser checks username and password, returns user if valid.
func (d *Database) ValidateUser(username, password string) (*User, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	var user User
	var createdAt, updatedAt int64

	err := d.db.QueryRowContext(ctx,
		"SELECT id, username, password_hash, created_at, updated_at FROM users WHERE username = ?",
		username,
	).Scan(&user.ID, &user.Username, &user.PasswordHash, &createdAt, &updatedAt)

	if err != nil {
		return nil, fmt.Errorf("invalid username or password")
	}

	// Check password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, fmt.Errorf("invalid username or password")
	}

	user.CreatedAt = time.Unix(createdAt, 0)
	user.UpdatedAt = time.Unix(updatedAt, 0)

	return &user, nil
}

// CreateSession creates a new session for a user.
func (d *Database) CreateSession(userID int64) (*Session, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	// Generate random token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
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
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	// Hash the token for lookup
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return nil, fmt.Errorf("invalid token format")
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
		return nil, fmt.Errorf("invalid session")
	}

	// Check expiration
	if time.Now().Unix() > expiresAt {
		// Clean up expired session in background - don't block validation
		go func() {
			if delErr := d.deleteSessionByHash(tokenHash); delErr != nil {
				logging.Error("failed to delete expired session: %v", delErr)
			}
		}()
		return nil, fmt.Errorf("session expired")
	}

	// Get user
	var user User
	var createdAtU, updatedAtU int64
	err = d.db.QueryRowContext(ctx,
		"SELECT id, username, created_at, updated_at FROM users WHERE id = ?",
		userID,
	).Scan(&user.ID, &user.Username, &createdAtU, &updatedAtU)

	if err != nil {
		return nil, fmt.Errorf("user not found")
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

// DeleteUserSessions removes all sessions for a user.
func (d *Database) DeleteUserSessions(userID int64) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ?", userID)
	return err
}

// CleanExpiredSessions removes all expired sessions.
func (d *Database) CleanExpiredSessions() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at < ?", time.Now().Unix())
	return err
}

// UpdatePassword updates a user's password.
func (d *Database) UpdatePassword(username, newPassword string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	result, err := d.db.ExecContext(ctx,
		"UPDATE users SET password_hash = ?, updated_at = strftime('%s', 'now') WHERE username = ?",
		string(hash), username,
	)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("user not found: %s", username)
	}

	// Invalidate all sessions for this user (best effort)
	// We intentionally ignore errors here since the password update already succeeded
	var userID int64
	if scanErr := d.db.QueryRowContext(ctx, "SELECT id FROM users WHERE username = ?", username).Scan(&userID); scanErr == nil {
		if _, delErr := d.db.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ?", userID); delErr != nil {
			logging.Warn("failed to invalidate sessions for user %s: %v", username, delErr)
		}
	} else {
		logging.Warn("failed to get user ID for session invalidation (user: %s): %v", username, scanErr)
	}

	return nil
}

// GetUserByUsername retrieves a user by username.
func (d *Database) GetUserByUsername(username string) (*User, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	var user User
	var createdAt, updatedAt int64

	err := d.db.QueryRowContext(ctx,
		"SELECT id, username, created_at, updated_at FROM users WHERE username = ?",
		username,
	).Scan(&user.ID, &user.Username, &createdAt, &updatedAt)

	if err != nil {
		return nil, fmt.Errorf("user not found")
	}

	user.CreatedAt = time.Unix(createdAt, 0)
	user.UpdatedAt = time.Unix(updatedAt, 0)

	return &user, nil
}

// DeleteUser removes a user and all associated sessions from the database.
func (d *Database) DeleteUser(username string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	// Start a transaction to ensure atomicity
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	committed := false
	defer func() {
		if !committed {
			if rbErr := tx.Rollback(); rbErr != nil {
				logging.Error("rollback failed: %v", rbErr)
			}
		}
	}()

	// Get user ID first
	var userID int64
	err = tx.QueryRowContext(ctx, "SELECT id FROM users WHERE username = ?", username).Scan(&userID)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	// Delete all sessions for this user
	_, err = tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ?", userID)
	if err != nil {
		return fmt.Errorf("failed to delete sessions: %w", err)
	}

	// Delete the user
	_, err = tx.ExecContext(ctx, "DELETE FROM users WHERE id = ?", userID)
	if err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}
