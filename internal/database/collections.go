package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"media-viewer/internal/logging"
)

// CreateCollection creates a new named collection and optionally seeds it with
// the given file paths. The first path (if any) is used as the cover image.
func (d *Database) CreateCollection(ctx context.Context, name string, paths []string) (*Collection, error) {
	done := d.observeQuery("create_collection")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	now := time.Now().Unix()
	result, err := tx.ExecContext(ctx,
		`INSERT INTO collections (name, created_at, updated_at) VALUES (?, ?, ?)`,
		name, now, now,
	)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("insert collection: %w", err)
	}

	collectionID, _ := result.LastInsertId()

	var coverPath string
	if len(paths) > 0 {
		coverPath = paths[0]
		if _, err = tx.ExecContext(ctx,
			`UPDATE collections SET cover_path = ? WHERE id = ?`,
			coverPath, collectionID,
		); err != nil {
			done(err)
			return nil, fmt.Errorf("set cover path: %w", err)
		}

		for i, p := range paths {
			if p == "" {
				continue
			}
			if _, err = tx.ExecContext(ctx,
				`INSERT OR IGNORE INTO collection_items (collection_id, file_path, position) VALUES (?, ?, ?)`,
				collectionID, p, i,
			); err != nil {
				done(err)
				return nil, fmt.Errorf("insert collection item: %w", err)
			}
		}
	}

	if err = tx.Commit(); err != nil {
		done(err)
		return nil, fmt.Errorf("commit: %w", err)
	}

	done(nil)
	return &Collection{
		ID:        collectionID,
		Name:      name,
		CoverPath: coverPath,
		ItemCount: len(paths),
		CreatedAt: time.Unix(now, 0),
		UpdatedAt: time.Unix(now, 0),
	}, nil
}

// GetCollections returns all collections with their item counts,
// ordered by most recently updated first.
func (d *Database) GetCollections(ctx context.Context) ([]Collection, error) {
	done := d.observeQuery("get_collections")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.reader.QueryContext(ctx, `
		SELECT c.id, c.name, COALESCE(c.cover_path, ''), c.created_at, c.updated_at,
		       COUNT(ci.id) AS item_count
		FROM collections c
		LEFT JOIN collection_items ci ON ci.collection_id = c.id
		GROUP BY c.id
		ORDER BY c.updated_at DESC
	`)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("query collections: %w", err)
	}
	defer func() {
		if cerr := rows.Close(); cerr != nil {
			logging.Error("error closing rows in GetCollections: %v", cerr)
		}
	}()

	var collections []Collection
	for rows.Next() {
		var c Collection
		var createdAt, updatedAt int64
		if err := rows.Scan(&c.ID, &c.Name, &c.CoverPath, &createdAt, &updatedAt, &c.ItemCount); err != nil {
			continue
		}
		c.CreatedAt = time.Unix(createdAt, 0)
		c.UpdatedAt = time.Unix(updatedAt, 0)
		collections = append(collections, c)
	}

	done(nil)
	return collections, nil
}

// GetCollection returns a single collection by ID.
func (d *Database) GetCollection(ctx context.Context, id int64) (*Collection, error) {
	done := d.observeQuery("get_collection")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var c Collection
	var createdAt, updatedAt int64
	err := d.reader.QueryRowContext(ctx, `
		SELECT c.id, c.name, COALESCE(c.cover_path, ''), c.created_at, c.updated_at,
		       COUNT(ci.id) AS item_count
		FROM collections c
		LEFT JOIN collection_items ci ON ci.collection_id = c.id
		WHERE c.id = ?
		GROUP BY c.id
	`, id).Scan(&c.ID, &c.Name, &c.CoverPath, &createdAt, &updatedAt, &c.ItemCount)
	done(err)
	if err != nil {
		return nil, fmt.Errorf("get collection %d: %w", id, err)
	}
	c.CreatedAt = time.Unix(createdAt, 0)
	c.UpdatedAt = time.Unix(updatedAt, 0)
	return &c, nil
}

// GetCollectionItems returns the media files belonging to a collection,
// sorted by their collection position (ascending).
func (d *Database) GetCollectionItems(ctx context.Context, id int64) ([]MediaFile, error) {
	done := d.observeQuery("get_collection_items")

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	rows, err := d.reader.QueryContext(ctx, `
		SELECT f.id, f.name, f.path, f.parent_path, f.type, f.size,
		       f.mod_time, f.mime_type
		FROM collection_items ci
		INNER JOIN files f ON f.path = ci.file_path
		WHERE ci.collection_id = ?
		ORDER BY ci.position ASC, ci.id ASC
	`, id)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("query collection items: %w", err)
	}
	defer func() {
		if cerr := rows.Close(); cerr != nil {
			logging.Error("error closing rows in GetCollectionItems: %v", cerr)
		}
	}()

	var items []MediaFile
	for rows.Next() {
		var f MediaFile
		var modTime int64
		var mimeType *string
		if err := rows.Scan(&f.ID, &f.Name, &f.Path, &f.ParentPath,
			&f.Type, &f.Size, &modTime, &mimeType); err != nil {
			continue
		}
		f.ModTime = time.Unix(modTime, 0)
		if mimeType != nil {
			f.MimeType = *mimeType
		}
		if f.Type == FileTypeImage || f.Type == FileTypeVideo {
			f.ThumbnailURL = "/api/thumbnails/" + f.Path
		}
		items = append(items, f)
	}

	done(nil)
	return items, nil
}

// UpdateCollection renames a collection and/or changes its cover image.
// Pass an empty coverPath to leave the cover unchanged.
func (d *Database) UpdateCollection(ctx context.Context, id int64, name, coverPath string) error {
	done := d.observeQuery("update_collection")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var err error
	if coverPath == "" {
		_, err = d.writer.ExecContext(ctx,
			`UPDATE collections SET name = ?, updated_at = ? WHERE id = ?`,
			name, time.Now().Unix(), id,
		)
	} else {
		_, err = d.writer.ExecContext(ctx,
			`UPDATE collections SET name = ?, cover_path = ?, updated_at = ? WHERE id = ?`,
			name, coverPath, time.Now().Unix(), id,
		)
	}
	done(err)
	return err
}

// DeleteCollection removes a collection and all its item membership records.
func (d *Database) DeleteCollection(ctx context.Context, id int64) error {
	done := d.observeQuery("delete_collection")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err = tx.ExecContext(ctx, "DELETE FROM collection_items WHERE collection_id = ?", id); err != nil {
		done(err)
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM collections WHERE id = ?", id); err != nil {
		done(err)
		return err
	}

	if err = tx.Commit(); err != nil {
		done(err)
		return err
	}
	done(nil)
	return nil
}

// AddItemsToCollection appends the given paths to a collection, ignoring
// duplicates. The cover image is set to the first path if the collection
// currently has no cover.
func (d *Database) AddItemsToCollection(ctx context.Context, id int64, paths []string) error {
	if len(paths) == 0 {
		return nil
	}

	done := d.observeQuery("add_items_to_collection")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	var maxPos int
	_ = tx.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(position), -1) FROM collection_items WHERE collection_id = ?",
		id,
	).Scan(&maxPos)

	for i, p := range paths {
		if p == "" {
			continue
		}
		if _, err = tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO collection_items (collection_id, file_path, position) VALUES (?, ?, ?)`,
			id, p, maxPos+1+i,
		); err != nil {
			done(err)
			return err
		}
	}

	// Set cover to first new item only if the collection has no cover yet.
	if _, err = tx.ExecContext(ctx, `
		UPDATE collections
		SET cover_path = ?, updated_at = ?
		WHERE id = ? AND (cover_path IS NULL OR cover_path = '')
	`, paths[0], time.Now().Unix(), id); err != nil {
		done(err)
		return err
	}

	if _, err = tx.ExecContext(ctx,
		`UPDATE collections SET updated_at = ? WHERE id = ?`,
		time.Now().Unix(), id,
	); err != nil {
		done(err)
		return err
	}

	if err = tx.Commit(); err != nil {
		done(err)
		return err
	}
	done(nil)
	return nil
}

// RemoveItemFromCollection removes a single file from a collection and
// advances the cover image to the new first item when the removed file
// was the cover.
func (d *Database) RemoveItemFromCollection(ctx context.Context, collectionID int64, filePath string) error {
	done := d.observeQuery("remove_item_from_collection")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err = tx.ExecContext(ctx,
		"DELETE FROM collection_items WHERE collection_id = ? AND file_path = ?",
		collectionID, filePath,
	); err != nil {
		done(err)
		return err
	}

	// Advance cover to the new first item if we just deleted the cover.
	if _, err = tx.ExecContext(ctx, `
		UPDATE collections SET
			cover_path = (
				SELECT file_path FROM collection_items
				WHERE collection_id = ?
				ORDER BY position ASC, id ASC
				LIMIT 1
			),
			updated_at = ?
		WHERE id = ? AND cover_path = ?
	`, collectionID, time.Now().Unix(), collectionID, filePath); err != nil {
		done(err)
		return err
	}

	if _, err = tx.ExecContext(ctx,
		`UPDATE collections SET updated_at = ? WHERE id = ?`,
		time.Now().Unix(), collectionID,
	); err != nil {
		done(err)
		return err
	}

	if err = tx.Commit(); err != nil {
		done(err)
		return err
	}
	done(nil)
	return nil
}

// ReorderCollectionItems reassigns position values for a collection so that
// index 0 in paths becomes position 0, index 1 becomes position 1, etc.
// The first path in the new order is also set as the collection cover.
func (d *Database) ReorderCollectionItems(ctx context.Context, collectionID int64, paths []string) error {
	if len(paths) == 0 {
		return nil
	}

	done := d.observeQuery("reorder_collection_items")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	for i, p := range paths {
		if p == "" {
			continue
		}
		if _, err = tx.ExecContext(ctx,
			"UPDATE collection_items SET position = ? WHERE collection_id = ? AND file_path = ?",
			i, collectionID, p,
		); err != nil {
			done(err)
			return err
		}
	}

	if _, err = tx.ExecContext(ctx,
		`UPDATE collections SET cover_path = ?, updated_at = ? WHERE id = ?`,
		paths[0], time.Now().Unix(), collectionID,
	); err != nil {
		done(err)
		return err
	}

	if err = tx.Commit(); err != nil {
		done(err)
		return err
	}
	done(nil)
	return nil
}

// GetFileCollectionIDs returns the IDs of all collections that contain filePath.
func (d *Database) GetFileCollectionIDs(ctx context.Context, filePath string) ([]int64, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rows, err := d.reader.QueryContext(ctx,
		"SELECT collection_id FROM collection_items WHERE file_path = ? ORDER BY collection_id",
		filePath,
	)
	if err != nil {
		return nil, err
	}
	defer func() {
		if cerr := rows.Close(); cerr != nil {
			logging.Error("error closing rows in GetFileCollectionIDs: %v", cerr)
		}
	}()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// GetBatchCollectionMemberships returns a map[filePath][]collectionID for all
// provided paths that belong to at least one collection. Paths without any
// collection membership are omitted from the result.
func (d *Database) GetBatchCollectionMemberships(ctx context.Context, paths []string) (map[string][]int64, error) {
	if len(paths) == 0 {
		return map[string][]int64{}, nil
	}

	done := d.observeQuery("batch_collection_memberships")

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(paths)), ",")

	args := make([]interface{}, len(paths))
	for i, p := range paths {
		args[i] = p
	}

	query := fmt.Sprintf( //nolint:gosec // placeholders contains only '?' markers, not user input
		"SELECT file_path, collection_id FROM collection_items WHERE file_path IN (%s) ORDER BY file_path, position",
		placeholders,
	)

	rows, err := d.reader.QueryContext(ctx, query, args...)
	done(err)
	if err != nil {
		return nil, err
	}
	defer func() {
		if cerr := rows.Close(); cerr != nil {
			logging.Error("error closing rows in GetBatchCollectionMemberships: %v", cerr)
		}
	}()

	result := make(map[string][]int64)
	for rows.Next() {
		var filePath string
		var collectionID int64
		if err := rows.Scan(&filePath, &collectionID); err == nil {
			result[filePath] = append(result[filePath], collectionID)
		}
	}
	return result, nil
}
