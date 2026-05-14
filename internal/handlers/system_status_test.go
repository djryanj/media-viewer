package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"media-viewer/internal/autotagger"
	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

type systemStatusAutoTaggerStub struct {
	enabled bool
	status  autotagger.Status
}

func (s *systemStatusAutoTaggerStub) TriggerRun() {}

func (s *systemStatusAutoTaggerStub) Status() autotagger.Status {
	return s.status
}

func (s *systemStatusAutoTaggerStub) Enabled() bool {
	return s.enabled
}

func TestGetSystemStatus(t *testing.T) {
	t.Parallel()

	t.Run("returns aggregate worker status", func(t *testing.T) {
		t.Parallel()

		tempDir := t.TempDir()
		dbPath := tempDir + "/test.db"
		mediaDir := tempDir + "/media"
		cacheDir := tempDir + "/cache"

		for _, dir := range []string{mediaDir, cacheDir} {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatalf("failed to create %s: %v", dir, err)
			}
		}

		db, _, err := database.New(context.Background(), dbPath, &database.Options{})
		if err != nil {
			t.Fatalf("failed to create db: %v", err)
		}
		defer func() {
			if err := db.Close(); err != nil {
				t.Fatalf("failed to close db: %v", err)
			}
		}()

		if err := db.AddFavorite(context.Background(), "folder/example.jpg", "example.jpg", database.FileTypeImage); err != nil {
			t.Fatalf("failed to add favorite: %v", err)
		}

		idx := indexer.New(db, mediaDir, 0)
		thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil)
		autoTagger := &systemStatusAutoTaggerStub{
			enabled: true,
			status: autotagger.Status{
				Run: autotagger.RunStatus{
					InProgress:  true,
					StartedAt:   time.Now().Add(-10 * time.Second),
					TotalFiles:  120,
					Processed:   30,
					CurrentFile: "folder/example.jpg",
				},
			},
		}

		h := New(
			db,
			idx,
			transcoder.New(cacheDir, "", false, "none"),
			thumbGen,
			&startup.Config{MediaDir: mediaDir, CacheDir: cacheDir},
			autoTagger,
		)

		req := httptest.NewRequest(http.MethodGet, "/api/system/status", http.NoBody)
		w := httptest.NewRecorder()

		h.GetSystemStatus(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
		}

		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Fatalf("content-type = %q, want application/json", ct)
		}

		var resp SystemStatusResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("decode response: %v", err)
		}

		if resp.Indexer.Summary.State != "idle" {
			t.Fatalf("indexer state = %q, want idle", resp.Indexer.Summary.State)
		}

		if resp.Library.TotalFavorites != 1 {
			t.Fatalf("favorites = %d, want 1", resp.Library.TotalFavorites)
		}

		if resp.Thumbnails.Summary.State != "disabled" {
			t.Fatalf("thumbnail state = %q, want disabled", resp.Thumbnails.Summary.State)
		}

		if resp.AutoTagger.Summary.State != "running" {
			t.Fatalf("autotagger state = %q, want running", resp.AutoTagger.Summary.State)
		}

		if resp.AutoTagger.Metrics.ItemsPerSecond == nil || *resp.AutoTagger.Metrics.ItemsPerSecond <= 0 {
			t.Fatalf("expected autotagger itemsPerSecond to be populated, got %+v", resp.AutoTagger.Metrics)
		}

		if resp.AutoTagger.Metrics.EstimatedCompletion == nil {
			t.Fatalf("expected autotagger ETA to be populated, got %+v", resp.AutoTagger.Metrics)
		}

		if resp.Thumbnails.Metrics.ItemsPerSecond != nil {
			t.Fatalf("expected idle thumbnail rate to be omitted, got %+v", resp.Thumbnails.Metrics)
		}
	})

	t.Run("rejects non-GET methods", func(t *testing.T) {
		t.Parallel()

		h := &Handlers{}
		req := httptest.NewRequest(http.MethodPost, "/api/system/status", http.NoBody)
		w := httptest.NewRecorder()

		h.GetSystemStatus(w, req)

		if w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusMethodNotAllowed)
		}
	})
}
