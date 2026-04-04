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

var (
	// ErrCollectionNameInUse indicates that a collection already exists with the requested name.
	ErrCollectionNameInUse = errors.New("collection name already in use")
	// ErrCollectionFolderConflict indicates that the requested items do not belong to a single folder scope.
	ErrCollectionFolderConflict = errors.New("collection folder conflict")
)

func normalizeCollectionName(name string) string {
	return strings.TrimSpace(name)
}

func stringPtr(value string) *string {
	v := value
	return &v
}

func normalizeCollectionPaths(paths []string) []string {
	cleaned := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		if path == "" {
			continue
		}
		if _, exists := seen[path]; exists {
			continue
		}
		seen[path] = struct{}{}
		cleaned = append(cleaned, path)
	}
	return cleaned
}

func (d *Database) ensureCollectionNameAvailableTx(ctx context.Context, tx *sql.Tx, name string, excludeID int64) error {
	query := `SELECT id FROM collections WHERE name = ? COLLATE NOCASE`
	args := []interface{}{name}
	if excludeID > 0 {
		query += ` AND id != ?`
		args = append(args, excludeID)
	}
	query += ` LIMIT 1`

	var existingID int64
	err := tx.QueryRowContext(ctx, query, args...).Scan(&existingID)
	if err == nil {
		return ErrCollectionNameInUse
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return fmt.Errorf("check collection name uniqueness: %w", err)
}

func (d *Database) resolveCollectionFolderPathTx(ctx context.Context, tx *sql.Tx, paths []string) (folderPath string, hasFolderPath bool, err error) {
	cleaned := normalizeCollectionPaths(paths)

	if len(cleaned) == 0 {
		return "", false, nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(cleaned)), ",")
	args := make([]interface{}, len(cleaned))
	for i, path := range cleaned {
		args[i] = path
	}

	rows, err := tx.QueryContext(ctx,
		fmt.Sprintf(`SELECT path, COALESCE(parent_path, '') FROM files WHERE path IN (%s)`, placeholders),
		args...,
	)
	if err != nil {
		return "", false, fmt.Errorf("query collection folder paths: %w", err)
	}
	defer func() {
		if cerr := rows.Close(); cerr != nil {
			logging.Error("error closing rows in resolveCollectionFolderPathTx: %v", cerr)
		}
	}()

	foundCount := 0
	for rows.Next() {
		var path string
		var parentPath string
		if err := rows.Scan(&path, &parentPath); err != nil {
			return "", false, fmt.Errorf("scan collection folder path: %w", err)
		}
		foundCount++
		if !hasFolderPath {
			folderPath = parentPath
			hasFolderPath = true
			continue
		}
		if parentPath != folderPath {
			return "", false, ErrCollectionFolderConflict
		}
	}
	if err := rows.Err(); err != nil {
		return "", false, fmt.Errorf("iterate collection folder paths: %w", err)
	}
	if foundCount != len(cleaned) {
		return "", false, fmt.Errorf("resolve collection folder path: missing indexed files")
	}

	return folderPath, true, nil
}

// CreateCollection creates a new named collection and optionally seeds it with
// the given file paths. The first path (if any) is used as the cover image.
func (d *Database) CreateCollection(ctx context.Context, name string, paths []string, folderPath *string) (*Collection, error) {
	done := d.observeQuery("create_collection")
	name = normalizeCollectionName(name)
	normalizedPaths := normalizeCollectionPaths(paths)

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := d.ensureCollectionNameAvailableTx(ctx, tx, name, 0); err != nil {
		done(err)
		return nil, err
	}

	resolvedFolderPath, hasFolderScope, err := d.resolveCollectionFolderPathTx(ctx, tx, normalizedPaths)
	if err != nil {
		done(err)
		return nil, err
	}
	if folderPath != nil {
		if hasFolderScope && resolvedFolderPath != *folderPath {
			done(ErrCollectionFolderConflict)
			return nil, ErrCollectionFolderConflict
		}
		if !hasFolderScope {
			resolvedFolderPath = *folderPath
			hasFolderScope = true
		}
	}

	now := time.Now().Unix()
	insertQuery := `INSERT INTO collections (name, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?)`
	insertArgs := []interface{}{name, nil, now, now}
	if hasFolderScope {
		insertArgs[1] = resolvedFolderPath
	}
	result, err := tx.ExecContext(ctx, insertQuery, insertArgs...)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("insert collection: %w", err)
	}

	collectionID, _ := result.LastInsertId()

	var coverPath string
	if len(normalizedPaths) > 0 {
		coverPath = normalizedPaths[0]
		if _, err = tx.ExecContext(ctx,
			`UPDATE collections SET cover_path = ? WHERE id = ?`,
			coverPath, collectionID,
		); err != nil {
			done(err)
			return nil, fmt.Errorf("set cover path: %w", err)
		}

		for i, p := range normalizedPaths {
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
		ID:   collectionID,
		Name: name,
		FolderPath: func() *string {
			if !hasFolderScope {
				return nil
			}
			return stringPtr(resolvedFolderPath)
		}(),
		CoverPath: coverPath,
		ItemCount: len(normalizedPaths),
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
		SELECT c.id, c.name, c.folder_path, COALESCE(c.cover_path, ''), c.created_at, c.updated_at,
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
		var folderPath sql.NullString
		var createdAt, updatedAt int64
		if err := rows.Scan(&c.ID, &c.Name, &folderPath, &c.CoverPath, &createdAt, &updatedAt, &c.ItemCount); err != nil {
			continue
		}
		if folderPath.Valid {
			c.FolderPath = stringPtr(folderPath.String)
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
	var folderPath sql.NullString
	var createdAt, updatedAt int64
	err := d.reader.QueryRowContext(ctx, `
		SELECT c.id, c.name, c.folder_path, COALESCE(c.cover_path, ''), c.created_at, c.updated_at,
		       COUNT(ci.id) AS item_count
		FROM collections c
		LEFT JOIN collection_items ci ON ci.collection_id = c.id
		WHERE c.id = ?
		GROUP BY c.id
	`, id).Scan(&c.ID, &c.Name, &folderPath, &c.CoverPath, &createdAt, &updatedAt, &c.ItemCount)
	done(err)
	if err != nil {
		return nil, fmt.Errorf("get collection %d: %w", id, err)
	}
	if folderPath.Valid {
		c.FolderPath = stringPtr(folderPath.String)
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
	name = normalizeCollectionName(name)

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	if err := d.ensureCollectionNameAvailableTx(ctx, tx, name, id); err != nil {
		done(err)
		return err
	}

	if coverPath == "" {
		_, err = tx.ExecContext(ctx,
			`UPDATE collections SET name = ?, updated_at = ? WHERE id = ?`,
			name, time.Now().Unix(), id,
		)
	} else {
		_, err = tx.ExecContext(ctx,
			`UPDATE collections SET name = ?, cover_path = ?, updated_at = ? WHERE id = ?`,
			name, coverPath, time.Now().Unix(), id,
		)
	}
	if err != nil {
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
	normalizedPaths := normalizeCollectionPaths(paths)
	if len(normalizedPaths) == 0 {
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

	requestedFolderPath, hasRequestedFolderPath, err := d.resolveCollectionFolderPathTx(ctx, tx, normalizedPaths)
	if err != nil {
		done(err)
		return err
	}

	var collectionFolderPath sql.NullString
	if err = tx.QueryRowContext(ctx, `SELECT folder_path FROM collections WHERE id = ?`, id).Scan(&collectionFolderPath); err != nil {
		done(err)
		return err
	}
	if hasRequestedFolderPath {
		if collectionFolderPath.Valid {
			if collectionFolderPath.String != requestedFolderPath {
				done(ErrCollectionFolderConflict)
				return ErrCollectionFolderConflict
			}
		} else {
			if _, err = tx.ExecContext(ctx,
				`UPDATE collections SET folder_path = ? WHERE id = ?`,
				requestedFolderPath, id,
			); err != nil {
				done(err)
				return err
			}
		}
	}

	var maxPos int
	_ = tx.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(position), -1) FROM collection_items WHERE collection_id = ?",
		id,
	).Scan(&maxPos)

	for i, p := range normalizedPaths {
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
	`, normalizedPaths[0], time.Now().Unix(), id); err != nil {
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

// RemoveItemsFromCollection removes one or more files from a collection in a
// single transaction and advances the cover image to the new first item when
// the current cover is removed.
func (d *Database) RemoveItemsFromCollection(ctx context.Context, collectionID int64, paths []string) error {
	normalizedPaths := normalizeCollectionPaths(paths)
	if len(normalizedPaths) == 0 {
		return nil
	}

	done := d.observeQuery("remove_items_from_collection")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := d.writer.BeginTx(ctx, nil)
	if err != nil {
		done(err)
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	var currentCoverPath sql.NullString
	if err = tx.QueryRowContext(ctx, `SELECT cover_path FROM collections WHERE id = ?`, collectionID).Scan(&currentCoverPath); err != nil {
		done(err)
		return err
	}

	removedSet := make(map[string]struct{}, len(normalizedPaths))
	for _, path := range normalizedPaths {
		removedSet[path] = struct{}{}
	}

	deleteStmt, err := tx.PrepareContext(ctx,
		`DELETE FROM collection_items WHERE collection_id = ? AND file_path = ?`,
	)
	if err != nil {
		done(err)
		return err
	}
	defer deleteStmt.Close() //nolint:errcheck

	for _, path := range normalizedPaths {
		if _, err = deleteStmt.ExecContext(ctx, collectionID, path); err != nil {
			done(err)
			return err
		}
	}

	updatedAt := time.Now().Unix()
	_, coverRemoved := removedSet[currentCoverPath.String]
	if currentCoverPath.Valid && coverRemoved {
		var nextCoverPath sql.NullString
		err = tx.QueryRowContext(ctx, `
			SELECT file_path
			FROM collection_items
			WHERE collection_id = ?
			ORDER BY position ASC, id ASC
			LIMIT 1
		`, collectionID).Scan(&nextCoverPath)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			done(err)
			return err
		}
		if errors.Is(err, sql.ErrNoRows) {
			nextCoverPath = sql.NullString{}
		}

		if _, err = tx.ExecContext(ctx,
			`UPDATE collections SET cover_path = ?, updated_at = ? WHERE id = ?`,
			nextCoverPath, updatedAt, collectionID,
		); err != nil {
			done(err)
			return err
		}
	} else {
		if _, err = tx.ExecContext(ctx,
			`UPDATE collections SET updated_at = ? WHERE id = ?`,
			updatedAt, collectionID,
		); err != nil {
			done(err)
			return err
		}
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
	return d.RemoveItemsFromCollection(ctx, collectionID, []string{filePath})
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
