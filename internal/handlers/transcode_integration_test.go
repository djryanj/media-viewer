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
// Transcode Integration Tests
// =============================================================================

// setupTranscodeIntegrationTest creates a complete handler setup for testing transcode operations
func setupTranscodeIntegrationTest(t *testing.T) (h *Handlers, cacheDir string, cleanup func()) {
	t.Helper()

	// Create temporary directories
	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"
	mediaDir := tempDir + "/media"
	cacheDir = tempDir + "/cache"

	// Create directories
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		t.Fatalf("failed to create media directory: %v", err)
	}

	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("failed to create cache directory: %v", err)
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

	return handlers, cacheDir, cleanup
}

// createCacheFile creates a file in the cache directory for testing
func createCacheFile(t *testing.T, cacheDir, filename string, size int64) {
	t.Helper()

	path := filepath.Join(cacheDir, filename)
	data := make([]byte, size)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("failed to create cache file: %v", err)
	}
}

// createCacheDir creates a directory with files in the cache directory
func createCacheDir(t *testing.T, cacheDir, dirname string, fileCount int, fileSize int64) {
	t.Helper()

	dirPath := filepath.Join(cacheDir, dirname)
	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		t.Fatalf("failed to create cache directory: %v", err)
	}

	for i := 0; i < fileCount; i++ {
		filename := filepath.Join(dirPath, "file"+string(rune('0'+i))+".tmp")
		data := make([]byte, fileSize)
		if err := os.WriteFile(filename, data, 0o644); err != nil {
			t.Fatalf("failed to create cache file in directory: %v", err)
		}
	}
}

// TestClearTranscodeCacheEmptyIntegration tests clearing an empty cache
func TestClearTranscodeCacheEmptyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if success, ok := response["success"].(bool); !ok || !success {
		t.Error("expected success to be true")
	}

	if freedBytes, ok := response["freedBytes"].(float64); !ok || freedBytes != 0 {
		t.Errorf("expected freedBytes to be 0, got %v", freedBytes)
	}
}

// TestClearTranscodeCacheWithFilesIntegration tests clearing cache with files
func TestClearTranscodeCacheWithFilesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Create test cache files
	createCacheFile(t, cacheDir, "video1.mp4", 1024)
	createCacheFile(t, cacheDir, "video2.mp4", 2048)
	createCacheFile(t, cacheDir, "video3.mp4", 512)

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if success, ok := response["success"].(bool); !ok || !success {
		t.Error("expected success to be true")
	}

	freedBytes := int64(response["freedBytes"].(float64))
	expectedBytes := int64(1024 + 2048 + 512)
	if freedBytes != expectedBytes {
		t.Errorf("expected freedBytes to be %d, got %d", expectedBytes, freedBytes)
	}

	// Verify files were deleted
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		t.Fatalf("failed to read cache directory: %v", err)
	}

	if len(entries) != 0 {
		t.Errorf("expected cache directory to be empty, got %d entries", len(entries))
	}
}

// TestClearTranscodeCacheWithDirectoriesIntegration tests clearing cache with directories
func TestClearTranscodeCacheWithDirectoriesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Create test cache directories with files
	createCacheDir(t, cacheDir, "stream1", 3, 1024)
	createCacheDir(t, cacheDir, "stream2", 2, 512)

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	freedBytes := int64(response["freedBytes"].(float64))
	expectedBytes := int64((3 * 1024) + (2 * 512))
	if freedBytes != expectedBytes {
		t.Errorf("expected freedBytes to be %d, got %d", expectedBytes, freedBytes)
	}

	// Verify directories were deleted
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		t.Fatalf("failed to read cache directory: %v", err)
	}

	if len(entries) != 0 {
		t.Errorf("expected cache directory to be empty, got %d entries", len(entries))
	}
}

// TestClearTranscodeCacheMixedContentIntegration tests clearing cache with mixed files and directories
func TestClearTranscodeCacheMixedContentIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Create mixed content
	createCacheFile(t, cacheDir, "video1.mp4", 2048)
	createCacheFile(t, cacheDir, "video2.mp4", 1024)
	createCacheDir(t, cacheDir, "stream1", 2, 512)

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	freedBytes := int64(response["freedBytes"].(float64))
	expectedBytes := int64(2048 + 1024 + (2 * 512))
	if freedBytes != expectedBytes {
		t.Errorf("expected freedBytes to be %d, got %d", expectedBytes, freedBytes)
	}

	// Verify all content was deleted
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		t.Fatalf("failed to read cache directory: %v", err)
	}

	if len(entries) != 0 {
		t.Errorf("expected cache directory to be empty, got %d entries", len(entries))
	}
}

// TestClearTranscodeCacheMethodValidationIntegration tests HTTP method validation
func TestClearTranscodeCacheMethodValidationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	tests := []struct {
		name   string
		method string
	}{
		{"GET", http.MethodGet},
		{"PUT", http.MethodPut},
		{"DELETE", http.MethodDelete},
		{"PATCH", http.MethodPatch},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/transcode/clear", http.NoBody)
			w := httptest.NewRecorder()

			h.ClearTranscodeCache(w, req)

			if w.Code != http.StatusMethodNotAllowed {
				t.Errorf("expected status 405, got %d", w.Code)
			}
		})
	}
}

// TestClearTranscodeCacheResponseStructureIntegration tests response structure
func TestClearTranscodeCacheResponseStructureIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Create some cache files
	createCacheFile(t, cacheDir, "test.mp4", 1024)

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify required fields
	if _, ok := response["success"]; !ok {
		t.Error("response missing 'success' field")
	}

	if _, ok := response["freedBytes"]; !ok {
		t.Error("response missing 'freedBytes' field")
	}

	// Verify content type
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", contentType)
	}
}

// TestClearTranscodeCacheMultipleCallsIntegration tests multiple consecutive calls
func TestClearTranscodeCacheMultipleCallsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// First call with files
	createCacheFile(t, cacheDir, "video.mp4", 2048)

	req1 := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w1 := httptest.NewRecorder()
	h.ClearTranscodeCache(w1, req1)

	if w1.Code != http.StatusOK {
		t.Errorf("first call: expected status 200, got %d", w1.Code)
	}

	var response1 map[string]interface{}
	if err := json.NewDecoder(w1.Body).Decode(&response1); err != nil {
		t.Fatalf("failed to decode first response: %v", err)
	}

	if int64(response1["freedBytes"].(float64)) != 2048 {
		t.Errorf("first call: expected 2048 bytes freed, got %v", response1["freedBytes"])
	}

	// Second call should return 0 bytes (cache is empty)
	req2 := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w2 := httptest.NewRecorder()
	h.ClearTranscodeCache(w2, req2)

	if w2.Code != http.StatusOK {
		t.Errorf("second call: expected status 200, got %d", w2.Code)
	}

	var response2 map[string]interface{}
	if err := json.NewDecoder(w2.Body).Decode(&response2); err != nil {
		t.Fatalf("failed to decode second response: %v", err)
	}

	if int64(response2["freedBytes"].(float64)) != 0 {
		t.Errorf("second call: expected 0 bytes freed, got %v", response2["freedBytes"])
	}
}

// TestClearTranscodeCacheLargeFilesIntegration tests clearing large files
func TestClearTranscodeCacheLargeFilesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Create larger cache files
	createCacheFile(t, cacheDir, "large1.mp4", 10*1024*1024) // 10MB
	createCacheFile(t, cacheDir, "large2.mp4", 5*1024*1024)  // 5MB

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	freedBytes := int64(response["freedBytes"].(float64))
	expectedBytes := int64(15 * 1024 * 1024)
	if freedBytes != expectedBytes {
		t.Errorf("expected freedBytes to be %d, got %d", expectedBytes, freedBytes)
	}

	// Verify cache is empty
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		t.Fatalf("failed to read cache directory: %v", err)
	}

	if len(entries) != 0 {
		t.Errorf("expected cache directory to be empty, got %d entries", len(entries))
	}
}

// TestClearTranscodeCacheNestedDirectoriesIntegration tests clearing nested directories
func TestClearTranscodeCacheNestedDirectoriesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Create nested directory structure
	nestedDir := filepath.Join(cacheDir, "level1", "level2", "level3")
	if err := os.MkdirAll(nestedDir, 0o755); err != nil {
		t.Fatalf("failed to create nested directory: %v", err)
	}

	// Add files at different levels
	createCacheFile(t, cacheDir, "root.mp4", 1024)
	createCacheFile(t, filepath.Join(cacheDir, "level1"), "l1.mp4", 512)
	createCacheFile(t, filepath.Join(cacheDir, "level1", "level2"), "l2.mp4", 256)
	createCacheFile(t, nestedDir, "l3.mp4", 128)

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	freedBytes := int64(response["freedBytes"].(float64))
	expectedBytes := int64(1024 + 512 + 256 + 128)
	if freedBytes != expectedBytes {
		t.Errorf("expected freedBytes to be %d, got %d", expectedBytes, freedBytes)
	}

	// Verify cache is empty
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		t.Fatalf("failed to read cache directory: %v", err)
	}

	if len(entries) != 0 {
		t.Errorf("expected cache directory to be empty, got %d entries", len(entries))
	}
}

// TestClearTranscodeCacheSpecialFilenamesIntegration tests clearing files with special names
func TestClearTranscodeCacheSpecialFilenamesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Create files with special characters
	specialFiles := []string{
		"video-with-dashes.mp4",
		"video_with_underscores.mp4",
		"video.with.dots.mp4",
		"video (with spaces).mp4",
	}

	for _, filename := range specialFiles {
		createCacheFile(t, cacheDir, filename, 1024)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	freedBytes := int64(response["freedBytes"].(float64))
	expectedBytes := int64(len(specialFiles) * 1024)
	if freedBytes != expectedBytes {
		t.Errorf("expected freedBytes to be %d, got %d", expectedBytes, freedBytes)
	}
}

// TestClearTranscodeCacheResponseFormatIntegration tests JSON response format
func TestClearTranscodeCacheResponseFormatIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	createCacheFile(t, cacheDir, "test.mp4", 4096)

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	// Verify response is valid JSON
	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}

	// Verify field types
	if _, ok := response["success"].(bool); !ok {
		t.Error("success field is not a boolean")
	}

	if _, ok := response["freedBytes"].(float64); !ok {
		t.Error("freedBytes field is not a number")
	}
}

// TestClearTranscodeCacheIdempotencyIntegration tests that multiple clears are safe
func TestClearTranscodeCacheIdempotencyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Add initial content
	createCacheFile(t, cacheDir, "video.mp4", 1024)

	// Clear multiple times
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
		w := httptest.NewRecorder()

		h.ClearTranscodeCache(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("call %d: expected status 200, got %d", i+1, w.Code)
		}

		var response map[string]interface{}
		if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
			t.Fatalf("call %d: failed to decode response: %v", i+1, err)
		}

		if i == 0 {
			// First call should free bytes
			if int64(response["freedBytes"].(float64)) != 1024 {
				t.Errorf("call %d: expected 1024 bytes freed, got %v", i+1, response["freedBytes"])
			}
		} else {
			// Subsequent calls should free nothing
			if int64(response["freedBytes"].(float64)) != 0 {
				t.Errorf("call %d: expected 0 bytes freed, got %v", i+1, response["freedBytes"])
			}
		}
	}
}

// TestClearTranscodeCacheCompleteWorkflowIntegration tests the complete workflow
func TestClearTranscodeCacheCompleteWorkflowIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Step 1: Verify empty cache returns 0
	req1 := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w1 := httptest.NewRecorder()
	h.ClearTranscodeCache(w1, req1)

	var response1 map[string]interface{}
	if err := json.NewDecoder(w1.Body).Decode(&response1); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if int64(response1["freedBytes"].(float64)) != 0 {
		t.Error("empty cache should return 0 bytes freed")
	}

	// Step 2: Add cache content
	createCacheFile(t, cacheDir, "video1.mp4", 2048)
	createCacheFile(t, cacheDir, "video2.mp4", 1024)
	createCacheDir(t, cacheDir, "stream", 2, 512)

	// Step 3: Clear cache and verify bytes freed
	req2 := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w2 := httptest.NewRecorder()
	h.ClearTranscodeCache(w2, req2)

	var response2 map[string]interface{}
	if err := json.NewDecoder(w2.Body).Decode(&response2); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	expectedBytes := int64(2048 + 1024 + (2 * 512))
	if int64(response2["freedBytes"].(float64)) != expectedBytes {
		t.Errorf("expected %d bytes freed, got %v", expectedBytes, response2["freedBytes"])
	}

	// Step 4: Verify cache is empty
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		t.Fatalf("failed to read cache directory: %v", err)
	}

	if len(entries) != 0 {
		t.Errorf("cache should be empty, found %d entries", len(entries))
	}

	// Step 5: Clear again and verify 0 bytes
	req3 := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w3 := httptest.NewRecorder()
	h.ClearTranscodeCache(w3, req3)

	var response3 map[string]interface{}
	if err := json.NewDecoder(w3.Body).Decode(&response3); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if int64(response3["freedBytes"].(float64)) != 0 {
		t.Error("second clear should return 0 bytes freed")
	}
}

// TestClearTranscodeCacheZeroByteFilesIntegration tests clearing empty files
func TestClearTranscodeCacheZeroByteFilesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cacheDir, cleanup := setupTranscodeIntegrationTest(t)
	defer cleanup()

	// Create zero-byte files
	createCacheFile(t, cacheDir, "empty1.mp4", 0)
	createCacheFile(t, cacheDir, "empty2.mp4", 0)
	createCacheFile(t, cacheDir, "nonempty.mp4", 1024)

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Only the non-empty file contributes to freed bytes
	if int64(response["freedBytes"].(float64)) != 1024 {
		t.Errorf("expected 1024 bytes freed, got %v", response["freedBytes"])
	}

	// Verify all files were deleted
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		t.Fatalf("failed to read cache directory: %v", err)
	}

	if len(entries) != 0 {
		t.Errorf("expected cache directory to be empty, got %d entries", len(entries))
	}
}
