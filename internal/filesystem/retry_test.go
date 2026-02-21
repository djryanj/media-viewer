package filesystem

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"
)

// =============================================================================
// Mock Observer for verifying metrics calls
// =============================================================================

type observerCall struct {
	method string
	args   []interface{}
}

type mockObserver struct {
	mu    sync.Mutex
	calls []observerCall
}

func newMockObserver() *mockObserver {
	return &mockObserver{}
}

func (m *mockObserver) record(method string, args ...interface{}) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, observerCall{method: method, args: args})
}

func (m *mockObserver) getCalls() []observerCall {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]observerCall, len(m.calls))
	copy(out, m.calls)
	return out
}

func (m *mockObserver) countMethod(method string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, c := range m.calls {
		if c.method == method {
			count++
		}
	}
	return count
}

func (m *mockObserver) ObserveOperation(volume, operation string, durationSeconds float64, err error) {
	m.record("ObserveOperation", volume, operation, durationSeconds, err)
}

func (m *mockObserver) ObserveRetryAttempt(retryOp, volume string) {
	m.record("ObserveRetryAttempt", retryOp, volume)
}

func (m *mockObserver) ObserveRetrySuccess(retryOp, volume string) {
	m.record("ObserveRetrySuccess", retryOp, volume)
}

func (m *mockObserver) ObserveRetryFailure(retryOp, volume string) {
	m.record("ObserveRetryFailure", retryOp, volume)
}

func (m *mockObserver) ObserveRetryDuration(retryOp, volume string, durationSeconds float64) {
	m.record("ObserveRetryDuration", retryOp, volume, durationSeconds)
}

func (m *mockObserver) ObserveStaleError(retryOp, volume string) {
	m.record("ObserveStaleError", retryOp, volume)
}

// =============================================================================
// Test helpers to save/restore package-level state
// =============================================================================

// withResolver sets the default volume resolver for the duration of a test and
// restores the original on cleanup.
func withResolver(t *testing.T, vr *VolumeResolver) {
	t.Helper()
	original := defaultResolver
	SetDefaultVolumeResolver(vr)
	t.Cleanup(func() { defaultResolver = original })
}

// withObserver sets the package-level observer for the duration of a test and
// restores the original on cleanup.
func withObserver(t *testing.T, o Observer) {
	t.Helper()
	original := defaultObserver
	SetObserver(o)
	t.Cleanup(func() { defaultObserver = original })
}

// =============================================================================
// Existing Tests (unchanged, but using helpers where appropriate)
// =============================================================================

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
		{
			name: "wrapped ESTALE error",
			err:  fmt.Errorf("operation failed: %w", syscall.ESTALE),
			want: true,
		},
		{
			name: "wrapped non-ESTALE error",
			err:  fmt.Errorf("operation failed: %w", syscall.EACCES),
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
		{"media root", "/media", "media"},
		{"media subdirectory", "/media/photos/vacation", "media"},
		{"media file", "/media/photos/image.jpg", "media"},
		{"cache root", "/cache", "cache"},
		{"cache thumbnails", "/cache/thumbnails/abc123.jpg", "cache"},
		{"cache transcoded", "/cache/transcoded/video.mp4", "cache"},
		{"database root", "/database", "database"},
		{"database file", "/database/media.db", "database"},
		{"database WAL", "/database/media.db-wal", "database"},
		{"unknown path", "/etc/hosts", "unknown"},
		{"root path", "/", "unknown"},
		{"tmp path", "/tmp/something", "unknown"},
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
	vr := NewVolumeResolver(map[string]string{
		"cache":      "/cache",
		"thumbnails": "/cache/thumbnails",
	})

	tests := []struct {
		name string
		path string
		want string
	}{
		{"cache root matches cache", "/cache/transcoded/video.mp4", "cache"},
		{"thumbnails subdir matches thumbnails", "/cache/thumbnails/abc.jpg", "thumbnails"},
		{"thumbnails root matches thumbnails", "/cache/thumbnails", "thumbnails"},
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
		{"media file", "/media/photo.jpg", "media"},
		{"tmp file", "/tmp/upload-123", "tmp"},
		{"etc falls to root", "/etc/hosts", "root"},
		{"usr falls to root", "/usr/local/bin/ffmpeg", "root"},
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
	withResolver(t, NewVolumeResolver(map[string]string{
		"default-media": "/media",
	}))

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
	withResolver(t, NewVolumeResolver(map[string]string{
		"media": "/media",
	}))

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	got := config.resolveVolume("/media/test.jpg")
	if got != "media" {
		t.Errorf("resolveVolume() = %q, want %q (should use default resolver)", got, "media")
	}
}

// =============================================================================
// StatWithRetry Tests
// =============================================================================

func TestStatWithRetry_Success(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

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
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

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

// =============================================================================
// OpenWithRetry Tests
// =============================================================================

func TestOpenWithRetry_Success(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

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
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

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

// =============================================================================
// ReadDirWithRetry Tests
// =============================================================================

func TestReadDirWithRetry_Success(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

	// Create some files in the directory
	files := []string{"alpha.txt", "beta.txt", "gamma.txt"}
	for _, name := range files {
		if err := os.WriteFile(filepath.Join(tmpDir, name), []byte("data"), 0o644); err != nil {
			t.Fatalf("Failed to create file %s: %v", name, err)
		}
	}

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	entries, err := ReadDirWithRetry(tmpDir, config)
	if err != nil {
		t.Fatalf("ReadDirWithRetry() error = %v, want nil", err)
	}

	if len(entries) != len(files) {
		t.Errorf("ReadDirWithRetry() returned %d entries, want %d", len(entries), len(files))
	}

	// Verify entries are present (os.ReadDir returns sorted)
	for i, name := range files {
		if entries[i].Name() != name {
			t.Errorf("entry[%d].Name() = %q, want %q", i, entries[i].Name(), name)
		}
		if entries[i].IsDir() {
			t.Errorf("entry[%d] should not be a directory", i)
		}
	}
}

func TestReadDirWithRetry_EmptyDir(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

	config := DefaultRetryConfig()

	entries, err := ReadDirWithRetry(tmpDir, config)
	if err != nil {
		t.Fatalf("ReadDirWithRetry() on empty dir error = %v, want nil", err)
	}

	if len(entries) != 0 {
		t.Errorf("ReadDirWithRetry() on empty dir returned %d entries, want 0", len(entries))
	}
}

func TestReadDirWithRetry_WithSubdirectories(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

	// Create files and subdirectories
	if err := os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("data"), 0o644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}
	if err := os.Mkdir(filepath.Join(tmpDir, "subdir"), 0o755); err != nil {
		t.Fatalf("Failed to create subdir: %v", err)
	}

	config := DefaultRetryConfig()

	entries, err := ReadDirWithRetry(tmpDir, config)
	if err != nil {
		t.Fatalf("ReadDirWithRetry() error = %v", err)
	}

	if len(entries) != 2 {
		t.Fatalf("ReadDirWithRetry() returned %d entries, want 2", len(entries))
	}

	// os.ReadDir returns sorted: "file.txt" before "subdir"
	foundFile := false
	foundDir := false
	for _, e := range entries {
		if e.Name() == "file.txt" && !e.IsDir() {
			foundFile = true
		}
		if e.Name() == "subdir" && e.IsDir() {
			foundDir = true
		}
	}

	if !foundFile {
		t.Error("ReadDirWithRetry() did not return file.txt")
	}
	if !foundDir {
		t.Error("ReadDirWithRetry() did not return subdir")
	}
}

func TestReadDirWithRetry_NotExist(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

	nonExistent := filepath.Join(tmpDir, "nonexistent")

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	start := time.Now()
	entries, err := ReadDirWithRetry(nonExistent, config)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("ReadDirWithRetry() error = nil, want error")
	}
	if entries != nil {
		t.Errorf("ReadDirWithRetry() returned non-nil entries for non-existent dir")
	}
	if !os.IsNotExist(err) {
		t.Errorf("ReadDirWithRetry() error = %v, want os.IsNotExist", err)
	}

	// Should not retry for non-ESTALE errors
	if elapsed > 50*time.Millisecond {
		t.Errorf("ReadDirWithRetry took %v, should not retry non-NFS errors", elapsed)
	}
}

// =============================================================================
// WriteFileWithRetry Tests
// =============================================================================

func TestWriteFileWithRetry_Success(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

	testFile := filepath.Join(tmpDir, "output.txt")
	content := []byte("hello world")

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	err := WriteFileWithRetry(testFile, content, 0o644, config)
	if err != nil {
		t.Fatalf("WriteFileWithRetry() error = %v, want nil", err)
	}

	// Verify the file was written correctly
	got, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("os.ReadFile() error = %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Errorf("file content = %q, want %q", string(got), string(content))
	}
}

func TestWriteFileWithRetry_Permissions(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

	testFile := filepath.Join(tmpDir, "perms.txt")
	content := []byte("permission test")

	config := DefaultRetryConfig()

	err := WriteFileWithRetry(testFile, content, 0o600, config)
	if err != nil {
		t.Fatalf("WriteFileWithRetry() error = %v", err)
	}

	info, err := os.Stat(testFile)
	if err != nil {
		t.Fatalf("os.Stat() error = %v", err)
	}

	// On Unix, check the permission bits (mask out type bits)
	perm := info.Mode().Perm()
	if perm != 0o600 {
		t.Errorf("file permissions = %o, want %o", perm, 0o600)
	}
}

func TestWriteFileWithRetry_OverwriteExisting(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

	testFile := filepath.Join(tmpDir, "overwrite.txt")
	config := DefaultRetryConfig()

	// Write initial content
	if err := WriteFileWithRetry(testFile, []byte("original"), 0o644, config); err != nil {
		t.Fatalf("First WriteFileWithRetry() error = %v", err)
	}

	// Overwrite with new content
	newContent := []byte("replaced")
	if err := WriteFileWithRetry(testFile, newContent, 0o644, config); err != nil {
		t.Fatalf("Second WriteFileWithRetry() error = %v", err)
	}

	got, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("os.ReadFile() error = %v", err)
	}
	if !bytes.Equal(got, newContent) {
		t.Errorf("file content = %q, want %q", string(got), string(newContent))
	}
}

func TestWriteFileWithRetry_InvalidPath(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

	// Path with nonexistent parent directory
	badPath := filepath.Join(tmpDir, "nonexistent", "subdir", "file.txt")

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	start := time.Now()
	err := WriteFileWithRetry(badPath, []byte("data"), 0o644, config)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("WriteFileWithRetry() error = nil, want error for invalid path")
	}

	// Should not retry for non-ESTALE errors
	if elapsed > 50*time.Millisecond {
		t.Errorf("WriteFileWithRetry took %v, should not retry non-NFS errors", elapsed)
	}
}

func TestWriteFileWithRetry_EmptyContent(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))

	testFile := filepath.Join(tmpDir, "empty.txt")
	config := DefaultRetryConfig()

	err := WriteFileWithRetry(testFile, []byte{}, 0o644, config)
	if err != nil {
		t.Fatalf("WriteFileWithRetry() with empty content error = %v", err)
	}

	info, err := os.Stat(testFile)
	if err != nil {
		t.Fatalf("os.Stat() error = %v", err)
	}
	if info.Size() != 0 {
		t.Errorf("file size = %d, want 0", info.Size())
	}
}

// =============================================================================
// Observer / SetObserver / observe() Tests
// =============================================================================

func TestSetObserver(t *testing.T) {
	original := defaultObserver
	defer func() { defaultObserver = original }()

	mock := newMockObserver()
	SetObserver(mock)

	if defaultObserver != mock {
		t.Error("SetObserver did not set the package-level observer")
	}
}

func TestSetObserverToNil(t *testing.T) {
	original := defaultObserver
	defer func() { defaultObserver = original }()

	mock := newMockObserver()
	SetObserver(mock)
	SetObserver(nil)

	if defaultObserver != nil {
		t.Error("SetObserver(nil) should set observer to nil")
	}
}

func TestObserveReturnsNilWhenNoObserverSet(t *testing.T) {
	original := defaultObserver
	defer func() { defaultObserver = original }()

	SetObserver(nil)

	o := observe()
	if o != nil {
		t.Error("observe() should return nil when no observer is set")
	}
}

func TestObserveReturnsObserverWhenSet(t *testing.T) {
	original := defaultObserver
	defer func() { defaultObserver = original }()

	mock := newMockObserver()
	SetObserver(mock)

	o := observe()
	if o == nil {
		t.Error("observe() should return non-nil when observer is set")
	}
	if o != mock {
		t.Error("observe() should return the set observer")
	}
}

// =============================================================================
// retryOperation Generic Engine Tests
// =============================================================================

func TestRetryOperation_SuccessOnFirstAttempt(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	mock := newMockObserver()
	withObserver(t, mock)

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	callCount := 0
	result, err := retryOperation[string]("test-op", "stat", filepath.Join(tmpDir, "file"), config, func() (string, error) {
		callCount++
		return "success", nil
	})

	if err != nil {
		t.Errorf("retryOperation() error = %v, want nil", err)
	}
	if result != "success" {
		t.Errorf("retryOperation() result = %q, want %q", result, "success")
	}
	if callCount != 1 {
		t.Errorf("operation called %d times, want 1", callCount)
	}

	// Should NOT have recorded retry attempts or success (first attempt)
	if cnt := mock.countMethod("ObserveRetryAttempt"); cnt != 0 {
		t.Errorf("ObserveRetryAttempt called %d times, want 0 (success on first attempt)", cnt)
	}
	if cnt := mock.countMethod("ObserveRetrySuccess"); cnt != 0 {
		t.Errorf("ObserveRetrySuccess called %d times, want 0 (success on first attempt)", cnt)
	}
	// Should have recorded operation and retry duration
	if cnt := mock.countMethod("ObserveOperation"); cnt != 1 {
		t.Errorf("ObserveOperation called %d times, want 1", cnt)
	}
	if cnt := mock.countMethod("ObserveRetryDuration"); cnt != 1 {
		t.Errorf("ObserveRetryDuration called %d times, want 1", cnt)
	}
}

func TestRetryOperation_NonRetryableError(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	mock := newMockObserver()
	withObserver(t, mock)

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	callCount := 0
	_, err := retryOperation[string]("test-op", "stat", filepath.Join(tmpDir, "file"), config, func() (string, error) {
		callCount++
		return "", os.ErrPermission
	})

	if err == nil {
		t.Error("retryOperation() error = nil, want error")
	}
	if callCount != 1 {
		t.Errorf("operation called %d times, want 1 (should not retry non-ESTALE errors)", callCount)
	}

	// Should NOT have recorded stale errors or retry attempts
	if cnt := mock.countMethod("ObserveStaleError"); cnt != 0 {
		t.Errorf("ObserveStaleError called %d times, want 0", cnt)
	}
	if cnt := mock.countMethod("ObserveRetryAttempt"); cnt != 0 {
		t.Errorf("ObserveRetryAttempt called %d times, want 0", cnt)
	}
}

func TestRetryOperation_ESTALEThenSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	mock := newMockObserver()
	withObserver(t, mock)

	config := RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 5 * time.Millisecond,
		MaxBackoff:     50 * time.Millisecond,
	}

	callCount := 0
	result, err := retryOperation[string]("test-op", "stat", filepath.Join(tmpDir, "file"), config, func() (string, error) {
		callCount++
		if callCount <= 2 {
			return "", syscall.ESTALE
		}
		return "recovered", nil
	})

	if err != nil {
		t.Errorf("retryOperation() error = %v, want nil", err)
	}
	if result != "recovered" {
		t.Errorf("retryOperation() result = %q, want %q", result, "recovered")
	}
	if callCount != 3 {
		t.Errorf("operation called %d times, want 3", callCount)
	}

	// Should have recorded 2 ESTALE errors
	if cnt := mock.countMethod("ObserveStaleError"); cnt != 2 {
		t.Errorf("ObserveStaleError called %d times, want 2", cnt)
	}
	// Should have recorded 2 retry attempts
	if cnt := mock.countMethod("ObserveRetryAttempt"); cnt != 2 {
		t.Errorf("ObserveRetryAttempt called %d times, want 2", cnt)
	}
	// Should have recorded 1 retry success
	if cnt := mock.countMethod("ObserveRetrySuccess"); cnt != 1 {
		t.Errorf("ObserveRetrySuccess called %d times, want 1", cnt)
	}
	// Should NOT have recorded failure
	if cnt := mock.countMethod("ObserveRetryFailure"); cnt != 0 {
		t.Errorf("ObserveRetryFailure called %d times, want 0", cnt)
	}
}

func TestRetryOperation_ESTALEExhaustsRetries(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	mock := newMockObserver()
	withObserver(t, mock)

	config := RetryConfig{
		MaxRetries:     2,
		InitialBackoff: 5 * time.Millisecond,
		MaxBackoff:     20 * time.Millisecond,
	}

	callCount := 0
	_, err := retryOperation[string]("test-op", "stat", filepath.Join(tmpDir, "file"), config, func() (string, error) {
		callCount++
		return "", syscall.ESTALE
	})

	if err == nil {
		t.Error("retryOperation() error = nil, want ESTALE error after exhausting retries")
	}
	if !isNFSStaleError(err) {
		t.Errorf("retryOperation() error = %v, want ESTALE", err)
	}
	// Initial attempt + MaxRetries retries = 3 total calls
	if callCount != 3 {
		t.Errorf("operation called %d times, want 3 (1 initial + 2 retries)", callCount)
	}

	// Should have recorded 3 ESTALE errors (one per call)
	if cnt := mock.countMethod("ObserveStaleError"); cnt != 3 {
		t.Errorf("ObserveStaleError called %d times, want 3", cnt)
	}
	// Should have recorded 2 retry attempts (not for the last attempt)
	if cnt := mock.countMethod("ObserveRetryAttempt"); cnt != 2 {
		t.Errorf("ObserveRetryAttempt called %d times, want 2", cnt)
	}
	// Should have recorded 1 retry failure
	if cnt := mock.countMethod("ObserveRetryFailure"); cnt != 1 {
		t.Errorf("ObserveRetryFailure called %d times, want 1", cnt)
	}
	// Should NOT have recorded success
	if cnt := mock.countMethod("ObserveRetrySuccess"); cnt != 0 {
		t.Errorf("ObserveRetrySuccess called %d times, want 0", cnt)
	}
}

func TestRetryOperation_BackoffCapsAtMaxBackoff(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	withObserver(t, newMockObserver())

	config := RetryConfig{
		MaxRetries:     5,
		InitialBackoff: 5 * time.Millisecond,
		MaxBackoff:     15 * time.Millisecond,
	}

	// With InitialBackoff=5ms and MaxBackoff=15ms:
	// Attempt 0: fail → sleep 5ms
	// Attempt 1: fail → sleep 10ms
	// Attempt 2: fail → sleep 15ms (capped)
	// Attempt 3: fail → sleep 15ms (capped)
	// Attempt 4: fail → sleep 15ms (capped)
	// Attempt 5: fail → exhausted
	// Total sleep ≈ 5+10+15+15+15 = 60ms

	start := time.Now()
	callCount := 0
	_, err := retryOperation[string]("test-op", "stat", filepath.Join(tmpDir, "file"), config, func() (string, error) {
		callCount++
		return "", syscall.ESTALE
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Error("expected error after exhausting retries")
	}
	if callCount != 6 {
		t.Errorf("operation called %d times, want 6", callCount)
	}

	// Total sleep should be approximately 60ms. Allow generous bounds for CI.
	// Minimum: the backoff sleeps must have occurred (at least 50ms)
	// Maximum: should be well under 200ms
	if elapsed < 40*time.Millisecond {
		t.Errorf("elapsed %v is too short, backoff sleeps should total ~60ms", elapsed)
	}
	if elapsed > 300*time.Millisecond {
		t.Errorf("elapsed %v is too long, MaxBackoff should cap the sleep", elapsed)
	}
}

func TestRetryOperation_ZeroRetries(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	withObserver(t, newMockObserver())

	config := RetryConfig{
		MaxRetries:     0,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}

	callCount := 0
	_, err := retryOperation[string]("test-op", "stat", filepath.Join(tmpDir, "file"), config, func() (string, error) {
		callCount++
		return "", syscall.ESTALE
	})

	if err == nil {
		t.Error("expected error with zero retries")
	}
	if callCount != 1 {
		t.Errorf("operation called %d times, want 1 (no retries)", callCount)
	}
}

func TestRetryOperation_NilObserverDoesNotPanic(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	withObserver(t, nil)

	config := RetryConfig{
		MaxRetries:     2,
		InitialBackoff: 5 * time.Millisecond,
		MaxBackoff:     20 * time.Millisecond,
	}

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("retryOperation panicked with nil observer: %v", r)
		}
	}()

	// Success path with nil observer
	result, err := retryOperation[string]("test-op", "stat", filepath.Join(tmpDir, "file"), config, func() (string, error) {
		return "ok", nil
	})
	if err != nil || result != "ok" {
		t.Errorf("unexpected result: %q, %v", result, err)
	}

	// ESTALE path with nil observer
	_, err = retryOperation[string]("test-op", "stat", filepath.Join(tmpDir, "file"), config, func() (string, error) {
		return "", syscall.ESTALE
	})
	if err == nil {
		t.Error("expected error")
	}

	// Non-retryable error path with nil observer
	_, err = retryOperation[string]("test-op", "stat", filepath.Join(tmpDir, "file"), config, func() (string, error) {
		return "", os.ErrPermission
	})
	if err == nil {
		t.Error("expected error")
	}
}

// =============================================================================
// recordMetrics Tests
// =============================================================================

func TestRecordMetrics_WithObserver(t *testing.T) {
	mock := newMockObserver()
	withObserver(t, mock)

	recordMetrics("media", "stat", "stat", 100*time.Millisecond, nil)

	if cnt := mock.countMethod("ObserveOperation"); cnt != 1 {
		t.Errorf("ObserveOperation called %d times, want 1", cnt)
	}
	if cnt := mock.countMethod("ObserveRetryDuration"); cnt != 1 {
		t.Errorf("ObserveRetryDuration called %d times, want 1", cnt)
	}
}

func TestRecordMetrics_WithError(t *testing.T) {
	mock := newMockObserver()
	withObserver(t, mock)

	testErr := fmt.Errorf("test error")
	recordMetrics("cache", "write", "write", 50*time.Millisecond, testErr)

	calls := mock.getCalls()
	if len(calls) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(calls))
	}

	// Verify the error was passed through to ObserveOperation
	opCall := calls[0]
	if opCall.method != "ObserveOperation" {
		t.Errorf("first call method = %q, want ObserveOperation", opCall.method)
	}
	// opCall.args[3] is stored as interface{}; assert it's an error before using errors.Is
	if errArg, ok := opCall.args[3].(error); !ok || !errors.Is(errArg, testErr) {
		t.Errorf("ObserveOperation error arg = %v, want %v", opCall.args[3], testErr)
	}
}

func TestRecordMetrics_NilObserver(t *testing.T) {
	withObserver(t, nil)

	// Should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("recordMetrics panicked with nil observer: %v", r)
		}
	}()

	recordMetrics("media", "stat", "stat", 100*time.Millisecond, nil)
	recordMetrics("cache", "write", "write", 50*time.Millisecond, fmt.Errorf("err"))
}

// =============================================================================
// Integration: Observer called from real WithRetry functions
// =============================================================================

func TestStatWithRetry_CallsObserver(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	mock := newMockObserver()
	withObserver(t, mock)

	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("data"), 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	config := DefaultRetryConfig()
	_, err := StatWithRetry(testFile, config)
	if err != nil {
		t.Fatalf("StatWithRetry() error = %v", err)
	}

	if cnt := mock.countMethod("ObserveOperation"); cnt != 1 {
		t.Errorf("ObserveOperation called %d times, want 1", cnt)
	}
	if cnt := mock.countMethod("ObserveRetryDuration"); cnt != 1 {
		t.Errorf("ObserveRetryDuration called %d times, want 1", cnt)
	}
}

func TestOpenWithRetry_CallsObserver(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	mock := newMockObserver()
	withObserver(t, mock)

	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("data"), 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	config := DefaultRetryConfig()
	file, err := OpenWithRetry(testFile, config)
	if err != nil {
		t.Fatalf("OpenWithRetry() error = %v", err)
	}
	file.Close()

	if cnt := mock.countMethod("ObserveOperation"); cnt != 1 {
		t.Errorf("ObserveOperation called %d times, want 1", cnt)
	}
}

func TestReadDirWithRetry_CallsObserver(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	mock := newMockObserver()
	withObserver(t, mock)

	config := DefaultRetryConfig()
	_, err := ReadDirWithRetry(tmpDir, config)
	if err != nil {
		t.Fatalf("ReadDirWithRetry() error = %v", err)
	}

	if cnt := mock.countMethod("ObserveOperation"); cnt != 1 {
		t.Errorf("ObserveOperation called %d times, want 1", cnt)
	}
}

func TestWriteFileWithRetry_CallsObserver(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	mock := newMockObserver()
	withObserver(t, mock)

	testFile := filepath.Join(tmpDir, "test.txt")
	config := DefaultRetryConfig()

	err := WriteFileWithRetry(testFile, []byte("data"), 0o644, config)
	if err != nil {
		t.Fatalf("WriteFileWithRetry() error = %v", err)
	}

	if cnt := mock.countMethod("ObserveOperation"); cnt != 1 {
		t.Errorf("ObserveOperation called %d times, want 1", cnt)
	}
}

func TestStatWithRetry_ErrorCallsObserverWithError(t *testing.T) {
	tmpDir := t.TempDir()
	withResolver(t, NewVolumeResolver(map[string]string{"test": tmpDir}))
	mock := newMockObserver()
	withObserver(t, mock)

	config := DefaultRetryConfig()
	_, err := StatWithRetry(filepath.Join(tmpDir, "nonexistent"), config)
	if err == nil {
		t.Fatal("expected error")
	}

	calls := mock.getCalls()
	// Should have ObserveOperation and ObserveRetryDuration
	foundOpWithErr := false
	for _, c := range calls {
		if c.method == "ObserveOperation" && c.args[3] != nil {
			foundOpWithErr = true
		}
	}
	if !foundOpWithErr {
		t.Error("ObserveOperation should have been called with a non-nil error")
	}
}

// =============================================================================
// Exponential Backoff Tests
// =============================================================================

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

func BenchmarkReadDirWithRetry_Success(b *testing.B) {
	original := defaultResolver
	defer func() { defaultResolver = original }()

	tmpDir := b.TempDir()
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"test": tmpDir,
	}))

	// Create a few files
	for i := 0; i < 10; i++ {
		if err := os.WriteFile(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i)), []byte("data"), 0o644); err != nil {
			b.Fatalf("Failed to create file: %v", err)
		}
	}

	config := DefaultRetryConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := ReadDirWithRetry(tmpDir, config)
		if err != nil {
			b.Fatalf("ReadDirWithRetry error: %v", err)
		}
	}
}

func BenchmarkWriteFileWithRetry_Success(b *testing.B) {
	original := defaultResolver
	defer func() { defaultResolver = original }()

	tmpDir := b.TempDir()
	SetDefaultVolumeResolver(NewVolumeResolver(map[string]string{
		"test": tmpDir,
	}))

	testFile := filepath.Join(tmpDir, "bench.txt")
	data := []byte("benchmark data content")
	config := DefaultRetryConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		err := WriteFileWithRetry(testFile, data, 0o644, config)
		if err != nil {
			b.Fatalf("WriteFileWithRetry error: %v", err)
		}
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
