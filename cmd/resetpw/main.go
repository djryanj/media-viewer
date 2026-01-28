package main

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"media-viewer/internal/database"

	"golang.org/x/term"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	command := os.Args[1]

	// Get database directory from env or default
	databaseDir := os.Getenv("DATABASE_DIR")
	if databaseDir == "" {
		databaseDir = "/database"
	}
	dbPath := filepath.Join(databaseDir, "media.db")

	// Initialize database
	db, err := database.New(dbPath)
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
		if !resetPassword(db) {
			os.Exit(1)
		}
	case "create":
		if !createUser(db) {
			os.Exit(1)
		}
	case "list":
		listUsers(db)
	case "delete":
		deleteUser(db)
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", command)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("Media Viewer User Management")
	fmt.Println("")
	fmt.Println("Usage: usermgmt <command>")
	fmt.Println("")
	fmt.Println("Commands:")
	fmt.Println("  reset   - Reset a user's password")
	fmt.Println("  create  - Create a new user")
	fmt.Println("  list    - List all users")
	fmt.Println("  delete  - Delete a user")
	fmt.Println("")
	fmt.Println("Environment:")
	fmt.Println("  DATABASE_DIR - Path to database directory (default: /database)")
}

func resetPassword(db *database.Database) bool {
	reader := bufio.NewReader(os.Stdin)

	fmt.Print("Username: ")
	username, _ := reader.ReadString('\n')
	username = strings.TrimSpace(username)

	if username == "" {
		fmt.Fprintln(os.Stderr, "Error: Username cannot be empty")
		return false
	}

	// Check if user exists
	_, err := db.GetUserByUsername(username)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: User '%s' not found\n", username)
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

	if err := db.UpdatePassword(username, string(password)); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to update password: %v\n", err)
		return false
	}

	fmt.Printf("Password updated successfully for user '%s'\n", username)
	fmt.Println("All existing sessions have been invalidated.")
	return true
}

func createUser(db *database.Database) bool {
	reader := bufio.NewReader(os.Stdin)

	fmt.Print("Username: ")
	username, _ := reader.ReadString('\n')
	username = strings.TrimSpace(username)

	if len(username) < 3 {
		fmt.Fprintln(os.Stderr, "Error: Username must be at least 3 characters")
		return false
	}

	fmt.Print("Password: ")
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

	if err := db.CreateUser(username, string(password)); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to create user: %v\n", err)
		return false
	}

	fmt.Printf("User '%s' created successfully\n", username)
	return true
}

func listUsers(db *database.Database) {
	// This is a simple implementation - you might want to add a ListUsers method to the database
	if !db.HasUsers() {
		fmt.Println("No users found.")
		return
	}

	fmt.Println("Users:")
	fmt.Println("  (Use 'reset' command to see specific user details)")
}

func deleteUser(db *database.Database) {
	reader := bufio.NewReader(os.Stdin)

	fmt.Print("Username to delete: ")
	username, _ := reader.ReadString('\n')
	username = strings.TrimSpace(username)

	if username == "" {
		fmt.Fprintln(os.Stderr, "Error: Username cannot be empty")
		return
	}

	// Verify user exists
	_, err := db.GetUserByUsername(username)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: User '%s' not found\n", username)
		return
	}

	fmt.Printf("Are you sure you want to delete user '%s'? (yes/no): ", username)
	confirm, _ := reader.ReadString('\n')
	confirm = strings.TrimSpace(strings.ToLower(confirm))

	if confirm != "yes" {
		fmt.Println("Canceled.")
		return
	}

	if err := db.DeleteUser(username); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to delete user: %v\n", err)
		return
	}

	fmt.Printf("User '%s' deleted successfully\n", username)
}
