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
)

// addPhantomFileToDatabase indexes a file that does not exist on disk — the
// state the library lands in whenever media is moved or deleted between index
// runs.
func addPhantomFileToDatabase(t *testing.T, h *Handlers, relativePath string, fileType database.FileType) {
	t.Helper()

	parentPath := filepath.Dir(relativePath)
	if parentPath == "." {
		parentPath = ""
	}

	ctx := context.Background()
	batch, err := h.db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("failed to begin batch: %v", err)
	}

	upsertErr := batch.UpsertFile(ctx, &database.MediaFile{
		Name:       filepath.Base(relativePath),
		Path:       relativePath,
		ParentPath: parentPath,
		Type:       fileType,
		Size:       1024,
		ModTime:    time.Now(),
	})
	if endErr := h.db.EndBatch(batch, upsertErr); endErr != nil {
		t.Fatalf("failed to end batch: %v", endErr)
	}
}

// TestGetThumbnailMissingSourceStillReturns404 guards the status code now that
// the handler no longer pre-stats the source file: the 404 has to come from the
// generator's own not-found error instead.
func TestGetThumbnailMissingSourceStillReturns404(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	h, cleanup := setupMediaIntegrationTestWithThumbnails(t)
	defer cleanup()

	addPhantomFileToDatabase(t, h, "moved-away.jpg", database.FileTypeImage)

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/moved-away.jpg", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "moved-away.jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for an indexed file missing from disk, got %d: %s", w.Code, w.Body.String())
	}
}

// TestGetThumbnailServesCachedThumbnailForMissingSource is the payoff for the
// cache-first ordering: a thumbnail already on local disk is returned without
// the handler or the generator reaching for the media volume.
func TestGetThumbnailServesCachedThumbnailForMissingSource(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	h, cleanup := setupMediaIntegrationTestWithThumbnails(t)
	defer cleanup()

	relativePath := "moved-away.jpg"
	addPhantomFileToDatabase(t, h, relativePath, database.FileTypeImage)

	cached := append([]byte{0xFF, 0xD8}, []byte("cached thumbnail")...)
	cacheKey := h.thumbGen.CacheKey(filepath.Join(h.mediaDir, relativePath), database.FileTypeImage)
	if err := os.WriteFile(filepath.Join(h.cacheDir, cacheKey), cached, 0o644); err != nil {
		t.Fatalf("failed to seed cached thumbnail: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/"+relativePath, http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": relativePath})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 from the local cache, got %d: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != string(cached) {
		t.Errorf("expected the cached thumbnail bytes, got %q", w.Body.String())
	}
}
