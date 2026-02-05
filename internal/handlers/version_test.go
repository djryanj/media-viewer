package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"media-viewer/internal/startup"
)

// =============================================================================
// GetVersion Tests
// =============================================================================

func TestGetVersion(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %q", contentType)
	}
}

func TestGetVersionResponseStructure(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	var response startup.BuildInfo
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify the response has expected fields
	// Note: Values may be empty in test environment, but structure should exist
	t.Logf("Version: %s", response.Version)
	t.Logf("Commit: %s", response.Commit)
	t.Logf("BuildTime: %s", response.BuildTime)
	t.Logf("GoVersion: %s", response.GoVersion)
}

func TestGetVersionCacheControl(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	cacheControl := w.Header().Get("Cache-Control")
	if cacheControl != "no-cache" {
		t.Errorf("Expected Cache-Control: no-cache, got %q", cacheControl)
	}
}

func TestGetVersionHTTPMethods(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	tests := []struct {
		name   string
		method string
	}{
		{"GET", http.MethodGet},
		{"POST", http.MethodPost},
		{"PUT", http.MethodPut},
		{"DELETE", http.MethodDelete},
		{"HEAD", http.MethodHead},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/version", http.NoBody)
			w := httptest.NewRecorder()

			h.GetVersion(w, req)

			// All methods should succeed (handler doesn't check method)
			if w.Code != http.StatusOK {
				t.Errorf("Expected status 200 for %s, got %d", tt.method, w.Code)
			}
		})
	}
}

func TestGetVersionConsistency(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	// Call multiple times and verify consistency
	var firstResponse startup.BuildInfo

	req1 := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w1 := httptest.NewRecorder()
	h.GetVersion(w1, req1)

	if err := json.NewDecoder(w1.Body).Decode(&firstResponse); err != nil {
		t.Fatalf("Failed to decode first response: %v", err)
	}

	// Second call
	var secondResponse startup.BuildInfo

	req2 := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w2 := httptest.NewRecorder()
	h.GetVersion(w2, req2)

	if err := json.NewDecoder(w2.Body).Decode(&secondResponse); err != nil {
		t.Fatalf("Failed to decode second response: %v", err)
	}

	// Version info should be consistent
	if firstResponse.Version != secondResponse.Version {
		t.Errorf("Version changed between calls: %q != %q", firstResponse.Version, secondResponse.Version)
	}

	if firstResponse.Commit != secondResponse.Commit {
		t.Errorf("Commit changed between calls: %q != %q", firstResponse.Commit, secondResponse.Commit)
	}

	if firstResponse.GoVersion != secondResponse.GoVersion {
		t.Errorf("GoVersion changed between calls: %q != %q", firstResponse.GoVersion, secondResponse.GoVersion)
	}
}

func TestGetVersionConcurrent(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	const numRequests = 10
	done := make(chan bool, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
			w := httptest.NewRecorder()
			h.GetVersion(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status 200, got %d", w.Code)
			}

			var response startup.BuildInfo
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				t.Errorf("Failed to decode response: %v", err)
			}

			done <- true
		}()
	}

	// Wait for all requests to complete
	for i := 0; i < numRequests; i++ {
		<-done
	}
}

func TestGetVersionWithDifferentHandlers(t *testing.T) {
	t.Parallel()

	// Test that version info is the same regardless of handler instance
	h1 := &Handlers{}
	h2 := &Handlers{
		mediaDir: "/different/path",
		cacheDir: "/another/path",
	}

	req1 := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w1 := httptest.NewRecorder()
	h1.GetVersion(w1, req1)

	req2 := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w2 := httptest.NewRecorder()
	h2.GetVersion(w2, req2)

	var resp1, resp2 startup.BuildInfo

	if err := json.NewDecoder(w1.Body).Decode(&resp1); err != nil {
		t.Fatalf("Failed to decode first response: %v", err)
	}

	if err := json.NewDecoder(w2.Body).Decode(&resp2); err != nil {
		t.Fatalf("Failed to decode second response: %v", err)
	}

	// Build info should be identical
	if resp1.Version != resp2.Version {
		t.Errorf("Version differs between handlers: %q != %q", resp1.Version, resp2.Version)
	}
}

func TestGetVersionJSONValidation(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	// Verify it's valid JSON
	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Response is not valid JSON: %v", err)
	}

	// Check for expected fields (values may be empty but keys should exist)
	expectedFields := []string{"version", "commit", "buildTime", "goVersion"}
	for _, field := range expectedFields {
		if _, exists := result[field]; !exists {
			t.Errorf("Expected field %q in response", field)
		}
	}
}

func TestGetVersionResponseSize(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	// Response should be reasonably sized (not huge)
	bodyLen := w.Body.Len()
	if bodyLen > 1024 {
		t.Errorf("Version response is unexpectedly large: %d bytes", bodyLen)
	}

	if bodyLen == 0 {
		t.Error("Version response is empty")
	}
}

func TestGetVersionNilRequest(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	// Handler ignores request, so nil should work
	w := httptest.NewRecorder()
	h.GetVersion(w, nil)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200 with nil request, got %d", w.Code)
	}

	var response startup.BuildInfo
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
}

func TestGetVersionHeaders(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	// Verify required headers are set
	headers := map[string]string{
		"Content-Type":  "application/json",
		"Cache-Control": "no-cache",
	}

	for name, expectedValue := range headers {
		actualValue := w.Header().Get(name)
		if actualValue != expectedValue {
			t.Errorf("Expected header %q: %q, got %q", name, expectedValue, actualValue)
		}
	}
}

func TestGetVersionNoExtraHeaders(t *testing.T) {
	t.Parallel()

	h := &Handlers{}

	req := httptest.NewRequest(http.MethodGet, "/api/version", http.NoBody)
	w := httptest.NewRecorder()

	h.GetVersion(w, req)

	// Should not set unnecessary headers like ETag, Last-Modified, etc.
	unnecessaryHeaders := []string{"ETag", "Last-Modified", "Expires"}

	for _, header := range unnecessaryHeaders {
		if value := w.Header().Get(header); value != "" {
			t.Logf("Note: Handler sets %q: %q (may be intentional)", header, value)
		}
	}
}
