package database

import (
	"database/sql"
	"fmt"
	"math"
	"media-viewer/internal/logging"
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
	logging.Debug("ListDirectory called: path=%q", opts.Path)

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

	logging.Debug("ListDirectory: getting count...")

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
		logging.Error("ListDirectory count query failed: %v", err)
		return nil, fmt.Errorf("count query failed: %w", err)
	}

	logging.Debug("ListDirectory: count=%d, getting items...", totalItems)

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

	logging.Debug("ListDirectory: executing select query...")

	d.mu.RLock()
	rows, err := d.db.Query(selectQuery, selectArgs...)
	d.mu.RUnlock()

	if err != nil {
		logging.Error("ListDirectory select query failed: %v", err)
		return nil, fmt.Errorf("select query failed: %w", err)
	}
	defer rows.Close()

	logging.Debug("ListDirectory: scanning rows...")

	var items []MediaFile
	for rows.Next() {
		var file MediaFile
		var modTime int64
		var mimeType sql.NullString

		if err := rows.Scan(
			&file.ID, &file.Name, &file.Path, &file.ParentPath,
			&file.Type, &file.Size, &modTime, &mimeType,
		); err != nil {
			logging.Error("ListDirectory scan failed: %v", err)
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
		logging.Error("ListDirectory rows error: %v", err)
		return nil, fmt.Errorf("rows error: %w", err)
	}

	logging.Debug("ListDirectory: building response...")

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

	logging.Debug("ListDirectory completed in %v", time.Since(start))

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

	// Check for tag: prefix (case-insensitive)
	queryLower := strings.ToLower(opts.Query)
	if strings.HasPrefix(queryLower, "tag:") {
		tagName := strings.TrimSpace(opts.Query[4:]) // Preserve original case for display
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

	// Prepare search term for FTS
	searchTerm := prepareSearchTerm(opts.Query)
	tagPattern := "%" + opts.Query + "%"

	// First, get files matching FTS
	ftsQuery := `
		SELECT DISTINCT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type
		FROM files f
		INNER JOIN files_fts fts ON f.id = fts.rowid
		WHERE files_fts MATCH ?
	`
	ftsArgs := []interface{}{searchTerm}

	if opts.FilterType != "" {
		ftsQuery += ` AND f.type = ?`
		ftsArgs = append(ftsArgs, opts.FilterType)
	}

	// Second, get files matching by tag name
	tagQuery := `
		SELECT DISTINCT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type
		FROM files f
		INNER JOIN file_tags ft ON f.path = ft.file_path
		INNER JOIN tags t ON ft.tag_id = t.id
		WHERE t.name LIKE ?
	`
	tagArgs := []interface{}{tagPattern}

	if opts.FilterType != "" {
		tagQuery += ` AND f.type = ?`
		tagArgs = append(tagArgs, opts.FilterType)
	}

	// Combine with UNION to get unique results
	combinedQuery := fmt.Sprintf(`
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type FROM (
			%s
			UNION
			%s
		) combined
		ORDER BY name COLLATE NOCASE
	`, ftsQuery, tagQuery)

	// For counting, we need a similar approach
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*) FROM (
			SELECT DISTINCT path FROM (
				SELECT f.path FROM files f
				INNER JOIN files_fts fts ON f.id = fts.rowid
				WHERE files_fts MATCH ?
				%s
				UNION
				SELECT f.path FROM files f
				INNER JOIN file_tags ft ON f.path = ft.file_path
				INNER JOIN tags t ON ft.tag_id = t.id
				WHERE t.name LIKE ?
				%s
			)
		)
	`, func() string {
		if opts.FilterType != "" {
			return "AND f.type = ?"
		}
		return ""
	}(), func() string {
		if opts.FilterType != "" {
			return "AND f.type = ?"
		}
		return ""
	}())

	// Build count args
	countArgs := []interface{}{searchTerm}
	if opts.FilterType != "" {
		countArgs = append(countArgs, opts.FilterType)
	}
	countArgs = append(countArgs, tagPattern)
	if opts.FilterType != "" {
		countArgs = append(countArgs, opts.FilterType)
	}

	d.mu.RLock()
	var totalItems int
	err := d.db.QueryRow(countQuery, countArgs...).Scan(&totalItems)
	d.mu.RUnlock()

	if err != nil {
		// If FTS fails (e.g., invalid query), fall back to tag-only search
		return d.searchByTagOnly(opts, tagPattern)
	}

	totalPages := (totalItems + opts.PageSize - 1) / opts.PageSize
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (opts.Page - 1) * opts.PageSize

	// Add pagination to combined query
	paginatedQuery := combinedQuery + ` LIMIT ? OFFSET ?`

	// Build select args
	selectArgs := append(ftsArgs, tagArgs...)
	selectArgs = append(selectArgs, opts.PageSize, offset)

	d.mu.RLock()
	rows, err := d.db.Query(paginatedQuery, selectArgs...)
	d.mu.RUnlock()

	if err != nil {
		// Fall back to tag-only search on FTS error
		return d.searchByTagOnly(opts, tagPattern)
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

// searchByTagOnly is a fallback when FTS fails
func (d *Database) searchByTagOnly(opts SearchOptions, tagPattern string) (*SearchResult, error) {
	// Count
	countQuery := `
		SELECT COUNT(DISTINCT f.path)
		FROM files f
		INNER JOIN file_tags ft ON f.path = ft.file_path
		INNER JOIN tags t ON ft.tag_id = t.id
		WHERE t.name LIKE ?
	`
	countArgs := []interface{}{tagPattern}

	if opts.FilterType != "" {
		countQuery += ` AND f.type = ?`
		countArgs = append(countArgs, opts.FilterType)
	}

	d.mu.RLock()
	var totalItems int
	err := d.db.QueryRow(countQuery, countArgs...).Scan(&totalItems)
	d.mu.RUnlock()

	if err != nil {
		return &SearchResult{Items: []MediaFile{}, Query: opts.Query}, nil
	}

	totalPages := (totalItems + opts.PageSize - 1) / opts.PageSize
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (opts.Page - 1) * opts.PageSize

	// Select
	selectQuery := `
		SELECT DISTINCT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type
		FROM files f
		INNER JOIN file_tags ft ON f.path = ft.file_path
		INNER JOIN tags t ON ft.tag_id = t.id
		WHERE t.name LIKE ?
	`
	selectArgs := []interface{}{tagPattern}

	if opts.FilterType != "" {
		selectQuery += ` AND f.type = ?`
		selectArgs = append(selectArgs, opts.FilterType)
	}

	selectQuery += ` ORDER BY f.name COLLATE NOCASE LIMIT ? OFFSET ?`
	selectArgs = append(selectArgs, opts.PageSize, offset)

	d.mu.RLock()
	rows, err := d.db.Query(selectQuery, selectArgs...)
	d.mu.RUnlock()

	if err != nil {
		return &SearchResult{Items: []MediaFile{}, Query: opts.Query}, nil
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

	var suggestions []SearchSuggestion

	// First, get matching tags as suggestions
	tagSuggestions, err := d.getTagSuggestions(query, limit/2)
	if err == nil {
		suggestions = append(suggestions, tagSuggestions...)
	}

	// Calculate remaining slots for file suggestions
	remainingLimit := limit - len(suggestions)
	if remainingLimit <= 0 {
		return suggestions, nil
	}

	// Use FTS for fast fuzzy matching on files
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
	rows, err := d.db.Query(sqlQuery, searchTerm, remainingLimit)
	d.mu.RUnlock()

	if err != nil {
		// Return tag suggestions even if FTS fails
		return suggestions, nil
	}
	defer rows.Close()

	for rows.Next() {
		var s SearchSuggestion
		var rank float64

		if err := rows.Scan(&s.Name, &s.Path, &s.Type, &rank); err != nil {
			continue
		}

		s.Highlight = highlightMatch(s.Name, query)
		suggestions = append(suggestions, s)
	}

	return suggestions, nil
}

// getTagSuggestions returns tags matching the query as search suggestions
func (d *Database) getTagSuggestions(query string, limit int) ([]SearchSuggestion, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(`
		SELECT t.name, COUNT(ft.id) as item_count
		FROM tags t
		LEFT JOIN file_tags ft ON t.id = ft.tag_id
		WHERE t.name LIKE ?
		GROUP BY t.id
		ORDER BY item_count DESC, t.name COLLATE NOCASE
		LIMIT ?
	`, "%"+query+"%", limit)

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var suggestions []SearchSuggestion
	for rows.Next() {
		var name string
		var count int

		if err := rows.Scan(&name, &count); err != nil {
			continue
		}

		suggestions = append(suggestions, SearchSuggestion{
			Path:      "tag:" + name,
			Name:      name,
			Type:      "tag", // Special type for tags
			Highlight: fmt.Sprintf("🏷 %s <span class=\"tag-count\">(%d items)</span>", highlightMatch(name, query), count),
		})
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
func (d *Database) GetMediaInDirectory(parentPath string, sortField SortField, sortOrder SortOrder) ([]MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	// Build sort clause - default to name if not specified
	if sortField == "" {
		sortField = SortByName
	}
	if sortOrder == "" {
		sortOrder = SortAsc
	}

	sortColumn := "name COLLATE NOCASE"
	switch sortField {
	case SortByDate:
		sortColumn = "mod_time"
	case SortBySize:
		sortColumn = "size"
	case SortByType:
		sortColumn = "type"
	case SortByName:
		sortColumn = "name COLLATE NOCASE"
	}

	sortDir := "ASC"
	if sortOrder == SortDesc {
		sortDir = "DESC"
	}

	query := fmt.Sprintf(`
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files 
		WHERE parent_path = ? AND type IN ('image', 'video')
		ORDER BY %s %s
	`, sortColumn, sortDir)

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

		// Load favorite status and tags
		file.IsFavorite = d.isFavoriteNoLockInternal(file.Path)
		file.Tags = d.getFileTagsNoLock(file.Path)

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
