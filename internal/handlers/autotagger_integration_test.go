package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	"media-viewer/internal/autotagger"
	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

// stubAutoTagRunner is a minimal AutoTagRunner implementation for integration
// tests.  It records call count and does not spawn any goroutines.
type stubAutoTagRunner struct {
	calls   atomic.Int32
	enabled bool
}

func (s *stubAutoTagRunner) TriggerRun() {
	s.calls.Add(1)
}

func (s *stubAutoTagRunner) Status() autotagger.Status {
	return autotagger.Status{}
}

func (s *stubAutoTagRunner) Enabled() bool {
	return s.enabled
}

// setupAutoTaggerIntegrationTest creates a real *Handlers wired with a
// stubAutoTagRunner, suitable for integration-level HTTP testing.
func setupAutoTaggerIntegrationTest(t *testing.T) (h *Handlers, stub *stubAutoTagRunner, cleanup func()) {
	t.Helper()

	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"
	mediaDir := tempDir + "/media"
	cacheDir := tempDir + "/cache"

	for _, dir := range []string{mediaDir, cacheDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("failed to create directory %s: %v", dir, err)
		}
	}

	db, _, err := database.New(context.Background(), dbPath, &database.Options{})
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	idx := indexer.New(db, mediaDir, 0)
	trans := transcoder.New(cacheDir, "", false, "none")
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil)
	config := &startup.Config{MediaDir: mediaDir, CacheDir: cacheDir}

	stub = &stubAutoTagRunner{enabled: true}
	h = New(db, idx, trans, thumbGen, config, stub)

	cleanup = func() {
		if err := db.Close(); err != nil {
			t.Logf("failed to close database: %v", err)
		}
	}

	return h, stub, cleanup
}

// TestRunAutoTaggerIntegration exercises RunAutoTagger with a real *Handlers
// instance (real DB, real dependencies) over the full HTTP request cycle.
func TestRunAutoTaggerIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	t.Run("POST returns 202 and triggers run", func(t *testing.T) {
		h, stub, cleanup := setupAutoTaggerIntegrationTest(t)
		defer cleanup()

		req := httptest.NewRequest(http.MethodPost, "/api/autotagger/run", http.NoBody)
		w := httptest.NewRecorder()

		h.RunAutoTagger(w, req)

		if w.Code != http.StatusAccepted {
			t.Errorf("status = %d, want %d", w.Code, http.StatusAccepted)
		}

		if got := stub.calls.Load(); got != 1 {
			t.Errorf("TriggerRun calls = %d, want 1", got)
		}

		var resp map[string]interface{}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if success, ok := resp["success"].(bool); !ok || !success {
			t.Errorf("expected success=true, got %v", resp)
		}
	})

	t.Run("nil autoTagger returns 503", func(t *testing.T) {
		h, _, cleanup := setupAutoTaggerIntegrationTest(t)
		defer cleanup()
		h.autoTagger = nil // override to test nil guard

		req := httptest.NewRequest(http.MethodPost, "/api/autotagger/run", http.NoBody)
		w := httptest.NewRecorder()

		h.RunAutoTagger(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
		}
	})

	t.Run("wrong method returns 405", func(t *testing.T) {
		h, _, cleanup := setupAutoTaggerIntegrationTest(t)
		defer cleanup()

		req := httptest.NewRequest(http.MethodGet, "/api/autotagger/run", http.NoBody)
		w := httptest.NewRecorder()

		h.RunAutoTagger(w, req)

		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want %d", w.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("system status includes autotagger", func(t *testing.T) {
		h, _, cleanup := setupAutoTaggerIntegrationTest(t)
		defer cleanup()

		req := httptest.NewRequest(http.MethodGet, "/api/system/status", http.NoBody)
		w := httptest.NewRecorder()

		h.GetSystemStatus(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
		}

		var resp SystemStatusResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if !resp.AutoTagger.Summary.Enabled {
			t.Fatal("expected autotagger summary to be enabled")
		}
	})
}
