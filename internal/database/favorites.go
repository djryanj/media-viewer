package database

import (
	"context"
	"fmt"
	"time"

	"media-viewer/internal/logging"
)

// AddFavorite adds a path to favorites.
func (d *Database) AddFavorite(ctx context.Context, path, name string, fileType FileType) error {
	done := d.observeQuery("add_favorite")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	query := `
		INSERT INTO favorites (path, name, type, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(path) DO NOTHING
	`

	_, err := d.writer.ExecContext(ctx, query, path, name, fileType, time.Now().Unix())
	done(err)
	return err
}

// RemoveFavorite removes a favorite by its path.
func (d *Database) RemoveFavorite(ctx context.Context, path string) error {
	done := d.observeQuery("remove_favorite")

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.writer.ExecContext(ctx, "DELETE FROM favorites WHERE path = ?", path)
	done(err)
	return err
}

// IsFavorite uses a prepared statement for the favorite check.
func (d *Database) IsFavorite(ctx context.Context, path string) bool {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var exists bool
	err := d.stmts.isFavorite.QueryRowContext(ctx, path).Scan(&exists)
	if err != nil {
		return false
	}
	return exists
}

// GetFavorites returns all favorites with their file info.
func (d *Database) GetFavorites(ctx context.Context) ([]MediaFile, error) {
	done := d.observeQuery("get_favorites")

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	result, err := d.getFavorites(ctx)
	done(err)
	return result, err
}

func (d *Database) getFavorites(ctx context.Context) ([]MediaFile, error) {
	query := `
		SELECT
			f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type,
			COALESCE(fc.item_count, 0) as folder_count
		FROM favorites fav
		INNER JOIN files f ON fav.path = f.path
		LEFT JOIN (
			SELECT parent_path, COUNT(*) as item_count
			FROM files
			GROUP BY parent_path
		) fc ON f.path = fc.parent_path AND f.type = 'folder'
		ORDER BY fav.created_at DESC
	`

	rows, err := d.reader.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get favorites: %w", err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows in getFavorites: %v", err)
		}
	}()

	var favorites []MediaFile
	for rows.Next() {
		var file MediaFile
		var modTime int64
		var mimeType *string
		var folderCount int

		if err := rows.Scan(
			&file.ID, &file.Name, &file.Path, &file.ParentPath,
			&file.Type, &file.Size, &modTime, &mimeType,
			&folderCount,
		); err != nil {
			continue
		}

		file.ModTime = time.Unix(modTime, 0)
		if mimeType != nil {
			file.MimeType = *mimeType
		}
		file.IsFavorite = true

		if file.Type == FileTypeImage || file.Type == FileTypeVideo {
			file.ThumbnailURL = "/api/thumbnail/" + file.Path
		}

		if file.Type == FileTypeFolder {
			file.ItemCount = folderCount
		}

		favorites = append(favorites, file)
	}

	return favorites, nil
}

// GetFavoriteCount returns the number of favorites.
func (d *Database) GetFavoriteCount(ctx context.Context) int {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	if err := d.reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM favorites").Scan(&count); err != nil {
		return 0
	}
	return count
}
