package database

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type Session struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"userId"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
}

const (
	SessionDuration = 7 * 24 * time.Hour // 7 days
)

// InitAuthTables creates the authentication tables
func (d *Database) InitAuthTables() error {
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

	_, err := d.db.Exec(schema)
	return err
}

// HasUsers checks if any users exist
func (d *Database) HasUsers() bool {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var count int
	d.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count > 0
}

// CreateUser creates a new user with hashed password
func (d *Database) CreateUser(username, password string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	// Hash the password
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	_, err = d.db.Exec(
		"INSERT INTO users (username, password_hash) VALUES (?, ?)",
		username, string(hash),
	)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

// ValidateUser checks username and password, returns user if valid
func (d *Database) ValidateUser(username, password string) (*User, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var user User
	var createdAt, updatedAt int64

	err := d.db.QueryRow(
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

// CreateSession creates a new session for a user
func (d *Database) CreateSession(userID int64) (*Session, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

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

	result, err := d.db.Exec(
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

// ValidateSession checks if a session token is valid
func (d *Database) ValidateSession(token string) (*User, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	// Hash the token for lookup
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return nil, fmt.Errorf("invalid token format")
	}
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])

	var userID int64
	var expiresAt int64

	err = d.db.QueryRow(
		"SELECT user_id, expires_at FROM sessions WHERE token = ?",
		tokenHash,
	).Scan(&userID, &expiresAt)

	if err != nil {
		return nil, fmt.Errorf("invalid session")
	}

	// Check expiration
	if time.Now().Unix() > expiresAt {
		// Clean up expired session
		go d.DeleteSession(token)
		return nil, fmt.Errorf("session expired")
	}

	// Get user
	var user User
	var createdAtU, updatedAtU int64
	err = d.db.QueryRow(
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

// DeleteSession removes a session
func (d *Database) DeleteSession(token string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return nil
	}
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])

	_, err = d.db.Exec("DELETE FROM sessions WHERE token = ?", tokenHash)
	return err
}

// DeleteUserSessions removes all sessions for a user
func (d *Database) DeleteUserSessions(userID int64) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM sessions WHERE user_id = ?", userID)
	return err
}

// CleanExpiredSessions removes all expired sessions
func (d *Database) CleanExpiredSessions() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM sessions WHERE expires_at < ?", time.Now().Unix())
	return err
}

// UpdatePassword updates a user's password
func (d *Database) UpdatePassword(username, newPassword string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	result, err := d.db.Exec(
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

	// Invalidate all sessions for this user
	var userID int64
	d.db.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&userID)
	if userID > 0 {
		d.db.Exec("DELETE FROM sessions WHERE user_id = ?", userID)
	}

	return nil
}

// GetUserByUsername retrieves a user by username
func (d *Database) GetUserByUsername(username string) (*User, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var user User
	var createdAt, updatedAt int64

	err := d.db.QueryRow(
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
