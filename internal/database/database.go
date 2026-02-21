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

	sqlite3 "github.com/mattn/go-sqlite3"

	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

// Default timeout for database operations
const defaultTimeout = 5 * time.Second

// driverName is the custom SQLite driver name with mmap disabled.
// Used only when mmap protection is requested.
const driverName = "sqlite3_mmap_disabled"

// standardDriverName is the default go-sqlite3 driver.
const standardDriverName = "sqlite3"

// registerOnce ensures the custom driver is registered exactly once.
var registerOnce sync.Once

// registerDriver registers our custom SQLite driver with mmap disabled.
func registerDriver() {
	registerOnce.Do(func() {
		sql.Register(driverName, &sqlite3.SQLiteDriver{
			ConnectHook: func(conn *sqlite3.SQLiteConn) error {
				_, err := conn.Exec("PRAGMA mmap_size = 0", nil)
				return err
			},
		})
	})
}

func init() {
	registerDriver()
}

// getSlowQueryThreshold returns the threshold for logging slow queries.
// Can be configured via SLOW_QUERY_THRESHOLD_MS environment variable.
func getSlowQueryThreshold() float64 {
	if thresholdStr := os.Getenv("SLOW_QUERY_THRESHOLD_MS"); thresholdStr != "" {
		if threshold, err := strconv.ParseFloat(thresholdStr, 64); err == nil {
			return threshold / 1000.0
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
	txStart time.Time
	mmapDisabled bool
}

// Options holds configuration options for database initialization.
type Options struct {
	// MmapDisabled disables memory-mapped I/O for SQLite.
	// This prevents SIGBUS crashes on unreliable storage backends
	// (e.g., Longhorn, NFS, network-attached volumes).
	// Default: false (mmap enabled — standard SQLite behavior).
	MmapDisabled bool
}

// Info holds diagnostic info about the database initialization
type Info struct {
	Path              string
	PermissionWarning string
	SQLiteVersion     string
	MmapStatus        string
	MmapWarning       string
}

// ---------------------------------------------------------------------------
// observeQuery replaces the old recordQuery pattern with an ergonomic helper.
//
// Usage:
//
//	done := observeQuery("upsert_file")
//	result, err := tx.ExecContext(ctx, query, args...)
//	done(err)
//
// It records DBQueryTotal (counter), DBQueryDuration (histogram), and logs
// slow queries — all in one place when done() is called.
// ---------------------------------------------------------------------------
func observeQuery(operation string) func(error) {
	start := time.Now()
	return func(err error) {
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
}

// activeDriverName returns the SQLite driver name to use based on options.
func activeDriverName(opts *Options) string {
	if opts != nil && opts.MmapDisabled {
		return driverName
	}
	return standardDriverName
}

// New creates a new Database instance and returns diagnostic info for logging.
func New(ctx context.Context, dbPath string, opts *Options) (*Database, *Info, error) {
	info := &Info{Path: dbPath}

	if err := diagnoseDatabasePermissions(dbPath); err != nil {
		info.PermissionWarning = err.Error()
	}

	// Determine which driver to use based on mmap configuration
	driver := activeDriverName(opts)
	isMmapDisabled := opts != nil && opts.MmapDisabled
	if isMmapDisabled {
		logging.Info("SQLite mmap disabled (SIGBUS protection active for unreliable storage)")
	} else {
		logging.Debug("SQLite mmap enabled (default — standard performance mode)")
	}

	connStr := fmt.Sprintf("%s?_journal_mode=WAL&_synchronous=NORMAL&_cache_size=10000&_temp_store=MEMORY&_busy_timeout=5000", dbPath)

	db, err := sql.Open(driver, connStr)
	if err != nil {
		return nil, info, fmt.Errorf("failed to open database: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if err := db.PingContext(pingCtx); err != nil {
		if cerr := db.Close(); cerr != nil {
			logging.Warn("failed to close db after ping failure: %v", cerr)
		}
		return nil, info, fmt.Errorf("failed to connect to database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(time.Hour)

	d := &Database{
		db:           db,
		dbPath:       dbPath,
		mmapDisabled: isMmapDisabled,
	}

	if err := d.initialize(ctx); err != nil {
		if cerr := db.Close(); cerr != nil {
			logging.Warn("failed to close db after initialize failure: %v", cerr)
		}
		return nil, info, fmt.Errorf("failed to initialize database schema: %w", err)
	}

	version, mmapStatus, mmapWarning := d.getSQLiteDiagnostics(ctx)
	info.SQLiteVersion = version
	info.MmapStatus = mmapStatus
	info.MmapWarning = mmapWarning

	return d, info, nil
}


// getSQLiteDiagnostics returns SQLite version, mmap status, and any mmap warnings.
func (d *Database) getSQLiteDiagnostics(ctx context.Context) (version, mmapStatus, mmapWarning string) {
	queryCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if err := d.db.QueryRowContext(queryCtx, "SELECT sqlite_version()").Scan(&version); err != nil {
		version = "unknown"
	}

	rows, err := d.db.QueryContext(queryCtx, "PRAGMA compile_options")
	if err == nil {
		defer func() {
			if cerr := rows.Close(); cerr != nil {
				logging.Warn("failed to close rows: %v", cerr)
			}
		}()
		for rows.Next() {
			var opt string
			if err := rows.Scan(&opt); err == nil {
				if len(opt) > 18 && opt[:18] == "DEFAULT_MMAP_SIZE=" {
					defaultVal := opt[18:]
					if defaultVal != "0" && d.mmapDisabled {
						mmapWarning = fmt.Sprintf("System SQLite compiled with %s — our ConnectHook sets mmap_size=0 to prevent SIGBUS on unreliable storage.", opt)
						metrics.DBMmapOverrideApplied.Inc()
					}
				}
			}
		}
	}

	var mmapSize int64
	if err := d.db.QueryRowContext(queryCtx, "PRAGMA mmap_size").Scan(&mmapSize); err == nil {
		if d.mmapDisabled {
			// We intended to disable mmap
			if mmapSize != 0 {
				mmapStatus = fmt.Sprintf("CRITICAL: mmap_size is %d but should be 0 — SIGBUS protection is NOT active!", mmapSize)
				metrics.DBMmapStatus.Set(float64(mmapSize))
			} else {
				mmapStatus = "mmap_size = 0 (SIGBUS protection active)"
				metrics.DBMmapStatus.Set(0)
			}
		} else {
			// mmap is intentionally enabled (default)
			mmapStatus = fmt.Sprintf("mmap_size = %d (standard mode — set DB_MMAP_DISABLED=true if on unreliable storage)", mmapSize)
			metrics.DBMmapStatus.Set(float64(mmapSize))
		}
	} else {
		mmapStatus = "unknown"
	}
	return
}


// CheckStorageHealth verifies that the database's underlying storage is accessible.
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
				if f.name != "main" {
					continue
				}
			}
			logging.Error("Storage health check FAILED for %s file (%s): %v — "+
				"this would have caused SIGBUS with mmap enabled", f.name, f.path, err)
			metrics.DBStorageErrors.WithLabelValues(f.name).Inc()
			continue
		}

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

	if duration > 1.0 {
		logging.Warn("Storage health check took %.3fs — storage may be degraded "+
			"(with mmap enabled, this latency could have caused application hangs)", duration)
		metrics.DBStorageSlowChecks.Inc()
	}
}

func (d *Database) initialize(ctx context.Context) error {
	done := observeQuery("initialize_schema")

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

	CREATE INDEX IF NOT EXISTS idx_files_parent_type ON files(parent_path, type);
	CREATE INDEX IF NOT EXISTS idx_files_name_type ON files(name COLLATE NOCASE, type);

	CREATE INDEX IF NOT EXISTS idx_files_parent_type_name ON files(parent_path, type, name COLLATE NOCASE);
	CREATE INDEX IF NOT EXISTS idx_files_parent_type_modtime ON files(parent_path, type, mod_time);
	CREATE INDEX IF NOT EXISTS idx_files_parent_type_size ON files(parent_path, type, size);

	CREATE INDEX IF NOT EXISTS idx_files_path_type ON files(path, type);

	CREATE INDEX IF NOT EXISTS idx_files_type_path ON files(type, path);

	CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

	CREATE INDEX IF NOT EXISTS idx_files_media_directory_name ON files(
		parent_path, type, name COLLATE NOCASE,
		id, path, size, mod_time, mime_type
	);
	CREATE INDEX IF NOT EXISTS idx_files_media_directory_date ON files(
		parent_path, type, mod_time, name COLLATE NOCASE,
		id, path, size, mime_type
	);

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

	CREATE TABLE IF NOT EXISTS favorites (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		path TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);

	CREATE INDEX IF NOT EXISTS idx_favorites_path ON favorites(path);

	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE COLLATE NOCASE,
		color TEXT,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);

	CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name COLLATE NOCASE);

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

	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		password_hash TEXT NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		setup_complete INTEGER NOT NULL DEFAULT 0
	);

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

	CREATE TABLE IF NOT EXISTS metadata (
		key TEXT PRIMARY KEY,
		value TEXT
	);
	`

	_, err := d.db.ExecContext(ctx, schema)
	done(err)
	if err != nil {
		return err
	}

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

		done := observeQuery("migrate_add_content_updated_at")
		_, err = d.db.ExecContext(ctx, `
			ALTER TABLE files ADD COLUMN content_updated_at INTEGER NOT NULL DEFAULT 0
		`)
		done(err)
		if err != nil {
			return fmt.Errorf("failed to add content_updated_at column: %w", err)
		}

		done = observeQuery("migrate_init_content_updated_at")
		_, err = d.db.ExecContext(ctx, `
			UPDATE files SET content_updated_at = updated_at
		`)
		done(err)
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

		done := observeQuery("migrate_add_setup_complete")
		_, err = d.db.ExecContext(ctx, `
			ALTER TABLE users ADD COLUMN setup_complete INTEGER NOT NULL DEFAULT 0
		`)
		done(err)
		if err != nil {
			return fmt.Errorf("failed to add setup_complete column: %w", err)
		}

		done = observeQuery("migrate_init_setup_complete")
		_, err = d.db.ExecContext(ctx, `
			UPDATE users SET setup_complete = 1 WHERE id IS NOT NULL
		`)
		done(err)
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
func (d *Database) BeginBatch(ctx context.Context) (*sql.Tx, error) {
	d.mu.Lock()

	done := observeQuery("begin_transaction")
	tx, err := d.db.BeginTx(ctx, nil)
	done(err)

	if err != nil {
		d.mu.Unlock()
		return nil, err
	}

	d.txStart = time.Now()

	return tx, nil
}

// EndBatch commits or rolls back a transaction.
func (d *Database) EndBatch(tx *sql.Tx, err error) error {
	defer d.mu.Unlock()

	duration := time.Since(d.txStart).Seconds()

	if err != nil {
		metrics.DBTransactionDuration.WithLabelValues("rollback").Observe(duration)

		done := observeQuery("rollback")
		rbErr := tx.Rollback()
		done(rbErr)

		if rbErr != nil {
			return errors.Join(err, fmt.Errorf("rollback also failed: %w", rbErr))
		}
		return err
	}

	metrics.DBTransactionDuration.WithLabelValues("commit").Observe(duration)

	done := observeQuery("commit")
	commitErr := tx.Commit()
	done(commitErr)

	return commitErr
}

// UpsertFile inserts or updates a file record within a transaction.
func (d *Database) UpsertFile(ctx context.Context, tx *sql.Tx, file *MediaFile) error {
	done := observeQuery("upsert_file")

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
	done(err)

	if err == nil {
		if rows, _ := result.RowsAffected(); rows > 0 {
			metrics.DBRowsAffected.WithLabelValues("upsert_file").Observe(float64(rows))
		}
	}
	return err
}

// DeleteMissingFiles removes files that weren't seen during indexing.
func (d *Database) DeleteMissingFiles(ctx context.Context, tx *sql.Tx, cutoffTime time.Time) (int64, error) {
	done := observeQuery("delete_missing_files")

	result, err := tx.ExecContext(ctx,
		"DELETE FROM files WHERE updated_at < ?",
		cutoffTime.Unix(),
	)
	done(err)

	if err != nil {
		return 0, err
	}

	rowsAffected, err := result.RowsAffected()
	if err == nil && rowsAffected > 0 {
		metrics.DBRowsAffected.WithLabelValues("delete_missing_files").Observe(float64(rowsAffected))
	}
	return rowsAffected, err
}

// GetFileByPath retrieves a single file by path.
func (d *Database) GetFileByPath(ctx context.Context, path string) (*MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	done := observeQuery("get_file_by_path")

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
	done(err)

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
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	done := observeQuery("rebuild_fts")
	_, err := d.db.ExecContext(ctx, "INSERT INTO files_fts(files_fts) VALUES('rebuild')")
	done(err)

	return err
}

// Vacuum optimizes the database.
func (d *Database) Vacuum() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	done := observeQuery("vacuum")
	_, err := d.db.ExecContext(ctx, "VACUUM")
	done(err)

	return err
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
