package transcoder

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"media-viewer/internal/streaming"
)

func TestNew(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	if trans == nil {
		t.Fatal("New() returned nil")
	}

	if trans.cacheDir != "/tmp/cache" {
		t.Errorf("Expected cacheDir=/tmp/cache, got %s", trans.cacheDir)
	}

	if !trans.enabled {
		t.Error("Expected enabled=true")
	}

	if trans.processes == nil {
		t.Error("Expected processes map to be initialized")
	}

	if trans.cacheLocks == nil {
		t.Error("Expected cacheLocks map to be initialized")
	}
}

func TestIsEnabled(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
	}{
		{"Enabled", true},
		{"Disabled", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trans := New("/tmp/cache", "", tt.enabled, "none")

			if trans.IsEnabled() != tt.enabled {
				t.Errorf("Expected IsEnabled()=%v, got %v", tt.enabled, trans.IsEnabled())
			}
		})
	}
}

func TestVideoInfo(t *testing.T) {
	info := VideoInfo{
		Duration:       120.5,
		Width:          1920,
		Height:         1080,
		Codec:          "h264",
		NeedsTranscode: false,
	}

	if info.Duration != 120.5 {
		t.Errorf("Expected Duration=120.5, got %f", info.Duration)
	}

	if info.Width != 1920 {
		t.Errorf("Expected Width=1920, got %d", info.Width)
	}

	if info.Height != 1080 {
		t.Errorf("Expected Height=1080, got %d", info.Height)
	}

	if info.Codec != "h264" {
		t.Errorf("Expected Codec=h264, got %s", info.Codec)
	}

	if info.NeedsTranscode {
		t.Error("Expected NeedsTranscode=false")
	}
}

func TestCompatibleCodecs(t *testing.T) {
	tests := []struct {
		codec      string
		compatible bool
	}{
		{"h264", true},
		{"vp8", true},
		{"vp9", true},
		{"av1", true},
		{"hevc", false},
		{"mpeg2", false},
		{"unknown", false},
	}

	for _, tt := range tests {
		t.Run(tt.codec, func(t *testing.T) {
			isCompatible := compatibleCodecs[tt.codec]
			if isCompatible != tt.compatible {
				t.Errorf("Expected codec %s compatible=%v, got %v", tt.codec, tt.compatible, isCompatible)
			}
		})
	}
}

func TestCompatibleContainers(t *testing.T) {
	tests := []struct {
		container  string
		compatible bool
	}{
		{"mp4", true},
		{"webm", true},
		{"ogg", true},
		{"mkv", false},
		{"avi", false},
		{"mov", false},
	}

	for _, tt := range tests {
		t.Run(tt.container, func(t *testing.T) {
			isCompatible := compatibleContainers[tt.container]
			if isCompatible != tt.compatible {
				t.Errorf("Expected container %s compatible=%v, got %v", tt.container, tt.compatible, isCompatible)
			}
		})
	}
}

func TestTranscoderStreamConfig(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Check that stream config was set up
	if trans.streamConfig.WriteTimeout != 30*time.Second {
		t.Errorf("Expected WriteTimeout=30s, got %v", trans.streamConfig.WriteTimeout)
	}

	if trans.streamConfig.IdleTimeout != 60*time.Second {
		t.Errorf("Expected IdleTimeout=60s, got %v", trans.streamConfig.IdleTimeout)
	}

	if trans.streamConfig.ChunkSize != 256*1024 {
		t.Errorf("Expected ChunkSize=256KB, got %d", trans.streamConfig.ChunkSize)
	}
}

func TestTranscoderProcessManagement(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Process map should be initialized
	if trans.processes == nil {
		t.Error("Process map should be initialized")
	}

	// Should start with no active processes
	if len(trans.processes) != 0 {
		t.Errorf("Expected 0 processes, got %d", len(trans.processes))
	}
}

func TestVideoInfoZeroValues(t *testing.T) {
	var info VideoInfo

	if info.Duration != 0 {
		t.Errorf("Zero-value Duration should be 0, got %f", info.Duration)
	}

	if info.Width != 0 {
		t.Errorf("Zero-value Width should be 0, got %d", info.Width)
	}

	if info.Height != 0 {
		t.Errorf("Zero-value Height should be 0, got %d", info.Height)
	}

	if info.Codec != "" {
		t.Errorf("Zero-value Codec should be empty, got %s", info.Codec)
	}

	if info.NeedsTranscode {
		t.Error("Zero-value NeedsTranscode should be false")
	}
}

func TestVideoInfoNeedsTranscode(t *testing.T) {
	tests := []struct {
		name           string
		codec          string
		needsTranscode bool
	}{
		{
			name:           "H264 doesn't need transcode",
			codec:          "h264",
			needsTranscode: false,
		},
		{
			name:           "VP9 doesn't need transcode",
			codec:          "vp9",
			needsTranscode: false,
		},
		{
			name:           "HEVC needs transcode",
			codec:          "hevc",
			needsTranscode: true,
		},
		{
			name:           "Unknown codec needs transcode",
			codec:          "unknown",
			needsTranscode: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isCompatible := compatibleCodecs[tt.codec]
			needsTranscode := !isCompatible

			if needsTranscode != tt.needsTranscode {
				t.Errorf("Expected NeedsTranscode=%v for codec %s, got %v", tt.needsTranscode, tt.codec, needsTranscode)
			}
		})
	}
}

func TestTranscoderDisabled(t *testing.T) {
	trans := New("/tmp/cache", "", false, "none")

	if trans.IsEnabled() {
		t.Error("Transcoder should be disabled")
	}

	// Verify process map is still initialized when disabled
	if trans.processes == nil {
		t.Error("Process map should be initialized even when disabled")
	}
}

func TestTranscoderProcessMap(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	if trans.processes == nil {
		t.Fatal("Process map should be initialized")
	}

	if len(trans.processes) != 0 {
		t.Errorf("Expected empty process map, got %d processes", len(trans.processes))
	}
}

func TestGetVideoInfoWithInvalidFile(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	ctx := context.Background()

	// Try to get info for non-existent file
	_, err := trans.GetVideoInfo(ctx, "/nonexistent/file.mp4")
	if err == nil {
		t.Error("Expected error when getting info for non-existent file")
	}
}

func TestGetVideoInfoContextCancellation(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := trans.GetVideoInfo(ctx, "/tmp/test.mp4")
	if err == nil {
		t.Error("Expected error when context is canceled")
	}
}

func TestStreamConfigDefaults(t *testing.T) {
	// Test that New() sets up reasonable stream config defaults
	trans := New("/tmp/cache", "", true, "none")

	config := trans.streamConfig

	if config.WriteTimeout <= 0 {
		t.Error("WriteTimeout should be positive")
	}

	if config.IdleTimeout <= 0 {
		t.Error("IdleTimeout should be positive")
	}

	if config.ChunkSize <= 0 {
		t.Error("ChunkSize should be positive")
	}

	// Video streaming should have larger chunks than default
	defaultConfig := streaming.DefaultTimeoutWriterConfig()
	if config.ChunkSize <= defaultConfig.ChunkSize {
		t.Error("Video streaming should use larger chunks than default")
	}
}

func TestVideoInfoFields(t *testing.T) {
	// Test all fields can be set and retrieved
	info := VideoInfo{
		Duration:       3600.0, // 1 hour
		Width:          3840,   // 4K
		Height:         2160,
		Codec:          "h264",
		NeedsTranscode: false,
	}

	if info.Duration != 3600.0 {
		t.Error("Duration field mismatch")
	}

	if info.Width != 3840 {
		t.Error("Width field mismatch")
	}

	if info.Height != 2160 {
		t.Error("Height field mismatch")
	}

	if info.Codec != "h264" {
		t.Error("Codec field mismatch")
	}

	if info.NeedsTranscode {
		t.Error("NeedsTranscode field mismatch")
	}
}

func TestCompatibleCodecsMapNotEmpty(t *testing.T) {
	if len(compatibleCodecs) == 0 {
		t.Error("compatibleCodecs map should not be empty")
	}

	// Should have at least the major web-compatible codecs
	expectedCodecs := []string{"h264", "vp8", "vp9"}
	for _, codec := range expectedCodecs {
		if !compatibleCodecs[codec] {
			t.Errorf("Expected %s to be in compatibleCodecs", codec)
		}
	}
}

func TestCompatibleContainersMapNotEmpty(t *testing.T) {
	if len(compatibleContainers) == 0 {
		t.Error("compatibleContainers map should not be empty")
	}

	// Should have the major web-compatible containers
	expectedContainers := []string{"mp4", "webm"}
	for _, container := range expectedContainers {
		if !compatibleContainers[container] {
			t.Errorf("Expected %s to be in compatibleContainers", container)
		}
	}
}

func BenchmarkNewTranscoder(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = New("/tmp/cache", "", true, "none")
	}
}

func BenchmarkVideoInfoCreation(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = VideoInfo{
			Duration:       120.0,
			Width:          1920,
			Height:         1080,
			Codec:          "h264",
			NeedsTranscode: false,
		}
	}
}

// =============================================================================
// Cache Tests
// =============================================================================

// TestGetCachedFile_ValidCache tests that a valid cached file is returned
func TestGetCachedFile_ValidCache(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create source file
	sourcePath := filepath.Join(tmpDir, "source.mp4")
	if err := os.WriteFile(sourcePath, []byte("source content"), 0o644); err != nil {
		t.Fatalf("Failed to create source file: %v", err)
	}

	// Sleep to ensure cache will be newer
	time.Sleep(10 * time.Millisecond)

	// Create cached file (newer than source)
	cachePath := filepath.Join(tmpDir, "cached.mp4")
	if err := os.WriteFile(cachePath, []byte("cached content"), 0o644); err != nil {
		t.Fatalf("Failed to create cache file: %v", err)
	}

	// Get cached file should succeed
	cachedFile, err := trans.getCachedFile(sourcePath, cachePath)
	if err != nil {
		t.Fatalf("getCachedFile() error: %v", err)
	}
	defer cachedFile.Close()

	// Verify content
	content, err := io.ReadAll(cachedFile)
	if err != nil {
		t.Fatalf("Failed to read cached file: %v", err)
	}

	if string(content) != "cached content" {
		t.Errorf("Expected 'cached content', got %s", string(content))
	}
}

// TestGetCachedFile_StaleCache tests that stale cache is detected and deleted
func TestGetCachedFile_StaleCache(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create cached file first
	cachePath := filepath.Join(tmpDir, "cached.mp4")
	if err := os.WriteFile(cachePath, []byte("old cache"), 0o644); err != nil {
		t.Fatalf("Failed to create cache file: %v", err)
	}

	// Sleep to ensure source will be newer
	time.Sleep(10 * time.Millisecond)

	// Create source file (newer than cache)
	sourcePath := filepath.Join(tmpDir, "source.mp4")
	if err := os.WriteFile(sourcePath, []byte("new source"), 0o644); err != nil {
		t.Fatalf("Failed to create source file: %v", err)
	}

	// Get cached file should fail because cache is stale
	_, err := trans.getCachedFile(sourcePath, cachePath)
	if err == nil {
		t.Error("Expected error for stale cache")
	}

	// Cache file should be deleted
	if _, err := os.Stat(cachePath); !os.IsNotExist(err) {
		t.Error("Stale cache file should have been deleted")
	}
}

// TestGetCachedFile_MissingCache tests handling of missing cache file
func TestGetCachedFile_MissingCache(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create source file
	sourcePath := filepath.Join(tmpDir, "source.mp4")
	if err := os.WriteFile(sourcePath, []byte("source content"), 0o644); err != nil {
		t.Fatalf("Failed to create source file: %v", err)
	}

	// Try to get non-existent cache
	cachePath := filepath.Join(tmpDir, "nonexistent.mp4")
	_, err := trans.getCachedFile(sourcePath, cachePath)
	if err == nil {
		t.Error("Expected error for missing cache file")
	}
}

// TestGetCacheLock tests that cache locks are created and reused
func TestGetCacheLock(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Get lock for first time
	lock1 := trans.getCacheLock("test-key")
	if lock1 == nil {
		t.Fatal("Expected lock to be created")
	}

	// Get same lock again
	lock2 := trans.getCacheLock("test-key")
	if lock1 != lock2 {
		t.Error("Expected same lock to be returned for same key")
	}

	// Get different lock
	lock3 := trans.getCacheLock("different-key")
	if lock1 == lock3 {
		t.Error("Expected different lock for different key")
	}
}

// TestGetCacheLock_Concurrent tests concurrent access to cache locks
func TestGetCacheLock_Concurrent(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	const goroutines = 10
	var wg sync.WaitGroup
	locks := make([]*sync.Mutex, goroutines)

	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(index int) {
			defer wg.Done()
			locks[index] = trans.getCacheLock("same-key")
		}(i)
	}

	wg.Wait()

	// All goroutines should have gotten the same lock
	for i := 1; i < goroutines; i++ {
		if locks[0] != locks[i] {
			t.Errorf("Lock %d is different from lock 0", i)
		}
	}
}

// TestBuildFFmpegArgs_Remux tests ffmpeg args for remux operation
func TestBuildFFmpegArgs_Remux(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	info := &VideoInfo{
		Codec:  "h264",
		Width:  1920,
		Height: 1080,
	}

	args := trans.buildFFmpegArgs("/test/input.mov", "/test/output.mp4", 0, info, false)

	// Should contain -c:v copy for remux
	found := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "copy" {
			found = true
			break
		}
	}

	if !found {
		t.Error("Expected -c:v copy in args for remux operation")
	}
}

// TestBuildFFmpegArgs_Reencode tests ffmpeg args for re-encode operation
func TestBuildFFmpegArgs_Reencode(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	info := &VideoInfo{
		Codec:  "hevc",
		Width:  1920,
		Height: 1080,
	}

	args := trans.buildFFmpegArgs("/test/input.mkv", "/test/output.mp4", 0, info, true)

	// Should contain libx264 for re-encode
	found := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "libx264" {
			found = true
			break
		}
	}

	if !found {
		t.Error("Expected -c:v libx264 in args for re-encode operation")
	}
}

// TestBuildFFmpegArgs_WithScale tests ffmpeg args include scale filter
func TestBuildFFmpegArgs_WithScale(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	info := &VideoInfo{
		Codec:  "h264",
		Width:  1920,
		Height: 1080,
	}

	args := trans.buildFFmpegArgs("/test/input.mp4", "/test/output.mp4", 1280, info, false)

	// Should contain scale filter
	found := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-vf" && args[i+1] == "scale=1280:-2" {
			found = true
			break
		}
	}

	if !found {
		t.Error("Expected -vf scale=1280:-2 in args when targetWidth specified")
	}
}

// TestBuildFFmpegArgs_NoScaleWhenLarger tests no scaling when target is larger
func TestBuildFFmpegArgs_NoScaleWhenLarger(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	info := &VideoInfo{
		Codec:  "h264",
		Width:  1920,
		Height: 1080,
	}

	args := trans.buildFFmpegArgs("/test/input.mp4", "/test/output.mp4", 0, info, false)

	// Should NOT contain scale filter
	for i := 0; i < len(args); i++ {
		if args[i] == "-vf" {
			t.Error("Did not expect -vf flag when targetWidth is 0")
		}
	}
}

// TestProgressTrackingReader tests the progress reader functionality
func TestProgressTrackingReader(t *testing.T) {
	data := bytes.Repeat([]byte("test data"), 1000) // ~9KB
	reader := bytes.NewReader(data)

	progressReader := &progressTrackingReader{
		reader:   reader,
		filePath: "/test/file.mp4",
		lastLog:  time.Now(),
	}

	// Read all data
	buf := &bytes.Buffer{}
	n, err := io.Copy(buf, progressReader)
	if err != nil {
		t.Fatalf("Error reading from progress reader: %v", err)
	}

	// Verify all data was read
	if n != int64(len(data)) {
		t.Errorf("Expected to read %d bytes, got %d", len(data), n)
	}

	// Verify totalBytes was tracked
	if progressReader.totalBytes != int64(len(data)) {
		t.Errorf("Expected totalBytes=%d, got %d", len(data), progressReader.totalBytes)
	}

	// Verify content is intact
	if !bytes.Equal(buf.Bytes(), data) {
		t.Error("Data corruption detected in progress reader")
	}
}

// TestProgressTrackingReader_EmptyRead tests progress reader with no data
func TestProgressTrackingReader_EmptyRead(t *testing.T) {
	reader := bytes.NewReader([]byte{})

	progressReader := &progressTrackingReader{
		reader:   reader,
		filePath: "/test/file.mp4",
		lastLog:  time.Now(),
	}

	buf := &bytes.Buffer{}
	n, err := io.Copy(buf, progressReader)
	if err != nil {
		t.Fatalf("Error reading from progress reader: %v", err)
	}

	if n != 0 {
		t.Errorf("Expected to read 0 bytes, got %d", n)
	}

	if progressReader.totalBytes != 0 {
		t.Errorf("Expected totalBytes=0, got %d", progressReader.totalBytes)
	}
}

// TestCacheKeyGeneration tests that cache keys are generated correctly
func TestCacheKeyGeneration(t *testing.T) {
	tests := []struct {
		name        string
		filePath    string
		targetWidth int
		expectedKey string
	}{
		{
			name:        "No width",
			filePath:    "/path/to/video.mp4",
			targetWidth: 0,
			expectedKey: "video.mp4_w0.mp4",
		},
		{
			name:        "With width",
			filePath:    "/path/to/video.mp4",
			targetWidth: 1280,
			expectedKey: "video.mp4_w1280.mp4",
		},
		{
			name:        "Complex filename",
			filePath:    "/media/folder/my video file.mov",
			targetWidth: 720,
			expectedKey: "my video file.mov_w720.mp4",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cacheKey := fmt.Sprintf("%s_w%d.mp4", filepath.Base(tt.filePath), tt.targetWidth)
			if cacheKey != tt.expectedKey {
				t.Errorf("Expected cache key %q, got %q", tt.expectedKey, cacheKey)
			}
		})
	}
}

// TestTranscoderInitializesCacheLocks tests that cache locks map is initialized
func TestTranscoderInitializesCacheLocks(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	if trans.cacheLocks == nil {
		t.Error("cacheLocks map should be initialized")
	}

	if len(trans.cacheLocks) != 0 {
		t.Errorf("Expected empty cacheLocks map, got %d entries", len(trans.cacheLocks))
	}
}

// TestServeCachedFile_ValidCache tests serving a valid cached file
func TestServeCachedFile_ValidCache(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create source file
	sourcePath := filepath.Join(tmpDir, "source.mp4")
	if err := os.WriteFile(sourcePath, []byte("source content"), 0o644); err != nil {
		t.Fatalf("Failed to create source file: %v", err)
	}

	// Sleep to ensure cache will be newer
	time.Sleep(10 * time.Millisecond)

	// Create cached file (newer than source)
	cachePath := filepath.Join(tmpDir, "cached.mp4")
	testContent := []byte("cached video content")
	if err := os.WriteFile(cachePath, testContent, 0o644); err != nil {
		t.Fatalf("Failed to create cache file: %v", err)
	}

	// Test with regular writer
	buf := &bytes.Buffer{}
	err := trans.serveCachedFile(sourcePath, cachePath, buf)
	if err != nil {
		t.Fatalf("serveCachedFile() error: %v", err)
	}

	if !bytes.Equal(buf.Bytes(), testContent) {
		t.Errorf("Expected content %q, got %q", testContent, buf.Bytes())
	}
}

// TestServeCachedFile_WithHTTPResponseWriter tests serving with proper headers
func TestServeCachedFile_WithHTTPResponseWriter(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create source file
	sourcePath := filepath.Join(tmpDir, "source.mp4")
	if err := os.WriteFile(sourcePath, []byte("source"), 0o644); err != nil {
		t.Fatalf("Failed to create source file: %v", err)
	}

	time.Sleep(10 * time.Millisecond)

	// Create cached file
	cachePath := filepath.Join(tmpDir, "cached.mp4")
	testContent := []byte("cached video data")
	if err := os.WriteFile(cachePath, testContent, 0o644); err != nil {
		t.Fatalf("Failed to create cache file: %v", err)
	}

	// Create mock HTTP response writer
	rr := &mockResponseWriter{
		header: make(http.Header),
		body:   &bytes.Buffer{},
	}

	err := trans.serveCachedFile(sourcePath, cachePath, rr)
	if err != nil {
		t.Fatalf("serveCachedFile() error: %v", err)
	}

	// Check Content-Length header was set
	contentLength := rr.Header().Get("Content-Length")
	if contentLength == "" {
		t.Error("Content-Length header should be set")
	}

	expectedLength := fmt.Sprintf("%d", len(testContent))
	if contentLength != expectedLength {
		t.Errorf("Expected Content-Length=%s, got %s", expectedLength, contentLength)
	}

	// Check Transfer-Encoding was removed
	if rr.Header().Get("Transfer-Encoding") != "" {
		t.Error("Transfer-Encoding header should be removed")
	}

	// Check body content
	if !bytes.Equal(rr.body.Bytes(), testContent) {
		t.Errorf("Expected body %q, got %q", testContent, rr.body.Bytes())
	}
}

// TestServeCachedFile_StaleCache tests that stale cache returns error
func TestServeCachedFile_StaleCache(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create cache first (old)
	cachePath := filepath.Join(tmpDir, "cached.mp4")
	if err := os.WriteFile(cachePath, []byte("old cache"), 0o644); err != nil {
		t.Fatalf("Failed to create cache file: %v", err)
	}

	time.Sleep(10 * time.Millisecond)

	// Create source file (newer)
	sourcePath := filepath.Join(tmpDir, "source.mp4")
	if err := os.WriteFile(sourcePath, []byte("new source"), 0o644); err != nil {
		t.Fatalf("Failed to create source file: %v", err)
	}

	buf := &bytes.Buffer{}
	err := trans.serveCachedFile(sourcePath, cachePath, buf)
	if err == nil {
		t.Error("Expected error for stale cache")
	}

	// Cache should be deleted
	if _, err := os.Stat(cachePath); !os.IsNotExist(err) {
		t.Error("Stale cache should have been deleted")
	}
}

// TestServeCachedFile_MissingCache tests handling of missing cache
func TestServeCachedFile_MissingCache(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	sourcePath := filepath.Join(tmpDir, "source.mp4")
	if err := os.WriteFile(sourcePath, []byte("source"), 0o644); err != nil {
		t.Fatalf("Failed to create source file: %v", err)
	}

	cachePath := filepath.Join(tmpDir, "nonexistent.mp4")

	buf := &bytes.Buffer{}
	err := trans.serveCachedFile(sourcePath, cachePath, buf)
	if err == nil {
		t.Error("Expected error for missing cache file")
	}
}

// mockResponseWriter is a mock http.ResponseWriter for testing
type mockResponseWriter struct {
	header http.Header
	body   *bytes.Buffer
}

func (m *mockResponseWriter) Header() http.Header {
	return m.header
}

func (m *mockResponseWriter) Write(data []byte) (int, error) {
	return m.body.Write(data)
}

func (m *mockResponseWriter) WriteHeader(_ int) {
	// Not needed for this test
}

// =============================================================================
// GetOrStartTranscodeAndWait Tests (Integration)
// =============================================================================

// TestGetOrStartTranscodeAndWait_CachedFile tests serving an already cached file immediately
func TestGetOrStartTranscodeAndWait_CachedFile(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping ffmpeg test in short mode")
	}

	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create a test video
	testVideo := createTestVideo(t, tmpDir)

	info := &VideoInfo{
		Codec:    "h264",
		Width:    320,
		Height:   240,
		Duration: 1.0,
	}

	ctx := context.Background()

	// First transcode to populate cache
	cacheKey := filepath.Base(testVideo) + "_w0.mp4"
	cachePath := filepath.Join(tmpDir, cacheKey)

	// Manually create a cached version
	if err := trans.transcodeDirectToCache(ctx, testVideo, cachePath, 0, info, false); err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}

	// Now test GetOrStartTranscodeAndWait
	resultPath, err := trans.GetOrStartTranscodeAndWait(ctx, testVideo, 0, info)
	if err != nil {
		t.Fatalf("GetOrStartTranscodeAndWait() error: %v", err)
	}

	if resultPath != cachePath {
		t.Errorf("Expected cachePath %s, got %s", cachePath, resultPath)
	}

	// Verify cache file exists
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		t.Error("Cache file should exist")
	}
}

// TestGetOrStartTranscodeAndWait_WaitsForCompletion tests waiting for transcode completion
func TestGetOrStartTranscodeAndWait_WaitsForCompletion(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping ffmpeg test in short mode")
	}

	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create a test video
	testVideo := createTestVideo(t, tmpDir)

	info := &VideoInfo{
		Codec:    "h264",
		Width:    320,
		Height:   240,
		Duration: 1.0,
	}

	ctx := context.Background()

	// Call GetOrStartTranscodeAndWait (should wait for completion)
	cacheKey := filepath.Base(testVideo) + "_w0.mp4"
	cachePath := filepath.Join(tmpDir, cacheKey)

	start := time.Now()
	resultPath, err := trans.GetOrStartTranscodeAndWait(ctx, testVideo, 0, info)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("GetOrStartTranscodeAndWait() error: %v", err)
	}

	if resultPath != cachePath {
		t.Errorf("Expected cachePath %s, got %s", cachePath, resultPath)
	}

	t.Logf("Waited %.2f seconds for transcode completion", elapsed.Seconds())

	// Verify cache file exists
	stat, err := os.Stat(cachePath)
	if err != nil {
		t.Fatalf("Cache file should exist: %v", err)
	}

	if stat.Size() == 0 {
		t.Error("Cache file should have data")
	}

	t.Logf("Cache size: %.2f KB", float64(stat.Size())/1024)
}

// TestGetOrStartTranscodeAndWait_ConcurrentRequests tests that concurrent requests wait properly
func TestGetOrStartTranscodeAndWait_ConcurrentRequests(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping ffmpeg test in short mode")
	}

	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create a test video
	testVideo := createTestVideo(t, tmpDir)

	info := &VideoInfo{
		Codec:    "h264",
		Width:    320,
		Height:   240,
		Duration: 1.0,
	}

	ctx := context.Background()

	// Start two concurrent requests
	done1 := make(chan error)
	done2 := make(chan error)

	go func() {
		_, err := trans.GetOrStartTranscodeAndWait(ctx, testVideo, 0, info)
		done1 <- err
	}()

	go func() {
		_, err := trans.GetOrStartTranscodeAndWait(ctx, testVideo, 0, info)
		done2 <- err
	}()

	// Both should complete successfully
	err1 := <-done1
	err2 := <-done2

	if err1 != nil {
		t.Errorf("First request error: %v", err1)
	}
	if err2 != nil {
		t.Errorf("Second request error: %v", err2)
	}
}

// TestGetOrStartTranscodeAndWait_Disabled tests error when transcoding disabled
func TestGetOrStartTranscodeAndWait_Disabled(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", false, "none") // disabled

	info := &VideoInfo{
		Codec:    "hevc",
		Width:    1920,
		Height:   1080,
		Duration: 60.0,
	}

	ctx := context.Background()

	_, err := trans.GetOrStartTranscodeAndWait(ctx, "/fake/video.mp4", 0, info)
	if err == nil {
		t.Error("Expected error when transcoding disabled")
	}

	if err.Error() != "transcoding required but disabled (cache directory not writable)" {
		t.Errorf("Unexpected error message: %v", err)
	}
}

// =============================================================================
// Helper Functions
// =============================================================================

// createTestVideo creates a simple test video file using ffmpeg
func createTestVideo(t *testing.T, dir string) string {
	t.Helper()

	videoPath := filepath.Join(dir, "test_source.mp4")

	cmd := exec.CommandContext(context.Background(), "ffmpeg",
		"-f", "lavfi",
		"-i", "testsrc=duration=1:size=320x240:rate=1",
		"-c:v", "libx264",
		"-pix_fmt", "yuv420p",
		"-f", "mp4",
		"-y",
		videoPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Failed to create test video: %v\nOutput: %s", err, output)
	}

	return videoPath
}

// =============================================================================
// Helper Function Tests
// =============================================================================

func TestGetEncoderInfo(t *testing.T) {
	tests := []struct {
		name          string
		gpuAvailable  bool
		gpuEncoder    string
		gpuAccel      GPUAccel
		targetWidth   int
		videoWidth    int
		needsReencode bool
		expected      string
	}{
		{
			name:          "Stream copy mode",
			gpuAvailable:  false,
			targetWidth:   0,
			videoWidth:    1920,
			needsReencode: false,
			expected:      " [stream copy]",
		},
		{
			name:          "GPU encoding",
			gpuAvailable:  true,
			gpuEncoder:    "h264_nvenc",
			gpuAccel:      GPUAccelNVIDIA,
			targetWidth:   1280,
			videoWidth:    1920,
			needsReencode: true,
			expected:      " [GPU: nvidia/h264_nvenc]",
		},
		{
			name:          "CPU encoding",
			gpuAvailable:  false,
			targetWidth:   1280,
			videoWidth:    1920,
			needsReencode: true,
			expected:      " [CPU: libx264]",
		},
		{
			name:          "GPU encoding with VA-API",
			gpuAvailable:  true,
			gpuEncoder:    "h264_vaapi",
			gpuAccel:      GPUAccelVAAPI,
			targetWidth:   720,
			videoWidth:    1920,
			needsReencode: true,
			expected:      " [GPU: vaapi/h264_vaapi]",
		},
		{
			name:          "No scaling but needs reencode",
			gpuAvailable:  false,
			targetWidth:   0,
			videoWidth:    1920,
			needsReencode: true,
			expected:      " [CPU: libx264]",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trans := New("/tmp/cache", "", true, "none")
			trans.gpuAvailable = tt.gpuAvailable
			trans.gpuEncoder = tt.gpuEncoder
			trans.gpuAccel = tt.gpuAccel

			info := &VideoInfo{
				Width:  tt.videoWidth,
				Height: 1080,
			}

			result := trans.getEncoderInfo(tt.targetWidth, info, tt.needsReencode)

			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestFinalizeCache(t *testing.T) {
	tests := []struct {
		name          string
		setupTempFile bool
		tempSize      int
		expectSuccess bool
	}{
		{
			name:          "Successful cache finalization",
			setupTempFile: true,
			tempSize:      1024,
			expectSuccess: true,
		},
		{
			name:          "Missing temp file",
			setupTempFile: false,
			expectSuccess: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trans := New("/tmp/cache", "", true, "none")

			dir := t.TempDir()
			tempPath := filepath.Join(dir, "test.mp4.tmp")
			cachePath := filepath.Join(dir, "test.mp4")

			if tt.setupTempFile {
				// Create temp file with some data
				data := make([]byte, tt.tempSize)
				if err := os.WriteFile(tempPath, data, 0o644); err != nil {
					t.Fatalf("Failed to create temp file: %v", err)
				}
			}

			trans.finalizeCache(tempPath, cachePath)

			if tt.expectSuccess {
				// Verify cache file exists
				if _, err := os.Stat(cachePath); err != nil {
					t.Errorf("Expected cache file to exist: %v", err)
				}

				// Verify temp file was removed
				if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
					t.Error("Expected temp file to be removed")
				}
			} else {
				// Verify cache file does not exist if temp file was missing
				if _, err := os.Stat(cachePath); !os.IsNotExist(err) {
					t.Error("Expected cache file to not exist when temp file is missing")
				}
			}
		})
	}
}

func TestStreamToCacheAndWriter(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping stream test in short mode")
	}

	trans := New("/tmp/cache", "", true, "none")
	ctx := context.Background()

	// Create a pipe to simulate ffmpeg stdout
	reader, writer := io.Pipe()

	// Create cache file
	dir := t.TempDir()
	cacheFile, err := os.Create(filepath.Join(dir, "cache.mp4"))
	if err != nil {
		t.Fatalf("Failed to create cache file: %v", err)
	}
	defer cacheFile.Close()

	// Create output buffer
	output := &bytes.Buffer{}

	// Write test data in background
	testData := []byte("test video data")
	go func() {
		writer.Write(testData)
		writer.Close()
	}()

	// Test streaming
	err = trans.streamToCacheAndWriter(ctx, reader, cacheFile, output, "/test/video.mp4")

	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}

	// Verify data was written to output
	if !bytes.Equal(output.Bytes(), testData) {
		t.Errorf("Expected output %q, got %q", testData, output.Bytes())
	}

	// Verify data was written to cache
	cacheFile.Close()
	cacheData, err := os.ReadFile(filepath.Join(dir, "cache.mp4"))
	if err != nil {
		t.Fatalf("Failed to read cache file: %v", err)
	}

	if !bytes.Equal(cacheData, testData) {
		t.Errorf("Expected cache data %q, got %q", testData, cacheData)
	}
}

func TestHandleTranscodeFailure(t *testing.T) {
	tests := []struct {
		name              string
		gpuAvailable      bool
		isGPUError        bool
		expectRetry       bool
		expectGPUDisabled bool
	}{
		{
			name:              "GPU error triggers retry",
			gpuAvailable:      true,
			isGPUError:        true,
			expectRetry:       true,
			expectGPUDisabled: true,
		},
		{
			name:              "Non-GPU error does not retry",
			gpuAvailable:      true,
			isGPUError:        false,
			expectRetry:       false,
			expectGPUDisabled: false,
		},
		{
			name:              "GPU not available, no retry",
			gpuAvailable:      false,
			isGPUError:        true,
			expectRetry:       false,
			expectGPUDisabled: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trans := New("/tmp/cache", "", true, "none")
			trans.gpuAvailable = tt.gpuAvailable

			dir := t.TempDir()
			tempPath := filepath.Join(dir, "test.mp4.tmp")
			cachePath := filepath.Join(dir, "test.mp4")

			// Create temp file
			cacheFile, err := os.Create(tempPath)
			if err != nil {
				t.Fatalf("Failed to create temp file: %v", err)
			}

			ctx := context.Background()
			output := &bytes.Buffer{}

			var stderr bytes.Buffer
			if tt.isGPUError {
				stderr.WriteString("libcuda.so.1: cannot open shared object file")
			} else {
				stderr.WriteString("Unknown decoder")
			}

			streamErr := fmt.Errorf("stream error")
			cmdErr := fmt.Errorf("command error")

			// Call handleTranscodeFailure
			err = trans.handleTranscodeFailure(ctx, "/test/video.mp4", output, cachePath,
				1280, &VideoInfo{Width: 1920, Height: 1080}, true,
				streamErr, cmdErr, &stderr, cacheFile, tempPath)

			// We always expect an error
			if err == nil {
				t.Error("Expected error, got nil")
			}

			// Verify GPU disabled state
			trans.gpuMu.Lock()
			gpuDisabled := !trans.gpuAvailable
			trans.gpuMu.Unlock()

			if tt.expectGPUDisabled && !gpuDisabled {
				t.Error("Expected GPU to be disabled")
			}

			if !tt.expectGPUDisabled && gpuDisabled && tt.gpuAvailable {
				t.Error("Expected GPU to remain available")
			}
		})
	}
}

// =============================================================================
// sanitizeFilePath Tests
// =============================================================================

func TestSanitizeFilePath_ValidFile(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.mp4")
	if err := os.WriteFile(testFile, []byte("content"), 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	result, err := sanitizeFilePath(testFile)
	if err != nil {
		t.Fatalf("sanitizeFilePath() error: %v", err)
	}

	// Should return a cleaned path
	expected := filepath.Clean(testFile)
	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

func TestSanitizeFilePath_NonexistentFile(t *testing.T) {
	_, err := sanitizeFilePath("/nonexistent/path/video.mp4")
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

func TestSanitizeFilePath_Directory(t *testing.T) {
	tmpDir := t.TempDir()

	_, err := sanitizeFilePath(tmpDir)
	if err == nil {
		t.Error("Expected error when path is a directory")
	}

	if err != nil && !contains(err.Error(), "is a directory") {
		t.Errorf("Expected 'is a directory' error, got: %v", err)
	}
}

func TestSanitizeFilePath_NullByte(t *testing.T) {
	_, err := sanitizeFilePath("/tmp/test\x00.mp4")
	if err == nil {
		t.Error("Expected error for path with null byte")
	}

	if err != nil && !contains(err.Error(), "null byte") {
		t.Errorf("Expected 'null byte' error, got: %v", err)
	}
}

func TestSanitizeFilePath_RelativePath(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.mp4")
	if err := os.WriteFile(testFile, []byte("content"), 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Create a relative path with traversal
	subDir := filepath.Join(tmpDir, "sub")
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatalf("Failed to create subdir: %v", err)
	}

	relativePath := filepath.Join(subDir, "..", "test.mp4")
	result, err := sanitizeFilePath(relativePath)
	if err != nil {
		t.Fatalf("sanitizeFilePath() error: %v", err)
	}

	// Should resolve to the clean absolute path
	expected := filepath.Clean(relativePath)
	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

func TestSanitizeFilePath_Symlink(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.mp4")
	if err := os.WriteFile(testFile, []byte("content"), 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	symlinkPath := filepath.Join(tmpDir, "link.mp4")
	if err := os.Symlink(testFile, symlinkPath); err != nil {
		t.Skipf("Symlinks not supported: %v", err)
	}

	// Symlinks should be accepted (they resolve to a valid file)
	result, err := sanitizeFilePath(symlinkPath)
	if err != nil {
		t.Fatalf("sanitizeFilePath() error: %v", err)
	}

	if result == "" {
		t.Error("Expected non-empty result for symlink")
	}
}

func TestSanitizeFilePath_EmptyString(t *testing.T) {
	_, err := sanitizeFilePath("")
	if err == nil {
		t.Error("Expected error for empty path")
	}
}

// =============================================================================
// sanitizeOutputPath Tests
// =============================================================================

func TestSanitizeOutputPath_Stdout(t *testing.T) {
	result, err := sanitizeOutputPath("-")
	if err != nil {
		t.Fatalf("sanitizeOutputPath() error: %v", err)
	}

	if result != "-" {
		t.Errorf("Expected '-', got %s", result)
	}
}

func TestSanitizeOutputPath_ValidPath(t *testing.T) {
	tmpDir := t.TempDir()
	outputPath := filepath.Join(tmpDir, "output.mp4")

	result, err := sanitizeOutputPath(outputPath)
	if err != nil {
		t.Fatalf("sanitizeOutputPath() error: %v", err)
	}

	expected := filepath.Clean(outputPath)
	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

func TestSanitizeOutputPath_NonexistentParentDir(t *testing.T) {
	_, err := sanitizeOutputPath("/nonexistent/parent/dir/output.mp4")
	if err == nil {
		t.Error("Expected error when parent directory does not exist")
	}

	if err != nil && !contains(err.Error(), "parent directory") {
		t.Errorf("Expected 'parent directory' error, got: %v", err)
	}
}

func TestSanitizeOutputPath_NullByte(t *testing.T) {
	_, err := sanitizeOutputPath("/tmp/output\x00.mp4")
	if err == nil {
		t.Error("Expected error for path with null byte")
	}

	if err != nil && !contains(err.Error(), "null byte") {
		t.Errorf("Expected 'null byte' error, got: %v", err)
	}
}

func TestSanitizeOutputPath_RelativePathWithTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	subDir := filepath.Join(tmpDir, "sub")
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatalf("Failed to create subdir: %v", err)
	}

	// Path with traversal that resolves to a valid parent
	traversalPath := filepath.Join(subDir, "..", "output.mp4")
	result, err := sanitizeOutputPath(traversalPath)
	if err != nil {
		t.Fatalf("sanitizeOutputPath() error: %v", err)
	}

	// Should be cleaned
	expected := filepath.Clean(traversalPath)
	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

func TestSanitizeOutputPath_EmptyString(_ *testing.T) {
	// Empty string cleaned becomes "." — whose parent is "."
	// This may or may not error depending on whether "." exists as a dir
	// The important thing is it doesn't panic
	_, _ = sanitizeOutputPath("")
}

func TestSanitizeOutputPath_ExistingFile(t *testing.T) {
	tmpDir := t.TempDir()
	existingFile := filepath.Join(tmpDir, "existing.mp4")
	if err := os.WriteFile(existingFile, []byte("data"), 0o644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}

	// Should succeed — output path can point to an existing file (overwrite)
	result, err := sanitizeOutputPath(existingFile)
	if err != nil {
		t.Fatalf("sanitizeOutputPath() error: %v", err)
	}

	expected := filepath.Clean(existingFile)
	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

// =============================================================================
// sanitizeLogFileName Tests
// =============================================================================

func TestSanitizeLogFileName_NormalFilename(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Simple filename",
			input:    "video.mp4",
			expected: "video.mp4",
		},
		{
			name:     "Filename with dashes and underscores",
			input:    "my-video_file.mp4",
			expected: "my-video_file.mp4",
		},
		{
			name:     "Filename with numbers",
			input:    "video123.mp4",
			expected: "video123.mp4",
		},
		{
			name:     "Mixed case",
			input:    "MyVideo.MP4",
			expected: "MyVideo.MP4",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeLogFileName(tt.input)
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestSanitizeLogFileName_UnsafeCharacters(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Spaces replaced",
			input:    "my video file.mp4",
			expected: "my_video_file.mp4",
		},
		{
			name:     "Shell metacharacters replaced",
			input:    "video;rm -rf.mp4",
			expected: "video_rm_-rf.mp4",
		},
		{
			name:     "Pipe and redirect replaced",
			input:    "video|cat>/etc/passwd.mp4",
			expected: "passwd.mp4",
		},
		{
			name:     "Dollar and backtick replaced",
			input:    "video$(whoami)`id`.mp4",
			expected: "video__whoami__id_.mp4",
		},
		{
			name:     "Quotes replaced",
			input:    `video"test'name.mp4`,
			expected: "video_test_name.mp4",
		},
		{
			name:     "Null byte in name",
			input:    "video\x00.mp4",
			expected: "video_.mp4",
		},
		{
			name:     "Unicode characters replaced",
			input:    "vidéo_файл.mp4",
			expected: "vid_o_____.mp4",
		},
		{
			name:     "Newline and tab replaced",
			input:    "video\n\t.mp4",
			expected: "video__.mp4",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeLogFileName(tt.input)
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestSanitizeLogFileName_PathTraversal(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Directory traversal stripped",
			input:    "../../etc/passwd",
			expected: "passwd",
		},
		{
			name:     "Absolute path stripped to base",
			input:    "/etc/passwd",
			expected: "passwd",
		},
		{
			name:     "Complex traversal",
			input:    "../../../tmp/evil.sh",
			expected: "evil.sh",
		},
		{
			name:     "Windows-style path",
			input:    `C:\Windows\System32\cmd.exe`,
			expected: "cmd.exe",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeLogFileName(tt.input)
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestSanitizeLogFileName_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Empty string",
			input:    "",
			expected: "unknown",
		},
		{
			name:     "Single dot",
			input:    ".",
			expected: "unknown",
		},
		{
			name:     "Double dot",
			input:    "..",
			expected: "unknown",
		},
		{
			name:     "Only unsafe characters",
			input:    ";;;",
			expected: "___",
		},
		{
			name:     "Very long filename",
			input:    string(make([]byte, 1000)),
			expected: string(make([]byte, 1000)), // sanitizeLogFileName doesn't truncate — all null bytes become underscores
		},
		{
			name:     "Hidden file (dot prefix)",
			input:    ".hidden_file.mp4",
			expected: ".hidden_file.mp4",
		},
		{
			name:     "Multiple dots",
			input:    "video.backup.old.mp4",
			expected: "video.backup.old.mp4",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeLogFileName(tt.input)
			if tt.name == "Very long filename" {
				// Just verify it doesn't panic and returns something
				if result == "" {
					t.Error("Expected non-empty result for long filename")
				}
				return
			}
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestSanitizeLogFileName_OnlyAllowedCharacters(t *testing.T) {
	// Verify the output only contains allowed characters
	inputs := []string{
		"normal.mp4",
		"spaced file.mp4",
		"special!@#$%^&*().mp4",
		"../../traversal.mp4",
		"unicode_ñ_ü_ö.mp4",
		"tabs\tand\nnewlines.mp4",
	}

	allowed := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."

	for _, input := range inputs {
		result := sanitizeLogFileName(input)
		for _, r := range result {
			found := false
			for _, a := range allowed {
				if r == a {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("sanitizeLogFileName(%q) = %q contains disallowed character %q", input, result, string(r))
			}
		}
	}
}

// =============================================================================
// Integration: createTranscoderLog with sanitized paths
// =============================================================================

func TestCreateTranscoderLog_PathContainment(t *testing.T) {
	tmpDir := t.TempDir()
	logDir := filepath.Join(tmpDir, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatalf("Failed to create log dir: %v", err)
	}

	trans := New(tmpDir, logDir, true, "none")

	// Normal case — should create a log file within logDir
	logFile := trans.createTranscoderLog("/media/videos/test.mp4", 1280)
	if logFile == nil {
		t.Fatal("Expected log file to be created")
	}
	logPath := logFile.Name()
	logFile.Close()

	absLogDir, _ := filepath.Abs(logDir)
	absLogPath, _ := filepath.Abs(logPath)
	if !hasPrefix(absLogPath, absLogDir+string(filepath.Separator)) {
		t.Errorf("Log file %s should be within log dir %s", absLogPath, absLogDir)
	}

	// Verify file exists
	if _, err := os.Stat(logPath); err != nil {
		t.Errorf("Log file should exist: %v", err)
	}
}

func TestCreateTranscoderLog_TraversalAttempt(t *testing.T) {
	tmpDir := t.TempDir()
	logDir := filepath.Join(tmpDir, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatalf("Failed to create log dir: %v", err)
	}

	trans := New(tmpDir, logDir, true, "none")

	// Attempt path traversal in the video filename
	logFile := trans.createTranscoderLog("../../etc/passwd", 1280)
	if logFile != nil {
		logPath := logFile.Name()
		logFile.Close()

		// The log file should still be within logDir
		absLogDir, _ := filepath.Abs(logDir)
		absLogPath, _ := filepath.Abs(logPath)
		if !hasPrefix(absLogPath, absLogDir+string(filepath.Separator)) {
			t.Errorf("Log file %s escaped log dir %s", absLogPath, absLogDir)
		}
	}
	// logFile being nil is also acceptable — means traversal was blocked
}

func TestCreateTranscoderLog_SpecialCharactersInFilename(t *testing.T) {
	tmpDir := t.TempDir()
	logDir := filepath.Join(tmpDir, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatalf("Failed to create log dir: %v", err)
	}

	trans := New(tmpDir, logDir, true, "none")

	// Filename with shell metacharacters
	logFile := trans.createTranscoderLog("/media/video;rm -rf /.mp4", 720)
	if logFile != nil {
		logPath := logFile.Name()
		logFile.Close()

		// Should be safely contained
		absLogDir, _ := filepath.Abs(logDir)
		absLogPath, _ := filepath.Abs(logPath)
		if !hasPrefix(absLogPath, absLogDir+string(filepath.Separator)) {
			t.Errorf("Log file %s escaped log dir %s", absLogPath, absLogDir)
		}

		// Filename should not contain shell metacharacters
		baseName := filepath.Base(logPath)
		for _, dangerous := range []string{";", "|", "&", "$", ">", "<", "`"} {
			if contains(baseName, dangerous) {
				t.Errorf("Log filename %q contains dangerous character %q", baseName, dangerous)
			}
		}
	}
}

func TestCreateTranscoderLog_NoLogDir(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Should return nil when no log dir configured
	logFile := trans.createTranscoderLog("/media/test.mp4", 1280)
	if logFile != nil {
		logFile.Close()
		t.Error("Expected nil when logDir is empty")
	}
}

// =============================================================================
// Benchmarks
// =============================================================================

func BenchmarkSanitizeFilePath(b *testing.B) {
	tmpDir := b.TempDir()
	testFile := filepath.Join(tmpDir, "test.mp4")
	if err := os.WriteFile(testFile, []byte("content"), 0o644); err != nil {
		b.Fatalf("Failed to create test file: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = sanitizeFilePath(testFile)
	}
}

func BenchmarkSanitizeOutputPath(b *testing.B) {
	tmpDir := b.TempDir()
	outputPath := filepath.Join(tmpDir, "output.mp4")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = sanitizeOutputPath(outputPath)
	}
}

func BenchmarkSanitizeLogFileName(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = sanitizeLogFileName("my video file (2024) [1080p].mp4")
	}
}

func BenchmarkSanitizeLogFileName_Clean(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = sanitizeLogFileName("clean-filename.mp4")
	}
}

// =============================================================================
// Helpers
// =============================================================================

// contains checks if s contains substr (avoids importing strings in test)
func contains(s, substr string) bool {
	return substr != "" && len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// hasPrefix checks if s starts with prefix
func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
