package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"media-viewer/internal/autotagger"
)

// mockAutoTagRunner is a test double for the AutoTagRunner interface that
// records how many times TriggerRun was called.
type mockAutoTagRunner struct {
	calls   atomic.Int32
	enabled bool
}

func (m *mockAutoTagRunner) TriggerRun() {
	m.calls.Add(1)
}

func (m *mockAutoTagRunner) Status() autotagger.Status {
	return autotagger.Status{}
}

func (m *mockAutoTagRunner) Enabled() bool {
	return m.enabled
}

// Verify mockAutoTagRunner satisfies the interface at compile time.
var _ AutoTagRunner = (*mockAutoTagRunner)(nil)

func TestRunAutoTagger(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		method      string
		autoTagger  AutoTagRunner
		wantStatus  int
		wantCalls   int32
		wantSuccess bool
	}{
		{
			name:        "POST triggers run and returns 202",
			method:      http.MethodPost,
			autoTagger:  &mockAutoTagRunner{enabled: true},
			wantStatus:  http.StatusAccepted,
			wantCalls:   1,
			wantSuccess: true,
		},
		{
			name:       "nil autoTagger returns 503",
			method:     http.MethodPost,
			autoTagger: nil,
			wantStatus: http.StatusServiceUnavailable,
			wantCalls:  0,
		},
		{
			name:       "GET method not allowed",
			method:     http.MethodGet,
			autoTagger: &mockAutoTagRunner{enabled: true},
			wantStatus: http.StatusMethodNotAllowed,
			wantCalls:  0,
		},
		{
			name:       "PUT method not allowed",
			method:     http.MethodPut,
			autoTagger: &mockAutoTagRunner{enabled: true},
			wantStatus: http.StatusMethodNotAllowed,
			wantCalls:  0,
		},
		{
			name:       "DELETE method not allowed",
			method:     http.MethodDelete,
			autoTagger: &mockAutoTagRunner{enabled: true},
			wantStatus: http.StatusMethodNotAllowed,
			wantCalls:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := &Handlers{autoTagger: tt.autoTagger}

			req := httptest.NewRequest(tt.method, "/api/autotagger/run", http.NoBody)
			w := httptest.NewRecorder()

			h.RunAutoTagger(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}

			// Verify TriggerRun call count.
			if mock, ok := tt.autoTagger.(*mockAutoTagRunner); ok {
				if got := mock.calls.Load(); got != tt.wantCalls {
					t.Errorf("TriggerRun calls = %d, want %d", got, tt.wantCalls)
				}
			}

			if !tt.wantSuccess {
				return
			}

			// Successful response must be JSON with success:true and a message.
			if ct := w.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}

			var resp map[string]interface{}
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			if success, ok := resp["success"].(bool); !ok || !success {
				t.Errorf("expected success=true in response, got %v", resp)
			}

			if msg, ok := resp["message"].(string); !ok || msg == "" {
				t.Errorf("expected non-empty message in response, got %v", resp)
			}
		})
	}
}

func TestGetSystemStatusIncludesAutoTagger(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		method     string
		autoTagger AutoTagRunner
		wantStatus int
	}{
		{
			name:       "GET returns 200",
			method:     http.MethodGet,
			autoTagger: &mockAutoTagRunner{enabled: true},
			wantStatus: http.StatusOK,
		},
		{
			name:       "POST method not allowed",
			method:     http.MethodPost,
			autoTagger: &mockAutoTagRunner{enabled: true},
			wantStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := &Handlers{autoTagger: tt.autoTagger}

			req := httptest.NewRequest(tt.method, "/api/system/status", http.NoBody)
			w := httptest.NewRecorder()

			h.GetSystemStatus(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}
		})
	}
}
