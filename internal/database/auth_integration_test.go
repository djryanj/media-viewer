package database

import (
	"context"
	"testing"
	"time"
)

func TestHasUsersIntegration(t *testing.T) {
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

func TestDeleteSessionIntegration(t *testing.T) {
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
	_, err := db.db.ExecContext(ctx, `
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
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create user
	password := "testPassword"
	_ = db.CreateUser(ctx, password)

	// Query the database directly to verify password is hashed
	var passwordHash string
	err := db.db.QueryRowContext(ctx, "SELECT password_hash FROM users LIMIT 1").Scan(&passwordHash)
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

func TestAuthConcurrencyIntegration(t *testing.T) {
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
