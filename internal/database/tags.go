package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"media-viewer/internal/logging"
)

// GetOrCreateTag gets an existing tag or creates a new one.
func (d *Database) GetOrCreateTag(ctx context.Context, name string) (*Tag, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("tag name cannot be empty")
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
	done := observeQuery("add_tag_to_file")

	tagName = strings.TrimSpace(tagName)
	if tagName == "" {
		err := errors.New("tag name cannot be empty")
		done(err)
		return err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Get or create tag within the same lock
	var tagID int64
	err := d.db.QueryRowContext(ctx,
		"SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
		tagName,
	).Scan(&tagID)

	if err != nil {
		// Create new tag
		result, createErr := d.db.ExecContext(ctx, "INSERT INTO tags (name) VALUES (?)", tagName)
		if createErr != nil {
			err = fmt.Errorf("failed to create tag: %w", createErr)
			done(err)
			return err
		}
		tagID, _ = result.LastInsertId()
	}

	_, err = d.db.ExecContext(ctx,
		"INSERT OR IGNORE INTO file_tags (file_path, tag_id) VALUES (?, ?)",
		filePath, tagID,
	)
	done(err)
	return err
}

// RemoveTagFromFile removes a tag from a file.
func (d *Database) RemoveTagFromFile(ctx context.Context, filePath, tagName string) error {
	done := observeQuery("remove_tag_from_file")

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, `
		DELETE FROM file_tags
		WHERE file_path = ? AND tag_id = (SELECT id FROM tags WHERE name = ? COLLATE NOCASE)
	`, filePath, tagName)

	done(err)
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
	done := observeQuery("set_file_tags")

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		done(err)
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
		done(err)
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
				done(err)
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
			done(err)
			return err
		}
	}

	if commitErr := tx.Commit(); commitErr != nil {
		done(commitErr)
		return commitErr
	}
	committed = true
	done(nil)
	return nil
}

// GetAllTags returns all tags with item counts.
func (d *Database) GetAllTags(ctx context.Context) ([]Tag, error) {
	done := observeQuery("get_all_tags")

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
		done(err)
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

	done(nil)
	return tags, nil
}

// GetFilesByTag returns all files with a specific tag.
func (d *Database) GetFilesByTag(ctx context.Context, tagName string, page, pageSize int) (*SearchResult, error) {
	done := observeQuery("get_files_by_tag")

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
	err := d.db.QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT ft.file_path)
		FROM file_tags ft
		INNER JOIN tags t ON ft.tag_id = t.id
		WHERE t.name = ? COLLATE NOCASE
	`, tagName).Scan(&totalItems)
	if err != nil {
		done(err)
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
		done(err)
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

	done(nil)
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
	done := observeQuery("delete_tag")

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, "DELETE FROM tags WHERE name = ? COLLATE NOCASE", tagName)
	done(err)
	return err
}

// RenameTag renames a tag.
func (d *Database) RenameTag(ctx context.Context, oldName, newName string) error {
	done := observeQuery("rename_tag")

	newName = strings.TrimSpace(newName)
	if newName == "" {
		err := errors.New("tag name cannot be empty")
		done(err)
		return err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(
		ctx,
		"UPDATE tags SET name = ? WHERE name = ? COLLATE NOCASE",
		newName, oldName,
	)
	done(err)
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

// TagWithCount represents a tag with its usage count.
type TagWithCount struct {
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
	Count int    `json:"count"`
}

// GetAllTagsWithCounts returns all tags with their usage counts.
func (d *Database) GetAllTagsWithCounts(ctx context.Context) ([]TagWithCount, error) {
	done := observeQuery("get_all_tags_with_counts")

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	query := `
		SELECT t.name, COALESCE(t.color, ''), COUNT(ft.id) as count
		FROM tags t
		LEFT JOIN file_tags ft ON t.id = ft.tag_id
		GROUP BY t.id, t.name, t.color
		ORDER BY count DESC, t.name COLLATE NOCASE
	`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		done(err)
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var tags []TagWithCount
	for rows.Next() {
		var tag TagWithCount
		if err := rows.Scan(&tag.Name, &tag.Color, &tag.Count); err != nil {
			done(err)
			return nil, err
		}
		tags = append(tags, tag)
	}

	if err := rows.Err(); err != nil {
		done(err)
		return nil, err
	}

	done(nil)
	return tags, nil
}

// GetUnusedTags returns tags that are not associated with any files.
func (d *Database) GetUnusedTags(ctx context.Context) ([]string, error) {
	done := observeQuery("get_unused_tags")

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	query := `
		SELECT t.name
		FROM tags t
		LEFT JOIN file_tags ft ON t.id = ft.tag_id
		WHERE ft.id IS NULL
		ORDER BY t.name COLLATE NOCASE
	`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		done(err)
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var tags []string
	for rows.Next() {
		var tagName string
		if err := rows.Scan(&tagName); err != nil {
			done(err)
			return nil, err
		}
		tags = append(tags, tagName)
	}

	if err := rows.Err(); err != nil {
		done(err)
		return nil, err
	}

	done(nil)
	return tags, nil
}

// RenameTagEverywhere renames a tag and updates all file associations.
func (d *Database) RenameTagEverywhere(ctx context.Context, oldName, newName string) (int, error) {
	done := observeQuery("rename_tag_everywhere")

	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)

	if oldName == "" || newName == "" {
		err := errors.New("tag names cannot be empty")
		done(err)
		return 0, err
	}

	// Allow case-only changes, only skip if names are exactly identical
	if oldName == newName {
		done(nil)
		return 0, nil // No change needed
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Start transaction
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck

	// Check if new tag name already exists
	var existingID int64
	err = tx.QueryRowContext(ctx,
		"SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
		newName,
	).Scan(&existingID)

	switch {
	case err == nil:
		// Target tag exists, check if it's the same tag (case-only change)
		var oldID int64
		err = tx.QueryRowContext(ctx,
			"SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
			oldName,
		).Scan(&oldID)
		if err != nil {
			err = fmt.Errorf("old tag not found: %w", err)
			done(err)
			return 0, err
		}

		if existingID == oldID {
			// Same tag, just update the case
			_, err = tx.ExecContext(ctx,
				"UPDATE tags SET name = ? WHERE id = ?",
				newName, oldID,
			)
			if err != nil {
				err = fmt.Errorf("failed to update tag case: %w", err)
				done(err)
				return 0, err
			}
		} else {
			// Different tags, we need to merge
			// Move all file_tags from old tag to new tag (skip duplicates)
			_, err = tx.ExecContext(ctx, `
				INSERT OR IGNORE INTO file_tags (file_path, tag_id, created_at)
				SELECT file_path, ?, created_at
				FROM file_tags
				WHERE tag_id = ?
			`, existingID, oldID)
			if err != nil {
				err = fmt.Errorf("failed to merge file tags: %w", err)
				done(err)
				return 0, err
			}

			// Delete old tag (cascade will remove old file_tags)
			_, err = tx.ExecContext(ctx,
				"DELETE FROM tags WHERE id = ?",
				oldID,
			)
			if err != nil {
				err = fmt.Errorf("failed to delete old tag: %w", err)
				done(err)
				return 0, err
			}
		}
	case errors.Is(err, sql.ErrNoRows):
		// Target tag doesn't exist, simple rename
		_, err = tx.ExecContext(ctx,
			"UPDATE tags SET name = ? WHERE name = ? COLLATE NOCASE",
			newName, oldName,
		)
		if err != nil {
			err = fmt.Errorf("failed to rename tag: %w", err)
			done(err)
			return 0, err
		}
	default:
		done(err)
		return 0, err
	}

	// Get count of affected files
	var count int
	err = tx.QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT ft.file_path)
		FROM file_tags ft
		INNER JOIN tags t ON ft.tag_id = t.id
		WHERE t.name = ? COLLATE NOCASE
	`, newName).Scan(&count)
	if err != nil {
		err = fmt.Errorf("failed to count affected files: %w", err)
		done(err)
		return 0, err
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		done(err)
		return 0, err
	}

	logging.Info("Renamed tag '%s' to '%s', affecting %d files", oldName, newName, count)
	done(nil)
	return count, nil
}

// DeleteTagEverywhere removes a tag and all its file associations.
func (d *Database) DeleteTagEverywhere(ctx context.Context, tagName string) (int, error) {
	done := observeQuery("delete_tag_everywhere")

	tagName = strings.TrimSpace(tagName)
	if tagName == "" {
		err := errors.New("tag name cannot be empty")
		done(err)
		return 0, err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Start transaction
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck

	// Get count of affected files before deletion
	var count int
	err = tx.QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT ft.file_path)
		FROM file_tags ft
		INNER JOIN tags t ON ft.tag_id = t.id
		WHERE t.name = ? COLLATE NOCASE
	`, tagName).Scan(&count)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		err = fmt.Errorf("failed to count affected files: %w", err)
		done(err)
		return 0, err
	}

	// Delete the tag (CASCADE will remove file_tags)
	result, err := tx.ExecContext(ctx,
		"DELETE FROM tags WHERE name = ? COLLATE NOCASE",
		tagName,
	)
	if err != nil {
		err = fmt.Errorf("failed to delete tag: %w", err)
		done(err)
		return 0, err
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		err = fmt.Errorf("tag not found: %s", tagName)
		done(err)
		return 0, err
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		done(err)
		return 0, err
	}

	logging.Info("Deleted tag '%s' from %d files", tagName, count)
	done(nil)
	return count, nil
}
