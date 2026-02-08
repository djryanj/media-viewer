package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

// setupFavoritesIntegrationTest creates a test environment for favorites integration tests
func setupFavoritesIntegrationTest(t *testing.T) (h *Handlers, cleanup func()) {
	t.Helper()

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")
	mediaDir := filepath.Join(tmpDir, "media")
	cacheDir := filepath.Join(tmpDir, "cache")

	os.MkdirAll(mediaDir, 0o755)
	os.MkdirAll(cacheDir, 0o755)

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}

	idx := indexer.New(db, mediaDir, 0)
	trans := transcoder.New(cacheDir, "", false)
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil)

	config := &startup.Config{
		MediaDir: mediaDir,
		CacheDir: cacheDir,
	}

	handlers := New(db, idx, trans, thumbGen, config)

	cleanup = func() {
		db.Close()
	}

	return handlers, cleanup
}

// addTestFile inserts a file record into the database for testing
func addTestFile(t *testing.T, db *database.Database, path, name string, fileType database.FileType) {
	t.Helper()

	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("Failed to begin batch: %v", err)
	}

	file := &database.MediaFile{
		Name:       name,
		Path:       path,
		ParentPath: filepath.Dir(path),
		Type:       fileType,
		Size:       1000,
		ModTime:    time.Now(),
	}

	err = db.UpsertFile(tx, file)
	if err != nil {
		tx.Rollback()
		t.Fatalf("Failed to upsert test file: %v", err)
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("Failed to end batch: %v", err)
	}
}

// =============================================================================
// Get Favorites Tests
// =============================================================================

func TestGetFavoritesEmptyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/favorites", http.NoBody)
	w := httptest.NewRecorder()

	h.GetFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var favorites []database.MediaFile
	if err := json.NewDecoder(w.Body).Decode(&favorites); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if favorites == nil {
		t.Error("Expected empty array, got nil")
	}

	if len(favorites) != 0 {
		t.Errorf("Expected 0 favorites, got %d", len(favorites))
	}
}

func TestGetFavoritesWithDataIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()

	// Add some favorites
	testFavorites := []struct {
		path string
		name string
		typ  database.FileType
	}{
		{"/media/photo1.jpg", "photo1.jpg", database.FileTypeImage},
		{"/media/video1.mp4", "video1.mp4", database.FileTypeVideo},
		{"/media/photo2.png", "photo2.png", database.FileTypeImage},
	}

	for _, fav := range testFavorites {
		// Add file to files table first
		addTestFile(t, h.db, fav.path, fav.name, fav.typ)
		// Then add to favorites
		if err := h.db.AddFavorite(ctx, fav.path, fav.name, fav.typ); err != nil {
			t.Fatalf("Failed to add favorite: %v", err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/favorites", http.NoBody)
	w := httptest.NewRecorder()

	h.GetFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var favorites []database.MediaFile
	if err := json.NewDecoder(w.Body).Decode(&favorites); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(favorites) != len(testFavorites) {
		t.Errorf("Expected %d favorites, got %d", len(testFavorites), len(favorites))
	}

	// Verify content type header
	if contentType := w.Header().Get("Content-Type"); contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}
}

// =============================================================================
// Add Favorite Tests
// =============================================================================

func TestAddFavoriteIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	reqBody := FavoriteRequest{
		Path: "/media/test.jpg",
		Name: "test.jpg",
		Type: database.FileTypeImage,
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddFavorite(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Verify it was added
	ctx := context.Background()
	isFavorite := h.db.IsFavorite(ctx, "/media/test.jpg")
	if !isFavorite {
		t.Error("Expected file to be marked as favorite")
	}
}

func TestAddFavoriteInvalidJSONIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader([]byte("{invalid json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddFavorite(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestAddFavoriteMissingPathIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	reqBody := FavoriteRequest{
		Name: "test.jpg",
		Type: database.FileTypeImage,
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddFavorite(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestAddFavoriteIdempotentIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	// Add file to files table first
	addTestFile(t, h.db, "/media/test.jpg", "test.jpg", database.FileTypeImage)

	reqBody := FavoriteRequest{
		Path: "/media/test.jpg",
		Name: "test.jpg",
		Type: database.FileTypeImage,
	}
	body, _ := json.Marshal(reqBody)

	// Add first time
	req := httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.AddFavorite(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("First add: Expected status 200, got %d", w.Code)
	}

	// Add second time (should be idempotent)
	body, _ = json.Marshal(reqBody)
	req = httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.AddFavorite(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Second add: Expected status 200, got %d", w.Code)
	}

	// Verify only one entry exists
	ctx := context.Background()
	favorites, _ := h.db.GetFavorites(ctx)
	if len(favorites) != 1 {
		t.Errorf("Expected 1 favorite, got %d", len(favorites))
	}
}

// =============================================================================
// Remove Favorite Tests
// =============================================================================

func TestRemoveFavoriteIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()

	// Add a favorite first
	h.db.AddFavorite(ctx, "/media/test.jpg", "test.jpg", database.FileTypeImage)

	// Verify it exists
	if !h.db.IsFavorite(ctx, "/media/test.jpg") {
		t.Fatal("Failed to add favorite")
	}

	// Remove it
	reqBody := FavoriteRequest{
		Path: "/media/test.jpg",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodDelete, "/api/favorites", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.RemoveFavorite(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Verify it was removed
	if h.db.IsFavorite(ctx, "/media/test.jpg") {
		t.Error("Expected file to be removed from favorites")
	}
}

func TestRemoveFavoriteInvalidJSONIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodDelete, "/api/favorites", bytes.NewReader([]byte("{invalid")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.RemoveFavorite(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestRemoveFavoriteMissingPathIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	reqBody := FavoriteRequest{}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodDelete, "/api/favorites", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.RemoveFavorite(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestRemoveNonExistentFavoriteIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	reqBody := FavoriteRequest{
		Path: "/media/nonexistent.jpg",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodDelete, "/api/favorites", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.RemoveFavorite(w, req)

	// Removing non-existent should succeed (idempotent)
	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

// =============================================================================
// Check Favorite Tests
// =============================================================================

func TestCheckFavoriteExistsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.AddFavorite(ctx, "/media/test.jpg", "test.jpg", database.FileTypeImage)

	req := httptest.NewRequest(http.MethodGet, "/api/favorites/check?path=/media/test.jpg", http.NoBody)
	w := httptest.NewRecorder()

	h.CheckFavorite(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string]bool
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response["isFavorite"] {
		t.Error("Expected isFavorite to be true")
	}
}

func TestCheckFavoriteNotExistsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/favorites/check?path=/media/notfavorite.jpg", http.NoBody)
	w := httptest.NewRecorder()

	h.CheckFavorite(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string]bool
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["isFavorite"] {
		t.Error("Expected isFavorite to be false")
	}
}

func TestCheckFavoriteMissingPathIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/favorites/check", http.NoBody)
	w := httptest.NewRecorder()

	h.CheckFavorite(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

// =============================================================================
// Bulk Add Favorites Tests
// =============================================================================

func TestBulkAddFavoritesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	// Add files to files table first
	addTestFile(t, h.db, "/media/photo1.jpg", "photo1.jpg", database.FileTypeImage)
	addTestFile(t, h.db, "/media/photo2.jpg", "photo2.jpg", database.FileTypeImage)
	addTestFile(t, h.db, "/media/video1.mp4", "video1.mp4", database.FileTypeVideo)

	reqBody := BulkFavoriteRequest{
		Items: []BulkFavoriteItem{
			{Path: "/media/photo1.jpg", Name: "photo1.jpg", Type: database.FileTypeImage},
			{Path: "/media/photo2.jpg", Name: "photo2.jpg", Type: database.FileTypeImage},
			{Path: "/media/video1.mp4", Name: "video1.mp4", Type: database.FileTypeVideo},
		},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/favorites/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkAddFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response BulkFavoriteResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Success != 3 {
		t.Errorf("Expected 3 successful, got %d", response.Success)
	}

	if response.Failed != 0 {
		t.Errorf("Expected 0 failed, got %d", response.Failed)
	}

	// Verify all were added
	ctx := context.Background()
	favorites, _ := h.db.GetFavorites(ctx)
	if len(favorites) != 3 {
		t.Errorf("Expected 3 favorites in database, got %d", len(favorites))
	}
}

func TestBulkAddFavoritesEmptyItemsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	reqBody := BulkFavoriteRequest{
		Items: []BulkFavoriteItem{},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/favorites/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkAddFavorites(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestBulkAddFavoritesSkipsEmptyPathsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	reqBody := BulkFavoriteRequest{
		Items: []BulkFavoriteItem{
			{Path: "/media/photo1.jpg", Name: "photo1.jpg", Type: database.FileTypeImage},
			{Path: "", Name: "empty.jpg", Type: database.FileTypeImage}, // Empty path - should be skipped
			{Path: "/media/photo2.jpg", Name: "photo2.jpg", Type: database.FileTypeImage},
		},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/favorites/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkAddFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response BulkFavoriteResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Success != 2 {
		t.Errorf("Expected 2 successful (empty path skipped), got %d", response.Success)
	}
}

func TestBulkAddFavoritesMaxLimitIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	// Create 150 items (exceeds max of 100)
	items := make([]BulkFavoriteItem, 150)
	for i := 0; i < 150; i++ {
		items[i] = BulkFavoriteItem{
			Path: "/media/photo" + string(rune(i)) + ".jpg",
			Name: "photo.jpg",
			Type: database.FileTypeImage,
		}
	}

	reqBody := BulkFavoriteRequest{Items: items}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/favorites/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkAddFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response BulkFavoriteResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Should only process 100 items (the limit)
	if response.Success > 100 {
		t.Errorf("Expected at most 100 items processed, got %d successful", response.Success)
	}
}

// =============================================================================
// Bulk Remove Favorites Tests
// =============================================================================

func TestBulkRemoveFavoritesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()

	// Add files to files table first
	addTestFile(t, h.db, "/media/photo1.jpg", "photo1.jpg", database.FileTypeImage)
	addTestFile(t, h.db, "/media/photo2.jpg", "photo2.jpg", database.FileTypeImage)
	addTestFile(t, h.db, "/media/video1.mp4", "video1.mp4", database.FileTypeVideo)

	// Add some favorites
	h.db.AddFavorite(ctx, "/media/photo1.jpg", "photo1.jpg", database.FileTypeImage)
	h.db.AddFavorite(ctx, "/media/photo2.jpg", "photo2.jpg", database.FileTypeImage)
	h.db.AddFavorite(ctx, "/media/video1.mp4", "video1.mp4", database.FileTypeVideo)

	reqBody := BulkFavoriteRequest{
		Paths: []string{"/media/photo1.jpg", "/media/video1.mp4"},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodDelete, "/api/favorites/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkRemoveFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response BulkFavoriteResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Success != 2 {
		t.Errorf("Expected 2 successful, got %d", response.Success)
	}

	// Verify only one remains
	favorites, _ := h.db.GetFavorites(ctx)
	if len(favorites) != 1 {
		t.Errorf("Expected 1 favorite remaining, got %d", len(favorites))
		return
	}

	if favorites[0].Path != "/media/photo2.jpg" {
		t.Errorf("Expected photo2.jpg to remain, got %s", favorites[0].Path)
	}
}

func TestBulkRemoveFavoritesEmptyPathsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	reqBody := BulkFavoriteRequest{
		Paths: []string{},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodDelete, "/api/favorites/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkRemoveFavorites(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestBulkRemoveFavoritesSkipsEmptyPathsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.AddFavorite(ctx, "/media/photo1.jpg", "photo1.jpg", database.FileTypeImage)
	h.db.AddFavorite(ctx, "/media/photo2.jpg", "photo2.jpg", database.FileTypeImage)

	reqBody := BulkFavoriteRequest{
		Paths: []string{"/media/photo1.jpg", "", "/media/photo2.jpg"},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodDelete, "/api/favorites/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkRemoveFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response BulkFavoriteResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Success != 2 {
		t.Errorf("Expected 2 successful (empty path skipped), got %d", response.Success)
	}

	// Verify all were removed
	favorites, _ := h.db.GetFavorites(ctx)
	if len(favorites) != 0 {
		t.Errorf("Expected 0 favorites remaining, got %d", len(favorites))
	}
}

// =============================================================================
// Complete Favorites Flow Tests
// =============================================================================

func TestCompleteFavoritesFlowIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()

	// Step 1: Verify empty favorites
	favorites, _ := h.db.GetFavorites(ctx)
	if len(favorites) != 0 {
		t.Errorf("Expected 0 initial favorites, got %d", len(favorites))
	}

	// Step 2: Add files and then a favorite
	addTestFile(t, h.db, "/media/photo1.jpg", "photo1.jpg", database.FileTypeImage)
	h.db.AddFavorite(ctx, "/media/photo1.jpg", "photo1.jpg", database.FileTypeImage)

	// Step 3: Check if it's a favorite
	if !h.db.IsFavorite(ctx, "/media/photo1.jpg") {
		t.Error("Expected photo1.jpg to be a favorite")
	}

	// Step 4: Get favorites list
	favorites, _ = h.db.GetFavorites(ctx)
	if len(favorites) != 1 {
		t.Errorf("Expected 1 favorite, got %d", len(favorites))
	}

	// Step 5: Bulk add more favorites
	addTestFile(t, h.db, "/media/photo2.jpg", "photo2.jpg", database.FileTypeImage)
	addTestFile(t, h.db, "/media/video1.mp4", "video1.mp4", database.FileTypeVideo)
	h.db.AddFavorite(ctx, "/media/photo2.jpg", "photo2.jpg", database.FileTypeImage)
	h.db.AddFavorite(ctx, "/media/video1.mp4", "video1.mp4", database.FileTypeVideo)

	favorites, _ = h.db.GetFavorites(ctx)
	if len(favorites) != 3 {
		t.Errorf("Expected 3 favorites, got %d", len(favorites))
	}

	// Step 6: Remove one favorite
	h.db.RemoveFavorite(ctx, "/media/photo1.jpg")

	favorites, _ = h.db.GetFavorites(ctx)
	if len(favorites) != 2 {
		t.Errorf("Expected 2 favorites after removal, got %d", len(favorites))
	}

	// Step 7: Verify removed item is not a favorite
	if h.db.IsFavorite(ctx, "/media/photo1.jpg") {
		t.Error("Expected photo1.jpg to not be a favorite after removal")
	}

	// Step 8: Bulk remove remaining
	h.db.RemoveFavorite(ctx, "/media/photo2.jpg")
	h.db.RemoveFavorite(ctx, "/media/video1.mp4")

	favorites, _ = h.db.GetFavorites(ctx)
	if len(favorites) != 0 {
		t.Errorf("Expected 0 favorites after bulk removal, got %d", len(favorites))
	}
}

// TestBulkAddFavoritesLargeScaleIntegration tests bulk add with many items (stress test)
func TestBulkAddFavoritesLargeScaleIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	// Generate 500 items but handler limits to 100
	items := make([]BulkFavoriteItem, 500)
	for i := 0; i < 500; i++ {
		path := fmt.Sprintf("photos/image%04d.jpg", i)
		items[i] = BulkFavoriteItem{
			Path: path,
			Name: filepath.Base(path),
			Type: database.FileTypeImage,
		}
	}

	body, err := json.Marshal(map[string]interface{}{
		"items": items,
	})
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/favorites/bulk-add", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.BulkAddFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	success, ok := response["success"].(float64)
	if !ok {
		t.Fatalf("expected 'success' field in response, got response: %+v", response)
	}

	// Handler limits to 100 items max
	if int(success) != 100 {
		// Check if there were errors
		if failed, ok := response["failed"].(float64); ok && failed > 0 {
			if errors, ok := response["errors"].([]interface{}); ok {
				t.Errorf("expected 100 items added (handler max limit), got %d success, %d failed. Errors: %v", int(success), int(failed), errors)
			} else {
				t.Errorf("expected 100 items added (handler max limit), got %d success, %d failed", int(success), int(failed))
			}
		} else {
			t.Errorf("expected 100 items added (handler max limit), got %d", int(success))
		}
		return
	}

	// Verify 100 were added (not 500)
	// Use GetFavoriteCount since GetFavorites requires files to exist in files table
	ctx := context.Background()
	count := h.db.GetFavoriteCount(ctx)

	if count != 100 {
		t.Errorf("expected 100 favorites in database (handler max), got %d", count)
	}
}

// TestFavoritesWithUnicodePathsIntegration tests favorites with Unicode characters
func TestFavoritesWithUnicodePathsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupFavoritesIntegrationTest(t)
	defer cleanup()

	testCases := []struct {
		name     string
		path     string
		fileName string
	}{
		{"Japanese", "photos/写真.jpg", "写真.jpg"},
		{"Chinese", "photos/图片.jpg", "图片.jpg"},
		{"Russian", "photos/фото.jpg", "фото.jpg"},
		{"Arabic", "photos/صورة.jpg", "صورة.jpg"},
		{"Emoji", "photos/photo😀.jpg", "photo😀.jpg"},
		{"Spaces", "photos/my photo.jpg", "my photo.jpg"},
	}

	ctx := context.Background()

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Add favorite directly via database
			err := h.db.AddFavorite(ctx, tc.path, tc.fileName, database.FileTypeImage)
			if err != nil {
				t.Fatalf("failed to add favorite: %v", err)
			}

			// Verify it was added by checking via API
			checkReq := httptest.NewRequest(http.MethodGet, "/api/favorites/check?path="+url.QueryEscape(tc.path), http.NoBody)
			checkW := httptest.NewRecorder()

			h.CheckFavorite(checkW, checkReq)

			if checkW.Code != http.StatusOK {
				t.Errorf("check failed: expected status 200, got %d: %s", checkW.Code, checkW.Body.String())
			}

			var result map[string]bool
			if err := json.NewDecoder(checkW.Body).Decode(&result); err != nil {
				t.Fatalf("failed to decode check response: %v", err)
			}

			if !result["isFavorite"] {
				t.Errorf("expected %s to be favorited", tc.path)
			}
		})
	}
}
