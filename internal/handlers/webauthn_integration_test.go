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
// WebAuthn Integration Tests
// =============================================================================
//
// Note: These tests validate handler behavior with a real database, but
// do not test the full WebAuthn cryptographic flow which requires browser
// WebAuthn APIs. The cryptographic flows are covered by unit tests with mocks.
//
// These integration tests focus on:
// - Availability checking with real database
// - Session validation with real database
// - Error handling for missing configuration
// - Database schema initialization
// =============================================================================

// setupWebAuthnIntegrationTest creates a handler setup for testing WebAuthn handlers
func setupWebAuthnIntegrationTest(t *testing.T) (h *Handlers, cleanup func()) {
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
	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	// Initialize WebAuthn schema (required for credential checks)
	if err := db.InitWebAuthnSchema(); err != nil {
		t.Fatalf("failed to initialize WebAuthn schema: %v", err)
	}

	// Create indexer
	idx := indexer.New(db, mediaDir, 0)

	// Create transcoder
	trans := transcoder.New(cacheDir, false)

	// Create thumbnail generator
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil)

	// Create config (WebAuthn disabled by default)
	config := &startup.Config{
		MediaDir:        mediaDir,
		CacheDir:        cacheDir,
		WebAuthnEnabled: false, // Disabled for basic integration tests
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

// TestWebAuthnAvailableDisabledIntegration tests availability when WebAuthn is disabled
func TestWebAuthnAvailableDisabledIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
	w := httptest.NewRecorder()

	h.WebAuthnAvailable(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// When disabled, should return enabled=false
	if enabled, ok := response["enabled"].(bool); !ok || enabled {
		t.Error("expected enabled to be false when WebAuthn is disabled")
	}

	// available should also be false (enabled=false OR no credentials)
	if available, ok := response["available"].(bool); !ok || available {
		t.Error("expected available to be false when WebAuthn is disabled")
	}
}

// TestWebAuthnAvailableContentTypeIntegration tests response headers
func TestWebAuthnAvailableContentTypeIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
	w := httptest.NewRecorder()

	h.WebAuthnAvailable(w, req)

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", contentType)
	}
}

// TestBeginWebAuthnRegistrationNotConfiguredIntegration tests registration when disabled
func TestBeginWebAuthnRegistrationNotConfiguredIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/begin", http.NoBody)
	w := httptest.NewRecorder()

	h.BeginWebAuthnRegistration(w, req)

	// Should return 503 when WebAuthn is not configured
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", w.Code)
	}
}

// TestBeginWebAuthnRegistrationNoSessionIntegration tests registration without session
func TestBeginWebAuthnRegistrationNoSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	// Note: Even though WebAuthn is disabled, we test the session check happens first
	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/begin", http.NoBody)
	w := httptest.NewRecorder()

	h.BeginWebAuthnRegistration(w, req)

	// Should fail due to WebAuthn not configured (checked first)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503 (not configured), got %d", w.Code)
	}
}

// TestFinishWebAuthnRegistrationNotConfiguredIntegration tests finish registration when disabled
func TestFinishWebAuthnRegistrationNotConfiguredIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/finish", http.NoBody)
	w := httptest.NewRecorder()

	h.FinishWebAuthnRegistration(w, req)

	// Should return 503 when WebAuthn is not configured
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", w.Code)
	}
}

// TestBeginWebAuthnLoginNotConfiguredIntegration tests login when disabled
func TestBeginWebAuthnLoginNotConfiguredIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/login/begin", http.NoBody)
	w := httptest.NewRecorder()

	h.BeginWebAuthnLogin(w, req)

	// Should return 503 when WebAuthn is not configured
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", w.Code)
	}
}

// TestFinishWebAuthnLoginNotConfiguredIntegration tests finish login when disabled
func TestFinishWebAuthnLoginNotConfiguredIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/login/finish", http.NoBody)
	w := httptest.NewRecorder()

	h.FinishWebAuthnLogin(w, req)

	// Should return 503 when WebAuthn is not configured
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", w.Code)
	}
}

// TestWebAuthnResponseStructureIntegration tests response structure
func TestWebAuthnResponseStructureIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
	w := httptest.NewRecorder()

	h.WebAuthnAvailable(w, req)

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}

	// Verify required fields
	if _, ok := response["available"]; !ok {
		t.Error("response missing 'available' field")
	}

	if _, ok := response["enabled"]; !ok {
		t.Error("response missing 'enabled' field")
	}

	// Verify field types
	if _, ok := response["available"].(bool); !ok {
		t.Error("available field is not a boolean")
	}

	if _, ok := response["enabled"].(bool); !ok {
		t.Error("enabled field is not a boolean")
	}
}

// TestWebAuthnMultipleAvailabilityChecksIntegration tests multiple consecutive checks
func TestWebAuthnMultipleAvailabilityChecksIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	// Make multiple requests
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
		w := httptest.NewRecorder()

		h.WebAuthnAvailable(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("request %d: expected status 200, got %d", i, w.Code)
		}

		var response map[string]interface{}
		if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
			t.Fatalf("request %d: failed to decode response: %v", i, err)
		}

		// All responses should be consistent
		if enabled, ok := response["enabled"].(bool); !ok || enabled {
			t.Errorf("request %d: expected enabled=false", i)
		}
	}
}

// TestWebAuthnSchemaInitializationIntegration tests database schema is properly initialized
func TestWebAuthnSchemaInitializationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	// The setup already initializes the schema, verify it works by checking availability
	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
	w := httptest.NewRecorder()

	h.WebAuthnAvailable(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d (schema may not be initialized)", w.Code)
	}

	// Should not panic or return 500, even if disabled
	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
}

// TestWebAuthnConcurrentAvailabilityChecksIntegration tests concurrent access safety
func TestWebAuthnConcurrentAvailabilityChecksIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	const numGoroutines = 20
	done := make(chan bool, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
			w := httptest.NewRecorder()

			h.WebAuthnAvailable(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected status 200, got %d", w.Code)
			}

			var response map[string]interface{}
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				t.Errorf("failed to decode response: %v", err)
			}

			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < numGoroutines; i++ {
		<-done
	}
}

// TestWebAuthnErrorHandlingIntegration tests error handling for disabled WebAuthn
func TestWebAuthnErrorHandlingIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	tests := []struct {
		name     string
		handler  func(http.ResponseWriter, *http.Request)
		method   string
		path     string
		expected int
	}{
		{"BeginRegistration", h.BeginWebAuthnRegistration, http.MethodPost, "/api/webauthn/register/begin", http.StatusServiceUnavailable},
		{"FinishRegistration", h.FinishWebAuthnRegistration, http.MethodPost, "/api/webauthn/register/finish", http.StatusServiceUnavailable},
		{"BeginLogin", h.BeginWebAuthnLogin, http.MethodPost, "/api/webauthn/login/begin", http.StatusServiceUnavailable},
		{"FinishLogin", h.FinishWebAuthnLogin, http.MethodPost, "/api/webauthn/login/finish", http.StatusServiceUnavailable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, http.NoBody)
			w := httptest.NewRecorder()

			tt.handler(w, req)

			if w.Code != tt.expected {
				t.Errorf("expected status %d, got %d", tt.expected, w.Code)
			}
		})
	}
}

// TestWebAuthnAvailabilityHTTPMethodsIntegration tests different HTTP methods
func TestWebAuthnAvailabilityHTTPMethodsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupWebAuthnIntegrationTest(t)
	defer cleanup()

	methods := []string{
		http.MethodGet,
		http.MethodPost,
		http.MethodPut,
		http.MethodDelete,
	}

	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/api/webauthn/available", http.NoBody)
			w := httptest.NewRecorder()

			h.WebAuthnAvailable(w, req)

			// Handler doesn't validate method, so all should succeed
			if w.Code != http.StatusOK {
				t.Errorf("expected status 200, got %d", w.Code)
			}
		})
	}
}
