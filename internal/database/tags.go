package database

import (
	"context"
	"database/sql"
	"encoding/json"
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

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	// Try reader first
	var tag Tag
	var createdAt int64
	var color sql.NullString

	err := d.reader.QueryRowContext(ctx,
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

	// Create via writer
	result, err := d.writer.ExecContext(ctx,
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
	done := d.observeQuery("add_tag_to_file")

	tagName = strings.TrimSpace(tagName)
	if tagName == "" {
		err := errors.New("tag name cannot be empty")
		done(err)
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var tagID int64
	err = tx.QueryRowContext(ctx,
		"SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
		tagName,
	).Scan(&tagID)

	if err != nil {
		result, createErr := tx.ExecContext(ctx, "INSERT INTO tags (name) VALUES (?)", tagName)
		if createErr != nil {
			err = fmt.Errorf("failed to create tag: %w", createErr)
			done(err)
			return err
		}
		tagID, _ = result.LastInsertId()
	}

	_, err = tx.ExecContext(ctx,
		"INSERT OR IGNORE INTO file_tags (file_path, tag_id) VALUES (?, ?)",
		filePath, tagID,
	)
	if err != nil {
		done(err)
		return err
	}

	// A user explicitly (re-)adding a tag clears any earlier removal tombstone,
	// so a later autotagger pass is free to keep it.
	if err = clearRemovedTagTombstone(ctx, tx, filePath, tagID); err != nil {
		done(err)
		return err
	}

	if commitErr := tx.Commit(); commitErr != nil {
		done(commitErr)
		return commitErr
	}

	done(nil)
	return nil
}

// RemoveTagFromFile removes a tag from a file. If the tag was actually
// present, the removal is tombstoned in removed_tags so that a later
// autotagger pass (MergeExifTagsForFile) does not resurrect it from the
// file's still-unchanged EXIF/XMP metadata.
func (d *Database) RemoveTagFromFile(ctx context.Context, filePath, tagName string) error {
	done := d.observeQuery("remove_tag_from_file")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var tagID int64
	err = tx.QueryRowContext(ctx,
		"SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
		tagName,
	).Scan(&tagID)
	if errors.Is(err, sql.ErrNoRows) {
		// Tag doesn't exist at all — nothing to remove or tombstone.
		done(nil)
		return tx.Commit()
	}
	if err != nil {
		done(err)
		return err
	}

	result, err := tx.ExecContext(ctx,
		"DELETE FROM file_tags WHERE file_path = ? AND tag_id = ?",
		filePath, tagID,
	)
	if err != nil {
		done(err)
		return err
	}

	if rows, _ := result.RowsAffected(); rows > 0 {
		if err = tombstoneRemovedTag(ctx, tx, filePath, tagID); err != nil {
			done(err)
			return err
		}
	}

	if commitErr := tx.Commit(); commitErr != nil {
		done(commitErr)
		return commitErr
	}

	done(nil)
	return nil
}

// tombstoneRemovedTag records that tagID was explicitly removed from filePath
// by a user action, so MergeExifTagsForFile does not resurrect it later.
func tombstoneRemovedTag(ctx context.Context, tx *sql.Tx, filePath string, tagID int64) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO removed_tags (file_path, tag_id, removed_at)
		VALUES (?, ?, strftime('%s', 'now'))
		ON CONFLICT(file_path, tag_id) DO UPDATE SET removed_at = excluded.removed_at
	`, filePath, tagID)
	return err
}

// clearRemovedTagTombstone removes any removal tombstone for (filePath, tagID).
// Called whenever a user action explicitly (re-)adds the tag, so the pairing
// is treated as intentional again.
func clearRemovedTagTombstone(ctx context.Context, tx *sql.Tx, filePath string, tagID int64) error {
	_, err := tx.ExecContext(ctx,
		"DELETE FROM removed_tags WHERE file_path = ? AND tag_id = ?",
		filePath, tagID,
	)
	return err
}

// GetFileTags returns all tags for a file.
func (d *Database) GetFileTags(ctx context.Context, filePath string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.reader.QueryContext(ctx, `
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
	done := d.observeQuery("set_file_tags")

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
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

	previousIDs, err := previousFileTagIDs(ctx, tx, filePath)
	if err != nil {
		done(err)
		return err
	}

	_, err = tx.ExecContext(ctx, "DELETE FROM file_tags WHERE file_path = ?", filePath)
	if err != nil {
		done(err)
		return err
	}

	newIDs := make(map[int64]bool)
	for _, tagName := range tagNames {
		tagName = strings.TrimSpace(tagName)
		if tagName == "" {
			continue
		}

		var tagID int64
		err = tx.QueryRowContext(ctx, "SELECT id FROM tags WHERE name = ? COLLATE NOCASE", tagName).Scan(&tagID)
		if err != nil {
			result, createErr := tx.ExecContext(ctx, "INSERT INTO tags (name) VALUES (?)", tagName)
			if createErr != nil {
				err = createErr
				done(err)
				return err
			}
			tagID, _ = result.LastInsertId()
		}
		newIDs[tagID] = true

		_, err = tx.ExecContext(ctx,
			"INSERT OR IGNORE INTO file_tags (file_path, tag_id) VALUES (?, ?)",
			filePath, tagID,
		)
		if err != nil {
			done(err)
			return err
		}
	}

	// Tags dropped from the new list are tombstoned so the autotagger does not
	// resurrect them; tags kept or newly added have any earlier tombstone cleared.
	if err = applyTagRemovalTombstones(ctx, tx, filePath, previousIDs, newIDs); err != nil {
		done(err)
		return err
	}

	if commitErr := tx.Commit(); commitErr != nil {
		done(commitErr)
		return commitErr
	}
	committed = true
	done(nil)
	return nil
}

// previousFileTagIDs returns the set of tag IDs currently linked to filePath.
func previousFileTagIDs(ctx context.Context, tx *sql.Tx, filePath string) (map[int64]bool, error) {
	rows, err := tx.QueryContext(ctx, "SELECT tag_id FROM file_tags WHERE file_path = ?", filePath)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	ids := make(map[int64]bool)
	for rows.Next() {
		var id int64
		if scanErr := rows.Scan(&id); scanErr == nil {
			ids[id] = true
		}
	}
	return ids, rows.Err()
}

// applyTagRemovalTombstones tombstones tag IDs present in previousIDs but
// absent from newIDs, and clears any tombstone for tag IDs present in newIDs.
func applyTagRemovalTombstones(ctx context.Context, tx *sql.Tx, filePath string, previousIDs, newIDs map[int64]bool) error {
	for id := range previousIDs {
		if !newIDs[id] {
			if err := tombstoneRemovedTag(ctx, tx, filePath, id); err != nil {
				return err
			}
		}
	}
	for id := range newIDs {
		if err := clearRemovedTagTombstone(ctx, tx, filePath, id); err != nil {
			return err
		}
	}
	return nil
}

// GetAllTags returns all tags with item counts.
func (d *Database) GetAllTags(ctx context.Context) ([]Tag, error) {
	done := d.observeQuery("get_all_tags")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.reader.QueryContext(ctx, `
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
	done := d.observeQuery("get_files_by_tag")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var totalItems int
	err := d.reader.QueryRowContext(ctx, `
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

	rows, err := d.reader.QueryContext(ctx, `
		SELECT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type,
		       EXISTS(SELECT 1 FROM favorites WHERE path = f.path) AS is_favorite,
		       (SELECT GROUP_CONCAT(t2.name, ',')
		        FROM file_tags ft2
		        JOIN tags t2 ON ft2.tag_id = t2.id
		        WHERE ft2.file_path = f.path) AS tags
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
		var isFavorite int
		var tagsString sql.NullString

		if err := rows.Scan(
			&file.ID, &file.Name, &file.Path, &file.ParentPath,
			&file.Type, &file.Size, &modTime, &mimeType,
			&isFavorite, &tagsString,
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

		file.IsFavorite = isFavorite == 1

		if tagsString.Valid && tagsString.String != "" {
			file.Tags = strings.Split(tagsString.String, ",")
		}

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
	done := d.observeQuery("delete_tag")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.writer.ExecContext(ctx, "DELETE FROM tags WHERE name = ? COLLATE NOCASE", tagName)
	done(err)
	return err
}

// RenameTag renames a tag.
func (d *Database) RenameTag(ctx context.Context, oldName, newName string) error {
	done := d.observeQuery("rename_tag")

	newName = strings.TrimSpace(newName)
	if newName == "" {
		err := errors.New("tag name cannot be empty")
		done(err)
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.writer.ExecContext(ctx,
		"UPDATE tags SET name = ? WHERE name = ? COLLATE NOCASE",
		newName, oldName,
	)
	done(err)
	return err
}

// SetTagColor sets the color for a tag.
func (d *Database) SetTagColor(ctx context.Context, tagName, color string) error {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.writer.ExecContext(ctx,
		"UPDATE tags SET color = ? WHERE name = ? COLLATE NOCASE",
		color, tagName,
	)
	return err
}

// GetTagCount returns the total number of tags.
func (d *Database) GetTagCount(ctx context.Context) int {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	if err := d.reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM tags").Scan(&count); err != nil {
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
	done := d.observeQuery("get_all_tags_with_counts")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.reader.QueryContext(ctx, `
		SELECT t.name, COALESCE(t.color, ''), COUNT(ft.id) as count
		FROM tags t
		LEFT JOIN file_tags ft ON t.id = ft.tag_id
		GROUP BY t.id, t.name, t.color
		ORDER BY count DESC, t.name COLLATE NOCASE
	`)
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
	done := d.observeQuery("get_unused_tags")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.reader.QueryContext(ctx, `
		SELECT t.name
		FROM tags t
		LEFT JOIN file_tags ft ON t.id = ft.tag_id
		WHERE ft.id IS NULL
		ORDER BY t.name COLLATE NOCASE
	`)
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
	done := d.observeQuery("rename_tag_everywhere")

	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)

	if oldName == "" || newName == "" {
		err := errors.New("tag names cannot be empty")
		done(err)
		return 0, err
	}

	if oldName == newName {
		done(nil)
		return 0, nil
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck

	var existingID int64
	err = tx.QueryRowContext(ctx,
		"SELECT id FROM tags WHERE name = ? COLLATE NOCASE", newName,
	).Scan(&existingID)

	switch {
	case err == nil:
		var oldID int64
		err = tx.QueryRowContext(ctx,
			"SELECT id FROM tags WHERE name = ? COLLATE NOCASE", oldName,
		).Scan(&oldID)
		if err != nil {
			err = fmt.Errorf("old tag not found: %w", err)
			done(err)
			return 0, err
		}

		if existingID == oldID {
			_, err = tx.ExecContext(ctx, "UPDATE tags SET name = ? WHERE id = ?", newName, oldID)
			if err != nil {
				err = fmt.Errorf("failed to update tag case: %w", err)
				done(err)
				return 0, err
			}
		} else {
			_, err = tx.ExecContext(ctx, `
				INSERT OR IGNORE INTO file_tags (file_path, tag_id, created_at)
				SELECT file_path, ?, created_at FROM file_tags WHERE tag_id = ?
			`, existingID, oldID)
			if err != nil {
				err = fmt.Errorf("failed to merge file tags: %w", err)
				done(err)
				return 0, err
			}

			_, err = tx.ExecContext(ctx, "DELETE FROM tags WHERE id = ?", oldID)
			if err != nil {
				err = fmt.Errorf("failed to delete old tag: %w", err)
				done(err)
				return 0, err
			}
		}
	case errors.Is(err, sql.ErrNoRows):
		_, err = tx.ExecContext(ctx,
			"UPDATE tags SET name = ? WHERE name = ? COLLATE NOCASE", newName, oldName,
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
	done := d.observeQuery("delete_tag_everywhere")

	tagName = strings.TrimSpace(tagName)
	if tagName == "" {
		err := errors.New("tag name cannot be empty")
		done(err)
		return 0, err
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck

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

	result, err := tx.ExecContext(ctx,
		"DELETE FROM tags WHERE name = ? COLLATE NOCASE", tagName,
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

	if err := tx.Commit(); err != nil {
		done(err)
		return 0, err
	}

	logging.Info("Deleted tag '%s' from %d files", tagName, count)
	done(nil)
	return count, nil
}

// BulkAddTagsToFiles adds tags to multiple files in a single transaction.
func (d *Database) BulkAddTagsToFiles(ctx context.Context, filePaths, tagNames []string) (int, []error, error) {
	done := d.observeQuery("bulk_add_tags_to_files")

	if len(tagNames) == 0 {
		done(nil)
		return 0, nil, nil
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return 0, nil, fmt.Errorf("failed to begin transaction: %w", err)
	}

	committed := false
	defer func() {
		if !committed {
			if rbErr := tx.Rollback(); rbErr != nil {
				logging.Error("rollback failed: %v", rbErr)
			}
		}
	}()

	tagIDs, err := resolveTagIDs(ctx, tx, tagNames, true)
	if err != nil {
		done(err)
		return 0, nil, err
	}

	assocStmt, err := tx.PrepareContext(ctx,
		"INSERT OR IGNORE INTO file_tags (file_path, tag_id) VALUES (?, ?)",
	)
	if err != nil {
		done(err)
		return 0, nil, fmt.Errorf("failed to prepare association insert: %w", err)
	}
	defer func() { _ = assocStmt.Close() }()

	clearStmt, err := tx.PrepareContext(ctx,
		"DELETE FROM removed_tags WHERE file_path = ? AND tag_id = ?",
	)
	if err != nil {
		done(err)
		return 0, nil, fmt.Errorf("failed to prepare tombstone clear: %w", err)
	}
	defer func() { _ = clearStmt.Close() }()

	successCount := 0
	var errs []error

	for _, path := range filePaths {
		if path == "" {
			continue
		}

		pathFailed := false
		for _, tagID := range tagIDs {
			if _, execErr := assocStmt.ExecContext(ctx, path, tagID); execErr != nil {
				errs = append(errs, fmt.Errorf("%s: %w", path, execErr))
				pathFailed = true
				continue
			}
			// A user explicitly (re-)adding a tag clears any earlier removal
			// tombstone, so a later autotagger pass is free to keep it.
			if _, execErr := clearStmt.ExecContext(ctx, path, tagID); execErr != nil {
				errs = append(errs, fmt.Errorf("%s: %w", path, execErr))
				pathFailed = true
			}
		}
		if !pathFailed {
			successCount++
		}
	}

	if commitErr := tx.Commit(); commitErr != nil {
		done(commitErr)
		return 0, nil, fmt.Errorf("failed to commit: %w", commitErr)
	}
	committed = true

	done(nil)
	return successCount, errs, nil
}

// BulkRemoveTagsFromFiles removes tags from multiple files in a single transaction.
func (d *Database) BulkRemoveTagsFromFiles(ctx context.Context, filePaths, tagNames []string) (int, []error, error) {
	done := d.observeQuery("bulk_remove_tags_from_files")

	if len(tagNames) == 0 {
		done(nil)
		return 0, nil, nil
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return 0, nil, fmt.Errorf("failed to begin transaction: %w", err)
	}

	committed := false
	defer func() {
		if !committed {
			if rbErr := tx.Rollback(); rbErr != nil {
				logging.Error("rollback failed: %v", rbErr)
			}
		}
	}()

	tagIDs, err := resolveTagIDs(ctx, tx, tagNames, false)
	if err != nil {
		done(err)
		return 0, nil, err
	}

	if len(tagIDs) == 0 {
		done(nil)
		return 0, nil, nil
	}

	deleteStmt, err := tx.PrepareContext(ctx,
		"DELETE FROM file_tags WHERE file_path = ? AND tag_id = ?",
	)
	if err != nil {
		done(err)
		return 0, nil, fmt.Errorf("failed to prepare delete: %w", err)
	}
	defer func() { _ = deleteStmt.Close() }()

	tombstoneStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO removed_tags (file_path, tag_id, removed_at)
		VALUES (?, ?, strftime('%s', 'now'))
		ON CONFLICT(file_path, tag_id) DO UPDATE SET removed_at = excluded.removed_at
	`)
	if err != nil {
		done(err)
		return 0, nil, fmt.Errorf("failed to prepare tombstone insert: %w", err)
	}
	defer func() { _ = tombstoneStmt.Close() }()

	successCount := 0
	var errs []error

	for _, path := range filePaths {
		if path == "" {
			continue
		}

		pathHadRemoval := false
		for _, tagID := range tagIDs {
			result, execErr := deleteStmt.ExecContext(ctx, path, tagID)
			if execErr != nil {
				errs = append(errs, fmt.Errorf("%s: %w", path, execErr))
				continue
			}
			if rows, _ := result.RowsAffected(); rows > 0 {
				pathHadRemoval = true
				// Tombstone the removal so a later autotagger pass does not
				// resurrect it from the file's still-unchanged metadata.
				if _, execErr := tombstoneStmt.ExecContext(ctx, path, tagID); execErr != nil {
					errs = append(errs, fmt.Errorf("%s: %w", path, execErr))
				}
			}
		}
		if pathHadRemoval {
			successCount++
		}
	}

	if commitErr := tx.Commit(); commitErr != nil {
		done(commitErr)
		return 0, nil, fmt.Errorf("failed to commit: %w", commitErr)
	}
	committed = true

	done(nil)
	return successCount, errs, nil
}

// GetBatchFileTags returns tags for multiple files in a single query.
func (d *Database) GetBatchFileTags(ctx context.Context, filePaths []string) (map[string][]string, error) {
	done := d.observeQuery("get_batch_file_tags")

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	result := make(map[string][]string, len(filePaths))
	for _, path := range filePaths {
		if path != "" {
			result[path] = []string{}
		}
	}

	if len(filePaths) == 0 {
		done(nil)
		return result, nil
	}

	inClause, args := buildPlaceholders(filePaths)
	if inClause == "" {
		done(nil)
		return result, nil
	}

	//nolint:gosec
	query := `
		SELECT ft.file_path, t.name
		FROM file_tags ft
		INNER JOIN tags t ON ft.tag_id = t.id
		WHERE ft.file_path IN (` + inClause + `)
		ORDER BY ft.file_path, t.name COLLATE NOCASE
	`

	rows, err := d.reader.QueryContext(ctx, query, args...)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("batch file tags query failed: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			logging.Error("error closing rows: %v", closeErr)
		}
	}()

	for rows.Next() {
		var filePath, tagName string
		if err := rows.Scan(&filePath, &tagName); err != nil {
			logging.Warn("error scanning batch tag row: %v", err)
			continue
		}
		result[filePath] = append(result[filePath], tagName)
	}

	if err := rows.Err(); err != nil {
		done(err)
		return nil, fmt.Errorf("batch file tags iteration error: %w", err)
	}

	done(nil)
	return result, nil
}

// GetRelatedTagSuggestions returns tags that frequently co-occur with the provided tags.
func (d *Database) GetRelatedTagSuggestions(ctx context.Context, sourceTags, excludeTags []string, limit int) ([]RelatedTagSuggestion, error) {
	done := d.observeQuery("get_related_tag_suggestions")

	normalizedSourceTags := normalizeTagNames(sourceTags)
	if len(normalizedSourceTags) == 0 {
		done(nil)
		return []RelatedTagSuggestion{}, nil
	}

	if limit <= 0 {
		limit = 8
	}
	if limit > 50 {
		limit = 50
	}

	excludedNames := normalizeTagNames(append(append([]string{}, sourceTags...), excludeTags...))
	sourceTagsJSON, err := json.Marshal(normalizedSourceTags)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("failed to encode source tags: %w", err)
	}

	excludedNamesJSON, err := json.Marshal(excludedNames)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("failed to encode excluded tags: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	query := `
		WITH source_names(name) AS (
			SELECT value
			FROM json_each(?)
		),
		ignored_names(name) AS (
			SELECT value
			FROM json_each(?)
		),
		source_files AS (
			SELECT DISTINCT ft.file_path
			FROM file_tags ft
			INNER JOIN tags source_tag ON source_tag.id = ft.tag_id
			INNER JOIN source_names ON lower(source_tag.name) = source_names.name
		)
		SELECT
			candidate.name,
			COUNT(DISTINCT ft.file_path) AS related_count,
			(
				SELECT COUNT(*)
				FROM file_tags total_ft
				WHERE total_ft.tag_id = candidate.id
			) AS item_count
		FROM source_files sf
		INNER JOIN file_tags ft ON ft.file_path = sf.file_path
		INNER JOIN tags candidate ON candidate.id = ft.tag_id
		LEFT JOIN ignored_names ON lower(candidate.name) = ignored_names.name
		WHERE ignored_names.name IS NULL
		GROUP BY candidate.id, candidate.name
		ORDER BY related_count DESC, item_count DESC, candidate.name COLLATE NOCASE
		LIMIT ?
	`

	rows, err := d.reader.QueryContext(ctx, query, string(sourceTagsJSON), string(excludedNamesJSON), limit)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("related tag suggestions query failed: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			logging.Error("error closing rows: %v", closeErr)
		}
	}()

	suggestions := make([]RelatedTagSuggestion, 0, limit)
	for rows.Next() {
		var suggestion RelatedTagSuggestion
		if err := rows.Scan(&suggestion.Name, &suggestion.RelatedCount, &suggestion.ItemCount); err != nil {
			done(err)
			return nil, fmt.Errorf("failed to scan related tag suggestion: %w", err)
		}
		suggestions = append(suggestions, suggestion)
	}

	if err := rows.Err(); err != nil {
		done(err)
		return nil, fmt.Errorf("related tag suggestions iteration failed: %w", err)
	}

	done(nil)
	return suggestions, nil
}

func resolveTagIDs(ctx context.Context, tx *sql.Tx, tagNames []string, createMissing bool) ([]int64, error) {
	selectStmt, err := tx.PrepareContext(ctx,
		"SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
	)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare tag select: %w", err)
	}
	defer func() { _ = selectStmt.Close() }()

	var insertStmt *sql.Stmt
	if createMissing {
		insertStmt, err = tx.PrepareContext(ctx,
			"INSERT INTO tags (name) VALUES (?)",
		)
		if err != nil {
			return nil, fmt.Errorf("failed to prepare tag insert: %w", err)
		}
		defer func() { _ = insertStmt.Close() }()
	}

	tagIDs := make([]int64, 0, len(tagNames))
	for _, tagName := range tagNames {
		tagName = strings.TrimSpace(tagName)
		if tagName == "" {
			continue
		}

		var tagID int64
		err = selectStmt.QueryRowContext(ctx, tagName).Scan(&tagID)
		if err != nil {
			if !createMissing {
				continue
			}
			result, createErr := insertStmt.ExecContext(ctx, tagName)
			if createErr != nil {
				if err2 := selectStmt.QueryRowContext(ctx, tagName).Scan(&tagID); err2 != nil {
					return nil, fmt.Errorf("failed to create tag %q: %w", tagName, createErr)
				}
			} else {
				tagID, _ = result.LastInsertId()
			}
		}
		tagIDs = append(tagIDs, tagID)
	}

	return tagIDs, nil
}

func normalizeTagNames(tagNames []string) []string {
	seen := make(map[string]struct{}, len(tagNames))
	normalized := make([]string, 0, len(tagNames))

	for _, tagName := range tagNames {
		trimmed := strings.TrimSpace(tagName)
		if trimmed == "" {
			continue
		}

		lower := strings.ToLower(trimmed)
		if _, exists := seen[lower]; exists {
			continue
		}

		seen[lower] = struct{}{}
		normalized = append(normalized, lower)
	}

	return normalized
}

func buildPlaceholders(values []string) (clause string, args []interface{}) {
	placeholders := make([]string, 0, len(values))
	args = make([]interface{}, 0, len(values))
	for _, v := range values {
		if v == "" {
			continue
		}
		placeholders = append(placeholders, "?")
		args = append(args, v)
	}
	clause = strings.Join(placeholders, ",")
	return clause, args
}

// MergeExifTagsForFile applies auto-detected EXIF/XMP tag names to a file
// in a purely additive manner.  Existing tags are never removed.
//
// For each provided rawTag name the function performs a case-insensitive
// lookup in the tags table:
//   - If a matching tag exists, its canonical (user-set) name and ID are
//     used — the tag is never renamed.
//   - If no match is found, a new tag is created with the rawTag spelling.
//
// A tag the user has explicitly removed from this file (tracked in
// removed_tags) is skipped instead of being re-linked, so a later pass over
// the file's still-unchanged metadata does not resurrect it. Otherwise, an
// INSERT OR IGNORE into file_tags ensures the association exists after the
// call.  All operations run in a single transaction.
func (d *Database) MergeExifTagsForFile(ctx context.Context, filePath string, rawTags []string) error {
	done := d.observeQuery("merge_exif_tags_for_file")

	if len(rawTags) == 0 {
		done(nil)
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	committed := false
	defer func() {
		if !committed {
			if rbErr := tx.Rollback(); rbErr != nil {
				logging.Error("MergeExifTagsForFile rollback failed: %v", rbErr)
			}
		}
	}()

	for _, rawTag := range rawTags {
		name := strings.TrimSpace(rawTag)
		if name == "" {
			continue
		}

		// Look up existing tag case-insensitively to preserve user's spelling.
		var tagID int64
		err := tx.QueryRowContext(ctx,
			"SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
			name,
		).Scan(&tagID)

		if err != nil {
			// Tag does not exist — create it with the EXIF-detected spelling.
			result, createErr := tx.ExecContext(ctx, "INSERT INTO tags (name) VALUES (?)", name)
			if createErr != nil {
				done(createErr)
				return fmt.Errorf("failed to create tag %q: %w", name, createErr)
			}
			tagID, _ = result.LastInsertId()
		}

		// A user explicitly removed this tag from this file — respect that
		// and do not resurrect it from EXIF/XMP metadata that hasn't changed.
		var removed int
		err = tx.QueryRowContext(ctx,
			"SELECT 1 FROM removed_tags WHERE file_path = ? AND tag_id = ?",
			filePath, tagID,
		).Scan(&removed)
		if err == nil {
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			done(err)
			return fmt.Errorf("failed to check removed_tags for %q: %w", name, err)
		}

		// Link tag to file; ignore if the association already exists.
		if _, err := tx.ExecContext(ctx,
			"INSERT OR IGNORE INTO file_tags (file_path, tag_id) VALUES (?, ?)",
			filePath, tagID,
		); err != nil {
			done(err)
			return fmt.Errorf("failed to link tag %q to %s: %w", name, filePath, err)
		}
	}

	if err := tx.Commit(); err != nil {
		done(err)
		return fmt.Errorf("failed to commit: %w", err)
	}
	committed = true

	done(nil)
	return nil
}
