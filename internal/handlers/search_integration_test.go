package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

// =============================================================================
// Search Integration Tests
// =============================================================================

// setupSearchIntegrationTest creates a complete handler setup for testing search
func setupSearchIntegrationTest(t *testing.T) (h *Handlers, mediaDir string, cleanup func()) {
	t.Helper()

	// Create temporary directories
	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"
	mediaDir = tempDir + "/media"
	cacheDir := tempDir + "/cache"

	// Create media directory
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		t.Fatalf("failed to create media directory: %v", err)
	}

	// Initialize database
	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	// Create indexer
	idx := indexer.New(db, mediaDir, 0)

	// Create transcoder
	trans := transcoder.New(cacheDir, false)

	// Create thumbnail generator
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil)

	// Create config
	config := &startup.Config{
		MediaDir: mediaDir,
		CacheDir: cacheDir,
	}

	// Create handlers
	handlers := New(db, idx, trans, thumbGen, config)

	cleanup = func() {
		if err := db.Close(); err != nil {
			t.Logf("failed to close database: %v", err)
		}
	}

	return handlers, mediaDir, cleanup
}

// addSearchTestFile creates a file and adds it to the database
func addSearchTestFile(t *testing.T, db *database.Database, mediaDir, relPath string, fileType database.FileType) {
	t.Helper()

	fullPath := filepath.Join(mediaDir, relPath)
	dir := filepath.Dir(fullPath)

	// Create directory structure
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create directory: %v", err)
	}

	// Create file
	if err := os.WriteFile(fullPath, []byte("test content"), 0o644); err != nil {
		t.Fatalf("failed to create file: %v", err)
	}

	// Get file info
	info, err := os.Stat(fullPath)
	if err != nil {
		t.Fatalf("failed to stat file: %v", err)
	}

	// Insert into database
	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}

	mediaFile := &database.MediaFile{
		Path:    relPath,
		Name:    filepath.Base(relPath),
		Size:    info.Size(),
		ModTime: info.ModTime(),
		Type:    fileType,
	}

	if err := db.UpsertFile(tx, mediaFile); err != nil {
		t.Fatalf("failed to insert file: %v", err)
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("failed to commit transaction: %v", err)
	}
}

// TestSearchEmptyQueryIntegration tests search with empty query
func TestSearchEmptyQueryIntegration(t *testing.T) {
	h, _, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/search", http.NoBody)
	w := httptest.NewRecorder()

	h.Search(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result database.SearchResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Empty query should return empty result
	if result.Query != "" {
		t.Errorf("expected empty query, got %q", result.Query)
	}

	if result.TotalItems != 0 {
		t.Errorf("expected 0 total items, got %d", result.TotalItems)
	}

	if result.Items == nil {
		t.Error("expected empty array, got nil")
	}

	if len(result.Items) != 0 {
		t.Errorf("expected 0 items, got %d", len(result.Items))
	}
}

// TestSearchBasicQueryIntegration tests basic search functionality
func TestSearchBasicQueryIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Add test files
	addSearchTestFile(t, h.db, mediaDir, "vacation.jpg", database.FileTypeImage)
	addSearchTestFile(t, h.db, mediaDir, "vacation2023.mp4", database.FileTypeVideo)
	addSearchTestFile(t, h.db, mediaDir, "family.jpg", database.FileTypeImage)

	req := httptest.NewRequest(http.MethodGet, "/api/search?q=vacation", http.NoBody)
	w := httptest.NewRecorder()

	h.Search(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result database.SearchResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if result.Query != "vacation" {
		t.Errorf("expected query 'vacation', got %q", result.Query)
	}

	if len(result.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(result.Items))
	}

	// Verify content type
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", contentType)
	}
}

// TestSearchWithTypeFilterIntegration tests search with type filtering
func TestSearchWithTypeFilterIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Add test files
	addSearchTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)
	addSearchTestFile(t, h.db, mediaDir, "photo.mp4", database.FileTypeVideo)

	req := httptest.NewRequest(http.MethodGet, "/api/search?q=photo&type=image", http.NoBody)
	w := httptest.NewRecorder()

	h.Search(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result database.SearchResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(result.Items) != 1 {
		t.Errorf("expected 1 item (image only), got %d", len(result.Items))
	}

	if len(result.Items) > 0 && result.Items[0].Type != database.FileTypeImage {
		t.Errorf("expected image type, got %v", result.Items[0].Type)
	}
}

// TestSearchWithPaginationIntegration tests search pagination
func TestSearchWithPaginationIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Add multiple test files
	for i := 1; i <= 15; i++ {
		filename := "test" + string(rune('0'+i)) + ".jpg"
		addSearchTestFile(t, h.db, mediaDir, filename, database.FileTypeImage)
	}

	// Request with page size 10
	req := httptest.NewRequest(http.MethodGet, "/api/search?q=test&pageSize=10", http.NoBody)
	w := httptest.NewRecorder()

	h.Search(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result database.SearchResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if result.PageSize != 10 {
		t.Errorf("expected pageSize 10, got %d", result.PageSize)
	}

	if result.Page != 1 {
		t.Errorf("expected page 1, got %d", result.Page)
	}

	if len(result.Items) > 10 {
		t.Errorf("expected at most 10 items, got %d", len(result.Items))
	}
}

// TestSearchNoResultsIntegration tests search with no matches
func TestSearchNoResultsIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Add test files
	addSearchTestFile(t, h.db, mediaDir, "vacation.jpg", database.FileTypeImage)

	req := httptest.NewRequest(http.MethodGet, "/api/search?q=nonexistent", http.NoBody)
	w := httptest.NewRecorder()

	h.Search(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result database.SearchResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if result.TotalItems != 0 {
		t.Errorf("expected 0 total items, got %d", result.TotalItems)
	}

	if len(result.Items) != 0 {
		t.Errorf("expected 0 items, got %d", len(result.Items))
	}
}

// TestSearchResponseStructureIntegration tests search response structure
func TestSearchResponseStructureIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	addSearchTestFile(t, h.db, mediaDir, "test.jpg", database.FileTypeImage)

	req := httptest.NewRequest(http.MethodGet, "/api/search?q=test", http.NoBody)
	w := httptest.NewRecorder()

	h.Search(w, req)

	var result database.SearchResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify all required fields are present
	if result.Query == "" {
		t.Error("expected non-empty query")
	}

	if result.Items == nil {
		t.Error("expected non-nil items array")
	}

	if result.Page < 1 {
		t.Errorf("expected page >= 1, got %d", result.Page)
	}

	if result.PageSize < 1 {
		t.Errorf("expected pageSize >= 1, got %d", result.PageSize)
	}
}

// TestSearchSuggestionsEmptyQueryIntegration tests suggestions with empty query
func TestSearchSuggestionsEmptyQueryIntegration(t *testing.T) {
	h, _, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/search/suggestions", http.NoBody)
	w := httptest.NewRecorder()

	h.SearchSuggestions(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var suggestions []database.SearchSuggestion
	if err := json.NewDecoder(w.Body).Decode(&suggestions); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should return empty array, not null
	if suggestions == nil {
		t.Error("expected empty array, got nil")
	}
}

// TestSearchSuggestionsBasicIntegration tests basic suggestions functionality
func TestSearchSuggestionsBasicIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Add test files
	addSearchTestFile(t, h.db, mediaDir, "vacation.jpg", database.FileTypeImage)
	addSearchTestFile(t, h.db, mediaDir, "vacation2023.mp4", database.FileTypeVideo)

	req := httptest.NewRequest(http.MethodGet, "/api/search/suggestions?q=vac", http.NoBody)
	w := httptest.NewRecorder()

	h.SearchSuggestions(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var suggestions []database.SearchSuggestion
	if err := json.NewDecoder(w.Body).Decode(&suggestions); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(suggestions) == 0 {
		t.Error("expected at least one suggestion")
	}

	// Verify content type
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", contentType)
	}
}

// TestSearchSuggestionsLimitIntegration tests suggestions limit parameter
func TestSearchSuggestionsLimitIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Add test files
	for i := 1; i <= 20; i++ {
		filename := "test" + string(rune('0'+i)) + ".jpg"
		addSearchTestFile(t, h.db, mediaDir, filename, database.FileTypeImage)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/search/suggestions?q=test&limit=5", http.NoBody)
	w := httptest.NewRecorder()

	h.SearchSuggestions(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var suggestions []database.SearchSuggestion
	if err := json.NewDecoder(w.Body).Decode(&suggestions); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(suggestions) > 5 {
		t.Errorf("expected at most 5 suggestions, got %d", len(suggestions))
	}
}

// TestSearchSuggestionsNoMatchesIntegration tests suggestions with no matches
func TestSearchSuggestionsNoMatchesIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	addSearchTestFile(t, h.db, mediaDir, "vacation.jpg", database.FileTypeImage)

	req := httptest.NewRequest(http.MethodGet, "/api/search/suggestions?q=xyz", http.NoBody)
	w := httptest.NewRecorder()

	h.SearchSuggestions(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var suggestions []database.SearchSuggestion
	if err := json.NewDecoder(w.Body).Decode(&suggestions); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(suggestions) != 0 {
		t.Errorf("expected 0 suggestions, got %d", len(suggestions))
	}
}

// TestSearchCaseInsensitiveIntegration tests case-insensitive search
func TestSearchCaseInsensitiveIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	addSearchTestFile(t, h.db, mediaDir, "VACATION.jpg", database.FileTypeImage)

	tests := []struct {
		query string
		name  string
	}{
		{"vacation", "lowercase"},
		{"VACATION", "uppercase"},
		{"Vacation", "mixed case"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/search?q="+tt.query, http.NoBody)
			w := httptest.NewRecorder()

			h.Search(w, req)

			var result database.SearchResult
			if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			if len(result.Items) == 0 {
				t.Errorf("expected to find match for query %q", tt.query)
			}
		})
	}
}

// TestSearchSpecialCharactersIntegration tests search with special characters
func TestSearchSpecialCharactersIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	addSearchTestFile(t, h.db, mediaDir, "photo & video.jpg", database.FileTypeImage)

	req := httptest.NewRequest(http.MethodGet, "/api/search?q=photo", http.NoBody)
	w := httptest.NewRecorder()

	h.Search(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result database.SearchResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(result.Items) == 0 {
		t.Error("expected to find file with special characters")
	}
}

// TestSearchNestedPathsIntegration tests search in nested directories
func TestSearchNestedPathsIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Add files in nested directories
	addSearchTestFile(t, h.db, mediaDir, "folder1/photo.jpg", database.FileTypeImage)
	addSearchTestFile(t, h.db, mediaDir, "folder2/subfolder/photo.jpg", database.FileTypeImage)

	req := httptest.NewRequest(http.MethodGet, "/api/search?q=photo", http.NoBody)
	w := httptest.NewRecorder()

	h.Search(w, req)

	var result database.SearchResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(result.Items) != 2 {
		t.Errorf("expected 2 items from nested directories, got %d", len(result.Items))
	}
}

// TestCompleteSearchFlowIntegration tests the complete search workflow
func TestCompleteSearchFlowIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Add test files
	addSearchTestFile(t, h.db, mediaDir, "vacation2023.jpg", database.FileTypeImage)
	addSearchTestFile(t, h.db, mediaDir, "vacation2024.mp4", database.FileTypeVideo)

	// Step 1: Get suggestions
	sugReq := httptest.NewRequest(http.MethodGet, "/api/search/suggestions?q=vac", http.NoBody)
	sugW := httptest.NewRecorder()
	h.SearchSuggestions(sugW, sugReq)

	if sugW.Code != http.StatusOK {
		t.Fatalf("suggestions failed: %d", sugW.Code)
	}

	var suggestions []database.SearchSuggestion
	if err := json.NewDecoder(sugW.Body).Decode(&suggestions); err != nil {
		t.Fatalf("failed to decode suggestions: %v", err)
	}

	if len(suggestions) == 0 {
		t.Fatal("expected suggestions")
	}

	// Step 2: Perform full search
	searchReq := httptest.NewRequest(http.MethodGet, "/api/search?q=vacation", http.NoBody)
	searchW := httptest.NewRecorder()
	h.Search(searchW, searchReq)

	if searchW.Code != http.StatusOK {
		t.Fatalf("search failed: %d", searchW.Code)
	}

	var result database.SearchResult
	if err := json.NewDecoder(searchW.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode search result: %v", err)
	}

	if len(result.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(result.Items))
	}
}

// TestSearchInvalidPaginationIntegration tests search with invalid pagination parameters
func TestSearchInvalidPaginationIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	addSearchTestFile(t, h.db, mediaDir, "test.jpg", database.FileTypeImage)

	tests := []struct {
		name     string
		url      string
		expected int // expected page or pageSize
	}{
		{"negative page", "/api/search?q=test&page=-1", 1},
		{"zero page", "/api/search?q=test&page=0", 1},
		{"invalid page", "/api/search?q=test&page=abc", 1},
		{"negative pageSize", "/api/search?q=test&pageSize=-10", 50},
		{"zero pageSize", "/api/search?q=test&pageSize=0", 50},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, http.NoBody)
			w := httptest.NewRecorder()

			h.Search(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected status 200, got %d", w.Code)
			}

			var result database.SearchResult
			if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			// Should use default values for invalid parameters
			if result.Page < 1 || result.PageSize < 1 {
				t.Error("invalid pagination parameters should use defaults")
			}
		})
	}
}

// TestSearchSuggestionsInvalidLimitIntegration tests suggestions with invalid limit
func TestSearchSuggestionsInvalidLimitIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	addSearchTestFile(t, h.db, mediaDir, "test.jpg", database.FileTypeImage)

	tests := []string{
		"/api/search/suggestions?q=test&limit=-5",
		"/api/search/suggestions?q=test&limit=0",
		"/api/search/suggestions?q=test&limit=abc",
	}

	for _, url := range tests {
		t.Run(url, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, url, http.NoBody)
			w := httptest.NewRecorder()

			h.SearchSuggestions(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected status 200, got %d", w.Code)
			}

			// Should use default limit for invalid values
			var suggestions []database.SearchSuggestion
			if err := json.NewDecoder(w.Body).Decode(&suggestions); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}
		})
	}
}
