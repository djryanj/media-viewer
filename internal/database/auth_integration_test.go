package database

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

func TestIsSetupCompleteIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Initially setup should not be complete
	if db.IsSetupComplete(ctx) {
		t.Error("Expected IsSetupComplete=false initially")
	}

	// Create a user
	err := db.CreateUser(ctx, "testpassword")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Setup should be complete now
	if !db.IsSetupComplete(ctx) {
		t.Error("Expected IsSetupComplete=true after creating user")
	}
}

func TestHasUsersIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Initially should have no users
	if db.HasUsers(ctx) {
		t.Error("Expected HasUsers=false initially")
	}

	// Create a user
	err := db.CreateUser(ctx, "testpassword")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Should have users now
	if !db.HasUsers(ctx) {
		t.Error("Expected HasUsers=true after creating user")
	}
}

func TestCreateUserIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user
	err := db.CreateUser(ctx, "mypassword123")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Verify user exists
	if !db.HasUsers(ctx) {
		t.Error("User should exist after creation")
	}

	// Try to create another user (should fail - single user system)
	err = db.CreateUser(ctx, "anotherpassword")
	if err == nil {
		t.Error("Expected error when creating second user")
	}
}

func TestCreateUserEmptyPasswordIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user with empty password (bcrypt will hash it)
	err := db.CreateUser(ctx, "")
	if err != nil {
		t.Fatalf("CreateUser with empty password failed: %v", err)
	}

	// Verify user exists
	if !db.HasUsers(ctx) {
		t.Error("User should exist after creation")
	}

	// Verify empty password can be validated
	_, err = db.ValidatePassword(ctx, "")
	if err != nil {
		t.Errorf("Empty password should validate: %v", err)
	}
}

func TestValidatePasswordIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user
	password := "securePassword123"
	err := db.CreateUser(ctx, password)
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Validate correct password
	user, err := db.ValidatePassword(ctx, password)
	if err != nil {
		t.Fatalf("ValidatePassword failed with correct password: %v", err)
	}

	if user == nil {
		t.Fatal("Expected non-nil user")
	}

	if user.ID == 0 {
		t.Error("Expected non-zero user ID")
	}

	// Validate wrong password
	_, err = db.ValidatePassword(ctx, "wrongpassword")
	if err == nil {
		t.Error("Expected error for wrong password")
	}

	// Validate empty password
	_, err = db.ValidatePassword(ctx, "")
	if err == nil {
		t.Error("Expected error for empty password")
	}
}

func TestValidatePasswordNoUserIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Try to validate password when no user exists
	_, err := db.ValidatePassword(ctx, "anypassword")
	if err == nil {
		t.Error("Expected error when no user exists")
	}
}

func TestCreateSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user
	_ = db.CreateUser(ctx, "password")

	// Get user
	user, _ := db.ValidatePassword(ctx, "password")

	// Create session
	session, err := db.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	if session == nil {
		t.Fatal("Expected non-nil session")
	}

	if session.Token == "" {
		t.Error("Expected non-empty session token")
	}

	if session.UserID != user.ID {
		t.Errorf("Expected UserID=%d, got %d", user.ID, session.UserID)
	}

	if session.ExpiresAt.IsZero() {
		t.Error("Expected non-zero expiration time")
	}

	// Token should be at least 32 characters (hex encoded)
	if len(session.Token) < 32 {
		t.Errorf("Expected token length >= 32, got %d", len(session.Token))
	}
}

func TestCreateMultipleSessionsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user
	_ = db.CreateUser(ctx, "password")
	user, _ := db.ValidatePassword(ctx, "password")

	// Create multiple sessions
	tokens := make(map[string]bool)
	for i := 0; i < 5; i++ {
		session, err := db.CreateSession(ctx, user.ID)
		if err != nil {
			t.Fatalf("CreateSession %d failed: %v", i, err)
		}

		// Verify tokens are unique
		if tokens[session.Token] {
			t.Errorf("Duplicate token generated: %s", session.Token)
		}
		tokens[session.Token] = true
	}

	if len(tokens) != 5 {
		t.Errorf("Expected 5 unique tokens, got %d", len(tokens))
	}
}

func TestValidateSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user and session
	_ = db.CreateUser(ctx, "password")
	user, _ := db.ValidatePassword(ctx, "password")
	session, _ := db.CreateSession(ctx, user.ID)

	// Validate valid session
	validUser, err := db.ValidateSession(ctx, session.Token)
	if err != nil {
		t.Fatalf("ValidateSession failed: %v", err)
	}

	if validUser == nil {
		t.Fatal("Expected non-nil user")
	}

	if validUser.ID != user.ID {
		t.Errorf("Expected UserID=%d, got %d", user.ID, validUser.ID)
	}

	// Validate invalid token
	_, err = db.ValidateSession(ctx, "invalid-token-12345")
	if err == nil {
		t.Error("Expected error for invalid token")
	}

	// Validate empty token
	_, err = db.ValidateSession(ctx, "")
	if err == nil {
		t.Error("Expected error for empty token")
	}
}

func TestExtendSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user and session
	_ = db.CreateUser(ctx, "password")
	user, _ := db.ValidatePassword(ctx, "password")
	session, _ := db.CreateSession(ctx, user.ID)

	// Wait a moment
	time.Sleep(100 * time.Millisecond)

	// Extend session
	err := db.ExtendSession(ctx, session.Token)
	if err != nil {
		t.Fatalf("ExtendSession failed: %v", err)
	}

	// Validate session still works
	validUser, err := db.ValidateSession(ctx, session.Token)
	if err != nil {
		t.Fatalf("ValidateSession after extend failed: %v", err)
	}

	if validUser == nil {
		t.Fatal("Expected non-nil user after extend")
	}

	// Extend invalid token (should error)
	err = db.ExtendSession(ctx, "invalid-token")
	if err == nil {
		t.Error("ExtendSession with invalid token should error")
	}
}

func TestExtendSessionCooldownIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	_ = db.CreateUser(ctx, "password")
	user, _ := db.ValidatePassword(ctx, "password")
	session, _ := db.CreateSession(ctx, user.ID)

	// First extend — hits the database and records the timestamp.
	if err := db.ExtendSession(ctx, session.Token); err != nil {
		t.Fatalf("first ExtendSession failed: %v", err)
	}

	// Second extend immediately — should be skipped by the cooldown but still
	// return nil (not an error from the caller's perspective).
	if err := db.ExtendSession(ctx, session.Token); err != nil {
		t.Fatalf("second ExtendSession (cooldown skip) should return nil, got: %v", err)
	}

	// Session should remain valid after both calls.
	validUser, err := db.ValidateSession(ctx, session.Token)
	if err != nil {
		t.Fatalf("ValidateSession after cooldown-skipped extend failed: %v", err)
	}
	if validUser == nil {
		t.Error("expected valid user after cooldown-skipped extend")
	}
}

func TestExtendSessionCooldownClearedOnDeleteIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	_ = db.CreateUser(ctx, "password")
	user, _ := db.ValidatePassword(ctx, "password")
	session, _ := db.CreateSession(ctx, user.ID)

	// Prime the cooldown cache.
	if err := db.ExtendSession(ctx, session.Token); err != nil {
		t.Fatalf("ExtendSession failed: %v", err)
	}

	// Delete the session — this should also clear the in-memory cooldown entry.
	if err := db.DeleteSession(ctx, session.Token); err != nil {
		t.Fatalf("DeleteSession failed: %v", err)
	}

	// Session must now be invalid.
	_, err := db.ValidateSession(ctx, session.Token)
	if err == nil {
		t.Error("session should be invalid after deletion")
	}
}

func TestDeleteSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user and session
	_ = db.CreateUser(ctx, "password")
	user, _ := db.ValidatePassword(ctx, "password")
	session, _ := db.CreateSession(ctx, user.ID)

	// Verify session is valid
	_, err := db.ValidateSession(ctx, session.Token)
	if err != nil {
		t.Fatalf("Session should be valid: %v", err)
	}

	// Delete session
	err = db.DeleteSession(ctx, session.Token)
	if err != nil {
		t.Fatalf("DeleteSession failed: %v", err)
	}

	// Verify session is no longer valid
	_, err = db.ValidateSession(ctx, session.Token)
	if err == nil {
		t.Error("Session should be invalid after deletion")
	}

	// Delete non-existent session (should error)
	err = db.DeleteSession(ctx, "nonexistent-token")
	if err == nil {
		t.Error("DeleteSession with non-existent token should error")
	}
}

func TestDeleteAllSessionsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user and multiple sessions
	_ = db.CreateUser(ctx, "password")
	user, _ := db.ValidatePassword(ctx, "password")

	var sessions []*Session
	for i := 0; i < 3; i++ {
		session, _ := db.CreateSession(ctx, user.ID)
		sessions = append(sessions, session)
	}

	// Verify all sessions are valid
	for i, session := range sessions {
		_, err := db.ValidateSession(ctx, session.Token)
		if err != nil {
			t.Fatalf("Session %d should be valid: %v", i, err)
		}
	}

	// Delete all sessions
	err := db.DeleteAllSessions(ctx)
	if err != nil {
		t.Fatalf("DeleteAllSessions failed: %v", err)
	}

	// Verify all sessions are invalid
	for i, session := range sessions {
		_, err := db.ValidateSession(ctx, session.Token)
		if err == nil {
			t.Errorf("Session %d should be invalid after DeleteAllSessions", i)
		}
	}
}

func TestCleanExpiredSessionsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user
	_ = db.CreateUser(ctx, "password")
	user, _ := db.ValidatePassword(ctx, "password")

	// Create a valid session
	validSession, _ := db.CreateSession(ctx, user.ID)

	// Create an expired session by directly inserting into DB
	expiredToken := "expired-token-12345678901234567890"
	_, err := db.writer.ExecContext(ctx, `
		INSERT INTO sessions (user_id, token, expires_at)
		VALUES (?, ?, ?)
	`, user.ID, expiredToken, time.Now().Add(-1*time.Hour).Unix())
	if err != nil {
		t.Fatalf("Failed to insert expired session: %v", err)
	}

	// Clean expired sessions
	err = db.CleanExpiredSessions(ctx)
	if err != nil {
		t.Fatalf("CleanExpiredSessions failed: %v", err)
	}

	// Valid session should still work
	_, err = db.ValidateSession(ctx, validSession.Token)
	if err != nil {
		t.Errorf("Valid session should still be valid: %v", err)
	}

	// Expired session should be gone (but ValidateSession won't find it anyway)
	_, err = db.ValidateSession(ctx, expiredToken)
	if err == nil {
		t.Error("Expired session should not validate")
	}
}

func TestUpdatePasswordIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user
	oldPassword := "oldPassword123"
	_ = db.CreateUser(ctx, oldPassword)

	// Verify old password works
	_, err := db.ValidatePassword(ctx, oldPassword)
	if err != nil {
		t.Fatalf("Old password should work: %v", err)
	}

	// Update password
	newPassword := "newPassword456"
	err = db.UpdatePassword(ctx, newPassword)
	if err != nil {
		t.Fatalf("UpdatePassword failed: %v", err)
	}

	// Old password should no longer work
	_, err = db.ValidatePassword(ctx, oldPassword)
	if err == nil {
		t.Error("Old password should not work after update")
	}

	// New password should work
	user, err := db.ValidatePassword(ctx, newPassword)
	if err != nil {
		t.Fatalf("New password should work: %v", err)
	}

	if user == nil {
		t.Error("Expected non-nil user with new password")
	}
}

func TestUpdatePasswordInvalidatesSessionsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user and session
	_ = db.CreateUser(ctx, "oldPassword")
	user, _ := db.ValidatePassword(ctx, "oldPassword")
	session, _ := db.CreateSession(ctx, user.ID)

	// Verify session works
	_, err := db.ValidateSession(ctx, session.Token)
	if err != nil {
		t.Fatalf("Session should be valid: %v", err)
	}

	// Update password
	err = db.UpdatePassword(ctx, "newPassword")
	if err != nil {
		t.Fatalf("UpdatePassword failed: %v", err)
	}

	// Session should be invalidated
	_, err = db.ValidateSession(ctx, session.Token)
	if err == nil {
		t.Error("Session should be invalid after password update")
	}
}

func TestPasswordHashingIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user
	password := "testPassword"
	_ = db.CreateUser(ctx, password)

	// Query the database directly to verify password is hashed
	var passwordHash string
	err := db.reader.QueryRowContext(ctx, "SELECT password_hash FROM users LIMIT 1").Scan(&passwordHash)
	if err != nil {
		t.Fatalf("Failed to query password hash: %v", err)
	}

	// Hash should not be empty
	if passwordHash == "" {
		t.Error("Password hash should not be empty")
	}

	// Hash should not be the plain password
	if passwordHash == password {
		t.Error("Password should be hashed, not stored in plaintext")
	}

	// Hash should look like a bcrypt hash (starts with $2a$ or $2b$)
	if len(passwordHash) < 10 || (passwordHash[:4] != "$2a$" && passwordHash[:4] != "$2b$") {
		t.Errorf("Password hash doesn't look like bcrypt: %s", passwordHash[:10])
	}
}

func TestSessionExpirationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user and session
	_ = db.CreateUser(ctx, "password")
	user, _ := db.ValidatePassword(ctx, "password")
	session, _ := db.CreateSession(ctx, user.ID)

	// Verify expiration is in the future
	if session.ExpiresAt.Before(time.Now()) {
		t.Error("Session expiration should be in the future")
	}

	// Verify expiration is reasonable (within 31 days, typical max)
	maxExpiry := time.Now().Add(31 * 24 * time.Hour)
	if session.ExpiresAt.After(maxExpiry) {
		t.Error("Session expiration seems too far in the future")
	}
}

// =============================================================================
// Error-path integration tests — covering lines reported as 0 in coverage.out
// =============================================================================

// TestIsSetupCompleteClosedDB verifies that IsSetupComplete returns false
// when the DB is closed (auth.go:62-64: query error → return false).
func TestIsSetupCompleteClosedDB(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	db.Close()

	if db.IsSetupComplete(context.Background()) {
		t.Error("IsSetupComplete should return false when DB is closed")
	}
}

// TestHasUsersClosedDB verifies that HasUsers returns false when the DB is
// closed (auth.go:75-77: query error → return false).
func TestHasUsersClosedDB(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	db.Close()

	if db.HasUsers(context.Background()) {
		t.Error("HasUsers should return false when DB is closed")
	}
}

// TestCreateUserClosedDB verifies that CreateUser returns an error when the
// DB is closed (auth.go:91-95: reader query error path).
func TestCreateUserClosedDB(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	db.Close()

	if err := db.CreateUser(context.Background(), "password"); err == nil {
		t.Error("CreateUser should error when DB is closed")
	}
}

// TestValidateSessionTokenNotFound covers the path in ValidateSession where a
// well-formed hex token is not present in the sessions table
// (auth.go:233.13-238.5: QueryRowContext scan returns sql.ErrNoRows).
func TestValidateSessionTokenNotFound(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	// 64 hex zeros → valid hex, but the derived SHA-256 hash is not in sessions.
	_, err := db.ValidateSession(context.Background(), strings.Repeat("0", 64))
	if err == nil {
		t.Error("expected error when session token is not found")
	}
}

// TestValidateSessionExpiredToken covers the expired-session branch in
// ValidateSession (auth.go:240.3-242.18). An already-expired session is
// inserted directly so the expiry check fires.
func TestValidateSessionExpiredToken(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	if err := db.CreateUser(ctx, "password"); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := db.ValidatePassword(ctx, "password")
	if err != nil {
		t.Fatalf("ValidatePassword: %v", err)
	}

	// Build a token that mimics what CreateSession does, but with a past expiry.
	rawToken := make([]byte, 32) // 32 zero-bytes
	tokenHex := hex.EncodeToString(rawToken)
	hash := sha256.Sum256(rawToken)
	tokenHash := hex.EncodeToString(hash[:])

	expiredAt := time.Now().Add(-1 * time.Hour).Unix()
	_, err = db.writer.ExecContext(ctx,
		"INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
		user.ID, tokenHash, expiredAt,
	)
	if err != nil {
		t.Fatalf("failed to insert expired session: %v", err)
	}

	_, err = db.ValidateSession(ctx, tokenHex)
	if err == nil {
		t.Error("expected error for expired session")
	}
}

// TestValidateSessionOrphanedSession covers the "user not found" branch in
// ValidateSession (auth.go:252.16-256.3). SQLite does not enforce foreign-key
// constraints by default (no PRAGMA foreign_keys=ON in our ConnectHook), so
// deleting a user leaves its sessions intact. ValidateSession then finds the
// session row but cannot look up the owning user.
func TestValidateSessionOrphanedSession(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	if err := db.CreateUser(ctx, "password"); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := db.ValidatePassword(ctx, "password")
	if err != nil {
		t.Fatalf("ValidatePassword: %v", err)
	}
	session, err := db.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Confirm the session is valid before we break things.
	if _, err = db.ValidateSession(ctx, session.Token); err != nil {
		t.Fatalf("pre-condition: session should be valid: %v", err)
	}

	// Delete the user directly. FK enforcement is off → session row survives.
	if _, err = db.writer.ExecContext(ctx, "DELETE FROM users"); err != nil {
		t.Fatalf("DELETE FROM users: %v", err)
	}

	// Now ValidateSession should find the session but fail the user lookup.
	_, err = db.ValidateSession(ctx, session.Token)
	if err == nil {
		t.Error("expected error when owning user no longer exists")
	}
}

// TestExtendSessionExecError covers the writer.ExecContext error path in
// ExtendSession (auth.go:286.16-290.3): hex decode and hash succeed, but the
// UPDATE fails because the DB is closed.
func TestExtendSessionExecError(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)

	ctx := context.Background()

	if err := db.CreateUser(ctx, "password"); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := db.ValidatePassword(ctx, "password")
	if err != nil {
		t.Fatalf("ValidatePassword: %v", err)
	}
	session, err := db.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	db.Close() // DB closed — next ExecContext will fail.

	if err := db.ExtendSession(ctx, session.Token); err == nil {
		t.Error("expected error from ExtendSession when DB is closed")
	}
}

// TestExtendSessionNotFound covers the rows-affected == 0 path in ExtendSession
// (auth.go:293.15-297.3): UPDATE matches no rows because the token is not in
// the sessions table (valid hex, but no matching session).
func TestExtendSessionNotFound(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	// 64 'a' chars: valid hex, but SHA-256 hash is not a session token.
	notInDB := strings.Repeat("a", 64)
	if err := db.ExtendSession(context.Background(), notInDB); err == nil {
		t.Error("expected error when session is not found")
	}
}

// TestDeleteSessionByHashExecError covers the writer.ExecContext error path
// in deleteSessionByHash (auth.go:308.16-310.3): a valid hex token is held,
// then the DB is closed so the DELETE fails.
func TestDeleteSessionByHashExecError(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)

	ctx := context.Background()

	if err := db.CreateUser(ctx, "password"); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := db.ValidatePassword(ctx, "password")
	if err != nil {
		t.Fatalf("ValidatePassword: %v", err)
	}
	session, err := db.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	db.Close() // closed → DELETE will fail.

	if err := db.DeleteSession(ctx, session.Token); err == nil {
		t.Error("expected error from DeleteSession when DB is closed")
	}
}

// TestDeleteSessionByHashNotFound covers the rows-affected == 0 path in
// deleteSessionByHash (auth.go:313.15-315.3). The session is deleted
// successfully on the first call; a second call finds no matching row.
func TestDeleteSessionByHashNotFound(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	if err := db.CreateUser(ctx, "password"); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := db.ValidatePassword(ctx, "password")
	if err != nil {
		t.Fatalf("ValidatePassword: %v", err)
	}
	session, err := db.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// First delete: succeeds.
	if err := db.DeleteSession(ctx, session.Token); err != nil {
		t.Fatalf("first DeleteSession failed: %v", err)
	}

	// Second delete: same token, no row → deleteSessionByHash rows==0.
	if err := db.DeleteSession(ctx, session.Token); err == nil {
		t.Error("expected error when deleting an already-deleted session")
	}
}

// TestUpdatePasswordNoUser covers the rows-affected == 0 path in UpdatePassword
// (auth.go:403.2-410.3): the UPDATE affects no rows because the users table
// is empty.
func TestUpdatePasswordNoUser(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	// No user has been created → UPDATE users SET ... returns 0 rows.
	if err := db.UpdatePassword(context.Background(), "newpassword"); err == nil {
		t.Error("expected error from UpdatePassword when no user exists")
	}
}

// TestUpdatePasswordClosedDB covers the BeginTx error path in UpdatePassword
// (auth.go:380.16-383.3): bcrypt hashing succeeds but the transaction cannot
// be started because the DB is closed.
func TestUpdatePasswordClosedDB(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	db.Close()

	if err := db.UpdatePassword(context.Background(), "newpassword"); err == nil {
		t.Error("expected error from UpdatePassword when DB is closed")
	}
}

// TestCreateSessionExecErrorIntegration covers the ExecContext failure branch
// in CreateSession (auth.go:180-184) by closing the DB after creating a user.
func TestCreateSessionExecErrorIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)

	ctx := context.Background()

	if err := db.CreateUser(ctx, "password"); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	user, err := db.ValidatePassword(ctx, "password")
	if err != nil {
		t.Fatalf("ValidatePassword failed: %v", err)
	}

	// Close the DB before calling CreateSession to force the ExecContext error.
	db.Close()

	if _, err := db.CreateSession(ctx, user.ID); err == nil {
		t.Error("expected error from CreateSession when DB is closed")
	}
}

func TestAuthConcurrencyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user
	_ = db.CreateUser(ctx, "password")

	// Perform concurrent auth operations
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func() {
			defer func() { done <- true }()

			// Validate password
			user, err := db.ValidatePassword(ctx, "password")
			if err != nil {
				return
			}

			// Create session
			session, err := db.CreateSession(ctx, user.ID)
			if err != nil {
				return
			}

			// Validate session
			_, _ = db.ValidateSession(ctx, session.Token)

			// Delete session
			_ = db.DeleteSession(ctx, session.Token)
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify database is still functional
	if !db.HasUsers(ctx) {
		t.Error("Expected user to still exist after concurrent operations")
	}
}
