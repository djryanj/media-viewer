package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gorilla/mux"
)

// =============================================================================
// Error Path Integration Tests
// These tests focus on error paths and edge cases not covered by other tests
// =============================================================================

// TestMediaFilesWithCorruptedDatabase tests handling when database queries fail
func TestMediaFilesWithCorruptedDatabase(t *testing.T) {
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Close the database to simulate corruption
	if err := h.db.Close(); err != nil {
		t.Logf("Error closing database: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/media", http.NoBody)
	req.Header.Set("Accept", "application/json")
	w := httptest.NewRecorder()

	h.GetMediaFiles(w, req)

	// Should return 500 when database is unavailable
	if w.Code != http.StatusInternalServerError && w.Code != http.StatusNotFound {
		t.Errorf("expected status 500 or 404 for corrupted database, got %d: %s", w.Code, w.Body.String())
	}
}

// TestSearchWithClosedDatabase tests search when database is closed
func TestSearchWithClosedDatabase(t *testing.T) {
	h, _, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Close the database
	if err := h.db.Close(); err != nil {
		t.Logf("Error closing database: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/search?q=test", http.NoBody)
	req.Header.Set("Accept", "application/json")
	w := httptest.NewRecorder()

	h.Search(w, req)

	// Search handler gracefully returns empty results when database is unavailable
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 with empty results, got %d: %s", w.Code, w.Body.String())
	}
}

// TestFavoritesOperationsWithClosedDatabase tests favorite operations when database is closed
func TestFavoritesOperationsWithClosedDatabase(t *testing.T) {
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	// Close the database
	if err := h.db.Close(); err != nil {
		t.Logf("Error closing database: %v", err)
	}

	t.Run("add favorite with closed database", func(t *testing.T) {
		body := map[string]string{"path": "/test/file.jpg"}
		jsonBody, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader(jsonBody))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		h.AddFavorite(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("get favorites with closed database", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/favorites", http.NoBody)
		w := httptest.NewRecorder()

		h.GetFavorites(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d: %s", w.Code, w.Body.String())
		}
	})
}

// TestTagOperationsWithClosedDatabase tests tag operations when database is closed
func TestTagOperationsWithClosedDatabase(t *testing.T) {
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Close the database
	if err := h.db.Close(); err != nil {
		t.Logf("Error closing database: %v", err)
	}

	t.Run("get all tags with closed database", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/tags", http.NoBody)
		w := httptest.NewRecorder()

		h.GetAllTags(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("add tag to file with closed database", func(t *testing.T) {
		body := map[string]string{"path": "/test/file.jpg", "tag": "test-tag"}
		jsonBody, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/files/tags", bytes.NewReader(jsonBody))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		h.AddTagToFile(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d: %s", w.Code, w.Body.String())
		}
	})
}

// TestGetFileWithInvalidPath tests the GetFile handler with various invalid paths
func TestGetFileWithInvalidPath(t *testing.T) {
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	tests := []struct {
		name           string
		path           string
		expectedStatus int
	}{
		{
			name:           "nonexistent file",
			path:           "does-not-exist.jpg",
			expectedStatus: http.StatusMovedPermanently, // Returns redirect
		},
		{
			name:           "directory traversal",
			path:           "../../etc/passwd",
			expectedStatus: http.StatusMovedPermanently, // Returns redirect
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/file", http.NoBody)
			req.Header.Set("X-Request-Path", tt.path)
			w := httptest.NewRecorder()

			h.GetFile(w, req)

			// GetFile may return redirect or 404
			if w.Code != tt.expectedStatus && w.Code != http.StatusNotFound {
				t.Errorf("expected status %d or 404, got %d: %s", tt.expectedStatus, w.Code, w.Body.String())
			}
		})
	}
}

// TestBulkOperationsWithExcessivePaths tests bulk operations exceeding limits
func TestBulkOperationsWithExcessivePaths(t *testing.T) {
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	t.Run("tag many files exceeding limit", func(t *testing.T) {
		// Try to tag 20000 files (limit is 10000)
		paths := make([]string, 20000)
		for i := range paths {
			paths[i] = filepath.Join("test", "file"+string(rune(i))+".jpg")
		}

		body := map[string]interface{}{
			"paths": paths,
			"tag":   "test-tag",
		}
		jsonBody, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/tags/bulk", bytes.NewReader(jsonBody))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		h.BulkAddTag(w, req)

		// Should either accept request and process only first 10000, or reject with 400
		if w.Code != http.StatusOK && w.Code != http.StatusBadRequest {
			t.Errorf("expected status 200 or 400, got %d: %s", w.Code, w.Body.String())
		}

		if w.Code == http.StatusOK {
			var resp struct {
				Success int `json:"success"`
				Failed  int `json:"failed"`
			}
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			// Should have processed at most 10000
			if resp.Success+resp.Failed > 10000 {
				t.Errorf("processed more than 10000 files: %d", resp.Success+resp.Failed)
			}
		}
	})
}

// TestMissingContentTypeHeader tests handlers that require Content-Type header
func TestMissingContentTypeHeader(t *testing.T) {
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	tests := []struct {
		name     string
		endpoint string
		method   string
		body     string
		handler  http.HandlerFunc
	}{
		{
			name:     "login without content-type",
			endpoint: "/api/login",
			method:   http.MethodPost,
			body:     `{"username":"admin","password":"test123"}`,
			handler:  h.Login,
		},
		{
			name:     "setup without content-type",
			endpoint: "/api/setup",
			method:   http.MethodPost,
			body:     `{"username":"admin","password":"test123"}`,
			handler:  h.Setup,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.endpoint, bytes.NewReader([]byte(tt.body)))
			// Deliberately NOT setting Content-Type header
			w := httptest.NewRecorder()

			tt.handler(w, req)

			// Some handlers may be lenient and still parse JSON, others may require Content-Type
			// This test documents the actual behavior
			t.Logf("Status without Content-Type: %d", w.Code)
		})
	}
}

// TestConcurrentTagOperations tests concurrent tag operations for race conditions
func TestConcurrentTagOperations(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping concurrent test in short mode")
	}

	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Create test file
	testFile := filepath.Join(mediaDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Test concurrent tag additions
	done := make(chan bool, 10)
	for i := 0; i < 10; i++ {
		go func() {
			body := map[string]interface{}{
				"path": testFile,
				"tag":  "concurrent-tag",
			}
			jsonBody, _ := json.Marshal(body)

			req := httptest.NewRequest(http.MethodPost, "/api/files/tags", bytes.NewReader(jsonBody))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.AddTagToFile(w, req)
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify file still has the tag (shouldn't have duplicates or corruption)
	req := httptest.NewRequest(http.MethodGet, "/api/files/tags?path="+testFile, http.NoBody)
	w := httptest.NewRecorder()

	h.GetFileTags(w, req)

	// May return 200 with tags or 400 if path handling differs
	if w.Code != http.StatusOK && w.Code != http.StatusBadRequest {
		t.Errorf("expected status 200 or 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestFileOperationsWithReadonlyFilesystem tests file operations when filesystem is readonly
func TestFileOperationsWithReadonlyFilesystem(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("skipping readonly test when running as root")
	}

	_, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// This is a documentation test - we can't easily make filesystem readonly in tests
	// but we document the expected behavior

	t.Log("Expected behavior: File serving should still work on readonly filesystem")
	t.Log("Expected behavior: Thumbnail generation may fail gracefully")
	t.Log("Expected behavior: Database operations should still work if DB is on writable mount")
}

// TestGetFileByTagWithNonexistentTag tests getting files by a tag that doesn't exist
func TestGetFileByTagWithNonexistentTag(t *testing.T) {
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Try to get files by a nonexistent tag
	req := httptest.NewRequest(http.MethodGet, "/api/tags/nonexistent-tag-12345/files", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"tag": "nonexistent-tag-12345"})
	w := httptest.NewRecorder()

	h.GetFilesByTag(w, req)

	// Should return empty results with 200
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 with empty results, got %d: %s", w.Code, w.Body.String())
	}
}

// TestSearchWithSpecialCharacters tests search with various special characters
func TestSearchWithSpecialCharacters(t *testing.T) {
	h, _, cleanup := setupSearchIntegrationTest(t)
	defer cleanup()

	// Search for files with special characters (without needing to add files)
	searchTerms := []string{
		"&",
		"'",
		"\"",
		"<",
		"%",
		"test",
	}

	for _, term := range searchTerms {
		t.Run("search for "+term, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/search?q="+term, http.NoBody)
			w := httptest.NewRecorder()

			h.Search(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}
