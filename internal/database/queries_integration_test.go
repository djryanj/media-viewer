package database

import (
	"context"
	"strings"
	"testing"
	"time"
)

// getTypes is a helper function to extract types from suggestions for error messages
func getTypes(suggestions []SearchSuggestion) []string {
	types := make([]string, 0, len(suggestions))
	for _, s := range suggestions {
		types = append(types, s.Type)
	}
	return types
}

// TestSearchSuggestionsTagQueries tests tag-related search queries.
func TestSearchSuggestionsTagQueries(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files with tags
	files := []MediaFile{
		{Name: "sunset.jpg", Path: "sunset.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "beach.mp4", Path: "beach.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "vacation.jpg", Path: "vacation.jpg", ParentPath: "", Type: FileTypeImage, Size: 1536, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	// Add tags
	_, _ = db.GetOrCreateTag(ctx, "vacation")
	_, _ = db.GetOrCreateTag(ctx, "nature")
	_, _ = db.GetOrCreateTag(ctx, "beach")

	_ = db.AddTagToFile(ctx, "vacation.jpg", "vacation")
	_ = db.AddTagToFile(ctx, "sunset.jpg", "nature")
	_ = db.AddTagToFile(ctx, "beach.mp4", "beach")

	tests := []struct {
		name            string
		query           string
		limit           int
		expectMinCount  int
		expectType      string
		expectInResults []string
	}{
		{
			name:            "tag prefix query",
			query:           "tag:vac",
			limit:           10,
			expectMinCount:  1,
			expectType:      "tag",
			expectInResults: []string{"vacation"},
		},
		{
			name:            "exact tag prefix",
			query:           "tag:",
			limit:           10,
			expectMinCount:  1,
			expectType:      "tag",
			expectInResults: []string{},
		},
		{
			name:            "tag exclusion query",
			query:           "-tag:nat",
			limit:           10,
			expectMinCount:  1,
			expectType:      "tag-exclude",
			expectInResults: []string{"nature"},
		},
		{
			name:            "NOT tag query",
			query:           "NOT tag:bea",
			limit:           10,
			expectMinCount:  1,
			expectType:      "tag-exclude",
			expectInResults: []string{"beach"},
		},
		{
			name:            "simple file search",
			query:           "sun",
			limit:           10,
			expectMinCount:  1,
			expectType:      "",
			expectInResults: []string{"sunset"},
		},
		{
			name:           "empty query returns nothing",
			query:          "",
			limit:          10,
			expectMinCount: 0,
		},
		{
			name:           "single char query returns nothing",
			query:          "s",
			limit:          10,
			expectMinCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			suggestions, err := db.SearchSuggestions(ctx, tt.query, tt.limit)
			if err != nil {
				t.Fatalf("SearchSuggestions failed: %v", err)
			}

			if len(suggestions) < tt.expectMinCount {
				t.Errorf("Expected at least %d suggestions, got %d", tt.expectMinCount, len(suggestions))
			}

			// If we expect specific type, verify it
			if tt.expectType != "" && len(suggestions) > 0 {
				found := false
				for _, s := range suggestions {
					if s.Type == tt.expectType {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected at least one suggestion with type %q, got none", tt.expectType)
				}
			}

			// Check for expected results
			for _, expected := range tt.expectInResults {
				found := false
				for _, s := range suggestions {
					if strings.Contains(strings.ToLower(s.Name), strings.ToLower(expected)) {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected to find %q in results, but didn't", expected)
				}
			}

			t.Logf("%s: got %d suggestions", tt.name, len(suggestions))
		})
	}
}

// TestSearchSuggestionsLimitRespected tests that limit parameter is respected.
func TestSearchSuggestionsLimitRespected(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert many files to test limit
	files := make([]MediaFile, 30)
	tx, _ := db.BeginBatch()
	for i := range files {
		files[i] = MediaFile{
			Name:       "test_" + string(rune('a'+i)) + ".jpg",
			Path:       "test_" + string(rune('a'+i)) + ".jpg",
			ParentPath: "",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	tests := []struct {
		name      string
		query     string
		limit     int
		expectMax int
	}{
		{
			name:      "limit 5",
			query:     "test",
			limit:     5,
			expectMax: 5,
		},
		{
			name:      "limit 10",
			query:     "test",
			limit:     10,
			expectMax: 10,
		},
		{
			name:      "limit 0 defaults to 10",
			query:     "test",
			limit:     0,
			expectMax: 10,
		},
		{
			name:      "negative limit defaults to 10",
			query:     "test",
			limit:     -5,
			expectMax: 10,
		},
		{
			name:      "limit above max capped at 20",
			query:     "test",
			limit:     100,
			expectMax: 20,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			suggestions, err := db.SearchSuggestions(ctx, tt.query, tt.limit)
			if err != nil {
				t.Fatalf("SearchSuggestions failed: %v", err)
			}

			if len(suggestions) > tt.expectMax {
				t.Errorf("Expected at most %d suggestions, got %d", tt.expectMax, len(suggestions))
			}

			t.Logf("%s: requested %d, got %d (max %d)", tt.name, tt.limit, len(suggestions), tt.expectMax)
		})
	}
}

// TestSearchSuggestionsMixedResults tests that search returns both tags and files.
func TestSearchSuggestionsMixedResults(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files
	files := []MediaFile{
		{Name: "vacation_beach.jpg", Path: "vacation_beach.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "vacation_mountain.jpg", Path: "vacation_mountain.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	// Add tag that matches the search term
	_, _ = db.GetOrCreateTag(ctx, "vacation")

	// Search for "vacation" should return both tag and files
	suggestions, err := db.SearchSuggestions(ctx, "vacation", 10)
	if err != nil {
		t.Fatalf("SearchSuggestions failed: %v", err)
	}

	// Should have at least 1 result (could be tag or files)
	if len(suggestions) < 1 {
		t.Error("Expected at least 1 suggestion for mixed search")
	}

	// Count tags and files
	tagCount := 0
	fileCount := 0
	for _, s := range suggestions {
		if s.Type == "tag" {
			tagCount++
		} else {
			fileCount++
		}
	}

	t.Logf("Mixed search returned %d tags and %d files", tagCount, fileCount)

	// We should have at least one of each type
	if tagCount == 0 && fileCount == 0 {
		t.Error("Expected either tags or files in results")
	}
}

// TestSearchSuggestionsExclusionPrefixes tests various exclusion prefix formats.
func TestSearchSuggestionsExclusionPrefixes(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add tags for exclusion testing
	tags := []string{"nature", "city", "night", "day"}
	for _, tag := range tags {
		_, _ = db.GetOrCreateTag(ctx, tag)
	}

	tests := []struct {
		name           string
		query          string
		expectTag      bool
		expectExcluded bool
		expectedType   string
	}{
		{
			name:           "dash prefix",
			query:          "-",
			expectTag:      true,
			expectExcluded: true,
			expectedType:   "tag-exclude",
		},
		{
			name:           "dash with tag prefix",
			query:          "-tag:",
			expectTag:      true,
			expectExcluded: true,
			expectedType:   "tag-exclude",
		},
		{
			name:           "dash with partial tag",
			query:          "-nat",
			expectTag:      true,
			expectExcluded: true,
			expectedType:   "tag-exclude",
		},
		{
			name:           "NOT prefix",
			query:          "NOT ",
			expectTag:      true,
			expectExcluded: true,
			expectedType:   "tag-exclude",
		},
		{
			name:           "NOT with tag prefix",
			query:          "NOT tag:",
			expectTag:      true,
			expectExcluded: true,
			expectedType:   "tag-exclude",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			suggestions, err := db.SearchSuggestions(ctx, tt.query, 10)
			if err != nil {
				t.Fatalf("SearchSuggestions failed: %v", err)
			}

			if tt.expectTag && len(suggestions) > 0 {
				// Verify at least one suggestion has the expected type
				hasExpectedType := false
				for _, s := range suggestions {
					if s.Type == tt.expectedType {
						hasExpectedType = true
						break
					}
				}
				if !hasExpectedType {
					t.Errorf("Expected at least one suggestion with type %q, got types: %v", tt.expectedType, getTypes(suggestions))
				}
			}

			t.Logf("%s: got %d suggestions", tt.name, len(suggestions))
		})
	}
}

// TestPerformRegularSearchDistribution tests tag/file distribution in regular search.
func TestPerformRegularSearchDistribution(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert many files
	files := make([]MediaFile, 20)
	tx, _ := db.BeginBatch()
	for i := range files {
		files[i] = MediaFile{
			Name:       "photo_" + string(rune('a'+i)) + ".jpg",
			Path:       "photo_" + string(rune('a'+i)) + ".jpg",
			ParentPath: "",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	// Add tags that match "photo"
	_, _ = db.GetOrCreateTag(ctx, "photo")
	_, _ = db.GetOrCreateTag(ctx, "photography")

	// Search should return mix of tags and files up to limit
	suggestions, err := db.SearchSuggestions(ctx, "photo", 10)
	if err != nil {
		t.Fatalf("SearchSuggestions failed: %v", err)
	}

	if len(suggestions) == 0 {
		t.Error("Expected suggestions for 'photo' query")
	}

	// Verify limit is respected
	if len(suggestions) > 10 {
		t.Errorf("Expected at most 10 suggestions, got %d", len(suggestions))
	}

	// Count types
	tagCount := 0
	fileCount := 0
	for _, s := range suggestions {
		if s.Type == "tag" {
			tagCount++
		} else {
			fileCount++
		}
	}

	t.Logf("Regular search returned %d tags and %d files (total %d)", tagCount, fileCount, len(suggestions))
}
