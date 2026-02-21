package database

import (
	"context"
	"fmt"
	"time"

	"media-viewer/internal/logging"
)

// AddFavorite adds a path to favorites.
func (d *Database) AddFavorite(ctx context.Context, path, name string, fileType FileType) error {
	done := observeQuery("add_favorite")

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	query := `
		INSERT INTO favorites (path, name, type, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(path) DO NOTHING
	`

	_, err := d.db.ExecContext(ctx, query, path, name, fileType, time.Now().Unix())
	done(err)
	return err
}

// RemoveFavorite removes a path from favorites.
func (d *Database) RemoveFavorite(ctx context.Context, path string) error {
	done := observeQuery("remove_favorite")

	d.mu.Lock()
	defer d.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := d.db.ExecContext(ctx, "DELETE FROM favorites WHERE path = ?", path)
	done(err)
	return err
}

// IsFavorite checks if a path is a favorite.
func (d *Database) IsFavorite(ctx context.Context, path string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	return d.isFavoriteUnlocked(ctx, path)
}

// isFavoriteUnlocked checks favorite status without acquiring lock.
// Caller must hold at least a read lock.
func (d *Database) isFavoriteUnlocked(ctx context.Context, path string) bool {
	var count int
	err := d.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM favorites WHERE path = ?", path).Scan(&count)
	if err != nil {
		return false
	}
	return count > 0
}

// GetFavorites returns all favorites with their file info.
func (d *Database) GetFavorites(ctx context.Context) ([]MediaFile, error) {
	done := observeQuery("get_favorites")

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	result, err := d.getFavoritesUnlocked(ctx)
	done(err)
	return result, err
}

// getFavoritesUnlocked returns favorites without acquiring lock.
// Caller must hold at least a read lock.
func (d *Database) getFavoritesUnlocked(ctx context.Context) ([]MediaFile, error) {
	// Optimized query with LEFT JOIN for folder counts (eliminates N+1 for folders)
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

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get favorites: %w", err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows in getFavoritesUnlocked: %v", err)
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
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var count int
	if err := d.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM favorites").Scan(&count); err != nil {
		return 0
	}
	return count
}
