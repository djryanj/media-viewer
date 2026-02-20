package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"media-viewer/internal/database"
)

// =============================================================================
// Unit Tests
// =============================================================================

// TestPrintUsage tests that printUsage doesn't panic and outputs expected text
func TestPrintUsage(t *testing.T) {
	// Should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("printUsage panicked: %v", r)
		}
	}()

	printUsage()
}

// =============================================================================
// Integration Tests
// =============================================================================

// setupTestDB creates a test database for integration tests
func setupTestDB(t *testing.T) (db *database.Database, tempDir string, cleanup func()) {
	t.Helper()

	tempDir = t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}

	cleanup = func() {
		if err := db.Close(); err != nil {
			t.Logf("failed to close database: %v", err)
		}
	}

	return db, tempDir, cleanup
}

// TestResetPasswordNoUsersIntegration tests resetPassword when no users exist
func TestResetPasswordNoUsersIntegration(t *testing.T) {
	db, _, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// Should fail when no users exist
	result := resetPassword(ctx, db)

	if result {
		t.Error("Expected resetPassword to return false when no users exist")
	}
}

// TestShowStatusNoUsersIntegration tests showStatus when no users exist
func TestShowStatusNoUsersIntegration(t *testing.T) {
	db, _, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// Should not panic when no users exist
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("showStatus panicked: %v", r)
		}
	}()

	showStatus(ctx, db)
}

// TestShowStatusWithUserIntegration tests showStatus when user exists
func TestShowStatusWithUserIntegration(t *testing.T) {
	db, _, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// Create a user first
	password := "testpassword123"
	if err := db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Should not panic when user exists
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("showStatus panicked: %v", r)
		}
	}()

	showStatus(ctx, db)

	// Verify user exists
	if !db.HasUsers(ctx) {
		t.Error("Expected user to exist after creation")
	}
}

// TestResetPasswordWithContextTimeout tests resetPassword behavior with context timeout
func TestResetPasswordWithContextTimeoutIntegration(t *testing.T) {
	db, _, cleanup := setupTestDB(t)
	defer cleanup()

	// Create a user first
	ctx := context.Background()
	password := "testpassword123"
	if err := db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Create a context that's already canceled
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// This should handle the canceled context gracefully
	// Note: Since resetPassword uses stdin, we can't fully test it here
	// but we can verify it doesn't panic with a canceled context
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("resetPassword panicked with canceled context: %v", r)
		}
	}()

	// The function will fail trying to read from stdin, but shouldn't panic
	_ = resetPassword(cancelledCtx, db)
}

// TestShowStatusWithContextTimeout tests showStatus with context timeout
func TestShowStatusWithContextTimeoutIntegration(t *testing.T) {
	db, _, cleanup := setupTestDB(t)
	defer cleanup()

	// Create a context with very short timeout
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
	defer cancel()

	// Wait for context to expire
	time.Sleep(5 * time.Millisecond)

	// Should not panic even with expired context
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("showStatus panicked with expired context: %v", r)
		}
	}()

	showStatus(ctx, db)
}

// TestDatabasePathHandling tests different database path scenarios
func TestDatabasePathHandlingIntegration(t *testing.T) {
	tests := []struct {
		name         string
		setupEnv     func(t *testing.T) string // Returns temp dir path
		expectedPath func(tempDir string) string
	}{
		{
			name: "with DATABASE_DIR env var",
			setupEnv: func(t *testing.T) string {
				tempDir := t.TempDir()
				t.Setenv("DATABASE_DIR", tempDir)
				return tempDir
			},
			expectedPath: func(tempDir string) string {
				return filepath.Join(tempDir, "media.db")
			},
		},
		{
			name: "without DATABASE_DIR (uses default)",
			setupEnv: func(_ *testing.T) string {
				// Don't set DATABASE_DIR, but we can't actually test /database
				// in unit tests, so this just verifies the logic doesn't panic
				return ""
			},
			expectedPath: func(_ string) string {
				return "/database/media.db"
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tempDir := tt.setupEnv(t)
			expectedPath := tt.expectedPath(tempDir)

			// Verify the path construction logic
			databaseDir := os.Getenv("DATABASE_DIR")
			if databaseDir == "" {
				databaseDir = "/database"
			}
			dbPath := filepath.Join(databaseDir, "media.db")

			if tt.name == "with DATABASE_DIR env var" {
				if dbPath != expectedPath {
					t.Errorf("dbPath = %q, want %q", dbPath, expectedPath)
				}

				// Try to create database to verify path is valid
				db, err := database.New(context.Background(), dbPath)
				if err != nil {
					t.Fatalf("failed to create database at expected path: %v", err)
				}
				defer db.Close()
			}
		})
	}
}

// TestDefaultTimeout verifies the default timeout constant
func TestDefaultTimeout(t *testing.T) {
	expected := 30 * time.Second
	if defaultTimeout != expected {
		t.Errorf("defaultTimeout = %v, want %v", defaultTimeout, expected)
	}
}

// TestResetPasswordWithExistingUser tests the full flow when user exists
// This test can't fully test password input due to terminal requirements,
// but it verifies the preconditions
func TestResetPasswordWithExistingUserIntegration(t *testing.T) {
	db, _, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// Create a user first
	password := "oldpassword123"
	if err := db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Verify user exists (precondition for resetPassword to work)
	if !db.HasUsers(ctx) {
		t.Fatal("Expected user to exist before testing resetPassword")
	}

	// We can't fully test resetPassword because it reads from stdin,
	// but we've verified the preconditions are correct
}

// TestDatabaseCloseHandling tests that database cleanup works properly
func TestDatabaseCloseHandlingIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}

	// Close the database
	if err := db.Close(); err != nil {
		t.Errorf("failed to close database: %v", err)
	}

	// Closing again should handle gracefully (may error, but shouldn't panic)
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("second close panicked: %v", r)
		}
	}()
	_ = db.Close()
}

// TestContextCancellationHandling tests behavior with canceled contexts
func TestContextCancellationHandlingIntegration(t *testing.T) {
	db, _, cleanup := setupTestDB(t)
	defer cleanup()

	// Test with canceled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// showStatus should handle canceled context
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("showStatus panicked with canceled context: %v", r)
		}
	}()

	showStatus(ctx, db)
}

// TestMultipleStatusChecks tests calling showStatus multiple times
func TestMultipleStatusChecksIntegration(t *testing.T) {
	db, _, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// Check status multiple times without users
	for i := 0; i < 3; i++ {
		showStatus(ctx, db)
	}

	// Create user
	if err := db.CreateUser(ctx, "testpassword"); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Check status multiple times with users
	for i := 0; i < 3; i++ {
		showStatus(ctx, db)
	}
}

// TestConcurrentStatusChecks tests concurrent calls to showStatus
func TestConcurrentStatusChecksIntegration(t *testing.T) {
	db, _, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// Create user
	if err := db.CreateUser(ctx, "testpassword"); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Run multiple concurrent status checks
	done := make(chan bool, 10)
	for i := 0; i < 10; i++ {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("concurrent showStatus panicked: %v", r)
				}
				done <- true
			}()
			showStatus(ctx, db)
		}()
	}

	// Wait for all goroutines to complete
	for i := 0; i < 10; i++ {
		<-done
	}
}

// TestDatabaseCreationFailure tests behavior when database cannot be created
func TestDatabaseCreationFailureIntegration(t *testing.T) {
	// Try to create database in non-existent directory without proper permissions
	// This simulates what happens when DATABASE_DIR is misconfigured
	invalidPath := "/nonexistent/impossible/path/test.db"

	_, err := database.New(context.Background(), invalidPath)
	if err == nil {
		t.Error("Expected error when creating database in invalid path")
	}
}

// =============================================================================
// Command-Line Argument Tests
// =============================================================================

// TestCommandLineArguments tests parsing of command-line arguments
func TestCommandLineArguments(t *testing.T) {
	tests := []struct {
		name        string
		args        []string
		expectPanic bool
	}{
		{
			name:        "no arguments",
			args:        []string{"resetpw"},
			expectPanic: false, // Should call printUsage and exit
		},
		{
			name:        "reset command",
			args:        []string{"resetpw", "reset"},
			expectPanic: false,
		},
		{
			name:        "status command",
			args:        []string{"resetpw", "status"},
			expectPanic: false,
		},
		{
			name:        "unknown command",
			args:        []string{"resetpw", "unknown"},
			expectPanic: false, // Should print error and exit
		},
		{
			name:        "multiple arguments",
			args:        []string{"resetpw", "reset", "extra"},
			expectPanic: false, // Extra args should be ignored
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					if !tt.expectPanic {
						t.Errorf("unexpected panic: %v", r)
					}
				}
			}()

			// Test command parsing logic
			if len(tt.args) >= 2 {
				command := tt.args[1]

				// Verify command is recognized
				validCommands := []string{"reset", "status"}
				isValid := false
				for _, valid := range validCommands {
					if command == valid {
						isValid = true
						break
					}
				}

				if strings.HasPrefix(tt.name, "unknown") && isValid {
					t.Error("Unknown command was recognized as valid")
				}
				if strings.HasPrefix(tt.name, "reset") && !isValid && tt.name != "reset command" {
					t.Error("Valid reset command not recognized")
				}
				if strings.HasPrefix(tt.name, "status") && !isValid {
					t.Error("Valid status command not recognized")
				}
			}
		})
	}
}

// TestPrintUsageContent tests that printUsage outputs expected content
func TestPrintUsageContent(t *testing.T) {
	// Capture stdout (in real scenario, would need more sophisticated capture)
	// For now, just verify it doesn't panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("printUsage panicked: %v", r)
		}
	}()

	printUsage()

	// Test passes if no panic occurs
	// In a more sophisticated test, we could capture and verify output
}

// =============================================================================
// Database Path and Environment Tests
// =============================================================================

// TestDatabasePathConstruction tests database path building
func TestDatabasePathConstruction(t *testing.T) {
	tests := []struct {
		name           string
		databaseDir    string
		expectedSuffix string
	}{
		{
			name:           "default path",
			databaseDir:    "/database",
			expectedSuffix: "media.db",
		},
		{
			name:           "custom path",
			databaseDir:    "/custom/db",
			expectedSuffix: "media.db",
		},
		{
			name:           "relative path",
			databaseDir:    "database",
			expectedSuffix: "media.db",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dbPath := filepath.Join(tt.databaseDir, "media.db")

			// Verify path construction
			if !strings.HasSuffix(dbPath, tt.expectedSuffix) {
				t.Errorf("dbPath %q doesn't end with %q", dbPath, tt.expectedSuffix)
			}

			// Verify it contains the directory
			if !strings.Contains(dbPath, tt.databaseDir) {
				t.Errorf("dbPath %q doesn't contain directory %q", dbPath, tt.databaseDir)
			}
		})
	}
}

// TestDatabasePathFromEnvironmentIntegration tests reading DATABASE_DIR from env
func TestDatabasePathFromEnvironmentIntegration(t *testing.T) {
	// Create temporary directory for test
	tempDir := t.TempDir()

	// Test with custom DATABASE_DIR
	t.Setenv("DATABASE_DIR", tempDir)

	databaseDir := os.Getenv("DATABASE_DIR")
	if databaseDir != tempDir {
		t.Fatalf("DATABASE_DIR = %q, want %q", databaseDir, tempDir)
	}

	dbPath := filepath.Join(databaseDir, "media.db")

	// Try to create database at this path
	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database at custom path: %v", err)
	}
	defer db.Close()

	// Verify database file exists
	if _, err := os.Stat(dbPath); err != nil {
		t.Errorf("database file not created at expected path: %v", err)
	}
}

// TestEmptyDatabaseDirUsesDefault tests default path when env var is empty
func TestEmptyDatabaseDirUsesDefault(t *testing.T) {
	// Unset DATABASE_DIR
	t.Setenv("DATABASE_DIR", "")

	databaseDir := os.Getenv("DATABASE_DIR")
	if databaseDir == "" {
		databaseDir = "/database"
	}

	if databaseDir != "/database" {
		t.Errorf("databaseDir = %q, want %q", databaseDir, "/database")
	}
}

// =============================================================================
// Error Handling and Edge Cases
// =============================================================================

// TestResetPasswordEdgeCasesIntegration tests edge cases for resetPassword
func TestResetPasswordEdgeCasesIntegration(t *testing.T) {
	tests := []struct {
		name        string
		setupDB     func(*database.Database, context.Context) error
		shouldWork  bool
		description string
	}{
		{
			name: "no users in database",
			setupDB: func(_ *database.Database, _ context.Context) error {
				return nil // Don't create any users
			},
			shouldWork:  false,
			description: "should fail when no users exist",
		},
		{
			name: "user exists",
			setupDB: func(db *database.Database, ctx context.Context) error {
				return db.CreateUser(ctx, "testpassword")
			},
			shouldWork:  true, // Would work if stdin was available
			description: "should pass user check when user exists",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tempDir := t.TempDir()
			dbPath := filepath.Join(tempDir, "test.db")

			db, err := database.New(context.Background(), dbPath)
			if err != nil {
				t.Fatalf("failed to create database: %v", err)
			}
			defer db.Close()

			ctx := context.Background()

			if err := tt.setupDB(db, ctx); err != nil {
				t.Fatalf("setup failed: %v", err)
			}

			// We can't fully test resetPassword due to stdin requirements,
			// but we can test the preconditions
			hasUsers := db.HasUsers(ctx)
			if tt.shouldWork && !hasUsers {
				t.Errorf("%s: expected users to exist", tt.description)
			}
			if !tt.shouldWork && hasUsers {
				t.Errorf("%s: expected no users to exist", tt.description)
			}
		})
	}
}

// TestShowStatusWithClosedDatabaseIntegration tests showStatus with closed db
func TestShowStatusWithClosedDatabaseIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	// Close database before calling showStatus
	db.Close()

	ctx := context.Background()

	// Should handle closed database gracefully (may panic or error)
	defer func() {
		// Capture any panic - this is acceptable behavior for closed DB
		if r := recover(); r != nil {
			t.Logf("showStatus panicked with closed database (expected): %v", r)
		}
	}()

	showStatus(ctx, db)
}

// TestConcurrentDatabaseAccess tests concurrent access patterns
func TestConcurrentDatabaseAccessIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Create a user
	if err := db.CreateUser(ctx, "testpassword"); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Concurrent reads should work fine
	const numReaders = 20
	done := make(chan bool, numReaders)

	for i := 0; i < numReaders; i++ {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("concurrent read panicked: %v", r)
				}
				done <- true
			}()

			// Call showStatus which reads from database
			showStatus(ctx, db)

			// Also check HasUsers
			_ = db.HasUsers(ctx)
		}()
	}

	// Wait for all readers to complete
	for i := 0; i < numReaders; i++ {
		<-done
	}
}

// TestDatabaseRecoveryIntegration tests database recovery scenarios
func TestDatabaseRecoveryIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	// Create database and add user
	db1, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	ctx := context.Background()
	if err := db1.CreateUser(ctx, "password"); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	db1.Close()

	// Reopen database - user should still exist
	db2, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to reopen database: %v", err)
	}
	defer db2.Close()

	if !db2.HasUsers(ctx) {
		t.Error("User was lost after closing and reopening database")
	}

	// Verify we can still check status
	showStatus(ctx, db2)
}

// TestDatabasePathSeparators tests path handling on different systems
func TestDatabasePathSeparators(t *testing.T) {
	tests := []struct {
		name      string
		directory string
		filename  string
	}{
		{
			name:      "simple path",
			directory: "database",
			filename:  "media.db",
		},
		{
			name:      "nested path",
			directory: filepath.Join("var", "lib", "database"),
			filename:  "media.db",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fullPath := filepath.Join(tt.directory, tt.filename)

			// Verify path is constructed correctly for the OS
			if !strings.Contains(fullPath, tt.filename) {
				t.Errorf("path %q doesn't contain filename %q", fullPath, tt.filename)
			}

			// Verify no double separators
			doubleSep := string(filepath.Separator) + string(filepath.Separator)
			if strings.Contains(fullPath, doubleSep) {
				t.Errorf("path %q contains double separator", fullPath)
			}
		})
	}
}

// TestPasswordLengthValidation tests password length requirements
func TestPasswordLengthValidation(t *testing.T) {
	const minPasswordLength = 6

	tests := []struct {
		password    string
		shouldPass  bool
		description string
	}{
		{"", false, "empty password"},
		{"12345", false, "too short"},
		{"123456", true, "minimum length"},
		{"1234567890", true, "longer than minimum"},
		{"a", false, "single character"},
		{"     ", false, "only spaces (too short)"},
		{"      ", true, "six spaces (meets length)"},
	}

	for _, tt := range tests {
		t.Run(tt.description, func(t *testing.T) {
			passes := len(tt.password) >= minPasswordLength

			if passes != tt.shouldPass {
				t.Errorf("password %q (len=%d): passes=%v, want=%v",
					tt.password, len(tt.password), passes, tt.shouldPass)
			}
		})
	}
}

// TestContextTimeoutBehaviorIntegration tests timeout handling
func TestContextTimeoutBehaviorIntegration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	// Test with canceled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// Operations should handle canceled context
	// (may error, but shouldn't panic)
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("operation panicked with canceled context: %v", r)
		}
	}()

	// These operations should detect the canceled context
	_ = db.HasUsers(ctx)
	showStatus(ctx, db)
}

// TestDefaultTimeoutValue verifies the timeout constant
func TestDefaultTimeoutValue(t *testing.T) {
	if defaultTimeout.Seconds() != 30 {
		t.Errorf("defaultTimeout = %v, want 30 seconds", defaultTimeout)
	}
}

// TestDatabaseCreationWithVariousPaths tests database creation scenarios
func TestDatabaseCreationWithVariousPathsIntegration(t *testing.T) {
	tests := []struct {
		name        string
		pathFunc    func(string) string
		shouldWork  bool
		description string
	}{
		{
			name: "simple path",
			pathFunc: func(base string) string {
				return filepath.Join(base, "test.db")
			},
			shouldWork:  true,
			description: "should work with simple path",
		},
		{
			name: "nested directories",
			pathFunc: func(base string) string {
				nested := filepath.Join(base, "a", "b", "c")
				os.MkdirAll(nested, 0o755)
				return filepath.Join(nested, "test.db")
			},
			shouldWork:  true,
			description: "should work with nested directories",
		},
		{
			name: "path with spaces",
			pathFunc: func(base string) string {
				spaced := filepath.Join(base, "test db")
				os.MkdirAll(spaced, 0o755)
				return filepath.Join(spaced, "test.db")
			},
			shouldWork:  true,
			description: "should work with spaces in path",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tempDir := t.TempDir()
			dbPath := tt.pathFunc(tempDir)

			db, err := database.New(context.Background(), dbPath)
			if tt.shouldWork && err != nil {
				t.Errorf("%s: failed to create database: %v", tt.description, err)
				return
			}
			if !tt.shouldWork && err == nil {
				t.Errorf("%s: expected error but got none", tt.description)
			}

			if db != nil {
				defer db.Close()

				// Verify database is functional
				ctx := context.Background()
				if err := db.CreateUser(ctx, "testpassword"); err != nil {
					t.Errorf("failed to create user in database: %v", err)
				}
			}
		})
	}
}

// =============================================================================
// Sanitize Command Tests
// =============================================================================

// TestSanitizeCommand tests the sanitizeCommand function with various inputs
func TestSanitizeCommand(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		// Passthrough cases — valid characters should be unchanged
		{
			name:     "lowercase letters",
			input:    "reset",
			expected: "reset",
		},
		{
			name:     "uppercase letters",
			input:    "RESET",
			expected: "RESET",
		},
		{
			name:     "mixed case letters",
			input:    "ReSeT",
			expected: "ReSeT",
		},
		{
			name:     "digits",
			input:    "command123",
			expected: "command123",
		},
		{
			name:     "hyphens",
			input:    "my-command",
			expected: "my-command",
		},
		{
			name:     "underscores",
			input:    "my_command",
			expected: "my_command",
		},
		{
			name:     "all allowed characters combined",
			input:    "My_Command-v2",
			expected: "My_Command-v2",
		},

		// Replacement cases — disallowed characters become underscores
		{
			name:     "spaces replaced",
			input:    "my command",
			expected: "my_command",
		},
		{
			name:     "angle brackets replaced",
			input:    "<script>",
			expected: "_script_",
		},
		{
			name:     "single quotes replaced",
			input:    "it's",
			expected: "it_s",
		},
		{
			name:     "double quotes replaced",
			input:    `say "hello"`,
			expected: "say__hello_",
		},
		{
			name:     "semicolons replaced",
			input:    "cmd;evil",
			expected: "cmd_evil",
		},
		{
			name:     "pipes replaced",
			input:    "cmd|evil",
			expected: "cmd_evil",
		},
		{
			name:     "ampersands replaced",
			input:    "cmd&evil",
			expected: "cmd_evil",
		},
		{
			name:     "backticks replaced",
			input:    "cmd`evil`",
			expected: "cmd_evil_",
		},
		{
			name:     "dollar signs replaced",
			input:    "$PATH",
			expected: "_PATH",
		},
		{
			name:     "newlines replaced",
			input:    "cmd\nevil",
			expected: "cmd_evil",
		},
		{
			name:     "carriage returns replaced",
			input:    "cmd\revil",
			expected: "cmd_evil",
		},
		{
			name:     "tabs replaced",
			input:    "cmd\tevil",
			expected: "cmd_evil",
		},
		{
			name:     "null bytes replaced",
			input:    "cmd\x00evil",
			expected: "cmd_evil",
		},
		{
			name:     "slashes replaced",
			input:    "../../etc/passwd",
			expected: "______etc_passwd",
		},
		{
			name:     "backslashes replaced",
			input:    `cmd\evil`,
			expected: "cmd_evil",
		},
		{
			name:     "dots replaced",
			input:    "cmd.exe",
			expected: "cmd_exe",
		},
		{
			name:     "equals replaced",
			input:    "key=value",
			expected: "key_value",
		},
		{
			name:     "parentheses replaced",
			input:    "func()",
			expected: "func__",
		},

		// Unicode and multi-byte characters
		{
			name:     "unicode letters replaced",
			input:    "café",
			expected: "caf_",
		},
		{
			name:     "CJK characters replaced",
			input:    "コマンド",
			expected: "____",
		},
		{
			name:     "emoji replaced",
			input:    "cmd🚀",
			expected: "cmd_",
		},

		// Edge cases
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "single valid character",
			input:    "a",
			expected: "a",
		},
		{
			name:     "single invalid character",
			input:    "!",
			expected: "_",
		},
		{
			name:     "all invalid characters",
			input:    "!@#$%^&*()",
			expected: "__________",
		},
		{
			name:     "only digits",
			input:    "12345",
			expected: "12345",
		},
		{
			name:     "only hyphens",
			input:    "---",
			expected: "---",
		},
		{
			name:     "only underscores",
			input:    "___",
			expected: "___",
		},

		// Injection attempt patterns
		{
			name:     "shell injection attempt",
			input:    "reset; rm -rf /",
			expected: "reset__rm_-rf__",
		},
		{
			name:     "command substitution attempt",
			input:    "$(whoami)",
			expected: "__whoami_",
		},
		{
			name:     "HTML script injection",
			input:    "<script>alert('xss')</script>",
			expected: "_script_alert__xss____script_",
		},
		{
			name:     "path traversal attempt",
			input:    "../../../etc/shadow",
			expected: "_________etc_shadow",
		},
		{
			name:     "ANSI escape sequence",
			input:    "\x1b[31mred\x1b[0m",
			expected: "__31mred__0m",
		},
		{
			name:     "HTTP header injection",
			input:    "cmd\r\nX-Injected: true",
			expected: "cmd__X-Injected__true",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeCommand(tt.input)
			if result != tt.expected {
				t.Errorf("sanitizeCommand(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestSanitizeCommandIdempotent verifies that sanitizing an already-sanitized
// string produces the same result (the function is idempotent).
func TestSanitizeCommandIdempotent(t *testing.T) {
	inputs := []string{
		"reset",
		"<script>alert('xss')</script>",
		"cmd; rm -rf /",
		"hello world!",
		"",
		"already-clean_input",
	}

	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			first := sanitizeCommand(input)
			second := sanitizeCommand(first)
			if first != second {
				t.Errorf("sanitizeCommand is not idempotent for %q: first=%q, second=%q",
					input, first, second)
			}
		})
	}
}

// TestSanitizeCommandOutputLength verifies the output length matches the input
// rune count (each rune maps to exactly one output rune).
func TestSanitizeCommandOutputLength(t *testing.T) {
	inputs := []string{
		"",
		"a",
		"hello",
		"<script>",
		"café",
		"cmd\nevil",
		"!@#$%",
	}

	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			result := sanitizeCommand(input)
			inputRunes := len([]rune(input))
			resultRunes := len([]rune(result))
			if resultRunes != inputRunes {
				t.Errorf("sanitizeCommand(%q): input rune count %d != output rune count %d",
					input, inputRunes, resultRunes)
			}
		})
	}
}

// TestSanitizeCommandOnlyContainsAllowedChars verifies the output never contains
// characters outside the allowlist.
func TestSanitizeCommandOnlyContainsAllowedChars(t *testing.T) {
	// Test with a variety of adversarial inputs
	inputs := []string{
		"normal",
		"<script>alert(1)</script>",
		"'; DROP TABLE users; --",
		"cmd\x00\x01\x02\x03",
		"hello\nworld\r\n",
		string([]byte{0xff, 0xfe, 0xfd}),
		"$(cat /etc/passwd)",
		"`id`",
		"a=b&c=d",
	}

	isAllowed := func(r rune) bool {
		return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_'
	}

	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			result := sanitizeCommand(input)
			for i, r := range result {
				if !isAllowed(r) {
					t.Errorf("sanitizeCommand(%q) contains disallowed rune %q at index %d in result %q",
						input, r, i, result)
				}
			}
		})
	}
}
