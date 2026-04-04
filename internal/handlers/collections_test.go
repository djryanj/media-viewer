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
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"

	"github.com/gorilla/mux"
)

func setupCollectionsHandlerTest(t *testing.T) (*Handlers, *database.Database) {
	t.Helper()

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")
	mediaDir := filepath.Join(tempDir, "media")
	cacheDir := filepath.Join(tempDir, "cache")

	for _, dir := range []string{mediaDir, cacheDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}

	db, _, err := database.New(context.Background(), dbPath, &database.Options{})
	if err != nil {
		t.Fatalf("database.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	idx := indexer.New(db, mediaDir, 0)
	trans := transcoder.New(cacheDir, "", false, "none")
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil)
	cfg := &startup.Config{MediaDir: mediaDir, CacheDir: cacheDir}

	return New(db, idx, trans, thumbGen, cfg), db
}

func seedCollectionsHandlerFiles(t *testing.T, db *database.Database, files []database.MediaFile) {
	t.Helper()

	ctx := context.Background()
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	var upsertErr error
	for i := range files {
		if err := batch.UpsertFile(ctx, &files[i]); err != nil {
			upsertErr = err
			break
		}
	}

	if err := db.EndBatch(batch, upsertErr); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}
}

func TestCreateCollectionRejectsWhitespaceOnlyName(t *testing.T) {
	t.Parallel()
	h, _ := setupCollectionsHandlerTest(t)

	body := bytes.NewBufferString(`{"name":"   ","paths":["folder-a/a1.jpg"]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/collections", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.CreateCollection(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	if got := w.Body.String(); got != "Name is required\n" {
		t.Fatalf("expected Name is required error, got %q", got)
	}
}

func TestUpdateCollectionRejectsWhitespaceOnlyName(t *testing.T) {
	t.Parallel()
	h, _ := setupCollectionsHandlerTest(t)

	body := bytes.NewBufferString(`{"name":" \t ","coverPath":""}`)
	req := httptest.NewRequest(http.MethodPut, "/api/collections/1", body)
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.UpdateCollection(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	if got := w.Body.String(); got != "Name is required\n" {
		t.Fatalf("expected Name is required error, got %q", got)
	}
}

func TestCreateCollectionDuplicateNameReturnsJSONConflict(t *testing.T) {
	t.Parallel()
	h, db := setupCollectionsHandlerTest(t)

	seedCollectionsHandlerFiles(t, db, []database.MediaFile{
		{
			Name:       "a1.jpg",
			Path:       "folder-a/a1.jpg",
			ParentPath: "folder-a",
			Type:       database.FileTypeImage,
			ModTime:    time.Now(),
		},
	})

	if _, err := db.CreateCollection(context.Background(), "Trip", []string{"folder-a/a1.jpg"}, nil); err != nil {
		t.Fatalf("CreateCollection setup failed: %v", err)
	}

	body := bytes.NewBufferString(`{"name":"  Trip  ","paths":["folder-a/a1.jpg"]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/collections", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.CreateCollection(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", w.Code)
	}
	if got := w.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected application/json content type, got %q", got)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["error"] != "Collection name is already in use. Choose a different name." {
		t.Fatalf("unexpected error payload: %#v", response)
	}
}

func TestAddCollectionItemsFolderConflictReturnsJSONConflict(t *testing.T) {
	t.Parallel()
	h, db := setupCollectionsHandlerTest(t)

	seedCollectionsHandlerFiles(t, db, []database.MediaFile{
		{
			Name:       "a1.jpg",
			Path:       "folder-a/a1.jpg",
			ParentPath: "folder-a",
			Type:       database.FileTypeImage,
			ModTime:    time.Now(),
		},
		{
			Name:       "b1.jpg",
			Path:       "folder-b/b1.jpg",
			ParentPath: "folder-b",
			Type:       database.FileTypeImage,
			ModTime:    time.Now(),
		},
	})

	collection, err := db.CreateCollection(context.Background(), "Trip", []string{"folder-a/a1.jpg"}, nil)
	if err != nil {
		t.Fatalf("CreateCollection setup failed: %v", err)
	}

	body := bytes.NewBufferString(`{"paths":["folder-b/b1.jpg"]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/collections/1/items", body)
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddCollectionItems(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", w.Code)
	}
	if got := w.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected application/json content type, got %q", got)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["error"] != "Collections can't span multiple folders." {
		t.Fatalf("unexpected error payload: %#v", response)
	}

	stored, err := db.GetCollection(context.Background(), collection.ID)
	if err != nil {
		t.Fatalf("GetCollection failed: %v", err)
	}
	if stored.ItemCount != 1 {
		t.Fatalf("expected collection item count to remain 1, got %d", stored.ItemCount)
	}
}

func TestRemoveCollectionItemsBulkRemovesItems(t *testing.T) {
	t.Parallel()
	h, db := setupCollectionsHandlerTest(t)

	seedCollectionsHandlerFiles(t, db, []database.MediaFile{
		{
			Name:       "a1.jpg",
			Path:       "folder-a/a1.jpg",
			ParentPath: "folder-a",
			Type:       database.FileTypeImage,
			ModTime:    time.Now(),
		},
		{
			Name:       "a2.jpg",
			Path:       "folder-a/a2.jpg",
			ParentPath: "folder-a",
			Type:       database.FileTypeImage,
			ModTime:    time.Now(),
		},
		{
			Name:       "a3.jpg",
			Path:       "folder-a/a3.jpg",
			ParentPath: "folder-a",
			Type:       database.FileTypeImage,
			ModTime:    time.Now(),
		},
	})

	collection, err := db.CreateCollection(context.Background(), "Trip", []string{"folder-a/a1.jpg", "folder-a/a2.jpg", "folder-a/a3.jpg"}, nil)
	if err != nil {
		t.Fatalf("CreateCollection setup failed: %v", err)
	}

	body := bytes.NewBufferString(`{"paths":["folder-a/a1.jpg","folder-a/a2.jpg"]}`)
	req := httptest.NewRequest(http.MethodDelete, "/api/collections/1/items", body)
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.RemoveCollectionItems(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if got := w.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected application/json content type, got %q", got)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["status"] != "ok" {
		t.Fatalf("unexpected status payload: %#v", response)
	}

	stored, err := db.GetCollection(context.Background(), collection.ID)
	if err != nil {
		t.Fatalf("GetCollection failed: %v", err)
	}
	if stored.CoverPath != "folder-a/a3.jpg" {
		t.Fatalf("expected cover folder-a/a3.jpg, got %q", stored.CoverPath)
	}
	if stored.ItemCount != 1 {
		t.Fatalf("expected item count 1, got %d", stored.ItemCount)
	}
}
