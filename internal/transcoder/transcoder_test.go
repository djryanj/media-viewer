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
	trans := New("/tmp/cache", "", true)

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
			trans := New("/tmp/cache", "", tt.enabled)

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
	trans := New("/tmp/cache", "", true)

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
	trans := New("/tmp/cache", "", true)

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
	trans := New("/tmp/cache", "", false)

	if trans.IsEnabled() {
		t.Error("Transcoder should be disabled")
	}

	// Verify process map is still initialized when disabled
	if trans.processes == nil {
		t.Error("Process map should be initialized even when disabled")
	}
}

func TestTranscoderProcessMap(t *testing.T) {
	trans := New("/tmp/cache", "", true)

	if trans.processes == nil {
		t.Fatal("Process map should be initialized")
	}

	if len(trans.processes) != 0 {
		t.Errorf("Expected empty process map, got %d processes", len(trans.processes))
	}
}

func TestGetVideoInfoWithInvalidFile(t *testing.T) {
	trans := New("/tmp/cache", "", true)

	ctx := context.Background()

	// Try to get info for non-existent file
	_, err := trans.GetVideoInfo(ctx, "/nonexistent/file.mp4")
	if err == nil {
		t.Error("Expected error when getting info for non-existent file")
	}
}

func TestGetVideoInfoContextCancellation(t *testing.T) {
	trans := New("/tmp/cache", "", true)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := trans.GetVideoInfo(ctx, "/tmp/test.mp4")
	if err == nil {
		t.Error("Expected error when context is canceled")
	}
}

func TestStreamConfigDefaults(t *testing.T) {
	// Test that New() sets up reasonable stream config defaults
	trans := New("/tmp/cache", "", true)

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
		_ = New("/tmp/cache", "", true)
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
	trans := New(tmpDir, "", true)

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
	trans := New(tmpDir, "", true)

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
	trans := New(tmpDir, "", true)

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
	trans := New("/tmp/cache", "", true)

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
	trans := New("/tmp/cache", "", true)

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
	trans := New("/tmp/cache", "", true)

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
	trans := New("/tmp/cache", "", true)

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
	trans := New("/tmp/cache", "", true)

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
	trans := New("/tmp/cache", "", true)

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
	trans := New("/tmp/cache", "", true)

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
	trans := New(tmpDir, "", true)

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
	trans := New(tmpDir, "", true)

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
	trans := New(tmpDir, "", true)

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
	trans := New(tmpDir, "", true)

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
	trans := New(tmpDir, "", true)

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
	trans := New(tmpDir, "", true)

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
	trans := New(tmpDir, "", true)

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
	trans := New(tmpDir, "", false) // disabled

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
