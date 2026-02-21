package filesystem

import (
	"bytes"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestDefaultRetryConfig(t *testing.T) {
	config := DefaultRetryConfig()

	if config.MaxRetries != 3 {
		t.Errorf("MaxRetries = %d, want 3", config.MaxRetries)
	}
	if config.InitialBackoff != 50*time.Millisecond {
		t.Errorf("InitialBackoff = %v, want 50ms", config.InitialBackoff)
	}
	if config.MaxBackoff != 500*time.Millisecond {
		t.Errorf("MaxBackoff = %v, want 500ms", config.MaxBackoff)
	}
	if config.VolumeResolver != nil {
		t.Error("VolumeResolver should be nil by default")
	}
}

func TestIsNFSStaleError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "nil error",
			err:  nil,
			want: false,
		},
		{
			name: "ESTALE error",
			err:  syscall.ESTALE,
			want: true,
		},
		{
			name: "ENOENT error",
			err:  syscall.ENOENT,
			want: false,
		},
		{
			name: "generic error",
			err:  os.ErrNotExist,
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isNFSStaleError(tt.err)
			if got != tt.want {
				t.Errorf("isNFSStaleError() = %v, want %v", got, tt.want)
			}
		})
	}
}

// =============================================================================
// VolumeResolver Tests
// =============================================================================

func TestNewVolumeResolver(t *testing.T) {
	vr := NewVolumeResolver(map[string]string{
		"media":    "/media",
		"cache":    "/cache",
		"database": "/database",
	})

	if vr == nil {
		t.Fatal("NewVolumeResolver returned nil")
	}
	if len(vr.mounts) != 3 {
		t.Errorf("Expected 3 mounts, got %d", len(vr.mounts))
	}
}

func TestNewVolumeResolver_Empty(t *testing.T) {
	vr := NewVolumeResolver(map[string]string{})

	if vr == nil {
		t.Fatal("NewVolumeResolver returned nil for empty map")
	}
	if len(vr.mounts) != 0 {
		t.Errorf("Expected 0 mounts, got %d", len(vr.mounts))
	}
}

func TestVolumeResolver_Resolve(t *testing.T) {
	vr := NewVolumeResolver(map[string]string{
		"media":    "/media",
		"cache":    "/cache",
		"database": "/database",
	})

	tests := []struct {
		name string
		path string
		want string
	}{
		{
			name: "media root",
			path: "/media",
			want: "media",
		},
		{
			name: "media subdirectory",
			path: "/media/photos/vacation",
			want: "media",
		},
		{
			name: "media file",
			path: "/media/photos/image.jpg",
			want: "media",
		},
		{
			name: "cache root",
			path: "/cache",
			want: "cache",
		},
		{
			name: "cache thumbnails",
			path: "/cache/thumbnails/abc123.jpg",
			want: "cache",
		},
		{
			name: "cache transcoded",
			path: "/cache/transcoded/video.mp4",
			want: "cache",
		},
		{
			name: "database root",
			path: "/database",
			want: "database",
		},
		{
			name: "database file",
			path: "/database/media.db",
			want: "database",
		},
		{
			name: "database WAL",
			path: "/database/media.db-wal",
			want: "database",
		},
		{
			name: "unknown path",
			path: "/etc/hosts",
			want: "unknown",
		},
		{
			name: "root path",
			path: "/",
			want: "unknown",
		},
		{
			name: "tmp path",
			path: "/tmp/something",
			want: "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := vr.Resolve(tt.path)
			if got != tt.want {
				t.Errorf("Resolve(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func TestVolumeResolver_Resolve_LongestPrefixWins(t *testing.T) {
	// /cache/thumbnails is more specific than /cache
	vr := NewVolumeResolver(map[string]string{
		"cache":      "/cache",
		"thumbnails": "/cache/thumbnails",
	})

	tests := []struct {
		name string
		path string
		want string
	}{
		{
			name: "cache root matches cache",
			path: "/cache/transcoded/video.mp4",
			want: "cache",
		},
		{
			name: "thumbnails subdir matches thumbnails",
			path: "/cache/thumbnails/abc.jpg",
			want: "thumbnails",
		},
		{
			name: "thumbnails root matches thumbnails",
			path: "/cache/thumbnails",
			want: "thumbnails",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := vr.Resolve(tt.path)
			if got != tt.want {
				t.Errorf("Resolve(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func TestVolumeResolver_Resolve_NilResolver(t *testing.T) {
	var vr *VolumeResolver
	got := vr.Resolve("/media/test.jpg")
	if got != "unknown" {
		t.Errorf("nil resolver Resolve() = %q, want %q", got, "unknown")
	}
}

func TestVolumeResolver_Resolve_WithTmpAndRoot(t *testing.T) {
	// Test with all five potential mounts
	vr := NewVolumeResolver(map[string]string{
		"media":    "/media",
		"cache":    "/cache",
		"database": "/database",
		"root":     "/",
		"tmp":      "/tmp",
	})

	tests := []struct {
		name string
		path string
		want string
	}{
		{
			name: "media file",
			path: "/media/photo.jpg",
			want: "media",
		},
		{
			name: "tmp file",
			path: "/tmp/upload-123",
			want: "tmp",
		},
		{
			name: "etc falls to root",
			path: "/etc/hosts",
			want: "root",
		},
		{
			name: "usr falls to root",
			path: "/usr/local/bin/ffmpeg",
			want: "root",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := vr.Resolve(tt.path)
			if got != tt.want {
				t.Errorf("Resolve(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func TestSetDefaultVolumeResolver(t *testing.T) {
	// Save and restore the original default
	original := defaultResolver
	defer func() { defaultResolver = original }()

	vr := NewVolumeResolver(map[string]string{
		"media": "/media",
	})

	SetDefaultVolumeResolver(vr)

	if defaultResolver != vr {
		t.Error("SetDefaultVolumeResolver did not set the package-level resolver")
	}
}

func TestRetryConfig_ResolveVolume_UsesConfigResolver(t *testing.T) {
	// Save and restore the original default
	original := defaultResolver
	defer func() { defaultResolver = original }()

	// Set a default that maps /media → "default-media"
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"default-media": "/media",
	}))

	// Config-level resolver maps /media → "override-media"
	configResolver := NewVolumeResolver(map[string]string{
		"override-media": "/media",
	})

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
		VolumeResolver: configResolver,
	}

	got := config.resolveVolume("/media/test.jpg")
	if got != "override-media" {
		t.Errorf("resolveVolume() = %q, want %q (should use config resolver)", got, "override-media")
	}
}

func TestRetryConfig_ResolveVolume_FallsBackToDefault(t *testing.T) {
	// Save and restore the original default
	original := defaultResolver
	defer func() { defaultResolver = original }()

	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"media": "/media",
	}))

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
		// VolumeResolver is nil — should fall back to default
	}

	got := config.resolveVolume("/media/test.jpg")
	if got != "media" {
		t.Errorf("resolveVolume() = %q, want %q (should use default resolver)", got, "media")
	}
}

// =============================================================================
// StatWithRetry / OpenWithRetry Tests (updated for volume labels)
// =============================================================================

func TestStatWithRetry_Success(t *testing.T) {
	// Set up volume resolver for test paths
	original := defaultResolver
	defer func() { defaultResolver = original }()

	tmpDir := t.TempDir()
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"test": tmpDir,
	}))

	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	start := time.Now()
	info, err := StatWithRetry(testFile, config)
	elapsed := time.Since(start)

	if err != nil {
		t.Errorf("StatWithRetry() error = %v, want nil", err)
	}
	if info == nil {
		t.Error("StatWithRetry() returned nil FileInfo")
	}
	if info != nil && info.Size() != 4 {
		t.Errorf("FileInfo.Size() = %d, want 4", info.Size())
	}

	if elapsed > 50*time.Millisecond {
		t.Errorf("StatWithRetry took %v, expected < 50ms for success on first attempt", elapsed)
	}
}

func TestStatWithRetry_NotExist(t *testing.T) {
	original := defaultResolver
	defer func() { defaultResolver = original }()

	tmpDir := t.TempDir()
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"test": tmpDir,
	}))

	nonExistent := filepath.Join(tmpDir, "nonexistent.txt")

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	start := time.Now()
	info, err := StatWithRetry(nonExistent, config)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("StatWithRetry() error = nil, want error")
	}
	if info != nil {
		t.Error("StatWithRetry() returned non-nil FileInfo for non-existent file")
	}
	if !os.IsNotExist(err) {
		t.Errorf("StatWithRetry() error = %v, want os.IsNotExist", err)
	}

	if elapsed > 50*time.Millisecond {
		t.Errorf("StatWithRetry took %v, should not retry non-NFS errors", elapsed)
	}
}

func TestOpenWithRetry_Success(t *testing.T) {
	original := defaultResolver
	defer func() { defaultResolver = original }()

	tmpDir := t.TempDir()
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"test": tmpDir,
	}))

	testFile := filepath.Join(tmpDir, "test.txt")
	content := []byte("test content")
	if err := os.WriteFile(testFile, content, 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	start := time.Now()
	file, err := OpenWithRetry(testFile, config)
	elapsed := time.Since(start)

	if err != nil {
		t.Errorf("OpenWithRetry() error = %v, want nil", err)
	}
	if file == nil {
		t.Fatal("OpenWithRetry() returned nil file")
	}
	defer file.Close()

	buf := make([]byte, len(content))
	n, err := file.Read(buf)
	if err != nil {
		t.Errorf("file.Read() error = %v", err)
	}
	if n != len(content) {
		t.Errorf("file.Read() read %d bytes, want %d", n, len(content))
	}
	if !bytes.Equal(buf, content) {
		t.Errorf("file.Read() content = %q, want %q", string(buf), string(content))
	}

	if elapsed > 50*time.Millisecond {
		t.Errorf("OpenWithRetry took %v, expected < 50ms for success on first attempt", elapsed)
	}
}

func TestOpenWithRetry_NotExist(t *testing.T) {
	original := defaultResolver
	defer func() { defaultResolver = original }()

	tmpDir := t.TempDir()
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"test": tmpDir,
	}))

	nonExistent := filepath.Join(tmpDir, "nonexistent.txt")

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	start := time.Now()
	file, err := OpenWithRetry(nonExistent, config)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("OpenWithRetry() error = nil, want error")
	}
	if file != nil {
		file.Close()
		t.Error("OpenWithRetry() returned non-nil file for non-existent file")
	}
	if !os.IsNotExist(err) {
		t.Errorf("OpenWithRetry() error = %v, want os.IsNotExist", err)
	}

	if elapsed > 50*time.Millisecond {
		t.Errorf("OpenWithRetry took %v, should not retry non-NFS errors", elapsed)
	}
}

func TestRetryConfig_ExponentialBackoff(t *testing.T) {
	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	if config.InitialBackoff >= config.MaxBackoff {
		t.Error("InitialBackoff should be less than MaxBackoff")
	}

	tmpDir := t.TempDir()
	nonExistent := filepath.Join(tmpDir, "nonexistent.txt")

	start := time.Now()
	_, err := StatWithRetry(nonExistent, config)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("Expected error for non-existent file")
	}

	if elapsed > 50*time.Millisecond {
		t.Errorf("StatWithRetry took %v, should fail fast for non-ESTALE errors", elapsed)
	}
}

// =============================================================================
// Benchmarks
// =============================================================================

func BenchmarkVolumeResolver_Resolve(b *testing.B) {
	vr := NewVolumeResolver(map[string]string{
		"media":    "/media",
		"cache":    "/cache",
		"database": "/database",
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		vr.Resolve("/media/photos/vacation/img_001.jpg")
	}
}

func BenchmarkVolumeResolver_Resolve_Unknown(b *testing.B) {
	vr := NewVolumeResolver(map[string]string{
		"media":    "/media",
		"cache":    "/cache",
		"database": "/database",
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		vr.Resolve("/etc/hosts")
	}
}

func BenchmarkVolumeResolver_Resolve_DeepPath(b *testing.B) {
	vr := NewVolumeResolver(map[string]string{
		"media":    "/media",
		"cache":    "/cache",
		"database": "/database",
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		vr.Resolve("/media/a/b/c/d/e/f/g/h/i/j/photo.jpg")
	}
}

func BenchmarkStatWithRetry_Success(b *testing.B) {
	original := defaultResolver
	defer func() { defaultResolver = original }()

	tmpDir := b.TempDir()
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"test": tmpDir,
	}))

	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
		b.Fatalf("Failed to create test file: %v", err)
	}

	config := DefaultRetryConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := StatWithRetry(testFile, config)
		if err != nil {
			b.Fatalf("StatWithRetry error: %v", err)
		}
	}
}

func BenchmarkStatWithRetry_NotExist(b *testing.B) {
	original := defaultResolver
	defer func() { defaultResolver = original }()

	tmpDir := b.TempDir()
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"test": tmpDir,
	}))

	nonExistent := filepath.Join(tmpDir, "nonexistent.txt")
	config := DefaultRetryConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = StatWithRetry(nonExistent, config)
	}
}

func BenchmarkOpenWithRetry_Success(b *testing.B) {
	original := defaultResolver
	defer func() { defaultResolver = original }()

	tmpDir := b.TempDir()
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"test": tmpDir,
	}))

	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test content"), 0o644); err != nil {
		b.Fatalf("Failed to create test file: %v", err)
	}

	config := DefaultRetryConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		file, err := OpenWithRetry(testFile, config)
		if err != nil {
			b.Fatalf("OpenWithRetry error: %v", err)
		}
		file.Close()
	}
}

func BenchmarkNativeOsStat(b *testing.B) {
	tmpDir := b.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
		b.Fatalf("Failed to create test file: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := os.Stat(testFile)
		if err != nil {
			b.Fatalf("os.Stat error: %v", err)
		}
	}
}

func BenchmarkNativeOsOpen(b *testing.B) {
	tmpDir := b.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	if err := os.WriteFile(testFile, []byte("test content"), 0o644); err != nil {
		b.Fatalf("Failed to create test file: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		file, err := os.Open(testFile)
		if err != nil {
			b.Fatalf("os.Open error: %v", err)
		}
		file.Close()
	}
}
