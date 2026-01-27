package database

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"path/filepath"
	"strings"
	"time"
)

type SortField string
type SortOrder string

const (
	SortByName SortField = "name"
	SortByDate SortField = "date"
	SortBySize SortField = "size"
	SortByType SortField = "type"
	SortAsc    SortOrder = "asc"
	SortDesc   SortOrder = "desc"
)

type ListOptions struct {
	Path       string
	SortField  SortField
	SortOrder  SortOrder
	FilterType string
	Page       int
	PageSize   int
}

type SearchOptions struct {
	Query      string
	FilterType string
	Page       int
	PageSize   int
}

func (d *Database) ListDirectory(opts ListOptions) (*DirectoryListing, error) {
	start := time.Now()
	log.Printf("[DEBUG] ListDirectory called: path=%q", opts.Path)

	// Normalize path
	if opts.Path == "." {
		opts.Path = ""
	}

	// Default pagination
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PageSize < 1 {
		opts.PageSize = 100
	}
	if opts.PageSize > 500 {
		opts.PageSize = 500
	}

	log.Printf("[DEBUG] ListDirectory: getting count...")

	// Get total count
	var totalItems int
	countQuery := `SELECT COUNT(*) FROM files WHERE parent_path = ?`
	countArgs := []interface{}{opts.Path}

	if opts.FilterType != "" {
		countQuery += ` AND (type = 'folder' OR type = ?)`
		countArgs = append(countArgs, opts.FilterType)
	}

	d.mu.RLock()
	err := d.db.QueryRow(countQuery, countArgs...).Scan(&totalItems)
	d.mu.RUnlock()

	if err != nil {
		log.Printf("[ERROR] ListDirectory count query failed: %v", err)
		return nil, fmt.Errorf("count query failed: %w", err)
	}

	log.Printf("[DEBUG] ListDirectory: count=%d, getting items...", totalItems)

	// Build sort clause
	sortColumn := "name COLLATE NOCASE"
	switch opts.SortField {
	case SortByDate:
		sortColumn = "mod_time"
	case SortBySize:
		sortColumn = "size"
	case SortByType:
		sortColumn = "type"
	}

	sortDir := "ASC"
	if opts.SortOrder == SortDesc {
		sortDir = "DESC"
	}

	// Calculate pagination
	totalPages := int(math.Ceil(float64(totalItems) / float64(opts.PageSize)))
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (opts.Page - 1) * opts.PageSize

	// Build select query
	selectQuery := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files 
		WHERE parent_path = ?
	`
	selectArgs := []interface{}{opts.Path}

	if opts.FilterType != "" {
		selectQuery += ` AND (type = 'folder' OR type = ?)`
		selectArgs = append(selectArgs, opts.FilterType)
	}

	selectQuery += fmt.Sprintf(` ORDER BY (CASE WHEN type = 'folder' THEN 0 ELSE 1 END), %s %s`, sortColumn, sortDir)
	selectQuery += ` LIMIT ? OFFSET ?`
	selectArgs = append(selectArgs, opts.PageSize, offset)

	log.Printf("[DEBUG] ListDirectory: executing select query...")

	d.mu.RLock()
	rows, err := d.db.Query(selectQuery, selectArgs...)
	d.mu.RUnlock()

	if err != nil {
		log.Printf("[ERROR] ListDirectory select query failed: %v", err)
		return nil, fmt.Errorf("select query failed: %w", err)
	}
	defer rows.Close()

	log.Printf("[DEBUG] ListDirectory: scanning rows...")

	var items []MediaFile
	for rows.Next() {
		var file MediaFile
		var modTime int64
		var mimeType sql.NullString

		if err := rows.Scan(
			&file.ID, &file.Name, &file.Path, &file.ParentPath,
			&file.Type, &file.Size, &modTime, &mimeType,
		); err != nil {
			log.Printf("[ERROR] ListDirectory scan failed: %v", err)
			return nil, fmt.Errorf("scan failed: %w", err)
		}

		file.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			file.MimeType = mimeType.String
		}

		if file.Type == FileTypeImage || file.Type == FileTypeVideo {
			file.ThumbnailURL = "/api/thumbnail/" + file.Path
		}

		if file.Type == FileTypeFolder {
			file.ItemCount = d.getItemCountNoLock(file.Path)
		}

		file.IsFavorite = d.isFavoriteNoLock(file.Path)
		file.Tags = d.getFileTagsNoLock(file.Path)

		items = append(items, file)
	}

	if err := rows.Err(); err != nil {
		log.Printf("[ERROR] ListDirectory rows error: %v", err)
		return nil, fmt.Errorf("rows error: %w", err)
	}

	log.Printf("[DEBUG] ListDirectory: building response...")

	// Build breadcrumb
	breadcrumb := buildBreadcrumb(opts.Path)

	// Determine parent
	var parent string
	if opts.Path != "" {
		parent = filepath.Dir(opts.Path)
		if parent == "." {
			parent = ""
		}
	}

	// Directory name
	dirName := filepath.Base(opts.Path)
	if opts.Path == "" {
		dirName = "Media"
	}

	listing := &DirectoryListing{
		Path:       opts.Path,
		Name:       dirName,
		Parent:     parent,
		Breadcrumb: breadcrumb,
		Items:      items,
		TotalItems: totalItems,
		Page:       opts.Page,
		PageSize:   opts.PageSize,
		TotalPages: totalPages,
	}

	// Include favorites only on root page, first page
	if opts.Path == "" && opts.Page == 1 {
		favorites, err := d.GetFavorites()
		if err == nil && len(favorites) > 0 {
			listing.Favorites = favorites
		}
	}

	log.Printf("[DEBUG] ListDirectory completed in %v", time.Since(start))

	return listing, nil
}

// getItemCountNoLock gets item count - caller must NOT hold the lock
func (d *Database) getItemCountNoLock(path string) int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	var count int
	d.db.QueryRow("SELECT COUNT(*) FROM files WHERE parent_path = ?", path).Scan(&count)
	return count
}

// isFavoriteNoLock checks favorite status - caller must NOT hold the lock
func (d *Database) isFavoriteNoLock(path string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	var count int
	d.db.QueryRow("SELECT COUNT(*) FROM favorites WHERE path = ?", path).Scan(&count)
	return count > 0
}

func buildBreadcrumb(path string) []PathPart {
	breadcrumb := []PathPart{
		{Name: "Media", Path: ""},
	}

	if path == "" {
		return breadcrumb
	}

	parts := strings.Split(path, string(filepath.Separator))
	currentPath := ""

	for _, part := range parts {
		if part == "" {
			continue
		}
		if currentPath == "" {
			currentPath = part
		} else {
			currentPath = filepath.Join(currentPath, part)
		}
		breadcrumb = append(breadcrumb, PathPart{
			Name: part,
			Path: currentPath,
		})
	}

	return breadcrumb
}

func (d *Database) Search(opts SearchOptions) (*SearchResult, error) {
	if opts.Query == "" {
		return &SearchResult{Items: []MediaFile{}}, nil
	}

	// Check for tag: prefix
	if strings.HasPrefix(strings.ToLower(opts.Query), "tag:") {
		tagName := strings.TrimPrefix(opts.Query, "tag:")
		tagName = strings.TrimPrefix(tagName, "Tag:")
		tagName = strings.TrimPrefix(tagName, "TAG:")
		tagName = strings.TrimSpace(tagName)
		if tagName != "" {
			return d.GetFilesByTag(tagName, opts.Page, opts.PageSize)
		}
	}

	// Default pagination
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PageSize < 1 {
		opts.PageSize = 50
	}
	if opts.PageSize > 200 {
		opts.PageSize = 200
	}

	// Search in files and tags
	searchTerm := prepareSearchTerm(opts.Query)

	// Search files by name/path OR by tag name
	baseQuery := `
		FROM files f
		LEFT JOIN files_fts fts ON f.id = fts.rowid
		LEFT JOIN file_tags ft ON f.path = ft.file_path
		LEFT JOIN tags t ON ft.tag_id = t.id
		WHERE (files_fts MATCH ? OR t.name LIKE ?)
	`
	tagPattern := "%" + opts.Query + "%"
	args := []interface{}{searchTerm, tagPattern}

	if opts.FilterType != "" {
		baseQuery += ` AND f.type = ?`
		args = append(args, opts.FilterType)
	}

	// Get total count (distinct paths because of joins)
	d.mu.RLock()
	var totalItems int
	countQuery := "SELECT COUNT(DISTINCT f.path) " + baseQuery
	err := d.db.QueryRow(countQuery, args...).Scan(&totalItems)
	d.mu.RUnlock()

	if err != nil {
		return nil, fmt.Errorf("count query failed: %w", err)
	}

	totalPages := (totalItems + opts.PageSize - 1) / opts.PageSize
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (opts.Page - 1) * opts.PageSize

	// Get items
	selectQuery := fmt.Sprintf(`
		SELECT DISTINCT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type
		%s
		ORDER BY f.name COLLATE NOCASE
		LIMIT ? OFFSET ?
	`, baseQuery)

	args = append(args, opts.PageSize, offset)

	d.mu.RLock()
	rows, err := d.db.Query(selectQuery, args...)
	d.mu.RUnlock()

	if err != nil {
		return nil, fmt.Errorf("search query failed: %w", err)
	}
	defer rows.Close()

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

		// Load tags for this file
		file.Tags = d.getFileTagsNoLock(file.Path)
		file.IsFavorite = d.isFavoriteNoLockInternal(file.Path)

		items = append(items, file)
	}

	return &SearchResult{
		Items:      items,
		Query:      opts.Query,
		TotalItems: totalItems,
		Page:       opts.Page,
		PageSize:   opts.PageSize,
		TotalPages: totalPages,
	}, nil
}

// SearchSuggestions returns quick search suggestions for autocomplete
func (d *Database) SearchSuggestions(query string, limit int) ([]SearchSuggestion, error) {
	if query == "" || len(query) < 2 {
		return []SearchSuggestion{}, nil
	}

	if limit <= 0 {
		limit = 10
	}
	if limit > 20 {
		limit = 20
	}

	// Use FTS for fast fuzzy matching
	searchTerm := prepareSearchTerm(query)

	sqlQuery := `
		SELECT f.name, f.path, f.type, bm25(files_fts) as rank
		FROM files f
		INNER JOIN files_fts fts ON f.id = fts.rowid
		WHERE files_fts MATCH ?
		ORDER BY rank
		LIMIT ?
	`

	d.mu.RLock()
	rows, err := d.db.Query(sqlQuery, searchTerm, limit)
	d.mu.RUnlock()

	if err != nil {
		return nil, fmt.Errorf("search suggestions query failed: %w", err)
	}
	defer rows.Close()

	var suggestions []SearchSuggestion
	for rows.Next() {
		var s SearchSuggestion
		var rank float64

		if err := rows.Scan(&s.Name, &s.Path, &s.Type, &rank); err != nil {
			continue
		}

		// Create highlighted name
		s.Highlight = highlightMatch(s.Name, query)
		suggestions = append(suggestions, s)
	}

	return suggestions, nil
}

// prepareSearchTerm prepares a search term for FTS5 trigram search
func prepareSearchTerm(query string) string {
	// Clean up the query
	query = strings.TrimSpace(query)

	// Escape quotes
	query = strings.ReplaceAll(query, `"`, `""`)

	// Wrap in quotes for phrase matching with trigram
	return `"` + query + `"`
}

// highlightMatch wraps matching text in <mark> tags
func highlightMatch(text, query string) string {
	lowerText := strings.ToLower(text)
	lowerQuery := strings.ToLower(query)

	idx := strings.Index(lowerText, lowerQuery)
	if idx == -1 {
		return text
	}

	return text[:idx] + "<mark>" + text[idx:idx+len(query)] + "</mark>" + text[idx+len(query):]
}

// GetAllPlaylists returns all playlist files
func (d *Database) GetAllPlaylists() ([]MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	query := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files WHERE type = 'playlist'
		ORDER BY name COLLATE NOCASE
	`

	rows, err := d.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var playlists []MediaFile
	for rows.Next() {
		var file MediaFile
		var modTime int64
		var mimeType sql.NullString

		if err := rows.Scan(
			&file.ID, &file.Name, &file.Path, &file.ParentPath,
			&file.Type, &file.Size, &modTime, &mimeType,
		); err != nil {
			return nil, err
		}

		file.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			file.MimeType = mimeType.String
		}

		playlists = append(playlists, file)
	}

	return playlists, nil
}

// GetMediaInDirectory returns all media files in a directory (for lightbox)
func (d *Database) GetMediaInDirectory(parentPath string) ([]MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	query := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files 
		WHERE parent_path = ? AND type IN ('image', 'video')
		ORDER BY name COLLATE NOCASE
	`

	rows, err := d.db.Query(query, parentPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []MediaFile
	for rows.Next() {
		var file MediaFile
		var modTime int64
		var mimeType sql.NullString

		if err := rows.Scan(
			&file.ID, &file.Name, &file.Path, &file.ParentPath,
			&file.Type, &file.Size, &modTime, &mimeType,
		); err != nil {
			return nil, err
		}

		file.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			file.MimeType = mimeType.String
		}
		file.ThumbnailURL = "/api/thumbnail/" + file.Path

		files = append(files, file)
	}

	return files, nil
}

// CalculateStats calculates current index statistics
func (d *Database) CalculateStats() (IndexStats, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var stats IndexStats

	queries := []struct {
		query string
		dest  *int
	}{
		{"SELECT COUNT(*) FROM files WHERE type != 'folder'", &stats.TotalFiles},
		{"SELECT COUNT(*) FROM files WHERE type = 'folder'", &stats.TotalFolders},
		{"SELECT COUNT(*) FROM files WHERE type = 'image'", &stats.TotalImages},
		{"SELECT COUNT(*) FROM files WHERE type = 'video'", &stats.TotalVideos},
		{"SELECT COUNT(*) FROM files WHERE type = 'playlist'", &stats.TotalPlaylists},
		{"SELECT COUNT(*) FROM favorites", &stats.TotalFavorites},
	}

	for _, q := range queries {
		if err := d.db.QueryRow(q.query).Scan(q.dest); err != nil {
			return stats, err
		}
	}

	return stats, nil
}
