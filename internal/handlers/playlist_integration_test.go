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

	"github.com/gorilla/mux"
)

// =============================================================================
// Playlist Integration Tests
// =============================================================================

// setupPlaylistIntegrationTest creates a complete handler setup for testing playlists
func setupPlaylistIntegrationTest(t *testing.T) (h *Handlers, mediaDir string, cleanup func()) {
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

// createTestPlaylist creates a WPL playlist file with test content
func createTestPlaylist(t *testing.T, playlistPath, title string, items []string) {
	t.Helper()

	// Create directory if needed
	dir := filepath.Dir(playlistPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create playlist directory: %v", err)
	}

	// Build WPL XML content
	content := `<?xml version="1.0" encoding="UTF-8"?>
<smil>
	<head>
		<title>` + title + `</title>
	</head>
	<body>
		<seq>`

	for _, item := range items {
		content += "\n\t\t\t<media src=\"" + item + "\"/>"
	}

	content += `
		</seq>
	</body>
</smil>`

	if err := os.WriteFile(playlistPath, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write playlist file: %v", err)
	}
}

// addPlaylistToDatabase inserts a playlist file into the database
func addPlaylistToDatabase(t *testing.T, db *database.Database, playlistPath, mediaDir string) {
	t.Helper()

	// Get relative path
	relPath, err := filepath.Rel(mediaDir, playlistPath)
	if err != nil {
		t.Fatalf("failed to get relative path: %v", err)
	}

	// Get file info
	info, err := os.Stat(playlistPath)
	if err != nil {
		t.Fatalf("failed to stat playlist: %v", err)
	}

	// Insert into database
	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}

	mediaFile := &database.MediaFile{
		Path:    relPath,
		Name:    filepath.Base(playlistPath),
		Size:    info.Size(),
		ModTime: info.ModTime(),
		Type:    database.FileTypePlaylist,
	}

	if err := db.UpsertFile(tx, mediaFile); err != nil {
		t.Fatalf("failed to insert playlist: %v", err)
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("failed to commit transaction: %v", err)
	}
}

// TestListPlaylistsEmptyIntegration tests listing playlists with no playlists
func TestListPlaylistsEmptyIntegration(t *testing.T) {
	h, _, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/playlists", http.NoBody)
	w := httptest.NewRecorder()

	h.ListPlaylists(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var playlists []database.MediaFile
	if err := json.NewDecoder(w.Body).Decode(&playlists); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should return empty array, not null
	if playlists == nil {
		t.Error("expected empty array, got nil")
	}

	if len(playlists) != 0 {
		t.Errorf("expected 0 playlists, got %d", len(playlists))
	}
}

// TestListPlaylistsWithPlaylistsIntegration tests listing playlists
func TestListPlaylistsWithPlaylistsIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	// Create test playlists
	playlist1 := filepath.Join(mediaDir, "favorites.wpl")
	createTestPlaylist(t, playlist1, "My Favorites", []string{"song1.mp3", "song2.mp3"})
	addPlaylistToDatabase(t, h.db, playlist1, mediaDir)

	playlist2 := filepath.Join(mediaDir, "playlists", "recent.wpl")
	createTestPlaylist(t, playlist2, "Recent", []string{"video.mp4"})
	addPlaylistToDatabase(t, h.db, playlist2, mediaDir)

	req := httptest.NewRequest(http.MethodGet, "/api/playlists", http.NoBody)
	w := httptest.NewRecorder()

	h.ListPlaylists(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var playlists []database.MediaFile
	if err := json.NewDecoder(w.Body).Decode(&playlists); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(playlists) != 2 {
		t.Errorf("expected 2 playlists, got %d", len(playlists))
	}

	// Verify content type
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", contentType)
	}
}

// TestGetPlaylistByNameIntegration tests getting a playlist by name
func TestGetPlaylistByNameIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	// Create test playlist with media files
	playlist1 := filepath.Join(mediaDir, "favorites.wpl")
	createTestPlaylist(t, playlist1, "My Favorites", []string{"song1.mp3", "song2.mp3"})
	addPlaylistToDatabase(t, h.db, playlist1, mediaDir)

	req := httptest.NewRequest(http.MethodGet, "/api/playlists/favorites", http.NoBody)
	w := httptest.NewRecorder()

	// Set up mux vars
	req = mux.SetURLVars(req, map[string]string{"name": "favorites"})

	h.GetPlaylist(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var playlist map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&playlist); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify playlist structure
	if playlist["name"] != "My Favorites" {
		t.Errorf("expected name 'My Favorites', got %v", playlist["name"])
	}

	items, ok := playlist["items"].([]interface{})
	if !ok {
		t.Fatal("expected items to be an array")
	}

	if len(items) != 2 {
		t.Errorf("expected 2 items, got %d", len(items))
	}
}

// TestGetPlaylistByNameWithExtensionIntegration tests getting playlist with .wpl extension
func TestGetPlaylistByNameWithExtensionIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	playlist1 := filepath.Join(mediaDir, "music.wpl")
	createTestPlaylist(t, playlist1, "Music", []string{"track1.mp3"})
	addPlaylistToDatabase(t, h.db, playlist1, mediaDir)

	req := httptest.NewRequest(http.MethodGet, "/api/playlists/music.wpl", http.NoBody)
	w := httptest.NewRecorder()

	req = mux.SetURLVars(req, map[string]string{"name": "music.wpl"})

	h.GetPlaylist(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var playlist map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&playlist); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if playlist["name"] != "Music" {
		t.Errorf("expected name 'Music', got %v", playlist["name"])
	}
}

// TestGetPlaylistNotFoundIntegration tests getting a non-existent playlist
func TestGetPlaylistNotFoundIntegration(t *testing.T) {
	h, _, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/playlists/nonexistent", http.NoBody)
	w := httptest.NewRecorder()

	req = mux.SetURLVars(req, map[string]string{"name": "nonexistent"})

	h.GetPlaylist(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

// TestGetPlaylistNestedPathIntegration tests playlist in nested directory
func TestGetPlaylistNestedPathIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	playlist1 := filepath.Join(mediaDir, "user", "playlists", "summer.wpl")
	createTestPlaylist(t, playlist1, "Summer Mix", []string{"song1.mp3", "song2.mp3", "song3.mp3"})
	addPlaylistToDatabase(t, h.db, playlist1, mediaDir)

	req := httptest.NewRequest(http.MethodGet, "/api/playlists/summer", http.NoBody)
	w := httptest.NewRecorder()

	req = mux.SetURLVars(req, map[string]string{"name": "summer"})

	h.GetPlaylist(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var playlist map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&playlist); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if playlist["name"] != "Summer Mix" {
		t.Errorf("expected name 'Summer Mix', got %v", playlist["name"])
	}

	items, ok := playlist["items"].([]interface{})
	if !ok {
		t.Fatal("expected items to be an array")
	}

	if len(items) != 3 {
		t.Errorf("expected 3 items, got %d", len(items))
	}
}

// TestGetPlaylistEmptyPlaylistIntegration tests an empty playlist
func TestGetPlaylistEmptyPlaylistIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	playlist1 := filepath.Join(mediaDir, "empty.wpl")
	createTestPlaylist(t, playlist1, "Empty Playlist", []string{})
	addPlaylistToDatabase(t, h.db, playlist1, mediaDir)

	req := httptest.NewRequest(http.MethodGet, "/api/playlists/empty", http.NoBody)
	w := httptest.NewRecorder()

	req = mux.SetURLVars(req, map[string]string{"name": "empty"})

	h.GetPlaylist(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var playlist map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&playlist); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	items, ok := playlist["items"].([]interface{})
	if !ok {
		t.Fatal("expected items to be an array")
	}

	if len(items) != 0 {
		t.Errorf("expected 0 items, got %d", len(items))
	}
}

// TestListPlaylistsMultipleIntegration tests listing multiple playlists in different directories
func TestListPlaylistsMultipleIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	// Create playlists in different locations
	playlists := []struct {
		path  string
		title string
	}{
		{filepath.Join(mediaDir, "root.wpl"), "Root Playlist"},
		{filepath.Join(mediaDir, "music", "rock.wpl"), "Rock Music"},
		{filepath.Join(mediaDir, "music", "jazz.wpl"), "Jazz Collection"},
		{filepath.Join(mediaDir, "videos", "favorites.wpl"), "Favorite Videos"},
	}

	for _, pl := range playlists {
		createTestPlaylist(t, pl.path, pl.title, []string{"item1.mp3", "item2.mp4"})
		addPlaylistToDatabase(t, h.db, pl.path, mediaDir)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/playlists", http.NoBody)
	w := httptest.NewRecorder()

	h.ListPlaylists(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result []database.MediaFile
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(result) != 4 {
		t.Errorf("expected 4 playlists, got %d", len(result))
	}

	// Verify all playlists have proper fields
	for _, pl := range result {
		if pl.Path == "" {
			t.Error("expected non-empty path")
		}
		if pl.Name == "" {
			t.Error("expected non-empty name")
		}
		if pl.Type != database.FileTypePlaylist {
			t.Errorf("expected type FileTypePlaylist, got %v", pl.Type)
		}
	}
}

// TestGetPlaylistSpecialCharactersIntegration tests playlist names with special characters
func TestGetPlaylistSpecialCharactersIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	// Create playlist with spaces in name
	playlist1 := filepath.Join(mediaDir, "My Favorite Songs.wpl")
	createTestPlaylist(t, playlist1, "My Favorite Songs", []string{"song.mp3"})
	addPlaylistToDatabase(t, h.db, playlist1, mediaDir)

	// URL-encode spaces as %20
	req := httptest.NewRequest(http.MethodGet, "/api/playlists/My%20Favorite%20Songs", http.NoBody)
	w := httptest.NewRecorder()

	req = mux.SetURLVars(req, map[string]string{"name": "My Favorite Songs"})

	h.GetPlaylist(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

// TestGetPlaylistCaseNameMatchingIntegration tests case-sensitive name matching
func TestGetPlaylistCaseNameMatchingIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	// Create playlist with capitalized name
	playlist1 := filepath.Join(mediaDir, "Favorites.wpl")
	createTestPlaylist(t, playlist1, "Favorites", []string{"song.mp3"})
	addPlaylistToDatabase(t, h.db, playlist1, mediaDir)

	// Request with lowercase should NOT match (case-sensitive)
	req := httptest.NewRequest(http.MethodGet, "/api/playlists/favorites", http.NoBody)
	w := httptest.NewRecorder()

	req = mux.SetURLVars(req, map[string]string{"name": "favorites"})

	h.GetPlaylist(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 (case-sensitive), got %d", w.Code)
	}
}

// TestGetPlaylistContentTypeIntegration tests response content type
func TestGetPlaylistContentTypeIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	playlist1 := filepath.Join(mediaDir, "test.wpl")
	createTestPlaylist(t, playlist1, "Test", []string{"file.mp3"})
	addPlaylistToDatabase(t, h.db, playlist1, mediaDir)

	req := httptest.NewRequest(http.MethodGet, "/api/playlists/test", http.NoBody)
	w := httptest.NewRecorder()

	req = mux.SetURLVars(req, map[string]string{"name": "test"})

	h.GetPlaylist(w, req)

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", contentType)
	}
}

// TestCompletePlaylistFlowIntegration tests the complete playlist workflow
func TestCompletePlaylistFlowIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	// Create multiple playlists
	playlists := []struct {
		filename string
		title    string
		items    []string
	}{
		{"favorites.wpl", "My Favorites", []string{"song1.mp3", "song2.mp3"}},
		{"recent.wpl", "Recently Added", []string{"new.mp4"}},
	}

	for _, pl := range playlists {
		path := filepath.Join(mediaDir, pl.filename)
		createTestPlaylist(t, path, pl.title, pl.items)
		addPlaylistToDatabase(t, h.db, path, mediaDir)
	}

	// Step 1: List all playlists
	listReq := httptest.NewRequest(http.MethodGet, "/api/playlists", http.NoBody)
	listW := httptest.NewRecorder()
	h.ListPlaylists(listW, listReq)

	if listW.Code != http.StatusOK {
		t.Fatalf("list playlists failed: %d", listW.Code)
	}

	var allPlaylists []database.MediaFile
	if err := json.NewDecoder(listW.Body).Decode(&allPlaylists); err != nil {
		t.Fatalf("failed to decode list: %v", err)
	}

	if len(allPlaylists) != 2 {
		t.Fatalf("expected 2 playlists, got %d", len(allPlaylists))
	}

	// Step 2: Get first playlist details
	getReq := httptest.NewRequest(http.MethodGet, "/api/playlists/favorites", http.NoBody)
	getW := httptest.NewRecorder()
	getReq = mux.SetURLVars(getReq, map[string]string{"name": "favorites"})
	h.GetPlaylist(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("get playlist failed: %d", getW.Code)
	}

	var playlist map[string]interface{}
	if err := json.NewDecoder(getW.Body).Decode(&playlist); err != nil {
		t.Fatalf("failed to decode playlist: %v", err)
	}

	if playlist["name"] != "My Favorites" {
		t.Errorf("expected name 'My Favorites', got %v", playlist["name"])
	}

	items := playlist["items"].([]interface{})
	if len(items) != 2 {
		t.Errorf("expected 2 items, got %d", len(items))
	}
}

// TestListPlaylistsResponseStructureIntegration tests the response structure
func TestListPlaylistsResponseStructureIntegration(t *testing.T) {
	h, mediaDir, cleanup := setupPlaylistIntegrationTest(t)
	defer cleanup()

	playlist1 := filepath.Join(mediaDir, "test.wpl")
	createTestPlaylist(t, playlist1, "Test", []string{"file.mp3"})
	addPlaylistToDatabase(t, h.db, playlist1, mediaDir)

	req := httptest.NewRequest(http.MethodGet, "/api/playlists", http.NoBody)
	w := httptest.NewRecorder()

	h.ListPlaylists(w, req)

	var playlists []database.MediaFile
	if err := json.NewDecoder(w.Body).Decode(&playlists); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(playlists) != 1 {
		t.Fatalf("expected 1 playlist, got %d", len(playlists))
	}

	pl := playlists[0]

	// Verify required fields
	if pl.Path == "" {
		t.Error("expected non-empty path")
	}
	if pl.Name == "" {
		t.Error("expected non-empty name")
	}
	if pl.Type != database.FileTypePlaylist {
		t.Errorf("expected type FileTypePlaylist, got %v", pl.Type)
	}
}
