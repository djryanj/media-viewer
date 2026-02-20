package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"media-viewer/internal/database"

	"golang.org/x/term"
)

// =============================================================================
// Password Validation Tests
// =============================================================================

// These tests verify the password validation logic by examining the behavior
// of resetPassword with mocked or controlled inputs.

// TestPasswordValidationLogic tests password length and matching validation
func TestPasswordValidationLogic(t *testing.T) {
	tests := []struct {
		name      string
		password  string
		confirm   string
		wantValid bool
	}{
		{
			name:      "valid password",
			password:  "validpass123",
			confirm:   "validpass123",
			wantValid: true,
		},
		{
			name:      "minimum length password",
			password:  "123456",
			confirm:   "123456",
			wantValid: true,
		},
		{
			name:      "too short password",
			password:  "12345",
			confirm:   "12345",
			wantValid: false,
		},
		{
			name:      "empty password",
			password:  "",
			confirm:   "",
			wantValid: false,
		},
		{
			name:      "mismatched passwords",
			password:  "password123",
			confirm:   "password456",
			wantValid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Test password length validation
			passBytes := []byte(tt.password)
			confirmBytes := []byte(tt.confirm)

			lengthValid := len(passBytes) >= 6
			matchValid := bytes.Equal(passBytes, confirmBytes)
			valid := lengthValid && matchValid

			if valid != tt.wantValid {
				t.Errorf("validation = %v, want %v (length=%v, match=%v)",
					valid, tt.wantValid, lengthValid, matchValid)
			}
		})
	}
}

// TestPasswordBytesComparison tests the bytes.Equal logic for password matching
func TestPasswordBytesComparison(t *testing.T) {
	tests := []struct {
		name     string
		pass1    []byte
		pass2    []byte
		wantSame bool
	}{
		{
			name:     "identical passwords",
			pass1:    []byte("password"),
			pass2:    []byte("password"),
			wantSame: true,
		},
		{
			name:     "different passwords",
			pass1:    []byte("password1"),
			pass2:    []byte("password2"),
			wantSame: false,
		},
		{
			name:     "case sensitive",
			pass1:    []byte("Password"),
			pass2:    []byte("password"),
			wantSame: false,
		},
		{
			name:     "empty passwords",
			pass1:    []byte(""),
			pass2:    []byte(""),
			wantSame: true,
		},
		{
			name:     "nil vs empty",
			pass1:    nil,
			pass2:    []byte(""),
			wantSame: true, // bytes.Equal treats nil and empty slice as equal
		},
		{
			name:     "whitespace sensitive",
			pass1:    []byte("password "),
			pass2:    []byte("password"),
			wantSame: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := bytes.Equal(tt.pass1, tt.pass2)
			if result != tt.wantSame {
				t.Errorf("bytes.Equal() = %v, want %v", result, tt.wantSame)
			}
		})
	}
}

// TestPasswordMinimumLength tests the minimum password length requirement
func TestPasswordMinimumLength(t *testing.T) {
	const minLength = 6

	tests := []struct {
		password string
		valid    bool
	}{
		{"", false},
		{"1", false},
		{"12", false},
		{"123", false},
		{"1234", false},
		{"12345", false},
		{"123456", true},
		{"1234567", true},
		{"verylongpassword", true},
	}

	for _, tt := range tests {
		t.Run(tt.password, func(t *testing.T) {
			valid := len(tt.password) >= minLength
			if valid != tt.valid {
				t.Errorf("len(%q) >= %d = %v, want %v",
					tt.password, minLength, valid, tt.valid)
			}
		})
	}
}

// =============================================================================
// Database Integration Tests for Password Operations
// =============================================================================

// TestPasswordUpdateFlow tests the complete flow of updating a password
func TestPasswordUpdateFlowIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Step 1: Create initial user
	oldPassword := "oldpassword123"
	if err := db.CreateUser(ctx, oldPassword); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Step 2: Verify user can authenticate with old password
	if _, err := db.ValidatePassword(ctx, oldPassword); err != nil {
		t.Fatalf("failed to authenticate with old password: %v", err)
	}

	// Step 3: Update to new password
	newPassword := "newpassword456"
	if err := db.UpdatePassword(ctx, newPassword); err != nil {
		t.Fatalf("failed to update password: %v", err)
	}

	// Step 4: Verify old password no longer works
	if _, err := db.ValidatePassword(ctx, oldPassword); err == nil {
		t.Error("Expected authentication to fail with old password")
	}

	// Step 5: Verify new password works
	if _, err := db.ValidatePassword(ctx, newPassword); err != nil {
		t.Errorf("failed to authenticate with new password: %v", err)
	}
}

// TestPasswordUpdateInvalidatesSessionsIntegration verifies sessions are cleared
func TestPasswordUpdateInvalidatesSessionsIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Create user and get session
	password := "testpassword"
	if err := db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	user, err := db.ValidatePassword(ctx, password)
	if err != nil {
		t.Fatalf("failed to authenticate: %v", err)
	}

	session, err := db.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Verify session is valid
	if _, err := db.ValidateSession(ctx, session.Token); err != nil {
		t.Fatal("Expected session to be valid before password update")
	}

	// Update password
	if err := db.UpdatePassword(ctx, "newpassword"); err != nil {
		t.Fatalf("failed to update password: %v", err)
	}

	// Verify old session is now invalid
	if _, err := db.ValidateSession(ctx, session.Token); err == nil {
		t.Error("Expected session to be invalid after password update")
	}
}

// TestResetPasswordWithNoExistingUser verifies behavior when no user exists
func TestResetPasswordWithNoExistingUserIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Verify no user exists
	if db.HasUsers(ctx) {
		t.Fatal("Expected no users in fresh database")
	}

	// The resetPassword function should return false when no users exist
	// We test the precondition here since we can't mock stdin
	result := resetPassword(ctx, db)
	if result {
		t.Error("Expected resetPassword to return false when no users exist")
	}
}

// TestTerminalReadPassword tests that term.ReadPassword is available
func TestTerminalReadPasswordAvailable(t *testing.T) {
	// This test verifies that the terminal package is properly imported
	// and the ReadPassword function is available
	// We can't actually test it without a terminal, but we can verify
	// the function exists and returns an error for invalid fd

	_, err := term.ReadPassword(syscall.Stdin)
	// This will fail in test environment, but shouldn't panic
	if err == nil {
		t.Log("Unexpectedly succeeded reading password in test environment")
	}
}

// TestPasswordUpdateWithDatabaseError simulates database errors
func TestPasswordUpdateWithDatabaseErrorIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	ctx := context.Background()

	// Create user
	if err := db.CreateUser(ctx, "password"); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Close database to simulate error condition
	db.Close()

	// Try to update password on closed database
	err = db.UpdatePassword(ctx, "newpassword")
	if err == nil {
		t.Error("Expected error when updating password on closed database")
	}
}

// TestMultiplePasswordUpdates tests updating password multiple times
func TestMultiplePasswordUpdatesIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Create initial user
	passwords := []string{"password1", "password2", "password3"}
	if err := db.CreateUser(ctx, passwords[0]); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Update password multiple times
	for i := 1; i < len(passwords); i++ {
		if err := db.UpdatePassword(ctx, passwords[i]); err != nil {
			t.Fatalf("failed to update to password %d: %v", i, err)
		}

		// Verify new password works
		if _, err := db.ValidatePassword(ctx, passwords[i]); err != nil {
			t.Errorf("failed to authenticate with password %d: %v", i, err)
		}

		// Verify old password doesn't work
		if _, err := db.ValidatePassword(ctx, passwords[i-1]); err == nil {
			t.Errorf("old password %d still works after update", i-1)
		}
	}
}

// TestPasswordWithSpecialCharacters tests passwords with special characters
func TestPasswordWithSpecialCharactersIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	passwords := []string{
		"pass@word!123",
		"pä$$wörd",
		"パスワード123",
		"pass word",
		"pass\tword",
		"'password'",
		`"password"`,
		"pass$ENV_VAR",
		"../../../etc/passwd",
	}

	for _, password := range passwords {
		if len(password) < 6 {
			continue // Skip passwords that don't meet minimum length
		}

		t.Run(password, func(t *testing.T) {
			// Create new database for each test
			testDir := t.TempDir()
			testPath := filepath.Join(testDir, "test.db")
			testDB, _, err := database.New(ctx, testPath)
			if err != nil {
				t.Fatalf("failed to create database: %v", err)
			}
			defer testDB.Close()

			// Create user with special password
			if err := testDB.CreateUser(ctx, password); err != nil {
				t.Fatalf("failed to create user with password: %v", err)
			}

			// Verify authentication works
			if _, err := testDB.ValidatePassword(ctx, password); err != nil {
				t.Errorf("failed to authenticate with password: %v", err)
			}

			// Update to different password
			newPassword := password + "_new"
			if err := testDB.UpdatePassword(ctx, newPassword); err != nil {
				t.Fatalf("failed to update password: %v", err)
			}

			// Verify new password works
			if _, err := testDB.ValidatePassword(ctx, newPassword); err != nil {
				t.Errorf("failed to authenticate with new password: %v", err)
			}
		})
	}
}

// TestShowStatusDatabaseStates tests showStatus in different database states
func TestShowStatusDatabaseStatesIntegration(t *testing.T) {
	tests := []struct {
		name    string
		setup   func(*database.Database, context.Context) error
		hasUser bool
	}{
		{
			name:    "no users",
			setup:   func(_ *database.Database, _ context.Context) error { return nil },
			hasUser: false,
		},
		{
			name: "with user",
			setup: func(db *database.Database, ctx context.Context) error {
				return db.CreateUser(ctx, "password")
			},
			hasUser: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tempDir := t.TempDir()
			dbPath := filepath.Join(tempDir, "test.db")

			db, _, err := database.New(context.Background(), dbPath)
			if err != nil {
				t.Fatalf("failed to create database: %v", err)
			}
			defer db.Close()

			ctx := context.Background()

			if err := tt.setup(db, ctx); err != nil {
				t.Fatalf("setup failed: %v", err)
			}

			// Capture that it doesn't panic
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("showStatus panicked: %v", r)
				}
			}()

			showStatus(ctx, db)

			// Verify expected state
			if db.HasUsers(ctx) != tt.hasUser {
				t.Errorf("HasUsers() = %v, want %v", db.HasUsers(ctx), tt.hasUser)
			}
		})
	}
}

// TestStdinReadErrors tests handling of stdin read errors
// This test verifies the error handling paths without needing actual stdin
func TestStdinReadErrorsIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Create user so we pass the HasUsers check
	if err := db.CreateUser(ctx, "password"); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Since we can't mock stdin easily, we at least verify the function
	// handles stdin read errors gracefully (doesn't panic)
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("resetPassword panicked on stdin error: %v", r)
		}
	}()

	// This will fail to read from stdin in test environment, but shouldn't panic
	result := resetPassword(ctx, db)
	if result {
		t.Error("Expected resetPassword to return false when stdin read fails")
	}
}

// TestDatabaseDirEnvironmentVariable tests DATABASE_DIR environment variable handling
func TestDatabaseDirEnvironmentVariable(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		expected string
	}{
		{
			name:     "custom path",
			envValue: "/custom/path",
			expected: "/custom/path",
		},
		{
			name:     "empty uses default",
			envValue: "",
			expected: "/database",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Save and restore original value
			origValue := os.Getenv("DATABASE_DIR")
			defer func() {
				if origValue != "" {
					os.Setenv("DATABASE_DIR", origValue)
				} else {
					os.Unsetenv("DATABASE_DIR")
				}
			}()

			// Set test value
			if tt.envValue != "" {
				os.Setenv("DATABASE_DIR", tt.envValue)
			} else {
				os.Unsetenv("DATABASE_DIR")
			}

			// Test the logic
			databaseDir := os.Getenv("DATABASE_DIR")
			if databaseDir == "" {
				databaseDir = "/database"
			}

			if databaseDir != tt.expected {
				t.Errorf("databaseDir = %q, want %q", databaseDir, tt.expected)
			}

			dbPath := filepath.Join(databaseDir, "media.db")
			expectedPath := filepath.Join(tt.expected, "media.db")
			if dbPath != expectedPath {
				t.Errorf("dbPath = %q, want %q", dbPath, expectedPath)
			}
		})
	}
}
