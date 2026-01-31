package database

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"media-viewer/internal/logging"
)

// GetOrCreateTag gets an existing tag or creates a new one.
func (d *Database) GetOrCreateTag(ctx context.Context, name string) (*Tag, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("tag name cannot be empty")
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Try to get existing tag
	var tag Tag
	var createdAt int64
	var color sql.NullString

	err := d.db.QueryRowContext(ctx,
		"SELECT id, name, color, created_at FROM tags WHERE name = ? COLLATE NOCASE",
		name,
	).Scan(&tag.ID, &tag.Name, &color, &createdAt)

	if err == nil {
		tag.CreatedAt = time.Unix(createdAt, 0)
		if color.Valid {
			tag.Color = color.String
		}
		return &tag, nil
	}

	// Create new tag
	result, err := d.db.ExecContext(ctx,
		"INSERT INTO tags (name) VALUES (?)",
		name,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create tag: %w", err)
	}

	tag.ID, _ = result.LastInsertId()
	tag.Name = name
	tag.CreatedAt = time.Now()

	return &tag, nil
}

// AddTagToFile adds a tag to a file.
func (d *Database) AddTagToFile(ctx context.Context, filePath, tagName string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("add_tag_to_file", start, err) }()

	tagName = strings.TrimSpace(tagName)
	if tagName == "" {
		err = fmt.Errorf("tag name cannot be empty")
		return err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Get or create tag within the same lock
	var tagID int64
	err = d.db.QueryRowContext(ctx,
		"SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
		tagName,
	).Scan(&tagID)

	if err != nil {
		// Create new tag
		result, createErr := d.db.ExecContext(ctx, "INSERT INTO tags (name) VALUES (?)", tagName)
		if createErr != nil {
			err = fmt.Errorf("failed to create tag: %w", createErr)
			return err
		}
		tagID, _ = result.LastInsertId()
	}

	_, err = d.db.ExecContext(ctx,
		"INSERT OR IGNORE INTO file_tags (file_path, tag_id) VALUES (?, ?)",
		filePath, tagID,
	)
	return err
}

// RemoveTagFromFile removes a tag from a file.
func (d *Database) RemoveTagFromFile(ctx context.Context, filePath, tagName string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("remove_tag_from_file", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err = d.db.ExecContext(ctx, `
		DELETE FROM file_tags
		WHERE file_path = ? AND tag_id = (SELECT id FROM tags WHERE name = ? COLLATE NOCASE)
	`, filePath, tagName)

	return err
}

// GetFileTags returns all tags for a file.
func (d *Database) GetFileTags(ctx context.Context, filePath string) ([]string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	return d.getFileTagsUnlocked(ctx, filePath)
}

// getFileTagsUnlocked returns tags without acquiring lock.
// Caller must hold at least a read lock.
func (d *Database) getFileTagsUnlocked(ctx context.Context, filePath string) ([]string, error) {
	rows, err := d.db.QueryContext(ctx, `
		SELECT t.name
		FROM tags t
		INNER JOIN file_tags ft ON t.id = ft.tag_id
		WHERE ft.file_path = ?
		ORDER BY t.name COLLATE NOCASE
	`, filePath)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	var tags []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			tags = append(tags, name)
		}
	}

	return tags, nil
}

// SetFileTags replaces all tags for a file.
func (d *Database) SetFileTags(ctx context.Context, filePath string, tagNames []string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("set_file_tags", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	committed := false
	defer func() {
		if !committed {
			if rbErr := tx.Rollback(); rbErr != nil {
				logging.Error("rollback failed: %v", rbErr)
			}
		}
	}()

	// Remove existing tags
	_, err = tx.ExecContext(ctx, "DELETE FROM file_tags WHERE file_path = ?", filePath)
	if err != nil {
		return err
	}

	// Add new tags
	for _, tagName := range tagNames {
		tagName = strings.TrimSpace(tagName)
		if tagName == "" {
			continue
		}

		// Get or create tag
		var tagID int64
		err = tx.QueryRowContext(ctx, "SELECT id FROM tags WHERE name = ? COLLATE NOCASE", tagName).Scan(&tagID)
		if err != nil {
			// Create tag
			result, createErr := tx.ExecContext(ctx, "INSERT INTO tags (name) VALUES (?)", tagName)
			if createErr != nil {
				err = createErr
				return err
			}
			tagID, _ = result.LastInsertId()
		}

		// Add relationship
		_, err = tx.ExecContext(ctx,
			"INSERT OR IGNORE INTO file_tags (file_path, tag_id) VALUES (?, ?)",
			filePath, tagID,
		)
		if err != nil {
			return err
		}
	}

	if commitErr := tx.Commit(); commitErr != nil {
		err = commitErr
		return commitErr
	}
	committed = true
	return nil
}

// GetAllTags returns all tags with item counts.
func (d *Database) GetAllTags(ctx context.Context) ([]Tag, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("get_all_tags", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.db.QueryContext(ctx, `
		SELECT t.id, t.name, t.color, t.created_at, COUNT(ft.id) as item_count
		FROM tags t
		LEFT JOIN file_tags ft ON t.id = ft.tag_id
		GROUP BY t.id
		ORDER BY t.name COLLATE NOCASE
	`)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	var tags []Tag
	for rows.Next() {
		var tag Tag
		var createdAt int64
		var color sql.NullString

		if err := rows.Scan(&tag.ID, &tag.Name, &color, &createdAt, &tag.ItemCount); err != nil {
			continue
		}

		tag.CreatedAt = time.Unix(createdAt, 0)
		if color.Valid {
			tag.Color = color.String
		}

		tags = append(tags, tag)
	}

	return tags, nil
}

// GetFilesByTag returns all files with a specific tag.
func (d *Database) GetFilesByTag(ctx context.Context, tagName string, page, pageSize int) (*SearchResult, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("get_files_by_tag", start, err) }()

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}

	d.mu.RLock()
	defer d.mu.RUnlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// Get total count
	var totalItems int
	err = d.db.QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT ft.file_path)
		FROM file_tags ft
		INNER JOIN tags t ON ft.tag_id = t.id
		WHERE t.name = ? COLLATE NOCASE
	`, tagName).Scan(&totalItems)
	if err != nil {
		return nil, err
	}

	totalPages := (totalItems + pageSize - 1) / pageSize
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (page - 1) * pageSize

	// Get files
	rows, err := d.db.QueryContext(ctx, `
		SELECT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type
		FROM files f
		INNER JOIN file_tags ft ON f.path = ft.file_path
		INNER JOIN tags t ON ft.tag_id = t.id
		WHERE t.name = ? COLLATE NOCASE
		ORDER BY f.name COLLATE NOCASE
		LIMIT ? OFFSET ?
	`, tagName, pageSize, offset)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	var items []MediaFile
	for rows.Next() {
		var file MediaFile
		var modTime int64
		var mimeType sql.NullString

		if err := rows.Scan(
			&file.ID, &file.Name, &file.Path, &file.ParentPath,
			&file.Type, &file.Size, &modTime, &mimeType,
		); err != nil {
			continue
		}

		file.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			file.MimeType = mimeType.String
		}

		if file.Type == FileTypeImage || file.Type == FileTypeVideo {
			file.ThumbnailURL = "/api/thumbnail/" + file.Path
		}

		// Use unlocked versions since we already hold the lock
		tags, _ := d.getFileTagsUnlocked(ctx, file.Path)
		file.Tags = tags
		file.IsFavorite = d.isFavoriteUnlocked(ctx, file.Path)

		items = append(items, file)
	}

	return &SearchResult{
		Items:      items,
		Query:      "tag:" + tagName,
		TotalItems: totalItems,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

// DeleteTag removes a tag and all its associations.
func (d *Database) DeleteTag(ctx context.Context, tagName string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("delete_tag", start, err) }()

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err = d.db.ExecContext(ctx, "DELETE FROM tags WHERE name = ? COLLATE NOCASE", tagName)
	return err
}

// RenameTag renames a tag.
func (d *Database) RenameTag(ctx context.Context, oldName, newName string) error {
	start := time.Now()
	var err error
	defer func() { recordQuery("rename_tag", start, err) }()

	newName = strings.TrimSpace(newName)
	if newName == "" {
		err = fmt.Errorf("tag name cannot be empty")
		return err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err = d.db.ExecContext(
		ctx,
		"UPDATE tags SET name = ? WHERE name = ? COLLATE NOCASE",
		newName, oldName,
	)
	return err
}

// SetTagColor sets the color for a tag.
func (d *Database) SetTagColor(ctx context.Context, tagName, color string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(
		ctx,
		"UPDATE tags SET color = ? WHERE name = ? COLLATE NOCASE",
		color, tagName,
	)
	return err
}

// GetTagCount returns the total number of tags.
func (d *Database) GetTagCount(ctx context.Context) int {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	if err := d.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM tags").Scan(&count); err != nil {
		return 0
	}
	return count
}
