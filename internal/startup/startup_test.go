package startup

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"media-viewer/internal/database"

	"github.com/gorilla/mux"
)

func TestGetBuildInfo(t *testing.T) {
	info := GetBuildInfo()

	// Check that all fields are populated
	if info.Version == "" {
		t.Error("Expected Version to be set")
	}
	if info.GoVersion == "" {
		t.Error("Expected GoVersion to be set")
	}
	if info.OS == "" {
		t.Error("Expected OS to be set")
	}
	if info.Arch == "" {
		t.Error("Expected Arch to be set")
	}

	// Verify that runtime values are correct
	if info.GoVersion != GoVersion {
		t.Errorf("Expected GoVersion=%s, got %s", GoVersion, info.GoVersion)
	}
}

func TestGetEnv(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		defaultValue string
		envValue     string
		want         string
		setEnv       bool
	}{
		{
			name:         "Returns default when env var not set",
			key:          "TEST_UNSET_VAR",
			defaultValue: "default",
			want:         "default",
			setEnv:       false,
		},
		{
			name:         "Returns env value when set",
			key:          "TEST_SET_VAR",
			defaultValue: "default",
			envValue:     "custom",
			want:         "custom",
			setEnv:       true,
		},
		{
			name:         "Returns empty string when env var is empty",
			key:          "TEST_EMPTY_VAR",
			defaultValue: "default",
			envValue:     "",
			want:         "",
			setEnv:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setEnv {
				t.Setenv(tt.key, tt.envValue)
			} else {
				// Ensure the variable is not set
				os.Unsetenv(tt.key)
				t.Cleanup(func() {
					os.Unsetenv(tt.key)
				})
			}

			got := getEnv(tt.key, tt.defaultValue)
			if got != tt.want {
				t.Errorf("getEnv(%q, %q) = %q, want %q", tt.key, tt.defaultValue, got, tt.want)
			}
		})
	}
}

func TestGetEnvBoolWithSet(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		defaultValue bool
		envValue     string
		setEnv       bool
		wantValue    bool
		wantSet      bool
	}{
		{
			name:         "unset uses default",
			key:          "TEST_BOOL_UNSET",
			defaultValue: false,
			wantValue:    false,
			wantSet:      false,
		},
		{
			name:         "true override",
			key:          "TEST_BOOL_TRUE",
			defaultValue: false,
			envValue:     "true",
			setEnv:       true,
			wantValue:    true,
			wantSet:      true,
		},
		{
			name:         "false override",
			key:          "TEST_BOOL_FALSE",
			defaultValue: true,
			envValue:     "false",
			setEnv:       true,
			wantValue:    false,
			wantSet:      true,
		},
		{
			name:         "empty value treated as unset",
			key:          "TEST_BOOL_EMPTY",
			defaultValue: true,
			envValue:     "",
			setEnv:       true,
			wantValue:    true,
			wantSet:      false,
		},
		{
			name:         "invalid value falls back",
			key:          "TEST_BOOL_INVALID",
			defaultValue: true,
			envValue:     "not-a-bool",
			setEnv:       true,
			wantValue:    true,
			wantSet:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setEnv {
				t.Setenv(tt.key, tt.envValue)
			} else {
				os.Unsetenv(tt.key)
				t.Cleanup(func() {
					os.Unsetenv(tt.key)
				})
			}

			gotValue, gotSet := getEnvBoolWithSet(tt.key, tt.defaultValue)
			if gotValue != tt.wantValue {
				t.Errorf("getEnvBoolWithSet(%q) value = %v, want %v", tt.key, gotValue, tt.wantValue)
			}
			if gotSet != tt.wantSet {
				t.Errorf("getEnvBoolWithSet(%q) set = %v, want %v", tt.key, gotSet, tt.wantSet)
			}
		})
	}
}

func TestResolveDBMmapDisabled(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		explicitValue bool
		explicitSet   bool
		storageUnsafe bool
		storageName   string
		wantDisabled  bool
		wantMessage   string
	}{
		{
			name:          "explicit true on safe storage",
			explicitValue: true,
			explicitSet:   true,
			storageUnsafe: false,
			wantDisabled:  true,
		},
		{
			name:          "unsafe storage auto disables mmap",
			explicitValue: false,
			explicitSet:   false,
			storageUnsafe: true,
			storageName:   "9P/WSL",
			wantDisabled:  true,
			wantMessage:   "automatically enabling DB_MMAP_DISABLED",
		},
		{
			name:          "explicit false wins on unsafe storage",
			explicitValue: false,
			explicitSet:   true,
			storageUnsafe: true,
			storageName:   "NFS",
			wantDisabled:  false,
			wantMessage:   "set explicitly",
		},
		{
			name:          "safe storage keeps default",
			explicitValue: false,
			explicitSet:   false,
			storageUnsafe: false,
			wantDisabled:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			gotDisabled, gotMessage := resolveDBMmapDisabled(
				tt.explicitValue,
				tt.explicitSet,
				tt.storageUnsafe,
				tt.storageName,
			)

			if gotDisabled != tt.wantDisabled {
				t.Errorf("resolveDBMmapDisabled() disabled = %v, want %v", gotDisabled, tt.wantDisabled)
			}
			if tt.wantMessage == "" {
				if gotMessage != "" {
					t.Errorf("resolveDBMmapDisabled() message = %q, want empty", gotMessage)
				}
				return
			}
			if !strings.Contains(gotMessage, tt.wantMessage) {
				t.Errorf("resolveDBMmapDisabled() message = %q, want substring %q", gotMessage, tt.wantMessage)
			}
		})
	}
}

func TestRouteInfo(t *testing.T) {
	route := RouteInfo{
		Method: "GET",
		Path:   "/api/test",
		Name:   "TestRoute",
	}

	if route.Method != "GET" {
		t.Errorf("Expected Method=GET, got %s", route.Method)
	}
	if route.Path != "/api/test" {
		t.Errorf("Expected Path=/api/test, got %s", route.Path)
	}
	if route.Name != "TestRoute" {
		t.Errorf("Expected Name=TestRoute, got %s", route.Name)
	}
}

// =============================================================================
// rawConfig
// =============================================================================

func TestRawConfigDefaults(t *testing.T) {
	// Unset all env vars to ensure defaults
	envVars := []string{
		"MEDIA_DIR", "CACHE_DIR", "DATABASE_DIR", "TRANSCODER_LOG_DIR",
		"GPU_ACCEL", "PORT", "METRICS_PORT", "INDEX_INTERVAL",
		"THUMBNAIL_INTERVAL", "POLL_INTERVAL", "SESSION_DURATION",
		"SESSION_CLEANUP_INTERVAL", "LOG_STATIC_FILES", "LOG_HEALTH_CHECKS",
		"METRICS_ENABLED", "DB_MMAP_DISABLED", "WEBAUTHN_RP_ID",
		"WEBAUTHN_RP_DISPLAY_NAME", "WEBAUTHN_RP_ORIGINS",
	}
	for _, key := range envVars {
		t.Setenv(key, "")
		os.Unsetenv(key)
	}

	rc := loadRawConfig()

	if rc.mediaDir != "/media" {
		t.Errorf("mediaDir = %q, want %q", rc.mediaDir, "/media")
	}
	if rc.cacheDir != "/cache" {
		t.Errorf("cacheDir = %q, want %q", rc.cacheDir, "/cache")
	}
	if rc.databaseDir != "/database" {
		t.Errorf("databaseDir = %q, want %q", rc.databaseDir, "/database")
	}
	if rc.transcoderLogDir != "" {
		t.Errorf("transcoderLogDir = %q, want empty", rc.transcoderLogDir)
	}
	if rc.gpuAccel != "auto" {
		t.Errorf("gpuAccel = %q, want %q", rc.gpuAccel, "auto")
	}
	if rc.port != "8080" {
		t.Errorf("port = %q, want %q", rc.port, "8080")
	}
	if rc.metricsPort != "9090" {
		t.Errorf("metricsPort = %q, want %q", rc.metricsPort, "9090")
	}
	if rc.indexInterval != "30m" {
		t.Errorf("indexInterval = %q, want %q", rc.indexInterval, "30m")
	}
	if rc.thumbnailInterval != "6h" {
		t.Errorf("thumbnailInterval = %q, want %q", rc.thumbnailInterval, "6h")
	}
	if rc.pollInterval != "30s" {
		t.Errorf("pollInterval = %q, want %q", rc.pollInterval, "30s")
	}
	if rc.sessionDuration != "5m" {
		t.Errorf("sessionDuration = %q, want %q", rc.sessionDuration, "5m")
	}
	if rc.sessionCleanup != "1m" {
		t.Errorf("sessionCleanup = %q, want %q", rc.sessionCleanup, "1m")
	}
	if rc.logStaticFiles {
		t.Error("logStaticFiles should default to false")
	}
	if !rc.logHealthChecks {
		t.Error("logHealthChecks should default to true")
	}
	if !rc.metricsEnabled {
		t.Error("metricsEnabled should default to true")
	}
	if rc.dbMmapDisabled {
		t.Error("dbMmapDisabled should default to false")
	}
	if rc.webAuthnRPID != "" {
		t.Errorf("webAuthnRPID = %q, want empty", rc.webAuthnRPID)
	}
	if rc.webAuthnRPDisplayName != "Media Viewer" {
		t.Errorf("webAuthnRPDisplayName = %q, want %q", rc.webAuthnRPDisplayName, "Media Viewer")
	}
	if rc.webAuthnRPOrigins != "" {
		t.Errorf("webAuthnRPOrigins = %q, want empty", rc.webAuthnRPOrigins)
	}
}

func TestRawConfigFromEnv(t *testing.T) {
	t.Setenv("MEDIA_DIR", "/custom/media")
	t.Setenv("CACHE_DIR", "/custom/cache")
	t.Setenv("DATABASE_DIR", "/custom/db")
	t.Setenv("TRANSCODER_LOG_DIR", "/var/log/transcoder")
	t.Setenv("GPU_ACCEL", "nvidia")
	t.Setenv("PORT", "9000")
	t.Setenv("METRICS_PORT", "9191")
	t.Setenv("INDEX_INTERVAL", "1h")
	t.Setenv("THUMBNAIL_INTERVAL", "12h")
	t.Setenv("POLL_INTERVAL", "1m")
	t.Setenv("SESSION_DURATION", "15m")
	t.Setenv("SESSION_CLEANUP_INTERVAL", "5m")
	t.Setenv("LOG_STATIC_FILES", "true")
	t.Setenv("LOG_HEALTH_CHECKS", "false")
	t.Setenv("METRICS_ENABLED", "false")
	t.Setenv("DB_MMAP_DISABLED", "true")
	t.Setenv("WEBAUTHN_RP_ID", "media.example.com")
	t.Setenv("WEBAUTHN_RP_DISPLAY_NAME", "My Media")
	t.Setenv("WEBAUTHN_RP_ORIGINS", "https://media.example.com,https://alt.example.com")

	rc := loadRawConfig()

	if rc.mediaDir != "/custom/media" {
		t.Errorf("mediaDir = %q, want %q", rc.mediaDir, "/custom/media")
	}
	if rc.cacheDir != "/custom/cache" {
		t.Errorf("cacheDir = %q, want %q", rc.cacheDir, "/custom/cache")
	}
	if rc.databaseDir != "/custom/db" {
		t.Errorf("databaseDir = %q, want %q", rc.databaseDir, "/custom/db")
	}
	if rc.transcoderLogDir != "/var/log/transcoder" {
		t.Errorf("transcoderLogDir = %q, want %q", rc.transcoderLogDir, "/var/log/transcoder")
	}
	if rc.gpuAccel != "nvidia" {
		t.Errorf("gpuAccel = %q, want %q", rc.gpuAccel, "nvidia")
	}
	if rc.port != "9000" {
		t.Errorf("port = %q, want %q", rc.port, "9000")
	}
	if rc.metricsPort != "9191" {
		t.Errorf("metricsPort = %q, want %q", rc.metricsPort, "9191")
	}
	if rc.indexInterval != "1h" {
		t.Errorf("indexInterval = %q, want %q", rc.indexInterval, "1h")
	}
	if rc.thumbnailInterval != "12h" {
		t.Errorf("thumbnailInterval = %q, want %q", rc.thumbnailInterval, "12h")
	}
	if rc.pollInterval != "1m" {
		t.Errorf("pollInterval = %q, want %q", rc.pollInterval, "1m")
	}
	if rc.sessionDuration != "15m" {
		t.Errorf("sessionDuration = %q, want %q", rc.sessionDuration, "15m")
	}
	if rc.sessionCleanup != "5m" {
		t.Errorf("sessionCleanup = %q, want %q", rc.sessionCleanup, "5m")
	}
	if !rc.logStaticFiles {
		t.Error("logStaticFiles should be true")
	}
	if rc.logHealthChecks {
		t.Error("logHealthChecks should be false")
	}
	if rc.metricsEnabled {
		t.Error("metricsEnabled should be false")
	}
	if !rc.dbMmapDisabled {
		t.Error("dbMmapDisabled should be true")
	}
	if rc.webAuthnRPID != "media.example.com" {
		t.Errorf("webAuthnRPID = %q, want %q", rc.webAuthnRPID, "media.example.com")
	}
	if rc.webAuthnRPDisplayName != "My Media" {
		t.Errorf("webAuthnRPDisplayName = %q, want %q", rc.webAuthnRPDisplayName, "My Media")
	}
	if rc.webAuthnRPOrigins != "https://media.example.com,https://alt.example.com" {
		t.Errorf("webAuthnRPOrigins = %q, want %q", rc.webAuthnRPOrigins, "https://media.example.com,https://alt.example.com")
	}
}

// =============================================================================
// parseDurationWithDefault
// =============================================================================

func TestParseDurationWithDefault(t *testing.T) {
	tests := []struct {
		name       string
		value      string
		defaultVal time.Duration
		want       time.Duration
	}{
		{
			name:       "valid duration — minutes",
			value:      "30m",
			defaultVal: 5 * time.Minute,
			want:       30 * time.Minute,
		},
		{
			name:       "valid duration — hours",
			value:      "6h",
			defaultVal: 1 * time.Hour,
			want:       6 * time.Hour,
		},
		{
			name:       "valid duration — seconds",
			value:      "45s",
			defaultVal: 30 * time.Second,
			want:       45 * time.Second,
		},
		{
			name:       "valid duration — complex",
			value:      "1h30m",
			defaultVal: 1 * time.Hour,
			want:       90 * time.Minute,
		},
		{
			name:       "invalid duration — returns default",
			value:      "not-a-duration",
			defaultVal: 5 * time.Minute,
			want:       5 * time.Minute,
		},
		{
			name:       "empty string — returns default",
			value:      "",
			defaultVal: 10 * time.Second,
			want:       10 * time.Second,
		},
		{
			name:       "number without unit — returns default",
			value:      "30",
			defaultVal: 30 * time.Minute,
			want:       30 * time.Minute,
		},
		{
			name:       "negative duration — valid in Go",
			value:      "-5m",
			defaultVal: 5 * time.Minute,
			want:       -5 * time.Minute,
		},
		{
			name:       "zero duration",
			value:      "0s",
			defaultVal: 5 * time.Minute,
			want:       0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseDurationWithDefault(tt.value, "TEST_FIELD", tt.defaultVal)
			if got != tt.want {
				t.Errorf("parseDurationWithDefault(%q) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}

// =============================================================================
// parseDurations
// =============================================================================

func TestParseDurations_ValidValues(t *testing.T) {
	rc := &rawConfig{
		indexInterval:     "1h",
		thumbnailInterval: "12h",
		pollInterval:      "1m",
		sessionDuration:   "15m",
		sessionCleanup:    "5m",
	}

	d := parseDurations(rc)

	if d.indexInterval != 1*time.Hour {
		t.Errorf("indexInterval = %v, want 1h", d.indexInterval)
	}
	if d.thumbnailInterval != 12*time.Hour {
		t.Errorf("thumbnailInterval = %v, want 12h", d.thumbnailInterval)
	}
	if d.pollInterval != 1*time.Minute {
		t.Errorf("pollInterval = %v, want 1m", d.pollInterval)
	}
	if d.sessionDuration != 15*time.Minute {
		t.Errorf("sessionDuration = %v, want 15m", d.sessionDuration)
	}
	if d.sessionCleanup != 5*time.Minute {
		t.Errorf("sessionCleanup = %v, want 5m", d.sessionCleanup)
	}
}

func TestParseDurations_InvalidValues(t *testing.T) {
	rc := &rawConfig{
		indexInterval:     "bad",
		thumbnailInterval: "nope",
		pollInterval:      "invalid",
		sessionDuration:   "wrong",
		sessionCleanup:    "broken",
	}

	d := parseDurations(rc)

	if d.indexInterval != 30*time.Minute {
		t.Errorf("indexInterval = %v, want default 30m", d.indexInterval)
	}
	if d.thumbnailInterval != 6*time.Hour {
		t.Errorf("thumbnailInterval = %v, want default 6h", d.thumbnailInterval)
	}
	if d.pollInterval != 30*time.Second {
		t.Errorf("pollInterval = %v, want default 30s", d.pollInterval)
	}
	if d.sessionDuration != 5*time.Minute {
		t.Errorf("sessionDuration = %v, want default 5m", d.sessionDuration)
	}
	if d.sessionCleanup != 1*time.Minute {
		t.Errorf("sessionCleanup = %v, want default 1m", d.sessionCleanup)
	}
}

func TestParseDurations_MixedValues(t *testing.T) {
	rc := &rawConfig{
		indexInterval:     "2h",
		thumbnailInterval: "invalid",
		pollInterval:      "10s",
		sessionDuration:   "",
		sessionCleanup:    "30s",
	}

	d := parseDurations(rc)

	if d.indexInterval != 2*time.Hour {
		t.Errorf("indexInterval = %v, want 2h", d.indexInterval)
	}
	if d.thumbnailInterval != 6*time.Hour {
		t.Errorf("thumbnailInterval = %v, want default 6h", d.thumbnailInterval)
	}
	if d.pollInterval != 10*time.Second {
		t.Errorf("pollInterval = %v, want 10s", d.pollInterval)
	}
	if d.sessionDuration != 5*time.Minute {
		t.Errorf("sessionDuration = %v, want default 5m", d.sessionDuration)
	}
	if d.sessionCleanup != 30*time.Second {
		t.Errorf("sessionCleanup = %v, want 30s", d.sessionCleanup)
	}
}

// =============================================================================
// parseWebAuthnConfig
// =============================================================================

func TestParseWebAuthnConfig(t *testing.T) {
	tests := []struct {
		name          string
		rpID          string
		originsStr    string
		wantEnabled   bool
		wantOrigins   []string
		wantOriginLen int
	}{
		{
			name:          "disabled — empty RP ID",
			rpID:          "",
			originsStr:    "",
			wantEnabled:   false,
			wantOriginLen: 0,
		},
		{
			name:          "enabled — RP ID with default origin",
			rpID:          "media.example.com",
			originsStr:    "",
			wantEnabled:   true,
			wantOrigins:   []string{"https://media.example.com"},
			wantOriginLen: 1,
		},
		{
			name:          "enabled — RP ID with single explicit origin",
			rpID:          "media.example.com",
			originsStr:    "https://media.example.com",
			wantEnabled:   true,
			wantOrigins:   []string{"https://media.example.com"},
			wantOriginLen: 1,
		},
		{
			name:          "enabled — RP ID with multiple origins",
			rpID:          "media.example.com",
			originsStr:    "https://media.example.com, https://alt.example.com",
			wantEnabled:   true,
			wantOrigins:   []string{"https://media.example.com", "https://alt.example.com"},
			wantOriginLen: 2,
		},
		{
			name:          "enabled — origins with extra whitespace",
			rpID:          "media.example.com",
			originsStr:    "  https://a.com  ,  https://b.com  ,  https://c.com  ",
			wantEnabled:   true,
			wantOrigins:   []string{"https://a.com", "https://b.com", "https://c.com"},
			wantOriginLen: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rc := &rawConfig{
				webAuthnRPID:      tt.rpID,
				webAuthnRPOrigins: tt.originsStr,
			}

			enabled, origins := parseWebAuthnConfig(rc)

			if enabled != tt.wantEnabled {
				t.Errorf("enabled = %v, want %v", enabled, tt.wantEnabled)
			}

			if len(origins) != tt.wantOriginLen {
				t.Errorf("len(origins) = %d, want %d", len(origins), tt.wantOriginLen)
			}

			for i, wantOrigin := range tt.wantOrigins {
				if i >= len(origins) {
					t.Errorf("missing origin at index %d: want %q", i, wantOrigin)
					continue
				}
				if origins[i] != wantOrigin {
					t.Errorf("origins[%d] = %q, want %q", i, origins[i], wantOrigin)
				}
			}
		})
	}
}

// =============================================================================
// resolveDirectories
// =============================================================================

func TestResolveDirectories_ValidPaths(t *testing.T) {
	tmpDir := t.TempDir()

	mediaDir := filepath.Join(tmpDir, "media")
	cacheDir := filepath.Join(tmpDir, "cache")
	databaseDir := filepath.Join(tmpDir, "database")

	// Create the media directory so ensureDirectory doesn't warn
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		t.Fatalf("Failed to create media dir: %v", err)
	}

	rc := &rawConfig{
		mediaDir:    mediaDir,
		cacheDir:    cacheDir,
		databaseDir: databaseDir,
	}

	resolvedMedia, resolvedCache, resolvedDB, err := resolveDirectories(rc)
	if err != nil {
		t.Fatalf("resolveDirectories failed: %v", err)
	}

	// Verify paths are absolute
	if !filepath.IsAbs(resolvedMedia) {
		t.Errorf("mediaDir should be absolute, got %q", resolvedMedia)
	}
	if !filepath.IsAbs(resolvedCache) {
		t.Errorf("cacheDir should be absolute, got %q", resolvedCache)
	}
	if !filepath.IsAbs(resolvedDB) {
		t.Errorf("databaseDir should be absolute, got %q", resolvedDB)
	}

	// Verify database directory was created
	if _, err := os.Stat(resolvedDB); os.IsNotExist(err) {
		t.Error("Database directory should have been created")
	}
}

func TestResolveDirectories_DatabaseDirNotWritable(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("skipping permission test when running as root")
	}

	tmpDir := t.TempDir()

	mediaDir := filepath.Join(tmpDir, "media")
	cacheDir := filepath.Join(tmpDir, "cache")
	databaseDir := filepath.Join(tmpDir, "database")

	// Create database dir as read-only
	if err := os.MkdirAll(databaseDir, 0o555); err != nil {
		t.Fatalf("Failed to create database dir: %v", err)
	}
	defer os.Chmod(databaseDir, 0o755) // restore for cleanup

	rc := &rawConfig{
		mediaDir:    mediaDir,
		cacheDir:    cacheDir,
		databaseDir: databaseDir,
	}

	_, _, _, err := resolveDirectories(rc)
	if err == nil {
		t.Error("Expected error for non-writable database directory")
	}
}

func TestResolveDirectories_RelativePaths(t *testing.T) {
	tmpDir := t.TempDir()

	// Create actual directories under tmpDir so they exist
	mediaDir := filepath.Join(tmpDir, "rel_media")
	cacheDir := filepath.Join(tmpDir, "rel_cache")
	databaseDir := filepath.Join(tmpDir, "rel_database")

	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		t.Fatalf("Failed to create media dir: %v", err)
	}

	rc := &rawConfig{
		mediaDir:    mediaDir,
		cacheDir:    cacheDir,
		databaseDir: databaseDir,
	}

	resolvedMedia, resolvedCache, resolvedDB, err := resolveDirectories(rc)
	if err != nil {
		t.Fatalf("resolveDirectories failed: %v", err)
	}

	// All should be resolved to absolute paths
	if !filepath.IsAbs(resolvedMedia) {
		t.Errorf("mediaDir should be absolute, got %q", resolvedMedia)
	}
	if !filepath.IsAbs(resolvedCache) {
		t.Errorf("cacheDir should be absolute, got %q", resolvedCache)
	}
	if !filepath.IsAbs(resolvedDB) {
		t.Errorf("databaseDir should be absolute, got %q", resolvedDB)
	}
}

// =============================================================================
// Logging functions — should not panic
// =============================================================================

func TestLogRawConfig_WithTranscoderLogDir(_ *testing.T) {
	rc := &rawConfig{
		mediaDir:              "/media",
		cacheDir:              "/cache",
		databaseDir:           "/database",
		transcoderLogDir:      "/var/log/transcoder",
		gpuAccel:              "auto",
		port:                  "8080",
		metricsPort:           "9090",
		indexInterval:         "30m",
		thumbnailInterval:     "6h",
		pollInterval:          "30s",
		sessionDuration:       "5m",
		sessionCleanup:        "1m",
		logStaticFiles:        false,
		logHealthChecks:       true,
		metricsEnabled:        true,
		dbMmapDisabled:        false,
		webAuthnRPID:          "",
		webAuthnRPDisplayName: "Media Viewer",
		webAuthnRPOrigins:     "",
	}

	// Should not panic
	logRawConfig(rc)
}

func TestLogRawConfig_WithoutTranscoderLogDir(_ *testing.T) {
	rc := &rawConfig{
		mediaDir:              "/media",
		cacheDir:              "/cache",
		databaseDir:           "/database",
		transcoderLogDir:      "",
		gpuAccel:              "auto",
		port:                  "8080",
		metricsPort:           "9090",
		indexInterval:         "30m",
		thumbnailInterval:     "6h",
		pollInterval:          "30s",
		sessionDuration:       "5m",
		sessionCleanup:        "1m",
		logStaticFiles:        true,
		logHealthChecks:       false,
		metricsEnabled:        false,
		dbMmapDisabled:        true,
		webAuthnRPID:          "media.example.com",
		webAuthnRPDisplayName: "My Media",
		webAuthnRPOrigins:     "https://media.example.com",
	}

	// Should not panic
	logRawConfig(rc)
}

func TestLogRawConfig_MmapDisabledMessage(_ *testing.T) {
	rc := &rawConfig{
		mediaDir:              "/media",
		cacheDir:              "/cache",
		databaseDir:           "/database",
		gpuAccel:              "auto",
		port:                  "8080",
		metricsPort:           "9090",
		indexInterval:         "30m",
		thumbnailInterval:     "6h",
		pollInterval:          "30s",
		sessionDuration:       "5m",
		sessionCleanup:        "1m",
		dbMmapDisabled:        true,
		webAuthnRPDisplayName: "Media Viewer",
	}

	// Should not panic — should log the SIGBUS protection message
	logRawConfig(rc)
}

func TestLogWorkerConfig_Override(_ *testing.T) {
	// Should not panic
	logWorkerConfig("INDEX_WORKERS", "6", "3 (default)")
}

func TestLogWorkerConfig_Default(_ *testing.T) {
	// Should not panic
	logWorkerConfig("INDEX_WORKERS", "", "3 (default for NFS safety)")
}

func TestLogWebAuthnConfig_Disabled(_ *testing.T) {
	rc := &rawConfig{
		webAuthnRPID: "",
	}

	// Should not panic
	logWebAuthnConfig(rc)
}

func TestLogWebAuthnConfig_EnabledDefaultOrigins(_ *testing.T) {
	rc := &rawConfig{
		webAuthnRPID:          "media.example.com",
		webAuthnRPDisplayName: "Media Viewer",
		webAuthnRPOrigins:     "",
	}

	// Should not panic
	logWebAuthnConfig(rc)
}

func TestLogWebAuthnConfig_EnabledExplicitOrigins(_ *testing.T) {
	rc := &rawConfig{
		webAuthnRPID:          "media.example.com",
		webAuthnRPDisplayName: "Media Viewer",
		webAuthnRPOrigins:     "https://media.example.com,https://alt.example.com",
	}

	// Should not panic
	logWebAuthnConfig(rc)
}

// =============================================================================
// Struct zero-value tests
// =============================================================================

func TestRawConfigZeroValue(t *testing.T) {
	rc := rawConfig{}

	if rc.mediaDir != "" {
		t.Error("Zero-value mediaDir should be empty")
	}
	if rc.dbMmapDisabled {
		t.Error("Zero-value dbMmapDisabled should be false")
	}
	if rc.logStaticFiles {
		t.Error("Zero-value logStaticFiles should be false")
	}
	if rc.logHealthChecks {
		t.Error("Zero-value logHealthChecks should be false")
	}
	if rc.metricsEnabled {
		t.Error("Zero-value metricsEnabled should be false")
	}
}

func TestParsedDurationsZeroValue(t *testing.T) {
	d := parsedDurations{}

	if d.indexInterval != 0 {
		t.Errorf("Zero-value indexInterval = %v, want 0", d.indexInterval)
	}
	if d.thumbnailInterval != 0 {
		t.Errorf("Zero-value thumbnailInterval = %v, want 0", d.thumbnailInterval)
	}
	if d.pollInterval != 0 {
		t.Errorf("Zero-value pollInterval = %v, want 0", d.pollInterval)
	}
	if d.sessionDuration != 0 {
		t.Errorf("Zero-value sessionDuration = %v, want 0", d.sessionDuration)
	}
	if d.sessionCleanup != 0 {
		t.Errorf("Zero-value sessionCleanup = %v, want 0", d.sessionCleanup)
	}
}

// =============================================================================
// resolveDirectories — error paths
// =============================================================================

// TestResolveDirectories_MediaDirIsFile covers the media-directory warning path
// (startup.go:277-279): mediaDir points to a file → ensureDirectory returns an
// error but resolveDirectories only logs a Warn and continues.
func TestResolveDirectories_MediaDirIsFile(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file where mediaDir would be — ensureDirectory returns "not a directory"
	mediaFile := filepath.Join(tmpDir, "media_file")
	if err := os.WriteFile(mediaFile, []byte("x"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}

	// databaseDir must be valid (writable dir) so the function succeeds overall.
	dbDir := filepath.Join(tmpDir, "database")
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		t.Fatalf("setup: %v", err)
	}

	rc := &rawConfig{
		mediaDir:    mediaFile, // file, not dir
		cacheDir:    tmpDir,
		databaseDir: dbDir,
	}

	// Should succeed — media dir failure is a warning, not an error.
	_, _, _, err := resolveDirectories(rc)
	if err != nil {
		t.Errorf("expected nil error when mediaDir is a file (warning only), got: %v", err)
	}
}

// TestResolveDirectories_DatabaseDirIsFile covers the database-directory error
// path (startup.go:282-284): databaseDir points to an existing file →
// ensureDirectory returns an error and resolveDirectories propagates it.
func TestResolveDirectories_DatabaseDirIsFile(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file where databaseDir would be.
	dbFile := filepath.Join(tmpDir, "db_file")
	if err := os.WriteFile(dbFile, []byte("x"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}

	rc := &rawConfig{
		mediaDir:    tmpDir,
		cacheDir:    tmpDir,
		databaseDir: dbFile, // file, not dir
	}

	_, _, _, err := resolveDirectories(rc)
	if err == nil {
		t.Error("expected error when databaseDir is a file")
	}
}

// =============================================================================
// ensureDirectory — error paths
// =============================================================================

// TestEnsureDirectoryPathIsFile covers the "path exists but is not a
// directory" branch (startup.go:701-703).
func TestEnsureDirectoryPathIsFile(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "not_a_dir")
	if err := os.WriteFile(filePath, []byte("x"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}

	err := ensureDirectory(filePath, "test")
	if err == nil {
		t.Fatal("expected error for path that is a file, got nil")
	}
}

// =============================================================================
// setupOptionalDir — failure paths
// =============================================================================

// TestSetupOptionalDirMkdirAllFails covers the MkdirAll failure branch
// (startup.go:362-365): the target path contains a file component so
// os.MkdirAll cannot create a directory there.
func TestSetupOptionalDirMkdirAllFails(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file that blocks the directory creation.
	blockFile := filepath.Join(tmpDir, "blockfile")
	if err := os.WriteFile(blockFile, []byte("x"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Passing a path whose parent component is a file causes MkdirAll to fail.
	target := filepath.Join(blockFile, "nested")
	result := setupOptionalDir(target, "test")
	if result {
		t.Error("expected setupOptionalDir to return false when MkdirAll fails")
	}
}

// TestSetupOptionalDirWriteTestFails covers the write-test failure branch
// (startup.go:367-372) when the directory exists but is not writable.
func TestSetupOptionalDirWriteTestFails(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("skipping write-permission test when running as root")
	}
	tmpDir := t.TempDir()
	target := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(target, 0o555); err != nil {
		t.Fatalf("setup: %v", err)
	}
	t.Cleanup(func() { os.Chmod(target, 0o755) }) //nolint:errcheck

	result := setupOptionalDir(target, "test")
	if result {
		t.Error("expected setupOptionalDir to return false for read-only directory")
	}
}

// =============================================================================
// Log init / lifecycle helpers — should not panic
// =============================================================================

func TestLogDatabaseInitNilInfo(_ *testing.T) {
	// Covers LogDatabaseInit with nil dbInfo (the nil guard).
	LogDatabaseInit(0, nil)
}

func TestLogDatabaseInitFullInfo(_ *testing.T) {
	// Covers LogDatabaseInit with a fully-populated Info including warning fields.
	LogDatabaseInit(42*time.Millisecond, &database.Info{
		Path:              "/data/media.db",
		PermissionWarning: "some permission warning",
		SQLiteVersion:     "3.40.0",
		MmapStatus:        "mmap enabled",
		MmapWarning:       "some mmap warning",
	})
}

func TestLogTranscoderInitDisabled(_ *testing.T) {
	LogTranscoderInit(false)
}

func TestLogTranscoderInitEnabled(_ *testing.T) {
	// FFmpeg may or may not be present; the function must not panic either way.
	LogTranscoderInit(true)
}

func TestLogThumbnailInitDisabled(_ *testing.T) {
	LogThumbnailInit(false)
}

func TestLogThumbnailInitEnabled(_ *testing.T) {
	LogThumbnailInit(true)
}

func TestLogAutoTaggerInitDisabled(_ *testing.T) {
	LogAutoTaggerInit(false, 24*time.Hour)
}

func TestLogAutoTaggerInitEnabled(_ *testing.T) {
	// Metadata tools may or may not be present; the function must not panic either way.
	LogAutoTaggerInit(true, 24*time.Hour)
}

func TestLogAutoTaggerStarted(_ *testing.T) {
	LogAutoTaggerStarted()
}

func TestLogIndexerInit(_ *testing.T) {
	LogIndexerInit(30*time.Minute, 30*time.Second)
}

func TestLogIndexerStarted(_ *testing.T) {
	LogIndexerStarted()
}

// =============================================================================
// GetRoutes / LogHTTPRoutes
// =============================================================================

func TestGetRoutesEmpty(t *testing.T) {
	router := mux.NewRouter()
	routes, err := GetRoutes(router)
	if err != nil {
		t.Fatalf("GetRoutes on empty router failed: %v", err)
	}
	if len(routes) != 0 {
		t.Errorf("expected 0 routes for empty router, got %d", len(routes))
	}
}

func TestGetRoutesWithRoutes(t *testing.T) {
	router := mux.NewRouter()
	router.HandleFunc("/api/v1/files", func(_ http.ResponseWriter, _ *http.Request) {}).Methods("GET").Name("list-files")
	router.HandleFunc("/api/v1/files/{id}", func(_ http.ResponseWriter, _ *http.Request) {}).Methods("GET", "DELETE")
	router.HandleFunc("/health", func(_ http.ResponseWriter, _ *http.Request) {})

	routes, err := GetRoutes(router)
	if err != nil {
		t.Fatalf("GetRoutes failed: %v", err)
	}
	if len(routes) == 0 {
		t.Error("expected routes to be returned")
	}
}

func TestLogHTTPRoutesNoDebug(_ *testing.T) {
	router := mux.NewRouter()
	router.HandleFunc("/api/v1/files", func(_ http.ResponseWriter, _ *http.Request) {}).Methods("GET")
	router.HandleFunc("/static/{path:.*}", func(_ http.ResponseWriter, _ *http.Request) {})
	LogHTTPRoutes(router, false, false)
}

func TestLogHTTPRoutesStaticAndHealth(_ *testing.T) {
	router := mux.NewRouter()
	router.HandleFunc("/api/v1/search", func(_ http.ResponseWriter, _ *http.Request) {}).Methods("GET")
	LogHTTPRoutes(router, true, true)
}

// =============================================================================
// LogServerStarted
// =============================================================================

func TestLogServerStartedMetricsEnabled(_ *testing.T) {
	LogServerStarted(ServerConfig{
		Port:            "8080",
		MetricsPort:     "9090",
		MetricsEnabled:  true,
		StartupDuration: 250 * time.Millisecond,
	})
}

func TestLogServerStartedMetricsDisabled(_ *testing.T) {
	LogServerStarted(ServerConfig{
		Port:           "8080",
		MetricsEnabled: false,
	})
}

// =============================================================================
// Shutdown log helpers
// =============================================================================

func TestLogShutdownFunctions(_ *testing.T) {
	LogShutdownInitiated("SIGTERM")
	LogShutdownStep("stopping indexer")
	LogShutdownStepComplete("stopped indexer")
	LogShutdownComplete()
}

// =============================================================================
// getRouteGroup
// =============================================================================

func TestGetRouteGroup(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"/api/v1/files", "api/v1"},
		{"/api/search", "api/search"},
		{"/health", "health"},
		{"/static/js/app.js", "static"},
		{"/", ""},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			got := getRouteGroup(tt.path)
			if got != tt.want {
				t.Errorf("getRouteGroup(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

// =============================================================================
// Benchmarks
// =============================================================================

func BenchmarkParseDurationWithDefault_Valid(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = parseDurationWithDefault("30m", "TEST", 5*time.Minute)
	}
}

func BenchmarkParseDurationWithDefault_Invalid(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = parseDurationWithDefault("not-valid", "TEST", 5*time.Minute)
	}
}

func BenchmarkParseDurations(b *testing.B) {
	rc := &rawConfig{
		indexInterval:     "30m",
		thumbnailInterval: "6h",
		pollInterval:      "30s",
		sessionDuration:   "5m",
		sessionCleanup:    "1m",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = parseDurations(rc)
	}
}

func BenchmarkParseWebAuthnConfig(b *testing.B) {
	rc := &rawConfig{
		webAuthnRPID:      "media.example.com",
		webAuthnRPOrigins: "https://media.example.com,https://alt.example.com",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = parseWebAuthnConfig(rc)
	}
}

func BenchmarkLoadRawConfig(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = loadRawConfig()
	}
}

// =============================================================================
// LoadConfig integration test
// =============================================================================

// TestLoadConfigBasic exercises LoadConfig() end-to-end with all required env vars.
func TestLoadConfigBasic(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	cacheDir := filepath.Join(tmpDir, "cache")
	dbDir := filepath.Join(tmpDir, "database")

	// Create the directories so resolveDirectories succeeds
	for _, dir := range []string{mediaDir, cacheDir, dbDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("failed to create dir %s: %v", dir, err)
		}
	}

	t.Setenv("MEDIA_DIR", mediaDir)
	t.Setenv("CACHE_DIR", cacheDir)
	t.Setenv("DATABASE_DIR", dbDir)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	if cfg.MediaDir != mediaDir {
		t.Errorf("want MediaDir %q, got %q", mediaDir, cfg.MediaDir)
	}
	if cfg.DatabaseDir != dbDir {
		t.Errorf("want DatabaseDir %q, got %q", dbDir, cfg.DatabaseDir)
	}
	if cfg.DatabasePath != filepath.Join(dbDir, "media.db") {
		t.Errorf("want DatabasePath %q, got %q", filepath.Join(dbDir, "media.db"), cfg.DatabasePath)
	}
	// Thumbnails and transcoding should be enabled (dirs were created and are writable)
	if !cfg.ThumbnailsEnabled {
		t.Error("expected ThumbnailsEnabled to be true")
	}
	if !cfg.TranscodingEnabled {
		t.Error("expected TranscodingEnabled to be true")
	}
}

// TestLoadConfigWithDisabledOptionalDirs tests LoadConfig when optional dirs are not writable.
// This covers the enabledString(false) branch.
func TestLoadConfigWithDisabledOptionalDirs(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("skipping: test requires non-root user for permission check")
	}

	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	dbDir := filepath.Join(tmpDir, "database")
	cacheDir := filepath.Join(tmpDir, "cache-readonly")

	os.MkdirAll(mediaDir, 0o755)
	os.MkdirAll(dbDir, 0o755)
	// Create cache dir as read-only so optional dirs (thumbnails, transcoding) can't be created
	if err := os.MkdirAll(cacheDir, 0o555); err != nil {
		t.Fatalf("failed to create read-only cache dir: %v", err)
	}
	defer os.Chmod(cacheDir, 0o755) //nolint:errcheck

	t.Setenv("MEDIA_DIR", mediaDir)
	t.Setenv("CACHE_DIR", cacheDir)
	t.Setenv("DATABASE_DIR", dbDir)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig should not fail even with disabled optional dirs, got: %v", err)
	}

	// With read-only cache dir, thumbnails and transcoding should be disabled
	if cfg.ThumbnailsEnabled {
		t.Error("expected ThumbnailsEnabled=false with read-only cache dir")
	}
	if cfg.TranscodingEnabled {
		t.Error("expected TranscodingEnabled=false with read-only cache dir")
	}
}
func TestLoadConfigDirectoryError(t *testing.T) {
	// Skip on privileged builds (e.g., running as root has full fs access)
	if os.Getuid() == 0 {
		t.Skip("skipping: test requires non-root user for permission check")
	}

	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	cacheDir := filepath.Join(tmpDir, "cache")
	dbDir := filepath.Join(tmpDir, "database")
	os.MkdirAll(mediaDir, 0o755)
	os.MkdirAll(cacheDir, 0o755)
	// Create database dir with no write permission
	if err := os.MkdirAll(dbDir, 0o400); err != nil {
		t.Fatalf("failed to create read-only dbDir: %v", err)
	}
	defer os.Chmod(dbDir, 0o755) //nolint:errcheck

	t.Setenv("MEDIA_DIR", mediaDir)
	t.Setenv("CACHE_DIR", cacheDir)
	t.Setenv("DATABASE_DIR", dbDir)

	_, err := LoadConfig()
	if err == nil {
		t.Error("expected LoadConfig to return error for read-only database dir")
	}
}
