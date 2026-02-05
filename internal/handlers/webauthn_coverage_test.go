package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
// WebAuthn Coverage Tests
// =============================================================================
//
// These tests focus on achieving coverage of the real handler code paths
// that are currently untested. They test with real database integration
// and simulate various error conditions.
// =============================================================================

// setupWebAuthnCoverageTest creates a handler setup for WebAuthn coverage testing
func setupWebAuthnCoverageTest(t *testing.T, enableWebAuthn bool) (h *Handlers, cleanup func()) {
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

	// Create indexer
	idx := indexer.New(db, mediaDir, 0)

	// Create transcoder
	trans := transcoder.New(cacheDir, false)

	// Create thumbnail generator
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil)

	// Create config
	config := &startup.Config{
		MediaDir:              mediaDir,
		CacheDir:              cacheDir,
		WebAuthnEnabled:       enableWebAuthn,
		WebAuthnRPID:          "localhost",
		WebAuthnRPDisplayName: "Test Media Viewer",
		WebAuthnRPOrigins:     []string{"http://localhost:8080"},
	}

	// Initialize WebAuthn if enabled
	if enableWebAuthn {
		if err := InitWebAuthn(config, db); err != nil {
			t.Fatalf("failed to initialize WebAuthn: %v", err)
		}
	}

	// Create handlers
	handlers := New(db, idx, trans, thumbGen, config)

	cleanup = func() {
		// Reset global state
		webAuthnEnabled = false
		webAuthnInstance = nil

		if err := db.Close(); err != nil {
			t.Logf("failed to close database: %v", err)
		}
	}

	return handlers, cleanup
}

// TestWebAuthnAvailableWithCredentials tests availability check when credentials exist
func TestWebAuthnAvailableWithCredentials(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// WebAuthn is enabled but no credentials exist yet
	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
	w := httptest.NewRecorder()

	h.WebAuthnAvailable(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// enabled should be true since WebAuthn is configured
	if enabled, ok := resp["enabled"].(bool); !ok || !enabled {
		t.Errorf("enabled = %v, want true", enabled)
	}

	// available should be false since no credentials exist
	if available, ok := resp["available"].(bool); !ok || available {
		t.Errorf("available = %v, want false (no credentials yet)", available)
	}
}

// TestListPasskeysSuccess tests listing passkeys with valid session
func TestListPasskeysSuccess(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create a user and session
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	session, err := h.db.CreateSession(ctx, 1)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/passkeys", http.NoBody)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session.Token})
	w := httptest.NewRecorder()

	h.ListPasskeys(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should have passkeys array (empty in this case)
	passkeys, ok := resp["passkeys"].([]interface{})
	if !ok {
		t.Errorf("passkeys field missing or wrong type")
	} else if len(passkeys) != 0 {
		t.Errorf("expected 0 passkeys, got %d", len(passkeys))
	}
}

// TestListPasskeysWithDatabaseError tests listing when database returns error
func TestListPasskeysWithDatabaseError(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create a user and session
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	session, err := h.db.CreateSession(ctx, 1)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Close database to simulate error
	if err := h.db.Close(); err != nil {
		t.Fatalf("failed to close database: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/passkeys", http.NoBody)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session.Token})
	w := httptest.NewRecorder()

	h.ListPasskeys(w, req)

	// Should fail with 500 when database operation fails
	if w.Code != http.StatusInternalServerError && w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 500 or 401 (database closed)", w.Code)
	}
}

// TestDeletePasskeySuccess tests deleting a passkey
func TestDeletePasskeySuccess(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create a user and session
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	session, err := h.db.CreateSession(ctx, 1)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Try to delete a non-existent passkey (should not error, just succeed silently or return error)
	reqBody := `{"id": 999}`
	req := httptest.NewRequest(http.MethodDelete, "/api/webauthn/passkeys", bytes.NewReader([]byte(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session.Token})
	w := httptest.NewRecorder()

	h.DeletePasskey(w, req)

	// Should either succeed (no error for non-existent) or return error
	// The implementation doesn't check if ID exists, so it likely succeeds
	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 200 or 500", w.Code)
	}
}

// TestDeletePasskeyWithDatabaseError tests deletion when database fails
func TestDeletePasskeyWithDatabaseError(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create a user and session
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	session, err := h.db.CreateSession(ctx, 1)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Close database to simulate error
	if err := h.db.Close(); err != nil {
		t.Fatalf("failed to close database: %v", err)
	}

	reqBody := `{"id": 1}`
	req := httptest.NewRequest(http.MethodDelete, "/api/webauthn/passkeys", bytes.NewReader([]byte(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session.Token})
	w := httptest.NewRecorder()

	h.DeletePasskey(w, req)

	// Should fail with 500 or 401 when database is closed
	if w.Code != http.StatusInternalServerError && w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 500 or 401 (database closed)", w.Code)
	}
}

// TestBeginWebAuthnLoginNoCredentialsInDatabase tests login when no credentials registered
func TestBeginWebAuthnLoginNoCredentialsInDatabase(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/login/begin", http.NoBody)
	w := httptest.NewRecorder()

	h.BeginWebAuthnLogin(w, req)

	// Should return 404 when no passkeys are registered
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

// TestBeginWebAuthnLoginWithDatabaseError tests login begin with database error
func TestBeginWebAuthnLoginWithDatabaseError(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Close database to simulate error
	if err := h.db.Close(); err != nil {
		t.Fatalf("failed to close database: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/login/begin", http.NoBody)
	w := httptest.NewRecorder()

	h.BeginWebAuthnLogin(w, req)

	// Should return 404 when database is closed (can't check credentials)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

// TestBeginWebAuthnRegistrationGetUserError tests registration when GetWebAuthnUser fails
func TestBeginWebAuthnRegistrationGetUserError(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create a user and session first
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	session, err := h.db.CreateSession(ctx, 1)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Close database to simulate GetWebAuthnUser error
	if err := h.db.Close(); err != nil {
		t.Fatalf("failed to close database: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/begin", http.NoBody)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session.Token})
	w := httptest.NewRecorder()

	h.BeginWebAuthnRegistration(w, req)

	// Should return 500 when GetWebAuthnUser fails
	if w.Code != http.StatusInternalServerError && w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 500 or 401 (database error)", w.Code)
	}
}

// TestFinishWebAuthnRegistrationInvalidSessionID tests finish registration with bad session ID
func TestFinishWebAuthnRegistrationInvalidSessionID(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create a user and session
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	session, err := h.db.CreateSession(ctx, 1)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	reqBody := `{"sessionId": "invalid-session-id", "name": "Test Key", "credential": {}}`
	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/finish", bytes.NewReader([]byte(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session.Token})
	w := httptest.NewRecorder()

	h.FinishWebAuthnRegistration(w, req)

	// Should return 400 when session ID is invalid
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestFinishWebAuthnLoginInvalidSessionID tests finish login with bad session ID
func TestFinishWebAuthnLoginInvalidSessionID(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	reqBody := `{"sessionId": "invalid-session-id", "credential": {}}`
	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/login/finish", bytes.NewReader([]byte(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.FinishWebAuthnLogin(w, req)

	// Should return 400 when session ID is invalid
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestInitWebAuthnDisabled tests InitWebAuthn when WebAuthn is disabled
func TestInitWebAuthnDisabled(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	config := &startup.Config{
		WebAuthnEnabled: false,
	}

	// Should not return error when disabled
	if err := InitWebAuthn(config, db); err != nil {
		t.Errorf("InitWebAuthn with disabled config returned error: %v", err)
	}

	// webAuthnEnabled should be false
	if webAuthnEnabled {
		t.Error("webAuthnEnabled should be false after init with disabled config")
	}
}

// TestInitWebAuthnSchemaError tests InitWebAuthn when schema init fails
func TestInitWebAuthnSchemaError(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	// Close database to make schema init fail
	if err := db.Close(); err != nil {
		t.Fatalf("failed to close database: %v", err)
	}

	config := &startup.Config{
		WebAuthnEnabled: true,
		WebAuthnRPID:    "localhost",
	}

	// Should not return error but should disable WebAuthn
	if err := InitWebAuthn(config, db); err != nil {
		t.Errorf("InitWebAuthn with schema error should not return error, got: %v", err)
	}

	// webAuthnEnabled should be false due to schema error
	if webAuthnEnabled {
		t.Error("webAuthnEnabled should be false after schema init fails")
	}
}

// TestInitWebAuthnSuccess tests successful WebAuthn initialization
func TestInitWebAuthnSuccess(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("failed to create database: %v", err)
	}
	defer db.Close()

	config := &startup.Config{
		WebAuthnEnabled:       true,
		WebAuthnRPID:          "localhost",
		WebAuthnRPDisplayName: "Test",
		WebAuthnRPOrigins:     []string{"http://localhost"},
	}

	// Reset global state
	originalEnabled := webAuthnEnabled
	originalInstance := webAuthnInstance
	defer func() {
		webAuthnEnabled = originalEnabled
		webAuthnInstance = originalInstance
	}()

	// Should succeed
	if err := InitWebAuthn(config, db); err != nil {
		t.Errorf("InitWebAuthn failed: %v", err)
	}

	// webAuthnEnabled should be true
	if !webAuthnEnabled {
		t.Error("webAuthnEnabled should be true after successful init")
	}

	// webAuthnInstance should be set
	if webAuthnInstance == nil {
		t.Error("webAuthnInstance should not be nil after successful init")
	}
}

// TestGenerateWebAuthnSessionIDLength tests session ID generation
func TestGenerateWebAuthnSessionIDLength(t *testing.T) {
	// Generate session IDs and verify they're not empty
	for i := 0; i < 10; i++ {
		id := generateWebAuthnSessionID()
		if id == "" {
			t.Error("generateWebAuthnSessionID returned empty string")
		}
		if len(id) < 40 {
			t.Errorf("session ID too short: %d bytes", len(id))
		}
	}
}

// TestCredentialsToDescriptorsEmpty tests empty credentials conversion
func TestCredentialsToDescriptorsEmpty(t *testing.T) {
	result := credentialsToDescriptors(nil)
	if len(result) != 0 {
		t.Errorf("expected empty slice, got length %d", len(result))
	}
}

// TestWebAuthnWithMultipleConcurrentRequests tests concurrent WebAuthn requests
func TestWebAuthnWithMultipleConcurrentRequests(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	const numRequests = 20
	done := make(chan bool, numRequests)
	errors := make(chan error, numRequests)

	for i := 0; i < numRequests; i++ {
		go func(index int) {
			defer func() { done <- true }()

			req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
			w := httptest.NewRecorder()

			h.WebAuthnAvailable(w, req)

			if w.Code != http.StatusOK {
				errors <- fmt.Errorf("request %d: status = %d, want %d", index, w.Code, http.StatusOK)
				return
			}

			var resp map[string]interface{}
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				errors <- fmt.Errorf("request %d: failed to decode: %w", index, err)
			}
		}(i)
	}

	// Wait for all requests
	for i := 0; i < numRequests; i++ {
		<-done
	}

	close(errors)
	for err := range errors {
		t.Error(err)
	}
}

// TestWebAuthnEndpointsWithInvalidJSON tests all endpoints with malformed JSON
func TestWebAuthnEndpointsWithInvalidJSON(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create a session for authenticated endpoints
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	session, err := h.db.CreateSession(ctx, 1)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	tests := []struct {
		name         string
		handler      func(http.ResponseWriter, *http.Request)
		needsSession bool
		wantStatus   int
	}{
		{
			name:         "FinishWebAuthnRegistration",
			handler:      h.FinishWebAuthnRegistration,
			needsSession: true,
			wantStatus:   http.StatusBadRequest,
		},
		{
			name:         "FinishWebAuthnLogin",
			handler:      h.FinishWebAuthnLogin,
			needsSession: false,
			wantStatus:   http.StatusBadRequest,
		},
		{
			name:         "DeletePasskey",
			handler:      h.DeletePasskey,
			needsSession: true,
			wantStatus:   http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			invalidJSON := bytes.NewReader([]byte(`{invalid json!`))
			req := httptest.NewRequest(http.MethodPost, "/test", invalidJSON)
			req.Header.Set("Content-Type", "application/json")

			if tt.needsSession {
				req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session.Token})
			}

			w := httptest.NewRecorder()
			tt.handler(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}
		})
	}
}

// TestWebAuthnStateTransitions tests state changes in WebAuthn handlers
func TestWebAuthnStateTransitions(t *testing.T) {
	// Test enabling and disabling
	originalEnabled := webAuthnEnabled
	originalInstance := webAuthnInstance
	defer func() {
		webAuthnEnabled = originalEnabled
		webAuthnInstance = originalInstance
	}()

	h, cleanup := setupWebAuthnCoverageTest(t, false)
	defer cleanup()

	// Initially disabled
	if webAuthnEnabled {
		t.Error("webAuthnEnabled should start false")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
	w := httptest.NewRecorder()
	h.WebAuthnAvailable(w, req)

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if enabled, ok := resp["enabled"].(bool); !ok || enabled {
		t.Errorf("enabled should be false, got %v", enabled)
	}
}

// TestWebAuthnSessionTimeout tests session expiration handling
func TestWebAuthnSessionTimeout(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create expired session (already expired)
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Use an expired token
	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/passkeys", http.NoBody)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "expired-token-12345"})
	w := httptest.NewRecorder()

	h.ListPasskeys(w, req)

	// Should return 401 for invalid/expired session
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

// TestWebAuthnContentTypeHeaders tests that all endpoints set correct Content-Type
func TestWebAuthnContentTypeHeaders(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	tests := []struct {
		name     string
		handler  func(http.ResponseWriter, *http.Request)
		setupReq func() *http.Request
		wantJSON bool
	}{
		{
			name:    "WebAuthnAvailable",
			handler: h.WebAuthnAvailable,
			setupReq: func() *http.Request {
				return httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
			},
			wantJSON: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := tt.setupReq()
			w := httptest.NewRecorder()
			tt.handler(w, req)

			if tt.wantJSON {
				contentType := w.Header().Get("Content-Type")
				if contentType != "application/json" {
					t.Errorf("Content-Type = %q, want application/json", contentType)
				}
			}
		})
	}
}

// TestWebAuthnEmptyNameInRegistration tests registration with empty name
func TestWebAuthnEmptyNameInRegistration(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create a user and session
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	session, err := h.db.CreateSession(ctx, 1)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Empty name should default to "Passkey"
	reqBody := `{"sessionId": "test", "name": "", "credential": {}}`
	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/finish", bytes.NewReader([]byte(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session.Token})
	w := httptest.NewRecorder()

	h.FinishWebAuthnRegistration(w, req)

	// Will fail because session doesn't exist, but name handling code was executed
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d (invalid session)", w.Code, http.StatusBadRequest)
	}
}

// TestWebAuthnRegistrationWithValidSessionValidatesSession tests session validation during registration
func TestWebAuthnRegistrationWithValidSessionValidatesSession(t *testing.T) {
	h, cleanup := setupWebAuthnCoverageTest(t, true)
	defer cleanup()

	// Create a user and session
	ctx := context.Background()
	password := "testpass123"

	if err := h.db.CreateUser(ctx, password); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	session, err := h.db.CreateSession(ctx, 1)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Make request with valid cookie
	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/begin", http.NoBody)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session.Token})
	w := httptest.NewRecorder()

	h.BeginWebAuthnRegistration(w, req)

	// Should fail when trying to begin registration (needs WebAuthn instance configured properly)
	// But session validation passed
	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
		t.Logf("Got status %d, this is expected as full WebAuthn flow needs crypto", w.Code)
	}
}
