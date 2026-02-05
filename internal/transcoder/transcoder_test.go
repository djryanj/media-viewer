package transcoder

import (
	"context"
	"testing"
	"time"

	"media-viewer/internal/streaming"
)

func TestNew(t *testing.T) {
	trans := New("/tmp/cache", true)

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
			trans := New("/tmp/cache", tt.enabled)

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
	trans := New("/tmp/cache", true)

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
	trans := New("/tmp/cache", true)

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
	trans := New("/tmp/cache", false)

	if trans.IsEnabled() {
		t.Error("Transcoder should be disabled")
	}

	// Verify process map is still initialized when disabled
	if trans.processes == nil {
		t.Error("Process map should be initialized even when disabled")
	}
}

func TestTranscoderProcessMap(t *testing.T) {
	trans := New("/tmp/cache", true)

	if trans.processes == nil {
		t.Fatal("Process map should be initialized")
	}

	if len(trans.processes) != 0 {
		t.Errorf("Expected empty process map, got %d processes", len(trans.processes))
	}
}

func TestGetVideoInfoWithInvalidFile(t *testing.T) {
	trans := New("/tmp/cache", true)

	ctx := context.Background()

	// Try to get info for non-existent file
	_, err := trans.GetVideoInfo(ctx, "/nonexistent/file.mp4")
	if err == nil {
		t.Error("Expected error when getting info for non-existent file")
	}
}

func TestGetVideoInfoContextCancellation(t *testing.T) {
	trans := New("/tmp/cache", true)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := trans.GetVideoInfo(ctx, "/tmp/test.mp4")
	if err == nil {
		t.Error("Expected error when context is canceled")
	}
}

func TestStreamConfigDefaults(t *testing.T) {
	// Test that New() sets up reasonable stream config defaults
	trans := New("/tmp/cache", true)

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
		_ = New("/tmp/cache", true)
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
