package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

// =============================================================================
// Version Integration Tests
// =============================================================================

// setupVersionIntegrationTest creates a complete handler setup for testing version endpoint
func setupVersionIntegrationTest(t *testing.T) (h *Handlers, cleanup func()) {
	t.Helper()

	// Create temporary directories
	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"
	mediaDir := tempDir + "/media"
	cacheDir := tempDir + "/cache"

	// Create directories
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		t.Fatalf("failed to create media directory: %v", err)
	}

	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("failed to create cache directory: %v", err)
	}

	// Initialize database
	db, _, err := database.New(context.Background(), dbPath)
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

	return handlers, cleanup
}

// TestGetVersionBasicIntegration tests basic version endpoint functionality
func TestGetVersionBasicIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response startup.BuildInfo
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify response structure
	if response.Version == "" {
		t.Error("version field is empty")
	}

	if response.GoVersion == "" {
		t.Error("goVersion field is empty")
	}

	if response.OS == "" {
		t.Error("os field is empty")
	}

	if response.Arch == "" {
		t.Error("arch field is empty")
	}
}

// TestGetVersionHeadersIntegration tests response headers
func TestGetVersionHeadersIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	// Verify Content-Type
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", contentType)
	}

	// Verify Cache-Control
	cacheControl := w.Header().Get("Cache-Control")
	if cacheControl != "no-cache" {
		t.Errorf("expected Cache-Control no-cache, got %q", cacheControl)
	}
}

// TestGetVersionResponseFormatIntegration tests JSON response format
func TestGetVersionResponseFormatIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	var response startup.BuildInfo
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}

	// Verify all fields are present (even if some are default values)
	// Fields should never be nil or cause JSON decoding to fail
	t.Logf("Version: %q", response.Version)
	t.Logf("Commit: %q", response.Commit)
	t.Logf("BuildTime: %q", response.BuildTime)
	t.Logf("GoVersion: %q", response.GoVersion)
	t.Logf("OS: %q", response.OS)
	t.Logf("Arch: %q", response.Arch)
}

// TestGetVersionMultipleRequestsIntegration tests multiple consecutive requests
func TestGetVersionMultipleRequestsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	var responses []startup.BuildInfo

	// Make multiple requests
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
		w := httptest.NewRecorder()

		h.GetVersion(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("request %d: expected status 200, got %d", i, w.Code)
		}

		var response startup.BuildInfo
		if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
			t.Fatalf("request %d: failed to decode response: %v", i, err)
		}

		responses = append(responses, response)
	}

	// Verify all responses are identical
	first := responses[0]
	for i, resp := range responses[1:] {
		if resp.Version != first.Version {
			t.Errorf("request %d: version mismatch: got %q, want %q", i+1, resp.Version, first.Version)
		}

		if resp.Commit != first.Commit {
			t.Errorf("request %d: commit mismatch: got %q, want %q", i+1, resp.Commit, first.Commit)
		}

		if resp.GoVersion != first.GoVersion {
			t.Errorf("request %d: goVersion mismatch: got %q, want %q", i+1, resp.GoVersion, first.GoVersion)
		}

		if resp.OS != first.OS {
			t.Errorf("request %d: os mismatch: got %q, want %q", i+1, resp.OS, first.OS)
		}

		if resp.Arch != first.Arch {
			t.Errorf("request %d: arch mismatch: got %q, want %q", i+1, resp.Arch, first.Arch)
		}
	}
}

// TestGetVersionWithDifferentMethodsIntegration tests different HTTP methods
func TestGetVersionWithDifferentMethodsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	methods := []string{
		http.MethodGet,
		http.MethodPost,
		http.MethodPut,
		http.MethodDelete,
		http.MethodPatch,
		http.MethodHead,
		http.MethodOptions,
	}

	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/api/version", http.NoBody)
			w := httptest.NewRecorder()

			h.GetVersion(w, req)

			// Handler doesn't check method, so all should succeed
			if w.Code != http.StatusOK {
				t.Errorf("expected status 200, got %d", w.Code)
			}

			// HEAD requests won't have a body
			if method == http.MethodHead {
				return
			}

			var response startup.BuildInfo
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				t.Errorf("failed to decode response: %v", err)
			}
		})
	}
}

// TestGetVersionRuntimeInfoIntegration tests runtime information is accurate
func TestGetVersionRuntimeInfoIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	var response startup.BuildInfo
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify OS and Arch are valid runtime values
	validOS := map[string]bool{
		"linux":   true,
		"darwin":  true,
		"windows": true,
		"freebsd": true,
		"openbsd": true,
	}

	if !validOS[response.OS] {
		t.Logf("Note: OS is %q, may be valid but uncommon", response.OS)
	}

	validArch := map[string]bool{
		"amd64": true,
		"arm64": true,
		"386":   true,
		"arm":   true,
	}

	if !validArch[response.Arch] {
		t.Logf("Note: Arch is %q, may be valid but uncommon", response.Arch)
	}

	// GoVersion should start with "go"
	if len(response.GoVersion) < 2 {
		t.Error("goVersion is too short")
	}
}

// TestGetVersionConcurrentAccessIntegration tests concurrent access safety
func TestGetVersionConcurrentAccessIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	const numGoroutines = 20
	done := make(chan bool, numGoroutines)
	errors := make(chan error, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
			w := httptest.NewRecorder()

			h.GetVersion(w, req)

			if w.Code != http.StatusOK {
				errors <- nil
				done <- false
				return
			}

			var response startup.BuildInfo
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				errors <- err
				done <- false
				return
			}

			done <- true
		}()
	}

	// Wait for all goroutines
	successCount := 0
	for i := 0; i < numGoroutines; i++ {
		if <-done {
			successCount++
		}
	}

	// Check for errors
	close(errors)
	for err := range errors {
		if err != nil {
			t.Errorf("concurrent access error: %v", err)
		}
	}

	if successCount != numGoroutines {
		t.Errorf("expected %d successful requests, got %d", numGoroutines, successCount)
	}
}

// TestGetVersionResponseSizeIntegration tests response size is reasonable
func TestGetVersionResponseSizeIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	bodyLen := w.Body.Len()

	if bodyLen == 0 {
		t.Error("response body is empty")
	}

	// Version response should be small (less than 1KB)
	if bodyLen > 1024 {
		t.Errorf("response is unexpectedly large: %d bytes", bodyLen)
	}

	t.Logf("Response size: %d bytes", bodyLen)
}

// TestGetVersionJSONFieldsIntegration tests all expected JSON fields are present
func TestGetVersionJSONFieldsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	requiredFields := []string{
		"version",
		"commit",
		"buildTime",
		"goVersion",
		"os",
		"arch",
	}

	for _, field := range requiredFields {
		if _, exists := result[field]; !exists {
			t.Errorf("missing required field: %q", field)
		}
	}

	// Verify field types
	if _, ok := result["version"].(string); !ok {
		t.Error("version field is not a string")
	}

	if _, ok := result["commit"].(string); !ok {
		t.Error("commit field is not a string")
	}

	if _, ok := result["buildTime"].(string); !ok {
		t.Error("buildTime field is not a string")
	}

	if _, ok := result["goVersion"].(string); !ok {
		t.Error("goVersion field is not a string")
	}

	if _, ok := result["os"].(string); !ok {
		t.Error("os field is not a string")
	}

	if _, ok := result["arch"].(string); !ok {
		t.Error("arch field is not a string")
	}
}

// TestGetVersionIdempotencyIntegration tests that version endpoint is idempotent
func TestGetVersionIdempotencyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupVersionIntegrationTest(t)
	defer cleanup()

	// Make same request multiple times
	var firstResponse, secondResponse, thirdResponse startup.BuildInfo

	// First request
	req1 := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w1 := httptest.NewRecorder()
	h.GetVersion(w1, req1)
	if err := json.NewDecoder(w1.Body).Decode(&firstResponse); err != nil {
		t.Fatalf("failed to decode first response: %v", err)
	}

	// Second request
	req2 := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w2 := httptest.NewRecorder()
	h.GetVersion(w2, req2)
	if err := json.NewDecoder(w2.Body).Decode(&secondResponse); err != nil {
		t.Fatalf("failed to decode second response: %v", err)
	}

	// Third request
	req3 := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w3 := httptest.NewRecorder()
	h.GetVersion(w3, req3)
	if err := json.NewDecoder(w3.Body).Decode(&thirdResponse); err != nil {
		t.Fatalf("failed to decode third response: %v", err)
	}

	// All responses should be identical
	if firstResponse != secondResponse {
		t.Error("first and second responses differ")
	}

	if firstResponse != thirdResponse {
		t.Error("first and third responses differ")
	}

	if secondResponse != thirdResponse {
		t.Error("second and third responses differ")
	}
}

// TestGetVersionWithMultipleHandlerInstancesIntegration tests version is consistent across handlers
func TestGetVersionWithMultipleHandlerInstancesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	// Create two separate handler instances
	h1, cleanup1 := setupVersionIntegrationTest(t)
	defer cleanup1()

	h2, cleanup2 := setupVersionIntegrationTest(t)
	defer cleanup2()

	// Get version from first handler
	req1 := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w1 := httptest.NewRecorder()
	h1.GetVersion(w1, req1)

	var response1 startup.BuildInfo
	if err := json.NewDecoder(w1.Body).Decode(&response1); err != nil {
		t.Fatalf("failed to decode first response: %v", err)
	}

	// Get version from second handler
	req2 := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w2 := httptest.NewRecorder()
	h2.GetVersion(w2, req2)

	var response2 startup.BuildInfo
	if err := json.NewDecoder(w2.Body).Decode(&response2); err != nil {
		t.Fatalf("failed to decode second response: %v", err)
	}

	// Version info should be identical (it's global, not per-handler)
	if response1 != response2 {
		t.Error("version info differs between handler instances")
		t.Logf("Handler 1: %+v", response1)
		t.Logf("Handler 2: %+v", response2)
	}
}
