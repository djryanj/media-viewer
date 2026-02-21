package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"

	"github.com/gorilla/mux"
)

// =============================================================================
// Tags Integration Tests
// =============================================================================

// setupTagsIntegrationTest creates a complete handler setup for testing tags
func setupTagsIntegrationTest(t *testing.T) (h *Handlers, mediaDir string, cleanup func()) {
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
	dbOpts := &database.Options{
		MmapDisabled: false, // Set to true if you want to disable mmap
	}
	db, _, err := database.New(context.Background(), dbPath, dbOpts)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	// Create indexer
	idx := indexer.New(db, mediaDir, 0)

	// Create transcoder
	trans := transcoder.New(cacheDir, "", false, "none")

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

// addTagTestFile creates a file and adds it to the database for tag tests
func addTagTestFile(t *testing.T, db *database.Database, mediaDir, relPath string, fileType database.FileType) {
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
	ctx := context.Background()
	// Insert into database
	tx, err := db.BeginBatch(ctx)
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

	if err := db.UpsertFile(ctx, tx, mediaFile); err != nil {
		t.Fatalf("failed to insert file: %v", err)
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("failed to commit transaction: %v", err)
	}
}

// TestGetAllTagsEmptyIntegration tests getting all tags when none exist
func TestGetAllTagsEmptyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/tags", http.NoBody)
	w := httptest.NewRecorder()

	h.GetAllTags(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var tags []database.Tag
	if err := json.NewDecoder(w.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should return empty array, not null
	if tags == nil {
		t.Error("expected empty array, got nil")
	}

	if len(tags) != 0 {
		t.Errorf("expected 0 tags, got %d", len(tags))
	}
}

// TestGetAllTagsWithTagsIntegration tests getting all tags
func TestGetAllTagsWithTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)

	// Add tags
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo.jpg", "vacation"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}
	if err := h.db.AddTagToFile(ctx, "photo.jpg", "summer"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/tags", http.NoBody)
	w := httptest.NewRecorder()

	h.GetAllTags(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var tags []database.Tag
	if err := json.NewDecoder(w.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(tags) != 2 {
		t.Errorf("expected 2 tags, got %d", len(tags))
	}

	// Verify content type
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", contentType)
	}
}

// TestGetFileTagsIntegration tests getting tags for a specific file
func TestGetFileTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)

	// Add tags
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo.jpg", "vacation"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/files/tags?path=photo.jpg", http.NoBody)
	w := httptest.NewRecorder()

	h.GetFileTags(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var tags []string
	if err := json.NewDecoder(w.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(tags) != 1 {
		t.Errorf("expected 1 tag, got %d", len(tags))
	}

	if tags[0] != "vacation" {
		t.Errorf("expected tag 'vacation', got %q", tags[0])
	}
}

// TestGetFileTagsMissingPathIntegration tests getting tags without path parameter
func TestGetFileTagsMissingPathIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/files/tags", http.NoBody)
	w := httptest.NewRecorder()

	h.GetFileTags(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// TestGetFileTagsNoTagsIntegration tests getting tags for file with no tags
func TestGetFileTagsNoTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file but no tags
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)

	req := httptest.NewRequest(http.MethodGet, "/api/files/tags?path=photo.jpg", http.NoBody)
	w := httptest.NewRecorder()

	h.GetFileTags(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var tags []string
	if err := json.NewDecoder(w.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should return empty array, not null
	if tags == nil {
		t.Error("expected empty array, got nil")
	}

	if len(tags) != 0 {
		t.Errorf("expected 0 tags, got %d", len(tags))
	}
}

// TestGetBatchFileTagsIntegration tests getting tags for multiple files
func TestGetBatchFileTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test files
	addTagTestFile(t, h.db, mediaDir, "photo1.jpg", database.FileTypeImage)
	addTagTestFile(t, h.db, mediaDir, "photo2.jpg", database.FileTypeImage)

	// Add tags
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo1.jpg", "vacation"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}
	if err := h.db.AddTagToFile(ctx, "photo2.jpg", "family"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	reqBody := BatchTagsRequest{
		Paths: []string{"photo1.jpg", "photo2.jpg"},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/files/tags/batch", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.GetBatchFileTags(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result map[string][]string
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(result) != 2 {
		t.Errorf("expected 2 files with tags, got %d", len(result))
	}

	if result["photo1.jpg"][0] != "vacation" {
		t.Errorf("expected tag 'vacation' for photo1, got %q", result["photo1.jpg"][0])
	}
}

// TestGetBatchFileTagsEmptyPathsIntegration tests batch get with empty paths
func TestGetBatchFileTagsEmptyPathsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	reqBody := BatchTagsRequest{
		Paths: []string{},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/files/tags/batch", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.GetBatchFileTags(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// TestGetBatchFileTagsMaxLimitIntegration tests batch get with max paths limit
func TestGetBatchFileTagsMaxLimitIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Create more than 100 paths
	paths := make([]string, 150)
	for i := 0; i < 150; i++ {
		paths[i] = "file" + string(rune('0'+i)) + ".jpg"
	}

	// Add a few test files with tags
	addTagTestFile(t, h.db, mediaDir, "file1.jpg", database.FileTypeImage)
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "file1.jpg", "test"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	reqBody := BatchTagsRequest{
		Paths: paths,
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/files/tags/batch", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.GetBatchFileTags(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Should handle gracefully - 150 paths is within the 10000 limit
	var result map[string][]string
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
}

// TestAddTagToFileIntegration tests adding a tag to a file
func TestAddTagToFileIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)

	reqBody := TagRequest{
		Path: "photo.jpg",
		Tag:  "vacation",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/files/tags/add", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.AddTagToFile(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify tag was added
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	tags, err := h.db.GetFileTags(ctx, "photo.jpg")
	if err != nil {
		t.Fatalf("failed to get tags: %v", err)
	}

	if len(tags) != 1 {
		t.Errorf("expected 1 tag, got %d", len(tags))
	}

	if tags[0] != "vacation" {
		t.Errorf("expected tag 'vacation', got %q", tags[0])
	}
}

// TestAddTagToFileMissingFieldsIntegration tests adding tag with missing fields
func TestAddTagToFileMissingFieldsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	tests := []struct {
		name string
		req  TagRequest
	}{
		{"missing path", TagRequest{Tag: "vacation"}},
		{"missing tag", TagRequest{Path: "photo.jpg"}},
		{"both missing", TagRequest{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.req)

			req := httptest.NewRequest(http.MethodPost, "/api/files/tags/add", bytes.NewReader(body))
			w := httptest.NewRecorder()

			h.AddTagToFile(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("expected status 400, got %d", w.Code)
			}
		})
	}
}

// TestRemoveTagFromFileIntegration tests removing a tag from a file
func TestRemoveTagFromFileIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file and tag
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo.jpg", "vacation"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	reqBody := TagRequest{
		Path: "photo.jpg",
		Tag:  "vacation",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/files/tags/remove", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.RemoveTagFromFile(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify tag was removed
	tags, err := h.db.GetFileTags(ctx, "photo.jpg")
	if err != nil {
		t.Fatalf("failed to get tags: %v", err)
	}

	if len(tags) != 0 {
		t.Errorf("expected 0 tags, got %d", len(tags))
	}
}

// TestBulkAddTagIntegration tests adding a tag to multiple files
func TestBulkAddTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test files
	addTagTestFile(t, h.db, mediaDir, "photo1.jpg", database.FileTypeImage)
	addTagTestFile(t, h.db, mediaDir, "photo2.jpg", database.FileTypeImage)
	addTagTestFile(t, h.db, mediaDir, "photo3.jpg", database.FileTypeImage)

	reqBody := BulkTagRequest{
		Paths: []string{"photo1.jpg", "photo2.jpg", "photo3.jpg"},
		Tag:   "vacation",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/tags/bulk/add", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.BulkAddTag(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response BulkTagResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Success != 3 {
		t.Errorf("expected 3 successful, got %d", response.Success)
	}

	if response.Failed != 0 {
		t.Errorf("expected 0 failed, got %d", response.Failed)
	}

	if response.Errors != nil {
		t.Errorf("expected nil errors, got %v", response.Errors)
	}
}

// TestBulkAddTagPartialFailureIntegration tests bulk add with some failures
func TestBulkAddTagPartialFailureIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add only one test file
	addTagTestFile(t, h.db, mediaDir, "photo1.jpg", database.FileTypeImage)

	reqBody := BulkTagRequest{
		Paths: []string{"photo1.jpg", "nonexistent.jpg"},
		Tag:   "vacation",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/tags/bulk/add", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.BulkAddTag(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response BulkTagResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Success < 1 {
		t.Errorf("expected at least 1 successful, got %d", response.Success)
	}
}

// TestBulkRemoveTagIntegration tests removing a tag from multiple files
func TestBulkRemoveTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test files and tags
	addTagTestFile(t, h.db, mediaDir, "photo1.jpg", database.FileTypeImage)
	addTagTestFile(t, h.db, mediaDir, "photo2.jpg", database.FileTypeImage)

	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo1.jpg", "vacation"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}
	if err := h.db.AddTagToFile(ctx, "photo2.jpg", "vacation"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	reqBody := BulkTagRequest{
		Paths: []string{"photo1.jpg", "photo2.jpg"},
		Tag:   "vacation",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/tags/bulk/remove", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.BulkRemoveTag(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response BulkTagResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Success != 2 {
		t.Errorf("expected 2 successful, got %d", response.Success)
	}

	if response.Failed != 0 {
		t.Errorf("expected 0 failed, got %d", response.Failed)
	}
}

// TestSetFileTagsIntegration tests replacing all tags for a file
func TestSetFileTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file with initial tags
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo.jpg", "old"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	reqBody := TagRequest{
		Path: "photo.jpg",
		Tags: []string{"new1", "new2"},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/files/tags/set", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.SetFileTags(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify tags were replaced
	tags, err := h.db.GetFileTags(ctx, "photo.jpg")
	if err != nil {
		t.Fatalf("failed to get tags: %v", err)
	}

	if len(tags) != 2 {
		t.Errorf("expected 2 tags, got %d", len(tags))
	}
}

// TestSetFileTagsEmptyIntegration tests setting empty tags (clear all)
func TestSetFileTagsEmptyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file with tags
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo.jpg", "old"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	reqBody := TagRequest{
		Path: "photo.jpg",
		Tags: []string{},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/files/tags/set", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.SetFileTags(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify all tags were cleared
	tags, err := h.db.GetFileTags(ctx, "photo.jpg")
	if err != nil {
		t.Fatalf("failed to get tags: %v", err)
	}

	if len(tags) != 0 {
		t.Errorf("expected 0 tags, got %d", len(tags))
	}
}

// TestGetFilesByTagIntegration tests getting files with a specific tag
func TestGetFilesByTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test files
	addTagTestFile(t, h.db, mediaDir, "photo1.jpg", database.FileTypeImage)
	addTagTestFile(t, h.db, mediaDir, "photo2.jpg", database.FileTypeImage)

	// Add tag to files
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo1.jpg", "vacation"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}
	if err := h.db.AddTagToFile(ctx, "photo2.jpg", "vacation"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/tags/vacation/files", http.NoBody)
	w := httptest.NewRecorder()

	// Set up mux vars
	req = mux.SetURLVars(req, map[string]string{"tag": "vacation"})

	h.GetFilesByTag(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	items, ok := result["items"].([]interface{})
	if !ok {
		t.Fatal("expected items array in response")
	}

	if len(items) != 2 {
		t.Errorf("expected 2 files, got %d", len(items))
	}
}

// TestDeleteTagIntegration tests deleting a tag entirely
func TestDeleteTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file and tag
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo.jpg", "vacation"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/tags/vacation", http.NoBody)
	w := httptest.NewRecorder()

	// Set up mux vars
	req = mux.SetURLVars(req, map[string]string{"tag": "vacation"})

	h.DeleteTag(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify tag was deleted
	tags, err := h.db.GetAllTags(ctx)
	if err != nil {
		t.Fatalf("failed to get tags: %v", err)
	}

	if len(tags) != 0 {
		t.Errorf("expected 0 tags, got %d", len(tags))
	}
}

// TestRenameTagIntegration tests renaming a tag
func TestRenameTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file and tag
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)
	ctx := httptest.NewRequest(http.MethodGet, "/", http.NoBody).Context()
	if err := h.db.AddTagToFile(ctx, "photo.jpg", "old-name"); err != nil {
		t.Fatalf("failed to add tag: %v", err)
	}

	reqBody := TagRequest{
		NewName: "new-name",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPut, "/api/tags/old-name", bytes.NewReader(body))
	w := httptest.NewRecorder()

	// Set up mux vars
	req = mux.SetURLVars(req, map[string]string{"tag": "old-name"})

	h.RenameTag(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify tag was renamed
	tags, err := h.db.GetFileTags(ctx, "photo.jpg")
	if err != nil {
		t.Fatalf("failed to get tags: %v", err)
	}

	if len(tags) != 1 {
		t.Fatalf("expected 1 tag, got %d", len(tags))
	}

	if tags[0] != "new-name" {
		t.Errorf("expected tag 'new-name', got %q", tags[0])
	}
}

// TestCompleteTagsFlowIntegration tests the complete tags workflow
func TestCompleteTagsFlowIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test files
	addTagTestFile(t, h.db, mediaDir, "photo1.jpg", database.FileTypeImage)
	addTagTestFile(t, h.db, mediaDir, "photo2.jpg", database.FileTypeImage)

	// Step 1: Add tags to files
	reqBody := BulkTagRequest{
		Paths: []string{"photo1.jpg", "photo2.jpg"},
		Tag:   "vacation",
	}
	body, _ := json.Marshal(reqBody)

	addReq := httptest.NewRequest(http.MethodPost, "/api/tags/bulk/add", bytes.NewReader(body))
	addW := httptest.NewRecorder()
	h.BulkAddTag(addW, addReq)

	if addW.Code != http.StatusOK {
		t.Fatalf("bulk add failed: %d", addW.Code)
	}

	// Step 2: Get all tags
	listReq := httptest.NewRequest(http.MethodGet, "/api/tags", http.NoBody)
	listW := httptest.NewRecorder()
	h.GetAllTags(listW, listReq)

	if listW.Code != http.StatusOK {
		t.Fatalf("get all tags failed: %d", listW.Code)
	}

	var tags []database.Tag
	if err := json.NewDecoder(listW.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode tags: %v", err)
	}

	if len(tags) != 1 {
		t.Fatalf("expected 1 tag, got %d", len(tags))
	}

	// Step 3: Get files by tag
	filesReq := httptest.NewRequest(http.MethodGet, "/api/tags/vacation/files", http.NoBody)
	filesW := httptest.NewRecorder()
	filesReq = mux.SetURLVars(filesReq, map[string]string{"tag": "vacation"})
	h.GetFilesByTag(filesW, filesReq)

	if filesW.Code != http.StatusOK {
		t.Fatalf("get files by tag failed: %d", filesW.Code)
	}

	// Step 4: Remove tag from one file
	removeBody := TagRequest{
		Path: "photo1.jpg",
		Tag:  "vacation",
	}
	body, _ = json.Marshal(removeBody)

	removeReq := httptest.NewRequest(http.MethodPost, "/api/files/tags/remove", bytes.NewReader(body))
	removeW := httptest.NewRecorder()
	h.RemoveTagFromFile(removeW, removeReq)

	if removeW.Code != http.StatusOK {
		t.Fatalf("remove tag failed: %d", removeW.Code)
	}
}

// TestBulkAddTagEmptyPathsIntegration tests bulk add with empty paths
func TestBulkAddTagEmptyPathsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	reqBody := BulkTagRequest{
		Paths: []string{},
		Tag:   "vacation",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/tags/bulk/add", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.BulkAddTag(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// TestBulkAddTagMissingTagIntegration tests bulk add with missing tag
func TestBulkAddTagMissingTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	reqBody := BulkTagRequest{
		Paths: []string{"photo.jpg"},
		Tag:   "",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/tags/bulk/add", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.BulkAddTag(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// TestBulkOperationsSkipEmptyPathsIntegration tests that bulk operations skip empty paths
func TestBulkOperationsSkipEmptyPathsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)

	reqBody := BulkTagRequest{
		Paths: []string{"photo.jpg", "", "nonexistent.jpg"},
		Tag:   "vacation",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/tags/bulk/add", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.BulkAddTag(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response BulkTagResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should succeed for both valid and nonexistent paths (database allows tagging non-indexed files)
	// Empty path should be skipped, so 2 operations succeed (photo.jpg and nonexistent.jpg)
	if response.Success != 2 {
		t.Errorf("expected 2 successful (empty paths skipped), got %d", response.Success)
	}

	if response.Failed != 0 {
		t.Errorf("expected 0 failed, got %d", response.Failed)
	}
}

// TestRenameTagMissingNameIntegration tests renaming without new name
func TestRenameTagMissingNameIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	reqBody := TagRequest{
		NewName: "",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPut, "/api/tags/old", bytes.NewReader(body))
	w := httptest.NewRecorder()

	req = mux.SetURLVars(req, map[string]string{"tag": "old"})

	h.RenameTag(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// TestContentTypeHeadersIntegration tests that all responses have proper content types
func TestContentTypeHeadersIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	tests := []struct {
		name    string
		handler func(http.ResponseWriter, *http.Request)
		method  string
		url     string
	}{
		{"GetAllTags", h.GetAllTags, http.MethodGet, "/api/tags"},
		{"GetFileTags", h.GetFileTags, http.MethodGet, "/api/files/tags?path=test.jpg"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.url, http.NoBody)
			w := httptest.NewRecorder()

			tt.handler(w, req)

			contentType := w.Header().Get("Content-Type")
			if contentType != "application/json" {
				t.Errorf("expected Content-Type application/json, got %q", contentType)
			}
		})
	}
}

// TestBulkAddTagLargeScaleIntegration tests bulk tag add with many files (stress test)
func TestBulkAddTagLargeScaleIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add many files to database
	paths := make([]string, 10000)
	for i := 0; i < 10000; i++ {
		path := fmt.Sprintf("photos/image%04d.jpg", i)
		paths[i] = path
		addTagTestFile(t, h.db, h.mediaDir, path, database.FileTypeImage)
	}

	// Bulk tag all of them
	body, err := json.Marshal(map[string]interface{}{
		"tag":   "vacation",
		"paths": paths,
	})
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/tags/bulk", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkAddTag(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// BulkTagResponse has success/failed counts, not a results array
	successCount, ok := response["success"].(float64)
	if !ok {
		t.Fatal("expected 'success' field in response")
	}

	failedCount, ok := response["failed"].(float64)
	if !ok {
		t.Fatal("expected 'failed' field in response")
	}

	// Handler limits to 10000 paths max, so only first 10000 should be processed
	if int(successCount) != 10000 {
		t.Errorf("expected 10000 successes (handler max limit), got %d successes and %d failures", int(successCount), int(failedCount))
	}

	if int(failedCount) != 0 {
		t.Errorf("expected no failures, got %d", int(failedCount))
	}
}

// TestTagsWithUnicodeNamesIntegration tests tags with Unicode characters
func TestTagsWithUnicodeNamesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	testCases := []struct {
		name    string
		tagName string
		color   string
	}{
		{"Japanese", "写真", "#FF0000"},
		{"Chinese", "图片", "#00FF00"},
		{"Russian", "фото", "#0000FF"},
		{"Arabic", "صورة", "#FFFF00"},
		{"Emoji", "📷photos", "#FF00FF"},
		{"Mixed", "My Photos 写真 🎨", "#00FFFF"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Add a test file
			addTagTestFile(t, h.db, mediaDir, "test.jpg", database.FileTypeImage)

			// Add tag to file
			body, err := json.Marshal(map[string]interface{}{
				"path":  "test.jpg",
				"tag":   tc.tagName,
				"color": tc.color,
			})
			if err != nil {
				t.Fatalf("failed to marshal request: %v", err)
			}

			req := httptest.NewRequest(http.MethodPost, "/api/files/tags", strings.NewReader(string(body)))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.AddTagToFile(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
			}

			// Verify tag was added
			req2 := httptest.NewRequest(http.MethodGet, "/api/files/tags?path=test.jpg", http.NoBody)
			w2 := httptest.NewRecorder()

			h.GetFileTags(w2, req2)

			if w2.Code != http.StatusOK {
				t.Errorf("get tags failed: expected status 200, got %d", w2.Code)
			}

			// GetFileTags returns []string, not []database.Tag
			var tags []string
			if err := json.NewDecoder(w2.Body).Decode(&tags); err != nil {
				t.Fatalf("failed to decode tags: %v", err)
			}

			found := false
			for _, tagName := range tags {
				if tagName == tc.tagName {
					found = true
					break
				}
			}

			if !found {
				t.Errorf("tag %s not found in file tags", tc.tagName)
			}
		})
	}
}

// TestBulkRemoveTagPartialFailureIntegration tests bulk remove with some invalid paths
func TestBulkRemoveTagPartialFailureIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add valid files and tag them
	validPaths := []string{"photo1.jpg", "photo2.jpg", "photo3.jpg"}
	for _, path := range validPaths {
		addTagTestFile(t, h.db, mediaDir, path, database.FileTypeImage)
		ctx := context.Background()
		if err := h.db.AddTagToFile(ctx, path, "vacation"); err != nil {
			t.Fatalf("failed to add tag: %v", err)
		}
	}

	// Mix valid and non-existent paths
	mixedPaths := []string{
		"photo1.jpg",       // valid
		"nonexistent.jpg",  // invalid
		"photo2.jpg",       // valid
		"another-fake.jpg", // invalid
		"photo3.jpg",       // valid
	}

	body, err := json.Marshal(map[string]interface{}{
		"tag":   "vacation",
		"paths": mixedPaths,
	})
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/tags/bulk-remove", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkRemoveTag(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// BulkTagResponse has success/failed counts, not a results array
	successCount, ok := response["success"].(float64)
	if !ok {
		t.Fatal("expected 'success' field in response")
	}

	failedCount, ok := response["failed"].(float64)
	if !ok {
		t.Fatal("expected 'failed' field in response")
	}

	// All 5 paths should succeed - removing tags from nonexistent files is a no-op (success)
	if int(successCount) != 5 {
		t.Errorf("expected 5 successful removals (no-op for nonexistent files), got %d", int(successCount))
	}

	if int(failedCount) != 0 {
		t.Errorf("expected 0 failures, got %d", int(failedCount))
	}
}

// TestGetAllTagsWithCountsIntegration tests getting all tags with usage counts
func TestGetAllTagsWithCountsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test files
	addTagTestFile(t, h.db, mediaDir, "photo1.jpg", database.FileTypeImage)
	addTagTestFile(t, h.db, mediaDir, "photo2.jpg", database.FileTypeImage)
	addTagTestFile(t, h.db, mediaDir, "photo3.jpg", database.FileTypeImage)

	// Add tags
	ctx := context.Background()
	_ = h.db.AddTagToFile(ctx, "photo1.jpg", "vacation")
	_ = h.db.AddTagToFile(ctx, "photo2.jpg", "vacation")
	_ = h.db.AddTagToFile(ctx, "photo3.jpg", "summer")

	req := httptest.NewRequest(http.MethodGet, "/api/tags/stats", http.NoBody)
	w := httptest.NewRecorder()

	h.GetAllTagsWithCounts(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var tags []database.TagWithCount
	if err := json.NewDecoder(w.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(tags))
	}

	// Verify sorting (by count desc)
	if tags[0].Name != "vacation" || tags[0].Count != 2 {
		t.Errorf("expected first tag to be 'vacation' with count 2, got '%s' with count %d", tags[0].Name, tags[0].Count)
	}

	if tags[1].Name != "summer" || tags[1].Count != 1 {
		t.Errorf("expected second tag to be 'summer' with count 1, got '%s' with count %d", tags[1].Name, tags[1].Count)
	}

	// Verify content type
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", contentType)
	}
}

// TestGetAllTagsWithCountsEmptyIntegration tests getting tags with counts when none exist
func TestGetAllTagsWithCountsEmptyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, _, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/tags/stats", http.NoBody)
	w := httptest.NewRecorder()

	h.GetAllTagsWithCounts(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var tags []database.TagWithCount
	if err := json.NewDecoder(w.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should return empty array, not null
	if tags == nil {
		t.Error("expected empty array, got nil")
	}

	if len(tags) != 0 {
		t.Errorf("expected 0 tags, got %d", len(tags))
	}
}

// TestGetUnusedTagsIntegration tests getting unused tags
func TestGetUnusedTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Add test file
	addTagTestFile(t, h.db, mediaDir, "photo.jpg", database.FileTypeImage)

	// Create used and unused tags
	ctx := context.Background()
	_ = h.db.AddTagToFile(ctx, "photo.jpg", "used")
	_, _ = h.db.GetOrCreateTag(ctx, "unused1")
	_, _ = h.db.GetOrCreateTag(ctx, "unused2")

	req := httptest.NewRequest(http.MethodGet, "/api/tags/unused", http.NoBody)
	w := httptest.NewRecorder()

	h.GetUnusedTags(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var tags []string
	if err := json.NewDecoder(w.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(tags) != 2 {
		t.Fatalf("expected 2 unused tags, got %d", len(tags))
	}

	// Verify unused tags are in the list
	hasUnused1 := false
	hasUnused2 := false
	hasUsed := false

	for _, tagName := range tags {
		if tagName == "unused1" {
			hasUnused1 = true
		}
		if tagName == "unused2" {
			hasUnused2 = true
		}
		if tagName == "used" {
			hasUsed = true
		}
	}

	if !hasUnused1 || !hasUnused2 {
		t.Error("Expected both unused1 and unused2 in unused tags list")
	}

	if hasUsed {
		t.Error("Used tag should not be in unused tags list")
	}
}

// TestRenameTagEverywhereIntegration tests renaming tags
func TestRenameTagEverywhereIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Test case 1: Simple rename
	t.Run("Simple rename", func(t *testing.T) {
		addTagTestFile(t, h.db, mediaDir, "rename1.jpg", database.FileTypeImage)
		addTagTestFile(t, h.db, mediaDir, "rename2.jpg", database.FileTypeImage)

		ctx := context.Background()
		_ = h.db.AddTagToFile(ctx, "rename1.jpg", "oldname")
		_ = h.db.AddTagToFile(ctx, "rename2.jpg", "oldname")

		body, _ := json.Marshal(map[string]string{"newName": "newname"})
		req := httptest.NewRequest(http.MethodPost, "/api/tags/oldname/rename", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = mux.SetURLVars(req, map[string]string{"tag": "oldname"})
		w := httptest.NewRecorder()

		h.RenameTagEverywhere(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}

		var response map[string]interface{}
		if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if response["status"] != "ok" {
			t.Errorf("expected status ok, got %v", response["status"])
		}

		affectedFiles, ok := response["affectedFiles"].(float64)
		if !ok || int(affectedFiles) != 2 {
			t.Errorf("expected 2 affected files, got %v", response["affectedFiles"])
		}

		// Verify files have new tag
		tags, _ := h.db.GetFileTags(ctx, "rename1.jpg")
		if len(tags) != 1 || tags[0] != "newname" {
			t.Errorf("expected file to have tag 'newname', got %v", tags)
		}
	})

	// Test case 2: Missing tag name
	t.Run("Missing tag name", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"newName": "test"})
		req := httptest.NewRequest(http.MethodPost, "/api/tags//rename", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = mux.SetURLVars(req, map[string]string{"tag": ""})
		w := httptest.NewRecorder()

		h.RenameTagEverywhere(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	// Test case 3: Missing new name
	t.Run("Missing new name", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{})
		req := httptest.NewRequest(http.MethodPost, "/api/tags/oldname/rename", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = mux.SetURLVars(req, map[string]string{"tag": "oldname"})
		w := httptest.NewRecorder()

		h.RenameTagEverywhere(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	// Test case 4: Invalid JSON
	t.Run("Invalid JSON", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/tags/test/rename", strings.NewReader("invalid json"))
		req.Header.Set("Content-Type", "application/json")
		req = mux.SetURLVars(req, map[string]string{"tag": "test"})
		w := httptest.NewRecorder()

		h.RenameTagEverywhere(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	// Test case 5: Case-only change
	t.Run("Case-only change", func(t *testing.T) {
		addTagTestFile(t, h.db, mediaDir, "case.jpg", database.FileTypeImage)

		ctx := context.Background()
		_ = h.db.AddTagToFile(ctx, "case.jpg", "lowercase")

		body, _ := json.Marshal(map[string]string{"newName": "LowerCase"})
		req := httptest.NewRequest(http.MethodPost, "/api/tags/lowercase/rename", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = mux.SetURLVars(req, map[string]string{"tag": "lowercase"})
		w := httptest.NewRecorder()

		h.RenameTagEverywhere(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}

		// Verify case has changed
		tags, _ := h.db.GetFileTags(ctx, "case.jpg")
		if len(tags) != 1 || tags[0] != "LowerCase" {
			t.Errorf("expected file to have tag 'LowerCase', got %v", tags)
		}
	})
}

// TestDeleteTagEverywhereIntegration tests deleting tags
func TestDeleteTagEverywhereIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, mediaDir, cleanup := setupTagsIntegrationTest(t)
	defer cleanup()

	// Test case 1: Delete tag with file associations
	t.Run("Delete tag with files", func(t *testing.T) {
		addTagTestFile(t, h.db, mediaDir, "del1.jpg", database.FileTypeImage)
		addTagTestFile(t, h.db, mediaDir, "del2.jpg", database.FileTypeImage)

		ctx := context.Background()
		_ = h.db.AddTagToFile(ctx, "del1.jpg", "deleteme")
		_ = h.db.AddTagToFile(ctx, "del2.jpg", "deleteme")

		req := httptest.NewRequest(http.MethodDelete, "/api/tags/deleteme/delete", http.NoBody)
		req = mux.SetURLVars(req, map[string]string{"tag": "deleteme"})
		w := httptest.NewRecorder()

		h.DeleteTagEverywhere(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}

		var response map[string]interface{}
		if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if response["status"] != "ok" {
			t.Errorf("expected status ok, got %v", response["status"])
		}

		affectedFiles, ok := response["affectedFiles"].(float64)
		if !ok || int(affectedFiles) != 2 {
			t.Errorf("expected 2 affected files, got %v", response["affectedFiles"])
		}

		// Verify tag is deleted from files
		tags, _ := h.db.GetFileTags(ctx, "del1.jpg")
		if len(tags) != 0 {
			t.Errorf("expected file to have no tags, got %v", tags)
		}
	})

	// Test case 2: Delete unused tag
	t.Run("Delete unused tag", func(t *testing.T) {
		ctx := context.Background()
		_, _ = h.db.GetOrCreateTag(ctx, "unuseddelete")

		req := httptest.NewRequest(http.MethodDelete, "/api/tags/unuseddelete/delete", http.NoBody)
		req = mux.SetURLVars(req, map[string]string{"tag": "unuseddelete"})
		w := httptest.NewRecorder()

		h.DeleteTagEverywhere(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}

		var response map[string]interface{}
		if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		affectedFiles, ok := response["affectedFiles"].(float64)
		if !ok || int(affectedFiles) != 0 {
			t.Errorf("expected 0 affected files for unused tag, got %v", response["affectedFiles"])
		}
	})

	// Test case 3: Delete non-existent tag
	t.Run("Delete non-existent tag", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/tags/nonexistent/delete", http.NoBody)
		req = mux.SetURLVars(req, map[string]string{"tag": "nonexistent"})
		w := httptest.NewRecorder()

		h.DeleteTagEverywhere(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d", w.Code)
		}
	})

	// Test case 4: Missing tag name
	t.Run("Missing tag name", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/tags//delete", http.NoBody)
		req = mux.SetURLVars(req, map[string]string{"tag": ""})
		w := httptest.NewRecorder()

		h.DeleteTagEverywhere(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	// Test case 5: Case-insensitive deletion
	t.Run("Case-insensitive deletion", func(t *testing.T) {
		addTagTestFile(t, h.db, mediaDir, "delcase.jpg", database.FileTypeImage)

		ctx := context.Background()
		_ = h.db.AddTagToFile(ctx, "delcase.jpg", "MixedCase")

		req := httptest.NewRequest(http.MethodDelete, "/api/tags/mixedcase/delete", http.NoBody)
		req = mux.SetURLVars(req, map[string]string{"tag": "mixedcase"})
		w := httptest.NewRecorder()

		h.DeleteTagEverywhere(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}

		// Verify tag is deleted
		tags, _ := h.db.GetFileTags(ctx, "delcase.jpg")
		if len(tags) != 0 {
			t.Errorf("expected file to have no tags after deletion, got %v", tags)
		}
	})
}
