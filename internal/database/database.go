package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Database struct {
	db      *sql.DB
	dbPath  string
	mu      sync.RWMutex
	stats   IndexStats
	statsMu sync.RWMutex
}

func New(cacheDir string) (*Database, error) {
	absCacheDir, err := filepath.Abs(cacheDir)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve cache directory path: %w", err)
	}

	log.Printf("  Creating cache directory: %s", absCacheDir)
	if err := os.MkdirAll(absCacheDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create cache directory: %w", err)
	}

	if info, err := os.Stat(absCacheDir); err != nil {
		return nil, fmt.Errorf("cache directory does not exist after creation: %w", err)
	} else if !info.IsDir() {
		return nil, fmt.Errorf("cache path exists but is not a directory: %s", absCacheDir)
	}

	dbPath := filepath.Join(absCacheDir, "media.db")
	log.Printf("  Database path: %s", dbPath)

	// Use WAL mode and other optimizations
	// busy_timeout helps prevent "database is locked" errors
	connStr := fmt.Sprintf("%s?_journal_mode=WAL&_synchronous=NORMAL&_cache_size=10000&_temp_store=MEMORY&_busy_timeout=5000", dbPath)

	db, err := sql.Open("sqlite3", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Allow multiple readers
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(time.Hour)

	d := &Database{
		db:     db,
		dbPath: dbPath,
	}

	if err := d.initialize(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to initialize database schema: %w", err)
	}

	log.Printf("  Database initialized successfully at %s", dbPath)
	return d, nil
}

func (d *Database) initialize() error {
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
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);

	CREATE INDEX IF NOT EXISTS idx_files_parent_path ON files(parent_path);
	CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);
	CREATE INDEX IF NOT EXISTS idx_files_mod_time ON files(mod_time);
	CREATE INDEX IF NOT EXISTS idx_files_name ON files(name COLLATE NOCASE);

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

	-- Users table
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
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

	_, err := d.db.Exec(schema)
	return err
}

func (d *Database) Close() error {
	return d.db.Close()
}

// BeginBatch starts a transaction for batch operations
func (d *Database) BeginBatch() (*sql.Tx, error) {
	d.mu.Lock()
	tx, err := d.db.Begin()
	if err != nil {
		d.mu.Unlock()
		return nil, err
	}
	return tx, nil
}

// EndBatch commits or rolls back a transaction
func (d *Database) EndBatch(tx *sql.Tx, err error) error {
	defer d.mu.Unlock()
	if err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// UpsertFile inserts or updates a file record
func (d *Database) UpsertFile(tx *sql.Tx, file *MediaFile) error {
	query := `
	INSERT INTO files (name, path, parent_path, type, size, mod_time, mime_type, file_hash, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
	ON CONFLICT(path) DO UPDATE SET
		name = excluded.name,
		type = excluded.type,
		size = excluded.size,
		mod_time = excluded.mod_time,
		mime_type = excluded.mime_type,
		file_hash = excluded.file_hash,
		updated_at = strftime('%s', 'now')
	`

	_, err := tx.Exec(query,
		file.Name,
		file.Path,
		file.ParentPath,
		file.Type,
		file.Size,
		file.ModTime.Unix(),
		file.MimeType,
		file.FileHash,
	)
	return err
}

// DeleteMissingFiles removes files that weren't seen during indexing
func (d *Database) DeleteMissingFiles(tx *sql.Tx, cutoffTime time.Time) (int64, error) {
	result, err := tx.Exec("DELETE FROM files WHERE updated_at < ?", cutoffTime.Unix())
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// GetFileByPath retrieves a single file by path
func (d *Database) GetFileByPath(path string) (*MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	query := `
	SELECT id, name, path, parent_path, type, size, mod_time, mime_type
	FROM files WHERE path = ?
	`

	var file MediaFile
	var modTime int64

	err := d.db.QueryRow(query, path).Scan(
		&file.ID, &file.Name, &file.Path, &file.ParentPath,
		&file.Type, &file.Size, &modTime, &file.MimeType,
	)
	if err != nil {
		return nil, err
	}

	file.ModTime = time.Unix(modTime, 0)
	return &file, nil
}

// UpdateStats updates the cached statistics
func (d *Database) UpdateStats(stats IndexStats) {
	d.statsMu.Lock()
	defer d.statsMu.Unlock()
	d.stats = stats
}

// GetStats returns the current index statistics
func (d *Database) GetStats() IndexStats {
	d.statsMu.RLock()
	defer d.statsMu.RUnlock()
	return d.stats
}

// RebuildFTS rebuilds the full-text search index
func (d *Database) RebuildFTS() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("INSERT INTO files_fts(files_fts) VALUES('rebuild')")
	return err
}

// Vacuum optimizes the database
func (d *Database) Vacuum() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("VACUUM")
	return err
}
