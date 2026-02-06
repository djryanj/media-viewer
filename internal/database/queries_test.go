package database

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// TestBuildBreadcrumb tests breadcrumb navigation construction from file paths.
func TestBuildBreadcrumb(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		path     string
		expected []PathPart
	}{
		{
			name: "empty path",
			path: "",
			expected: []PathPart{
				{Name: "Media", Path: ""},
			},
		},
		{
			name: "single level",
			path: "photos",
			expected: []PathPart{
				{Name: "Media", Path: ""},
				{Name: "photos", Path: "photos"},
			},
		},
		{
			name: "two levels",
			path: filepath.Join("photos", "2024"),
			expected: []PathPart{
				{Name: "Media", Path: ""},
				{Name: "photos", Path: "photos"},
				{Name: "2024", Path: filepath.Join("photos", "2024")},
			},
		},
		{
			name: "three levels",
			path: filepath.Join("photos", "2024", "vacation"),
			expected: []PathPart{
				{Name: "Media", Path: ""},
				{Name: "photos", Path: "photos"},
				{Name: "2024", Path: filepath.Join("photos", "2024")},
				{Name: "vacation", Path: filepath.Join("photos", "2024", "vacation")},
			},
		},
		{
			name: "deep nesting",
			path: filepath.Join("a", "b", "c", "d", "e"),
			expected: []PathPart{
				{Name: "Media", Path: ""},
				{Name: "a", Path: "a"},
				{Name: "b", Path: filepath.Join("a", "b")},
				{Name: "c", Path: filepath.Join("a", "b", "c")},
				{Name: "d", Path: filepath.Join("a", "b", "c", "d")},
				{Name: "e", Path: filepath.Join("a", "b", "c", "d", "e")},
			},
		},
		{
			name: "path with spaces",
			path: filepath.Join("my photos", "vacation 2024"),
			expected: []PathPart{
				{Name: "Media", Path: ""},
				{Name: "my photos", Path: "my photos"},
				{Name: "vacation 2024", Path: filepath.Join("my photos", "vacation 2024")},
			},
		},
		{
			name: "path with special characters",
			path: filepath.Join("photos", "2024-summer", "day_1"),
			expected: []PathPart{
				{Name: "Media", Path: ""},
				{Name: "photos", Path: "photos"},
				{Name: "2024-summer", Path: filepath.Join("photos", "2024-summer")},
				{Name: "day_1", Path: filepath.Join("photos", "2024-summer", "day_1")},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := buildBreadcrumb(tt.path)

			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("buildBreadcrumb(%q) = %+v, want %+v", tt.path, result, tt.expected)
			}

			// Verify breadcrumb always starts with Media
			if len(result) == 0 || result[0].Name != "Media" {
				t.Errorf("breadcrumb should always start with Media, got %+v", result)
			}

			// Verify paths are cumulative
			for i := 1; i < len(result); i++ {
				if result[i].Path == "" {
					t.Errorf("breadcrumb part %d has empty path", i)
				}
			}
		})
	}
}

// TestPrepareSearchTerm tests search term preparation for FTS5 trigram search.
func TestPrepareSearchTerm(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		query    string
		expected string
	}{
		{
			name:     "simple word",
			query:    "vacation",
			expected: `"vacation"`,
		},
		{
			name:     "multiple words",
			query:    "summer vacation",
			expected: `"summer vacation"`,
		},
		{
			name:     "query with leading spaces",
			query:    "  photo  ",
			expected: `"photo"`,
		},
		{
			name:     "query with double quotes",
			query:    `my "special" folder`,
			expected: `"my ""special"" folder"`,
		},
		{
			name:     "query with multiple quotes",
			query:    `"test" "quotes"`,
			expected: `"""test"" ""quotes"""`,
		},
		{
			name:     "empty string",
			query:    "",
			expected: `""`,
		},
		{
			name:     "whitespace only",
			query:    "   ",
			expected: `""`,
		},
		{
			name:     "special characters",
			query:    "2024-summer_photos",
			expected: `"2024-summer_photos"`,
		},
		{
			name:     "unicode characters",
			query:    "résumé café",
			expected: `"résumé café"`,
		},
		{
			name:     "numbers",
			query:    "12345",
			expected: `"12345"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := prepareSearchTerm(tt.query)

			if result != tt.expected {
				t.Errorf("prepareSearchTerm(%q) = %q, want %q", tt.query, result, tt.expected)
			}

			// Verify result always starts and ends with quote
			if len(result) < 2 || result[0] != '"' || result[len(result)-1] != '"' {
				t.Errorf("result should be wrapped in quotes, got %q", result)
			}
		})
	}
}

// TestHighlightMatch tests text highlighting with matching query.
func TestHighlightMatch(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		text     string
		query    string
		expected string
	}{
		{
			name:     "exact match",
			text:     "vacation",
			query:    "vacation",
			expected: "<mark>vacation</mark>",
		},
		{
			name:     "partial match at start",
			text:     "vacation_2024.jpg",
			query:    "vacation",
			expected: "<mark>vacation</mark>_2024.jpg",
		},
		{
			name:     "partial match in middle",
			text:     "summer_vacation_2024.jpg",
			query:    "vacation",
			expected: "summer_<mark>vacation</mark>_2024.jpg",
		},
		{
			name:     "partial match at end",
			text:     "summer_vacation",
			query:    "vacation",
			expected: "summer_<mark>vacation</mark>",
		},
		{
			name:     "case insensitive match",
			text:     "Summer Vacation",
			query:    "vacation",
			expected: "Summer <mark>Vacation</mark>",
		},
		{
			name:     "uppercase query",
			text:     "summer vacation",
			query:    "VACATION",
			expected: "summer <mark>vacation</mark>",
		},
		{
			name:     "no match",
			text:     "winter photos",
			query:    "summer",
			expected: "winter photos",
		},
		{
			name:     "empty text",
			text:     "",
			query:    "test",
			expected: "",
		},
		{
			name:     "empty query",
			text:     "some text",
			query:    "",
			expected: "some text",
		},
		{
			name:     "multiple occurrences (only first highlighted)",
			text:     "photo photo photo",
			query:    "photo",
			expected: "<mark>photo</mark> photo photo",
		},
		{
			name:     "special characters in text",
			text:     "my-vacation_2024",
			query:    "vacation",
			expected: "my-<mark>vacation</mark>_2024",
		},
		{
			name:     "unicode match",
			text:     "café résumé",
			query:    "café",
			expected: "<mark>café</mark> résumé",
		},
		{
			name:     "number match",
			text:     "photo_2024_01",
			query:    "2024",
			expected: "photo_<mark>2024</mark>_01",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := highlightMatch(tt.text, tt.query)

			if result != tt.expected {
				t.Errorf("highlightMatch(%q, %q) = %q, want %q", tt.text, tt.query, result, tt.expected)
			}
		})
	}
}

// TestNormalizeListOptions tests list options normalization.
func TestNormalizeListOptions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    ListOptions
		expected ListOptions
	}{
		{
			name: "all valid options",
			input: ListOptions{
				Path:       "photos",
				SortField:  SortByName,
				SortOrder:  SortAsc,
				FilterType: string(FileTypeImage),
				Page:       2,
				PageSize:   50,
			},
			expected: ListOptions{
				Path:       "photos",
				SortField:  SortByName,
				SortOrder:  SortAsc,
				FilterType: string(FileTypeImage),
				Page:       2,
				PageSize:   50,
			},
		},
		{
			name: "empty sort field not changed",
			input: ListOptions{
				Path:      "photos",
				SortField: "",
				SortOrder: SortAsc,
			},
			expected: ListOptions{
				Path:      "photos",
				SortField: "",
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  100,
			},
		},
		{
			name: "empty sort order not changed",
			input: ListOptions{
				Path:      "photos",
				SortField: SortByDate,
				SortOrder: "",
			},
			expected: ListOptions{
				Path:      "photos",
				SortField: SortByDate,
				SortOrder: "",
				Page:      1,
				PageSize:  100,
			},
		},
		{
			name: "zero page defaults to 1",
			input: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      0,
			},
			expected: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  100,
			},
		},
		{
			name: "negative page defaults to 1",
			input: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      -5,
			},
			expected: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  100,
			},
		},
		{
			name: "zero page size defaults to 100",
			input: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  0,
			},
			expected: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  100,
			},
		},
		{
			name: "negative page size defaults to 100",
			input: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  -10,
			},
			expected: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  100,
			},
		},
		{
			name: "all empty defaults",
			input: ListOptions{
				Path: "",
			},
			expected: ListOptions{
				Path:      "",
				SortField: "",
				SortOrder: "",
				Page:      1,
				PageSize:  100,
			},
		},
		{
			name: "custom page size preserved",
			input: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  25,
			},
			expected: ListOptions{
				Path:      "photos",
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  25,
			},
		},
		{
			name: "all sort fields preserved",
			input: ListOptions{
				Path:      "photos",
				SortField: SortBySize,
				SortOrder: SortDesc,
				Page:      3,
				PageSize:  200,
			},
			expected: ListOptions{
				Path:      "photos",
				SortField: SortBySize,
				SortOrder: SortDesc,
				Page:      3,
				PageSize:  200,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := normalizeListOptions(tt.input)

			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("normalizeListOptions(%+v) = %+v, want %+v", tt.input, result, tt.expected)
			}

			// Verify invariants
			if result.Page < 1 {
				t.Errorf("normalized page should be >= 1, got %d", result.Page)
			}
			if result.PageSize < 1 {
				t.Errorf("normalized page size should be >= 1, got %d", result.PageSize)
			}
		})
	}
}

// TestGetSortColumn tests sort field to SQL column mapping.
func TestGetSortColumn(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		field    SortField
		expected string
	}{
		{
			name:     "sort by name",
			field:    SortByName,
			expected: NameCollation,
		},
		{
			name:     "sort by date",
			field:    SortByDate,
			expected: "mod_time",
		},
		{
			name:     "sort by size",
			field:    SortBySize,
			expected: "size",
		},
		{
			name:     "sort by type",
			field:    SortByType,
			expected: "type",
		},
		{
			name:     "empty field defaults to name",
			field:    "",
			expected: NameCollation,
		},
		{
			name:     "invalid field defaults to name",
			field:    "invalid",
			expected: NameCollation,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := getSortColumn(tt.field)

			if result != tt.expected {
				t.Errorf("getSortColumn(%q) = %q, want %q", tt.field, result, tt.expected)
			}
		})
	}
}

// TestGetSortColumnConsistency verifies all SortField constants have mappings.
func TestGetSortColumnConsistency(t *testing.T) {
	t.Parallel()

	// Test all defined sort field constants
	sortFields := []SortField{
		SortByName,
		SortByDate,
		SortBySize,
		SortByType,
	}

	for _, field := range sortFields {
		result := getSortColumn(field)
		if result == "" {
			t.Errorf("getSortColumn(%q) returned empty string", field)
		}
	}
}

// TestNormalizeLimit tests the normalizeLimit function for search suggestions.
func TestNormalizeLimit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    int
		expected int
	}{
		{
			name:     "zero limit defaults to 10",
			input:    0,
			expected: 10,
		},
		{
			name:     "negative limit defaults to 10",
			input:    -5,
			expected: 10,
		},
		{
			name:     "valid limit preserved",
			input:    5,
			expected: 5,
		},
		{
			name:     "valid limit at lower bound",
			input:    1,
			expected: 1,
		},
		{
			name:     "valid limit at upper bound",
			input:    20,
			expected: 20,
		},
		{
			name:     "limit above max capped at 20",
			input:    25,
			expected: 20,
		},
		{
			name:     "very large limit capped at 20",
			input:    1000,
			expected: 20,
		},
		{
			name:     "default suggestion",
			input:    10,
			expected: 10,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := normalizeLimit(tt.input)

			if result != tt.expected {
				t.Errorf("normalizeLimit(%d) = %d, want %d", tt.input, result, tt.expected)
			}

			// Verify result is always within acceptable bounds
			if result < 1 || result > 20 {
				t.Errorf("normalizeLimit(%d) = %d, which is outside bounds [1, 20]", tt.input, result)
			}
		})
	}
}

// TestConstants tests the exported constants used in queries.
func TestConstants(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		constant string
		expected string
	}{
		{
			name:     "TagPrefix constant",
			constant: TagPrefix,
			expected: "tag:",
		},
		{
			name:     "FilterTypeClause constant",
			constant: FilterTypeClause,
			expected: " AND f.type = ?",
		},
		{
			name:     "NameCollation constant",
			constant: NameCollation,
			expected: "name COLLATE NOCASE",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if tt.constant != tt.expected {
				t.Errorf("Constant value = %q, want %q", tt.constant, tt.expected)
			}
		})
	}
}

// TestTagPrefixUsage tests that TagPrefix constant is correctly formatted.
func TestTagPrefixUsage(t *testing.T) {
	t.Parallel()

	// Verify TagPrefix has correct format
	if TagPrefix != "tag:" {
		t.Errorf("TagPrefix = %q, want %q", TagPrefix, "tag:")
	}

	// Verify it can be used in string operations
	testQuery := TagPrefix + "vacation"
	if testQuery != "tag:vacation" {
		t.Errorf("TagPrefix concatenation failed: got %q, want %q", testQuery, "tag:vacation")
	}

	// Verify prefix check works
	if !strings.HasPrefix("tag:beach", TagPrefix) {
		t.Error("TagPrefix should match 'tag:beach'")
	}

	if strings.HasPrefix("vacation", TagPrefix) {
		t.Error("TagPrefix should not match 'vacation'")
	}
}

// TestListOptionsValidation tests that list options are properly validated.
func TestListOptionsValidation(t *testing.T) {
	t.Parallel()

	// Test edge cases for pagination
	tests := []struct {
		name     string
		page     int
		pageSize int
		wantPage int
		wantSize int
	}{
		{
			name:     "large page number",
			page:     999999,
			pageSize: 50,
			wantPage: 999999,
			wantSize: 50,
		},
		{
			name:     "large page size",
			page:     1,
			pageSize: 10000,
			wantPage: 1,
			wantSize: 10000, // Now allowed for bulk operations
		},
		{
			name:     "very large page size exceeds new limit",
			page:     1,
			pageSize: 150000,
			wantPage: 1,
			wantSize: 100000, // Capped at new maximum
		},
		{
			name:     "page 1 with default size",
			page:     1,
			pageSize: 0,
			wantPage: 1,
			wantSize: 100,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			opts := normalizeListOptions(ListOptions{
				Page:     tt.page,
				PageSize: tt.pageSize,
			})

			if opts.Page != tt.wantPage {
				t.Errorf("page = %d, want %d", opts.Page, tt.wantPage)
			}
			if opts.PageSize != tt.wantSize {
				t.Errorf("pageSize = %d, want %d", opts.PageSize, tt.wantSize)
			}
		})
	}
}

// TestParseTagFilters tests the parseTagFilters function with various inputs.
func TestParseTagFilters(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		query         string
		wantRemaining string
		wantFilters   []TagFilter
	}{
		{
			name:          "no tags",
			query:         "sunset beach",
			wantRemaining: "sunset beach",
			wantFilters:   nil,
		},
		{
			name:          "single tag",
			query:         "tag:vacation",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "vacation", Excluded: false},
			},
		},
		{
			name:          "single excluded tag",
			query:         "-tag:vacation",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "vacation", Excluded: true},
			},
		},
		{
			name:          "single NOT tag",
			query:         "NOT tag:vacation",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "vacation", Excluded: true},
			},
		},
		{
			name:          "tag with spaces",
			query:         "tag:my vacation photos",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "my vacation photos", Excluded: false},
			},
		},
		{
			name:          "excluded tag with spaces",
			query:         "-tag:my vacation photos",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "my vacation photos", Excluded: true},
			},
		},
		{
			name:          "NOT tag with spaces",
			query:         "NOT tag:my vacation photos",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "my vacation photos", Excluded: true},
			},
		},
		{
			name:          "tag with spaces and other search terms",
			query:         "sunset tag:beach vacation -tag:photo",
			wantRemaining: "sunset",
			wantFilters: []TagFilter{
				{Name: "beach vacation", Excluded: false},
				{Name: "photo", Excluded: true},
			},
		},
		{
			name:          "multiple tags without spaces",
			query:         "tag:vacation tag:beach",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "vacation", Excluded: false},
				{Name: "beach", Excluded: false},
			},
		},
		{
			name:          "multiple tags with spaces",
			query:         "tag:my vacation tag:summer beach",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "my vacation", Excluded: false},
				{Name: "summer beach", Excluded: false},
			},
		},
		{
			name:          "mixed included and excluded tags",
			query:         "tag:vacation -tag:work",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "vacation", Excluded: false},
				{Name: "work", Excluded: true},
			},
		},
		{
			name:          "mixed tags with search terms",
			query:         "sunset tag:beach photo -tag:private",
			wantRemaining: "sunset",
			wantFilters: []TagFilter{
				{Name: "beach photo", Excluded: false},
				{Name: "private", Excluded: true},
			},
		},
		{
			name:          "tag at end with spaces",
			query:         "sunset photo tag:vacation 2024",
			wantRemaining: "sunset photo",
			wantFilters: []TagFilter{
				{Name: "vacation 2024", Excluded: false},
			},
		},
		{
			name:          "tag at beginning with spaces",
			query:         "tag:summer vacation photo",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "summer vacation photo", Excluded: false},
			},
		},
		{
			name:          "multiple excluded tags with spaces",
			query:         "-tag:work stuff -tag:private files",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "work stuff", Excluded: true},
				{Name: "private files", Excluded: true},
			},
		},
		{
			name:          "complex query with mixed patterns",
			query:         "beach tag:summer vacation -tag:work files photo tag:2024 trip",
			wantRemaining: "beach",
			wantFilters: []TagFilter{
				{Name: "summer vacation", Excluded: false},
				{Name: "work files photo", Excluded: true},
				{Name: "2024 trip", Excluded: false},
			},
		},
		{
			name:          "case insensitive tag prefix",
			query:         "TAG:vacation -TAG:work NOT TAG:private",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "vacation", Excluded: false},
				{Name: "work", Excluded: true},
				{Name: "private", Excluded: true},
			},
		},
		{
			name:          "empty tag name",
			query:         "tag: -tag: NOT tag:",
			wantRemaining: "",
			wantFilters:   nil, // Empty tag names are ignored
		},
		{
			name:          "whitespace heavy",
			query:         "  tag:vacation    photo   -tag:work  ",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "vacation    photo", Excluded: false},
				{Name: "work", Excluded: true},
			},
		},
		{
			name:          "tag with trailing whitespace before next pattern",
			query:         "tag:vacation   tag:beach",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "vacation", Excluded: false},
				{Name: "beach", Excluded: false},
			},
		},
		{
			name:          "tag containing special characters",
			query:         "tag:2024-summer tag:day_1",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "2024-summer", Excluded: false},
				{Name: "day_1", Excluded: false},
			},
		},
		{
			name:          "consecutive spaces in tag name",
			query:         "tag:my  vacation  photos",
			wantRemaining: "",
			wantFilters: []TagFilter{
				{Name: "my  vacation  photos", Excluded: false},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			remaining, filters := parseTagFilters(tt.query)

			if remaining != tt.wantRemaining {
				t.Errorf("remaining = %q, want %q", remaining, tt.wantRemaining)
			}

			if len(filters) != len(tt.wantFilters) {
				t.Errorf("got %d filters, want %d", len(filters), len(tt.wantFilters))
				t.Logf("got: %+v", filters)
				t.Logf("want: %+v", tt.wantFilters)
				return
			}

			for i := range filters {
				if filters[i].Name != tt.wantFilters[i].Name {
					t.Errorf("filter[%d].Name = %q, want %q", i, filters[i].Name, tt.wantFilters[i].Name)
				}
				if filters[i].Excluded != tt.wantFilters[i].Excluded {
					t.Errorf("filter[%d].Excluded = %v, want %v", i, filters[i].Excluded, tt.wantFilters[i].Excluded)
				}
			}
		})
	}
}

// TestFindTagEnd tests the findTagEnd helper function.
func TestFindTagEnd(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		start   int
		wantEnd int
	}{
		{
			name:    "end of string",
			input:   "vacation",
			start:   0,
			wantEnd: 8,
		},
		{
			name:    "until next tag pattern",
			input:   "vacation tag:beach",
			start:   0,
			wantEnd: 8, // Stops at the space before "tag:"
		},
		{
			name:    "until next excluded tag pattern",
			input:   "vacation -tag:work",
			start:   0,
			wantEnd: 8, // Stops at the space before "-tag:"
		},
		{
			name:    "until next NOT tag pattern",
			input:   "vacation NOT tag:private",
			start:   0,
			wantEnd: 8, // Stops at the space before "NOT tag:"
		},
		{
			name:    "tag with multiple words",
			input:   "summer vacation photo tag:2024",
			start:   0,
			wantEnd: 21, // Stops at the space before "tag:2024"
		},
		{
			name:    "start mid-string",
			input:   "tag:summer vacation -tag:work",
			start:   4,  // Start after "tag:"
			wantEnd: 19, // Stops at the space before "-tag:"
		},
		{
			name:    "no following tag pattern",
			input:   "summer vacation photo",
			start:   0,
			wantEnd: 21, // Goes to end of string
		},
		{
			name:    "consecutive spaces",
			input:   "vacation    tag:beach",
			start:   0,
			wantEnd: 8, // Stops at first space before tag pattern
		},
		{
			name:    "case insensitive tag detection",
			input:   "vacation TAG:beach",
			start:   0,
			wantEnd: 8, // Detects "TAG:" as tag pattern
		},
		{
			name:    "NOT with different case",
			input:   "vacation not tag:beach",
			start:   0,
			wantEnd: 8, // Detects "not tag:" as tag pattern
		},
		{
			name:    "tag-like text in middle",
			input:   "tagging photos",
			start:   0,
			wantEnd: 14, // "tagging" is not a tag pattern
		},
		{
			name:    "hyphen not followed by tag:",
			input:   "2024-summer vacation",
			start:   0,
			wantEnd: 20, // Hyphen is part of the tag name
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			end := findTagEnd(tt.input, tt.start)

			if end != tt.wantEnd {
				t.Errorf("findTagEnd(%q, %d) = %d, want %d", tt.input, tt.start, end, tt.wantEnd)
				if end < len(tt.input) {
					t.Logf("stopped at: %q", tt.input[tt.start:end])
				}
			}
		})
	}
}

// TestSkipWhitespace tests the skipWhitespace helper function.
func TestSkipWhitespace(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		pos     int
		wantPos int
	}{
		{
			name:    "no whitespace",
			input:   "hello",
			pos:     0,
			wantPos: 0,
		},
		{
			name:    "single space",
			input:   " hello",
			pos:     0,
			wantPos: 1,
		},
		{
			name:    "multiple spaces",
			input:   "    hello",
			pos:     0,
			wantPos: 4,
		},
		{
			name:    "mid-string spaces",
			input:   "hello    world",
			pos:     5,
			wantPos: 9,
		},
		{
			name:    "trailing spaces",
			input:   "hello     ",
			pos:     5,
			wantPos: 10,
		},
		{
			name:    "already past whitespace",
			input:   "  hello",
			pos:     2,
			wantPos: 2,
		},
		{
			name:    "at end of string",
			input:   "hello",
			pos:     5,
			wantPos: 5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			pos := skipWhitespace(tt.input, tt.pos)

			if pos != tt.wantPos {
				t.Errorf("skipWhitespace(%q, %d) = %d, want %d", tt.input, tt.pos, pos, tt.wantPos)
			}
		})
	}
}

// TestTryParseTagPattern tests the tryParseTagPattern helper function.
func TestTryParseTagPattern(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		input      string
		pos        int
		wantFilter TagFilter
		wantNewPos int
		wantFound  bool
	}{
		{
			name:       "tag pattern",
			input:      "tag:vacation",
			pos:        0,
			wantFilter: TagFilter{Name: "vacation", Excluded: false},
			wantNewPos: 12,
			wantFound:  true,
		},
		{
			name:       "excluded tag pattern",
			input:      "-tag:work",
			pos:        0,
			wantFilter: TagFilter{Name: "work", Excluded: true},
			wantNewPos: 9,
			wantFound:  true,
		},
		{
			name:       "NOT tag pattern",
			input:      "NOT tag:private",
			pos:        0,
			wantFilter: TagFilter{Name: "private", Excluded: true},
			wantNewPos: 15,
			wantFound:  true,
		},
		{
			name:       "tag with spaces",
			input:      "tag:summer vacation",
			pos:        0,
			wantFilter: TagFilter{Name: "summer vacation", Excluded: false},
			wantNewPos: 19,
			wantFound:  true,
		},
		{
			name:       "tag with trailing pattern",
			input:      "tag:beach tag:2024",
			pos:        0,
			wantFilter: TagFilter{Name: "beach", Excluded: false},
			wantNewPos: 9,
			wantFound:  true,
		},
		{
			name:       "not a tag pattern",
			input:      "hello world",
			pos:        0,
			wantFilter: TagFilter{},
			wantNewPos: 0,
			wantFound:  false,
		},
		{
			name:       "tag-like text",
			input:      "tagging photos",
			pos:        0,
			wantFilter: TagFilter{},
			wantNewPos: 0,
			wantFound:  false,
		},
		{
			name:       "case insensitive TAG",
			input:      "TAG:vacation",
			pos:        0,
			wantFilter: TagFilter{Name: "vacation", Excluded: false},
			wantNewPos: 12,
			wantFound:  true,
		},
		{
			name:       "case insensitive -TAG",
			input:      "-TAG:work",
			pos:        0,
			wantFilter: TagFilter{Name: "work", Excluded: true},
			wantNewPos: 9,
			wantFound:  true,
		},
		{
			name:       "case insensitive not tag",
			input:      "not tag:private",
			pos:        0,
			wantFilter: TagFilter{Name: "private", Excluded: true},
			wantNewPos: 15,
			wantFound:  true,
		},
		{
			name:       "empty tag name",
			input:      "tag:",
			pos:        0,
			wantFilter: TagFilter{Name: "", Excluded: false},
			wantNewPos: 4,
			wantFound:  true,
		},
		{
			name:       "mid-string tag pattern",
			input:      "hello tag:world",
			pos:        6,
			wantFilter: TagFilter{Name: "world", Excluded: false},
			wantNewPos: 15,
			wantFound:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			filter, newPos, found := tryParseTagPattern(tt.input, tt.pos)

			if found != tt.wantFound {
				t.Errorf("found = %v, want %v", found, tt.wantFound)
			}
			if newPos != tt.wantNewPos {
				t.Errorf("newPos = %d, want %d", newPos, tt.wantNewPos)
			}
			if filter.Name != tt.wantFilter.Name {
				t.Errorf("filter.Name = %q, want %q", filter.Name, tt.wantFilter.Name)
			}
			if filter.Excluded != tt.wantFilter.Excluded {
				t.Errorf("filter.Excluded = %v, want %v", filter.Excluded, tt.wantFilter.Excluded)
			}
		})
	}
}

// TestExtractTagName tests the extractTagName helper function.
func TestExtractTagName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		start   int
		wantTag string
	}{
		{
			name:    "simple tag",
			input:   "vacation",
			start:   0,
			wantTag: "vacation",
		},
		{
			name:    "tag with trailing space",
			input:   "vacation ",
			start:   0,
			wantTag: "vacation",
		},
		{
			name:    "tag with leading space",
			input:   " vacation",
			start:   0,
			wantTag: "vacation",
		},
		{
			name:    "tag with spaces in name",
			input:   "summer vacation",
			start:   0,
			wantTag: "summer vacation",
		},
		{
			name:    "tag until next pattern",
			input:   "beach tag:2024",
			start:   0,
			wantTag: "beach",
		},
		{
			name:    "tag with multiple words",
			input:   "summer vacation photos",
			start:   0,
			wantTag: "summer vacation photos",
		},
		{
			name:    "mid-string extraction",
			input:   "tag:vacation photos",
			start:   4,
			wantTag: "vacation photos",
		},
		{
			name:    "empty tag",
			input:   "",
			start:   0,
			wantTag: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			tag := extractTagName(tt.input, tt.start)

			if tag != tt.wantTag {
				t.Errorf("extractTagName(%q, %d) = %q, want %q", tt.input, tt.start, tag, tt.wantTag)
			}
		})
	}
}

// TestAddWordToResult tests the addWordToResult helper function.
func TestAddWordToResult(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		initial    string
		input      string
		pos        int
		wantResult string
		wantNewPos int
	}{
		{
			name:       "first word",
			initial:    "",
			input:      "hello world",
			pos:        0,
			wantResult: "hello",
			wantNewPos: 5,
		},
		{
			name:       "second word",
			initial:    "hello",
			input:      "world",
			pos:        0,
			wantResult: "hello world",
			wantNewPos: 5,
		},
		{
			name:       "word until space",
			initial:    "",
			input:      "beach tag:vacation",
			pos:        0,
			wantResult: "beach",
			wantNewPos: 5,
		},
		{
			name:       "word from middle",
			initial:    "sunset",
			input:      "beach photo",
			pos:        6,
			wantResult: "sunset photo",
			wantNewPos: 11,
		},
		{
			name:       "single character word",
			initial:    "",
			input:      "a test",
			pos:        0,
			wantResult: "a",
			wantNewPos: 1,
		},
		{
			name:       "word at end",
			initial:    "hello",
			input:      "world",
			pos:        0,
			wantResult: "hello world",
			wantNewPos: 5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var result strings.Builder
			result.WriteString(tt.initial)

			newPos := addWordToResult(&result, tt.input, tt.pos)

			if result.String() != tt.wantResult {
				t.Errorf("result = %q, want %q", result.String(), tt.wantResult)
			}
			if newPos != tt.wantNewPos {
				t.Errorf("newPos = %d, want %d", newPos, tt.wantNewPos)
			}
		})
	}
}
