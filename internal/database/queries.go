package database

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"time"

	"media-viewer/internal/logging"
)

// SortField specifies which field to sort by.
type SortField string

// SortOrder specifies the direction of sorting.
type SortOrder string

const (
	// SortByName sorts results by filename.
	SortByName SortField = "name"
	// SortByDate sorts results by modification time.
	SortByDate SortField = "date"
	// SortBySize sorts results by file size.
	SortBySize SortField = "size"
	// SortByType sorts results by file type.
	SortByType SortField = "type"
	// SortAsc sorts in ascending order.
	SortAsc SortOrder = "asc"
	// SortDesc sorts in descending order.
	SortDesc SortOrder = "desc"

	// NameCollation is the SQL collation for case-insensitive name sorting.
	NameCollation = "name COLLATE NOCASE"
	// FilterTypeClause is the SQL filter clause for file type matching.
	FilterTypeClause = " AND f.type = ?"
)

// ListOptions specifies options for listing directory contents.
type ListOptions struct {
	Path       string
	SortField  SortField
	SortOrder  SortOrder
	FilterType string
	Page       int
	PageSize   int
}

// SearchOptions specifies options for searching the media library.
type SearchOptions struct {
	Query      string
	FilterType string
	Page       int
	PageSize   int
}

// ListDirectory returns a paginated directory listing.
func (d *Database) ListDirectory(opts ListOptions) (*DirectoryListing, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("list_directory", start, err) }()

	logging.Debug("ListDirectory called: path=%q", opts.Path)

	opts = normalizeListOptions(opts)

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	totalItems, err := d.countDirectoryItemsUnlocked(ctx, opts)
	if err != nil {
		return nil, err
	}

	logging.Debug("ListDirectory: count=%d, getting items...", totalItems)

	items, err := d.fetchDirectoryItemsUnlocked(ctx, opts)
	if err != nil {
		return nil, err
	}

	listing := d.buildDirectoryListingUnlocked(ctx, opts, items, totalItems)

	logging.Debug("ListDirectory completed in %v", time.Since(start))

	return listing, nil
}

// normalizeListOptions applies defaults and normalizes the options.
func normalizeListOptions(opts ListOptions) ListOptions {
	if opts.Path == "." {
		opts.Path = ""
	}
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PageSize < 1 {
		opts.PageSize = 100
	}
	if opts.PageSize > 500 {
		opts.PageSize = 500
	}
	return opts
}

// countDirectoryItemsUnlocked returns the total count of items in a directory.
// Caller must hold at least a read lock.
func (d *Database) countDirectoryItemsUnlocked(ctx context.Context, opts ListOptions) (int, error) {
	logging.Debug("ListDirectory: getting count...")

	countQuery := `SELECT COUNT(*) FROM files WHERE parent_path = ?`
	countArgs := []interface{}{opts.Path}

	if opts.FilterType != "" {
		countQuery += ` AND (type = 'folder' OR type = ?)`
		countArgs = append(countArgs, opts.FilterType)
	}

	var totalItems int
	err := d.db.QueryRowContext(ctx, countQuery, countArgs...).Scan(&totalItems)
	if err != nil {
		logging.Error("ListDirectory count query failed: %v", err)
		return 0, fmt.Errorf("count query failed: %w", err)
	}

	return totalItems, nil
}

// fetchDirectoryItemsUnlocked retrieves the items for the current page.
// Caller must hold at least a read lock.
func (d *Database) fetchDirectoryItemsUnlocked(ctx context.Context, opts ListOptions) ([]MediaFile, error) {
	logging.Debug("ListDirectory: executing select query...")

	sortColumn := getSortColumn(opts.SortField)
	sortDir := "ASC"
	if opts.SortOrder == SortDesc {
		sortDir = "DESC"
	}

	offset := (opts.Page - 1) * opts.PageSize

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

	rows, err := d.db.QueryContext(ctx, selectQuery, selectArgs...)
	if err != nil {
		logging.Error("ListDirectory select query failed: %v", err)
		return nil, fmt.Errorf("select query failed: %w", err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	return d.scanDirectoryItemsUnlocked(ctx, rows)
}

// getSortColumn returns the SQL column for sorting.
func getSortColumn(field SortField) string {
	switch field {
	case SortByName:
		return NameCollation
	case SortByDate:
		return "mod_time"
	case SortBySize:
		return "size"
	case SortByType:
		return "type"
	default:
		return NameCollation
	}
}

// scanDirectoryItemsUnlocked scans rows into MediaFile structs and enriches them.
// Caller must hold at least a read lock.
func (d *Database) scanDirectoryItemsUnlocked(ctx context.Context, rows *sql.Rows) ([]MediaFile, error) {
	logging.Debug("ListDirectory: scanning rows...")

	var items []MediaFile
	for rows.Next() {
		file, err := scanMediaFileRow(rows)
		if err != nil {
			return nil, err
		}

		d.enrichMediaFileUnlocked(ctx, &file)
		items = append(items, file)
	}

	if err := rows.Err(); err != nil {
		logging.Error("ListDirectory rows error: %v", err)
		return nil, fmt.Errorf("rows error: %w", err)
	}

	return items, nil
}

// scanMediaFileRow scans a single row into a MediaFile struct.
func scanMediaFileRow(rows *sql.Rows) (MediaFile, error) {
	var file MediaFile
	var modTime int64
	var mimeType sql.NullString

	if err := rows.Scan(
		&file.ID, &file.Name, &file.Path, &file.ParentPath,
		&file.Type, &file.Size, &modTime, &mimeType,
	); err != nil {
		logging.Error("ListDirectory scan failed: %v", err)
		return MediaFile{}, fmt.Errorf("scan failed: %w", err)
	}

	file.ModTime = time.Unix(modTime, 0)
	if mimeType.Valid {
		file.MimeType = mimeType.String
	}

	return file, nil
}

// enrichMediaFileUnlocked adds computed fields to a MediaFile.
// Caller must hold at least a read lock.
func (d *Database) enrichMediaFileUnlocked(ctx context.Context, file *MediaFile) {
	switch file.Type {
	case FileTypeImage, FileTypeVideo, FileTypeFolder:
		file.ThumbnailURL = "/api/thumbnail/" + file.Path
	case FileTypePlaylist, FileTypeOther:
		// No thumbnail
	}

	if file.Type == FileTypeFolder {
		file.ItemCount = d.getItemCountUnlocked(ctx, file.Path)
	}

	file.IsFavorite = d.isFavoriteUnlocked(ctx, file.Path)
	tags, _ := d.getFileTagsUnlocked(ctx, file.Path)
	file.Tags = tags
}

// buildDirectoryListingUnlocked constructs the final DirectoryListing response.
// Caller must hold at least a read lock.
func (d *Database) buildDirectoryListingUnlocked(ctx context.Context, opts ListOptions, items []MediaFile, totalItems int) *DirectoryListing {
	logging.Debug("ListDirectory: building response...")

	totalPages := int(math.Ceil(float64(totalItems) / float64(opts.PageSize)))
	if totalPages < 1 {
		totalPages = 1
	}

	breadcrumb := buildBreadcrumb(opts.Path)

	var parent string
	if opts.Path != "" {
		parent = filepath.Dir(opts.Path)
		if parent == "." {
			parent = ""
		}
	}

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
		favorites, err := d.getFavoritesUnlocked(ctx)
		if err == nil && len(favorites) > 0 {
			listing.Favorites = favorites
		}
	}

	return listing
}

// buildBreadcrumb constructs breadcrumb navigation from a file path.
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

// Search searches for media files matching the given query.
func (d *Database) Search(opts SearchOptions) (*SearchResult, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("search", start, err) }()

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

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// First, get files matching FTS
	ftsQuery := `
		SELECT DISTINCT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type
		FROM files f
		INNER JOIN files_fts fts ON f.id = fts.rowid
		WHERE files_fts MATCH ?
	`
	ftsArgs := []interface{}{searchTerm}

	if opts.FilterType != "" {
		ftsQuery += FilterTypeClause
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
		tagQuery += FilterTypeClause
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
	filterClause := ""
	if opts.FilterType != "" {
		filterClause = FilterTypeClause
	}

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
	`, filterClause, filterClause)

	// Build count args
	countArgs := []interface{}{searchTerm}
	if opts.FilterType != "" {
		countArgs = append(countArgs, opts.FilterType)
	}
	countArgs = append(countArgs, tagPattern)
	if opts.FilterType != "" {
		countArgs = append(countArgs, opts.FilterType)
	}

	var totalItems int
	err = d.db.QueryRowContext(ctx, countQuery, countArgs...).Scan(&totalItems)
	if err != nil {
		// If FTS fails (e.g., invalid query), fall back to tag-only search
		return d.searchByTagOnlyUnlocked(ctx, opts, tagPattern)
	}

	totalPages := (totalItems + opts.PageSize - 1) / opts.PageSize
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (opts.Page - 1) * opts.PageSize

	// Add pagination to combined query
	paginatedQuery := combinedQuery + ` LIMIT ? OFFSET ?`

	// Build select args
	selectArgs := make([]interface{}, 0, len(ftsArgs)+len(tagArgs)+2)
	selectArgs = append(selectArgs, ftsArgs...)
	selectArgs = append(selectArgs, tagArgs...)
	selectArgs = append(selectArgs, opts.PageSize, offset)

	rows, err := d.db.QueryContext(ctx, paginatedQuery, selectArgs...)
	if err != nil {
		// Fall back to tag-only search on FTS error
		return d.searchByTagOnlyUnlocked(ctx, opts, tagPattern)
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

		if file.Type == FileTypeImage || file.Type == FileTypeVideo || file.Type == FileTypeFolder {
			file.ThumbnailURL = "/api/thumbnail/" + file.Path
		}

		tags, _ := d.getFileTagsUnlocked(ctx, file.Path)
		file.Tags = tags
		file.IsFavorite = d.isFavoriteUnlocked(ctx, file.Path)

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

// searchByTagOnlyUnlocked is a fallback when FTS fails.
// Caller must hold at least a read lock.
func (d *Database) searchByTagOnlyUnlocked(ctx context.Context, opts SearchOptions, tagPattern string) (*SearchResult, error) {
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

	var totalItems int
	err := d.db.QueryRowContext(ctx, countQuery, countArgs...).Scan(&totalItems)
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

	rows, err := d.db.QueryContext(ctx, selectQuery, selectArgs...)
	if err != nil {
		return &SearchResult{Items: []MediaFile{}, Query: opts.Query}, nil
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

		if file.Type == FileTypeImage || file.Type == FileTypeVideo || file.Type == FileTypeFolder {
			file.ThumbnailURL = "/api/thumbnail/" + file.Path
		}

		tags, _ := d.getFileTagsUnlocked(ctx, file.Path)
		file.Tags = tags
		file.IsFavorite = d.isFavoriteUnlocked(ctx, file.Path)

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

// SearchSuggestions returns quick search suggestions for autocomplete.
func (d *Database) SearchSuggestions(query string, limit int) ([]SearchSuggestion, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("search_suggestions", start, err) }()

	if query == "" || len(query) < 2 {
		return []SearchSuggestion{}, nil
	}

	if limit <= 0 {
		limit = 10
	}
	if limit > 20 {
		limit = 20
	}

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	var suggestions []SearchSuggestion

	// First, get matching tags as suggestions
	tagSuggestions, tagErr := d.getTagSuggestionsUnlocked(ctx, query, limit/2)
	if tagErr == nil {
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

	rows, err := d.db.QueryContext(ctx, sqlQuery, searchTerm, remainingLimit)
	if err != nil {
		// Return tag suggestions even if FTS fails
		return suggestions, nil
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

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

// getTagSuggestionsUnlocked returns tags matching the query as search suggestions.
// Caller must hold at least a read lock.
func (d *Database) getTagSuggestionsUnlocked(ctx context.Context, query string, limit int) ([]SearchSuggestion, error) {
	rows, err := d.db.QueryContext(ctx, `
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
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

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

// prepareSearchTerm prepares a search term for FTS5 trigram search.
func prepareSearchTerm(query string) string {
	// Clean up the query
	query = strings.TrimSpace(query)

	// Escape quotes
	query = strings.ReplaceAll(query, `"`, `""`)

	// Wrap in quotes for phrase matching with trigram
	return `"` + query + `"`
}

// highlightMatch wraps matching text in <mark> tags.
func highlightMatch(text, query string) string {
	lowerText := strings.ToLower(text)
	lowerQuery := strings.ToLower(query)

	idx := strings.Index(lowerText, lowerQuery)
	if idx == -1 {
		return text
	}

	return text[:idx] + "<mark>" + text[idx:idx+len(query)] + "</mark>" + text[idx+len(query):]
}

// GetAllPlaylists returns all playlist files.
func (d *Database) GetAllPlaylists() ([]MediaFile, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("get_all_playlists", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	query := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files WHERE type = 'playlist'
		ORDER BY name COLLATE NOCASE
	`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

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

// GetMediaInDirectory returns all media files in a directory (for lightbox).
func (d *Database) GetMediaInDirectory(parentPath string, sortField SortField, sortOrder SortOrder) ([]MediaFile, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("get_media_in_directory", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Build sort clause - default to name if not specified
	if sortField == "" {
		sortField = SortByName
	}
	if sortOrder == "" {
		sortOrder = SortAsc
	}

	sortColumn := getSortColumn(sortField)
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

	rows, err := d.db.QueryContext(ctx, query, parentPath)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

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

		// Use unlocked versions since we already hold the lock
		file.IsFavorite = d.isFavoriteUnlocked(ctx, file.Path)
		tags, _ := d.getFileTagsUnlocked(ctx, file.Path)
		file.Tags = tags

		files = append(files, file)
	}

	return files, nil
}

// GetMediaFilesInFolder returns media files directly within a folder (for folder thumbnails).
func (d *Database) GetMediaFilesInFolder(folderPath string, limit int) ([]MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	if limit <= 0 {
		limit = 10
	}

	query := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files
		WHERE parent_path = ? AND type IN (?, ?)
		ORDER BY name COLLATE NOCASE
		LIMIT ?
	`

	rows, err := d.db.QueryContext(ctx, query, folderPath, FileTypeImage, FileTypeVideo, limit)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	var files []MediaFile
	for rows.Next() {
		var f MediaFile
		var modTime int64
		var mimeType sql.NullString

		if err := rows.Scan(&f.ID, &f.Name, &f.Path, &f.ParentPath, &f.Type, &f.Size, &modTime, &mimeType); err != nil {
			return nil, err
		}

		f.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			f.MimeType = mimeType.String
		}

		files = append(files, f)
	}

	return files, rows.Err()
}

// CalculateStats calculates current index statistics.
func (d *Database) CalculateStats() (IndexStats, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("calculate_stats", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

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
		if queryErr := d.db.QueryRowContext(ctx, q.query).Scan(q.dest); queryErr != nil {
			err = queryErr
			return stats, queryErr
		}
	}

	return stats, nil
}

// GetSubfolders returns all immediate subfolders of a given path
func (d *Database) GetSubfolders(parentPath string) ([]MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	query := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files
		WHERE parent_path = ? AND type = ?
		ORDER BY name COLLATE NOCASE
	`

	rows, err := d.db.QueryContext(ctx, query, parentPath, FileTypeFolder)
	if err != nil {
		return nil, fmt.Errorf("failed to query subfolders: %w", err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	var folders []MediaFile
	for rows.Next() {
		var f MediaFile
		var modTime int64
		var mimeType sql.NullString

		err := rows.Scan(
			&f.ID,
			&f.Name,
			&f.Path,
			&f.ParentPath,
			&f.Type,
			&f.Size,
			&modTime,
			&mimeType,
		)
		if err != nil {
			logging.Warn("error scanning subfolder row: %v", err)
			continue
		}

		f.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			f.MimeType = mimeType.String
		}

		folders = append(folders, f)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating subfolder rows: %w", err)
	}

	return folders, nil
}

// GetAllMediaFiles returns all media files (images, videos, folders) for thumbnail rebuilding
func (d *Database) GetAllMediaFiles() ([]MediaFile, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("get_all_media_files", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	query := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files
		WHERE type IN (?, ?, ?)
		ORDER BY path
	`

	rows, err := d.db.QueryContext(ctx, query, FileTypeImage, FileTypeVideo, FileTypeFolder)
	if err != nil {
		return nil, fmt.Errorf("failed to query media files: %w", err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	var files []MediaFile
	for rows.Next() {
		var f MediaFile
		var modTime int64
		var mimeType sql.NullString

		err := rows.Scan(
			&f.ID,
			&f.Name,
			&f.Path,
			&f.ParentPath,
			&f.Type,
			&f.Size,
			&modTime,
			&mimeType,
		)
		if err != nil {
			logging.Warn("error scanning media file row: %v", err)
			continue
		}

		f.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			f.MimeType = mimeType.String
		}

		files = append(files, f)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating media file rows: %w", err)
	}

	return files, nil
}

// GetAllMediaFilesForThumbnails returns all media files ordered by path depth (root first)
// This ensures parent folders are processed before children
func (d *Database) GetAllMediaFilesForThumbnails() ([]MediaFile, error) {
	start := time.Now()
	var err error
	defer func() { recordQuery("get_all_media_files_for_thumbnails", start, err) }()

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	// Order by path depth (fewer slashes = closer to root) then by path
	// This ensures folders are processed before their contents
	query := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files
		WHERE type IN (?, ?, ?)
		ORDER BY 
			(LENGTH(path) - LENGTH(REPLACE(path, '/', ''))) ASC,
			path ASC
	`

	rows, err := d.db.QueryContext(ctx, query, FileTypeFolder, FileTypeImage, FileTypeVideo)
	if err != nil {
		return nil, fmt.Errorf("failed to query media files: %w", err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	var files []MediaFile
	for rows.Next() {
		var f MediaFile
		var modTime int64
		var mimeType sql.NullString

		err := rows.Scan(
			&f.ID,
			&f.Name,
			&f.Path,
			&f.ParentPath,
			&f.Type,
			&f.Size,
			&modTime,
			&mimeType,
		)
		if err != nil {
			logging.Warn("error scanning media file row: %v", err)
			continue
		}

		f.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			f.MimeType = mimeType.String
		}

		files = append(files, f)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating media file rows: %w", err)
	}

	return files, nil
}
