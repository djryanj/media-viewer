package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// =============================================================================
// MetricsHandler Tests
// =============================================================================

func TestMetricsHandler(t *testing.T) {
	t.Parallel()

	h := &Handlers{}
	handler := h.MetricsHandler()

	if handler == nil {
		t.Fatal("Expected MetricsHandler to return a non-nil handler")
	}
}

func TestMetricsHandlerReturnsPrometheusHandler(t *testing.T) {
	t.Parallel()

	h := &Handlers{}
	handler := h.MetricsHandler()

	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Verify it returns Prometheus-formatted metrics
	body := w.Body.String()
	if !strings.Contains(body, "# HELP") && !strings.Contains(body, "# TYPE") {
		t.Error("Expected Prometheus metrics format with HELP/TYPE comments")
	}
}

func TestMetricsHandlerHTTPMethods(t *testing.T) {
	t.Parallel()

	h := &Handlers{}
	handler := h.MetricsHandler()

	tests := []struct {
		name           string
		method         string
		expectedStatus int
	}{
		{
			name:           "GET request",
			method:         http.MethodGet,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "HEAD request",
			method:         http.MethodHead,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "POST request",
			method:         http.MethodPost,
			expectedStatus: http.StatusOK, // Prometheus handler accepts all methods
		},
		{
			name:           "PUT request",
			method:         http.MethodPut,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "DELETE request",
			method:         http.MethodDelete,
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/metrics", http.NoBody)
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d for %s, got %d", tt.expectedStatus, tt.method, w.Code)
			}
		})
	}
}

func TestMetricsHandlerContentType(t *testing.T) {
	t.Parallel()

	h := &Handlers{}
	handler := h.MetricsHandler()

	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	contentType := w.Header().Get("Content-Type")
	if !strings.Contains(contentType, "text/plain") {
		t.Errorf("Expected Content-Type to contain 'text/plain', got %q", contentType)
	}
}

func TestMetricsHandlerReturnsStandardMetrics(t *testing.T) {
	t.Parallel()

	h := &Handlers{}
	handler := h.MetricsHandler()

	req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// Check for standard Go runtime metrics
	expectedMetrics := []string{
		"go_goroutines",
		"go_threads",
		"go_memstats",
		"process_",
	}

	for _, metric := range expectedMetrics {
		if !strings.Contains(body, metric) {
			t.Errorf("Expected metrics to contain %q", metric)
		}
	}
}

func TestMetricsHandlerConcurrent(t *testing.T) {
	t.Parallel()

	h := &Handlers{}
	handler := h.MetricsHandler()

	// Make concurrent requests to verify no race conditions
	const numRequests = 10
	done := make(chan bool, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status 200, got %d", w.Code)
			}
			done <- true
		}()
	}

	// Wait for all requests to complete
	for i := 0; i < numRequests; i++ {
		<-done
	}
}

func TestMetricsHandlerNotNil(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		handler *Handlers
	}{
		{
			name:    "Minimal handler",
			handler: &Handlers{},
		},
		{
			name: "Handler with nil fields",
			handler: &Handlers{
				db:         nil,
				indexer:    nil,
				transcoder: nil,
				thumbGen:   nil,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			metricsHandler := tt.handler.MetricsHandler()
			if metricsHandler == nil {
				t.Error("Expected non-nil metrics handler")
			}

			// Verify it's usable
			req := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
			w := httptest.NewRecorder()
			metricsHandler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status 200, got %d", w.Code)
			}
		})
	}
}
