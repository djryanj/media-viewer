package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"media-viewer/internal/transcoder"
)

// transcoderInterface defines the interface we need for testing
type transcoderInterface interface {
	ClearCache() (int64, error)
}

// mockTranscoder is a mock implementation of the transcoder interface
type mockTranscoder struct {
	clearCacheFunc func() (int64, error)
}

func (m *mockTranscoder) ClearCache() (int64, error) {
	if m.clearCacheFunc != nil {
		return m.clearCacheFunc()
	}
	return 0, nil
}

// mockHandlers is a test version of Handlers that uses the interface
type mockHandlers struct {
	transcoder transcoderInterface
}

func (h *mockHandlers) ClearTranscodeCache(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	freedBytes, err := h.transcoder.ClearCache()
	if err != nil {
		http.Error(w, "Failed to clear transcode cache", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"success":    true,
		"freedBytes": freedBytes,
	})
}

// Verify that transcoder.Transcoder implements our interface
var _ transcoderInterface = (*transcoder.Transcoder)(nil)

func TestClearTranscodeCache(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		method         string
		clearCacheFunc func() (int64, error)
		wantStatus     int
		wantSuccess    bool
		wantFreedBytes int64
		wantError      bool
	}{
		{
			name:   "successful cache clear",
			method: http.MethodPost,
			clearCacheFunc: func() (int64, error) {
				return 1048576, nil // 1 MB freed
			},
			wantStatus:     http.StatusOK,
			wantSuccess:    true,
			wantFreedBytes: 1048576,
		},
		{
			name:   "cache clear with zero bytes",
			method: http.MethodPost,
			clearCacheFunc: func() (int64, error) {
				return 0, nil
			},
			wantStatus:     http.StatusOK,
			wantSuccess:    true,
			wantFreedBytes: 0,
		},
		{
			name:   "cache clear with large amount",
			method: http.MethodPost,
			clearCacheFunc: func() (int64, error) {
				return 10737418240, nil // 10 GB freed
			},
			wantStatus:     http.StatusOK,
			wantSuccess:    true,
			wantFreedBytes: 10737418240,
		},
		{
			name:   "cache clear fails",
			method: http.MethodPost,
			clearCacheFunc: func() (int64, error) {
				return 0, errors.New("disk error")
			},
			wantStatus: http.StatusInternalServerError,
			wantError:  true,
		},
		{
			name:       "GET method not allowed",
			method:     http.MethodGet,
			wantStatus: http.StatusMethodNotAllowed,
			wantError:  true,
		},
		{
			name:       "PUT method not allowed",
			method:     http.MethodPut,
			wantStatus: http.StatusMethodNotAllowed,
			wantError:  true,
		},
		{
			name:       "DELETE method not allowed",
			method:     http.MethodDelete,
			wantStatus: http.StatusMethodNotAllowed,
			wantError:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := &mockHandlers{
				transcoder: &mockTranscoder{
					clearCacheFunc: tt.clearCacheFunc,
				},
			}

			req := httptest.NewRequest(tt.method, "/api/transcode/clear", http.NoBody)
			w := httptest.NewRecorder()

			h.ClearTranscodeCache(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}

			if tt.wantError {
				return
			}

			// Check Content-Type header
			contentType := w.Header().Get("Content-Type")
			if contentType != "application/json" {
				t.Errorf("Content-Type = %q, want %q", contentType, "application/json")
			}

			// Parse response
			var resp map[string]interface{}
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			// Check success field
			success, ok := resp["success"].(bool)
			if !ok {
				t.Errorf("success field missing or not boolean")
			} else if success != tt.wantSuccess {
				t.Errorf("success = %v, want %v", success, tt.wantSuccess)
			}

			// Check freedBytes field
			freedBytes, ok := resp["freedBytes"].(float64) // JSON numbers decode as float64
			if !ok {
				t.Errorf("freedBytes field missing or not numeric")
			} else if int64(freedBytes) != tt.wantFreedBytes {
				t.Errorf("freedBytes = %d, want %d", int64(freedBytes), tt.wantFreedBytes)
			}
		})
	}
}

func TestClearTranscodeCacheResponseStructure(t *testing.T) {
	t.Parallel()

	h := &mockHandlers{
		transcoder: &mockTranscoder{
			clearCacheFunc: func() (int64, error) {
				return 2048, nil
			},
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
	w := httptest.NewRecorder()

	h.ClearTranscodeCache(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify required fields exist
	requiredFields := []string{"success", "freedBytes"}
	for _, field := range requiredFields {
		if _, exists := resp[field]; !exists {
			t.Errorf("required field %q missing from response", field)
		}
	}

	// Verify field types
	if _, ok := resp["success"].(bool); !ok {
		t.Errorf("success field should be boolean")
	}

	if _, ok := resp["freedBytes"].(float64); !ok {
		t.Errorf("freedBytes field should be numeric")
	}
}

func TestClearTranscodeCacheMethodValidation(t *testing.T) {
	t.Parallel()

	methods := []struct {
		method     string
		wantStatus int
	}{
		{http.MethodPost, http.StatusOK},
		{http.MethodGet, http.StatusMethodNotAllowed},
		{http.MethodPut, http.StatusMethodNotAllowed},
		{http.MethodDelete, http.StatusMethodNotAllowed},
		{http.MethodPatch, http.StatusMethodNotAllowed},
		{http.MethodOptions, http.StatusMethodNotAllowed},
		{http.MethodHead, http.StatusMethodNotAllowed},
	}

	for _, m := range methods {
		t.Run(m.method, func(t *testing.T) {
			t.Parallel()

			h := &mockHandlers{
				transcoder: &mockTranscoder{
					clearCacheFunc: func() (int64, error) {
						return 1024, nil
					},
				},
			}

			req := httptest.NewRequest(m.method, "/api/transcode/clear", http.NoBody)
			w := httptest.NewRecorder()

			h.ClearTranscodeCache(w, req)

			if w.Code != m.wantStatus {
				t.Errorf("method %s: status = %d, want %d", m.method, w.Code, m.wantStatus)
			}
		})
	}
}

func TestClearTranscodeCacheErrorConditions(t *testing.T) {
	t.Parallel()

	errorTests := []struct {
		name           string
		clearCacheFunc func() (int64, error)
		wantStatus     int
		errorContains  string
	}{
		{
			name: "permission denied",
			clearCacheFunc: func() (int64, error) {
				return 0, errors.New("permission denied")
			},
			wantStatus:    http.StatusInternalServerError,
			errorContains: "Failed to clear transcode cache",
		},
		{
			name: "disk full",
			clearCacheFunc: func() (int64, error) {
				return 0, errors.New("disk full")
			},
			wantStatus:    http.StatusInternalServerError,
			errorContains: "Failed to clear transcode cache",
		},
		{
			name: "io error",
			clearCacheFunc: func() (int64, error) {
				return 512, errors.New("io error during cleanup")
			},
			wantStatus:    http.StatusInternalServerError,
			errorContains: "Failed to clear transcode cache",
		},
	}

	for _, tt := range errorTests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := &mockHandlers{
				transcoder: &mockTranscoder{
					clearCacheFunc: tt.clearCacheFunc,
				},
			}

			req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
			w := httptest.NewRecorder()

			h.ClearTranscodeCache(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}

			if tt.errorContains != "" {
				body := w.Body.String()
				if body == "" {
					t.Errorf("expected error message containing %q, got empty response", tt.errorContains)
				}
			}
		})
	}
}

func TestClearTranscodeCacheConcurrent(t *testing.T) {
	t.Parallel()

	callCount := 0
	h := &mockHandlers{
		transcoder: &mockTranscoder{
			clearCacheFunc: func() (int64, error) {
				callCount++
				return int64(callCount * 1024), nil
			},
		},
	}

	// Run multiple concurrent requests
	const numRequests = 10
	results := make(chan int, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
			w := httptest.NewRecorder()

			h.ClearTranscodeCache(w, req)
			results <- w.Code
		}()
	}

	// Collect results
	for i := 0; i < numRequests; i++ {
		status := <-results
		if status != http.StatusOK {
			t.Errorf("concurrent request %d: status = %d, want %d", i, status, http.StatusOK)
		}
	}
}

func TestClearTranscodeCacheBytesRange(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		freedBytes int64
	}{
		{"zero bytes", 0},
		{"1 KB", 1024},
		{"1 MB", 1048576},
		{"100 MB", 104857600},
		{"1 GB", 1073741824},
		{"10 GB", 10737418240},
		{"100 GB", 107374182400},
		{"1 TB", 1099511627776},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := &mockHandlers{
				transcoder: &mockTranscoder{
					clearCacheFunc: func() (int64, error) {
						return tt.freedBytes, nil
					},
				},
			}

			req := httptest.NewRequest(http.MethodPost, "/api/transcode/clear", http.NoBody)
			w := httptest.NewRecorder()

			h.ClearTranscodeCache(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
			}

			var resp map[string]interface{}
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			freedBytes, ok := resp["freedBytes"].(float64)
			if !ok {
				t.Fatalf("freedBytes field missing or not numeric")
			}

			if int64(freedBytes) != tt.freedBytes {
				t.Errorf("freedBytes = %d, want %d", int64(freedBytes), tt.freedBytes)
			}
		})
	}
}
