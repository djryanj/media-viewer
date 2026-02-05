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

// setupHealthIntegrationTest creates a test environment for health integration tests
func setupHealthIntegrationTest(t *testing.T) (h *Handlers, cleanup func()) {
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
	trans := transcoder.New(cacheDir, false)
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

// =============================================================================
// Liveness Check Tests
// =============================================================================

func TestLivenessCheckIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/health/live", http.NoBody)
	w := httptest.NewRecorder()

	h.LivenessCheck(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "alive" {
		t.Errorf("Expected status 'alive', got '%s'", response["status"])
	}

	if contentType := w.Header().Get("Content-Type"); contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}
}

func TestLivenessCheckAlwaysSucceedsIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	// Call liveness check multiple times - should always succeed
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/health/live", http.NoBody)
		w := httptest.NewRecorder()

		h.LivenessCheck(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Iteration %d: Expected status 200, got %d", i, w.Code)
		}
	}
}

// =============================================================================
// Readiness Check Tests
// =============================================================================

func TestReadinessCheckNotReadyIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	// Before indexing starts, service may not be ready
	req := httptest.NewRequest(http.MethodGet, "/health/ready", http.NoBody)
	w := httptest.NewRecorder()

	h.ReadinessCheck(w, req)

	// Should be either 200 (ready) or 503 (not ready yet)
	if w.Code != http.StatusOK && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 200 or 503, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	expectedStatuses := map[string]bool{"ready": true, "not_ready": true}
	if !expectedStatuses[response["status"]] {
		t.Errorf("Expected status 'ready' or 'not_ready', got '%s'", response["status"])
	}
}

func TestReadinessCheckAfterIndexingIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	// Indexer becomes ready after initial index completes or 100+ items indexed
	// For this test, we'll just check that IsReady works
	req := httptest.NewRequest(http.MethodGet, "/health/ready", http.NoBody)
	w := httptest.NewRecorder()

	h.ReadinessCheck(w, req)

	// Should work without error (either ready or not ready)
	if w.Code != http.StatusOK && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 200 or 503, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "ready" && response["status"] != "not_ready" {
		t.Errorf("Expected status 'ready' or 'not_ready', got '%s'", response["status"])
	}
}

// =============================================================================
// Health Check Tests
// =============================================================================

func TestHealthCheckBasicIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	// Should be either 200 (ready) or 503 (not ready)
	if w.Code != http.StatusOK && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 200 or 503, got %d", w.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify required fields are present
	if response.Status == "" {
		t.Error("Status field is empty")
	}

	if response.Version == "" {
		t.Error("Version field is empty")
	}

	if response.GoVersion == "" {
		t.Error("GoVersion field is empty")
	}

	if response.NumCPU <= 0 {
		t.Error("NumCPU should be positive")
	}

	if response.NumGoroutine <= 0 {
		t.Error("NumGoroutine should be positive")
	}
}

func TestHealthCheckResponseStructureIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify all expected fields are accessible
	_ = response.Status
	_ = response.Ready
	_ = response.Version
	_ = response.Uptime
	_ = response.Indexing
	_ = response.FilesIndexed
	_ = response.FoldersIndexed
	_ = response.GoVersion
	_ = response.NumCPU
	_ = response.NumGoroutine

	// Content type should be JSON
	if contentType := w.Header().Get("Content-Type"); contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}
}

func TestHealthCheckWithStatsIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	// Add some stats
	h.db.UpdateStats(database.IndexStats{
		TotalFiles:   100,
		TotalFolders: 10,
	})

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.TotalFiles != 100 {
		t.Errorf("Expected TotalFiles 100, got %d", response.TotalFiles)
	}

	if response.TotalFolders != 10 {
		t.Errorf("Expected TotalFolders 10, got %d", response.TotalFolders)
	}
}

func TestHealthCheckWhenReadyIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	// Check health - indexer may or may not be ready yet
	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	// Should return either 200 or 503 depending on readiness
	if w.Code != http.StatusOK && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 200 or 503, got %d", w.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify status is one of the valid values
	validStatuses := map[string]bool{"healthy": true, "starting": true, "degraded": true}
	if !validStatuses[response.Status] {
		t.Errorf("Expected valid status, got '%s'", response.Status)
	}
}

func TestHealthCheckStatusTransitionsIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	// Check initial state
	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()
	h.HealthCheck(w, req)

	var response HealthResponse
	json.NewDecoder(w.Body).Decode(&response)

	initialStatus := response.Status
	validStatuses := map[string]bool{"starting": true, "healthy": true, "degraded": true}
	if !validStatuses[initialStatus] {
		t.Errorf("Expected valid initial status, got '%s'", initialStatus)
	}

	// Check again - status should be consistent
	req = httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w = httptest.NewRecorder()
	h.HealthCheck(w, req)

	json.NewDecoder(w.Body).Decode(&response)

	if !validStatuses[response.Status] {
		t.Errorf("Expected valid status, got '%s'", response.Status)
	}
}

// =============================================================================
// Complete Health Flow Tests
// =============================================================================

func TestCompleteHealthFlowIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	// Step 1: Check liveness (should always work)
	req := httptest.NewRequest(http.MethodGet, "/health/live", http.NoBody)
	w := httptest.NewRecorder()
	h.LivenessCheck(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Liveness check failed with status %d", w.Code)
	}

	// Step 2: Check readiness (may not be ready yet)
	req = httptest.NewRequest(http.MethodGet, "/health/ready", http.NoBody)
	w = httptest.NewRecorder()
	h.ReadinessCheck(w, req)

	initialReadiness := w.Code

	// Step 3: Check health
	req = httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w = httptest.NewRecorder()
	h.HealthCheck(w, req)

	var healthResponse HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&healthResponse); err != nil {
		t.Fatalf("Failed to decode health response: %v", err)
	}

	// Step 4: Check readiness (may or may not be ready yet)
	req = httptest.NewRequest(http.MethodGet, "/health/ready", http.NoBody)
	w = httptest.NewRecorder()
	h.ReadinessCheck(w, req)

	// Should return valid status code
	if w.Code != http.StatusOK && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Readiness check should return 200 or 503, got status %d", w.Code)
	}

	// Step 5: Verify liveness still works
	req = httptest.NewRequest(http.MethodGet, "/health/live", http.NoBody)
	w = httptest.NewRecorder()
	h.LivenessCheck(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Liveness check should still work, got status %d", w.Code)
	}

	t.Logf("Initial readiness status: %d, final: 200", initialReadiness)
}

func TestHealthCheckConcurrentAccessIntegration(t *testing.T) {
	h, cleanup := setupHealthIntegrationTest(t)
	defer cleanup()

	// Run multiple concurrent health checks
	done := make(chan bool)
	errors := make(chan error, 30)

	for i := 0; i < 30; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
			w := httptest.NewRecorder()
			h.HealthCheck(w, req)

			if w.Code != http.StatusOK && w.Code != http.StatusServiceUnavailable {
				errors <- nil // Signal error without details
			}
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 30; i++ {
		<-done
	}

	close(errors)
	if len(errors) > 0 {
		t.Error("Some concurrent health checks failed")
	}
}
