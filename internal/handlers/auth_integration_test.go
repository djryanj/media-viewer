package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

// setupAuthIntegrationTest creates a real test environment for auth testing
func setupAuthIntegrationTest(t *testing.T) (h *Handlers, cleanup func()) {
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

	if err := db.InitWebAuthnSchema(); err != nil {
		t.Fatalf("Failed to initialize WebAuthn schema: %v", err)
	}

	idx := indexer.New(db, mediaDir, 0)                                            // No auto-indexing in tests
	trans := transcoder.New(cacheDir, false)                                       // Disabled in tests
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil) // Disabled in tests

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
// Setup and Initial Configuration Tests
// =============================================================================

func TestCheckSetupRequiredIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/auth/setup-required", http.NoBody)
	w := httptest.NewRecorder()

	h.CheckSetupRequired(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", w.Code)
	}

	var response map[string]bool
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response["needsSetup"] {
		t.Error("Expected needsSetup=true for fresh database")
	}
}

func TestSetupIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	reqBody := SetupRequest{Password: "testpassword123"}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Setup(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", w.Code)
	}

	var response AuthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response.Success {
		t.Error("Expected success=true")
	}

	// Verify setup is no longer required
	req = httptest.NewRequest(http.MethodGet, "/api/auth/setup-required", http.NoBody)
	w = httptest.NewRecorder()
	h.CheckSetupRequired(w, req)

	var checkResp map[string]bool
	json.NewDecoder(w.Body).Decode(&checkResp)
	if checkResp["needsSetup"] {
		t.Error("Expected needsSetup=false after setup")
	}
}

func TestSetupTwiceFailsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.CreateUser(ctx, "firstpassword")

	// Try to setup again
	reqBody := SetupRequest{Password: "secondpassword"}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Setup(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("Expected status 403, got %d", w.Code)
	}
}

func TestSetupPasswordValidationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	tests := []struct {
		name           string
		password       string
		expectedStatus int
	}{
		{
			name:           "Valid password",
			password:       "password123",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Too short (5 chars)",
			password:       "pass5",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Minimum valid (6 chars)",
			password:       "pass66",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Maximum valid (72 chars)",
			password:       string(make([]byte, 72)),
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Too long (73 chars)",
			password:       string(make([]byte, 73)),
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, cleanup := setupAuthIntegrationTest(t)
			defer cleanup()

			reqBody := SetupRequest{Password: tt.password}
			body, _ := json.Marshal(reqBody)

			req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.Setup(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}

// =============================================================================
// Login Tests
// =============================================================================

func TestLoginIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	password := "testpassword123"
	h.db.CreateUser(ctx, password)

	reqBody := LoginRequest{Password: password}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Login(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", w.Code)
	}

	var response AuthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response.Success {
		t.Error("Expected success=true")
	}

	// Verify session cookie was set
	cookies := w.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("Expected session cookie to be set")
	}

	sessionCookie := cookies[0]
	if sessionCookie.Name != SessionCookieName {
		t.Errorf("Expected cookie name %s, got %s", SessionCookieName, sessionCookie.Name)
	}
	if sessionCookie.Value == "" {
		t.Error("Expected non-empty session token")
	}
	if !sessionCookie.HttpOnly {
		t.Error("Expected HttpOnly=true")
	}
}

func TestLoginInvalidPasswordIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.CreateUser(ctx, "correctpassword")

	reqBody := LoginRequest{Password: "wrongpassword"}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Login(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}

	// Verify no session cookie was set
	cookies := w.Result().Cookies()
	if len(cookies) > 0 {
		t.Error("Expected no session cookie on failed login")
	}
}

func TestLoginNoUserIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	reqBody := LoginRequest{Password: "anypassword"}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Login(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

// =============================================================================
// Session Management Tests
// =============================================================================

func TestCheckAuthIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.CreateUser(ctx, "password")

	// Login to get session
	reqBody := LoginRequest{Password: "password"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Login(w, req)

	sessionCookie := w.Result().Cookies()[0]

	// Check auth with valid session
	req = httptest.NewRequest(http.MethodGet, "/api/auth/check", http.NoBody)
	req.AddCookie(sessionCookie)
	w = httptest.NewRecorder()

	h.CheckAuth(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestCheckAuthNoSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/auth/check", http.NoBody)
	w := httptest.NewRecorder()

	h.CheckAuth(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

func TestCheckAuthInvalidSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	// Use fake session token
	req := httptest.NewRequest(http.MethodGet, "/api/auth/check", http.NoBody)
	req.AddCookie(&http.Cookie{
		Name:  SessionCookieName,
		Value: "invalid-token",
	})
	w := httptest.NewRecorder()

	h.CheckAuth(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

func TestKeepaliveIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.CreateUser(ctx, "password")

	// Login to get session
	reqBody := LoginRequest{Password: "password"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Login(w, req)

	sessionCookie := w.Result().Cookies()[0]

	// Keepalive with valid session
	req = httptest.NewRequest(http.MethodPost, "/api/auth/keepalive", http.NoBody)
	req.AddCookie(sessionCookie)
	w = httptest.NewRecorder()

	h.Keepalive(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response AuthResponse
	json.NewDecoder(w.Body).Decode(&response)
	if !response.Success {
		t.Error("Expected success=true")
	}
}

// =============================================================================
// Logout Tests
// =============================================================================

func TestLogoutIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.CreateUser(ctx, "password")

	// Login to get session
	reqBody := LoginRequest{Password: "password"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Login(w, req)

	sessionCookie := w.Result().Cookies()[0]

	// Logout
	req = httptest.NewRequest(http.MethodPost, "/api/auth/logout", http.NoBody)
	req.AddCookie(sessionCookie)
	w = httptest.NewRecorder()

	h.Logout(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Verify session is invalidated
	req = httptest.NewRequest(http.MethodGet, "/api/auth/check", http.NoBody)
	req.AddCookie(sessionCookie)
	w = httptest.NewRecorder()
	h.CheckAuth(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Error("Expected CheckAuth to fail after logout")
	}
}

// =============================================================================
// Password Change Tests
// =============================================================================

func TestChangePasswordIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	oldPassword := "oldpassword123"
	newPassword := "newpassword456"

	h.db.CreateUser(ctx, oldPassword)

	// Change password
	reqBody := PasswordChangeRequest{
		CurrentPassword: oldPassword,
		NewPassword:     newPassword,
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/change-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ChangePassword(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", w.Code)
	}

	// Verify old password no longer works
	loginReq := LoginRequest{Password: oldPassword}
	body, _ = json.Marshal(loginReq)
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.Login(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Error("Expected old password to fail after change")
	}

	// Verify new password works
	loginReq = LoginRequest{Password: newPassword}
	body, _ = json.Marshal(loginReq)
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.Login(w, req)

	if w.Code != http.StatusOK {
		t.Error("Expected new password to work after change")
	}
}

func TestChangePasswordWrongCurrentIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.CreateUser(ctx, "correctpassword")

	reqBody := PasswordChangeRequest{
		CurrentPassword: "wrongpassword",
		NewPassword:     "newpassword",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/change-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ChangePassword(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

func TestChangePasswordValidationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.CreateUser(ctx, "currentpassword")

	// Create strings with actual printable characters
	password72 := strings.Repeat("a", 72)
	password73 := strings.Repeat("a", 73)

	tests := []struct {
		name           string
		newPassword    string
		expectedStatus int
	}{
		{"Too short", "pass5", http.StatusBadRequest},
		{"Valid 6 chars", "pass66", http.StatusOK},
		{"Valid 72 chars", password72, http.StatusOK},
		{"Too long 73 chars", password73, http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reqBody := PasswordChangeRequest{
				CurrentPassword: "currentpassword",
				NewPassword:     tt.newPassword,
			}
			body, _ := json.Marshal(reqBody)

			req := httptest.NewRequest(http.MethodPost, "/api/auth/change-password", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.ChangePassword(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			// Reset password back to "currentpassword" if the change succeeded
			// so subsequent subtests can use the same current password
			if w.Code == http.StatusOK {
				h.db.UpdatePassword(ctx, "currentpassword")
			}
		})
	}
}

// =============================================================================
// Complete Authentication Flow Tests
// =============================================================================

func TestCompleteAuthFlowIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	// Step 1: Check setup is required
	req := httptest.NewRequest(http.MethodGet, "/api/auth/setup-required", http.NoBody)
	w := httptest.NewRecorder()
	h.CheckSetupRequired(w, req)

	var setupCheck map[string]bool
	json.NewDecoder(w.Body).Decode(&setupCheck)
	if !setupCheck["needsSetup"] {
		t.Fatal("Expected initial setup to be required")
	}

	// Step 2: Setup password
	setupReq := SetupRequest{Password: "initialpassword"}
	body, _ := json.Marshal(setupReq)
	req = httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.Setup(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Setup failed: %d", w.Code)
	}

	// Step 3: Login
	loginReq := LoginRequest{Password: "initialpassword"}
	body, _ = json.Marshal(loginReq)
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.Login(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Login failed: %d", w.Code)
	}

	sessionCookie := w.Result().Cookies()[0]

	// Step 4: Verify authenticated
	req = httptest.NewRequest(http.MethodGet, "/api/auth/check", http.NoBody)
	req.AddCookie(sessionCookie)
	w = httptest.NewRecorder()
	h.CheckAuth(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Auth check failed: %d", w.Code)
	}

	// Step 5: Change password
	changeReq := PasswordChangeRequest{
		CurrentPassword: "initialpassword",
		NewPassword:     "newpassword",
	}
	body, _ = json.Marshal(changeReq)
	req = httptest.NewRequest(http.MethodPost, "/api/auth/change-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.ChangePassword(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Password change failed: %d", w.Code)
	}

	// Step 6: Logout
	req = httptest.NewRequest(http.MethodPost, "/api/auth/logout", http.NoBody)
	req.AddCookie(sessionCookie)
	w = httptest.NewRecorder()
	h.Logout(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Logout failed: %d", w.Code)
	}

	// Step 7: Verify logout
	req = httptest.NewRequest(http.MethodGet, "/api/auth/check", http.NoBody)
	req.AddCookie(sessionCookie)
	w = httptest.NewRecorder()
	h.CheckAuth(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Error("Auth check should fail after logout")
	}

	// Step 8: Login with new password
	loginReq = LoginRequest{Password: "newpassword"}
	body, _ = json.Marshal(loginReq)
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.Login(w, req)

	if w.Code != http.StatusOK {
		t.Error("Login with new password should succeed")
	}
}

// =============================================================================
// Concurrent Access Tests
// =============================================================================

func TestConcurrentLoginIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.CreateUser(ctx, "password")

	const numLogins = 20
	var wg sync.WaitGroup
	results := make(chan int, numLogins)

	for i := 0; i < numLogins; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			reqBody := LoginRequest{Password: "password"}
			body, _ := json.Marshal(reqBody)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.Login(w, req)
			results <- w.Code
		}()
	}

	wg.Wait()
	close(results)

	successCount := 0
	for code := range results {
		if code == http.StatusOK {
			successCount++
		}
	}

	if successCount != numLogins {
		t.Errorf("Expected %d successful logins, got %d", numLogins, successCount)
	}
}

func TestConcurrentPasswordChangeIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupAuthIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()
	h.db.CreateUser(ctx, "password")

	const numChanges = 10
	var wg sync.WaitGroup

	for i := 0; i < numChanges; i++ {
		wg.Add(1)
		go func(_ int) {
			defer wg.Done()

			reqBody := PasswordChangeRequest{
				CurrentPassword: "password",
				NewPassword:     "newpass",
			}
			body, _ := json.Marshal(reqBody)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/change-password", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.ChangePassword(w, req)
			// One should succeed, others may fail with 401 (wrong current password)
		}(i)
	}

	wg.Wait()

	// Verify we can login with one of the passwords
	loginReq := LoginRequest{Password: "newpass"}
	body, _ := json.Marshal(loginReq)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Login(w, req)

	if w.Code != http.StatusOK && w.Code != http.StatusUnauthorized {
		t.Errorf("Expected valid response after concurrent changes, got %d", w.Code)
	}
}
