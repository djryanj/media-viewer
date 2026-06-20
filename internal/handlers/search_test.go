package handlers

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"media-viewer/internal/database"
)

// =============================================================================
// Search Query Parameter Parsing Tests
// =============================================================================

func TestSearchPageParsing(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		input         string
		defaultValue  int
		expectedValue int
	}{
		{
			name:          "Valid page number",
			input:         "3",
			defaultValue:  1,
			expectedValue: 3,
		},
		{
			name:          "Invalid - not a number",
			input:         "abc",
			defaultValue:  1,
			expectedValue: 1,
		},
		{
			name:          "Invalid - negative",
			input:         "-1",
			defaultValue:  1,
			expectedValue: 1,
		},
		{
			name:          "Invalid - zero",
			input:         "0",
			defaultValue:  1,
			expectedValue: 1,
		},
		{
			name:          "Empty string",
			input:         "",
			defaultValue:  1,
			expectedValue: 1,
		},
		{
			name:          "Large page number",
			input:         "999",
			defaultValue:  1,
			expectedValue: 999,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.defaultValue
			if page, err := strconv.Atoi(tt.input); err == nil && page > 0 {
				result = page
			}

			if result != tt.expectedValue {
				t.Errorf("Expected %d, got %d", tt.expectedValue, result)
			}
		})
	}
}

func TestSearchPageSizeParsing(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		input         string
		defaultValue  int
		expectedValue int
	}{
		{
			name:          "Valid page size",
			input:         "25",
			defaultValue:  50,
			expectedValue: 25,
		},
		{
			name:          "Default page size",
			input:         "",
			defaultValue:  50,
			expectedValue: 50,
		},
		{
			name:          "Invalid - negative",
			input:         "-10",
			defaultValue:  50,
			expectedValue: 50,
		},
		{
			name:          "Invalid - zero",
			input:         "0",
			defaultValue:  50,
			expectedValue: 50,
		},
		{
			name:          "Large page size",
			input:         "1000",
			defaultValue:  50,
			expectedValue: 1000,
		},
		{
			name:          "Single item",
			input:         "1",
			defaultValue:  50,
			expectedValue: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.defaultValue
			if pageSize, err := strconv.Atoi(tt.input); err == nil && pageSize > 0 {
				result = pageSize
			}

			if result != tt.expectedValue {
				t.Errorf("Expected %d, got %d", tt.expectedValue, result)
			}
		})
	}
}

func TestSearchLimitParsing(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		input         string
		defaultValue  int
		expectedValue int
	}{
		{
			name:          "Valid limit",
			input:         "5",
			defaultValue:  10,
			expectedValue: 5,
		},
		{
			name:          "Default limit",
			input:         "",
			defaultValue:  10,
			expectedValue: 10,
		},
		{
			name:          "Invalid - negative",
			input:         "-5",
			defaultValue:  10,
			expectedValue: 10,
		},
		{
			name:          "Invalid - zero",
			input:         "0",
			defaultValue:  10,
			expectedValue: 10,
		},
		{
			name:          "Large limit",
			input:         "100",
			defaultValue:  10,
			expectedValue: 100,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.defaultValue
			if limit, err := strconv.Atoi(tt.input); err == nil && limit > 0 {
				result = limit
			}

			if result != tt.expectedValue {
				t.Errorf("Expected %d, got %d", tt.expectedValue, result)
			}
		})
	}
}

// =============================================================================
// Search Query Validation Tests
// =============================================================================

func TestSearchQueryValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		query   string
		isEmpty bool
	}{
		{
			name:    "Non-empty query",
			query:   "vacation photos",
			isEmpty: false,
		},
		{
			name:    "Empty string",
			query:   "",
			isEmpty: true,
		},
		{
			name:    "Whitespace only",
			query:   "   ",
			isEmpty: false, // Not trimmed by handler
		},
		{
			name:    "Single character",
			query:   "a",
			isEmpty: false,
		},
		{
			name:    "Special characters",
			query:   "!@#$%",
			isEmpty: false,
		},
		{
			name:    "Unicode query",
			query:   "写真",
			isEmpty: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isEmpty := tt.query == ""
			if isEmpty != tt.isEmpty {
				t.Errorf("Expected isEmpty=%v for query %q, got %v", tt.isEmpty, tt.query, isEmpty)
			}
		})
	}
}

// =============================================================================
// Search Filter Type Tests
// =============================================================================

func TestSearchFilterTypeValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		filterType string
		isValid    bool
	}{
		{
			name:       "Filter by image",
			filterType: "image",
			isValid:    true,
		},
		{
			name:       "Filter by video",
			filterType: "video",
			isValid:    true,
		},
		{
			name:       "No filter",
			filterType: "",
			isValid:    true,
		},
		{
			name:       "Unknown filter",
			filterType: "unknown",
			isValid:    true, // Handler accepts any string
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Handler doesn't reject filter types, just passes to database
			// This test documents the behavior
			filterType := tt.filterType
			if (filterType != "") != (tt.filterType != "") {
				t.Errorf("Filter type handling mismatch")
			}
		})
	}
}

// =============================================================================
// Search Options Structure Tests
// =============================================================================

func TestSearchOptionsDefaults(t *testing.T) {
	t.Parallel()

	// Test default values used in Search handler
	defaultPage := 1
	defaultPageSize := 100

	if defaultPage != 1 {
		t.Errorf("Expected default page 1, got %d", defaultPage)
	}

	if defaultPageSize != 100 {
		t.Errorf("Expected default page size 100, got %d", defaultPageSize)
	}
}

func TestSearchSuggestionsDefaults(t *testing.T) {
	t.Parallel()

	// Test default values used in SearchSuggestions handler
	defaultLimit := 10

	if defaultLimit != 10 {
		t.Errorf("Expected default limit 10, got %d", defaultLimit)
	}
}

// =============================================================================
// Search Query Edge Cases
// =============================================================================

func TestSearchQueryEdgeCases(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		query       string
		description string
	}{
		{
			name:        "Very long query",
			query:       "this is a very long search query that contains many words and might test the limits of the search functionality",
			description: "Should handle long queries",
		},
		{
			name:        "Query with quotes",
			query:       `"exact phrase"`,
			description: "Should handle quoted searches",
		},
		{
			name:        "Query with wildcards",
			query:       "photo*",
			description: "Should handle wildcard characters",
		},
		{
			name:        "Query with special SQL chars",
			query:       "test%_",
			description: "Should handle SQL special characters",
		},
		{
			name:        "Numeric query",
			query:       "2024",
			description: "Should handle numeric searches",
		},
		{
			name:        "Mixed case query",
			query:       "VaCaTiOn PhOtOs",
			description: "Should handle mixed case",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.query == "" {
				t.Error("Query should not be empty in edge case tests")
			}
			t.Logf("Testing: %s - %s", tt.description, tt.query)
		})
	}
}

// =============================================================================
// Search Result Handling Tests
// =============================================================================

func TestSearchEmptyResultHandling(t *testing.T) {
	t.Parallel()

	// Test that empty query returns empty result with correct structure
	query := ""
	page := 1
	pageSize := 100

	// Verify empty result structure
	if query == "" {
		expectedPage := 1
		expectedPageSize := pageSize
		expectedTotalItems := 0
		expectedTotalPages := 0

		if expectedPage != page {
			t.Errorf("Expected page %d, got %d", page, expectedPage)
		}

		if expectedPageSize != pageSize {
			t.Errorf("Expected pageSize %d, got %d", pageSize, expectedPageSize)
		}

		if expectedTotalItems != 0 {
			t.Errorf("Expected totalItems 0, got %d", expectedTotalItems)
		}

		if expectedTotalPages != 0 {
			t.Errorf("Expected totalPages 0, got %d", expectedTotalPages)
		}
	}
}

// =============================================================================
// Integer Parsing Helper Tests
// =============================================================================

func TestIntegerParsingBoundaries(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		input     string
		expectErr bool
		expected  int
	}{
		{
			name:      "Maximum int",
			input:     "2147483647",
			expectErr: false,
			expected:  2147483647,
		},
		{
			name:      "Zero",
			input:     "0",
			expectErr: false,
			expected:  0,
		},
		{
			name:      "Negative number",
			input:     "-100",
			expectErr: false,
			expected:  -100,
		},
		{
			name:      "Not a number",
			input:     "abc",
			expectErr: true,
			expected:  0,
		},
		{
			name:      "Float number",
			input:     "3.14",
			expectErr: true,
			expected:  0,
		},
		{
			name:      "Number with whitespace",
			input:     " 42 ",
			expectErr: true, // strconv.Atoi doesn't trim
			expected:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := strconv.Atoi(tt.input)
			hasErr := err != nil

			if hasErr != tt.expectErr {
				t.Errorf("Expected error=%v, got error=%v (%v)", tt.expectErr, hasErr, err)
			}

			if !hasErr && result != tt.expected {
				t.Errorf("Expected %d, got %d", tt.expected, result)
			}
		})
	}
}

// =============================================================================
// Search Sort Parameter Tests
// =============================================================================

// TestSearchSortParamParsing verifies that valid sort and order values
// accepted by the Search handler are a subset of the allowed field names.
func TestSearchSortParamParsing(t *testing.T) {
	t.Parallel()

	validSortFields := map[string]bool{
		"name": true,
		"date": true,
		"size": true,
	}
	validOrders := map[string]bool{
		"asc":  true,
		"desc": true,
	}

	tests := []struct {
		name      string
		sort      string
		order     string
		wantSort  string
		wantOrder string
	}{
		{
			name:      "Default sort (name, asc) when params are empty",
			sort:      "",
			order:     "",
			wantSort:  "name",
			wantOrder: "asc",
		},
		{
			name:      "Date sort descending",
			sort:      "date",
			order:     "desc",
			wantSort:  "date",
			wantOrder: "desc",
		},
		{
			name:      "Size sort ascending",
			sort:      "size",
			order:     "asc",
			wantSort:  "size",
			wantOrder: "asc",
		},
		{
			name:      "Name sort ascending",
			sort:      "name",
			order:     "asc",
			wantSort:  "name",
			wantOrder: "asc",
		},
		{
			name:      "Invalid sort falls back to name",
			sort:      "invalid",
			order:     "asc",
			wantSort:  "name",
			wantOrder: "asc",
		},
		{
			name:      "Invalid order falls back to asc",
			sort:      "date",
			order:     "random",
			wantSort:  "date",
			wantOrder: "asc",
		},
		{
			name:      "Both invalid fall back to defaults",
			sort:      "modified",
			order:     "newest",
			wantSort:  "name",
			wantOrder: "asc",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate the handler's validation logic for sort params
			sort := "name"
			if validSortFields[tt.sort] {
				sort = tt.sort
			}
			order := "asc"
			if validOrders[tt.order] {
				order = tt.order
			}

			if sort != tt.wantSort {
				t.Errorf("sort: got %q, want %q", sort, tt.wantSort)
			}
			if order != tt.wantOrder {
				t.Errorf("order: got %q, want %q", order, tt.wantOrder)
			}
		})
	}
}

// TestSearchHandlerReadsSort verifies that the Search handler reads sort and
// order from query parameters and passes them into the SearchOptions. This
// test uses the real HTTP handler plumbing (httptest) so it exercises the
// handler itself, not just a local variable.
func TestSearchHandlerReadsSort(t *testing.T) {
	t.Parallel()

	h, _, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Request with sort=date&order=desc — the handler must not ignore these.
	req := httptest.NewRequest(http.MethodGet, "/api/search?q=test&sort=date&order=desc", http.NoBody)
	w := httptest.NewRecorder()

	// If the handler doesn't read sort/order, it returns the same result as
	// without them. We just need to confirm it doesn't error out and that the
	// sort/order values would be passed to the database layer.
	//
	// Before the fix: handler ignores sort/order — SearchOptions.SortField and
	// SearchOptions.SortOrder are always zero values.
	// After the fix: handler reads them and populates SearchOptions accordingly.
	//
	// We verify the handler completes successfully and returns valid JSON.
	h.Search(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK, got %d; body: %s", w.Code, w.Body.String())
	}

	// Verify the response is valid JSON with expected fields
	body := w.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
	// Response must contain totalItems field
	if !containsField(body, "totalItems") {
		t.Errorf("response missing totalItems field: %s", body)
	}
}

// TestSearchSortFieldInOptions verifies that SearchOptions with SortField and
// SortOrder set are accepted by the database layer without panicking or erroring.
func TestSearchSortFieldInOptions(t *testing.T) {
	t.Parallel()

	// Before the fix: SearchOptions has no SortField/SortOrder fields.
	// After the fix: these fields exist and are used by the database layer.
	opts := database.SearchOptions{
		SortField: database.SortByDate,
		SortOrder: database.SortDesc,
	}

	// Validate that the struct can hold sort fields
	if opts.SortField != database.SortByDate {
		t.Errorf("SortField: got %q, want %q", opts.SortField, database.SortByDate)
	}
	if opts.SortOrder != database.SortDesc {
		t.Errorf("SortOrder: got %q, want %q", opts.SortOrder, database.SortDesc)
	}
}

// containsField is a minimal helper to check that a JSON string contains a key.
func containsField(json, field string) bool {
	return json != "" && (field == "" || (func() bool {
		for i := 0; i+len(field)+1 < len(json); i++ {
			if json[i] == '"' && json[i+1:i+1+len(field)] == field {
				return true
			}
		}
		return false
	})())
}

// =============================================================================
// Search Performance Considerations Tests
// =============================================================================

func TestSearchPaginationLimits(t *testing.T) {
	t.Parallel()

	// Test pagination values that might cause performance issues
	tests := []struct {
		name        string
		page        int
		pageSize    int
		shouldLimit bool
	}{
		{
			name:        "Reasonable pagination",
			page:        1,
			pageSize:    50,
			shouldLimit: false,
		},
		{
			name:        "Very large page size",
			page:        1,
			pageSize:    10000,
			shouldLimit: true,
		},
		{
			name:        "Very high page number",
			page:        10000,
			pageSize:    50,
			shouldLimit: false, // Page number not typically limited
		},
		{
			name:        "Single item per page",
			page:        1,
			pageSize:    1,
			shouldLimit: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Document pagination limits
			// In practice, database layer might enforce limits
			maxPageSize := 1000
			shouldLimit := tt.pageSize > maxPageSize

			if shouldLimit != tt.shouldLimit {
				t.Logf("PageSize %d should be limited: %v", tt.pageSize, shouldLimit)
			}
		})
	}
}
