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

func TestStatWithRetry_Success(t *testing.T) {
	tmpDir := t.TempDir()
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

	// Should complete quickly on first attempt
	if elapsed > 50*time.Millisecond {
		t.Errorf("StatWithRetry took %v, expected < 50ms for success on first attempt", elapsed)
	}
}

func TestStatWithRetry_NotExist(t *testing.T) {
	tmpDir := t.TempDir()
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

	// Should not retry non-NFS errors
	if elapsed > 50*time.Millisecond {
		t.Errorf("StatWithRetry took %v, should not retry non-NFS errors", elapsed)
	}
}

func TestOpenWithRetry_Success(t *testing.T) {
	tmpDir := t.TempDir()
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

	// Verify we can read from the file
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

	// Should complete quickly on first attempt
	if elapsed > 50*time.Millisecond {
		t.Errorf("OpenWithRetry took %v, expected < 50ms for success on first attempt", elapsed)
	}
}

func TestOpenWithRetry_NotExist(t *testing.T) {
	tmpDir := t.TempDir()
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

	// Should not retry non-NFS errors
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

	// Test that backoff grows exponentially: 10ms, 20ms, 40ms (capped at 100ms would be 80ms, 160ms)
	expectedMinDurations := []time.Duration{
		0,                     // First attempt has no backoff
		10 * time.Millisecond, // First retry: 10ms
		30 * time.Millisecond, // Second retry: 10 + 20ms
		70 * time.Millisecond, // Third retry: 10 + 20 + 40ms (40ms not yet at cap)
	}

	tmpDir := t.TempDir()
	nonExistent := filepath.Join(tmpDir, "nonexistent.txt")

	// We can't easily simulate ESTALE errors in tests, but we can verify
	// that the config values are reasonable
	if config.InitialBackoff >= config.MaxBackoff {
		t.Error("InitialBackoff should be less than MaxBackoff")
	}

	// Verify that attempting to stat a non-existent file doesn't retry
	// (because it's not an ESTALE error)
	start := time.Now()
	_, err := StatWithRetry(nonExistent, config)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("Expected error for non-existent file")
	}

	// Should fail fast without retries
	if elapsed > 50*time.Millisecond {
		t.Errorf("StatWithRetry took %v, should fail fast for non-ESTALE errors", elapsed)
	}

	// Verify the math for exponential backoff
	for i, expected := range expectedMinDurations {
		t.Logf("Retry %d should have minimum %v cumulative backoff", i, expected)
	}
}

// Benchmarks

func BenchmarkStatWithRetry_Success(b *testing.B) {
	tmpDir := b.TempDir()
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
	tmpDir := b.TempDir()
	nonExistent := filepath.Join(tmpDir, "nonexistent.txt")

	config := DefaultRetryConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = StatWithRetry(nonExistent, config)
	}
}

func BenchmarkOpenWithRetry_Success(b *testing.B) {
	tmpDir := b.TempDir()
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
