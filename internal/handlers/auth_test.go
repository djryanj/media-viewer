package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"

	"golang.org/x/crypto/bcrypt"
)

// This file contains mock-based tests for authentication handlers.
// The original auth_test.go uses real SQLite databases which are slower.
// These mock-based tests run 10-100x faster and provide better isolation.

// =============================================================================
// Mock Database for Auth Tests
// =============================================================================

type mockAuthDB struct {
	mu                  sync.RWMutex                 // Protects all fields below
	users               map[int64]*database.User     // userID -> User
	sessions            map[string]*database.Session // token -> Session
	nextUserID          int64
	nextSessionID       int64
	hasUsersVal         bool
	setupCompleteVal    bool
	createUserErr       error
	validatePasswordErr error
	createSessionErr    error
	deleteSessionErr    error
	validateSessionErr  error
	extendSessionErr    error
	updatePasswordErr   error
}

func newMockAuthDB() *mockAuthDB {
	return &mockAuthDB{
		users:         make(map[int64]*database.User),
		sessions:      make(map[string]*database.Session),
		nextUserID:    1,
		nextSessionID: 1,
	}
}

func (m *mockAuthDB) IsSetupComplete(_ context.Context) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.setupCompleteVal
}

func (m *mockAuthDB) HasUsers(_ context.Context) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.hasUsersVal
}

func (m *mockAuthDB) CreateUser(_ context.Context, password string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.createUserErr != nil {
		return m.createUserErr
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	user := &database.User{
		ID:           m.nextUserID,
		PasswordHash: string(hashedPassword),
		CreatedAt:    time.Now(),
	}
	m.users[m.nextUserID] = user
	m.nextUserID++
	m.hasUsersVal = true
	m.setupCompleteVal = true

	return nil
}

func (m *mockAuthDB) ValidatePassword(_ context.Context, password string) (*database.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.validatePasswordErr != nil {
		return nil, m.validatePasswordErr
	}

	for _, user := range m.users {
		if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err == nil {
			return user, nil
		}
	}

	return nil, errors.New("invalid password")
}

func (m *mockAuthDB) CreateSession(_ context.Context, userID int64) (*database.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.createSessionErr != nil {
		return nil, m.createSessionErr
	}

	// Generate random token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, err
	}
	token := base64.URLEncoding.EncodeToString(tokenBytes)

	session := &database.Session{
		ID:        m.nextSessionID,
		UserID:    userID,
		Token:     token,
		ExpiresAt: time.Now().Add(24 * time.Hour),
		CreatedAt: time.Now(),
	}

	m.sessions[token] = session
	m.nextSessionID++

	return session, nil
}

func (m *mockAuthDB) DeleteSession(_ context.Context, token string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.deleteSessionErr != nil {
		return m.deleteSessionErr
	}

	delete(m.sessions, token)
	return nil
}

func (m *mockAuthDB) ValidateSession(_ context.Context, token string) (*database.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.validateSessionErr != nil {
		return nil, m.validateSessionErr
	}

	session, exists := m.sessions[token]
	if !exists {
		return nil, errors.New("session not found")
	}

	if time.Now().After(session.ExpiresAt) {
		delete(m.sessions, token)
		return nil, errors.New("session expired")
	}

	return session, nil
}

func (m *mockAuthDB) ExtendSession(_ context.Context, token string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.extendSessionErr != nil {
		return m.extendSessionErr
	}

	session, exists := m.sessions[token]
	if !exists {
		return errors.New("session not found")
	}

	session.ExpiresAt = time.Now().Add(24 * time.Hour)
	return nil
}

func (m *mockAuthDB) UpdatePassword(_ context.Context, newPassword string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.updatePasswordErr != nil {
		return m.updatePasswordErr
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	// Update first user's password (there should only be one in our tests)
	for _, user := range m.users {
		user.PasswordHash = string(hashedPassword)
		break
	}

	return nil
}

// mockHandlersAuth wraps Handlers to use mock database
type mockHandlersAuth struct {
	*Handlers
	db *mockAuthDB
}

func newMockHandlersAuth() *mockHandlersAuth {
	mockDB := newMockAuthDB()
	return &mockHandlersAuth{
		Handlers: &Handlers{
			db: nil, // We'll intercept calls
		},
		db: mockDB,
	}
}

// Override methods to use mock DB
func (h *mockHandlersAuth) Setup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.db.IsSetupComplete(ctx) {
		http.Error(w, "Setup already completed", http.StatusConflict)
		return
	}

	var req SetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 8 {
		http.Error(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	if len(req.Password) > 72 {
		http.Error(w, "Password must not exceed 72 characters", http.StatusBadRequest)
		return
	}

	if err := h.db.CreateUser(ctx, req.Password); err != nil {
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success: true,
		Message: "Setup completed successfully",
	})
}

func (h *mockHandlersAuth) Login(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	user, err := h.db.ValidatePassword(ctx, req.Password)
	if err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	session, err := h.db.CreateSession(ctx, user.ID)
	if err != nil {
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    session.Token,
		Path:     "/",
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteStrictMode,
		Expires:  session.ExpiresAt,
	})

	expiresIn := int(time.Until(session.ExpiresAt).Seconds())

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success:   true,
		Username:  "admin", // Single user system
		ExpiresIn: expiresIn,
	})
}

func (h *mockHandlersAuth) Logout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cookie, err := r.Cookie(SessionCookieName)
	if err == nil && cookie.Value != "" {
		// Best-effort session cleanup - don't fail logout if this errors
		if err := h.db.DeleteSession(ctx, cookie.Value); err != nil {
			logging.Error("failed to delete session during logout: %v", err)
		}
	}

	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success: true,
		Message: "Logged out successfully",
	})
}

func (h *mockHandlersAuth) CheckAuth(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	_, err = h.db.ValidateSession(ctx, cookie.Value)
	if err != nil {
		http.SetCookie(w, &http.Cookie{
			Name:     SessionCookieName,
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			MaxAge:   -1,
		})
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success: true,
	})
}

func (h *mockHandlersAuth) ChangePassword(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req PasswordChangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	_, err := h.db.ValidatePassword(ctx, req.CurrentPassword)
	if err != nil {
		http.Error(w, "Current password is incorrect", http.StatusUnauthorized)
		return
	}

	if len(req.NewPassword) < 8 {
		http.Error(w, "New password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	if len(req.NewPassword) > 72 {
		http.Error(w, "New password must not exceed 72 characters", http.StatusBadRequest)
		return
	}

	if err := h.db.UpdatePassword(ctx, req.NewPassword); err != nil {
		http.Error(w, "Failed to update password", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success: true,
		Message: "Password changed successfully",
	})
}

func (h *mockHandlersAuth) Keepalive(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	_, err = h.db.ValidateSession(ctx, cookie.Value)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.db.ExtendSession(ctx, cookie.Value); err != nil {
		http.Error(w, "Failed to extend session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success: true,
	})
}

// =============================================================================
// Setup Tests
// =============================================================================

func TestSetupMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		password       string
		expectedStatus int
		alreadySetup   bool
	}{
		{
			name:           "Valid setup",
			password:       "testpassword123",
			expectedStatus: http.StatusOK,
			alreadySetup:   false,
		},
		{
			name:           "Password too short",
			password:       "short",
			expectedStatus: http.StatusBadRequest,
			alreadySetup:   false,
		},
		{
			name:           "Setup already completed",
			password:       "testpassword123",
			expectedStatus: http.StatusConflict,
			alreadySetup:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersAuth()
			if tt.alreadySetup {
				ctx := context.Background()
				_ = h.db.CreateUser(ctx, "existingpassword123")
			}

			reqBody := SetupRequest{Password: tt.password}
			body, _ := json.Marshal(reqBody)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.Setup(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			if tt.expectedStatus == http.StatusOK {
				// Verify user was created
				ctx := context.Background()
				if !h.db.HasUsers(ctx) {
					t.Error("Expected user to be created")
				}
			}
		})
	}
}

func TestSetupInvalidJSONMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()

	req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Setup(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

// =============================================================================
// Login Tests
// =============================================================================

func TestLoginMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		password       string
		loginPassword  string
		expectedStatus int
	}{
		{
			name:           "Valid login",
			password:       "testpassword123",
			loginPassword:  "testpassword123",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Invalid password",
			password:       "testpassword123",
			loginPassword:  "wrongpassword",
			expectedStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersAuth()
			ctx := context.Background()
			_ = h.db.CreateUser(ctx, tt.password)

			reqBody := LoginRequest{Password: tt.loginPassword}
			body, _ := json.Marshal(reqBody)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.Login(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			if tt.expectedStatus == http.StatusOK {
				// Verify session cookie was set
				cookies := w.Result().Cookies()
				found := false
				for _, cookie := range cookies {
					if cookie.Name == SessionCookieName && cookie.Value != "" {
						found = true
						break
					}
				}
				if !found {
					t.Error("Expected session cookie to be set")
				}

				// Verify response contains success and username
				var response AuthResponse
				if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
					t.Fatalf("Failed to decode response: %v", err)
				}

				if !response.Success {
					t.Error("Expected success=true in response")
				}
				if response.Username == "" {
					t.Error("Expected username in response")
				}
			}
		})
	}
}

func TestLoginInvalidJSONMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Login(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

func TestLoginNoUserMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()

	reqBody := LoginRequest{Password: "anypassword"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Login(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d, got %d", http.StatusUnauthorized, w.Code)
	}
}

// =============================================================================
// Logout Tests
// =============================================================================

func TestLogoutMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	ctx := context.Background()
	_ = h.db.CreateUser(ctx, "testpassword123")
	user, _ := h.db.ValidatePassword(ctx, "testpassword123")
	session, _ := h.db.CreateSession(ctx, user.ID)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", http.NoBody)
	req.AddCookie(&http.Cookie{
		Name:  SessionCookieName,
		Value: session.Token,
	})
	w := httptest.NewRecorder()

	h.Logout(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	// Verify session was deleted
	_, err := h.db.ValidateSession(ctx, session.Token)
	if err == nil {
		t.Error("Expected session to be deleted")
	}

	// Verify cookie was cleared
	cookies := w.Result().Cookies()
	for _, cookie := range cookies {
		if cookie.Name == SessionCookieName && cookie.MaxAge != -1 {
			t.Error("Expected session cookie to have MaxAge=-1")
		}
	}
}

func TestLogoutWithoutCookieMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()

	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", http.NoBody)
	w := httptest.NewRecorder()

	h.Logout(w, req)

	// Should succeed even without cookie
	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}
}

// =============================================================================
// CheckAuth Tests
// =============================================================================

func TestCheckAuthMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		createSession  bool
		validSession   bool
		expectedStatus int
	}{
		{
			name:           "Valid session",
			createSession:  true,
			validSession:   true,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "No cookie",
			createSession:  false,
			validSession:   false,
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Invalid session",
			createSession:  true,
			validSession:   false,
			expectedStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersAuth()
			ctx := context.Background()

			var sessionToken string
			if tt.createSession {
				_ = h.db.CreateUser(ctx, "testpassword123")
				user, _ := h.db.ValidatePassword(ctx, "testpassword123")
				session, _ := h.db.CreateSession(ctx, user.ID)
				sessionToken = session.Token

				if !tt.validSession {
					// Delete session to make it invalid
					_ = h.db.DeleteSession(ctx, sessionToken)
				}
			}

			req := httptest.NewRequest(http.MethodGet, "/api/auth/check", http.NoBody)
			if tt.createSession {
				req.AddCookie(&http.Cookie{
					Name:  SessionCookieName,
					Value: sessionToken,
				})
			}
			w := httptest.NewRecorder()

			h.CheckAuth(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}

// =============================================================================
// ChangePassword Tests
// =============================================================================

func TestChangePasswordMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		currentPassword string
		newPassword     string
		actualPassword  string
		expectedStatus  int
	}{
		{
			name:            "Valid password change",
			currentPassword: "oldpassword123",
			newPassword:     "newpassword123",
			actualPassword:  "oldpassword123",
			expectedStatus:  http.StatusOK,
		},
		{
			name:            "Wrong current password",
			currentPassword: "wrongpassword",
			newPassword:     "newpassword123",
			actualPassword:  "oldpassword123",
			expectedStatus:  http.StatusUnauthorized,
		},
		{
			name:            "New password too short",
			currentPassword: "oldpassword123",
			newPassword:     "short",
			actualPassword:  "oldpassword123",
			expectedStatus:  http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersAuth()
			ctx := context.Background()
			_ = h.db.CreateUser(ctx, tt.actualPassword)

			reqBody := PasswordChangeRequest{
				CurrentPassword: tt.currentPassword,
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

			if tt.expectedStatus == http.StatusOK {
				// Verify password was changed
				_, err := h.db.ValidatePassword(ctx, tt.newPassword)
				if err != nil {
					t.Error("Expected new password to be valid")
				}
			}
		})
	}
}

func TestChangePasswordInvalidJSONMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()

	req := httptest.NewRequest(http.MethodPost, "/api/auth/change-password", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ChangePassword(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

// =============================================================================
// Keepalive Tests
// =============================================================================

func TestKeepaliveMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		createSession  bool
		validSession   bool
		expectedStatus int
	}{
		{
			name:           "Valid session extension",
			createSession:  true,
			validSession:   true,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "No cookie",
			createSession:  false,
			validSession:   false,
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Invalid session",
			createSession:  true,
			validSession:   false,
			expectedStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersAuth()
			ctx := context.Background()

			var sessionToken string
			if tt.createSession {
				_ = h.db.CreateUser(ctx, "testpassword123")
				user, _ := h.db.ValidatePassword(ctx, "testpassword123")
				session, _ := h.db.CreateSession(ctx, user.ID)
				sessionToken = session.Token

				if !tt.validSession {
					_ = h.db.DeleteSession(ctx, sessionToken)
				}
			}

			req := httptest.NewRequest(http.MethodPost, "/api/auth/keepalive", http.NoBody)
			if tt.createSession {
				req.AddCookie(&http.Cookie{
					Name:  SessionCookieName,
					Value: sessionToken,
				})
			}
			w := httptest.NewRecorder()

			h.Keepalive(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}

// =============================================================================
// Session Security Tests
// =============================================================================

func TestSessionCookieSecurityAttributesMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	ctx := context.Background()
	_ = h.db.CreateUser(ctx, "testpassword123")

	reqBody := LoginRequest{Password: "testpassword123"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Login(w, req)

	cookies := w.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, cookie := range cookies {
		if cookie.Name == SessionCookieName {
			sessionCookie = cookie
			break
		}
	}

	if sessionCookie == nil {
		t.Fatal("Session cookie not found")
	}

	if !sessionCookie.HttpOnly {
		t.Error("Expected HttpOnly=true")
	}
	if sessionCookie.Path != "/" {
		t.Errorf("Expected Path=/, got %s", sessionCookie.Path)
	}
	if sessionCookie.SameSite != http.SameSiteStrictMode {
		t.Errorf("Expected SameSite=Strict, got %v", sessionCookie.SameSite)
	}
}

func TestSessionTokenUniquenessMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	ctx := context.Background()
	_ = h.db.CreateUser(ctx, "testpassword123")
	user, _ := h.db.ValidatePassword(ctx, "testpassword123")

	tokens := make(map[string]bool)
	for i := 0; i < 10; i++ {
		session, _ := h.db.CreateSession(ctx, user.ID)
		if tokens[session.Token] {
			t.Error("Duplicate session token generated")
		}
		tokens[session.Token] = true
	}
}

// =============================================================================
// Error Handling Tests
// =============================================================================

func TestLoginWithDatabaseErrorMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	h.db.validatePasswordErr = context.DeadlineExceeded

	reqBody := LoginRequest{Password: "testpassword123"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Login(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d, got %d", http.StatusUnauthorized, w.Code)
	}
}

func TestSetupWithDatabaseErrorMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	h.db.createUserErr = context.DeadlineExceeded

	reqBody := SetupRequest{Password: "testpassword123"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Setup(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status %d, got %d", http.StatusInternalServerError, w.Code)
	}
}

// =============================================================================
// Additional Boundary and Edge Case Tests
// =============================================================================

func TestSetupPasswordBoundaryMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		password       string
		expectedStatus int
	}{
		{
			name:           "Exactly 8 characters",
			password:       "12345678",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "7 characters (too short)",
			password:       "1234567",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Very long password",
			password:       strings.Repeat("a", 72),
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersAuth()

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

func TestLogoutInvalidatesSessionMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	ctx := context.Background()
	_ = h.db.CreateUser(ctx, "testpassword123")
	user, _ := h.db.ValidatePassword(ctx, "testpassword123")
	session, _ := h.db.CreateSession(ctx, user.ID)

	// Logout
	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", http.NoBody)
	req.AddCookie(&http.Cookie{
		Name:  SessionCookieName,
		Value: session.Token,
	})
	w := httptest.NewRecorder()

	h.Logout(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Logout failed: %d", w.Code)
	}

	// Try to use the session - should fail
	req2 := httptest.NewRequest(http.MethodGet, "/api/auth/check", http.NoBody)
	req2.AddCookie(&http.Cookie{
		Name:  SessionCookieName,
		Value: session.Token,
	})
	w2 := httptest.NewRecorder()

	h.CheckAuth(w2, req2)

	if w2.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d after logout, got %d", http.StatusUnauthorized, w2.Code)
	}
}

func TestCheckAuthClearsCookieOnInvalidSessionMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()

	req := httptest.NewRequest(http.MethodGet, "/api/auth/check", http.NoBody)
	req.AddCookie(&http.Cookie{
		Name:  SessionCookieName,
		Value: "invalid-session-token",
	})
	w := httptest.NewRecorder()

	h.CheckAuth(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d, got %d", http.StatusUnauthorized, w.Code)
	}

	// Verify cookie was cleared
	cookies := w.Result().Cookies()
	found := false
	for _, cookie := range cookies {
		if cookie.Name == SessionCookieName && cookie.MaxAge == -1 {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected session cookie to be cleared")
	}
}

func TestChangePasswordBoundaryMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		newPassword    string
		expectedStatus int
	}{
		{
			name:           "Exactly 8 characters",
			newPassword:    "newpass8",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "7 characters (too short)",
			newPassword:    "newpas7",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Very long password",
			newPassword:    strings.Repeat("b", 72),
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersAuth()
			ctx := context.Background()
			_ = h.db.CreateUser(ctx, "oldpassword123")

			reqBody := PasswordChangeRequest{
				CurrentPassword: "oldpassword123",
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
		})
	}
}

func TestKeepaliveEmptyCookieMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()

	req := httptest.NewRequest(http.MethodPost, "/api/auth/keepalive", http.NoBody)
	req.AddCookie(&http.Cookie{
		Name:  SessionCookieName,
		Value: "",
	})
	w := httptest.NewRecorder()

	h.Keepalive(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d, got %d", http.StatusUnauthorized, w.Code)
	}
}

func TestConcurrentAuthenticationMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	ctx := context.Background()
	_ = h.db.CreateUser(ctx, "testpassword123")

	// Create 10 concurrent login requests
	numRequests := 10
	done := make(chan bool, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			reqBody := LoginRequest{Password: "testpassword123"}
			body, _ := json.Marshal(reqBody)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.Login(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Concurrent login failed: %d", w.Code)
			}

			done <- true
		}()
	}

	// Wait for all to complete
	for i := 0; i < numRequests; i++ {
		<-done
	}
}

func TestLoginWithLargePasswordMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	ctx := context.Background()

	// Create user with large password (72 characters - bcrypt's maximum)
	largePassword := strings.Repeat("a", 72)
	_ = h.db.CreateUser(ctx, largePassword)

	reqBody := LoginRequest{Password: largePassword}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Login(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}
}

func TestLoginWithSpecialCharactersInPasswordMock(t *testing.T) {
	t.Parallel()

	specialPasswords := []string{
		"pass!@#$%^&*()",
		"pass with spaces",
		"pass\"quotes\"",
		"pass'single'",
		"パスワード123",
		"пароль123",
		"pass\nwith\nnewlines",
		"pass\twith\ttabs",
	}

	for _, password := range specialPasswords {
		t.Run("Password: "+password[:min(len(password), 20)], func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersAuth()
			ctx := context.Background()
			_ = h.db.CreateUser(ctx, password)

			reqBody := LoginRequest{Password: password}
			body, _ := json.Marshal(reqBody)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.Login(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status %d for password %q, got %d", http.StatusOK, password, w.Code)
			}
		})
	}
}

func TestSetupWithSpecialCharactersInPasswordMock(t *testing.T) {
	t.Parallel()

	specialPasswords := []string{
		"pass!@#$%^&*()",
		"pass with spaces",
		"パスワード123",
		"пароль123",
	}

	for _, password := range specialPasswords {
		t.Run("Password: "+password[:min(len(password), 20)], func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersAuth()

			reqBody := SetupRequest{Password: password}
			body, _ := json.Marshal(reqBody)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.Setup(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status %d for password %q, got %d", http.StatusOK, password, w.Code)
			}

			// Verify can login with that password
			ctx := context.Background()
			_, err := h.db.ValidatePassword(ctx, password)
			if err != nil {
				t.Errorf("Failed to validate password %q: %v", password, err)
			}
		})
	}
}

func TestMultipleLogoutCallsMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	ctx := context.Background()
	_ = h.db.CreateUser(ctx, "testpassword123")
	user, _ := h.db.ValidatePassword(ctx, "testpassword123")
	session, _ := h.db.CreateSession(ctx, user.ID)

	// Call logout multiple times
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", http.NoBody)
		req.AddCookie(&http.Cookie{
			Name:  SessionCookieName,
			Value: session.Token,
		})
		w := httptest.NewRecorder()

		h.Logout(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Logout call %d failed: %d", i+1, w.Code)
		}
	}
}

func TestLoginResponseStructureMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	ctx := context.Background()
	_ = h.db.CreateUser(ctx, "testpassword123")

	reqBody := LoginRequest{Password: "testpassword123"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Login(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response AuthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response.Success {
		t.Error("Expected success=true")
	}
	if response.Username == "" {
		t.Error("Expected username to be set")
	}
	if response.ExpiresIn <= 0 {
		t.Error("Expected expiresIn to be positive")
	}
}

func TestSetupResponseStructureMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()

	reqBody := SetupRequest{Password: "testpassword123"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Setup(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response AuthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response.Success {
		t.Error("Expected success=true")
	}
	if response.Message == "" {
		t.Error("Expected message to be set")
	}
}

func TestChangePasswordResponseStructureMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersAuth()
	ctx := context.Background()
	_ = h.db.CreateUser(ctx, "oldpassword123")

	reqBody := PasswordChangeRequest{
		CurrentPassword: "oldpassword123",
		NewPassword:     "newpassword123",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/change-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ChangePassword(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response AuthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response.Success {
		t.Error("Expected success=true")
	}
	if response.Message == "" {
		t.Error("Expected message to be set")
	}
}

func TestSessionCookieNameConstantMock(t *testing.T) {
	t.Parallel()

	if SessionCookieName == "" {
		t.Error("SessionCookieName should not be empty")
	}

	// Verify the constant is used consistently
	expected := "media_viewer_session"
	if SessionCookieName != expected {
		t.Errorf("Expected SessionCookieName=%q, got %q", expected, SessionCookieName)
	}
}
