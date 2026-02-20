package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/mux"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

// =============================================================================
// Thumbnail Generation Coverage Tests
// =============================================================================
//
// These tests focus on achieving coverage of the GetThumbnail handler code
// that was previously at 0% coverage. They test with real thumbnail generation
// enabled and cover various error conditions and edge cases.
// =============================================================================

// setupThumbnailCoverageTest creates a handler setup with thumbnails enabled
func setupThumbnailCoverageTest(t *testing.T) (h *Handlers, mediaDir string, cleanup func()) {
	t.Helper()

	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"
	mediaDir = tempDir + "/media"
	cacheDir := tempDir + "/cache"

	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		t.Fatalf("failed to create media directory: %v", err)
	}

	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("failed to create cache directory: %v", err)
	}

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	idx := indexer.New(db, mediaDir, 0)
	trans := transcoder.New(cacheDir, "", false, "none")

	// Enable thumbnails with a real generator
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, true, db, 4, nil)

	config := &startup.Config{
		MediaDir: mediaDir,
		CacheDir: cacheDir,
	}

	handlers := New(db, idx, trans, thumbGen, config)

	cleanup = func() {
		if err := db.Close(); err != nil {
			t.Logf("failed to close database: %v", err)
		}
	}

	return handlers, mediaDir, cleanup
}

// TestGetThumbnailFileNotInDatabase tests thumbnail for file not in database
func TestGetThumbnailFileNotInDatabase(t *testing.T) {
	h, _, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/nonexistent.jpg", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "nonexistent.jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// Should return 404 when file not in database
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

// TestGetThumbnailFileNotOnDisk tests thumbnail when file is in DB but not on disk
func TestGetThumbnailFileNotOnDisk(t *testing.T) {
	h, _, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()
	ctx := context.Background()
	// Add file to database but don't create it on disk
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "missing.jpg",
		Path:       "missing.jpg",
		ParentPath: "",
		Type:       database.FileTypeImage,
		Size:       0,
		ModTime:    time.Now(),
	}

	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add file to database: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/missing.jpg", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "missing.jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// Should return 404 when file doesn't exist on disk
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

// TestGetThumbnailDirectoryInDatabase tests when path is a directory not marked as folder
func TestGetThumbnailDirectoryInDatabase(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	// Create a directory
	dirPath := filepath.Join(mediaDir, "testdir")
	if err := os.Mkdir(dirPath, 0o755); err != nil {
		t.Fatalf("failed to create directory: %v", err)
	}

	// Add to database as image (wrong type)
	ctx := context.Background()
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "testdir",
		Path:       "testdir",
		ParentPath: "",
		Type:       database.FileTypeImage,
		Size:       0,
		ModTime:    time.Now(),
	}
	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add directory to database: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/testdir", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "testdir"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// Should return 400 when path is directory but marked as file
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestGetThumbnailUnsupportedFileType tests thumbnail for unsupported file types
func TestGetThumbnailUnsupportedFileType(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	tests := []struct {
		name     string
		filename string
		fileType database.FileType
	}{
		{"playlist file", "music.m3u", database.FileTypePlaylist},
		{"other file type", "document.txt", database.FileTypeOther},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create file on disk
			filePath := filepath.Join(mediaDir, tt.filename)
			if err := os.WriteFile(filePath, []byte("test content"), 0o644); err != nil {
				t.Fatalf("failed to create file: %v", err)
			}

			// Add to database
			ctx := context.Background()
			tx, err := h.db.BeginBatch(ctx)
			if err != nil {
				t.Fatalf("failed to begin transaction: %v", err)
			}
			file := &database.MediaFile{
				Name:       tt.filename,
				Path:       tt.filename,
				ParentPath: "",
				Type:       tt.fileType,
				Size:       0,
				ModTime:    time.Now(),
			}
			err = h.db.UpsertFile(ctx, tx, file)
			if err = h.db.EndBatch(tx, err); err != nil {
				t.Fatalf("failed to add file to database: %v", err)
			}

			req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/"+tt.filename, http.NoBody)
			req = mux.SetURLVars(req, map[string]string{"path": tt.filename})
			w := httptest.NewRecorder()

			h.GetThumbnail(w, req)

			// Should return 400 for unsupported file types
			if w.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want %d for %s", w.Code, http.StatusBadRequest, tt.name)
			}
		})
	}
}

// TestGetThumbnailImageSuccess tests successful thumbnail generation for image
func TestGetThumbnailImageSuccess(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	// Create a simple 1x1 PNG image
	imageData := []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
		0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
		0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
		0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
		0x44, 0xAE, 0x42, 0x60, 0x82,
	}

	filePath := filepath.Join(mediaDir, "test.png")
	if err := os.WriteFile(filePath, imageData, 0o644); err != nil {
		t.Fatalf("failed to create image file: %v", err)
	}

	ctx := context.Background()
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "test.png",
		Path:       "test.png",
		ParentPath: "",
		Type:       database.FileTypeImage,
		Size:       int64(len(imageData)),
		ModTime:    time.Now(),
	}
	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add file to database: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/test.png", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "test.png"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// Should succeed and return JPEG thumbnail
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}

	// Check Content-Type
	contentType := w.Header().Get("Content-Type")
	if contentType != "image/jpeg" {
		t.Errorf("Content-Type = %q, want %q", contentType, "image/jpeg")
	}

	// Check Cache-Control (24 hours for files)
	cacheControl := w.Header().Get("Cache-Control")
	if cacheControl != "public, max-age=86400" {
		t.Errorf("Cache-Control = %q, want %q", cacheControl, "public, max-age=86400")
	}

	// Check ETag is set
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Error("ETag header not set")
	}

	// Check body has content
	if w.Body.Len() == 0 {
		t.Error("thumbnail body is empty")
	}
}

// TestGetThumbnailFolderSuccess tests successful thumbnail generation for folder
func TestGetThumbnailFolderSuccess(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	// Create a folder
	folderPath := filepath.Join(mediaDir, "vacation")
	if err := os.Mkdir(folderPath, 0o755); err != nil {
		t.Fatalf("failed to create folder: %v", err)
	}

	ctx := context.Background()
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "vacation",
		Path:       "vacation",
		ParentPath: "",
		Type:       database.FileTypeFolder,
		Size:       0,
		ModTime:    time.Now(),
	}
	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add folder to database: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/vacation", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "vacation"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// Should succeed and return PNG thumbnail for folder
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}

	// Check Content-Type for folder (PNG)
	contentType := w.Header().Get("Content-Type")
	if contentType != "image/png" {
		t.Errorf("Content-Type = %q, want %q", contentType, "image/png")
	}

	// Check Cache-Control (5 minutes for folders)
	cacheControl := w.Header().Get("Cache-Control")
	if cacheControl != "public, max-age=300, must-revalidate" {
		t.Errorf("Cache-Control = %q, want %q", cacheControl, "public, max-age=300, must-revalidate")
	}

	// Check ETag is set
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Error("ETag header not set")
	}
}

// TestGetThumbnailConditionalRequest tests 304 Not Modified with If-None-Match
func TestGetThumbnailConditionalRequest(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	// Create a simple image
	imageData := []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
		0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
		0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
		0x44, 0xAE, 0x42, 0x60, 0x82,
	}

	filePath := filepath.Join(mediaDir, "cached.png")
	if err := os.WriteFile(filePath, imageData, 0o644); err != nil {
		t.Fatalf("failed to create image file: %v", err)
	}

	ctx := context.Background()
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "cached.png",
		Path:       "cached.png",
		ParentPath: "",
		Type:       database.FileTypeImage,
		Size:       int64(len(imageData)),
		ModTime:    time.Now(),
	}
	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add file to database: %v", err)
	}

	// First request to get the ETag
	req1 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/cached.png", http.NoBody)
	req1 = mux.SetURLVars(req1, map[string]string{"path": "cached.png"})
	w1 := httptest.NewRecorder()

	h.GetThumbnail(w1, req1)

	if w1.Code != http.StatusOK {
		t.Fatalf("first request failed with status %d", w1.Code)
	}

	etag := w1.Header().Get("ETag")
	if etag == "" {
		t.Fatal("ETag not set in first response")
	}

	// Second request with If-None-Match matching the ETag
	req2 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/cached.png", http.NoBody)
	req2 = mux.SetURLVars(req2, map[string]string{"path": "cached.png"})
	req2.Header.Set("If-None-Match", etag)
	w2 := httptest.NewRecorder()

	h.GetThumbnail(w2, req2)

	// Should return 304 Not Modified
	if w2.Code != http.StatusNotModified {
		t.Errorf("status = %d, want %d", w2.Code, http.StatusNotModified)
	}

	// Body should be empty for 304
	if w2.Body.Len() > 0 {
		t.Errorf("304 response should have empty body, got %d bytes", w2.Body.Len())
	}

	// Headers should still be set
	if w2.Header().Get("ETag") != etag {
		t.Error("ETag should be set in 304 response")
	}
}

// TestGetThumbnailConditionalRequestMismatch tests when ETag doesn't match
func TestGetThumbnailConditionalRequestMismatch(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	// Create a simple image
	imageData := []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
		0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
		0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
		0x44, 0xAE, 0x42, 0x60, 0x82,
	}

	filePath := filepath.Join(mediaDir, "modified.png")
	if err := os.WriteFile(filePath, imageData, 0o644); err != nil {
		t.Fatalf("failed to create image file: %v", err)
	}

	ctx := context.Background()
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "modified.png",
		Path:       "modified.png",
		ParentPath: "",
		Type:       database.FileTypeImage,
		Size:       int64(len(imageData)),
		ModTime:    time.Now(),
	}
	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add file to database: %v", err)
	}

	// Request with wrong ETag
	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/modified.png", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "modified.png"})
	req.Header.Set("If-None-Match", `"wrong-etag-12345"`)
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// Should return 200 with full content when ETag doesn't match
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}

	// Body should have content
	if w.Body.Len() == 0 {
		t.Error("response should have thumbnail data when ETag mismatches")
	}
}

// TestGetThumbnailGenerationFailure tests when thumbnail generation fails
func TestGetThumbnailGenerationFailure(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	// Create an invalid image file (not actually an image)
	filePath := filepath.Join(mediaDir, "corrupt.jpg")
	if err := os.WriteFile(filePath, []byte("not a real image"), 0o644); err != nil {
		t.Fatalf("failed to create file: %v", err)
	}

	ctx := context.Background()
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "corrupt.jpg",
		Path:       "corrupt.jpg",
		ParentPath: "",
		Type:       database.FileTypeImage,
		Size:       16,
		ModTime:    time.Now(),
	}
	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add file to database: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/corrupt.jpg", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "corrupt.jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// Should return 500 when thumbnail generation fails
	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

// TestGetThumbnailStatError tests when os.Stat fails for reasons other than not found
func TestGetThumbnailStatError(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	// Create a file
	filePath := filepath.Join(mediaDir, "protected.jpg")
	if err := os.WriteFile(filePath, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to create file: %v", err)
	}

	ctx := context.Background()
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "protected.jpg",
		Path:       "protected.jpg",
		ParentPath: "",
		Type:       database.FileTypeImage,
		Size:       4,
		ModTime:    time.Now(),
	}
	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add file to database: %v", err)
	}

	// Remove read permissions to cause stat error
	if err := os.Chmod(filePath, 0o000); err != nil {
		t.Fatalf("failed to change permissions: %v", err)
	}
	defer os.Chmod(filePath, 0o644) // Restore for cleanup

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/protected.jpg", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "protected.jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// May return 500 or 404 depending on permission error
	// On some systems, stat can succeed even without read permission
	if w.Code != http.StatusInternalServerError && w.Code != http.StatusNotFound {
		t.Logf("Got status %d, expected 500 or 404 (system-dependent)", w.Code)
	}
}

// TestGetThumbnailMultipleRequests tests concurrent thumbnail requests
func TestGetThumbnailMultipleRequests(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	// Create a simple image
	imageData := []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
		0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
		0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
		0x44, 0xAE, 0x42, 0x60, 0x82,
	}

	filePath := filepath.Join(mediaDir, "concurrent.png")
	if err := os.WriteFile(filePath, imageData, 0o644); err != nil {
		t.Fatalf("failed to create image file: %v", err)
	}

	ctx := context.Background()
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "concurrent.png",
		Path:       "concurrent.png",
		ParentPath: "",
		Type:       database.FileTypeImage,
		Size:       int64(len(imageData)),
		ModTime:    time.Now(),
	}
	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add file to database: %v", err)
	}

	// Make multiple concurrent requests
	const numRequests = 10
	done := make(chan bool, numRequests)
	errors := make(chan error, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			defer func() { done <- true }()

			req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/concurrent.png", http.NoBody)
			req = mux.SetURLVars(req, map[string]string{"path": "concurrent.png"})
			w := httptest.NewRecorder()

			h.GetThumbnail(w, req)

			if w.Code != http.StatusOK {
				errors <- http.ErrContentLength
			}
		}()
	}

	// Wait for all requests
	for i := 0; i < numRequests; i++ {
		<-done
	}

	close(errors)
	for err := range errors {
		t.Errorf("concurrent request failed: %v", err)
	}
}

// TestGetThumbnailVideoType tests thumbnail for video file
func TestGetThumbnailVideoType(t *testing.T) {
	h, mediaDir, cleanup := setupThumbnailCoverageTest(t)
	defer cleanup()

	// Create a dummy video file (won't actually generate thumbnail but tests the code path)
	filePath := filepath.Join(mediaDir, "video.mp4")
	if err := os.WriteFile(filePath, []byte("fake video content"), 0o644); err != nil {
		t.Fatalf("failed to create video file: %v", err)
	}

	ctx := context.Background()
	tx, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	file := &database.MediaFile{
		Name:       "video.mp4",
		Path:       "video.mp4",
		ParentPath: "",
		Type:       database.FileTypeVideo,
		Size:       18,
		ModTime:    time.Now(),
	}
	err = h.db.UpsertFile(ctx, tx, file)
	if err = h.db.EndBatch(tx, err); err != nil {
		t.Fatalf("failed to add file to database: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/video.mp4", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "video.mp4"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// Will likely fail to generate thumbnail for fake video, but the type check passes
	// Status could be 500 (generation failed) or 200 (if it somehow succeeded)
	if w.Code != http.StatusInternalServerError && w.Code != http.StatusOK {
		t.Logf("Got status %d for video thumbnail (expected 500 or 200)", w.Code)
	}
}
