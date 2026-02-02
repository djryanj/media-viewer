package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"
	"media-viewer/internal/startup"
)

// webAuthnInstance is the WebAuthn configuration instance
var webAuthnInstance *webauthn.WebAuthn

// webAuthnEnabled tracks whether WebAuthn is available
var webAuthnEnabled bool

// InitWebAuthn initializes the WebAuthn configuration
func InitWebAuthn(config *startup.Config, db *database.Database) error {
	startup.LogWebAuthnInit(config.WebAuthnEnabled, config.WebAuthnRPID)

	if !config.WebAuthnEnabled {
		webAuthnEnabled = false
		return nil
	}

	// Initialize database schema
	if err := db.InitWebAuthnSchema(); err != nil {
		startup.LogWebAuthnInitError(err)
		webAuthnEnabled = false
		return nil
	}

	// Create WebAuthn instance
	// Note: We don't set AuthenticatorSelection here - we'll set it per-request
	// to allow flexibility between platform and cross-platform authenticators
	var err error
	webAuthnInstance, err = webauthn.New(&webauthn.Config{
		RPDisplayName:         config.WebAuthnRPDisplayName,
		RPID:                  config.WebAuthnRPID,
		RPOrigins:             config.WebAuthnRPOrigins,
		AttestationPreference: protocol.PreferNoAttestation,
		// Don't set AuthenticatorSelection globally - we'll set it per registration
	})

	if err != nil {
		startup.LogWebAuthnInitError(err)
		webAuthnEnabled = false
		return nil
	}

	webAuthnEnabled = true
	credCount := db.CountWebAuthnCredentials(context.TODO())
	startup.LogWebAuthnInitComplete(credCount)

	return nil
}

// credentialsToDescriptors converts credentials for exclusion list
func credentialsToDescriptors(creds []webauthn.Credential) []protocol.CredentialDescriptor {
	descriptors := make([]protocol.CredentialDescriptor, len(creds))
	for i, cred := range creds {
		descriptors[i] = protocol.CredentialDescriptor{
			Type:         protocol.PublicKeyCredentialType,
			CredentialID: cred.ID,
			Transport:    cred.Transport,
		}
	}
	return descriptors
}

// WebAuthnAvailable returns whether passkey login is available
func (h *Handlers) WebAuthnAvailable(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	available := webAuthnEnabled && h.db.HasWebAuthnCredentials(ctx)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"available": available,
		"enabled":   webAuthnEnabled,
	})
}

// BeginWebAuthnRegistration starts the passkey registration process
func (h *Handlers) BeginWebAuthnRegistration(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if !webAuthnEnabled {
		logging.Debug("WebAuthn registration attempted but not configured")
		http.Error(w, "WebAuthn not configured", http.StatusServiceUnavailable)
		return
	}

	// Verify user is authenticated
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

	user, err := h.db.GetWebAuthnUser(ctx)
	if err != nil {
		logging.Error("Failed to get WebAuthn user: %v", err)
		http.Error(w, "Failed to get user", http.StatusInternalServerError)
		return
	}

	exclusions := credentialsToDescriptors(user.WebAuthnCredentials())

	// Configure for PLATFORM authenticators (Windows Hello, Touch ID, Face ID)
	// This prioritizes built-in biometrics over USB security keys
	authSelection := protocol.AuthenticatorSelection{
		// "platform" = built-in authenticators (Touch ID, Face ID, Windows Hello)
		// "cross-platform" = roaming authenticators (USB keys, phones)
		// Not setting this allows both, but we prefer platform
		AuthenticatorAttachment: protocol.Platform,

		// Require user verification (biometric or PIN)
		UserVerification: protocol.VerificationRequired,

		// Prefer resident keys (discoverable credentials) for better UX
		// This allows passwordless login without needing to type a username
		ResidentKey: protocol.ResidentKeyRequirementPreferred,

		// RequireResidentKey is deprecated, use ResidentKey instead
		// But some older browsers might need this
		RequireResidentKey: protocol.ResidentKeyNotRequired(),
	}

	options, session, err := webAuthnInstance.BeginRegistration(user,
		webauthn.WithExclusions(exclusions),
		webauthn.WithAuthenticatorSelection(authSelection),
	)
	if err != nil {
		logging.Error("Failed to begin WebAuthn registration: %v", err)
		http.Error(w, "Failed to start registration", http.StatusInternalServerError)
		return
	}

	sessionData, err := json.Marshal(session)
	if err != nil {
		http.Error(w, "Failed to store session", http.StatusInternalServerError)
		return
	}

	sessionID := generateWebAuthnSessionID()
	if err := h.db.SaveWebAuthnSession(ctx, sessionID, sessionData, 5*time.Minute); err != nil {
		http.Error(w, "Failed to store session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"options":   options,
		"sessionId": sessionID,
	})
}

// FinishWebAuthnRegistration completes the passkey registration
func (h *Handlers) FinishWebAuthnRegistration(w http.ResponseWriter, r *http.Request) {
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

	if req.Name == "" {
		req.Name = "Passkey"
	}

	sessionData, err := h.db.GetWebAuthnSession(ctx, req.SessionID)
	if err != nil {
		http.Error(w, "Invalid or expired session", http.StatusBadRequest)
		return
	}

	var session webauthn.SessionData
	if err := json.Unmarshal(sessionData, &session); err != nil {
		http.Error(w, "Invalid session data", http.StatusInternalServerError)
		return
	}

	user, err := h.db.GetWebAuthnUser(ctx)
	if err != nil {
		http.Error(w, "Failed to get user", http.StatusInternalServerError)
		return
	}

	credentialResponse, err := protocol.ParseCredentialCreationResponseBody(
		bytes.NewReader(req.Credential),
	)
	if err != nil {
		logging.Warn("Failed to parse credential: %v", err)
		http.Error(w, "Invalid credential", http.StatusBadRequest)
		return
	}

	credential, err := webAuthnInstance.CreateCredential(user, session, credentialResponse)
	if err != nil {
		logging.Warn("Failed to create credential: %v", err)
		http.Error(w, "Failed to verify credential", http.StatusBadRequest)
		return
	}

	if err := h.db.SaveWebAuthnCredential(ctx, user.GetUser().ID, credential, req.Name); err != nil {
		logging.Error("Failed to save credential: %v", err)
		http.Error(w, "Failed to save credential", http.StatusInternalServerError)
		return
	}

	logging.Info("Registered new passkey: %s", req.Name)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"success": true,
		"message": "Passkey registered successfully",
	})
}

// BeginWebAuthnLogin starts the passkey authentication process
func (h *Handlers) BeginWebAuthnLogin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if !webAuthnEnabled {
		logging.Debug("WebAuthn login attempted but not configured")
		http.Error(w, "WebAuthn not configured", http.StatusServiceUnavailable)
		return
	}

	if !h.db.HasWebAuthnCredentials(ctx) {
		http.Error(w, "No passkeys registered", http.StatusNotFound)
		return
	}

	user, err := h.db.GetWebAuthnUser(ctx)
	if err != nil {
		http.Error(w, "No user found", http.StatusNotFound)
		return
	}

	if len(user.WebAuthnCredentials()) == 0 {
		http.Error(w, "No passkeys registered", http.StatusNotFound)
		return
	}

	// For login, we allow any authenticator type that was previously registered
	options, session, err := webAuthnInstance.BeginLogin(user,
		webauthn.WithUserVerification(protocol.VerificationRequired),
	)
	if err != nil {
		logging.Error("Failed to begin WebAuthn login: %v", err)
		http.Error(w, "Failed to start login", http.StatusInternalServerError)
		return
	}

	sessionData, err := json.Marshal(session)
	if err != nil {
		http.Error(w, "Failed to store session", http.StatusInternalServerError)
		return
	}

	sessionID := generateWebAuthnSessionID()
	if err := h.db.SaveWebAuthnSession(ctx, sessionID, sessionData, 5*time.Minute); err != nil {
		http.Error(w, "Failed to store session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"options":   options,
		"sessionId": sessionID,
	})
}

// FinishWebAuthnLogin completes the passkey authentication
func (h *Handlers) FinishWebAuthnLogin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

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

	sessionData, err := h.db.GetWebAuthnSession(ctx, req.SessionID)
	if err != nil {
		http.Error(w, "Invalid or expired session", http.StatusBadRequest)
		return
	}

	var session webauthn.SessionData
	if err := json.Unmarshal(sessionData, &session); err != nil {
		http.Error(w, "Invalid session data", http.StatusInternalServerError)
		return
	}

	user, err := h.db.GetWebAuthnUser(ctx)
	if err != nil {
		http.Error(w, "Failed to get user", http.StatusInternalServerError)
		return
	}

	credentialResponse, err := protocol.ParseCredentialRequestResponseBody(
		bytes.NewReader(req.Credential),
	)
	if err != nil {
		logging.Warn("Failed to parse credential: %v", err)
		http.Error(w, "Invalid credential", http.StatusBadRequest)
		return
	}

	credential, err := webAuthnInstance.ValidateLogin(user, session, credentialResponse)
	if err != nil {
		logging.Warn("WebAuthn login failed: %v", err)
		http.Error(w, "Authentication failed", http.StatusUnauthorized)
		return
	}

	// Update sign count
	if err := h.db.UpdateCredentialSignCount(ctx, credential.ID, credential.Authenticator.SignCount); err != nil {
		logging.Error("Failed to update credential sign count: %v", err)
	}

	// Create session
	authSession, err := h.db.CreateSession(ctx, user.GetUser().ID)
	if err != nil {
		logging.Error("Failed to create session: %v", err)
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    authSession.Token,
		Path:     "/",
		Expires:  authSession.ExpiresAt,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})

	logging.Info("User authenticated via passkey")

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success:   true,
		ExpiresIn: int(database.GetSessionDuration().Seconds()),
	})
}

// ListPasskeys returns all registered passkeys
func (h *Handlers) ListPasskeys(w http.ResponseWriter, r *http.Request) {
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

	user, err := h.db.GetWebAuthnUser(ctx)
	if err != nil {
		http.Error(w, "Failed to get user", http.StatusInternalServerError)
		return
	}

	credentials, err := h.db.ListWebAuthnCredentials(ctx, user.GetUser().ID)
	if err != nil {
		http.Error(w, "Failed to list passkeys", http.StatusInternalServerError)
		return
	}

	type PasskeyInfo struct {
		ID         int64  `json:"id"`
		Name       string `json:"name"`
		CreatedAt  string `json:"createdAt"`
		LastUsedAt string `json:"lastUsedAt"`
		SignCount  uint32 `json:"signCount"`
	}

	passkeys := make([]PasskeyInfo, 0, len(credentials))
	for _, c := range credentials {
		passkeys = append(passkeys, PasskeyInfo{
			ID:         c.ID,
			Name:       c.Name,
			CreatedAt:  c.CreatedAt.Format(time.RFC3339),
			LastUsedAt: c.LastUsedAt.Format(time.RFC3339),
			SignCount:  c.SignCount,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"passkeys": passkeys,
	})
}

// DeletePasskey removes a registered passkey
func (h *Handlers) DeletePasskey(w http.ResponseWriter, r *http.Request) {
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

	user, err := h.db.GetWebAuthnUser(ctx)
	if err != nil {
		http.Error(w, "Failed to get user", http.StatusInternalServerError)
		return
	}

	if err := h.db.DeleteWebAuthnCredential(ctx, user.GetUser().ID, req.ID); err != nil {
		http.Error(w, "Failed to delete passkey", http.StatusInternalServerError)
		return
	}

	logging.Info("Deleted passkey ID %d", req.ID)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"success": true,
	})
}

// generateWebAuthnSessionID creates a random session ID
func generateWebAuthnSessionID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		logging.Error("Failed to generate random session ID: %v", err)
		// Fallback: return empty string and let caller handle
		return ""
	}
	return base64.URLEncoding.EncodeToString(b)
}
