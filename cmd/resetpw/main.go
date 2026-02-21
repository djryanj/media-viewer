package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"media-viewer/internal/database"

	"golang.org/x/term"
)

const (
	// Default timeout for database operations
	defaultTimeout = 30 * time.Second
	// Default database directory path
	defaultDatabaseDir = "/database"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	command := os.Args[1]

	// Create a context that cancels on interrupt signals
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle interrupt signals for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		fmt.Fprintln(os.Stderr, "\nInterrupted, shutting down...")
		cancel()
	}()

	// Get database directory from env or default
	databaseDir := os.Getenv("DATABASE_DIR")
	if databaseDir == "" {
		databaseDir = defaultDatabaseDir
	}
	dbPath := filepath.Join(databaseDir, "media.db")

	// Initialize database
	dbOpts := &database.Options{
		MmapDisabled: false, // Set to true if you want to disable mmap
	}
	db, _, err := database.New(ctx, dbPath, dbOpts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to connect to database: %v\n", err)
		fmt.Fprintf(os.Stderr, "Make sure DATABASE_DIR is set correctly (current: %s)\n", databaseDir)
		os.Exit(1)
	}
	defer func() {
		if err := db.Close(); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to close database: %v\n", err)
		}
	}()

	switch command {
	case "reset":
		if !resetPassword(ctx, db) {
			os.Exit(1)
		}
	case "status":
		showStatus(ctx, db)
	default:
		// Sanitize command input using allowlist to break taint chain
		sanitized := sanitizeCommand(command)
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", sanitized) //nolint:gosec // G705 - input is sanitized via allowlist in sanitizeCommand; only [a-zA-Z0-9_-] characters pass through
		printUsage()
		os.Exit(1)
	}
}

// sanitizeCommand returns a safe representation of a command string for display.
// It uses an allowlist approach, replacing any character that is not alphanumeric,
// a hyphen, or an underscore with '_'.
func sanitizeCommand(cmd string) string {
	var b strings.Builder
	b.Grow(len(cmd))
	for _, r := range cmd {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	return b.String()
}

func printUsage() {
	fmt.Println("Media Viewer Password Management")
	fmt.Println("")
	fmt.Println("Usage: resetpw <command>")
	fmt.Println("")
	fmt.Println("Commands:")
	fmt.Println("  reset   - Reset the password")
	fmt.Println("  status  - Check if password is configured")
	fmt.Println("")
	fmt.Println("Environment:")
	fmt.Printf("  DATABASE_DIR - Path to database directory (default: %s)\n", defaultDatabaseDir)
}

func resetPassword(ctx context.Context, db *database.Database) bool {
	// Add timeout to context for database operations
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Check if user exists
	if !db.HasUsers(ctx) {
		fmt.Fprintln(os.Stderr, "Error: No password configured yet. Use the web interface to set up.")
		return false
	}

	fmt.Print("New Password: ")
	password, err := term.ReadPassword(syscall.Stdin)
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading password: %v\n", err)
		return false
	}

	fmt.Print("Confirm Password: ")
	confirm, err := term.ReadPassword(syscall.Stdin)
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading password: %v\n", err)
		return false
	}

	if !bytes.Equal(password, confirm) {
		fmt.Fprintln(os.Stderr, "Error: Passwords do not match")
		return false
	}

	if len(password) < 6 {
		fmt.Fprintln(os.Stderr, "Error: Password must be at least 6 characters")
		return false
	}

	if err := db.UpdatePassword(ctx, string(password)); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to update password: %v\n", err)
		return false
	}

	fmt.Println("Password updated successfully.")
	fmt.Println("All existing sessions have been invalidated.")
	return true
}

func showStatus(ctx context.Context, db *database.Database) {
	// Add timeout to context for database operations
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if db.HasUsers(ctx) {
		fmt.Println("Status: Password is configured")
	} else {
		fmt.Println("Status: No password configured (setup required)")
	}
}
