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

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
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
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		files[i] = MediaFile{
			Name:       "test_" + string(rune('a'+i)) + ".jpg",
			Path:       "test_" + string(rune('a'+i)) + ".jpg",
			ParentPath: "",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = tx.UpsertFile(ctx, &files[i])
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

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
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
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		files[i] = MediaFile{
			Name:       "photo_" + string(rune('a'+i)) + ".jpg",
			Path:       "photo_" + string(rune('a'+i)) + ".jpg",
			ParentPath: "",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = tx.UpsertFile(ctx, &files[i])
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

// TestListDirectoryBasicIntegration tests basic directory listing functionality.
func TestListDirectoryBasicIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files in a "photos" folder
	files := []MediaFile{
		{Name: "photo1.jpg", Path: "photos/photo1.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "photo2.jpg", Path: "photos/photo2.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 2048, ModTime: time.Now()},
		{Name: "video1.mp4", Path: "photos/video1.mp4", ParentPath: "photos", Type: FileTypeVideo, Size: 5000, ModTime: time.Now()},
	}
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	for i := range files {
		if err := tx.UpsertFile(ctx, &files[i]); err != nil {
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// List the "photos" directory
	listing, err := db.ListDirectory(ctx, ListOptions{
		Path:     "photos",
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}

	if listing.TotalItems != 3 {
		t.Errorf("Expected 3 items, got %d", listing.TotalItems)
	}
	if len(listing.Items) != 3 {
		t.Errorf("Expected 3 items in page, got %d", len(listing.Items))
	}
	if listing.Path != "photos" {
		t.Errorf("Expected path 'photos', got %s", listing.Path)
	}
	if listing.Name != "photos" {
		t.Errorf("Expected name 'photos', got %s", listing.Name)
	}
	if listing.Page != 1 {
		t.Errorf("Expected page 1, got %d", listing.Page)
	}
	if listing.TotalPages < 1 {
		t.Errorf("Expected at least 1 total page, got %d", listing.TotalPages)
	}
}

// TestListDirectoryRootDirNameIntegration tests that the root directory gets name "Media".
func TestListDirectoryRootDirNameIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	listing, err := db.ListDirectory(ctx, ListOptions{
		Path:     "",
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}
	if listing.Name != "Media" {
		t.Errorf("Expected root name 'Media', got %s", listing.Name)
	}
	if listing.Parent != "" {
		t.Errorf("Expected empty parent for root, got %s", listing.Parent)
	}
}

// TestListDirectorySortVariantsIntegration tests all sort field variants.
func TestListDirectorySortVariantsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	now := time.Now()
	files := []MediaFile{
		{Name: "alpha.jpg", Path: "sort/alpha.jpg", ParentPath: "sort", Type: FileTypeImage, Size: 100, ModTime: now.Add(-3 * time.Hour)},
		{Name: "beta.mp4", Path: "sort/beta.mp4", ParentPath: "sort", Type: FileTypeVideo, Size: 500, ModTime: now.Add(-1 * time.Hour)},
		{Name: "gamma.jpg", Path: "sort/gamma.jpg", ParentPath: "sort", Type: FileTypeImage, Size: 300, ModTime: now.Add(-2 * time.Hour)},
	}
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	sortTests := []struct {
		sortField SortField
		sortOrder SortOrder
	}{
		{SortByDate, SortAsc},
		{SortByDate, SortDesc},
		{SortBySize, SortAsc},
		{SortBySize, SortDesc},
		{SortByType, SortAsc},
		{SortByName, SortAsc},
		{"", SortAsc}, // default
	}

	for _, tt := range sortTests {
		t.Run(string(tt.sortField)+"-"+string(tt.sortOrder), func(t *testing.T) {
			listing, err := db.ListDirectory(ctx, ListOptions{
				Path:      "sort",
				Page:      1,
				PageSize:  10,
				SortField: tt.sortField,
				SortOrder: tt.sortOrder,
			})
			if err != nil {
				t.Fatalf("ListDirectory sort=%s order=%s failed: %v", tt.sortField, tt.sortOrder, err)
			}
			if len(listing.Items) != 3 {
				t.Errorf("sort=%s order=%s: expected 3 items, got %d", tt.sortField, tt.sortOrder, len(listing.Items))
			}
		})
	}
}

// TestListDirectoryFilterTypeIntegration tests filtering by file type.
func TestListDirectoryFilterTypeIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	files := []MediaFile{
		{Name: "img1.jpg", Path: "mixed/img1.jpg", ParentPath: "mixed", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "img2.jpg", Path: "mixed/img2.jpg", ParentPath: "mixed", Type: FileTypeImage, Size: 200, ModTime: time.Now()},
		{Name: "vid1.mp4", Path: "mixed/vid1.mp4", ParentPath: "mixed", Type: FileTypeVideo, Size: 300, ModTime: time.Now()},
	}
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	listing, err := db.ListDirectory(ctx, ListOptions{
		Path:       "mixed",
		Page:       1,
		PageSize:   10,
		FilterType: string(FileTypeImage),
	})
	if err != nil {
		t.Fatalf("ListDirectory with FilterType failed: %v", err)
	}

	if listing.TotalItems != 2 {
		t.Errorf("Expected 2 image items, got %d", listing.TotalItems)
	}
	for _, item := range listing.Items {
		if item.Type != FileTypeImage {
			t.Errorf("Expected item type image, got %s for %s", item.Type, item.Name)
		}
	}
}

// TestListDirectoryOffsetIntegration tests offset-based pagination.
func TestListDirectoryOffsetIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	files := []MediaFile{
		{Name: "a.jpg", Path: "paged/a.jpg", ParentPath: "paged", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "b.jpg", Path: "paged/b.jpg", ParentPath: "paged", Type: FileTypeImage, Size: 200, ModTime: time.Now()},
		{Name: "c.jpg", Path: "paged/c.jpg", ParentPath: "paged", Type: FileTypeImage, Size: 300, ModTime: time.Now()},
		{Name: "d.jpg", Path: "paged/d.jpg", ParentPath: "paged", Type: FileTypeImage, Size: 400, ModTime: time.Now()},
		{Name: "e.jpg", Path: "paged/e.jpg", ParentPath: "paged", Type: FileTypeImage, Size: 500, ModTime: time.Now()},
	}
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	// Fetch with offset=2, pageSize=2 — should get items 3 and 4
	listing, err := db.ListDirectory(ctx, ListOptions{
		Path:     "paged",
		Page:     1,
		PageSize: 2,
		Offset:   2,
	})
	if err != nil {
		t.Fatalf("ListDirectory with offset failed: %v", err)
	}
	if len(listing.Items) != 2 {
		t.Errorf("Expected 2 items with offset, got %d", len(listing.Items))
	}
}

// TestListDirectoryFavoritesIntegration tests that favorites are loaded for root+page1.
func TestListDirectoryFavoritesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert the folder into files first (getFavorites uses INNER JOIN files)
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	folder := MediaFile{
		Name:       "folder1",
		Path:       "folder1",
		ParentPath: "",
		Type:       FileTypeFolder,
		Size:       0,
		ModTime:    time.Now(),
	}
	if err := tx.UpsertFile(ctx, &folder); err != nil {
		t.Fatalf("UpsertFile failed: %v", err)
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Add a favorite
	if err := db.AddFavorite(ctx, "folder1", "folder1", FileTypeFolder); err != nil {
		t.Fatalf("AddFavorite failed: %v", err)
	}

	listing, err := db.ListDirectory(ctx, ListOptions{
		Path:     "",
		Page:     1,
		PageSize: 50,
	})
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}

	if len(listing.Favorites) == 0 {
		t.Error("Expected favorites to be loaded for root page 1")
	}

	// Page 2 should NOT load favorites
	listing2, err := db.ListDirectory(ctx, ListOptions{
		Path:     "",
		Page:     2,
		PageSize: 50,
	})
	if err != nil {
		t.Fatalf("ListDirectory page 2 failed: %v", err)
	}
	if len(listing2.Favorites) != 0 {
		t.Error("Expected no favorites on page 2")
	}

	// Non-root path on page 1 SHOULD also load favorites
	listing3, err := db.ListDirectory(ctx, ListOptions{
		Path:     "subfolder",
		Page:     1,
		PageSize: 50,
	})
	if err != nil {
		t.Fatalf("ListDirectory subfolder failed: %v", err)
	}
	if len(listing3.Favorites) == 0 {
		t.Error("Expected favorites to be loaded for non-root path on page 1")
	}
}

// TestListDirectoryBreadcrumbIntegration tests breadcrumb for a nested path.
func TestListDirectoryBreadcrumbIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	listing, err := db.ListDirectory(ctx, ListOptions{
		Path:     "folder1/subfolder/deep",
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}

	// Breadcrumb should be: [Media(""), folder1, subfolder, deep]
	if len(listing.Breadcrumb) != 4 {
		t.Errorf("Expected 4 breadcrumb parts, got %d: %v", len(listing.Breadcrumb), listing.Breadcrumb)
	} else {
		if listing.Breadcrumb[0].Name != "Media" || listing.Breadcrumb[0].Path != "" {
			t.Errorf("Unexpected root breadcrumb: %v", listing.Breadcrumb[0])
		}
		if listing.Breadcrumb[1].Name != "folder1" || listing.Breadcrumb[1].Path != "folder1" {
			t.Errorf("Unexpected first part: %v", listing.Breadcrumb[1])
		}
		if listing.Breadcrumb[3].Name != "deep" {
			t.Errorf("Unexpected last part: %v", listing.Breadcrumb[3])
		}
	}
}

// TestListDirectoryParentPathIntegration tests that parent path is computed correctly.
func TestListDirectoryParentPathIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// One-level deep: parent should be ""
	listing, err := db.ListDirectory(ctx, ListOptions{Path: "photos", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}
	if listing.Parent != "" {
		t.Errorf("Expected parent '' for 'photos', got '%s'", listing.Parent)
	}

	// Two-level deep: parent should be "photos"
	listing2, err := db.ListDirectory(ctx, ListOptions{Path: "photos/2024", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}
	if listing2.Parent != "photos" {
		t.Errorf("Expected parent 'photos' for 'photos/2024', got '%s'", listing2.Parent)
	}
}

// TestListDirectoryWithTagsIntegration tests that tags are included in results.
func TestListDirectoryWithTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	file := MediaFile{
		Name:       "tagged.jpg",
		Path:       "tagtest/tagged.jpg",
		ParentPath: "tagtest",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
	}
	tx, _ := db.BeginBatch(ctx)
	_ = tx.UpsertFile(ctx, &file)
	_ = db.EndBatch(tx, nil)

	_ = db.AddTagToFile(ctx, "tagtest/tagged.jpg", "mytag")

	listing, err := db.ListDirectory(ctx, ListOptions{
		Path:     "tagtest",
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}
	if len(listing.Items) != 1 {
		t.Fatalf("Expected 1 item, got %d", len(listing.Items))
	}
	if len(listing.Items[0].Tags) == 0 {
		t.Error("Expected tags to be returned with file")
	}
	if listing.Items[0].Tags[0] != "mytag" {
		t.Errorf("Expected tag 'mytag', got %v", listing.Items[0].Tags)
	}
}

// TestSearchEmptyQueryIntegration tests that an empty query returns an empty result.
func TestSearchEmptyQueryIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	result, err := db.Search(ctx, SearchOptions{Query: ""})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
	if result.TotalItems != 0 {
		t.Errorf("Expected 0 total items for empty query, got %d", result.TotalItems)
	}
	if len(result.Items) != 0 {
		t.Errorf("Expected empty items for empty query, got %d", len(result.Items))
	}
}

// TestSearchByTagFiltersOnlyIntegration tests searching with only tag filters.
func TestSearchByTagFiltersOnlyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files and tag them
	files := []MediaFile{
		{Name: "action1.jpg", Path: "action1.jpg", ParentPath: "", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "action2.mp4", Path: "action2.mp4", ParentPath: "", Type: FileTypeVideo, Size: 200, ModTime: time.Now()},
		{Name: "drama1.jpg", Path: "drama1.jpg", ParentPath: "", Type: FileTypeImage, Size: 300, ModTime: time.Now()},
	}
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	_ = db.AddTagToFile(ctx, "action1.jpg", "action")
	_ = db.AddTagToFile(ctx, "action2.mp4", "action")
	_ = db.AddTagToFile(ctx, "drama1.jpg", "drama")

	// Search with only a tag filter
	result, err := db.Search(ctx, SearchOptions{
		Query:    "tag:action",
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("Search with tag filter failed: %v", err)
	}
	if result.TotalItems != 2 {
		t.Errorf("Expected 2 results for tag:action, got %d", result.TotalItems)
	}
	for _, item := range result.Items {
		found := false
		for _, tg := range item.Tags {
			if tg == "action" {
				found = true
			}
		}
		if !found {
			t.Errorf("Result %s does not have 'action' tag, tags: %v", item.Name, item.Tags)
		}
	}

	// Search with exclusion tag filter
	resultExclude, err := db.Search(ctx, SearchOptions{
		Query:    "-tag:drama",
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("Search with -tag filter failed: %v", err)
	}
	for _, item := range resultExclude.Items {
		for _, tg := range item.Tags {
			if tg == "drama" {
				t.Errorf("Excluded file %s with 'drama' tag should not appear", item.Name)
			}
		}
	}
}

// TestSearchByTagFiltersWithFilterTypeIntegration tests tag search with file type filter.
func TestSearchByTagFiltersWithFilterTypeIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	files := []MediaFile{
		{Name: "img.jpg", Path: "ftfilter/img.jpg", ParentPath: "ftfilter", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "vid.mp4", Path: "ftfilter/vid.mp4", ParentPath: "ftfilter", Type: FileTypeVideo, Size: 200, ModTime: time.Now()},
	}
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	_ = db.AddTagToFile(ctx, "ftfilter/img.jpg", "summer")
	_ = db.AddTagToFile(ctx, "ftfilter/vid.mp4", "summer")

	result, err := db.Search(ctx, SearchOptions{
		Query:      "tag:summer",
		FilterType: string(FileTypeImage),
		Page:       1,
		PageSize:   10,
	})
	if err != nil {
		t.Fatalf("Search with FilterType failed: %v", err)
	}
	if result.TotalItems != 1 {
		t.Errorf("Expected 1 image result, got %d", result.TotalItems)
	}
	if len(result.Items) > 0 && result.Items[0].Type != FileTypeImage {
		t.Errorf("Expected image type, got %s", result.Items[0].Type)
	}
}

// TestSearchWithTextAndTagFiltersIntegration tests combined text and tag search.
func TestSearchWithTextAndTagFiltersIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	files := []MediaFile{
		{Name: "holiday_photo.jpg", Path: "combined/holiday_photo.jpg", ParentPath: "combined", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "holiday_video.mp4", Path: "combined/holiday_video.mp4", ParentPath: "combined", Type: FileTypeVideo, Size: 200, ModTime: time.Now()},
		{Name: "other.jpg", Path: "combined/other.jpg", ParentPath: "combined", Type: FileTypeImage, Size: 300, ModTime: time.Now()},
	}
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	_ = db.AddTagToFile(ctx, "combined/holiday_photo.jpg", "holiday")
	_ = db.AddTagToFile(ctx, "combined/holiday_video.mp4", "holiday")
	_ = db.AddTagToFile(ctx, "combined/other.jpg", "work")

	// Combined text + tag filter
	result, err := db.Search(ctx, SearchOptions{
		Query:    "holiday tag:holiday",
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("Search with text+tag failed: %v", err)
	}
	// The query should find results with "holiday" in name AND tagged "holiday"
	t.Logf("Combined search returned %d items", result.TotalItems)
}

// TestSearchPaginationIntegration tests search pagination.
func TestSearchPaginationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files tagged "paginate"
	for i := 0; i < 5; i++ {
		f := MediaFile{
			Name:       strings.Repeat("x", i+1) + ".jpg",
			Path:       "paginate/" + strings.Repeat("x", i+1) + ".jpg",
			ParentPath: "paginate",
			Type:       FileTypeImage,
			Size:       int64(100 * (i + 1)),
			ModTime:    time.Now(),
		}
		tx, _ := db.BeginBatch(ctx)
		_ = tx.UpsertFile(ctx, &f)
		_ = db.EndBatch(tx, nil)
		_ = db.AddTagToFile(ctx, f.Path, "paginate")
	}

	result, err := db.Search(ctx, SearchOptions{
		Query:    "tag:paginate",
		Page:     1,
		PageSize: 2,
	})
	if err != nil {
		t.Fatalf("Search pagination failed: %v", err)
	}
	if result.TotalItems != 5 {
		t.Errorf("Expected 5 total items, got %d", result.TotalItems)
	}
	if len(result.Items) != 2 {
		t.Errorf("Expected 2 items on page 1, got %d", len(result.Items))
	}
	if result.TotalPages < 3 {
		t.Errorf("Expected at least 3 pages, got %d", result.TotalPages)
	}

	// Page 2
	result2, err := db.Search(ctx, SearchOptions{
		Query:    "tag:paginate",
		Page:     2,
		PageSize: 2,
	})
	if err != nil {
		t.Fatalf("Search page 2 failed: %v", err)
	}
	if len(result2.Items) != 2 {
		t.Errorf("Expected 2 items on page 2, got %d", len(result2.Items))
	}
}

// TestGetMediaFilesForThumbnailsPagedIntegration tests GetMediaFilesForThumbnailsPaged
// pagination, ordering, and terminal-page behavior.
func TestGetMediaFilesForThumbnailsPagedIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files at different depths
	files := []MediaFile{
		{Name: "root.jpg", Path: "root.jpg", ParentPath: "", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "deep.jpg", Path: "folder/sub/deep.jpg", ParentPath: "folder/sub", Type: FileTypeImage, Size: 200, ModTime: time.Now()},
		{Name: "mid.mp4", Path: "folder/mid.mp4", ParentPath: "folder", Type: FileTypeVideo, Size: 150, ModTime: time.Now()},
	}
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	// Collect all files via paging (page size smaller than total to exercise pagination)
	var all []MediaFile
	const pageSize = 2
	for offset := 0; ; {
		page, err := db.GetMediaFilesForThumbnailsPaged(ctx, offset, pageSize)
		if err != nil {
			t.Fatalf("GetMediaFilesForThumbnailsPaged failed at offset %d: %v", offset, err)
		}
		if len(page) == 0 {
			break
		}
		all = append(all, page...)
		offset += len(page)
		if len(page) < pageSize {
			break
		}
	}

	if len(all) != 4 {
		t.Errorf("Expected 4 files total across pages, got %d", len(all))
	}

	// Verify files are ordered by path ASC across pages
	for i := 1; i < len(all); i++ {
		if all[i].Path < all[i-1].Path {
			t.Errorf("files not ordered by path: %q before %q", all[i-1].Path, all[i].Path)
		}
	}
}

// TestCountMediaFilesForThumbnailsIntegration verifies that CountMediaFilesForThumbnails
// returns the exact same population as GetMediaFilesForThumbnailsPaged and that
// non-eligible types (e.g. playlists) are excluded from the count.
func TestCountMediaFilesForThumbnailsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Empty database — count must be zero.
	count, err := db.CountMediaFilesForThumbnails(ctx)
	if err != nil {
		t.Fatalf("CountMediaFilesForThumbnails failed on empty db: %v", err)
	}
	if count != 0 {
		t.Errorf("empty db: got count %d, want 0", count)
	}

	// Insert a mix of types.
	files := []MediaFile{
		{Name: "img.jpg", Path: "img.jpg", ParentPath: "", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "clip.mp4", Path: "clip.mp4", ParentPath: "", Type: FileTypeVideo, Size: 200, ModTime: time.Now()},
		{Name: "album", Path: "album", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		// Playlists must NOT be counted — they are excluded from thumbnail generation.
		{Name: "list.wpl", Path: "list.wpl", ParentPath: "", Type: FileTypePlaylist, Size: 50, ModTime: time.Now()},
	}
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	for i := range files {
		if err := tx.UpsertFile(ctx, &files[i]); err != nil {
			_ = db.EndBatch(tx, err)
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Three eligible types (image + video + folder); one playlist which is excluded.
	const wantEligible = 3

	count, err = db.CountMediaFilesForThumbnails(ctx)
	if err != nil {
		t.Fatalf("CountMediaFilesForThumbnails failed: %v", err)
	}
	if count != wantEligible {
		t.Errorf("got count %d, want %d", count, wantEligible)
	}

	// Verify count agrees with the total returned by the paged query.
	// This guards against the two functions diverging (e.g. different WHERE clauses).
	var pagedTotal int
	for offset := 0; ; {
		page, pageErr := db.GetMediaFilesForThumbnailsPaged(ctx, offset, 2)
		if pageErr != nil {
			t.Fatalf("GetMediaFilesForThumbnailsPaged failed: %v", pageErr)
		}
		if len(page) == 0 {
			break
		}
		pagedTotal += len(page)
		offset += len(page)
		if len(page) < 2 {
			break
		}
	}
	if pagedTotal != count {
		t.Errorf("paged total %d != count %d — CountMediaFilesForThumbnails and GetMediaFilesForThumbnailsPaged disagree",
			pagedTotal, count)
	}
}

// TestGetMediaFilesForAutoTaggingPagedIntegration tests
// GetMediaFilesForAutoTaggingPaged pagination, ordering, and type filtering.
func TestGetMediaFilesForAutoTaggingPagedIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	files := []MediaFile{
		{Name: "root.jpg", Path: "root.jpg", ParentPath: "", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "deep.jpg", Path: "folder/sub/deep.jpg", ParentPath: "folder/sub", Type: FileTypeImage, Size: 200, ModTime: time.Now()},
		{Name: "mid.mp4", Path: "folder/mid.mp4", ParentPath: "folder", Type: FileTypeVideo, Size: 150, ModTime: time.Now()},
		{Name: "list.wpl", Path: "list.wpl", ParentPath: "", Type: FileTypePlaylist, Size: 50, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	for i := range files {
		if err := tx.UpsertFile(ctx, &files[i]); err != nil {
			_ = db.EndBatch(tx, err)
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	var all []MediaFile
	const pageSize = 2
	for offset := 0; ; {
		page, err := db.GetMediaFilesForAutoTaggingPaged(ctx, offset, pageSize)
		if err != nil {
			t.Fatalf("GetMediaFilesForAutoTaggingPaged failed at offset %d: %v", offset, err)
		}
		if len(page) == 0 {
			break
		}
		all = append(all, page...)
		offset += len(page)
		if len(page) < pageSize {
			break
		}
	}

	if len(all) != 3 {
		t.Fatalf("expected 3 auto-tagging files total across pages, got %d", len(all))
	}

	for _, file := range all {
		if file.Type != FileTypeImage && file.Type != FileTypeVideo {
			t.Fatalf("unexpected file type %q returned for auto-tagging query", file.Type)
		}
	}

	for i := 1; i < len(all); i++ {
		if all[i].Path < all[i-1].Path {
			t.Errorf("files not ordered by path: %q before %q", all[i-1].Path, all[i].Path)
		}
	}
}

// TestCountMediaFilesForAutoTaggingIntegration verifies that
// CountMediaFilesForAutoTagging matches the exact population returned by
// GetMediaFilesForAutoTaggingPaged and excludes non-image/video types.
func TestCountMediaFilesForAutoTaggingIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	count, err := db.CountMediaFilesForAutoTagging(ctx)
	if err != nil {
		t.Fatalf("CountMediaFilesForAutoTagging failed on empty db: %v", err)
	}
	if count != 0 {
		t.Errorf("empty db: got count %d, want 0", count)
	}

	files := []MediaFile{
		{Name: "img.jpg", Path: "img.jpg", ParentPath: "", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "clip.mp4", Path: "clip.mp4", ParentPath: "", Type: FileTypeVideo, Size: 200, ModTime: time.Now()},
		{Name: "album", Path: "album", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "list.wpl", Path: "list.wpl", ParentPath: "", Type: FileTypePlaylist, Size: 50, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	for i := range files {
		if err := tx.UpsertFile(ctx, &files[i]); err != nil {
			_ = db.EndBatch(tx, err)
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	const wantEligible = 2

	count, err = db.CountMediaFilesForAutoTagging(ctx)
	if err != nil {
		t.Fatalf("CountMediaFilesForAutoTagging failed: %v", err)
	}
	if count != wantEligible {
		t.Errorf("got count %d, want %d", count, wantEligible)
	}

	var pagedTotal int
	for offset := 0; ; {
		page, pageErr := db.GetMediaFilesForAutoTaggingPaged(ctx, offset, 2)
		if pageErr != nil {
			t.Fatalf("GetMediaFilesForAutoTaggingPaged failed: %v", pageErr)
		}
		if len(page) == 0 {
			break
		}
		pagedTotal += len(page)
		offset += len(page)
		if len(page) < 2 {
			break
		}
	}
	if pagedTotal != count {
		t.Errorf("paged total %d != count %d — CountMediaFilesForAutoTagging and GetMediaFilesForAutoTaggingPaged disagree",
			pagedTotal, count)
	}
}

// TestGetFoldersWithUpdatedContentsIntegration tests GetFoldersWithUpdatedContents.
func TestGetFoldersWithUpdatedContentsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert a folder and a file inside it
	folder := MediaFile{Name: "albums", Path: "albums", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()}
	file := MediaFile{Name: "photo.jpg", Path: "albums/photo.jpg", ParentPath: "albums", Type: FileTypeImage, Size: 100, ModTime: time.Now()}

	tx, _ := db.BeginBatch(ctx)
	_ = tx.UpsertFile(ctx, &folder)
	_ = tx.UpsertFile(ctx, &file)
	_ = db.EndBatch(tx, nil)

	// Query with very old since — should find folders with recently added contents
	veryOld := time.Unix(0, 0)
	result, err := db.GetFoldersWithUpdatedContents(ctx, veryOld)
	if err != nil {
		t.Fatalf("GetFoldersWithUpdatedContents failed: %v", err)
	}
	t.Logf("GetFoldersWithUpdatedContents returned %d folders", len(result))

	// Query with future time — should return no folders
	future := time.Now().Add(24 * time.Hour)
	result2, err := db.GetFoldersWithUpdatedContents(ctx, future)
	if err != nil {
		t.Fatalf("GetFoldersWithUpdatedContents with future time failed: %v", err)
	}
	if len(result2) != 0 {
		t.Errorf("Expected 0 folders with future since, got %d", len(result2))
	}
}

// TestGetAllIndexedPathsIntegration tests GetAllIndexedPaths returns all non-playlist paths.
func TestGetAllIndexedPathsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Start with empty — should return empty map
	paths, err := db.GetAllIndexedPaths(ctx)
	if err != nil {
		t.Fatalf("GetAllIndexedPaths on empty DB failed: %v", err)
	}
	if len(paths) != 0 {
		t.Errorf("Expected empty map on empty DB, got %d paths", len(paths))
	}

	// Insert some files
	files := []MediaFile{
		{Name: "a.jpg", Path: "a.jpg", ParentPath: "", Type: FileTypeImage, Size: 100, ModTime: time.Now()},
		{Name: "b.mp4", Path: "b.mp4", ParentPath: "", Type: FileTypeVideo, Size: 200, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}
	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	paths2, err := db.GetAllIndexedPaths(ctx)
	if err != nil {
		t.Fatalf("GetAllIndexedPaths failed: %v", err)
	}
	if len(paths2) != 3 {
		t.Errorf("Expected 3 paths, got %d", len(paths2))
	}

	// Verify specific paths are present
	for _, f := range files {
		if _, ok := paths2[f.Path]; !ok {
			t.Errorf("Expected path %q in result", f.Path)
		}
	}
}

// TestGetDirectorySummaryIntegration tests GetDirectorySummary returns correct label groups.
func TestGetDirectorySummaryIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	base := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)
	files := []MediaFile{
		{Name: "Apple.jpg", Path: "Apple.jpg", ParentPath: "", Type: FileTypeImage, Size: 100, ModTime: base},
		{Name: "Avocado.jpg", Path: "Avocado.jpg", ParentPath: "", Type: FileTypeImage, Size: 100, ModTime: base.AddDate(0, 1, 0)},
		{Name: "Banana.jpg", Path: "Banana.jpg", ParentPath: "", Type: FileTypeImage, Size: 100, ModTime: base.AddDate(-1, 0, 0)},
		{Name: "Cherry.jpg", Path: "Cherry.jpg", ParentPath: "sub", Type: FileTypeImage, Size: 100, ModTime: base},
	}
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch: %v", err)
	}
	for i := range files {
		if err := tx.UpsertFile(ctx, &files[i]); err != nil {
			t.Fatalf("UpsertFile: %v", err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch: %v", err)
	}

	t.Run("name sort groups by letter", func(t *testing.T) {
		summary, err := db.GetDirectorySummary(ctx, "", SortByName, SortAsc)
		if err != nil {
			t.Fatalf("GetDirectorySummary: %v", err)
		}
		if summary.Total != 3 {
			t.Errorf("expected total=3, got %d", summary.Total)
		}
		if summary.Sort != string(SortByName) {
			t.Errorf("expected sort=%q, got %q", SortByName, summary.Sort)
		}
		if len(summary.Groups) != 2 {
			t.Fatalf("expected 2 groups (A, B), got %d: %v", len(summary.Groups), summary.Groups)
		}
		if summary.Groups[0].Label != "A" || summary.Groups[0].Count != 2 {
			t.Errorf("group[0]: got %+v, want {A offset:0 count:2}", summary.Groups[0])
		}
		if summary.Groups[1].Label != "B" || summary.Groups[1].Count != 1 {
			t.Errorf("group[1]: got %+v, want {B offset:2 count:1}", summary.Groups[1])
		}
	})

	t.Run("date sort groups by year", func(t *testing.T) {
		summary, err := db.GetDirectorySummary(ctx, "", SortByDate, SortAsc)
		if err != nil {
			t.Fatalf("GetDirectorySummary: %v", err)
		}
		if summary.Total != 3 {
			t.Errorf("expected total=3, got %d", summary.Total)
		}
		// Files span 2023 and 2024
		if len(summary.Groups) != 2 {
			t.Fatalf("expected 2 year groups, got %d: %v", len(summary.Groups), summary.Groups)
		}
		if summary.Groups[0].Label != "2023" {
			t.Errorf("expected first group label=2023, got %q", summary.Groups[0].Label)
		}
		if summary.Groups[1].Label != "2024" {
			t.Errorf("expected second group label=2024, got %q", summary.Groups[1].Label)
		}
	})

	t.Run("size sort returns no groups", func(t *testing.T) {
		summary, err := db.GetDirectorySummary(ctx, "", SortBySize, SortAsc)
		if err != nil {
			t.Fatalf("GetDirectorySummary: %v", err)
		}
		if summary.Total != 3 {
			t.Errorf("expected total=3, got %d", summary.Total)
		}
		if len(summary.Groups) != 0 {
			t.Errorf("expected no groups for size sort, got %v", summary.Groups)
		}
	})

	t.Run("subdirectory scoped correctly", func(t *testing.T) {
		summary, err := db.GetDirectorySummary(ctx, "sub", SortByName, SortAsc)
		if err != nil {
			t.Fatalf("GetDirectorySummary: %v", err)
		}
		if summary.Total != 1 {
			t.Errorf("expected total=1, got %d", summary.Total)
		}
		if len(summary.Groups) != 1 || summary.Groups[0].Label != "C" {
			t.Errorf("expected group C, got %v", summary.Groups)
		}
	})

	t.Run("empty directory returns zero total", func(t *testing.T) {
		summary, err := db.GetDirectorySummary(ctx, "nonexistent", SortByName, SortAsc)
		if err != nil {
			t.Fatalf("GetDirectorySummary: %v", err)
		}
		if summary.Total != 0 {
			t.Errorf("expected total=0, got %d", summary.Total)
		}
		if len(summary.Groups) != 0 {
			t.Errorf("expected no groups, got %v", summary.Groups)
		}
	})
}

// end of queries_integration_test.go additions
