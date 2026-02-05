// Command resetpw provides a CLI utility for password management in the
// media viewer application.
//
// It supports the following operations:
//   - reset: Reset the user's password (requires existing password setup)
//   - status: Check if a password is configured
//
// Usage:
//
//	resetpw <command>
//
// Commands:
//
//	reset   Reset the password for the configured user account.
//	        This requires that a password has already been set up via
//	        the web interface. All existing sessions will be invalidated.
//
//	status  Display whether a password is configured. If no password
//	        exists, initial setup must be done via the web interface.
//
// Environment:
//
//	DATABASE_DIR - Path to database directory (default: /database)
//
// Notes:
//
// The media viewer application uses a single-user authentication model.
// Initial password setup must be performed through the web interface.
// This utility is only for resetting an existing password or checking
// configuration status.
package main
