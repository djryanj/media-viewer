// Package database provides SQLite database operations for the media viewer
// application.
//
// It handles storage and retrieval of:
//   - Media file metadata (images, videos, folders, playlists)
//   - User accounts and authentication sessions
//   - Favorites and tags
//   - Full-text search indexing
//   - Application metadata and configuration state
//
// # Database Configuration
//
// The database uses SQLite with the following optimizations:
//   - WAL (Write-Ahead Logging) mode for improved concurrent read performance
//   - Synchronous mode set to NORMAL for balanced durability and performance
//   - In-memory temp store for faster temporary table operations
//   - 10MB cache size for improved query performance
//   - 5 second busy timeout to prevent lock contention errors
//
// # Schema
//
// The database automatically initializes the following tables:
//   - files: Media file metadata with full-text search via FTS5
//   - favorites: User-favorited files and folders
//   - tags: Labels that can be applied to media files
//   - file_tags: Many-to-many relationship between files and tags
//   - users: Single-user authentication (password only)
//   - sessions: Authentication session tokens with expiration
//   - metadata: Key-value store for application state
//
// # Concurrency
//
// The Database type is safe for concurrent use. It uses a read-write mutex
// to allow multiple concurrent readers while ensuring exclusive write access.
// Batch operations use explicit transactions for atomicity and performance.
//
// # Full-Text Search
//
// Media files are indexed using SQLite FTS5 with trigram tokenization,
// enabling fast substring and fuzzy matching on file names and paths.
// The FTS index is automatically maintained via triggers on the files table.
//
// # Authentication
//
// The package provides single-user authentication with:
//   - Bcrypt password hashing
//   - SHA-256 hashed session tokens
//   - Configurable session duration (default 7 days)
//   - Automatic expired session cleanup
//   - Active session count metrics
//
// # Metrics
//
// Database operations are instrumented with Prometheus metrics:
//   - Query counts and durations by operation type
//   - Open connection count
//   - Database file sizes (main, WAL, SHM)
//   - Active session count
//
// # Example Usage
//
//	db, err := database.New("/path/to/media.db")
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer db.Close()
//
//	// List directory contents
//	listing, err := db.ListDirectory(ctx, database.ListOptions{
//	    Path:      "photos/2024",
//	    SortField: database.SortByDate,
//	    SortOrder: database.SortDesc,
//	    Page:      1,
//	    PageSize:  50,
//	})
//
//	// Search for files
//	results, err := db.Search(ctx, database.SearchOptions{
//	    Query: "vacation",
//	    Page:  1,
//	})
//
//	// Batch operations with transactions
//	tx, err := db.BeginBatch()
//	if err != nil {
//	    return err
//	}
//	for _, file := range files {
//	    db.UpsertFile(tx, &file)
//	}
//	err = db.EndBatch(tx, nil)
package database
