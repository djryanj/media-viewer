package database

import (
	"path/filepath"
	"reflect"
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
			wantSize: 500,
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
