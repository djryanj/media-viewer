package database

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// GetMetadata retrieves a metadata value by key.
// Returns error if the key doesn't exist.
func (d *Database) GetMetadata(ctx context.Context, key string) (string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var value string
	err := d.db.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", sql.ErrNoRows
	}
	if err != nil {
		return "", err
	}
	return value, nil
}

// SetMetadata sets a metadata key-value pair.
func (d *Database) SetMetadata(ctx context.Context, key, value string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, `
		INSERT INTO metadata (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, value)
	return err
}

// GetLastThumbnailRun returns the timestamp of the last thumbnail generation run.
// Returns zero time if never run.
func (d *Database) GetLastThumbnailRun(ctx context.Context) (time.Time, error) {
	value, err := d.GetMetadata(ctx, "last_thumbnail_run")
	if errors.Is(err, sql.ErrNoRows) {
		// Key doesn't exist, never run
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	if value == "" {
		return time.Time{}, nil
	}

	timestamp, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, err
	}
	return timestamp, nil
}

// SetLastThumbnailRun stores the timestamp of the last thumbnail generation run.
func (d *Database) SetLastThumbnailRun(ctx context.Context, t time.Time) error {
	if t.IsZero() {
		// Clear the value
		return d.SetMetadata(ctx, "last_thumbnail_run", "")
	}
	return d.SetMetadata(ctx, "last_thumbnail_run", t.Format(time.RFC3339))
}
