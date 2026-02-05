package database

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

func TestInitWebAuthnSchemaIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	// InitWebAuthnSchema should be called during NewDatabase
	// Verify tables exist by trying to use them
	ctx := context.Background()

	// Should not panic or error
	count := db.CountWebAuthnCredentials(ctx)
	if count != 0 {
		t.Errorf("Expected 0 credentials initially, got %d", count)
	}
}

func TestSaveWebAuthnCredentialIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create a test credential
	cred := &webauthn.Credential{
		ID:              []byte("test-credential-id"),
		PublicKey:       []byte("test-public-key"),
		AttestationType: "none",
		Transport:       []protocol.AuthenticatorTransport{protocol.USB},
		Flags: webauthn.CredentialFlags{
			UserPresent:    true,
			UserVerified:   true,
			BackupEligible: false,
			BackupState:    false,
		},
		Authenticator: webauthn.Authenticator{
			AAGUID:       []byte("test-aaguid"),
			SignCount:    0,
			CloneWarning: false,
			Attachment:   protocol.CrossPlatform,
		},
	}

	err := db.SaveWebAuthnCredential(ctx, 1, cred, "Test Key")
	if err != nil {
		t.Fatalf("SaveWebAuthnCredential failed: %v", err)
	}

	// Verify credential was saved
	count := db.CountWebAuthnCredentials(ctx)
	if count != 1 {
		t.Errorf("Expected 1 credential, got %d", count)
	}
}

func TestGetWebAuthnCredentialsIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Save a credential
	cred := &webauthn.Credential{
		ID:              []byte("test-id-123"),
		PublicKey:       []byte("test-public-key"),
		AttestationType: "packed",
		Authenticator: webauthn.Authenticator{
			AAGUID:    []byte("aaguid-data"),
			SignCount: 5,
		},
	}

	err := db.SaveWebAuthnCredential(ctx, 1, cred, "My Security Key")
	if err != nil {
		t.Fatalf("SaveWebAuthnCredential failed: %v", err)
	}

	// Retrieve credentials
	creds, err := db.GetWebAuthnCredentials(ctx, 1)
	if err != nil {
		t.Fatalf("GetWebAuthnCredentials failed: %v", err)
	}

	if len(creds) != 1 {
		t.Fatalf("Expected 1 credential, got %d", len(creds))
	}

	// Verify credential data
	retrieved := creds[0]
	if string(retrieved.ID) != "test-id-123" {
		t.Errorf("Expected ID 'test-id-123', got %s", string(retrieved.ID))
	}

	if retrieved.AttestationType != "packed" {
		t.Errorf("Expected attestation type 'packed', got %s", retrieved.AttestationType)
	}

	if retrieved.Authenticator.SignCount != 5 {
		t.Errorf("Expected SignCount=5, got %d", retrieved.Authenticator.SignCount)
	}
}

func TestGetWebAuthnUserIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create a user first (required for GetWebAuthnUser)
	err := db.CreateUser(ctx, "testpassword")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Get user before any credentials
	user, err := db.GetWebAuthnUser(ctx)
	if err != nil {
		t.Fatalf("GetWebAuthnUser failed: %v", err)
	}

	if user == nil {
		t.Fatal("Expected non-nil user")
	}

	if len(user.WebAuthnCredentials()) != 0 {
		t.Errorf("Expected 0 credentials, got %d", len(user.WebAuthnCredentials()))
	}

	// Add a credential
	cred := &webauthn.Credential{
		ID:        []byte("cred-id"),
		PublicKey: []byte("pub-key"),
		Authenticator: webauthn.Authenticator{
			AAGUID:    []byte("aaguid"),
			SignCount: 0,
		},
	}
	_ = db.SaveWebAuthnCredential(ctx, 1, cred, "Key 1")

	// Get user again
	user, err = db.GetWebAuthnUser(ctx)
	if err != nil {
		t.Fatalf("GetWebAuthnUser failed after adding credential: %v", err)
	}

	if len(user.WebAuthnCredentials()) != 1 {
		t.Errorf("Expected 1 credential, got %d", len(user.WebAuthnCredentials()))
	}
}

func TestDeleteWebAuthnCredentialIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Save two credentials
	cred1 := &webauthn.Credential{
		ID:        []byte("cred-1"),
		PublicKey: []byte("key-1"),
		Authenticator: webauthn.Authenticator{
			AAGUID:    []byte("aaguid-1"),
			SignCount: 0,
		},
	}
	cred2 := &webauthn.Credential{
		ID:        []byte("cred-2"),
		PublicKey: []byte("key-2"),
		Authenticator: webauthn.Authenticator{
			AAGUID:    []byte("aaguid-2"),
			SignCount: 0,
		},
	}

	_ = db.SaveWebAuthnCredential(ctx, 1, cred1, "Key 1")
	_ = db.SaveWebAuthnCredential(ctx, 1, cred2, "Key 2")

	// List credentials to get IDs
	credList, _ := db.ListWebAuthnCredentials(ctx, 1)
	if len(credList) != 2 {
		t.Fatalf("Expected 2 credentials before delete, got %d", len(credList))
	}

	// Delete first credential
	err := db.DeleteWebAuthnCredential(ctx, 1, credList[0].ID)
	if err != nil {
		t.Fatalf("DeleteWebAuthnCredential failed: %v", err)
	}

	// Verify only one remains
	credList, _ = db.ListWebAuthnCredentials(ctx, 1)
	if len(credList) != 1 {
		t.Errorf("Expected 1 credential after delete, got %d", len(credList))
	}

	// Delete non-existent credential (should error)
	err = db.DeleteWebAuthnCredential(ctx, 1, 99999)
	if err == nil {
		t.Error("Expected error when deleting non-existent credential")
	}
}

func TestListWebAuthnCredentialsIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Empty list initially
	list, err := db.ListWebAuthnCredentials(ctx, 1)
	if err != nil {
		t.Fatalf("ListWebAuthnCredentials failed: %v", err)
	}

	if len(list) != 0 {
		t.Errorf("Expected 0 credentials, got %d", len(list))
	}

	// Add credentials
	for i := 1; i <= 3; i++ {
		cred := &webauthn.Credential{
			ID:        []byte{byte(i)},
			PublicKey: []byte{byte(i * 10)},
			Authenticator: webauthn.Authenticator{
				AAGUID:    []byte{byte(i * 100)},
				SignCount: uint32(i),
			},
		}
		name := "Key " + string(rune('0'+i))
		_ = db.SaveWebAuthnCredential(ctx, 1, cred, name)
	}

	// List credentials
	list, err = db.ListWebAuthnCredentials(ctx, 1)
	if err != nil {
		t.Fatalf("ListWebAuthnCredentials failed: %v", err)
	}

	if len(list) != 3 {
		t.Errorf("Expected 3 credentials, got %d", len(list))
	}

	// Verify credential fields
	for _, c := range list {
		if c.ID == 0 {
			t.Error("Expected non-zero credential ID")
		}
		if c.UserID != 1 {
			t.Errorf("Expected UserID=1, got %d", c.UserID)
		}
		if c.Name == "" {
			t.Error("Expected non-empty name")
		}
	}
}

func TestSaveWebAuthnSessionIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Save session
	sessionID := "test-session-123"
	sessionData := []byte(`{"challenge":"test-challenge"}`)
	ttl := 5 * time.Minute

	err := db.SaveWebAuthnSession(ctx, sessionID, sessionData, ttl)
	if err != nil {
		t.Fatalf("SaveWebAuthnSession failed: %v", err)
	}

	// Retrieve session
	retrieved, err := db.GetWebAuthnSession(ctx, sessionID)
	if err != nil {
		t.Fatalf("GetWebAuthnSession failed: %v", err)
	}

	if !bytes.Equal(retrieved, sessionData) {
		t.Errorf("Expected session data %s, got %s", string(sessionData), string(retrieved))
	}
}

func TestGetWebAuthnSessionIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Get non-existent session
	_, err := db.GetWebAuthnSession(ctx, "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent session")
	}

	// Save and retrieve session
	sessionID := "valid-session"
	sessionData := []byte("test-data")
	_ = db.SaveWebAuthnSession(ctx, sessionID, sessionData, 10*time.Minute)

	retrieved, err := db.GetWebAuthnSession(ctx, sessionID)
	if err != nil {
		t.Fatalf("GetWebAuthnSession failed: %v", err)
	}

	if !bytes.Equal(retrieved, sessionData) {
		t.Errorf("Session data mismatch")
	}
}

func TestCleanExpiredWebAuthnSessionsIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Save sessions with different expiration times
	_ = db.SaveWebAuthnSession(ctx, "expired-1", []byte("data1"), -1*time.Hour)    // Already expired
	_ = db.SaveWebAuthnSession(ctx, "expired-2", []byte("data2"), -30*time.Minute) // Already expired
	_ = db.SaveWebAuthnSession(ctx, "valid", []byte("data3"), 1*time.Hour)         // Still valid

	// Clean expired sessions
	err := db.CleanExpiredWebAuthnSessions(ctx)
	if err != nil {
		t.Fatalf("CleanExpiredWebAuthnSessions failed: %v", err)
	}

	// Valid session should still exist
	_, err = db.GetWebAuthnSession(ctx, "valid")
	if err != nil {
		t.Error("Valid session should still exist")
	}

	// Expired sessions should be gone
	_, err = db.GetWebAuthnSession(ctx, "expired-1")
	if err == nil {
		t.Error("Expired session should be deleted")
	}
}

func TestHasWebAuthnCredentialsIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Initially should be false
	if db.HasWebAuthnCredentials(ctx) {
		t.Error("Expected HasWebAuthnCredentials=false initially")
	}

	// Add a credential
	cred := &webauthn.Credential{
		ID:        []byte("test-id"),
		PublicKey: []byte("test-key"),
		Authenticator: webauthn.Authenticator{
			AAGUID:    []byte("aaguid"),
			SignCount: 0,
		},
	}
	_ = db.SaveWebAuthnCredential(ctx, 1, cred, "Test")

	// Should be true now
	if !db.HasWebAuthnCredentials(ctx) {
		t.Error("Expected HasWebAuthnCredentials=true after adding credential")
	}
}

func TestCountWebAuthnCredentialsIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Initially 0
	count := db.CountWebAuthnCredentials(ctx)
	if count != 0 {
		t.Errorf("Expected 0 credentials, got %d", count)
	}

	// Add credentials
	for i := 1; i <= 5; i++ {
		cred := &webauthn.Credential{
			ID:        []byte{byte(i)},
			PublicKey: []byte{byte(i)},
			Authenticator: webauthn.Authenticator{
				AAGUID:    []byte{byte(i)},
				SignCount: 0,
			},
		}
		_ = db.SaveWebAuthnCredential(ctx, 1, cred, "Key")
	}

	// Should be 5
	count = db.CountWebAuthnCredentials(ctx)
	if count != 5 {
		t.Errorf("Expected 5 credentials, got %d", count)
	}
}

func TestWebAuthnMultipleCredentialsIntegration(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add multiple credentials with different properties
	creds := []struct {
		name        string
		attestation string
		signCount   uint32
	}{
		{"YubiKey", "packed", 10},
		{"TouchID", "none", 0},
		{"Windows Hello", "tpm", 5},
	}

	for i, c := range creds {
		cred := &webauthn.Credential{
			ID:              []byte{byte(i + 1)},
			PublicKey:       []byte{byte((i + 1) * 10)},
			AttestationType: c.attestation,
			Authenticator: webauthn.Authenticator{
				AAGUID:    []byte{byte((i + 1) * 100)},
				SignCount: c.signCount,
			},
		}
		err := db.SaveWebAuthnCredential(ctx, 1, cred, c.name)
		if err != nil {
			t.Fatalf("SaveWebAuthnCredential failed for %s: %v", c.name, err)
		}
	}

	// Verify all credentials
	list, _ := db.ListWebAuthnCredentials(ctx, 1)
	if len(list) != 3 {
		t.Fatalf("Expected 3 credentials, got %d", len(list))
	}

	// Verify names are preserved
	names := make(map[string]bool)
	for _, c := range list {
		names[c.Name] = true
	}

	for _, c := range creds {
		if !names[c.name] {
			t.Errorf("Expected to find credential with name %s", c.name)
		}
	}
}
