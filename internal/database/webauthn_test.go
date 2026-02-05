package database

import (
	"bytes"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

// TestWebAuthnUserInterface tests WebAuthnUser interface implementation.
func TestWebAuthnUserInterface(t *testing.T) {
	t.Parallel()

	user := &User{
		ID:        42,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	credentials := []webauthn.Credential{
		{
			ID:              []byte("cred1"),
			PublicKey:       []byte("pubkey1"),
			AttestationType: "none",
		},
		{
			ID:              []byte("cred2"),
			PublicKey:       []byte("pubkey2"),
			AttestationType: "packed",
		},
	}

	webauthnUser := &WebAuthnUser{
		user:        user,
		credentials: credentials,
	}

	// Test WebAuthnID
	id := webauthnUser.WebAuthnID()
	expectedID := []byte("42")
	if !bytes.Equal(id, expectedID) {
		t.Errorf("WebAuthnID() = %s, want %s", id, expectedID)
	}

	// Test WebAuthnName
	name := webauthnUser.WebAuthnName()
	if name != webAuthnUsername {
		t.Errorf("WebAuthnName() = %s, want 'user'", name)
	}

	// Test WebAuthnDisplayName
	displayName := webauthnUser.WebAuthnDisplayName()
	if displayName != webAuthnDisplayName {
		t.Errorf("WebAuthnDisplayName() = %s, want 'Media Viewer User'", displayName)
	}

	// Test WebAuthnCredentials
	creds := webauthnUser.WebAuthnCredentials()
	if len(creds) != 2 {
		t.Errorf("WebAuthnCredentials() returned %d credentials, want 2", len(creds))
	}
	if string(creds[0].ID) != "cred1" {
		t.Errorf("First credential ID = %s, want 'cred1'", creds[0].ID)
	}
	if string(creds[1].ID) != "cred2" {
		t.Errorf("Second credential ID = %s, want 'cred2'", creds[1].ID)
	}

	// Test WebAuthnIcon (deprecated but required)
	icon := webauthnUser.WebAuthnIcon()
	if icon != "" {
		t.Errorf("WebAuthnIcon() = %s, want empty string", icon)
	}

	// Test GetUser
	retrievedUser := webauthnUser.GetUser()
	if retrievedUser.ID != user.ID {
		t.Errorf("GetUser().ID = %d, want %d", retrievedUser.ID, user.ID)
	}
}

// TestWebAuthnUserWithoutCredentials tests WebAuthnUser with no credentials.
func TestWebAuthnUserWithoutCredentials(t *testing.T) {
	t.Parallel()

	user := &User{
		ID:        1,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	webauthnUser := &WebAuthnUser{
		user:        user,
		credentials: []webauthn.Credential{},
	}

	// Should return empty slice, not nil
	creds := webauthnUser.WebAuthnCredentials()
	if creds == nil {
		t.Error("WebAuthnCredentials() should return empty slice, not nil")
	}
	if len(creds) != 0 {
		t.Errorf("WebAuthnCredentials() should return empty slice, got %d credentials", len(creds))
	}
}

// TestWebAuthnUserIDFormat tests that user IDs are formatted correctly.
func TestWebAuthnUserIDFormat(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		userID   int64
		expected string
	}{
		{
			name:     "single digit",
			userID:   1,
			expected: "1",
		},
		{
			name:     "double digit",
			userID:   42,
			expected: "42",
		},
		{
			name:     "large number",
			userID:   999999,
			expected: "999999",
		},
		{
			name:     "zero",
			userID:   0,
			expected: "0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			user := &User{ID: tt.userID}
			webauthnUser := &WebAuthnUser{user: user}

			id := webauthnUser.WebAuthnID()
			if string(id) != tt.expected {
				t.Errorf("WebAuthnID() = %s, want %s", id, tt.expected)
			}
		})
	}
}

// TestWebAuthnUserNilUser tests behavior with nil user (defensive programming).
func TestWebAuthnUserNilUser(t *testing.T) {
	t.Parallel()

	webauthnUser := &WebAuthnUser{
		user:        nil,
		credentials: []webauthn.Credential{},
	}

	// GetUser should return nil gracefully
	user := webauthnUser.GetUser()
	if user != nil {
		t.Error("GetUser() should return nil when user is nil")
	}

	// Note: WebAuthnID, WebAuthnName, etc. will panic if user is nil,
	// which is expected behavior - they shouldn't be called with nil user
}

// TestWebAuthnUserConstantValues tests that constant values are as expected.
func TestWebAuthnUserConstantValues(t *testing.T) {
	t.Parallel()

	user := &User{ID: 1}
	webauthnUser := &WebAuthnUser{user: user}

	// These should always return the same values
	if webauthnUser.WebAuthnName() != webAuthnUsername {
		t.Error("WebAuthnName should always return 'user'")
	}

	if webauthnUser.WebAuthnDisplayName() != webAuthnDisplayName {
		t.Error("WebAuthnDisplayName should always return 'Media Viewer User'")
	}

	if webauthnUser.WebAuthnIcon() != "" {
		t.Error("WebAuthnIcon should always return empty string")
	}
}

// TestWebAuthnCredentialStruct tests the WebAuthnCredential struct.
func TestWebAuthnCredentialStruct(t *testing.T) {
	t.Parallel()

	now := time.Now()
	aaguid := []byte{0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}
	cred := WebAuthnCredential{
		ID:              1,
		UserID:          42,
		CredentialID:    []byte("credential-123"),
		PublicKey:       []byte("public-key-data"),
		Name:            "My Passkey",
		AttestationType: "packed",
		AAGUID:          aaguid,
		SignCount:       5,
		CreatedAt:       now,
		LastUsedAt:      now,
	}

	if cred.ID != 1 {
		t.Errorf("ID = %d, want 1", cred.ID)
	}

	if cred.UserID != 42 {
		t.Errorf("UserID = %d, want 42", cred.UserID)
	}

	if string(cred.CredentialID) != "credential-123" {
		t.Errorf("CredentialID = %s, want 'credential-123'", cred.CredentialID)
	}

	if string(cred.PublicKey) != "public-key-data" {
		t.Errorf("PublicKey = %s, want 'public-key-data'", cred.PublicKey)
	}

	if cred.Name != "My Passkey" {
		t.Errorf("Name = %s, want 'My Passkey'", cred.Name)
	}

	if cred.AttestationType != "packed" {
		t.Errorf("AttestationType = %s, want 'packed'", cred.AttestationType)
	}

	if len(cred.AAGUID) != 16 {
		t.Errorf("AAGUID length = %d, want 16", len(cred.AAGUID))
	}

	if cred.SignCount != 5 {
		t.Errorf("SignCount = %d, want 5", cred.SignCount)
	}

	if !cred.CreatedAt.Equal(now) {
		t.Errorf("CreatedAt = %v, want %v", cred.CreatedAt, now)
	}

	if !cred.LastUsedAt.Equal(now) {
		t.Errorf("LastUsedAt = %v, want %v", cred.LastUsedAt, now)
	}
}

// TestWebAuthnCredentialDifferentAttestationTypes tests various attestation types.
func TestWebAuthnCredentialDifferentAttestationTypes(t *testing.T) {
	t.Parallel()

	attestationTypes := []string{
		"none",
		"packed",
		"fido-u2f",
		"tpm",
		"android-key",
		"android-safetynet",
		"apple",
	}

	for _, attestationType := range attestationTypes {
		t.Run(attestationType, func(t *testing.T) {
			t.Parallel()

			cred := WebAuthnCredential{
				ID:              1,
				Name:            "Test",
				AttestationType: attestationType,
			}

			if cred.ID != 1 {
				t.Errorf("ID = %d, want 1", cred.ID)
			}
			if cred.Name != "Test" {
				t.Errorf("Name = %q, want %q", cred.Name, "Test")
			}
			if cred.AttestationType != attestationType {
				t.Errorf("AttestationType = %s, want %s", cred.AttestationType, attestationType)
			}
		})
	}
}
