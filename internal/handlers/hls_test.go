package handlers

import (
	"bytes"
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

// setupHLSHandlerTest returns a *Handlers backed by a *disabled* transcoder.
// The disabled transcoder means GetOrCreateHLSSession always returns an error,
// so these tests exercise input-validation and path-security paths without
// needing ffprobe, ffmpeg, or real video files.
func setupHLSHandlerTest(t *testing.T) (h *Handlers, mediaDir string) {
	t.Helper()

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")
	mediaDir = filepath.Join(tempDir, "media")
	cacheDir := filepath.Join(tempDir, "cache")

	for _, d := range []string{mediaDir, cacheDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", d, err)
		}
	}

	db, _, err := database.New(context.Background(), dbPath, &database.Options{})
	if err != nil {
		t.Fatalf("database.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	idx := indexer.New(db, mediaDir, 0)
	trans := transcoder.New(cacheDir, "", false /* disabled */, "none")
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil)
	cfg := &startup.Config{MediaDir: mediaDir, CacheDir: cacheDir}

	return New(db, idx, trans, thumbGen, cfg), mediaDir
}

// =============================================================================
// CreateHLSSession — input validation
// =============================================================================

func TestCreateHLSSession_InvalidJSON(t *testing.T) {
	t.Parallel()
	h, _ := setupHLSHandlerTest(t)

	req := httptest.NewRequest(http.MethodPost, "/api/hls/session",
		bytes.NewBufferString("{not valid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.CreateHLSSession(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("invalid JSON: want 400, got %d", w.Code)
	}
}

func TestCreateHLSSession_EmptyPath(t *testing.T) {
	t.Parallel()
	h, _ := setupHLSHandlerTest(t)

	body, _ := json.Marshal(map[string]interface{}{"path": "", "width": 0})
	req := httptest.NewRequest(http.MethodPost, "/api/hls/session", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.CreateHLSSession(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("empty path: want 400, got %d", w.Code)
	}
}

func TestCreateHLSSession_PathTraversal(t *testing.T) {
	t.Parallel()
	h, _ := setupHLSHandlerTest(t)

	body, _ := json.Marshal(map[string]interface{}{"path": "../../../etc/passwd", "width": 0})
	req := httptest.NewRequest(http.MethodPost, "/api/hls/session", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.CreateHLSSession(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("path traversal: want 400, got %d", w.Code)
	}
}

func TestCreateHLSSession_FileNotFound(t *testing.T) {
	t.Parallel()
	h, _ := setupHLSHandlerTest(t)

	body, _ := json.Marshal(map[string]interface{}{"path": "no_such_file.mkv", "width": 0})
	req := httptest.NewRequest(http.MethodPost, "/api/hls/session", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.CreateHLSSession(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("file not found: want 404, got %d", w.Code)
	}
}

// =============================================================================
// GetHLSPlaylist — session lookup
// =============================================================================

func TestGetHLSPlaylist_UnknownSession(t *testing.T) {
	t.Parallel()
	h, _ := setupHLSHandlerTest(t)

	req := httptest.NewRequest(http.MethodGet,
		"/api/hls/deadbeef01234567/playlist.m3u8", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"sessionId": "deadbeef01234567"})
	w := httptest.NewRecorder()

	h.GetHLSPlaylist(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("unknown session: want 404, got %d", w.Code)
	}
}

// =============================================================================
// GetHLSSegment — session lookup and index validation
// =============================================================================

func TestGetHLSSegment_UnknownSession(t *testing.T) {
	t.Parallel()
	h, _ := setupHLSHandlerTest(t)

	req := httptest.NewRequest(http.MethodGet,
		"/api/hls/deadbeef01234567/seg0.ts", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{
		"sessionId": "deadbeef01234567",
		"index":     "0",
	})
	w := httptest.NewRecorder()

	h.GetHLSSegment(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("unknown session: want 404, got %d", w.Code)
	}
}

// TestGetHLSSegment_NegativeIndex exercises the `index < 0` guard by injecting
// a negative integer via mux vars (which the URL regex would normally prevent).
func TestGetHLSSegment_NegativeIndex(t *testing.T) {
	t.Parallel()
	h, _ := setupHLSHandlerTest(t)

	req := httptest.NewRequest(http.MethodGet,
		"/api/hls/deadbeef01234567/seg-1.ts", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{
		"sessionId": "deadbeef01234567",
		"index":     "-1",
	})
	w := httptest.NewRecorder()

	h.GetHLSSegment(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("negative index: want 400, got %d", w.Code)
	}
}

// TestGetHLSSegment_NonNumericIndex exercises strconv.Atoi failure.
func TestGetHLSSegment_NonNumericIndex(t *testing.T) {
	t.Parallel()
	h, _ := setupHLSHandlerTest(t)

	req := httptest.NewRequest(http.MethodGet,
		"/api/hls/deadbeef01234567/segBAD.ts", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{
		"sessionId": "deadbeef01234567",
		"index":     "notanumber",
	})
	w := httptest.NewRecorder()

	h.GetHLSSegment(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("non-numeric index: want 400, got %d", w.Code)
	}
}
