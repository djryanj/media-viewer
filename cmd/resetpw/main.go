package main

import (
	"bufio"
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

	// Get cache directory from env or default
	cacheDir := os.Getenv("CACHE_DIR")
	if cacheDir == "" {
		cacheDir = "/cache"
	}

	// Initialize database
	db, err := database.New(cacheDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to connect to database: %v\n", err)
		fmt.Fprintf(os.Stderr, "Make sure CACHE_DIR is set correctly (current: %s)\n", cacheDir)
		os.Exit(1)
	}
	defer db.Close()

	switch command {
	case "reset":
		resetPassword(db)
	case "create":
		createUser(db)
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
	fmt.Println("Usage: resetpw <command>")
	fmt.Println("")
	fmt.Println("Commands:")
	fmt.Println("  reset   - Reset a user's password")
	fmt.Println("  create  - Create a new user")
	fmt.Println("  list    - List all users")
	fmt.Println("  delete  - Delete a user")
	fmt.Println("")
	fmt.Println("Environment:")
	fmt.Println("  CACHE_DIR - Path to cache directory (default: /cache)")
}

func resetPassword(db *database.Database) {
	reader := bufio.NewReader(os.Stdin)

	fmt.Print("Username: ")
	username, _ := reader.ReadString('\n')
	username = strings.TrimSpace(username)

	if username == "" {
		fmt.Fprintln(os.Stderr, "Error: Username cannot be empty")
		os.Exit(1)
	}

	// Check if user exists
	_, err := db.GetUserByUsername(username)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: User '%s' not found\n", username)
		os.Exit(1)
	}

	fmt.Print("New Password: ")
	password, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading password: %v\n", err)
		os.Exit(1)
	}

	fmt.Print("Confirm Password: ")
	confirm, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading password: %v\n", err)
		os.Exit(1)
	}

	if string(password) != string(confirm) {
		fmt.Fprintln(os.Stderr, "Error: Passwords do not match")
		os.Exit(1)
	}

	if len(password) < 6 {
		fmt.Fprintln(os.Stderr, "Error: Password must be at least 6 characters")
		os.Exit(1)
	}

	if err := db.UpdatePassword(username, string(password)); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to update password: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Password updated successfully for user '%s'\n", username)
	fmt.Println("All existing sessions have been invalidated.")
}

func createUser(db *database.Database) {
	reader := bufio.NewReader(os.Stdin)

	fmt.Print("Username: ")
	username, _ := reader.ReadString('\n')
	username = strings.TrimSpace(username)

	if len(username) < 3 {
		fmt.Fprintln(os.Stderr, "Error: Username must be at least 3 characters")
		os.Exit(1)
	}

	fmt.Print("Password: ")
	password, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading password: %v\n", err)
		os.Exit(1)
	}

	fmt.Print("Confirm Password: ")
	confirm, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading password: %v\n", err)
		os.Exit(1)
	}

	if string(password) != string(confirm) {
		fmt.Fprintln(os.Stderr, "Error: Passwords do not match")
		os.Exit(1)
	}

	if len(password) < 6 {
		fmt.Fprintln(os.Stderr, "Error: Password must be at least 6 characters")
		os.Exit(1)
	}

	if err := db.CreateUser(username, string(password)); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to create user: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("User '%s' created successfully\n", username)
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
		os.Exit(1)
	}

	fmt.Printf("Are you sure you want to delete user '%s'? (yes/no): ", username)
	confirm, _ := reader.ReadString('\n')
	confirm = strings.TrimSpace(strings.ToLower(confirm))

	if confirm != "yes" {
		fmt.Println("Cancelled.")
		return
	}

	// Note: You'll need to add a DeleteUser method to the database
	fmt.Println("User deletion not yet implemented.")
	fmt.Println("You can manually delete from the database:")
	fmt.Printf("  sqlite3 %s \"DELETE FROM users WHERE username='%s'\"\n",
		filepath.Join(os.Getenv("CACHE_DIR"), "media.db"), username)
}
