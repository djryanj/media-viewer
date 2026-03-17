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

// sessionExtendCooldown is the minimum interval between session-extension DB
// writes for the same token. Calls that arrive within this window are no-ops
// at the in-memory level, avoiding a write-storm when many concurrent requests
// (thumbnails, static assets) all pass through AuthMiddleware simultaneously.
const sessionExtendCooldown = 60 * time.Second

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

// IsSetupComplete checks if initial setup has been completed.
// IsSetupComplete checks if initial setup has been completed.
func (d *Database) IsSetupComplete(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var setupComplete int
	err := d.reader.QueryRowContext(ctx, "SELECT COALESCE(MAX(setup_complete), 0) FROM users").Scan(&setupComplete)
	if err != nil {
		return false
	}
	return setupComplete == 1
}

// HasUsers checks if a user exists.
func (d *Database) HasUsers(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	err := d.reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return false
	}
	return count > 0
}

// CreateUser creates the single user with the given password.
func (d *Database) CreateUser(ctx context.Context, password string) error {
	done := d.observeQuery("create_user")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Check via reader (fast, no write lock needed)
	var count int
	err := d.reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		err = fmt.Errorf("failed to check existing users: %w", err)
		done(err)
		return err
	}
	if count > 0 {
		err = fmt.Errorf("user already exists (single-user system)")
		done(err)
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		err = fmt.Errorf("failed to hash password: %w", err)
		done(err)
		return err
	}

	_, err = d.writer.ExecContext(ctx,
		"INSERT INTO users (password_hash, setup_complete) VALUES (?, 1)",
		string(hash),
	)
	if err != nil {
		err = fmt.Errorf("failed to create user: %w", err)
		done(err)
		return err
	}

	done(nil)
	return nil
}

// ValidatePassword checks the password and returns the user if valid.
func (d *Database) ValidatePassword(ctx context.Context, password string) (*User, error) {
	done := d.observeQuery("validate_password")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var user User
	var createdAt, updatedAt int64

	err := d.reader.QueryRowContext(ctx,
		"SELECT id, password_hash, created_at, updated_at FROM users LIMIT 1",
	).Scan(&user.ID, &user.PasswordHash, &createdAt, &updatedAt)

	if err != nil {
		err = fmt.Errorf("invalid password")
		done(err)
		return nil, err
	}

	if err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		err = fmt.Errorf("invalid password")
		done(err)
		return nil, err
	}

	user.CreatedAt = time.Unix(createdAt, 0)
	user.UpdatedAt = time.Unix(updatedAt, 0)

	done(nil)
	return &user, nil
}

// CreateSession creates a new session for a user.
func (d *Database) CreateSession(ctx context.Context, userID int64) (*Session, error) {
	done := d.observeQuery("create_session")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		err = fmt.Errorf("failed to generate token: %w", err)
		done(err)
		return nil, err
	}

	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])
	token := hex.EncodeToString(tokenBytes)

	expiresAt := time.Now().Add(sessionDuration)

	result, err := d.writer.ExecContext(ctx,
		"INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
		userID, tokenHash, expiresAt.Unix(),
	)
	if err != nil {
		err = fmt.Errorf("failed to create session: %w", err)
		done(err)
		return nil, err
	}

	id, _ := result.LastInsertId()

	//nolint:contextcheck
	d.updateActiveSessionsMetric()

	done(nil)
	return &Session{
		ID:        id,
		UserID:    userID,
		Token:     token,
		ExpiresAt: expiresAt,
		CreatedAt: time.Now(),
	}, nil
}

// ValidateSession checks if a session token is valid.
func (d *Database) ValidateSession(ctx context.Context, token string) (*User, error) {
	done := d.observeQuery("validate_session")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		err = fmt.Errorf("invalid token format")
		done(err)
		return nil, err
	}
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])

	var userID int64
	var expiresAt int64

	err = d.reader.QueryRowContext(ctx,
		"SELECT user_id, expires_at FROM sessions WHERE token = ?",
		tokenHash,
	).Scan(&userID, &expiresAt)

	if err != nil {
		err = fmt.Errorf("invalid session")
		done(err)
		return nil, err
	}

	if time.Now().Unix() > expiresAt {
		//nolint:contextcheck,gosec // G118: intentionally outlives request to clean up expired session
		go func() {
			bgCtx, bgCancel := context.WithTimeout(context.Background(), defaultTimeout)
			defer bgCancel()
			if delErr := d.deleteSessionByHash(bgCtx, tokenHash); delErr != nil {
				logging.Error("failed to delete expired session: %v", delErr)
			}
		}()
		err = fmt.Errorf("session expired")
		done(err)
		return nil, err
	}

	var user User
	var createdAtU, updatedAtU int64
	err = d.reader.QueryRowContext(ctx,
		"SELECT id, created_at, updated_at FROM users WHERE id = ?",
		userID,
	).Scan(&user.ID, &createdAtU, &updatedAtU)

	if err != nil {
		err = fmt.Errorf("user not found")
		done(err)
		return nil, err
	}

	user.CreatedAt = time.Unix(createdAtU, 0)
	user.UpdatedAt = time.Unix(updatedAtU, 0)

	done(nil)
	return &user, nil
}

// ExtendSession extends the expiration time of an existing session.
// A 60-second in-memory cooldown is applied per token so that bursts of
// concurrent requests (thumbnails, static assets) do not each generate a
// separate DB write; only the first call in any 60-second window hits the DB.
func (d *Database) ExtendSession(ctx context.Context, token string) error {
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return fmt.Errorf("invalid token format: %w", err)
	}
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])

	// Cooldown: skip the DB write if this token was extended recently.
	// Return before calling observeQuery so cooldown-skipped calls are not
	// counted in the extend_session metric (only real DB writes should appear).
	if lastRaw, ok := d.sessionExtendTimes.Load(tokenHash); ok {
		if lastTS, ok := lastRaw.(int64); ok {
			if time.Since(time.Unix(lastTS, 0)) < sessionExtendCooldown {
				return nil
			}
		}
	}

	done := d.observeQuery("extend_session")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	newExpiresAt := time.Now().Add(sessionDuration)

	result, err := d.writer.ExecContext(ctx,
		"UPDATE sessions SET expires_at = ? WHERE token = ? AND expires_at > ?",
		newExpiresAt.Unix(), tokenHash, time.Now().Unix(),
	)
	if err != nil {
		err = fmt.Errorf("failed to extend session: %w", err)
		done(err)
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		err = fmt.Errorf("session not found or expired")
		done(err)
		return err
	}

	d.sessionExtendTimes.Store(tokenHash, time.Now().Unix())
	done(nil)
	return nil
}

func (d *Database) deleteSessionByHash(ctx context.Context, tokenHash string) error {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	result, err := d.writer.ExecContext(ctx, "DELETE FROM sessions WHERE token = ?", tokenHash)
	if err != nil {
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("session not found")
	}

	// Remove the cooldown entry so a new session with the same token hash
	// (extremely unlikely but possible) starts fresh.
	d.sessionExtendTimes.Delete(tokenHash)
	return nil
}

// DeleteSession deletes a session by token.
func (d *Database) DeleteSession(ctx context.Context, token string) error {
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return fmt.Errorf("invalid token format: %w", err)
	}
	hash := sha256.Sum256(tokenBytes)
	tokenHash := hex.EncodeToString(hash[:])

	err = d.deleteSessionByHash(ctx, tokenHash)
	if err == nil {
		//nolint:contextcheck
		d.updateActiveSessionsMetric()
	}
	return err
}

// DeleteAllSessions removes all sessions from the database.
func (d *Database) DeleteAllSessions(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.writer.ExecContext(ctx, "DELETE FROM sessions")
	return err
}

// CleanExpiredSessions removes expired sessions from the database.
func (d *Database) CleanExpiredSessions(ctx context.Context) error {
	done := d.observeQuery("clean_expired_sessions")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	result, err := d.writer.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at < ?", time.Now().Unix())
	if err == nil {
		if rows, _ := result.RowsAffected(); rows > 0 {
			logging.Debug("Cleaned %d expired sessions", rows)
		}
		//nolint:contextcheck
		d.updateActiveSessionsMetric()
	}
	done(err)
	return err
}

// UpdatePassword updates the user's password and invalidates all sessions.
func (d *Database) UpdatePassword(ctx context.Context, newPassword string) error {
	done := d.observeQuery("update_password")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		err = fmt.Errorf("failed to hash password: %w", err)
		done(err)
		return err
	}

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	result, err := tx.ExecContext(ctx,
		"UPDATE users SET password_hash = ?, updated_at = strftime('%s', 'now')",
		string(hash),
	)
	if err != nil {
		err = fmt.Errorf("failed to update password: %w", err)
		done(err)
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		err = fmt.Errorf("no user found")
		done(err)
		return err
	}

	if _, delErr := tx.ExecContext(ctx, "DELETE FROM sessions"); delErr != nil {
		logging.Warn("failed to invalidate sessions: %v", delErr)
	}

	if commitErr := tx.Commit(); commitErr != nil {
		done(commitErr)
		return fmt.Errorf("failed to commit password update: %w", commitErr)
	}

	done(nil)
	return nil
}

// updateActiveSessionsMetric updates the active session metric.
func (d *Database) updateActiveSessionsMetric() {
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	var count int
	err := d.reader.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sessions WHERE expires_at > ?",
		time.Now().Unix(),
	).Scan(&count)
	if err != nil {
		logging.Debug("Failed to count active sessions: %v", err)
		return
	}
	metrics.ActiveSessions.Set(float64(count))
}
