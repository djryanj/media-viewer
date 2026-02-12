package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3" // SQLite3 driver

	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

// Default timeout for database operations
const defaultTimeout = 5 * time.Second

// Database manages all database operations for the media viewer.
type Database struct {
	db      *sql.DB
	dbPath  string
	mu      sync.RWMutex
	stats   IndexStats
	statsMu sync.RWMutex
	txStart time.Time // Track transaction start time for metrics
}

// New creates a new Database instance.
// IMPORTANT: dbPath should be the full path to the database FILE (e.g., "/database/media.db"),
// and the parent directory must already exist and be writable.
// Use startup.LoadConfig() to ensure proper directory validation before calling this.
func New(ctx context.Context, dbPath string) (*Database, error) {
	logging.Info("Database path: %s", dbPath)

	// Diagnose potential permission issues
	if err := diagnoseDatabasePermissions(dbPath); err != nil {
		logging.Warn("Database permission diagnostics: %v", err)
	}

	// Use WAL mode and other optimizations
	// busy_timeout helps prevent "database is locked" errors
	connStr := fmt.Sprintf("%s?_journal_mode=WAL&_synchronous=NORMAL&_cache_size=10000&_temp_store=MEMORY&_busy_timeout=5000", dbPath)

	db, err := sql.Open("sqlite3", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if err := db.PingContext(pingCtx); err != nil {
		if closeErr := db.Close(); closeErr != nil {
			logging.Error("failed to close database after ping failure: %v", closeErr)
		}
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Allow multiple readers - increased for better concurrency under load
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(time.Hour)

	d := &Database{
		db:     db,
		dbPath: dbPath,
	}

	if err := d.initialize(ctx); err != nil {
		if closeErr := db.Close(); closeErr != nil {
			logging.Error("failed to close database after initialization failure: %v", closeErr)
		}
		return nil, fmt.Errorf("failed to initialize database schema: %w", err)
	}

	logging.Info("Database initialized successfully at %s", dbPath)
	return d, nil
}

func (d *Database) initialize(ctx context.Context) error {
	schema := `
	-- Main files table
	CREATE TABLE IF NOT EXISTS files (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		path TEXT NOT NULL UNIQUE,
		parent_path TEXT NOT NULL,
		type TEXT NOT NULL,
		size INTEGER NOT NULL DEFAULT 0,
		mod_time INTEGER NOT NULL,
		mime_type TEXT,
		file_hash TEXT,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		content_updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);

	CREATE INDEX IF NOT EXISTS idx_files_parent_path ON files(parent_path);
	CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);
	CREATE INDEX IF NOT EXISTS idx_files_mod_time ON files(mod_time);
	CREATE INDEX IF NOT EXISTS idx_files_name ON files(name COLLATE NOCASE);

	-- Composite indexes for optimized queries
	CREATE INDEX IF NOT EXISTS idx_files_parent_type ON files(parent_path, type);
	CREATE INDEX IF NOT EXISTS idx_files_name_type ON files(name COLLATE NOCASE, type);

	-- Full-text search table
	CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
		name,
		path,
		content='files',
		content_rowid='id',
		tokenize='trigram'
	);

	CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
		INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
	END;

	CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
		INSERT INTO files_fts(files_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
	END;

	CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
		INSERT INTO files_fts(files_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
		INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
	END;

	-- Favorites table
	CREATE TABLE IF NOT EXISTS favorites (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		path TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);

	CREATE INDEX IF NOT EXISTS idx_favorites_path ON favorites(path);

	-- Tags table
	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE COLLATE NOCASE,
		color TEXT,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);

	CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name COLLATE NOCASE);

	-- File-Tag relationship table
	CREATE TABLE IF NOT EXISTS file_tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		file_path TEXT NOT NULL,
		tag_id INTEGER NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
		UNIQUE(file_path, tag_id)
	);

	CREATE INDEX IF NOT EXISTS idx_file_tags_path ON file_tags(file_path);
	CREATE INDEX IF NOT EXISTS idx_file_tags_tag ON file_tags(tag_id);

	-- Users table (single user, password only)
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		password_hash TEXT NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		setup_complete INTEGER NOT NULL DEFAULT 0
	);

	-- Sessions table
	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		token TEXT NOT NULL UNIQUE,
		expires_at INTEGER NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
	CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

	-- Metadata table
	CREATE TABLE IF NOT EXISTS metadata (
		key TEXT PRIMARY KEY,
		value TEXT
	);
	`

	_, err := d.db.ExecContext(ctx, schema)
	if err != nil {
		return err
	}

	// Run migrations
	return d.runMigrations(ctx)
}

// runMigrations applies database schema migrations
func (d *Database) runMigrations(ctx context.Context) error {
	// Migration 1: Add content_updated_at column if it doesn't exist
	// Check if the column exists
	var columnExists bool
	err := d.db.QueryRowContext(ctx, `
		SELECT COUNT(*) > 0
		FROM pragma_table_info('files')
		WHERE name='content_updated_at'
	`).Scan(&columnExists)

	if err != nil {
		return fmt.Errorf("failed to check for content_updated_at column: %w", err)
	}

	if !columnExists {
		logging.Info("Migrating database: adding content_updated_at column to files table")

		// Add the column with a simple default (SQLite doesn't allow expressions in ALTER TABLE ADD COLUMN DEFAULT)
		_, err = d.db.ExecContext(ctx, `
			ALTER TABLE files ADD COLUMN content_updated_at INTEGER NOT NULL DEFAULT 0
		`)
		if err != nil {
			return fmt.Errorf("failed to add content_updated_at column: %w", err)
		}

		// Initialize content_updated_at from updated_at for existing records
		_, err = d.db.ExecContext(ctx, `
			UPDATE files SET content_updated_at = updated_at
		`)
		if err != nil {
			return fmt.Errorf("failed to initialize content_updated_at values: %w", err)
		}

		logging.Info("Migration complete: content_updated_at column added and initialized")
	}

	// Migration 2: Add setup_complete column to users table if it doesn't exist
	var setupCompleteExists bool
	err = d.db.QueryRowContext(ctx, `
		SELECT COUNT(*) > 0
		FROM pragma_table_info('users')
		WHERE name='setup_complete'
	`).Scan(&setupCompleteExists)

	if err != nil {
		return fmt.Errorf("failed to check for setup_complete column: %w", err)
	}

	if !setupCompleteExists {
		logging.Info("Migrating database: adding setup_complete column to users table")

		// Add the column
		_, err = d.db.ExecContext(ctx, `
			ALTER TABLE users ADD COLUMN setup_complete INTEGER NOT NULL DEFAULT 0
		`)
		if err != nil {
			return fmt.Errorf("failed to add setup_complete column: %w", err)
		}

		// Set setup_complete=1 for any existing users (they must have completed setup)
		_, err = d.db.ExecContext(ctx, `
			UPDATE users SET setup_complete = 1 WHERE id IS NOT NULL
		`)
		if err != nil {
			return fmt.Errorf("failed to initialize setup_complete values: %w", err)
		}

		logging.Info("Migration complete: setup_complete column added and initialized")
	}

	return err
}

// Close closes the database connection.
func (d *Database) Close() error {
	return d.db.Close()
}

// BeginBatch starts a transaction for batch operations.
// The caller is responsible for calling EndBatch when done.
// Note: Acquires write lock only during transaction begin, not for entire duration.
func (d *Database) BeginBatch() (*sql.Tx, error) {
	// Use shorter-lived lock - only protect transaction creation
	d.mu.Lock()
	txStart := time.Now()

	// Use background context - transaction lifetime is managed by EndBatch, not a timeout.
	// The timeout context pattern doesn't work here because defer cancel() would
	// cancel the transaction immediately when this function returns.
	tx, err := d.db.BeginTx(context.Background(), nil)
	d.mu.Unlock() // Release lock immediately after transaction starts

	if err != nil {
		return nil, err
	}

	// Store transaction start time in context for metrics
	// This is a workaround since we can't store it in the struct without holding the lock
	// The EndBatch function will use time.Since on a passed start time
	d.txStart = txStart

	return tx, nil
}

// EndBatch commits or rolls back a transaction.
func (d *Database) EndBatch(tx *sql.Tx, err error) error {
	// Record transaction duration (txStart set by BeginBatch)
	duration := time.Since(d.txStart).Seconds()

	if err != nil {
		metrics.DBTransactionDuration.WithLabelValues("rollback").Observe(duration)
		rbErr := tx.Rollback()
		if rbErr != nil {
			return errors.Join(err, fmt.Errorf("rollback also failed: %w", rbErr))
		}
		return err
	}

	metrics.DBTransactionDuration.WithLabelValues("commit").Observe(duration)
	return tx.Commit()
}

// UpsertFile inserts or updates a file record within a transaction.
// The transaction's context controls the operation timeout.
func (d *Database) UpsertFile(tx *sql.Tx, file *MediaFile) error {
	// IMPORTANT: We maintain two timestamps:
	// - updated_at: Always set to 'now' when indexer touches the file (for cleanup logic)
	// - content_updated_at: Only updated when file content actually changes (for thumbnail invalidation)
	// This allows the indexer to track "last seen" while thumbnail generator tracks "last changed".
	query := `
	INSERT INTO files (name, path, parent_path, type, size, mod_time, mime_type, file_hash, updated_at, content_updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
	ON CONFLICT(path) DO UPDATE SET
		name = excluded.name,
		type = excluded.type,
		size = excluded.size,
		mod_time = excluded.mod_time,
		mime_type = excluded.mime_type,
		file_hash = excluded.file_hash,
		updated_at = strftime('%s', 'now'),
		content_updated_at = CASE
			WHEN files.size != excluded.size
			  OR files.mod_time != excluded.mod_time
			  OR files.type != excluded.type
			  OR COALESCE(files.file_hash, '') != COALESCE(excluded.file_hash, '')
			THEN strftime('%s', 'now')
			ELSE COALESCE(files.content_updated_at, strftime('%s', 'now'))
		END
	`

	// Use background context since we're within a transaction.
	// The transaction itself controls the operation's lifecycle.
	result, err := tx.ExecContext(context.Background(), query,
		file.Name,
		file.Path,
		file.ParentPath,
		file.Type,
		file.Size,
		file.ModTime.Unix(),
		file.MimeType,
		file.FileHash,
	)
	if err == nil {
		if rows, _ := result.RowsAffected(); rows > 0 {
			metrics.DBRowsAffected.WithLabelValues("upsert_file").Observe(float64(rows))
		}
	}
	return err
}

// DeleteMissingFiles removes files that weren't seen during indexing.
// Must be called within a transaction.
func (d *Database) DeleteMissingFiles(tx *sql.Tx, cutoffTime time.Time) (int64, error) {
	// Use background context since we're within a transaction.
	result, err := tx.ExecContext(context.Background(),
		"DELETE FROM files WHERE updated_at < ?",
		cutoffTime.Unix(),
	)
	if err != nil {
		return 0, err
	}

	rowsAffected, err := result.RowsAffected()
	if err == nil && rowsAffected > 0 {
		metrics.DBRowsAffected.WithLabelValues("delete_files").Observe(float64(rowsAffected))
	}
	return rowsAffected, err
}

// GetFileByPath retrieves a single file by path.
func (d *Database) GetFileByPath(ctx context.Context, path string) (*MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	query := `
	SELECT id, name, path, parent_path, type, size, mod_time, mime_type
	FROM files WHERE path = ?
	`

	var file MediaFile
	var modTime int64

	err := d.db.QueryRowContext(ctx, query, path).Scan(
		&file.ID, &file.Name, &file.Path, &file.ParentPath,
		&file.Type, &file.Size, &modTime, &file.MimeType,
	)
	if err != nil {
		return nil, err
	}

	file.ModTime = time.Unix(modTime, 0)
	return &file, nil
}

// UpdateStats updates the cached statistics.
func (d *Database) UpdateStats(stats IndexStats) {
	d.statsMu.Lock()
	defer d.statsMu.Unlock()
	d.stats = stats
}

// GetStats returns the current index statistics.
func (d *Database) GetStats() IndexStats {
	d.statsMu.RLock()
	defer d.statsMu.RUnlock()
	return d.stats
}

// RebuildFTS rebuilds the full-text search index.
func (d *Database) RebuildFTS() error {
	start := time.Now()
	var err error
	defer func() { recordQuery("rebuild_fts", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err = d.db.ExecContext(ctx, "INSERT INTO files_fts(files_fts) VALUES('rebuild')")
	return err
}

// Vacuum optimizes the database.
func (d *Database) Vacuum() error {
	start := time.Now()
	var err error
	defer func() { recordQuery("vacuum", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	_, err = d.db.ExecContext(ctx, "VACUUM")
	return err
}

// recordQuery records database query metrics
func recordQuery(operation string, start time.Time, err error) {
	duration := time.Since(start).Seconds()
	status := "success"
	if err != nil {
		status = "error"
	}
	metrics.DBQueryTotal.WithLabelValues(operation, status).Inc()
	metrics.DBQueryDuration.WithLabelValues(operation).Observe(duration)
}

// UpdateDBMetrics updates database connection metrics
func (d *Database) UpdateDBMetrics() {
	stats := d.db.Stats()
	metrics.DBConnectionsOpen.Set(float64(stats.OpenConnections))
}

// diagnoseDatabasePermissions checks database directory and file permissions
func diagnoseDatabasePermissions(dbPath string) error {
	dir := filepath.Dir(dbPath)

	// Check directory permissions
	dirInfo, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("cannot stat database directory: %w", err)
	}

	logging.Debug("Database directory: %s (mode: %v)", dir, dirInfo.Mode())

	// Check if directory is writable by testing
	testFile := filepath.Join(dir, ".perm-test")
	if err := os.WriteFile(testFile, []byte("test"), 0o600); err != nil {
		return fmt.Errorf("database directory not writable: %w", err)
	}
	_ = os.Remove(testFile) // Explicitly ignore cleanup error
	logging.Debug("Database directory is writable")

	// Check main database file
	if dbInfo, err := os.Stat(dbPath); err == nil {
		logging.Debug("Database file exists: %s (mode: %v, size: %d bytes)", dbPath, dbInfo.Mode(), dbInfo.Size())
		if dbInfo.Mode().Perm()&0o200 == 0 {
			logging.Warn("Database file is read-only! Mode: %v", dbInfo.Mode())
		}
	}

	// Check WAL file
	walPath := dbPath + "-wal"
	if walInfo, err := os.Stat(walPath); err == nil {
		logging.Debug("WAL file exists: %s (mode: %v, size: %d bytes)", walPath, walInfo.Mode(), walInfo.Size())
		if walInfo.Mode().Perm()&0o200 == 0 {
			logging.Warn("WAL file is read-only! Mode: %v - this will cause write failures", walInfo.Mode())
			// Try to fix it
			if chmodErr := os.Chmod(walPath, 0o600); chmodErr != nil {
				logging.Error("Failed to fix WAL file permissions: %v", chmodErr)
			} else {
				logging.Info("Fixed WAL file permissions")
			}
		}
	}

	// Check SHM file
	shmPath := dbPath + "-shm"
	if shmInfo, err := os.Stat(shmPath); err == nil {
		logging.Debug("SHM file exists: %s (mode: %v, size: %d bytes)", shmPath, shmInfo.Mode(), shmInfo.Size())
		if shmInfo.Mode().Perm()&0o200 == 0 {
			logging.Warn("SHM file is read-only! Mode: %v - this will cause write failures", shmInfo.Mode())
			// Try to fix it
			if chmodErr := os.Chmod(shmPath, 0o600); chmodErr != nil {
				logging.Error("Failed to fix SHM file permissions: %v", chmodErr)
			} else {
				logging.Info("Fixed SHM file permissions")
			}
		}
	}

	return nil
}
