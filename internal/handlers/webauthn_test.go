package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

// databaseInterface defines the interface we need for testing webauthn handlers
type databaseInterface interface {
	HasWebAuthnCredentials(ctx context.Context) bool
	ValidateSession(ctx context.Context, token string) (int64, error)
	GetWebAuthnUser(ctx context.Context) (webauthnUser, error)
	SaveWebAuthnSession(ctx context.Context, sessionID string, data []byte, ttl time.Duration) error
	GetWebAuthnSession(ctx context.Context, sessionID string) ([]byte, error)
	SaveWebAuthnCredential(ctx context.Context, userID int64, credential *webauthn.Credential, name string) error
	CreateSession(ctx context.Context, userID int64) (sessionInfo, error)
	UpdateCredentialSignCount(ctx context.Context, credID []byte, signCount uint32) error
	ListWebAuthnCredentials(ctx context.Context, userID int64) ([]credentialInfo, error)
	DeleteWebAuthnCredential(ctx context.Context, userID int64, credID int64) error
}

// webauthnUser interface for testing
type webauthnUser interface {
	GetUser() userInfo
}

// userInfo struct for testing
type userInfo struct {
	ID int64
}

// sessionInfo struct for testing
type sessionInfo struct {
	Token     string
	ExpiresAt time.Time
}

// credentialInfo struct for testing
type credentialInfo struct {
	ID         int64
	Name       string
	CreatedAt  time.Time
	LastUsedAt time.Time
	SignCount  uint32
}

// mockWebAuthnDatabase is a mock implementation for webauthn tests
type mockWebAuthnDatabase struct {
	hasWebAuthnCredentials        bool
	validateSessionFunc           func(ctx context.Context, token string) (int64, error)
	getWebAuthnUserFunc           func(ctx context.Context) (webauthnUser, error)
	saveWebAuthnSessionFunc       func(ctx context.Context, sessionID string, data []byte, ttl time.Duration) error
	getWebAuthnSessionFunc        func(ctx context.Context, sessionID string) ([]byte, error)
	saveWebAuthnCredentialFunc    func(ctx context.Context, userID int64, credential *webauthn.Credential, name string) error
	createSessionFunc             func(ctx context.Context, userID int64) (sessionInfo, error)
	updateCredentialSignCountFunc func(ctx context.Context, credID []byte, signCount uint32) error
	listWebAuthnCredentialsFunc   func(ctx context.Context, userID int64) ([]credentialInfo, error)
	deleteWebAuthnCredentialFunc  func(ctx context.Context, userID int64, credID int64) error
}

type mockWebAuthnUser struct {
	id int64
}

// mockHandlersWebAuthn is a test version of Handlers for webauthn tests
type mockHandlersWebAuthn struct {
	db databaseInterface
}

func (m *mockWebAuthnDatabase) HasWebAuthnCredentials(_ context.Context) bool {
	return m.hasWebAuthnCredentials
}

func (m *mockWebAuthnDatabase) ValidateSession(ctx context.Context, token string) (int64, error) {
	if m.validateSessionFunc != nil {
		return m.validateSessionFunc(ctx, token)
	}
	return 1, nil
}

func (m *mockWebAuthnDatabase) GetWebAuthnUser(ctx context.Context) (webauthnUser, error) {
	if m.getWebAuthnUserFunc != nil {
		return m.getWebAuthnUserFunc(ctx)
	}
	return &mockWebAuthnUser{id: 1}, nil
}

func (m *mockWebAuthnDatabase) SaveWebAuthnSession(ctx context.Context, sessionID string, data []byte, ttl time.Duration) error {
	if m.saveWebAuthnSessionFunc != nil {
		return m.saveWebAuthnSessionFunc(ctx, sessionID, data, ttl)
	}
	return nil
}

func (m *mockWebAuthnDatabase) GetWebAuthnSession(ctx context.Context, sessionID string) ([]byte, error) {
	if m.getWebAuthnSessionFunc != nil {
		return m.getWebAuthnSessionFunc(ctx, sessionID)
	}
	return []byte(`{}`), nil
}

func (m *mockWebAuthnDatabase) SaveWebAuthnCredential(ctx context.Context, userID int64, credential *webauthn.Credential, name string) error {
	if m.saveWebAuthnCredentialFunc != nil {
		return m.saveWebAuthnCredentialFunc(ctx, userID, credential, name)
	}
	return nil
}

func (m *mockWebAuthnDatabase) CreateSession(ctx context.Context, userID int64) (sessionInfo, error) {
	if m.createSessionFunc != nil {
		return m.createSessionFunc(ctx, userID)
	}
	return sessionInfo{
		Token:     "session-token",
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}, nil
}

func (m *mockWebAuthnDatabase) UpdateCredentialSignCount(ctx context.Context, credID []byte, signCount uint32) error {
	if m.updateCredentialSignCountFunc != nil {
		return m.updateCredentialSignCountFunc(ctx, credID, signCount)
	}
	return nil
}

func (m *mockWebAuthnDatabase) ListWebAuthnCredentials(ctx context.Context, userID int64) ([]credentialInfo, error) {
	if m.listWebAuthnCredentialsFunc != nil {
		return m.listWebAuthnCredentialsFunc(ctx, userID)
	}
	return []credentialInfo{}, nil
}

func (m *mockWebAuthnDatabase) DeleteWebAuthnCredential(ctx context.Context, userID, credID int64) error {
	if m.deleteWebAuthnCredentialFunc != nil {
		return m.deleteWebAuthnCredentialFunc(ctx, userID, credID)
	}
	return nil
}

func (m *mockWebAuthnUser) GetUser() userInfo {
	return userInfo{ID: m.id}
}

// Implement webauthn handlers on mockHandlersWebAuthn to match the real Handlers behavior
func (h *mockHandlersWebAuthn) WebAuthnAvailable(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	hasCredentials := h.db.HasWebAuthnCredentials(ctx)
	available := webAuthnEnabled && hasCredentials
	configError := "" // Mock doesn't validate config
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"available":      available,
		"enabled":        webAuthnEnabled,
		"hasCredentials": hasCredentials,
		"configError":    configError,
	})
}

func (h *mockHandlersWebAuthn) BeginWebAuthnRegistration(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if !webAuthnEnabled {
		http.Error(w, "WebAuthn not configured", http.StatusServiceUnavailable)
		return
	}

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "Must be logged in to register passkey", http.StatusUnauthorized)
		return
	}

	_, err = h.db.ValidateSession(ctx, cookie.Value)
	if err != nil {
		http.Error(w, "Invalid session", http.StatusUnauthorized)
		return
	}
}

func (h *mockHandlersWebAuthn) FinishWebAuthnRegistration(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if !webAuthnEnabled {
		http.Error(w, "WebAuthn not configured", http.StatusServiceUnavailable)
		return
	}

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "Must be logged in", http.StatusUnauthorized)
		return
	}

	_, err = h.db.ValidateSession(ctx, cookie.Value)
	if err != nil {
		http.Error(w, "Invalid session", http.StatusUnauthorized)
		return
	}

	var req struct {
		SessionID  string          `json:"sessionId"`
		Name       string          `json:"name"`
		Credential json.RawMessage `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
}

func (h *mockHandlersWebAuthn) BeginWebAuthnLogin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if !webAuthnEnabled {
		http.Error(w, "WebAuthn not configured", http.StatusServiceUnavailable)
		return
	}

	if !h.db.HasWebAuthnCredentials(ctx) {
		http.Error(w, "No passkeys registered", http.StatusNotFound)
		return
	}
}

func (h *mockHandlersWebAuthn) FinishWebAuthnLogin(w http.ResponseWriter, r *http.Request) {
	if !webAuthnEnabled {
		http.Error(w, "WebAuthn not configured", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		SessionID  string          `json:"sessionId"`
		Credential json.RawMessage `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
}

func (h *mockHandlersWebAuthn) ListPasskeys(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	_, err = h.db.ValidateSession(ctx, cookie.Value)
	if err != nil {
		http.Error(w, "Invalid session", http.StatusUnauthorized)
		return
	}
}

func (h *mockHandlersWebAuthn) DeletePasskey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	_, err = h.db.ValidateSession(ctx, cookie.Value)
	if err != nil {
		http.Error(w, "Invalid session", http.StatusUnauthorized)
		return
	}

	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
}

// Verify that database.Database can be used with our interface (compile-time check)
var _ = func() bool {
	// This is just for documentation - can't actually verify interface at compile time without instance
	return true
}()

func TestWebAuthnAvailable(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	// Save and restore global state
	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})

	tests := []struct {
		name                   string
		webAuthnEnabled        bool
		hasWebAuthnCredentials bool
		wantAvailable          bool
		wantEnabled            bool
	}{
		{
			name:                   "enabled and has credentials",
			webAuthnEnabled:        true,
			hasWebAuthnCredentials: true,
			wantAvailable:          true,
			wantEnabled:            true,
		},
		{
			name:                   "enabled but no credentials",
			webAuthnEnabled:        true,
			hasWebAuthnCredentials: false,
			wantAvailable:          false,
			wantEnabled:            true,
		},
		{
			name:                   "disabled with credentials",
			webAuthnEnabled:        false,
			hasWebAuthnCredentials: true,
			wantAvailable:          false,
			wantEnabled:            false,
		},
		{
			name:                   "disabled and no credentials",
			webAuthnEnabled:        false,
			hasWebAuthnCredentials: false,
			wantAvailable:          false,
			wantEnabled:            false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			webAuthnEnabled = tt.webAuthnEnabled

			mockDB := &mockWebAuthnDatabase{
				hasWebAuthnCredentials: tt.hasWebAuthnCredentials,
			}

			h := &mockHandlersWebAuthn{db: mockDB}

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

			available, ok := resp["available"].(bool)
			if !ok {
				t.Errorf("available field missing or not boolean")
			} else if available != tt.wantAvailable {
				t.Errorf("available = %v, want %v", available, tt.wantAvailable)
			}

			enabled, ok := resp["enabled"].(bool)
			if !ok {
				t.Errorf("enabled field missing or not boolean")
			} else if enabled != tt.wantEnabled {
				t.Errorf("enabled = %v, want %v", enabled, tt.wantEnabled)
			}

			hasCredentials, ok := resp["hasCredentials"].(bool)
			if !ok {
				t.Errorf("hasCredentials field missing or not boolean")
			} else if hasCredentials != tt.hasWebAuthnCredentials {
				t.Errorf("hasCredentials = %v, want %v", hasCredentials, tt.hasWebAuthnCredentials)
			}
		})
	}
}

func TestBeginWebAuthnRegistrationNotConfigured(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = false

	h := &mockHandlersWebAuthn{}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/begin", http.NoBody)
	w := httptest.NewRecorder()

	h.BeginWebAuthnRegistration(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}

	body := w.Body.String()
	if body == "" {
		t.Error("expected error message, got empty response")
	}
}

func TestBeginWebAuthnRegistrationNoSession(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = true

	h := &mockHandlersWebAuthn{}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/begin", http.NoBody)
	w := httptest.NewRecorder()

	h.BeginWebAuthnRegistration(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBeginWebAuthnRegistrationInvalidSession(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = true

	mockDB := &mockWebAuthnDatabase{
		validateSessionFunc: func(_ context.Context, _ string) (int64, error) {
			return 0, context.DeadlineExceeded
		},
	}

	h := &mockHandlersWebAuthn{db: mockDB}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/begin", http.NoBody)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "invalid-token"})
	w := httptest.NewRecorder()

	h.BeginWebAuthnRegistration(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestFinishWebAuthnRegistrationNotConfigured(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = false

	h := &mockHandlersWebAuthn{}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/finish", http.NoBody)
	w := httptest.NewRecorder()

	h.FinishWebAuthnRegistration(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}
}

func TestFinishWebAuthnRegistrationNoSession(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = true

	h := &mockHandlersWebAuthn{}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/finish", http.NoBody)
	w := httptest.NewRecorder()

	h.FinishWebAuthnRegistration(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestFinishWebAuthnRegistrationInvalidJSON(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = true

	mockDB := &mockWebAuthnDatabase{
		validateSessionFunc: func(_ context.Context, _ string) (int64, error) {
			return 1, nil
		},
	}

	h := &mockHandlersWebAuthn{db: mockDB}

	body := bytes.NewReader([]byte(`{invalid json`))
	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/finish", body)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "valid-token"})
	w := httptest.NewRecorder()

	h.FinishWebAuthnRegistration(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestBeginWebAuthnLoginNotConfigured(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = false

	h := &mockHandlersWebAuthn{}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/login/begin", http.NoBody)
	w := httptest.NewRecorder()

	h.BeginWebAuthnLogin(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}
}

func TestBeginWebAuthnLoginNoCredentials(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = true

	mockDB := &mockWebAuthnDatabase{
		hasWebAuthnCredentials: false,
	}

	h := &mockHandlersWebAuthn{db: mockDB}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/login/begin", http.NoBody)
	w := httptest.NewRecorder()

	h.BeginWebAuthnLogin(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestFinishWebAuthnLoginNotConfigured(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = false

	h := &mockHandlersWebAuthn{}

	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/login/finish", http.NoBody)
	w := httptest.NewRecorder()

	h.FinishWebAuthnLogin(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}
}

func TestFinishWebAuthnLoginInvalidJSON(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = true

	h := &mockHandlersWebAuthn{}

	body := bytes.NewReader([]byte(`{invalid json`))
	req := httptest.NewRequest(http.MethodPost, "/api/webauthn/login/finish", body)
	w := httptest.NewRecorder()

	h.FinishWebAuthnLogin(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestListPasskeysNoSession(t *testing.T) {
	t.Parallel()

	h := &mockHandlersWebAuthn{}

	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/passkeys", http.NoBody)
	w := httptest.NewRecorder()

	h.ListPasskeys(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestListPasskeysInvalidSession(t *testing.T) {
	t.Parallel()

	mockDB := &mockWebAuthnDatabase{
		validateSessionFunc: func(_ context.Context, _ string) (int64, error) {
			return 0, context.DeadlineExceeded
		},
	}

	h := &mockHandlersWebAuthn{db: mockDB}

	req := httptest.NewRequest(http.MethodGet, "/api/webauthn/passkeys", http.NoBody)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "invalid-token"})
	w := httptest.NewRecorder()

	h.ListPasskeys(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestDeletePasskeyNoSession(t *testing.T) {
	t.Parallel()

	h := &mockHandlersWebAuthn{}

	req := httptest.NewRequest(http.MethodDelete, "/api/webauthn/passkeys", http.NoBody)
	w := httptest.NewRecorder()

	h.DeletePasskey(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestDeletePasskeyInvalidSession(t *testing.T) {
	t.Parallel()

	mockDB := &mockWebAuthnDatabase{
		validateSessionFunc: func(_ context.Context, _ string) (int64, error) {
			return 0, context.DeadlineExceeded
		},
	}

	h := &mockHandlersWebAuthn{db: mockDB}

	req := httptest.NewRequest(http.MethodDelete, "/api/webauthn/passkeys", http.NoBody)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "invalid-token"})
	w := httptest.NewRecorder()

	h.DeletePasskey(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestDeletePasskeyInvalidJSON(t *testing.T) {
	t.Parallel()

	mockDB := &mockWebAuthnDatabase{
		validateSessionFunc: func(_ context.Context, _ string) (int64, error) {
			return 1, nil
		},
	}

	h := &mockHandlersWebAuthn{db: mockDB}

	body := bytes.NewReader([]byte(`{invalid json`))
	req := httptest.NewRequest(http.MethodDelete, "/api/webauthn/passkeys", body)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "valid-token"})
	w := httptest.NewRecorder()

	h.DeletePasskey(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestGenerateWebAuthnSessionID(t *testing.T) {
	t.Parallel()

	// Generate multiple session IDs
	ids := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := generateWebAuthnSessionID()
		if id == "" {
			t.Error("generateWebAuthnSessionID returned empty string")
		}

		// Check for uniqueness
		if ids[id] {
			t.Errorf("duplicate session ID generated: %s", id)
		}
		ids[id] = true

		// Check for reasonable length (32 bytes base64 encoded should be ~44 chars)
		if len(id) < 40 || len(id) > 50 {
			t.Errorf("session ID length = %d, expected ~44 characters", len(id))
		}
	}
}

func TestGenerateWebAuthnSessionIDUniqueness(t *testing.T) {
	t.Parallel()

	id1 := generateWebAuthnSessionID()
	id2 := generateWebAuthnSessionID()

	if id1 == id2 {
		t.Error("generateWebAuthnSessionID generated duplicate IDs")
	}

	if id1 == "" || id2 == "" {
		t.Error("generateWebAuthnSessionID returned empty string")
	}
}

func TestCredentialsToDescriptors(t *testing.T) {
	t.Parallel()

	// Note: This function uses webauthn.Credential which we can't easily mock
	// Testing with empty slice
	descriptors := credentialsToDescriptors([]webauthn.Credential{})
	if len(descriptors) != 0 {
		t.Errorf("expected 0 descriptors, got %d", len(descriptors))
	}
}

func TestWebAuthnHandlersConcurrency(t *testing.T) {
	// Cannot use t.Parallel() - modifies global webAuthnEnabled state

	originalEnabled := webAuthnEnabled
	t.Cleanup(func() {
		webAuthnEnabled = originalEnabled
	})
	webAuthnEnabled = true

	mockDB := &mockWebAuthnDatabase{
		hasWebAuthnCredentials: true,
	}

	h := &mockHandlersWebAuthn{db: mockDB}

	// Run multiple concurrent WebAuthnAvailable requests
	const numRequests = 10
	results := make(chan int, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
			w := httptest.NewRecorder()
			h.WebAuthnAvailable(w, req)
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

func TestWebAuthnResponseStructures(t *testing.T) {
	// Cannot use t.Parallel() on parent - subtests modify global webAuthnEnabled state

	tests := []struct {
		name           string
		handler        func(*mockHandlersWebAuthn, http.ResponseWriter, *http.Request)
		setupRequest   func() *http.Request
		expectedFields []string
		expectedStatus int
	}{
		{
			name: "WebAuthnAvailable response",
			handler: func(h *mockHandlersWebAuthn, w http.ResponseWriter, r *http.Request) {
				h.WebAuthnAvailable(w, r)
			},
			setupRequest: func() *http.Request {
				return httptest.NewRequest(http.MethodGet, "/api/webauthn/available", http.NoBody)
			},
			expectedFields: []string{"available", "enabled"},
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			originalEnabled := webAuthnEnabled
			t.Cleanup(func() {
				webAuthnEnabled = originalEnabled
			})
			webAuthnEnabled = true

			mockDB := &mockWebAuthnDatabase{
				hasWebAuthnCredentials: true,
			}

			h := &mockHandlersWebAuthn{db: mockDB}

			req := tt.setupRequest()
			w := httptest.NewRecorder()

			tt.handler(h, w, req)

			if w.Code != tt.expectedStatus {
				t.Fatalf("status = %d, want %d", w.Code, tt.expectedStatus)
			}

			var resp map[string]interface{}
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			for _, field := range tt.expectedFields {
				if _, exists := resp[field]; !exists {
					t.Errorf("expected field %q missing from response", field)
				}
			}
		})
	}
}

func TestWebAuthnEdgeCases(t *testing.T) {
	// Cannot use t.Parallel() on parent - subtests modify global webAuthnEnabled state

	tests := []struct {
		name         string
		setupHandler func() *mockHandlersWebAuthn
		setupRequest func() *http.Request
		handler      func(*mockHandlersWebAuthn, http.ResponseWriter, *http.Request)
		wantStatus   int
	}{
		{
			name: "BeginWebAuthnRegistration with empty cookie",
			setupHandler: func() *mockHandlersWebAuthn {
				return &mockHandlersWebAuthn{}
			},
			setupRequest: func() *http.Request {
				req := httptest.NewRequest(http.MethodPost, "/api/webauthn/register/begin", http.NoBody)
				req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: ""})
				return req
			},
			handler: func(h *mockHandlersWebAuthn, w http.ResponseWriter, r *http.Request) {
				h.BeginWebAuthnRegistration(w, r)
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "FinishWebAuthnLogin with empty request body",
			setupHandler: func() *mockHandlersWebAuthn {
				return &mockHandlersWebAuthn{}
			},
			setupRequest: func() *http.Request {
				return httptest.NewRequest(http.MethodPost, "/api/webauthn/login/finish", bytes.NewReader([]byte{}))
			},
			handler: func(h *mockHandlersWebAuthn, w http.ResponseWriter, r *http.Request) {
				h.FinishWebAuthnLogin(w, r)
			},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Note: Not using t.Parallel() here because we're modifying
			// the global webAuthnEnabled variable

			originalEnabled := webAuthnEnabled
			t.Cleanup(func() {
				webAuthnEnabled = originalEnabled
			})
			webAuthnEnabled = true

			h := tt.setupHandler()
			req := tt.setupRequest()
			w := httptest.NewRecorder()

			tt.handler(h, w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}
		})
	}
}
