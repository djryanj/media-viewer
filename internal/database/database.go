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

const defaultTimeout = 5 * time.Second
const driverName = "sqlite3_custom"
const unknownStr = "unknown"

var registerOnce sync.Once

func registerDriver(opts *Options) {
	registerOnce.Do(func() {
		mmapDisabled := opts != nil && opts.MmapDisabled

		sql.Register(driverName, &sqlite3.SQLiteDriver{
			ConnectHook: func(conn *sqlite3.SQLiteConn) error {
				pragmas := []string{
					"PRAGMA journal_mode=WAL",
					"PRAGMA synchronous=NORMAL",
					"PRAGMA cache_size=10000",
					"PRAGMA temp_store=MEMORY",
					"PRAGMA busy_timeout=30000",
				}
				if mmapDisabled {
					pragmas = append(pragmas, "PRAGMA mmap_size=0")
				}
				for _, p := range pragmas {
					if _, err := conn.Exec(p, nil); err != nil {
						return fmt.Errorf("failed to exec %s: %w", p, err)
					}
				}
				return nil
			},
		})
	})
}

func getSlowQueryThreshold() float64 {
	if thresholdStr := os.Getenv("SLOW_QUERY_THRESHOLD_MS"); thresholdStr != "" {
		if threshold, err := strconv.ParseFloat(thresholdStr, 64); err == nil {
			return threshold / 1000.0
		}
	}
	return 0.1
}

// preparedStmts holds pre-compiled SQL statements for hot-path queries.
// These are prepared once during initialization against the reader pool
// and reused for every call, eliminating repeated query parsing.
type preparedStmts struct {
	getFileByPath       *sql.Stmt
	isFavorite          *sql.Stmt
	calcStats           *sql.Stmt
	countDirItems       *sql.Stmt
	countDirItemsFilter *sql.Stmt
}

// Database manages all database operations for the media viewer.
type Database struct {
	reader       *sql.DB
	writer       *sql.DB
	dbPath       string
	stats        IndexStats
	statsMu      sync.RWMutex
	mmapDisabled bool
	stmts        preparedStmts
}

// Options holds configuration options for database initialization.
type Options struct {
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

// New creates a new Database instance and returns diagnostic info for logging.
func New(ctx context.Context, dbPath string, opts *Options) (*Database, *Info, error) {
	info := &Info{Path: dbPath}

	if err := diagnoseDatabasePermissions(dbPath); err != nil {
		info.PermissionWarning = err.Error()
	}

	registerDriver(opts)

	isMmapDisabled := opts != nil && opts.MmapDisabled
	if isMmapDisabled {
		logging.Info("SQLite mmap disabled (SIGBUS protection active for unreliable storage)")
	} else {
		logging.Debug("SQLite mmap enabled (default — standard performance mode)")
	}

	writer, err := sql.Open(driverName, dbPath)
	if err != nil {
		return nil, info, fmt.Errorf("failed to open writer database: %w", err)
	}
	writer.SetMaxOpenConns(1)
	writer.SetMaxIdleConns(1)
	writer.SetConnMaxLifetime(0)

	reader, err := sql.Open(driverName, dbPath)
	if err != nil {
		if cerr := writer.Close(); cerr != nil {
			logging.Warn("failed to close writer after reader open failure: %v", cerr)
		}
		return nil, info, fmt.Errorf("failed to open reader database: %w", err)
	}
	reader.SetMaxOpenConns(16)
	reader.SetMaxIdleConns(8)
	reader.SetConnMaxLifetime(time.Hour)

	pingCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if err := writer.PingContext(pingCtx); err != nil {
		if cerr := writer.Close(); cerr != nil {
			logging.Warn("failed to close writer: %v", cerr)
		}
		if cerr := reader.Close(); cerr != nil {
			logging.Warn("failed to close reader: %v", cerr)
		}
		return nil, info, fmt.Errorf("failed to ping writer database: %w", err)
	}
	if err := reader.PingContext(pingCtx); err != nil {
		if cerr := writer.Close(); cerr != nil {
			logging.Warn("failed to close writer: %v", cerr)
		}
		if cerr := reader.Close(); cerr != nil {
			logging.Warn("failed to close reader: %v", cerr)
		}
		return nil, info, fmt.Errorf("failed to ping reader database: %w", err)
	}

	d := &Database{
		reader:       reader,
		writer:       writer,
		dbPath:       dbPath,
		mmapDisabled: isMmapDisabled,
	}

	if err := d.initialize(ctx); err != nil {
		if cerr := writer.Close(); cerr != nil {
			logging.Warn("failed to close writer: %v", cerr)
		}
		if cerr := reader.Close(); cerr != nil {
			logging.Warn("failed to close reader: %v", cerr)
		}
		return nil, info, fmt.Errorf("failed to initialize database schema: %w", err)
	}

	if err := d.prepareStatements(ctx); err != nil {
		if cerr := writer.Close(); cerr != nil {
			logging.Warn("failed to close writer: %v", cerr)
		}
		if cerr := reader.Close(); cerr != nil {
			logging.Warn("failed to close reader: %v", cerr)
		}
		return nil, info, fmt.Errorf("failed to prepare statements: %w", err)
	}

	version, mmapStatus, mmapWarning := d.getSQLiteDiagnostics(ctx)
	info.SQLiteVersion = version
	info.MmapStatus = mmapStatus
	info.MmapWarning = mmapWarning

	return d, info, nil
}

// prepareStatements pre-compiles frequently used queries against the reader pool.
func (d *Database) prepareStatements(ctx context.Context) error {
	var err error

	d.stmts.getFileByPath, err = d.reader.PrepareContext(ctx, `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files WHERE path = ?
	`)
	if err != nil {
		return fmt.Errorf("prepare getFileByPath: %w", err)
	}

	d.stmts.isFavorite, err = d.reader.PrepareContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM favorites WHERE path = ?)",
	)
	if err != nil {
		return fmt.Errorf("prepare isFavorite: %w", err)
	}

	d.stmts.calcStats, err = d.reader.PrepareContext(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN type != 'folder' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN type = 'folder' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN type = 'playlist' THEN 1 ELSE 0 END), 0),
			(SELECT COUNT(*) FROM favorites),
			(SELECT COUNT(*) FROM tags)
		FROM files
	`)
	if err != nil {
		return fmt.Errorf("prepare calcStats: %w", err)
	}

	d.stmts.countDirItems, err = d.reader.PrepareContext(ctx,
		"SELECT COUNT(*) FROM files WHERE parent_path = ?",
	)
	if err != nil {
		return fmt.Errorf("prepare countDirItems: %w", err)
	}

	d.stmts.countDirItemsFilter, err = d.reader.PrepareContext(ctx,
		"SELECT COUNT(*) FROM files WHERE parent_path = ? AND (type = 'folder' OR type = ?)",
	)
	if err != nil {
		return fmt.Errorf("prepare countDirItemsFilter: %w", err)
	}

	return nil
}

// closeStatements closes all prepared statements.
func (d *Database) closeStatements() {
	stmts := []*sql.Stmt{
		d.stmts.getFileByPath,
		d.stmts.isFavorite,
		d.stmts.calcStats,
		d.stmts.countDirItems,
		d.stmts.countDirItemsFilter,
	}
	for _, s := range stmts {
		if s != nil {
			if cerr := s.Close(); cerr != nil {
				logging.Warn("failed to close prepared statement: %v", cerr)
			}
		}
	}
}

func (d *Database) getSQLiteDiagnostics(ctx context.Context) (version, mmapStatus, mmapWarning string) {
	queryCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if err := d.reader.QueryRowContext(queryCtx, "SELECT sqlite_version()").Scan(&version); err != nil {
		version = unknownStr
	}

	rows, err := d.reader.QueryContext(queryCtx, "PRAGMA compile_options")
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
	if err := d.reader.QueryRowContext(queryCtx, "PRAGMA mmap_size").Scan(&mmapSize); err == nil {
		if d.mmapDisabled {
			if mmapSize != 0 {
				mmapStatus = fmt.Sprintf("CRITICAL: mmap_size is %d but should be 0 — SIGBUS protection is NOT active!", mmapSize)
				metrics.DBMmapStatus.Set(float64(mmapSize))
			} else {
				mmapStatus = "mmap_size = 0 (SIGBUS protection active)"
				metrics.DBMmapStatus.Set(0)
			}
		} else {
			mmapStatus = fmt.Sprintf("mmap_size = %d (standard mode — set DB_MMAP_DISABLED=true if on unreliable storage)", mmapSize)
			metrics.DBMmapStatus.Set(float64(mmapSize))
		}
	} else {
		mmapStatus = unknownStr
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

	CREATE INDEX IF NOT EXISTS idx_files_parent_media_name ON files(
		parent_path, name COLLATE NOCASE
	) WHERE type IN ('image', 'video');

	CREATE INDEX IF NOT EXISTS idx_files_parent_media_modtime ON files(
		parent_path, mod_time
	) WHERE type IN ('image', 'video');

	CREATE INDEX IF NOT EXISTS idx_files_parent_media_size ON files(
		parent_path, size
	) WHERE type IN ('image', 'video');

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

	_, err := d.writer.ExecContext(ctx, schema)
	done(err)
	if err != nil {
		return err
	}

	return d.runMigrations(ctx)
}

func (d *Database) runMigrations(ctx context.Context) error {
	var columnExists bool
	err := d.writer.QueryRowContext(ctx, `
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
		_, err = d.writer.ExecContext(ctx, `
			ALTER TABLE files ADD COLUMN content_updated_at INTEGER NOT NULL DEFAULT 0
		`)
		done(err)
		if err != nil {
			return fmt.Errorf("failed to add content_updated_at column: %w", err)
		}

		done = observeQuery("migrate_init_content_updated_at")
		_, err = d.writer.ExecContext(ctx, `
			UPDATE files SET content_updated_at = updated_at
		`)
		done(err)
		if err != nil {
			return fmt.Errorf("failed to initialize content_updated_at values: %w", err)
		}

		logging.Info("Migration complete: content_updated_at column added and initialized")
	}

	var setupCompleteExists bool
	err = d.writer.QueryRowContext(ctx, `
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
		_, err = d.writer.ExecContext(ctx, `
			ALTER TABLE users ADD COLUMN setup_complete INTEGER NOT NULL DEFAULT 0
		`)
		done(err)
		if err != nil {
			return fmt.Errorf("failed to add setup_complete column: %w", err)
		}

		done = observeQuery("migrate_init_setup_complete")
		_, err = d.writer.ExecContext(ctx, `
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

// Close closes prepared statements and both database connection pools.
func (d *Database) Close() error {
	d.closeStatements()
	rErr := d.reader.Close()
	wErr := d.writer.Close()
	return errors.Join(rErr, wErr)
}

// BatchInserter wraps a write transaction with pre-prepared statements
// for efficient batch indexing operations.
type BatchInserter struct {
	tx        *sql.Tx
	upsert    *sql.Stmt
	del       *sql.Stmt
	startTime time.Time
}

const upsertQuery = `
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

const deleteQuery = `DELETE FROM files WHERE updated_at < ?`

// BeginBatch starts a batch indexing transaction with pre-prepared statements.
func (d *Database) BeginBatch(ctx context.Context) (*BatchInserter, error) {
	done := observeQuery("begin_transaction")
	tx, err := d.writer.BeginTx(ctx, nil)
	done(err)
	if err != nil {
		return nil, err
	}

	upsertStmt, err := tx.PrepareContext(ctx, upsertQuery)
	if err != nil {
		if rbErr := tx.Rollback(); rbErr != nil {
			logging.Warn("failed to rollback transaction: %v", rbErr)
		}
		return nil, fmt.Errorf("prepare upsert: %w", err)
	}

	delStmt, err := tx.PrepareContext(ctx, deleteQuery)
	if err != nil {
		if cerr := upsertStmt.Close(); cerr != nil { //nolint:errcheck,sqlclosecheck // cleanup on prepare failure; stmt not returned
			logging.Warn("failed to close upsert statement: %v", cerr)
		}
		if rbErr := tx.Rollback(); rbErr != nil {
			logging.Warn("failed to rollback transaction: %v", rbErr)
		}
		return nil, fmt.Errorf("prepare delete: %w", err)
	}

	return &BatchInserter{
		tx:        tx,
		upsert:    upsertStmt,
		del:       delStmt,
		startTime: time.Now(),
	}, nil
}

// Tx returns the underlying transaction for direct access.
func (b *BatchInserter) Tx() *sql.Tx {
	return b.tx
}

// StartTime returns the batch start time for external metrics.
func (b *BatchInserter) StartTime() time.Time {
	return b.startTime
}

// UpsertFile inserts or updates a file record using the pre-prepared statement.
func (b *BatchInserter) UpsertFile(ctx context.Context, file *MediaFile) error {
	done := observeQuery("upsert_file")

	result, err := b.upsert.ExecContext(ctx,
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
func (b *BatchInserter) DeleteMissingFiles(ctx context.Context, cutoffTime time.Time) (int64, error) {
	done := observeQuery("delete_missing_files")

	result, err := b.del.ExecContext(ctx, cutoffTime.Unix())
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

// EndBatch closes prepared statements and commits or rolls back the transaction.
func (d *Database) EndBatch(b *BatchInserter, err error) error {
	if cerr := b.upsert.Close(); cerr != nil {
		logging.Warn("failed to close upsert statement: %v", cerr)
	}
	if cerr := b.del.Close(); cerr != nil {
		logging.Warn("failed to close delete statement: %v", cerr)
	}

	duration := time.Since(b.startTime).Seconds()

	if err != nil {
		metrics.DBTransactionDuration.WithLabelValues("rollback").Observe(duration)

		done := observeQuery("rollback")
		rbErr := b.tx.Rollback()
		done(rbErr)

		if rbErr != nil {
			return errors.Join(err, fmt.Errorf("rollback also failed: %w", rbErr))
		}
		return err
	}

	metrics.DBTransactionDuration.WithLabelValues("commit").Observe(duration)

	done := observeQuery("commit")
	commitErr := b.tx.Commit()
	done(commitErr)

	return commitErr
}

// GetFileByPath retrieves a single file by path using a prepared statement.
func (d *Database) GetFileByPath(ctx context.Context, path string) (*MediaFile, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	done := observeQuery("get_file_by_path")

	var file MediaFile
	var modTime int64

	err := d.stmts.getFileByPath.QueryRowContext(ctx, path).Scan(
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	done := observeQuery("rebuild_fts")
	_, err := d.writer.ExecContext(ctx, "INSERT INTO files_fts(files_fts) VALUES('rebuild')")
	done(err)

	return err
}

// BulkIndexBegin prepares the database for a bulk indexing operation.
//
// It drops the three FTS5 maintenance triggers (files_ai / files_au / files_ad)
// so that per-row FTS updates are skipped during batch upserts. For a 40 k-file
// library each upsert would otherwise fire an AFTER UPDATE trigger that deletes
// + re-inserts into files_fts with trigram tokenisation — 80 000 FTS writes that
// bloat the WAL and make concurrent reads crawl.
//
// Always pair with BulkIndexEnd, which rebuilds FTS from the source table in one
// pass and restores the triggers.
func (d *Database) BulkIndexBegin(ctx context.Context) error {
	dropStmts := []string{
		"DROP TRIGGER IF EXISTS files_ai",
		"DROP TRIGGER IF EXISTS files_au",
		"DROP TRIGGER IF EXISTS files_ad",
	}
	done := observeQuery("bulk_index_begin")
	var firstErr error
	for _, stmt := range dropStmts {
		if _, err := d.writer.ExecContext(ctx, stmt); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("drop FTS trigger (%s): %w", stmt, err)
		}
	}
	done(firstErr)
	return firstErr
}

// BulkIndexEnd rebuilds the FTS index from the files table in a single pass and
// restores the FTS maintenance triggers.  Must be called after BulkIndexBegin.
func (d *Database) BulkIndexEnd(ctx context.Context) error {
	// Give the rebuild a generous timeout — on a 40 k-file library it can take
	// a few seconds, and on NFS-backed storage even longer.
	rebuildCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	done := observeQuery("bulk_index_end_rebuild")
	_, rebuildErr := d.writer.ExecContext(rebuildCtx, "INSERT INTO files_fts(files_fts) VALUES('rebuild')")
	done(rebuildErr)
	if rebuildErr != nil {
		logging.Error("FTS rebuild after bulk index failed: %v", rebuildErr)
		// Still try to restore triggers so incremental updates work going forward.
	}

	// Recreate triggers one statement at a time (go-sqlite3 / database/sql do not
	// reliably execute multi-statement strings via ExecContext).
	triggerStmts := []string{
		`CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
			INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
		END`,
		`CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
			INSERT INTO files_fts(files_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
		END`,
		`CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
			INSERT INTO files_fts(files_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
			INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
		END`,
	}
	done2 := observeQuery("bulk_index_end_triggers")
	var triggerErr error
	for _, stmt := range triggerStmts {
		if _, err := d.writer.ExecContext(ctx, stmt); err != nil && triggerErr == nil {
			triggerErr = fmt.Errorf("restore FTS trigger: %w", err)
		}
	}
	done2(triggerErr)

	return errors.Join(rebuildErr, triggerErr)
}

// Vacuum optimizes the database.
func (d *Database) Vacuum() error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	done := observeQuery("vacuum")
	_, err := d.writer.ExecContext(ctx, "VACUUM")
	done(err)

	return err
}

// UpdateDBMetrics updates database connection metrics.
func (d *Database) UpdateDBMetrics() {
	rStats := d.reader.Stats()
	wStats := d.writer.Stats()
	metrics.DBConnectionsOpen.Set(float64(rStats.OpenConnections + wStats.OpenConnections))
}

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
