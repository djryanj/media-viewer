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
	// TagSuggestionType is the type identifier for tag suggestions.
	TagSuggestionType = "tag"
	// TagExcludeSuggestionType is the type identifier for tag exclusion suggestions.
	TagExcludeSuggestionType = "tag-exclude"
	// FilterTypeClause is the SQL filter clause for file type matching.
	FilterTypeClause = " AND f.type = ?"
	// TagPrefix is the prefix used for tag search queries.
	TagPrefix = "tag:"
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

// TagFilter represents an included or excluded tag in a search query
type TagFilter struct {
	Name     string
	Excluded bool
}

// ListDirectory returns a paginated directory listing.
func (d *Database) ListDirectory(ctx context.Context, opts ListOptions) (*DirectoryListing, error) {
	done := observeQuery("list_directory")

	logging.Debug("ListDirectory called: path=%q", opts.Path)

	opts = normalizeListOptions(opts)

	d.mu.RLock()
	defer d.mu.RUnlock()

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	totalItems, err := d.countDirectoryItemsUnlocked(ctx, opts)
	if err != nil {
		done(err)
		return nil, err
	}

	logging.Debug("ListDirectory: count=%d, getting items...", totalItems)

	items, err := d.fetchDirectoryItemsUnlocked(ctx, opts)
	if err != nil {
		done(err)
		return nil, err
	}

	listing := d.buildDirectoryListingUnlocked(ctx, opts, items, totalItems)

	logging.Debug("ListDirectory completed")

	done(nil)
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
	// Allow large page sizes for bulk operations (e.g., ListFilePaths)
	// but cap at a reasonable maximum to prevent memory issues
	if opts.PageSize > 100000 {
		opts.PageSize = 100000
	}
	return opts
}

// countDirectoryItemsUnlocked returns the total count of items in a directory.
// Constants for query values
const (
	SortAscStr       = "ASC"
	SortDescStr      = "DESC"
	NameCollationStr = "f.name COLLATE NOCASE"
)

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
	sortDir := SortAscStr
	if opts.SortOrder == SortDesc {
		sortDir = "DESC"
	}

	offset := (opts.Page - 1) * opts.PageSize

	selectQuery := `
		SELECT
			f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type,
			CASE WHEN fav.path IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
			GROUP_CONCAT(t.name, ',') as tags,
			(SELECT COUNT(*) FROM files WHERE parent_path = f.path) as folder_count
		FROM files f
		LEFT JOIN favorites fav ON f.path = fav.path
		LEFT JOIN file_tags ft ON f.path = ft.file_path
		LEFT JOIN tags t ON ft.tag_id = t.id
		WHERE f.parent_path = ?
	`
	selectArgs := []interface{}{opts.Path}

	if opts.FilterType != "" {
		selectQuery += ` AND (f.type = 'folder' OR f.type = ?)`
		selectArgs = append(selectArgs, opts.FilterType)
	}

	selectQuery += ` GROUP BY f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type, fav.path`

	var orderColumn string
	if sortColumn == NameCollation {
		orderColumn = NameCollationStr
	} else {
		orderColumn = "f." + sortColumn
	}

	allowedColumns := map[string]bool{
		"f.name COLLATE NOCASE": true,
		"f.mod_time":            true,
		"f.size":                true,
		"f.type":                true,
	}
	allowedSortDirs := map[string]bool{
		SortAscStr:  true,
		SortDescStr: true,
	}
	if !allowedColumns[orderColumn] {
		orderColumn = NameCollationStr
	}
	if !allowedSortDirs[sortDir] {
		sortDir = SortAscStr
	}
	selectQuery += fmt.Sprintf(` ORDER BY (CASE WHEN f.type = 'folder' THEN 0 ELSE 1 END), %s %s`, orderColumn, sortDir) //nolint:gosec // G202 - orderColumn and sortDir are validated against static allowlists; SQL column names cannot be parameterized
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

	return d.scanDirectoryItemsUnlocked(rows)
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

// scanDirectoryItemsUnlocked scans rows into MediaFile structs with all data from optimized query.
// Caller must hold at least a read lock.
func (d *Database) scanDirectoryItemsUnlocked(rows *sql.Rows) ([]MediaFile, error) {
	logging.Debug("ListDirectory: scanning rows...")

	items := make([]MediaFile, 0, 128)
	for rows.Next() {
		var file MediaFile
		var modTime int64
		var mimeType sql.NullString
		var isFavorite int
		var tagsString sql.NullString
		var folderCount int

		if err := rows.Scan(
			&file.ID, &file.Name, &file.Path, &file.ParentPath,
			&file.Type, &file.Size, &modTime, &mimeType,
			&isFavorite, &tagsString, &folderCount,
		); err != nil {
			return nil, err
		}

		file.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			file.MimeType = mimeType.String
		}

		if file.Type == FileTypeImage || file.Type == FileTypeVideo || file.Type == FileTypeFolder {
			file.ThumbnailURL = "/api/thumbnail/" + file.Path
		}

		file.IsFavorite = isFavorite == 1

		if tagsString.Valid && tagsString.String != "" {
			file.Tags = strings.Split(tagsString.String, ",")
		}

		if file.Type == FileTypeFolder {
			file.ItemCount = folderCount
		}

		items = append(items, file)
	}

	if err := rows.Err(); err != nil {
		logging.Error("ListDirectory rows error: %v", err)
		return nil, fmt.Errorf("rows error: %w", err)
	}

	return items, nil
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
func (d *Database) Search(ctx context.Context, opts SearchOptions) (*SearchResult, error) {
	done := observeQuery("search")

	if opts.Query == "" {
		done(nil)
		return &SearchResult{
			Items:      []MediaFile{},
			Query:      "",
			TotalItems: 0,
			Page:       1,
			PageSize:   opts.PageSize,
			TotalPages: 0,
		}, nil
	}

	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PageSize < 1 {
		opts.PageSize = 50
	}
	if opts.PageSize > 200 {
		opts.PageSize = 200
	}

	textQuery, tagFilters := parseTagFilters(opts.Query)

	var includedTags, excludedTags []string
	for _, tf := range tagFilters {
		if tf.Excluded {
			excludedTags = append(excludedTags, tf.Name)
		} else {
			includedTags = append(includedTags, tf.Name)
		}
	}

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var result *SearchResult
	var err error

	switch {
	case textQuery == "" && len(tagFilters) > 0:
		result, err = d.searchByTagFiltersUnlocked(ctx, opts, includedTags, excludedTags)
	case textQuery == "" && len(tagFilters) == 0:
		result = &SearchResult{Items: []MediaFile{}, Query: opts.Query}
	default:
		result, err = d.searchWithTagFiltersUnlocked(ctx, opts, textQuery, includedTags, excludedTags)
	}

	done(err)
	return result, err
}

// searchByTagFiltersUnlocked handles searches with only tag filters (no text)
func (d *Database) searchByTagFiltersUnlocked(ctx context.Context, opts SearchOptions, includedTags, excludedTags []string) (*SearchResult, error) {
	var conditions []string
	var args []interface{}

	baseQuery := `
		SELECT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type,
		       COALESCE(fav.path IS NOT NULL, 0) AS is_favorite,
		       GROUP_CONCAT(t_all.name, ',') AS tags
		FROM files f
		LEFT JOIN favorites fav ON f.path = fav.path
		LEFT JOIN file_tags ft_all ON f.path = ft_all.file_path
		LEFT JOIN tags t_all ON ft_all.tag_id = t_all.id
	`

	for i, tag := range includedTags {
		alias := fmt.Sprintf("ft_inc_%d", i)
		tagAlias := fmt.Sprintf("t_inc_%d", i)
		baseQuery += fmt.Sprintf(`
			INNER JOIN file_tags %s ON f.path = %s.file_path
			INNER JOIN tags %s ON %s.tag_id = %s.id AND %s.name = ? COLLATE NOCASE
		`, alias, alias, tagAlias, alias, tagAlias, tagAlias)
		args = append(args, tag)
	}

	for _, tag := range excludedTags {
		conditions = append(conditions, `
			NOT EXISTS (
				SELECT 1 FROM file_tags ft_exc
				INNER JOIN tags t_exc ON ft_exc.tag_id = t_exc.id
				WHERE ft_exc.file_path = f.path AND t_exc.name = ? COLLATE NOCASE
			)
		`)
		args = append(args, tag)
	}

	if opts.FilterType != "" {
		conditions = append(conditions, "f.type = ?")
		args = append(args, opts.FilterType)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	countBaseQuery := "SELECT COUNT(DISTINCT f.path) FROM files f"
	for i := range includedTags {
		alias := fmt.Sprintf("ft_inc_%d", i)
		tagAlias := fmt.Sprintf("t_inc_%d", i)
		countBaseQuery += fmt.Sprintf(`
			INNER JOIN file_tags %s ON f.path = %s.file_path
			INNER JOIN tags %s ON %s.tag_id = %s.id AND %s.name = ? COLLATE NOCASE
		`, alias, alias, tagAlias, alias, tagAlias, tagAlias)
	}

	countQuery := countBaseQuery
	if whereClause != "" {
		countQuery += " " + whereClause
	}

	var totalItems int
	err := d.db.QueryRowContext(ctx, countQuery, args...).Scan(&totalItems)
	if err != nil {
		return nil, fmt.Errorf("count query failed: %w", err)
	}

	totalPages := (totalItems + opts.PageSize - 1) / opts.PageSize
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (opts.Page - 1) * opts.PageSize

	groupBy := " GROUP BY f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type, fav.path"

	selectQuery := baseQuery
	if whereClause != "" {
		selectQuery += " " + whereClause
	}
	selectQuery += groupBy + " ORDER BY f.name COLLATE NOCASE LIMIT ? OFFSET ?"
	selectArgs := make([]interface{}, len(args), len(args)+2)
	copy(selectArgs, args)
	selectArgs = append(selectArgs, opts.PageSize, offset)

	rows, err := d.db.QueryContext(ctx, selectQuery, selectArgs...)
	if err != nil {
		return nil, fmt.Errorf("select query failed: %w", err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	items := make([]MediaFile, 0, opts.PageSize)
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

		if file.Type == FileTypeImage || file.Type == FileTypeVideo || file.Type == FileTypeFolder {
			file.ThumbnailURL = "/api/thumbnail/" + file.Path
		}

		file.IsFavorite = isFavorite == 1

		if tagsString.Valid && tagsString.String != "" {
			file.Tags = strings.Split(tagsString.String, ",")
		}

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

// searchWithTagFiltersUnlocked handles combined text + tag filter searches
func (d *Database) searchWithTagFiltersUnlocked(ctx context.Context, opts SearchOptions, textQuery string, includedTags, excludedTags []string) (*SearchResult, error) {
	searchTerm := prepareSearchTerm(textQuery)
	tagPattern := "%" + textQuery + "%"

	exclusionConditions := make([]string, 0, len(excludedTags))
	exclusionArgs := make([]interface{}, 0, len(excludedTags))

	for _, tag := range excludedTags {
		exclusionConditions = append(exclusionConditions, `
			NOT EXISTS (
				SELECT 1 FROM file_tags ft_exc
				INNER JOIN tags t_exc ON ft_exc.tag_id = t_exc.id
				WHERE ft_exc.file_path = f.path AND t_exc.name = ? COLLATE NOCASE
			)
		`)
		exclusionArgs = append(exclusionArgs, tag)
	}

	exclusionClause := ""
	if len(exclusionConditions) > 0 {
		exclusionClause = " AND " + strings.Join(exclusionConditions, " AND ")
	}

	var inclusionJoins string
	inclusionArgs := make([]interface{}, 0, len(includedTags))
	for i, tag := range includedTags {
		alias := fmt.Sprintf("ft_req_%d", i)
		tagAlias := fmt.Sprintf("t_req_%d", i)
		inclusionJoins += fmt.Sprintf(`
			INNER JOIN file_tags %s ON f.path = %s.file_path
			INNER JOIN tags %s ON %s.tag_id = %s.id AND %s.name = ? COLLATE NOCASE
		`, alias, alias, tagAlias, alias, tagAlias, tagAlias)
		inclusionArgs = append(inclusionArgs, tag)
	}

	filterClause := ""
	var filterArgs []interface{}
	if opts.FilterType != "" {
		filterClause = FilterTypeClause
		filterArgs = append(filterArgs, opts.FilterType)
	}

	ftsQuery := fmt.Sprintf(`
		SELECT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type,
		       CASE WHEN fav.path IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
		       GROUP_CONCAT(t_all.name, ',') as tags
		FROM files f
		INNER JOIN files_fts fts ON f.id = fts.rowid
		%s
		LEFT JOIN favorites fav ON f.path = fav.path
		LEFT JOIN file_tags ft_all ON f.path = ft_all.file_path
		LEFT JOIN tags t_all ON ft_all.tag_id = t_all.id
		WHERE files_fts MATCH ?
		%s
		%s
		GROUP BY f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type, fav.path
	`, inclusionJoins, filterClause, exclusionClause)

	tagQuery := fmt.Sprintf(`
		SELECT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type,
		       CASE WHEN fav.path IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
		       GROUP_CONCAT(t_all.name, ',') as tags
		FROM files f
		INNER JOIN file_tags ft ON f.path = ft.file_path
		INNER JOIN tags t ON ft.tag_id = t.id
		%s
		LEFT JOIN favorites fav ON f.path = fav.path
		LEFT JOIN file_tags ft_all ON f.path = ft_all.file_path
		LEFT JOIN tags t_all ON ft_all.tag_id = t_all.id
		WHERE t.name LIKE ?
		%s
		%s
		GROUP BY f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type, fav.path
	`, inclusionJoins, filterClause, exclusionClause)

	ftsArgs := make([]interface{}, 0, len(inclusionArgs)+1+len(filterArgs)+len(exclusionArgs))
	ftsArgs = append(ftsArgs, inclusionArgs...)
	ftsArgs = append(ftsArgs, searchTerm)
	ftsArgs = append(ftsArgs, filterArgs...)
	ftsArgs = append(ftsArgs, exclusionArgs...)

	tagArgs := make([]interface{}, 0, len(inclusionArgs)+1+len(filterArgs)+len(exclusionArgs))
	tagArgs = append(tagArgs, inclusionArgs...)
	tagArgs = append(tagArgs, tagPattern)
	tagArgs = append(tagArgs, filterArgs...)
	tagArgs = append(tagArgs, exclusionArgs...)

	combinedQuery := fmt.Sprintf(`
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type, is_favorite, tags
		FROM (
			%s
			UNION
			%s
		) combined
		ORDER BY name COLLATE NOCASE
	`, ftsQuery, tagQuery)

	ftsCountQuery := fmt.Sprintf(`
		SELECT DISTINCT f.path
		FROM files f
		INNER JOIN files_fts fts ON f.id = fts.rowid
		%s
		WHERE files_fts MATCH ?
		%s
		%s
	`, inclusionJoins, filterClause, exclusionClause)

	tagCountQuery := fmt.Sprintf(`
		SELECT DISTINCT f.path
		FROM files f
		INNER JOIN file_tags ft ON f.path = ft.file_path
		INNER JOIN tags t ON ft.tag_id = t.id
		%s
		WHERE t.name LIKE ?
		%s
		%s
	`, inclusionJoins, filterClause, exclusionClause)

	countQuery := fmt.Sprintf(`
		SELECT COUNT(*) FROM (
			SELECT path FROM (%s UNION %s)
		)
	`, ftsCountQuery, tagCountQuery)

	countArgs := make([]interface{}, 0, len(inclusionArgs)+1+len(filterArgs)+len(exclusionArgs)+len(inclusionArgs)+1+len(filterArgs)+len(exclusionArgs))
	countArgs = append(countArgs, inclusionArgs...)
	countArgs = append(countArgs, searchTerm)
	countArgs = append(countArgs, filterArgs...)
	countArgs = append(countArgs, exclusionArgs...)
	countArgs = append(countArgs, inclusionArgs...)
	countArgs = append(countArgs, tagPattern)
	countArgs = append(countArgs, filterArgs...)
	countArgs = append(countArgs, exclusionArgs...)

	var totalItems int
	err := d.db.QueryRowContext(ctx, countQuery, countArgs...).Scan(&totalItems)
	if err != nil {
		logging.Warn("Combined search count failed, trying tag-only: %v", err)
		return d.searchByTagFiltersUnlocked(ctx, opts, includedTags, excludedTags)
	}

	totalPages := (totalItems + opts.PageSize - 1) / opts.PageSize
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (opts.Page - 1) * opts.PageSize

	paginatedQuery := combinedQuery + " LIMIT ? OFFSET ?" //nolint:gosec // G202 false positive - LIMIT and OFFSET use parameterized placeholders (?), values are bound via selectArgs

	selectArgs := make([]interface{}, 0, len(ftsArgs)+len(tagArgs)+2)
	selectArgs = append(selectArgs, ftsArgs...)
	selectArgs = append(selectArgs, tagArgs...)
	selectArgs = append(selectArgs, opts.PageSize, offset)

	rows, err := d.db.QueryContext(ctx, paginatedQuery, selectArgs...)
	if err != nil {
		logging.Warn("Combined search select failed: %v", err)
		return d.searchByTagFiltersUnlocked(ctx, opts, includedTags, excludedTags)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	items := make([]MediaFile, 0, opts.PageSize)
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

		if file.Type == FileTypeImage || file.Type == FileTypeVideo || file.Type == FileTypeFolder {
			file.ThumbnailURL = "/api/thumbnail/" + file.Path
		}

		file.IsFavorite = isFavorite == 1

		if tagsString.Valid && tagsString.String != "" {
			file.Tags = strings.Split(tagsString.String, ",")
		}

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
func (d *Database) SearchSuggestions(ctx context.Context, query string, limit int) ([]SearchSuggestion, error) {
	done := observeQuery("search_suggestions")

	if query == "" {
		done(nil)
		return []SearchSuggestion{}, nil
	}

	limit = normalizeLimit(limit)

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	queryLower := strings.ToLower(query)

	if suggestions, handled := d.handleTagQuery(ctx, query, queryLower, limit); handled {
		done(nil)
		return suggestions, nil
	}

	if len(query) < 2 {
		done(nil)
		return []SearchSuggestion{}, nil
	}

	suggestions := d.performRegularSearch(ctx, query, limit)
	done(nil)
	return suggestions, nil
}

// normalizeLimit ensures the limit is within acceptable bounds
func normalizeLimit(limit int) int {
	if limit <= 0 {
		return 10
	}
	if limit > 20 {
		return 20
	}
	return limit
}

// handleTagQuery processes tag-related queries and returns suggestions if applicable
func (d *Database) handleTagQuery(ctx context.Context, query, queryLower string, limit int) ([]SearchSuggestion, bool) {
	if strings.HasPrefix(query, "-") {
		return d.handleExclusionQuery(ctx, query, limit), true
	}

	if strings.HasPrefix(queryLower, "not "+TagPrefix) {
		tagQuery := query[8:]
		suggestions, _ := d.getTagSuggestionsForExclusionUnlocked(ctx, tagQuery, limit, true)
		return suggestions, true
	}

	if strings.HasPrefix(queryLower, "not ") {
		remainder := strings.ToLower(query[4:])
		if strings.HasPrefix(TagPrefix, remainder) || strings.HasPrefix(remainder, "tag") {
			suggestions, _ := d.getTagSuggestionsForExclusionUnlocked(ctx, "", limit, true)
			return suggestions, true
		}
	}

	if strings.HasPrefix(queryLower, TagPrefix) {
		tagQuery := query[4:]
		suggestions, _ := d.getTagSuggestionsUnlocked(ctx, tagQuery, limit)
		return suggestions, true
	}

	return nil, false
}

// handleExclusionQuery processes exclusion queries starting with "-"
func (d *Database) handleExclusionQuery(ctx context.Context, query string, limit int) []SearchSuggestion {
	remainder := query[1:]
	remainderLower := strings.ToLower(remainder)

	if strings.HasPrefix(remainderLower, TagPrefix) {
		tagQuery := remainder[4:]
		suggestions, _ := d.getTagSuggestionsForExclusionUnlocked(ctx, tagQuery, limit, true)
		return suggestions
	}

	if strings.HasPrefix(TagPrefix, remainderLower) || strings.HasPrefix(remainderLower, "tag") {
		suggestions, _ := d.getTagSuggestionsForExclusionUnlocked(ctx, "", limit, true)
		return suggestions
	}

	suggestions, _ := d.getTagSuggestionsForExclusionUnlocked(ctx, remainder, limit, true)
	return suggestions
}

// performRegularSearch conducts a standard search combining tags and files
func (d *Database) performRegularSearch(ctx context.Context, query string, limit int) []SearchSuggestion {
	var suggestions []SearchSuggestion

	tagSuggestions, _ := d.getTagSuggestionsUnlocked(ctx, query, limit/2)
	suggestions = append(suggestions, tagSuggestions...)

	remainingLimit := limit - len(suggestions)
	if remainingLimit <= 0 {
		return suggestions
	}

	fileSuggestions := d.searchFileSuggestions(ctx, query, remainingLimit)
	suggestions = append(suggestions, fileSuggestions...)

	return suggestions
}

// searchFileSuggestions searches for file suggestions using FTS
func (d *Database) searchFileSuggestions(ctx context.Context, query string, limit int) []SearchSuggestion {
	searchTerm := prepareSearchTerm(query)

	sqlQuery := `
		SELECT f.name, f.path, f.type, bm25(files_fts) as rank
		FROM files f
		INNER JOIN files_fts fts ON f.id = fts.rowid
		WHERE files_fts MATCH ?
		ORDER BY rank
		LIMIT ?
	`

	rows, err := d.db.QueryContext(ctx, sqlQuery, searchTerm, limit)
	if err != nil {
		return []SearchSuggestion{}
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	var suggestions []SearchSuggestion
	for rows.Next() {
		var s SearchSuggestion
		var rank float64

		if err := rows.Scan(&s.Name, &s.Path, &s.Type, &rank); err != nil {
			continue
		}

		s.Highlight = highlightMatch(s.Name, query)
		suggestions = append(suggestions, s)
	}

	return suggestions
}

// getTagSuggestionsForExclusionUnlocked returns tag suggestions for exclusion queries
func (d *Database) getTagSuggestionsForExclusionUnlocked(ctx context.Context, query string, limit int, isExclusion bool) ([]SearchSuggestion, error) {
	var rows *sql.Rows
	var err error

	if query == "" {
		rows, err = d.db.QueryContext(ctx, `
			SELECT t.name, COUNT(ft.id) as item_count
			FROM tags t
			LEFT JOIN file_tags ft ON t.id = ft.tag_id
			GROUP BY t.id
			ORDER BY item_count DESC, t.name COLLATE NOCASE
			LIMIT ?
		`, limit)
	} else {
		searchPattern := "%" + query + "%"
		rows, err = d.db.QueryContext(ctx, `
			SELECT t.name, COUNT(ft.id) as item_count
			FROM tags t
			LEFT JOIN file_tags ft ON t.id = ft.tag_id
			WHERE t.name LIKE ?
			GROUP BY t.id
			ORDER BY item_count DESC, t.name COLLATE NOCASE
			LIMIT ?
		`, searchPattern, limit)
	}

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

		prefix := TagPrefix
		suggestionType := TagSuggestionType
		if isExclusion {
			prefix = "-tag:"
			suggestionType = TagExcludeSuggestionType
		}

		highlight := name
		if query != "" {
			highlight = highlightMatch(name, query)
		}

		suggestions = append(suggestions, SearchSuggestion{
			Path:      prefix + name,
			Name:      name,
			Type:      suggestionType,
			Highlight: highlight,
			ItemCount: count,
		})
	}

	return suggestions, nil
}

// getTagSuggestionsUnlocked returns tags matching the query as search suggestions.
// Caller must hold at least a read lock.
func (d *Database) getTagSuggestionsUnlocked(ctx context.Context, query string, limit int) ([]SearchSuggestion, error) {
	var rows *sql.Rows
	var err error

	if query == "" {
		rows, err = d.db.QueryContext(ctx, `
			SELECT t.name, COUNT(ft.id) as item_count
			FROM tags t
			LEFT JOIN file_tags ft ON t.id = ft.tag_id
			GROUP BY t.id
			ORDER BY item_count DESC, t.name COLLATE NOCASE
			LIMIT ?
		`, limit)
	} else {
		rows, err = d.db.QueryContext(ctx, `
			SELECT t.name, COUNT(ft.id) as item_count
			FROM tags t
			LEFT JOIN file_tags ft ON t.id = ft.tag_id
			WHERE t.name LIKE ?
			GROUP BY t.id
			ORDER BY item_count DESC, t.name COLLATE NOCASE
			LIMIT ?
		`, "%"+query+"%", limit)
	}

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

		highlight := name
		if query != "" {
			highlight = highlightMatch(name, query)
		}

		suggestions = append(suggestions, SearchSuggestion{
			Path:      TagPrefix + name,
			Name:      name,
			Type:      TagSuggestionType,
			Highlight: highlight,
			ItemCount: count,
		})
	}

	return suggestions, nil
}

// prepareSearchTerm prepares a search term for FTS5 trigram search.
func prepareSearchTerm(query string) string {
	query = strings.TrimSpace(query)
	query = strings.ReplaceAll(query, `"`, `""`)
	return `"` + query + `"`
}

// highlightMatch wraps matching text in <mark> tags.
func highlightMatch(text, query string) string {
	if query == "" {
		return text
	}

	lowerText := strings.ToLower(text)
	lowerQuery := strings.ToLower(query)

	idx := strings.Index(lowerText, lowerQuery)
	if idx == -1 {
		return text
	}

	return text[:idx] + "<mark>" + text[idx:idx+len(query)] + "</mark>" + text[idx+len(query):]
}

// GetAllPlaylists returns all playlist files.
func (d *Database) GetAllPlaylists(ctx context.Context) ([]MediaFile, error) {
	done := observeQuery("get_all_playlists")

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	query := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type
		FROM files WHERE type = 'playlist'
		ORDER BY name COLLATE NOCASE
	`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		done(err)
		return nil, err
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	playlists := make([]MediaFile, 0, 32)
	for rows.Next() {
		var file MediaFile
		var modTime int64
		var mimeType sql.NullString

		if err := rows.Scan(
			&file.ID, &file.Name, &file.Path, &file.ParentPath,
			&file.Type, &file.Size, &modTime, &mimeType,
		); err != nil {
			done(err)
			return nil, err
		}

		file.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			file.MimeType = mimeType.String
		}

		playlists = append(playlists, file)
	}

	done(nil)
	return playlists, nil
}

// GetMediaInDirectory returns all media files in a directory (for lightbox).
// Optimized to fetch favorites and tags in a single query using JOINs to eliminate N+1 queries.
func (d *Database) GetMediaInDirectory(ctx context.Context, parentPath string, sortField SortField, sortOrder SortOrder) ([]MediaFile, error) {
	done := observeQuery("get_media_in_directory")

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

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

	if sortColumn == NameCollation {
		sortColumn = "f.name COLLATE NOCASE"
	} else {
		sortColumn = "f." + sortColumn
	}

	secondarySort := ""
	if sortField != SortByName && sortField != "" {
		secondarySort = ", f.name COLLATE NOCASE ASC"
	}

	query := fmt.Sprintf(`
		SELECT
			f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type,
			CASE WHEN fav.path IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
			GROUP_CONCAT(t.name, ',') as tags
		FROM files f
		LEFT JOIN favorites fav ON f.path = fav.path
		LEFT JOIN file_tags ft ON f.path = ft.file_path
		LEFT JOIN tags t ON ft.tag_id = t.id
		WHERE f.parent_path = ? AND f.type IN ('image', 'video')
		GROUP BY f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type, fav.path
		ORDER BY %s %s%s
	`, sortColumn, sortDir, secondarySort)

	rows, err := d.db.QueryContext(ctx, query, parentPath)
	if err != nil {
		done(err)
		return nil, err
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	files := make([]MediaFile, 0, 128)

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
			done(err)
			return nil, err
		}

		file.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			file.MimeType = mimeType.String
		}
		file.ThumbnailURL = "/api/thumbnail/" + file.Path
		file.IsFavorite = isFavorite == 1

		if tagsString.Valid && tagsString.String != "" {
			file.Tags = strings.Split(tagsString.String, ",")
		}

		files = append(files, file)
	}

	done(nil)
	return files, nil
}

// GetMediaFilesInFolder returns media files directly within a folder (for folder thumbnails).
func (d *Database) GetMediaFilesInFolder(ctx context.Context, folderPath string, limit int) ([]MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
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

	files := make([]MediaFile, 0, limit)
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
// This method uses its own context as it's typically called from non-HTTP contexts.
func (d *Database) CalculateStats() (IndexStats, error) {
	done := observeQuery("calculate_stats")

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
		{"SELECT COUNT(*) FROM tags", &stats.TotalTags},
	}

	for _, q := range queries {
		if queryErr := d.db.QueryRowContext(ctx, q.query).Scan(q.dest); queryErr != nil {
			done(queryErr)
			return stats, queryErr
		}
	}

	done(nil)
	return stats, nil
}

// GetSubfolders returns all immediate subfolders of a given path.
func (d *Database) GetSubfolders(ctx context.Context, parentPath string) ([]MediaFile, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
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

	folders := make([]MediaFile, 0, 64)
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

// GetAllMediaFiles returns all media files (images, videos, folders) for thumbnail rebuilding.
// This method uses its own context as it's typically called from non-HTTP contexts.
func (d *Database) GetAllMediaFiles() ([]MediaFile, error) {
	done := observeQuery("get_all_media_files")

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
		done(err)
		return nil, fmt.Errorf("failed to query media files: %w", err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	files := make([]MediaFile, 0, 2048)
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
		done(err)
		return nil, fmt.Errorf("error iterating media file rows: %w", err)
	}

	done(nil)
	return files, nil
}

// GetAllMediaFilesForThumbnails returns all media files ordered by path depth (root first).
// This ensures parent folders are processed before children.
// This method uses its own context as it's typically called from non-HTTP contexts.
func (d *Database) GetAllMediaFilesForThumbnails() ([]MediaFile, error) {
	done := observeQuery("get_all_media_files_for_thumbnails")

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

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
		done(err)
		return nil, fmt.Errorf("failed to query media files: %w", err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			logging.Error("error closing rows: %v", err)
		}
	}()

	files := make([]MediaFile, 0, 2048)
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
		done(err)
		return nil, fmt.Errorf("error iterating media file rows: %w", err)
	}

	done(nil)
	return files, nil
}

// GetFilesUpdatedSince returns media files updated after the given timestamp.
// This is used for incremental thumbnail generation.
func (d *Database) GetFilesUpdatedSince(ctx context.Context, since time.Time) ([]MediaFile, error) {
	done := observeQuery("get_files_updated_since")

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	adjustedSince := since.Add(-10 * time.Second)
	sinceTimestamp := adjustedSince.Unix()

	logging.Debug("GetFilesUpdatedSince: original since=%v, adjusted since=%v (buffer: -10s), timestamp=%d",
		since.Format(time.RFC3339), adjustedSince.Format(time.RFC3339), sinceTimestamp)

	query := `
		SELECT id, name, path, parent_path, type, size, mod_time, mime_type, content_updated_at
		FROM files
		WHERE type IN (?, ?, ?) AND COALESCE(content_updated_at, updated_at) > ?
		ORDER BY path
	`

	rows, err := d.db.QueryContext(ctx, query, FileTypeImage, FileTypeVideo, FileTypeFolder, sinceTimestamp)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("failed to query updated files: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			logging.Error("error closing rows: %v", closeErr)
		}
	}()

	files := make([]MediaFile, 0, 256)
	for rows.Next() {
		var file MediaFile
		var modTime int64
		var contentUpdatedAt int64
		var mimeType sql.NullString

		err = rows.Scan(&file.ID, &file.Name, &file.Path, &file.ParentPath, &file.Type, &file.Size, &modTime, &mimeType, &contentUpdatedAt)
		if err != nil {
			done(err)
			return nil, fmt.Errorf("scan file: %w", err)
		}

		file.ModTime = time.Unix(modTime, 0)
		if mimeType.Valid {
			file.MimeType = mimeType.String
		}

		dbContentUpdatedAt := time.Unix(contentUpdatedAt, 0)
		fsToDBDelta := dbContentUpdatedAt.Sub(file.ModTime)
		dbToAdjustedSinceDelta := dbContentUpdatedAt.Sub(adjustedSince)
		dbToOriginalSinceDelta := dbContentUpdatedAt.Sub(since)

		if contentUpdatedAt <= sinceTimestamp {
			logging.Warn("LOGIC ERROR: File %s returned but content_updated_at=%d <= adjustedSinceTimestamp=%d",
				file.Path, contentUpdatedAt, sinceTimestamp)
		}

		logging.Debug("  Found updated file: path=%s, fs_mod_time=%v, db_content_updated_at=%v, fs_to_db_delta=%v, db_to_adjusted_since_delta=%v, db_to_original_since_delta=%v, passes_filter=%v",
			file.Path, file.ModTime.Format(time.RFC3339), dbContentUpdatedAt.Format(time.RFC3339), fsToDBDelta, dbToAdjustedSinceDelta, dbToOriginalSinceDelta, contentUpdatedAt > sinceTimestamp)

		files = append(files, file)
	}

	if err = rows.Err(); err != nil {
		done(err)
		return nil, fmt.Errorf("iterate files: %w", err)
	}

	logging.Debug("GetFilesUpdatedSince: found %d files updated since %v (filter: content_updated_at > %d)", len(files), since.Format(time.RFC3339), sinceTimestamp)
	done(nil)
	return files, nil
}

// GetFoldersWithUpdatedContents returns folders that contain files updated after the given timestamp.
// This includes folders at any level of the hierarchy above the changed files.
func (d *Database) GetFoldersWithUpdatedContents(ctx context.Context, since time.Time) ([]MediaFile, error) {
	done := observeQuery("get_folders_with_updated_contents")

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	adjustedSince := since.Add(-10 * time.Second)
	sinceTimestamp := adjustedSince.Unix()

	logging.Debug("GetFoldersWithUpdatedContents: original since=%v, adjusted since=%v (buffer: -10s), timestamp=%d",
		since.Format(time.RFC3339), adjustedSince.Format(time.RFC3339), sinceTimestamp)

	query := `
	WITH RECURSIVE
	updated_parents AS (
		-- Get immediate parent paths of files whose content was updated
		SELECT DISTINCT parent_path as path
		FROM files
		WHERE COALESCE(content_updated_at, updated_at) > ? AND parent_path != ''

		UNION

		-- Recursively get parent paths up to root
		SELECT
			CASE
				WHEN INSTR(path, '/') > 0
				THEN SUBSTR(path, 1, LENGTH(path) - LENGTH(SUBSTR(path, INSTR(path, '/') + 1)) - 1)
				ELSE ''
			END as path
		FROM updated_parents
		WHERE path != '' AND INSTR(path, '/') > 0
	)
	SELECT DISTINCT f.id, f.name, f.path, f.parent_path, f.type, f.size, f.mod_time, f.mime_type
	FROM files f
	INNER JOIN updated_parents up ON f.path = up.path
	WHERE f.type = ?
	ORDER BY LENGTH(f.path) DESC, f.path
`

	rows, err := d.db.QueryContext(ctx, query, sinceTimestamp, FileTypeFolder)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("failed to query folders with updated contents: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			logging.Error("error closing rows: %v", closeErr)
		}
	}()

	folders, err := d.scanMediaFiles(rows)
	if err != nil {
		done(err)
		return nil, err
	}

	for _, folder := range folders {
		logging.Debug("  Found folder with updated contents: path=%s, folder_mod_time=%v, db_timestamp=%d",
			folder.Path, folder.ModTime.Format(time.RFC3339), folder.ModTime.Unix())
	}

	logging.Debug("GetFoldersWithUpdatedContents: found %d folders with updated contents since %v", len(folders), since.Format(time.RFC3339))
	done(nil)
	return folders, nil
}

// GetAllIndexedPaths returns all file paths currently in the index.
// Used for orphan thumbnail detection.
// Optimized with covering index (type, path) and pre-allocated map to handle large libraries efficiently.
// GetAllIndexedPaths returns all file paths currently in the index.
// Used for orphan thumbnail detection.
func (d *Database) GetAllIndexedPaths(ctx context.Context) (map[string]struct{}, error) {
	done := observeQuery("get_all_indexed_paths")

	d.mu.RLock()
	defer d.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	// Single query — no separate COUNT(*) pre-query.
	// Use NOT IN to exclude the minority types rather than IN for the majority,
	// which helps SQLite choose a more efficient query plan (simple scan vs.
	// multi-range index merge). Adjust the excluded type(s) to match your schema.
	// If 'playlist' is the only non-media type, this is significantly faster.
	rows, err := d.db.QueryContext(ctx,
		"SELECT path FROM files WHERE type != ?",
		FileTypePlaylist,
	)
	if err != nil {
		done(err)
		return nil, fmt.Errorf("failed to query indexed paths: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			logging.Error("error closing rows: %v", closeErr)
		}
	}()

	// Pre-allocate generously — avoids repeated map growth and rehashing.
	// 50000 is a reasonable upper estimate; over-allocating a map is cheap
	// compared to the cost of growing it multiple times.
	paths := make(map[string]struct{}, 50000)
	var path string
	for rows.Next() {
		if err := rows.Scan(&path); err != nil {
			logging.Warn("error scanning path: %v", err)
			continue
		}
		paths[path] = struct{}{}
	}

	if err := rows.Err(); err != nil {
		done(err)
		return nil, fmt.Errorf("error iterating paths: %w", err)
	}

	logging.Debug("GetAllIndexedPaths: loaded %d paths", len(paths))
	done(nil)
	return paths, nil
}

// scanMediaFiles is a helper to scan rows into MediaFile slices.
func (d *Database) scanMediaFiles(rows *sql.Rows) ([]MediaFile, error) {
	files := make([]MediaFile, 0, 128)
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

	return files, rows.Err()
}

// parseTagFilters extracts tag:name and -tag:name patterns from a query
// Returns the remaining query text and the list of tag filters
func parseTagFilters(query string) (string, []TagFilter) {
	var filters []TagFilter
	result := strings.Builder{}
	i := 0

	for i < len(query) {
		i = skipWhitespace(query, i)
		if i >= len(query) {
			break
		}

		tagFilter, newPos, found := tryParseTagPattern(query, i)
		if found {
			if tagFilter.Name != "" {
				filters = append(filters, tagFilter)
			}
			i = newPos
			continue
		}

		i = addWordToResult(&result, query, i)
	}

	return strings.TrimSpace(result.String()), filters
}

// skipWhitespace advances the position past any whitespace characters
func skipWhitespace(s string, pos int) int {
	for pos < len(s) && s[pos] == ' ' {
		pos++
	}
	return pos
}

// tryParseTagPattern attempts to parse a tag pattern at the given position
// Returns the tag filter, new position, and whether a pattern was found
func tryParseTagPattern(s string, pos int) (TagFilter, int, bool) {
	if pos+8 <= len(s) && strings.ToLower(s[pos:pos+8]) == "not tag:" {
		tagName := extractTagName(s, pos+8)
		return TagFilter{Name: tagName, Excluded: true}, findTagEnd(s, pos+8), true
	}

	if pos+5 <= len(s) && strings.ToLower(s[pos:pos+5]) == "-tag:" {
		tagName := extractTagName(s, pos+5)
		return TagFilter{Name: tagName, Excluded: true}, findTagEnd(s, pos+5), true
	}

	if pos+4 <= len(s) && strings.ToLower(s[pos:pos+4]) == TagPrefix {
		tagName := extractTagName(s, pos+4)
		return TagFilter{Name: tagName, Excluded: false}, findTagEnd(s, pos+4), true
	}

	return TagFilter{}, pos, false
}

// extractTagName extracts and trims the tag name from the given position to the end
func extractTagName(s string, start int) string {
	end := findTagEnd(s, start)
	return strings.TrimSpace(s[start:end])
}

// addWordToResult adds the next word from the query to the result builder
// Returns the new position after the word
func addWordToResult(result *strings.Builder, s string, pos int) int {
	wordEnd := pos
	for wordEnd < len(s) && s[wordEnd] != ' ' {
		wordEnd++
	}
	if result.Len() > 0 {
		result.WriteByte(' ')
	}
	result.WriteString(s[pos:wordEnd])
	return wordEnd
}

// findTagEnd finds where a tag name ends by looking for the next tag pattern or end of string
func findTagEnd(s string, start int) int {
	end := start
	for end < len(s) {
		remaining := s[end:]

		if remaining != "" && remaining[0] == ' ' {
			afterSpace := strings.TrimLeft(remaining, " ")
			afterSpaceLower := strings.ToLower(afterSpace)

			if strings.HasPrefix(afterSpaceLower, TagPrefix) ||
				strings.HasPrefix(afterSpaceLower, "-tag:") ||
				strings.HasPrefix(afterSpaceLower, "not tag:") {
				return end
			}
		}

		end++
	}
	return end
}
