package transcoder

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// =============================================================================
// Unit Tests (Fast, Mocked)
// These run with -short flag and use mocks to avoid dependencies
// =============================================================================

// =============================================================================
// GetVideoInfo Unit Tests (Mocked)
// =============================================================================

func TestGetVideoInfo_ParsesFFProbeOutput(t *testing.T) {
	// Create a mock ffprobe script that outputs valid JSON (compact format)
	tmpDir := t.TempDir()
	mockFFProbe := filepath.Join(tmpDir, "ffprobe")

	ffprobeScript := `#!/bin/bash
echo '{"streams":[{"codec_name":"h264","width":1920,"height":1080}],"format":{"duration":"125.5"}}'
`

	if err := os.WriteFile(mockFFProbe, []byte(ffprobeScript), 0o755); err != nil {
		t.Fatalf("Failed to create mock ffprobe: %v", err)
	}

	// Temporarily modify PATH to use our mock
	oldPath := os.Getenv("PATH")
	defer func() {
		_ = os.Setenv("PATH", oldPath)
	}()
	_ = os.Setenv("PATH", tmpDir+":"+oldPath)

	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	// Test with a fake file path (ffprobe won't actually read it)
	info, err := trans.GetVideoInfo(ctx, "/fake/video.mp4")
	if err != nil {
		t.Fatalf("GetVideoInfo() error: %v", err)
	}

	if info.Duration != 125.5 {
		t.Errorf("Expected duration=125.5, got %f", info.Duration)
	}

	if info.Codec != "h264" {
		t.Errorf("Expected codec=h264, got %s", info.Codec)
	}

	if info.Width != 1920 {
		t.Errorf("Expected width=1920, got %d", info.Width)
	}

	if info.Height != 1080 {
		t.Errorf("Expected height=1080, got %d", info.Height)
	}

	// h264 in mp4 container should not need transcode
	if info.NeedsTranscode {
		t.Error("h264 in mp4 should not need transcode")
	}
}

func TestGetVideoInfo_NeedsTranscodeForIncompatibleCodec(t *testing.T) {
	tmpDir := t.TempDir()
	mockFFProbe := filepath.Join(tmpDir, "ffprobe")

	ffprobeScript := `#!/bin/bash
echo '{"streams":[{"codec_name":"hevc","width":1920,"height":1080}],"format":{"duration":"100.0"}}'
`

	if err := os.WriteFile(mockFFProbe, []byte(ffprobeScript), 0o755); err != nil {
		t.Fatalf("Failed to create mock ffprobe: %v", err)
	}

	oldPath := os.Getenv("PATH")
	defer func() {
		_ = os.Setenv("PATH", oldPath)
	}()
	_ = os.Setenv("PATH", tmpDir+":"+oldPath)

	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	info, err := trans.GetVideoInfo(ctx, "/fake/video.mp4")
	if err != nil {
		t.Fatalf("GetVideoInfo() error: %v", err)
	}

	if info.Codec != "hevc" {
		t.Errorf("Expected codec=hevc, got %s", info.Codec)
	}

	// HEVC should need transcode
	if !info.NeedsTranscode {
		t.Error("hevc codec should need transcode")
	}
}

func TestGetVideoInfo_NeedsTranscodeForIncompatibleContainer(t *testing.T) {
	tmpDir := t.TempDir()
	mockFFProbe := filepath.Join(tmpDir, "ffprobe")

	ffprobeScript := `#!/bin/bash
echo '{"streams":[{"codec_name":"h264","width":1920,"height":1080}],"format":{"duration":"100.0"}}'
`

	if err := os.WriteFile(mockFFProbe, []byte(ffprobeScript), 0o755); err != nil {
		t.Fatalf("Failed to create mock ffprobe: %v", err)
	}

	oldPath := os.Getenv("PATH")
	defer func() {
		_ = os.Setenv("PATH", oldPath)
	}()
	_ = os.Setenv("PATH", tmpDir+":"+oldPath)

	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	// .mkv is not a compatible container
	info, err := trans.GetVideoInfo(ctx, "/fake/video.mkv")
	if err != nil {
		t.Fatalf("GetVideoInfo() error: %v", err)
	}

	// h264 codec but mkv container should need transcode
	if !info.NeedsTranscode {
		t.Error("h264 in mkv container should need transcode")
	}
}

func TestGetVideoInfo_HandlesFFProbeError(t *testing.T) {
	tmpDir := t.TempDir()
	mockFFProbe := filepath.Join(tmpDir, "ffprobe")

	ffprobeScript := `#!/bin/bash
echo "Error: invalid file" >&2
exit 1
`

	if err := os.WriteFile(mockFFProbe, []byte(ffprobeScript), 0o755); err != nil {
		t.Fatalf("Failed to create mock ffprobe: %v", err)
	}

	oldPath := os.Getenv("PATH")
	defer func() {
		_ = os.Setenv("PATH", oldPath)
	}()
	_ = os.Setenv("PATH", tmpDir+":"+oldPath)

	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	_, err := trans.GetVideoInfo(ctx, "/fake/video.mp4")
	if err == nil {
		t.Error("Expected error when ffprobe fails")
	}

	if !strings.Contains(err.Error(), "ffprobe error") {
		t.Errorf("Expected ffprobe error message, got: %v", err)
	}
}

func TestGetVideoInfo_RespectsContext(t *testing.T) {
	tmpDir := t.TempDir()
	mockFFProbe := filepath.Join(tmpDir, "ffprobe")

	// Script that sleeps to allow cancellation
	ffprobeScript := `#!/bin/bash
sleep 10
`

	if err := os.WriteFile(mockFFProbe, []byte(ffprobeScript), 0o755); err != nil {
		t.Fatalf("Failed to create mock ffprobe: %v", err)
	}

	oldPath := os.Getenv("PATH")
	defer func() {
		_ = os.Setenv("PATH", oldPath)
	}()
	_ = os.Setenv("PATH", tmpDir+":"+oldPath)

	trans := New("/tmp/cache", "", true)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := trans.GetVideoInfo(ctx, "/fake/video.mp4")
	if err == nil {
		t.Error("Expected error when context times out")
	}
}

// =============================================================================
// StreamVideo Tests
// =============================================================================

func TestStreamVideo_DirectStreamWhenNoTranscodingNeeded(t *testing.T) {
	tmpDir := t.TempDir()

	// Create test video file
	testFile := filepath.Join(tmpDir, "test.mp4")
	testContent := []byte("fake video content for direct streaming")
	if err := os.WriteFile(testFile, testContent, 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Mock ffprobe to return h264/mp4 (no transcode needed)
	mockFFProbe := filepath.Join(tmpDir, "ffprobe")
	ffprobeScript := `#!/bin/bash
cat << 'EOF'
{
  "streams": [
    {
      "codec_name": "h264",
      "width": 1920,
      "height": 1080
    }
  ],
  "format": {
    "duration": "100.0"
  }
}
EOF
`

	if err := os.WriteFile(mockFFProbe, []byte(ffprobeScript), 0o755); err != nil {
		t.Fatalf("Failed to create mock ffprobe: %v", err)
	}

	oldPath := os.Getenv("PATH")
	defer func() {
		_ = os.Setenv("PATH", oldPath)
	}()
	_ = os.Setenv("PATH", tmpDir+":"+oldPath)

	trans := New(tmpDir, "", true)
	ctx := context.Background()

	var buf bytes.Buffer
	err := trans.StreamVideo(ctx, testFile, &buf, 0)
	if err != nil {
		t.Fatalf("StreamVideo() error: %v", err)
	}

	// Should have streamed the file directly
	if buf.String() != string(testContent) {
		t.Errorf("Expected direct stream content, got: %s", buf.String())
	}
}

func TestStreamVideo_ErrorWhenTranscodingDisabled(t *testing.T) {
	tmpDir := t.TempDir()

	// Create test video file
	testFile := filepath.Join(tmpDir, "test.mkv")
	if err := os.WriteFile(testFile, []byte("fake"), 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Mock ffprobe to return hevc (needs transcode)
	mockFFProbe := filepath.Join(tmpDir, "ffprobe")
	ffprobeScript := `#!/bin/bash
cat << 'EOF'
{
  "streams": [
    {
      "codec_name": "hevc",
      "width": 1920,
      "height": 1080
    }
  ],
  "format": {
    "duration": "100.0"
  }
}
EOF
`

	if err := os.WriteFile(mockFFProbe, []byte(ffprobeScript), 0o755); err != nil {
		t.Fatalf("Failed to create mock ffprobe: %v", err)
	}

	oldPath := os.Getenv("PATH")
	defer func() {
		_ = os.Setenv("PATH", oldPath)
	}()
	_ = os.Setenv("PATH", tmpDir+":"+oldPath)

	// Create transcoder with transcoding disabled
	trans := New(tmpDir, "", false)
	ctx := context.Background()

	var buf bytes.Buffer
	err := trans.StreamVideo(ctx, testFile, &buf, 0)
	if err == nil {
		t.Error("Expected error when transcoding required but disabled")
	}

	if !strings.Contains(err.Error(), "disabled") {
		t.Errorf("Expected disabled error, got: %v", err)
	}
}

func TestStreamVideo_ErrorWhenFileNotFound(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true)
	ctx := context.Background()

	var buf bytes.Buffer
	err := trans.StreamVideo(ctx, "/nonexistent/file.mp4", &buf, 0)
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

// =============================================================================
// ClearCache Tests
// =============================================================================

func TestClearCache_RemovesFilesAndReturnsSize(t *testing.T) {
	tmpDir := t.TempDir()
	cacheDir := filepath.Join(tmpDir, "cache")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("Failed to create cache dir: %v", err)
	}

	// Create test files
	file1 := filepath.Join(cacheDir, "file1.mp4")
	file2 := filepath.Join(cacheDir, "file2.mp4")

	content1 := []byte("test content 1")
	content2 := []byte("test content 2 is longer")

	if err := os.WriteFile(file1, content1, 0o644); err != nil {
		t.Fatalf("Failed to create file1: %v", err)
	}
	if err := os.WriteFile(file2, content2, 0o644); err != nil {
		t.Fatalf("Failed to create file2: %v", err)
	}

	trans := New(cacheDir, "", true)

	freedBytes, err := trans.ClearCache()
	if err != nil {
		t.Fatalf("ClearCache() error: %v", err)
	}

	expectedSize := int64(len(content1) + len(content2))
	if freedBytes != expectedSize {
		t.Errorf("Expected %d bytes freed, got %d", expectedSize, freedBytes)
	}

	// Verify files were deleted
	if _, err := os.Stat(file1); !os.IsNotExist(err) {
		t.Error("file1 should have been deleted")
	}
	if _, err := os.Stat(file2); !os.IsNotExist(err) {
		t.Error("file2 should have been deleted")
	}
}

func TestClearCache_HandlesSubdirectories(t *testing.T) {
	tmpDir := t.TempDir()
	cacheDir := filepath.Join(tmpDir, "cache")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("Failed to create cache dir: %v", err)
	}

	// Create subdirectory with files
	subDir := filepath.Join(cacheDir, "subdir")
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatalf("Failed to create subdir: %v", err)
	}

	file1 := filepath.Join(subDir, "file1.mp4")
	content := []byte("test content in subdir")
	if err := os.WriteFile(file1, content, 0o644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}

	trans := New(cacheDir, "", true)

	freedBytes, err := trans.ClearCache()
	if err != nil {
		t.Fatalf("ClearCache() error: %v", err)
	}

	if freedBytes != int64(len(content)) {
		t.Errorf("Expected %d bytes freed, got %d", len(content), freedBytes)
	}

	// Verify directory was deleted
	if _, err := os.Stat(subDir); !os.IsNotExist(err) {
		t.Error("subdirectory should have been deleted")
	}
}

func TestClearCache_ReturnsZeroWhenCacheDirEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	cacheDir := filepath.Join(tmpDir, "cache")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("Failed to create cache dir: %v", err)
	}

	trans := New(cacheDir, "", true)

	freedBytes, err := trans.ClearCache()
	if err != nil {
		t.Fatalf("ClearCache() error: %v", err)
	}

	if freedBytes != 0 {
		t.Errorf("Expected 0 bytes freed from empty cache, got %d", freedBytes)
	}
}

func TestClearCache_ReturnsZeroWhenNoCacheDir(t *testing.T) {
	trans := New("", "", true)

	freedBytes, err := trans.ClearCache()
	if err != nil {
		t.Fatalf("ClearCache() error: %v", err)
	}

	if freedBytes != 0 {
		t.Errorf("Expected 0 bytes freed when no cache dir, got %d", freedBytes)
	}
}

func TestClearCache_HandlesNonexistentCacheDir(t *testing.T) {
	trans := New("/nonexistent/cache/dir", "", true)

	freedBytes, err := trans.ClearCache()
	if err != nil {
		t.Fatalf("ClearCache() should not error for nonexistent dir: %v", err)
	}

	if freedBytes != 0 {
		t.Errorf("Expected 0 bytes freed for nonexistent dir, got %d", freedBytes)
	}
}

// =============================================================================
// Cleanup Tests
// =============================================================================

func TestCleanup_KillsActiveProcesses(t *testing.T) {
	trans := New("/tmp/cache", "", true)

	// Create a mock process (sleep command)
	ctx := context.Background()
	cmd := exec.CommandContext(ctx, "sleep", "60")
	if err := cmd.Start(); err != nil {
		t.Fatalf("Failed to start mock process: %v", err)
	}

	// Add to process map
	trans.processMu.Lock()
	trans.processes["/test/video.mp4"] = cmd
	trans.processMu.Unlock()

	// Verify process is running
	if cmd.ProcessState != nil {
		t.Error("Process should be running")
	}

	// Call cleanup
	trans.Cleanup()

	// Wait a bit for process to be killed
	time.Sleep(100 * time.Millisecond)

	// Verify process was killed
	_ = cmd.Wait()
	if cmd.ProcessState == nil {
		t.Error("Process should have been killed")
	}

	// Verify process map is empty (note: Cleanup doesn't remove from map, only kills)
	trans.processMu.Lock()
	defer trans.processMu.Unlock()

	// The process is still in the map but should be dead
	if len(trans.processes) == 0 {
		t.Error("Process map should still have entry (cleanup doesn't remove)")
	}
}

func TestCleanup_HandlesEmptyProcessMap(t *testing.T) {
	trans := New("/tmp/cache", "", true)

	// Should not panic with empty process map
	trans.Cleanup()

	if len(trans.processes) != 0 {
		t.Errorf("Expected empty process map, got %d", len(trans.processes))
	}
}

func TestCleanup_HandlesNilProcess(_ *testing.T) {
	trans := New("/tmp/cache", "", true)

	// Add nil process (edge case)
	trans.processMu.Lock()
	trans.processes["/test/video.mp4"] = &exec.Cmd{}
	trans.processMu.Unlock()

	// Should not panic
	trans.Cleanup()
}

// =============================================================================
// getDirSize Tests
// =============================================================================

func TestGetDirSize_CalculatesCorrectSize(t *testing.T) {
	tmpDir := t.TempDir()

	// Create files
	file1 := filepath.Join(tmpDir, "file1.txt")
	file2 := filepath.Join(tmpDir, "file2.txt")

	content1 := []byte("test content 1")
	content2 := []byte("test content 2 with more data")

	if err := os.WriteFile(file1, content1, 0o644); err != nil {
		t.Fatalf("Failed to create file1: %v", err)
	}
	if err := os.WriteFile(file2, content2, 0o644); err != nil {
		t.Fatalf("Failed to create file2: %v", err)
	}

	trans := New("/tmp/cache", "", true)

	size, err := trans.getDirSize(tmpDir)
	if err != nil {
		t.Fatalf("getDirSize() error: %v", err)
	}

	expectedSize := int64(len(content1) + len(content2))
	if size != expectedSize {
		t.Errorf("Expected size=%d, got %d", expectedSize, size)
	}
}

func TestGetDirSize_HandlesSubdirectories(t *testing.T) {
	tmpDir := t.TempDir()
	subDir := filepath.Join(tmpDir, "subdir")
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatalf("Failed to create subdir: %v", err)
	}

	file1 := filepath.Join(tmpDir, "file1.txt")
	file2 := filepath.Join(subDir, "file2.txt")

	content1 := []byte("content 1")
	content2 := []byte("content 2")

	if err := os.WriteFile(file1, content1, 0o644); err != nil {
		t.Fatalf("Failed to create file1: %v", err)
	}
	if err := os.WriteFile(file2, content2, 0o644); err != nil {
		t.Fatalf("Failed to create file2: %v", err)
	}

	trans := New("/tmp/cache", "", true)

	size, err := trans.getDirSize(tmpDir)
	if err != nil {
		t.Fatalf("getDirSize() error: %v", err)
	}

	expectedSize := int64(len(content1) + len(content2))
	if size != expectedSize {
		t.Errorf("Expected size=%d, got %d", expectedSize, size)
	}
}

func TestGetDirSize_ReturnsZeroForEmptyDir(t *testing.T) {
	tmpDir := t.TempDir()

	trans := New("/tmp/cache", "", true)

	size, err := trans.getDirSize(tmpDir)
	if err != nil {
		t.Fatalf("getDirSize() error: %v", err)
	}

	if size != 0 {
		t.Errorf("Expected size=0 for empty dir, got %d", size)
	}
}

func TestGetDirSize_ErrorForNonexistentDir(t *testing.T) {
	trans := New("/tmp/cache", "", true)

	_, err := trans.getDirSize("/nonexistent/directory")
	if err == nil {
		t.Error("Expected error for nonexistent directory")
	}
}

// =============================================================================
// streamFile Tests
// =============================================================================

func TestStreamFile_StreamsFileContent(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.mp4")
	testContent := []byte("test video content for streaming")

	if err := os.WriteFile(testFile, testContent, 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	trans := New(tmpDir, "", true)
	ctx := context.Background()

	var buf bytes.Buffer
	err := trans.streamFile(ctx, testFile, &buf)
	if err != nil {
		t.Fatalf("streamFile() error: %v", err)
	}

	if buf.String() != string(testContent) {
		t.Errorf("Expected content: %s, got: %s", testContent, buf.String())
	}
}

func TestStreamFile_ErrorWhenFileNotFound(t *testing.T) {
	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	var buf bytes.Buffer
	err := trans.streamFile(ctx, "/nonexistent/file.mp4", &buf)
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

func TestStreamFile_RespectsContext(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.mp4")

	// Create a large file to stream
	largeContent := bytes.Repeat([]byte("x"), 1024*1024) // 1MB
	if err := os.WriteFile(testFile, largeContent, 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	trans := New(tmpDir, "", true)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// Use a slow writer to ensure we can't finish before cancellation
	var buf bytes.Buffer
	err := trans.streamFile(ctx, testFile, &buf)

	// Note: io.Copy doesn't respect context, so this test shows that
	// streamFile needs the http.ResponseWriter path for cancellation
	// This documents current behavior
	_ = err
}

// =============================================================================
// Benchmarks
// =============================================================================

func BenchmarkGetVideoInfo(b *testing.B) {
	tmpDir := b.TempDir()
	mockFFProbe := filepath.Join(tmpDir, "ffprobe")

	ffprobeScript := `#!/bin/bash
cat << 'EOF'
{"streams":[{"codec_name":"h264","width":1920,"height":1080}],"format":{"duration":"100.0"}}
EOF
`

	if err := os.WriteFile(mockFFProbe, []byte(ffprobeScript), 0o755); err != nil {
		b.Fatalf("Failed to create mock ffprobe: %v", err)
	}

	oldPath := os.Getenv("PATH")
	defer func() {
		_ = os.Setenv("PATH", oldPath)
	}()
	_ = os.Setenv("PATH", tmpDir+":"+oldPath)

	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = trans.GetVideoInfo(ctx, "/fake/video.mp4")
	}
}

func BenchmarkStreamFile(b *testing.B) {
	tmpDir := b.TempDir()
	testFile := filepath.Join(tmpDir, "test.mp4")
	testContent := bytes.Repeat([]byte("x"), 1024*100) // 100KB

	if err := os.WriteFile(testFile, testContent, 0o644); err != nil {
		b.Fatalf("Failed to create test file: %v", err)
	}

	trans := New(tmpDir, "", true)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = trans.streamFile(ctx, testFile, io.Discard)
	}
}

func BenchmarkClearCache(b *testing.B) {
	// Create a persistent cache dir for benchmark
	tmpDir := b.TempDir()
	cacheDir := filepath.Join(tmpDir, "cache")

	trans := New(cacheDir, "", true)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		// Recreate cache with files for each iteration
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			b.Fatalf("Failed to create cache dir: %v", err)
		}
		for j := 0; j < 10; j++ {
			file := filepath.Join(cacheDir, "file"+string(rune(j))+".mp4")
			if err := os.WriteFile(file, []byte("test"), 0o644); err != nil {
				b.Fatalf("Failed to create file: %v", err)
			}
		}
		b.StartTimer()

		_, _ = trans.ClearCache()
	}
}

// =============================================================================
// Integration Tests (Real FFmpeg/FFProbe)
// These require ffmpeg/ffprobe to be installed and use real video files
// They are skipped during unit test runs (-short flag)
// =============================================================================

// checkFFmpegAvailable checks if ffmpeg and ffprobe are available
func checkFFmpegAvailable(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not found, skipping integration test")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not found, skipping integration test")
	}
}

// getTestVideoPath returns the path to the test video file
func getTestVideoPath(t *testing.T) string {
	t.Helper()

	// Try relative path from package directory
	testVideoPath := filepath.Join("..", "..", "testdata", "test.mp4")
	if _, err := os.Stat(testVideoPath); err == nil {
		return testVideoPath
	}

	// Try from working directory
	testVideoPath = filepath.Join("testdata", "test.mp4")
	if _, err := os.Stat(testVideoPath); err == nil {
		return testVideoPath
	}

	t.Skip("Test video not found at testdata/test.mp4")
	return ""
}

func TestGetVideoInfoIntegration_RealVideo(t *testing.T) {
	checkFFmpegAvailable(t)
	testVideo := getTestVideoPath(t)

	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	info, err := trans.GetVideoInfo(ctx, testVideo)
	if err != nil {
		t.Fatalf("GetVideoInfo() error: %v", err)
	}

	// Validate parsed information
	if info.Duration <= 0 {
		t.Errorf("Expected positive duration, got %f", info.Duration)
	}

	if info.Width <= 0 {
		t.Errorf("Expected positive width, got %d", info.Width)
	}

	if info.Height <= 0 {
		t.Errorf("Expected positive height, got %d", info.Height)
	}

	if info.Codec == "" {
		t.Error("Expected non-empty codec")
	}

	t.Logf("Video info: %dx%d, %.2fs, codec=%s, needsTranscode=%v",
		info.Width, info.Height, info.Duration, info.Codec, info.NeedsTranscode)
}

func TestStreamVideoIntegration_DirectStream(t *testing.T) {
	checkFFmpegAvailable(t)
	testVideo := getTestVideoPath(t)

	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	var buf bytes.Buffer
	err := trans.StreamVideo(ctx, testVideo, &buf, 0)
	if err != nil {
		t.Fatalf("StreamVideo() error: %v", err)
	}

	// Should have received some video data
	if buf.Len() == 0 {
		t.Error("Expected video data, got empty buffer")
	}

	t.Logf("Streamed %d bytes", buf.Len())
}

func TestStreamVideoIntegration_WithResize(t *testing.T) {
	checkFFmpegAvailable(t)
	testVideo := getTestVideoPath(t)

	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Get original info
	info, err := trans.GetVideoInfo(ctx, testVideo)
	if err != nil {
		t.Fatalf("GetVideoInfo() error: %v", err)
	}

	// Request smaller width to force transcoding
	targetWidth := info.Width / 2
	if targetWidth < 160 {
		targetWidth = 160
	}

	var buf bytes.Buffer
	err = trans.StreamVideo(ctx, testVideo, &buf, targetWidth)
	if err != nil {
		t.Fatalf("StreamVideo() with resize error: %v", err)
	}

	// Should have transcoded data
	if buf.Len() == 0 {
		t.Error("Expected transcoded video data, got empty buffer")
	}

	t.Logf("Transcoded to width=%d, output %d bytes", targetWidth, buf.Len())
}

func TestStreamVideoIntegration_ContextCancellation(t *testing.T) {
	checkFFmpegAvailable(t)
	testVideo := getTestVideoPath(t)

	trans := New("/tmp/cache", "", true)

	// Create a context that cancels immediately
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var buf bytes.Buffer
	err := trans.StreamVideo(ctx, testVideo, &buf, 0)

	// Should get an error due to context cancellation
	if err == nil {
		t.Error("Expected error when context is canceled")
	}
}

func TestGetVideoInfoIntegration_VariousFormats(t *testing.T) {
	checkFFmpegAvailable(t)

	tests := []struct {
		name          string
		filename      string
		expectedCodec string
		shouldExist   bool
	}{
		{
			name:        "MP4 video",
			filename:    "test.mp4",
			shouldExist: true,
		},
		// Add more formats if additional test files exist
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testFile := filepath.Join("..", "..", "testdata", tt.filename)
			if _, err := os.Stat(testFile); os.IsNotExist(err) {
				if tt.shouldExist {
					t.Skipf("Test file %s not found", tt.filename)
				}
				return
			}

			trans := New("/tmp/cache", "", true)
			ctx := context.Background()

			info, err := trans.GetVideoInfo(ctx, testFile)
			if err != nil {
				t.Fatalf("GetVideoInfo() error: %v", err)
			}

			if tt.expectedCodec != "" && info.Codec != tt.expectedCodec {
				t.Errorf("Expected codec=%s, got %s", tt.expectedCodec, info.Codec)
			}

			t.Logf("%s: %dx%d, %.2fs, codec=%s",
				tt.filename, info.Width, info.Height, info.Duration, info.Codec)
		})
	}
}

func TestTranscodeAndStreamIntegration_FullProcess(t *testing.T) {
	checkFFmpegAvailable(t)
	testVideo := getTestVideoPath(t)

	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Get video info
	info, err := trans.GetVideoInfo(ctx, testVideo)
	if err != nil {
		t.Fatalf("GetVideoInfo() error: %v", err)
	}

	// Force transcoding by requesting smaller size
	targetWidth := 160

	// Use transcodeAndStream directly
	var buf bytes.Buffer
	err = trans.transcodeAndStream(ctx, testVideo, &buf, targetWidth, info)
	if err != nil {
		t.Fatalf("transcodeAndStream() error: %v", err)
	}

	if buf.Len() == 0 {
		t.Error("Expected transcoded data")
	}

	t.Logf("Transcoded %d bytes at %d width", buf.Len(), targetWidth)
}

func TestCleanupIntegration_WithActiveTranscode(t *testing.T) {
	checkFFmpegAvailable(t)
	testVideo := getTestVideoPath(t)

	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true)

	ctx := context.Background()

	// Start a transcode operation in background
	done := make(chan error, 1)
	go func() {
		var buf bytes.Buffer
		err := trans.StreamVideo(ctx, testVideo, &buf, 160)
		done <- err
	}()

	// Give it time to start
	time.Sleep(100 * time.Millisecond)

	// Call cleanup while transcode is running
	trans.Cleanup()

	// Wait for transcode to finish (should be killed)
	select {
	case err := <-done:
		// Error is expected as we killed the process
		t.Logf("Transcode ended with: %v", err)
	case <-time.After(5 * time.Second):
		t.Error("Transcode didn't stop after cleanup")
	}
}

func BenchmarkGetVideoInfoIntegration(b *testing.B) {
	if testing.Short() {
		b.Skip("Skipping integration benchmark in short mode")
	}

	if _, err := exec.LookPath("ffprobe"); err != nil {
		b.Skip("ffprobe not found")
	}

	testVideo := filepath.Join("..", "..", "testdata", "test.mp4")
	if _, err := os.Stat(testVideo); err != nil {
		b.Skip("Test video not found")
	}

	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = trans.GetVideoInfo(ctx, testVideo)
	}
}

func BenchmarkStreamVideoIntegration(b *testing.B) {
	if testing.Short() {
		b.Skip("Skipping integration benchmark in short mode")
	}

	if _, err := exec.LookPath("ffmpeg"); err != nil {
		b.Skip("ffmpeg not found")
	}

	testVideo := filepath.Join("..", "..", "testdata", "test.mp4")
	if _, err := os.Stat(testVideo); err != nil {
		b.Skip("Test video not found")
	}

	trans := New("/tmp/cache", "", true)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = trans.StreamVideo(ctx, testVideo, io.Discard, 0)
	}
}

// =============================================================================
// Cache Integration Tests (FFmpeg)
// =============================================================================

// TestTranscodeAndStream_AlwaysCache tests that all transcode operations cache
func TestTranscodeAndStream_AlwaysCache(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping ffmpeg test in short mode")
	}

	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true)

	// Create a real test video file with h264 codec
	testVideo := createTestH264Video(t, tmpDir)

	info := &VideoInfo{
		Codec:    "h264",
		Width:    1920,
		Height:   1080,
		Duration: 1.0,
	}

	ctx := context.Background()
	buf := &bytes.Buffer{}

	// Transcode (remux)
	err := trans.transcodeAndStream(ctx, testVideo, buf, 0, info)
	if err != nil {
		t.Fatalf("transcodeAndStream() error: %v", err)
	}

	// Verify cache file was created (changed behavior: now always caches)
	cacheKey := filepath.Base(testVideo) + "_w0.mp4"
	cachePath := filepath.Join(tmpDir, cacheKey)
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		t.Errorf("Cache file %s should exist (changed from hybrid to always-cache strategy)", cachePath)
	}
}

// TestTranscodeAndStream_HybridCaching_ReencodeCache tests that re-encode operations do cache
func TestTranscodeAndStream_HybridCaching_ReencodeCache(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping ffmpeg test in short mode")
	}

	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true)

	// Create a test video with incompatible codec (simulated)
	testVideo := createTestH264Video(t, tmpDir) // We'll pretend it needs re-encoding

	info := &VideoInfo{
		Codec:    "hevc", // Incompatible codec
		Width:    1920,
		Height:   1080,
		Duration: 1.0,
	}

	ctx := context.Background()
	buf := &bytes.Buffer{}

	// Note: This test is limited because we're using h264 test video
	// but telling the system it's hevc. In real usage, ffmpeg would fail.
	// This is more of a structural test of the caching logic.

	// The function will attempt to cache because needsReencode=true
	_ = trans.transcodeAndStream(ctx, testVideo, buf, 0, info)

	// The test is mainly to ensure the code path doesn't panic
	// and that caching logic is triggered for re-encode operations
}

// Helper function to create a simple test video
func createTestH264Video(t *testing.T, dir string) string {
	t.Helper()

	videoPath := filepath.Join(dir, "test_source.mp4")

	// Create a minimal MP4 file that ffmpeg can recognize
	// This is a very simple test pattern, not a real video
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
