package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	sqlite3 "github.com/mattn/go-sqlite3" // SQLite3 driver (typed import for ConnectHook)

	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

// Default timeout for database operations
const defaultTimeout = 5 * time.Second

// driverName is the custom SQLite driver name with mmap disabled.
// We register a custom driver instead of using the default "sqlite3" driver
// so that PRAGMA mmap_size=0 is applied on every connection the pool creates.
// This prevents SIGBUS crashes when the underlying storage (NFS, Docker volumes)
// becomes temporarily unavailable — mmap'd pages would fault with SIGBUS, while
// read() syscalls return a recoverable error.
const driverName = "sqlite3_mmap_disabled"

// registerOnce ensures the custom driver is registered exactly once.
var registerOnce sync.Once

// registerDriver registers our custom SQLite driver with mmap disabled.
func registerDriver() {
	registerOnce.Do(func() {
		sql.Register(driverName, &sqlite3.SQLiteDriver{
			ConnectHook: func(conn *sqlite3.SQLiteConn) error {
				// Disable mmap on every new connection.
				// go-sqlite3 does not support _mmap_size as a DSN parameter,
				// so we must set it via PRAGMA on each connection.
				_, err := conn.Exec("PRAGMA mmap_size = 0", nil)
				return err
			},
		})
	})
}

func init() {
	registerDriver()
}

// getSlowQueryThreshold returns the threshold for logging slow queries
// Can be configured via SLOW_QUERY_THRESHOLD_MS environment variable
func getSlowQueryThreshold() float64 {
	if thresholdStr := os.Getenv("SLOW_QUERY_THRESHOLD_MS"); thresholdStr != "" {
		if threshold, err := strconv.ParseFloat(thresholdStr, 64); err == nil {
			return threshold / 1000.0 // Convert ms to seconds
		}
	}
	return 0.1 // Default 100ms
}

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
	// NOTE: mmap_size is NOT set via DSN — go-sqlite3 does not support it as a DSN param.
	// Instead, it is set to 0 via ConnectHook in our custom driver (see registerDriver).
	connStr := fmt.Sprintf("%s?_journal_mode=WAL&_synchronous=NORMAL&_cache_size=10000&_temp_store=MEMORY&_busy_timeout=5000", dbPath)

	db, err := sql.Open(driverName, connStr)
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

	// Verify mmap is disabled and log SQLite environment info
	d.logSQLiteConfig(ctx)

	logging.Info("Database initialized successfully at %s", dbPath)
	return d, nil
}

// logSQLiteConfig logs the SQLite configuration for diagnostics and verifies
// that mmap is disabled. This helps operators confirm the SIGBUS fix is active
// and detects if the system SQLite has a non-zero DEFAULT_MMAP_SIZE.
func (d *Database) logSQLiteConfig(ctx context.Context) {
	queryCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Log SQLite version
	var version string
	if err := d.db.QueryRowContext(queryCtx, "SELECT sqlite_version()").Scan(&version); err == nil {
		logging.Info("SQLite version: %s", version)
	}

	// Check compiled-in default mmap size
	rows, err := d.db.QueryContext(queryCtx, "PRAGMA compile_options")
	if err == nil {
		defer func() {
			if closeErr := rows.Close(); closeErr != nil {
				logging.Error("failed to close compile_options rows: %v", closeErr)
			}
		}()
		for rows.Next() {
			var opt string
			if err := rows.Scan(&opt); err == nil {
				// Look for DEFAULT_MMAP_SIZE=N where N > 0
				if len(opt) > 18 && opt[:18] == "DEFAULT_MMAP_SIZE=" {
					defaultVal := opt[18:]
					if defaultVal != "0" {
						logging.Warn("System SQLite compiled with %s — without our fix, "+
							"mmap would be enabled by default, risking SIGBUS on storage failures. "+
							"Our ConnectHook sets mmap_size=0 to prevent this.", opt)
						metrics.DBMmapOverrideApplied.Inc()
					}
				}
			}
		}
	}

	// Verify mmap is actually disabled on the current connection
	var mmapSize int64
	if err := d.db.QueryRowContext(queryCtx, "PRAGMA mmap_size").Scan(&mmapSize); err == nil {
		if mmapSize != 0 {
			logging.Error("CRITICAL: mmap_size is %d but should be 0 — SIGBUS protection is NOT active!", mmapSize)
			metrics.DBMmapStatus.Set(float64(mmapSize))
		} else {
			logging.Info("mmap_size = 0 (SIGBUS protection active)")
			metrics.DBMmapStatus.Set(0)
		}
	}
}

// CheckStorageHealth verifies that the database's underlying storage is accessible.
// This detects the exact conditions (I/O errors, stale NFS handles, missing Docker
// volumes) that would have caused SIGBUS crashes when mmap was enabled.
// Call this periodically from the metrics collector.
func (d *Database) CheckStorageHealth() {
	start := time.Now()

	files := []struct {
		path string
		name string
	}{
		{d.dbPath, "main"},
		{d.dbPath + "-wal", "wal"},
		{d.dbPath + "-shm", "shm"},
	}

	for _, f := range files {
		if _, err := os.Stat(f.path); err != nil {
			if os.IsNotExist(err) {
				// WAL/SHM files may not exist yet — that's normal
				if f.name != "main" {
					continue
				}
			}
			logging.Error("Storage health check FAILED for %s file (%s): %v — "+
				"this would have caused SIGBUS with mmap enabled", f.name, f.path, err)
			metrics.DBStorageErrors.WithLabelValues(f.name).Inc()
			continue
		}

		// Attempt to read a small amount from the file to verify I/O works.
		// A stat() can succeed even when reads would fail on some NFS configurations.
		fh, err := os.Open(f.path)
		if err != nil {
			logging.Error("Storage health check: cannot open %s file (%s): %v — "+
				"this would have caused SIGBUS with mmap enabled", f.name, f.path, err)
			metrics.DBStorageErrors.WithLabelValues(f.name).Inc()
			continue
		}

		buf := make([]byte, 16)
		_, err = fh.Read(buf)
		if closeErr := fh.Close(); closeErr != nil {
			logging.Error("Storage health check: failed to close %s file (%s): %v", f.name, f.path, closeErr)
		}
		if err != nil && err.Error() != "EOF" {
			logging.Error("Storage health check: cannot read %s file (%s): %v — "+
				"this would have caused SIGBUS with mmap enabled", f.name, f.path, err)
			metrics.DBStorageErrors.WithLabelValues(f.name).Inc()
		}
	}

	duration := time.Since(start).Seconds()
	metrics.DBStorageHealthCheckDuration.Observe(duration)

	// If the health check itself is slow, storage may be degraded
	if duration > 1.0 {
		logging.Warn("Storage health check took %.3fs — storage may be degraded "+
			"(with mmap enabled, this latency could have caused application hangs)", duration)
		metrics.DBStorageSlowChecks.Inc()
	}
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

	-- Additional composite indexes for JOIN performance
	-- For GetMediaInDirectory and ListDirectory with sorting and filtering
	CREATE INDEX IF NOT EXISTS idx_files_parent_type_name ON files(parent_path, type, name COLLATE NOCASE);
	CREATE INDEX IF NOT EXISTS idx_files_parent_type_modtime ON files(parent_path, type, mod_time);
	CREATE INDEX IF NOT EXISTS idx_files_parent_type_size ON files(parent_path, type, size);

	-- For folder count lookups (important for large directories)
	CREATE INDEX IF NOT EXISTS idx_files_path_type ON files(path, type);

	-- Covering index for GetAllIndexedPaths (type filtering + path retrieval)
	CREATE INDEX IF NOT EXISTS idx_files_type_path ON files(type, path);

	-- Simple path index for JOIN optimization (favorites, file_tags)
	CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

	-- Covering indexes for GetMediaInDirectory - eliminate table lookups for hot paths
	-- These include all columns needed in SELECT to avoid accessing the main table
	-- For directories with 1000+ files, this reduces query time from ~100ms to ~10-20ms
	CREATE INDEX IF NOT EXISTS idx_files_media_directory_name ON files(
		parent_path, type, name COLLATE NOCASE,
		id, path, size, mod_time, mime_type
	);
	CREATE INDEX IF NOT EXISTS idx_files_media_directory_date ON files(
		parent_path, type, mod_time, name COLLATE NOCASE,
		id, path, size, mime_type
	);

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

		_, err = d.db.ExecContext(ctx, `
			ALTER TABLE files ADD COLUMN content_updated_at INTEGER NOT NULL DEFAULT 0
		`)
		if err != nil {
			return fmt.Errorf("failed to add content_updated_at column: %w", err)
		}

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

		_, err = d.db.ExecContext(ctx, `
			ALTER TABLE users ADD COLUMN setup_complete INTEGER NOT NULL DEFAULT 0
		`)
		if err != nil {
			return fmt.Errorf("failed to add setup_complete column: %w", err)
		}

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
// The provided context is used only for transaction creation; the transaction
// lifetime is managed by EndBatch, not by the context.
// Note: Acquires write lock only during transaction begin, not for entire duration.
func (d *Database) BeginBatch(ctx context.Context) (*sql.Tx, error) {
	d.mu.Lock()
	// Lock is held until EndBatch — this serializes write transactions,
	// which is required for SQLite. Reads use RLock and remain concurrent.

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		d.mu.Unlock() // Release lock on failure — no transaction to end
		return nil, err
	}

	d.txStart = time.Now()

	return tx, nil
}

// EndBatch commits or rolls back a transaction.
func (d *Database) EndBatch(tx *sql.Tx, err error) error {
	defer d.mu.Unlock() // Always release the write lock acquired in BeginBatch

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
func (d *Database) UpsertFile(ctx context.Context, tx *sql.Tx, file *MediaFile) error {
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

	result, err := tx.ExecContext(ctx, query,
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
func (d *Database) DeleteMissingFiles(tx *sql.Tx, cutoffTime time.Time) (int64, error) {
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

	threshold := getSlowQueryThreshold()
	if duration > threshold {
		logging.Warn("Slow query detected: operation=%s duration=%.3fs status=%s error=%v",
			operation, duration, status, err)
	}
}

// UpdateDBMetrics updates database connection metrics
func (d *Database) UpdateDBMetrics() {
	stats := d.db.Stats()
	metrics.DBConnectionsOpen.Set(float64(stats.OpenConnections))
}

// diagnoseDatabasePermissions checks database directory and file permissions
func diagnoseDatabasePermissions(dbPath string) error {
	dir := filepath.Dir(dbPath)

	dirInfo, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("cannot stat database directory: %w", err)
	}

	logging.Debug("Database directory: %s (mode: %v)", dir, dirInfo.Mode())

	testFile := filepath.Join(dir, ".perm-test")
	if err := os.WriteFile(testFile, []byte("test"), 0o600); err != nil {
		return fmt.Errorf("database directory not writable: %w", err)
	}
	_ = os.Remove(testFile)
	logging.Debug("Database directory is writable")

	if dbInfo, err := os.Stat(dbPath); err == nil {
		logging.Debug("Database file exists: %s (mode: %v, size: %d bytes)", dbPath, dbInfo.Mode(), dbInfo.Size())
		if dbInfo.Mode().Perm()&0o200 == 0 {
			logging.Warn("Database file is read-only! Mode: %v", dbInfo.Mode())
		}
	}

	walPath := dbPath + "-wal"
	if walInfo, err := os.Stat(walPath); err == nil {
		logging.Debug("WAL file exists: %s (mode: %v, size: %d bytes)", walPath, walInfo.Mode(), walInfo.Size())
		if walInfo.Mode().Perm()&0o200 == 0 {
			logging.Warn("WAL file is read-only! Mode: %v - this will cause write failures", walInfo.Mode())
			if chmodErr := os.Chmod(walPath, 0o600); chmodErr != nil {
				logging.Error("Failed to fix WAL file permissions: %v", chmodErr)
			} else {
				logging.Info("Fixed WAL file permissions")
			}
		}
	}

	shmPath := dbPath + "-shm"
	if shmInfo, err := os.Stat(shmPath); err == nil {
		logging.Debug("SHM file exists: %s (mode: %v, size: %d bytes)", shmPath, shmInfo.Mode(), shmInfo.Size())
		if shmInfo.Mode().Perm()&0o200 == 0 {
			logging.Warn("SHM file is read-only! Mode: %v - this will cause write failures", shmInfo.Mode())
			if chmodErr := os.Chmod(shmPath, 0o600); chmodErr != nil {
				logging.Error("Failed to fix SHM file permissions: %v", chmodErr)
			} else {
				logging.Info("Fixed SHM file permissions")
			}
		}
	}

	return nil
}
