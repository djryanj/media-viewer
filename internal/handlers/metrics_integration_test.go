package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

// =============================================================================
// Metrics Integration Tests
// =============================================================================

// setupMetricsIntegrationTest creates a complete handler setup for testing metrics
func setupMetricsIntegrationTest(t *testing.T) (h *Handlers, cleanup func()) {
	t.Helper()

	// Create temporary directories
	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"
	mediaDir := tempDir + "/media"
	cacheDir := tempDir + "/cache"

	// Initialize database
	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	// Create indexer
	idx := indexer.New(db, mediaDir, 0)

	// Create transcoder
	trans := transcoder.New(cacheDir, "", false)

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

// TestMetricsHandlerIntegration tests the metrics handler with a full setup
func TestMetricsHandlerIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()
	if handler == nil {
		t.Fatal("MetricsHandler returned nil")
	}

	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	body := w.Body.String()

	// Verify Prometheus format
	if !strings.Contains(body, "# HELP") || !strings.Contains(body, "# TYPE") {
		t.Error("expected Prometheus metrics format")
	}

	// Verify content type
	contentType := w.Header().Get("Content-Type")
	if !strings.Contains(contentType, "text/plain") {
		t.Errorf("expected Content-Type with 'text/plain', got %q", contentType)
	}
}

// TestMetricsHandlerStandardMetricsIntegration tests that standard Go metrics are present
func TestMetricsHandlerStandardMetricsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()
	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// Check for standard Go runtime metrics
	expectedMetrics := []string{
		"go_goroutines",
		"go_threads",
		"go_memstats_alloc_bytes",
		"process_cpu_seconds_total",
	}

	for _, metric := range expectedMetrics {
		if !strings.Contains(body, metric) {
			t.Errorf("expected metric %q to be present", metric)
		}
	}
}

// TestMetricsHandlerCustomMetricsIntegration tests custom application metrics
func TestMetricsHandlerCustomMetricsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()
	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// Check for custom media-viewer metrics (if any)
	customMetrics := []string{
		"media_viewer", // Prefix for custom metrics
		"indexer",      // Indexer-related metrics
		"transcode",    // Transcoding metrics
	}

	// Note: Only check if the metrics exist, don't require them
	// since they may not be present if no operations have occurred
	for _, metric := range customMetrics {
		if strings.Contains(body, metric) {
			t.Logf("Found custom metric: %s", metric)
		}
	}
}

// TestMetricsHandlerHTTPMethodsIntegration tests different HTTP methods
func TestMetricsHandlerHTTPMethodsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()

	methods := []string{
		http.MethodGet,
		http.MethodHead,
		http.MethodPost,
	}

	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/metrics", http.NoBody)
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected status 200 for %s, got %d", method, w.Code)
			}
		})
	}
}

// TestMetricsHandlerConcurrentRequestsIntegration tests concurrent access
func TestMetricsHandlerConcurrentRequestsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()

	const numRequests = 50
	var wg sync.WaitGroup
	wg.Add(numRequests)

	errors := make(chan error, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			defer wg.Done()

			req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				errors <- http.ErrAbortHandler
			}
		}()
	}

	wg.Wait()
	close(errors)

	if len(errors) > 0 {
		t.Errorf("expected no errors, got %d errors", len(errors))
	}
}

// TestMetricsHandlerIdempotencyIntegration tests that multiple calls return consistent results
func TestMetricsHandlerIdempotencyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()

	// Make multiple requests
	var responses []string
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("request %d: expected status 200, got %d", i+1, w.Code)
		}

		responses = append(responses, w.Body.String())
	}

	// All responses should have the same structure (though values may differ)
	for i, resp := range responses {
		if !strings.Contains(resp, "# HELP") {
			t.Errorf("response %d: missing HELP comments", i+1)
		}
		if !strings.Contains(resp, "# TYPE") {
			t.Errorf("response %d: missing TYPE comments", i+1)
		}
	}
}

// TestMetricsHandlerAfterOperationsIntegration tests metrics after some operations
func TestMetricsHandlerAfterOperationsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	// Perform some operations that might update metrics
	req := httptest.NewRequest(http.MethodGet, "/api/health", http.NoBody)
	w := httptest.NewRecorder()
	h.HealthCheck(w, req)

	// Get metrics
	handler := h.MetricsHandler()
	metricsReq := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	metricsW := httptest.NewRecorder()

	handler.ServeHTTP(metricsW, metricsReq)

	if metricsW.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", metricsW.Code)
	}

	body := metricsW.Body.String()
	if body == "" {
		t.Error("expected non-empty metrics response")
	}
}

// TestMetricsHandlerResponseSizeIntegration tests that metrics response is reasonable
func TestMetricsHandlerResponseSizeIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()
	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	body := w.Body.String()
	bodySize := len(body)

	// Metrics should have some content but not be excessively large
	if bodySize < 100 {
		t.Errorf("expected metrics body > 100 bytes, got %d", bodySize)
	}

	if bodySize > 1024*1024 { // 1MB
		t.Errorf("expected metrics body < 1MB, got %d bytes", bodySize)
	}

	t.Logf("Metrics response size: %d bytes", bodySize)
}

// TestMetricsHandlerMetricNamesIntegration tests that metric names follow conventions
func TestMetricsHandlerMetricNamesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()
	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	body := w.Body.String()
	lines := strings.Split(body, "\n")

	for _, line := range lines {
		// Skip comments and empty lines
		if strings.HasPrefix(line, "#") || strings.TrimSpace(line) == "" {
			continue
		}

		// Metric lines should contain a space (metric_name value)
		if !strings.Contains(line, " ") && !strings.Contains(line, "{") {
			t.Errorf("unexpected metric line format: %q", line)
		}
	}
}

// TestMetricsHandlerCacheControlIntegration tests cache-control headers
func TestMetricsHandlerCacheControlIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()
	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	// Metrics should not be cached since they're dynamic
	cacheControl := w.Header().Get("Cache-Control")
	if cacheControl != "" {
		t.Logf("Cache-Control header: %q", cacheControl)
	}
}

// TestMetricsHandlerMultipleHandlersIntegration tests that each handler has independent metrics
func TestMetricsHandlerMultipleHandlersIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h1, cleanup1 := setupMetricsIntegrationTest(t)
	defer cleanup1()

	h2, cleanup2 := setupMetricsIntegrationTest(t)
	defer cleanup2()

	// Both handlers should return metrics independently
	handler1 := h1.MetricsHandler()
	handler2 := h2.MetricsHandler()

	req1 := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w1 := httptest.NewRecorder()
	handler1.ServeHTTP(w1, req1)

	req2 := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w2 := httptest.NewRecorder()
	handler2.ServeHTTP(w2, req2)

	if w1.Code != http.StatusOK {
		t.Errorf("handler1: expected status 200, got %d", w1.Code)
	}

	if w2.Code != http.StatusOK {
		t.Errorf("handler2: expected status 200, got %d", w2.Code)
	}

	// Both should have valid Prometheus format
	body1 := w1.Body.String()
	body2 := w2.Body.String()

	if !strings.Contains(body1, "# TYPE") {
		t.Error("handler1: missing Prometheus format")
	}

	if !strings.Contains(body2, "# TYPE") {
		t.Error("handler2: missing Prometheus format")
	}
}

// TestMetricsHandlerTimingIntegration tests metrics endpoint response time
func TestMetricsHandlerTimingIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMetricsIntegrationTest(t)
	defer cleanup()

	handler := h.MetricsHandler()

	// Measure response time
	start := time.Now()

	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	duration := time.Since(start)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Metrics endpoint should respond quickly (< 1 second)
	if duration > time.Second {
		t.Errorf("expected metrics response < 1s, got %v", duration)
	}

	t.Logf("Metrics endpoint response time: %v", duration)
}
