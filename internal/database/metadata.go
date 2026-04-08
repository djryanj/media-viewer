package database

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// GetMetadata retrieves a metadata value by key.
func (d *Database) GetMetadata(ctx context.Context, key string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var value string
	err := d.reader.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key = ?", key).Scan(&value)
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
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.writer.ExecContext(ctx, `
		INSERT INTO metadata (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, value)
	return err
}

// GetLastThumbnailRun returns the timestamp of the last thumbnail generation run.
func (d *Database) GetLastThumbnailRun(ctx context.Context) (time.Time, error) {
	value, err := d.GetMetadata(ctx, "last_thumbnail_run")
	if errors.Is(err, sql.ErrNoRows) {
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
		return d.SetMetadata(ctx, "last_thumbnail_run", "")
	}
	return d.SetMetadata(ctx, "last_thumbnail_run", t.Format(time.RFC3339))
}

// GetLastExifTagRun returns the timestamp of the last EXIF auto-tagging run.
func (d *Database) GetLastExifTagRun(ctx context.Context) (time.Time, error) {
	value, err := d.GetMetadata(ctx, "last_exif_tag_run")
	if errors.Is(err, sql.ErrNoRows) {
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

// SetLastExifTagRun stores the timestamp of the last EXIF auto-tagging run.
func (d *Database) SetLastExifTagRun(ctx context.Context, t time.Time) error {
	if t.IsZero() {
		return d.SetMetadata(ctx, "last_exif_tag_run", "")
	}
	return d.SetMetadata(ctx, "last_exif_tag_run", t.Format(time.RFC3339))
}
