package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

// LoginRequest represents a login request with password only
type LoginRequest struct {
	Password string `json:"password"`
}

// SetupRequest represents an initial setup request to create the password
type SetupRequest struct {
	Password string `json:"password"`
}

// PasswordChangeRequest represents a request to change the password
type PasswordChangeRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// AuthResponse represents the response from authentication endpoints
type AuthResponse struct {
	Success   bool   `json:"success"`
	Message   string `json:"message,omitempty"`
	Username  string `json:"username,omitempty"`
	ExpiresIn int    `json:"expiresIn,omitempty"` // Seconds until session expires
}

const (
	// SessionCookieName is the name of the session cookie
	SessionCookieName = "media_viewer_session"
)

// CheckSetupRequired returns whether initial setup is needed
func (h *Handlers) CheckSetupRequired(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	needsSetup := !h.db.HasUsers(ctx)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]bool{
		"needsSetup": needsSetup,
	})
}

// Setup creates the initial password
func (h *Handlers) Setup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Only allow setup if no users exist
	if h.db.HasUsers(ctx) {
		http.Error(w, "Setup already completed", http.StatusForbidden)
		return
	}

	var req SetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate input
	if len(req.Password) < 6 {
		http.Error(w, "Password must be at least 6 characters", http.StatusBadRequest)
		return
	}

	if len(req.Password) > 72 {
		http.Error(w, "Password must not exceed 72 characters", http.StatusBadRequest)
		return
	}

	// Create user
	if err := h.db.CreateUser(ctx, req.Password); err != nil {
		logging.Error("Failed to create user: %v", err)
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	logging.Info("Initial password configured")

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success: true,
		Message: "Password configured successfully",
	})
}

// Login authenticates with password
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate password
	user, err := h.db.ValidatePassword(ctx, req.Password)
	if err != nil {
		logging.Warn("Failed login attempt")
		metrics.AuthAttemptsTotal.WithLabelValues("failure").Inc()
		http.Error(w, "Invalid password", http.StatusUnauthorized)
		return
	}

	metrics.AuthAttemptsTotal.WithLabelValues("success").Inc()

	// Create session
	session, err := h.db.CreateSession(ctx, user.ID)
	if err != nil {
		logging.Error("Failed to create session: %v", err)
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}

	// Set cookie with session duration
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    session.Token,
		Path:     "/",
		Expires:  session.ExpiresAt,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})

	logging.Info("User logged in, session expires in %v", database.GetSessionDuration())

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success:   true,
		Username:  "",
		ExpiresIn: int(database.GetSessionDuration().Seconds()),
	})
}

// Logout ends the current session
func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cookie, err := r.Cookie(SessionCookieName)
	if err == nil && cookie.Value != "" {
		// Best-effort session cleanup - don't fail logout if this errors
		if err := h.db.DeleteSession(ctx, cookie.Value); err != nil {
			logging.Error("failed to delete session during logout: %v", err)
		}
	}

	// Clear cookie
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success: true,
		Message: "Logged out successfully",
	})
}

// CheckAuth verifies the current session
func (h *Handlers) CheckAuth(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	_, err = h.db.ValidateSession(ctx, cookie.Value)
	if err != nil {
		// Clear invalid cookie
		http.SetCookie(w, &http.Cookie{
			Name:     SessionCookieName,
			Value:    "",
			Path:     "/",
			Expires:  time.Unix(0, 0),
			HttpOnly: true,
		})

		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success:   true,
		Username:  "",
		ExpiresIn: int(database.GetSessionDuration().Seconds()),
	})
}

// AuthMiddleware protects routes that require authentication
func (h *Handlers) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// Allow auth endpoints without authentication
		if strings.HasPrefix(r.URL.Path, "/api/auth/") ||
			r.URL.Path == "/login.html" ||
			r.URL.Path == "/css/login.css" ||
			r.URL.Path == "/js/login.js" ||
			r.URL.Path == "/js/webauthn.js" ||
			// Health check endpoints
			r.URL.Path == "/health" ||
			r.URL.Path == "/healthz" ||
			r.URL.Path == "/livez" ||
			r.URL.Path == "/readyz" ||
			// PWA endpoints
			r.URL.Path == "/manifest.json" ||
			r.URL.Path == "/sw.js" ||
			strings.HasPrefix(r.URL.Path, "/icons/") ||
			r.URL.Path == "/favicon.ico" {
			next.ServeHTTP(w, r)
			return
		}

		// Check for session cookie
		cookie, err := r.Cookie(SessionCookieName)
		if err != nil || cookie.Value == "" {
			// Redirect to login for HTML requests, return 401 for API
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
			} else {
				http.Redirect(w, r, "/login.html", http.StatusFound)
			}
			return
		}

		// Validate session
		_, err = h.db.ValidateSession(ctx, cookie.Value)
		if err != nil {
			// Clear invalid cookie
			http.SetCookie(w, &http.Cookie{
				Name:     SessionCookieName,
				Value:    "",
				Path:     "/",
				Expires:  time.Unix(0, 0),
				HttpOnly: true,
			})

			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
			} else {
				http.Redirect(w, r, "/login.html", http.StatusFound)
			}
			return
		}

		// Extend session (sliding expiration)
		if err := h.db.ExtendSession(ctx, cookie.Value); err != nil {
			logging.Debug("Failed to extend session: %v", err)
		} else {
			// Update cookie expiration
			http.SetCookie(w, &http.Cookie{
				Name:     SessionCookieName,
				Value:    cookie.Value,
				Path:     "/",
				Expires:  time.Now().Add(database.GetSessionDuration()),
				HttpOnly: true,
				SameSite: http.SameSiteStrictMode,
			})
		}

		next.ServeHTTP(w, r)
	})
}

// ChangePassword handles password change requests
func (h *Handlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req PasswordChangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate current password
	_, err := h.db.ValidatePassword(ctx, req.CurrentPassword)
	if err != nil {
		logging.Warn("Failed password change attempt - invalid current password")
		http.Error(w, "Current password is incorrect", http.StatusUnauthorized)
		return
	}

	// Validate new password
	if len(req.NewPassword) < 6 {
		http.Error(w, "New password must be at least 6 characters", http.StatusBadRequest)
		return
	}

	if len(req.NewPassword) > 72 {
		http.Error(w, "New password must not exceed 72 characters", http.StatusBadRequest)
		return
	}

	// Update password
	if err := h.db.UpdatePassword(ctx, req.NewPassword); err != nil {
		logging.Error("Failed to update password: %v", err)
		http.Error(w, "Failed to update password", http.StatusInternalServerError)
		return
	}

	logging.Info("Password changed successfully")

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, AuthResponse{
		Success: true,
		Message: "Password updated successfully",
	})
}

// Keepalive extends the current session without returning user data
func (h *Handlers) Keepalive(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "No session", http.StatusUnauthorized)
		return
	}

	// Validate the session first
	_, err = h.db.ValidateSession(ctx, cookie.Value)
	if err != nil {
		http.Error(w, "Invalid session", http.StatusUnauthorized)
		return
	}

	// Extend the session
	if err := h.db.ExtendSession(ctx, cookie.Value); err != nil {
		logging.Debug("Failed to extend session in keepalive: %v", err)
		http.Error(w, "Failed to extend session", http.StatusInternalServerError)
		return
	}

	// Update cookie expiration
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    cookie.Value,
		Path:     "/",
		Expires:  time.Now().Add(database.GetSessionDuration()),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"success":   true,
		"expiresIn": int(database.GetSessionDuration().Seconds()),
	})
}
