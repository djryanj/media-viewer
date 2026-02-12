package transcoder

import (
	"context"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
)

// =============================================================================
// GPU Detection Tests
// =============================================================================

func TestNew_WithGPUAccel(t *testing.T) {
	tests := []struct {
		name                 string
		gpuAccel             string
		expectDetection      bool
		expectAvailableOrAny bool // true if we expect GPU to be available OR to have been attempted
	}{
		{"Auto mode", "auto", true, true},
		{"NVIDIA mode", "nvidia", true, true},
		{"VA-API mode", "vaapi", true, true},
		{"VideoToolbox mode", "videotoolbox", true, false}, // May not be available on this system
		{"None mode", "none", false, false},
		{"Empty string", "", true, false}, // Will detect but fail with "unknown mode"
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trans := New("/tmp/cache", "", true, tt.gpuAccel)

			if trans == nil {
				t.Fatal("New() returned nil")
			}

			// For "auto" mode, gpuAccel should change to the detected type
			if tt.gpuAccel == "auto" {
				// After detection, it should be one of the specific types or remain unset
				if trans.gpuDetectionDone {
					// If GPU was found, gpuAccel should be nvidia/vaapi/videotoolbox
					if trans.gpuAvailable {
						validTypes := []GPUAccel{GPUAccelNVIDIA, GPUAccelVAAPI, GPUAccelVideoToolbox}
						found := false
						for _, vt := range validTypes {
							if trans.gpuAccel == vt {
								found = true
								break
							}
						}
						if !found {
							t.Errorf("Expected gpuAccel to be one of nvidia/vaapi/videotoolbox when available, got %v", trans.gpuAccel)
						}
					}
				}
			} else if tt.gpuAccel == "none" {
				// For "none", gpuAccel should stay as "none"
				if trans.gpuAccel != GPUAccelNone {
					t.Errorf("Expected gpuAccel=none, got %v", trans.gpuAccel)
				}
			}

			// Check if GPU detection was performed
			if tt.expectDetection {
				if !trans.gpuDetectionDone {
					t.Errorf("Expected GPU detection to be done for mode=%s", tt.gpuAccel)
				}
			}
		})
	}
}

func TestDetectGPU_NoneMode(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// When mode is "none", GPU detection is skipped entirely
	// So gpuDetectionDone will be false since detectGPU() is never called
	if trans.gpuAvailable {
		t.Error("Expected GPU not available when mode is 'none'")
	}

	if trans.gpuEncoder != "" {
		t.Errorf("Expected no GPU encoder, got %s", trans.gpuEncoder)
	}

	// Detection is not performed for "none" mode, so this flag stays false
	if trans.gpuDetectionDone {
		t.Error("Expected GPU detection to NOT be performed when mode is 'none'")
	}
}

func TestDetectGPU_AutoMode(t *testing.T) {
	trans := New("/tmp/cache", "", true, "auto")

	// GPU detection should have run
	if !trans.gpuDetectionDone {
		t.Error("Expected GPU detection to be marked as done")
	}

	// Whether GPU is available depends on system, but detection should not panic
	// If GPU is available, encoder should be set
	if trans.gpuAvailable {
		if trans.gpuEncoder == "" {
			t.Error("GPU marked as available but no encoder set")
		}

		// Should be one of the recognized encoders
		validEncoders := []string{"h264_nvenc", "h264_vaapi", "h264_videotoolbox"}
		found := false
		for _, enc := range validEncoders {
			if trans.gpuEncoder == enc {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Unexpected GPU encoder: %s", trans.gpuEncoder)
		}
	}
}

// =============================================================================
// GPU Encoder Arguments Tests
// =============================================================================

func TestAddCPUEncoderArgs(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	info := &VideoInfo{
		Codec:  "hevc",
		Width:  1920,
		Height: 1080,
	}

	tests := []struct {
		name         string
		targetWidth  int
		needsScaling bool
		wantEncoder  string
		wantScale    string
	}{
		{
			name:         "No scaling needed",
			targetWidth:  0,
			needsScaling: false,
			wantEncoder:  "libx264",
			wantScale:    "scale=1920:1080",
		},
		{
			name:         "With scaling",
			targetWidth:  1280,
			needsScaling: true,
			wantEncoder:  "libx264",
			wantScale:    "scale=1280:-2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args := []string{}
			args = trans.addCPUEncoderArgs(args, tt.targetWidth, info, tt.needsScaling)

			// Check encoder
			foundEncoder := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-c:v" && args[i+1] == tt.wantEncoder {
					foundEncoder = true
					break
				}
			}
			if !foundEncoder {
				t.Errorf("Expected encoder %s in args, got: %v", tt.wantEncoder, args)
			}

			// Check preset
			foundPreset := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-preset" && args[i+1] == "fast" {
					foundPreset = true
					break
				}
			}
			if !foundPreset {
				t.Error("Expected -preset fast in args")
			}

			// Check CRF
			foundCRF := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-crf" && args[i+1] == "23" {
					foundCRF = true
					break
				}
			}
			if !foundCRF {
				t.Error("Expected -crf 23 in args")
			}

			// Check scale filter
			foundScale := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-vf" && args[i+1] == tt.wantScale {
					foundScale = true
					break
				}
			}
			if !foundScale {
				t.Errorf("Expected scale filter %s in args, got: %v", tt.wantScale, args)
			}
		})
	}
}

func TestAddGPUEncoderArgs_NVIDIA(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")
	// Simulate NVIDIA GPU available
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_nvenc"
	trans.gpuAccel = GPUAccelNVIDIA
	trans.gpuInitFilter = ""

	info := &VideoInfo{
		Codec:  "hevc",
		Width:  1920,
		Height: 1080,
	}

	tests := []struct {
		name         string
		targetWidth  int
		needsScaling bool
		wantScale    string
	}{
		{
			name:         "No scaling",
			targetWidth:  0,
			needsScaling: false,
			wantScale:    "scale=1920:1080",
		},
		{
			name:         "With scaling",
			targetWidth:  1280,
			needsScaling: true,
			wantScale:    "scale=1280:-2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args := []string{}
			args = trans.addGPUEncoderArgs(args, tt.targetWidth, info, tt.needsScaling)

			// Check encoder
			foundEncoder := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-c:v" && args[i+1] == "h264_nvenc" {
					foundEncoder = true
					break
				}
			}
			if !foundEncoder {
				t.Errorf("Expected h264_nvenc encoder in args, got: %v", args)
			}

			// Check NVIDIA preset
			foundPreset := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-preset" && args[i+1] == "p4" {
					foundPreset = true
					break
				}
			}
			if !foundPreset {
				t.Error("Expected -preset p4 for NVIDIA")
			}

			// Check CQ
			foundCQ := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-cq" && args[i+1] == "23" {
					foundCQ = true
					break
				}
			}
			if !foundCQ {
				t.Error("Expected -cq 23 for NVIDIA")
			}

			// Check scale filter
			foundScale := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-vf" && strings.Contains(args[i+1], tt.wantScale) {
					foundScale = true
					break
				}
			}
			if !foundScale {
				t.Errorf("Expected scale filter containing %s in args", tt.wantScale)
			}
		})
	}
}

func TestAddGPUEncoderArgs_VAAPI(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")
	// Simulate VA-API GPU available
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_vaapi"
	trans.gpuAccel = GPUAccelVAAPI
	trans.gpuInitFilter = "format=nv12,hwupload"

	info := &VideoInfo{
		Codec:  "hevc",
		Width:  1920,
		Height: 1080,
	}

	args := []string{}
	args = trans.addGPUEncoderArgs(args, 1280, info, true)

	// Check encoder
	foundEncoder := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "h264_vaapi" {
			foundEncoder = true
			break
		}
	}
	if !foundEncoder {
		t.Errorf("Expected h264_vaapi encoder in args, got: %v", args)
	}

	// Check VA-API init filter is in the filter chain
	foundInit := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-vf" && strings.Contains(args[i+1], "format=nv12,hwupload") {
			foundInit = true
			break
		}
	}
	if !foundInit {
		t.Error("Expected VA-API init filter in args")
	}

	// Check VA-API scale filter
	foundScale := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-vf" && strings.Contains(args[i+1], "scale_vaapi") {
			foundScale = true
			break
		}
	}
	if !foundScale {
		t.Error("Expected scale_vaapi in filter chain")
	}

	// Check QP for VA-API
	foundQP := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-qp" && args[i+1] == "23" {
			foundQP = true
			break
		}
	}
	if !foundQP {
		t.Error("Expected -qp 23 for VA-API")
	}
}

func TestAddGPUEncoderArgs_VideoToolbox(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")
	// Simulate VideoToolbox GPU available
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_videotoolbox"
	trans.gpuAccel = GPUAccelVideoToolbox
	trans.gpuInitFilter = ""

	info := &VideoInfo{
		Codec:  "hevc",
		Width:  1920,
		Height: 1080,
	}

	args := []string{}
	args = trans.addGPUEncoderArgs(args, 0, info, false)

	// Check encoder
	foundEncoder := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "h264_videotoolbox" {
			foundEncoder = true
			break
		}
	}
	if !foundEncoder {
		t.Errorf("Expected h264_videotoolbox encoder in args, got: %v", args)
	}

	// Check bitrate for VideoToolbox
	foundBitrate := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-b:v" && args[i+1] == "2M" {
			foundBitrate = true
			break
		}
	}
	if !foundBitrate {
		t.Error("Expected -b:v 2M for VideoToolbox")
	}
}

// =============================================================================
// BuildFFmpegArgs Integration with GPU Tests
// =============================================================================

func TestBuildFFmpegArgs_WithGPU(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")
	// Simulate GPU available
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_nvenc"
	trans.gpuAccel = GPUAccelNVIDIA
	trans.gpuInitFilter = ""

	info := &VideoInfo{
		Codec:  "hevc", // Needs re-encode
		Width:  1920,
		Height: 1080,
	}

	args := trans.buildFFmpegArgs("/test/input.mkv", "/test/output.mp4", 0, info, true)

	// Should use GPU encoder
	foundGPUEncoder := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "h264_nvenc" {
			foundGPUEncoder = true
			break
		}
	}
	if !foundGPUEncoder {
		t.Error("Expected GPU encoder h264_nvenc when GPU is available")
	}

	// Should NOT use CPU encoder
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "libx264" {
			t.Error("Did not expect CPU encoder libx264 when GPU is available")
		}
	}
}

func TestBuildFFmpegArgs_GPUNotAvailable(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")
	// GPU explicitly not available
	trans.gpuAvailable = false
	trans.gpuEncoder = ""

	info := &VideoInfo{
		Codec:  "hevc", // Needs re-encode
		Width:  1920,
		Height: 1080,
	}

	args := trans.buildFFmpegArgs("/test/input.mkv", "/test/output.mp4", 0, info, true)

	// Should use CPU encoder as fallback
	foundCPUEncoder := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "libx264" {
			foundCPUEncoder = true
			break
		}
	}
	if !foundCPUEncoder {
		t.Error("Expected CPU encoder libx264 when GPU is not available")
	}
}

func TestBuildFFmpegArgs_Copy_NoGPU(t *testing.T) {
	trans := New("/tmp/cache", "", true, "nvidia")
	// Simulate GPU available
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_nvenc"

	info := &VideoInfo{
		Codec:  "h264", // Compatible, no re-encode needed
		Width:  1920,
		Height: 1080,
	}

	args := trans.buildFFmpegArgs("/test/input.mp4", "/test/output.mp4", 0, info, false)

	// Should use copy (no encoding at all)
	foundCopy := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "copy" {
			foundCopy = true
			break
		}
	}
	if !foundCopy {
		t.Error("Expected -c:v copy when codec is compatible and no scaling needed")
	}

	// Should NOT use any encoder (GPU or CPU)
	for i := 0; i < len(args); i++ {
		if args[i] == "h264_nvenc" || args[i] == "libx264" {
			t.Errorf("Did not expect encoder in copy mode, found: %s", args[i])
		}
	}
}

// =============================================================================
// GPU Type Constants Tests
// =============================================================================

func TestGPUAccelConstants(t *testing.T) {
	tests := []struct {
		name  string
		value GPUAccel
		want  string
	}{
		{"None", GPUAccelNone, "none"},
		{"Auto", GPUAccelAuto, "auto"},
		{"NVIDIA", GPUAccelNVIDIA, "nvidia"},
		{"VA-API", GPUAccelVAAPI, "vaapi"},
		{"VideoToolbox", GPUAccelVideoToolbox, "videotoolbox"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.value) != tt.want {
				t.Errorf("Expected GPUAccel value %s, got %s", tt.want, string(tt.value))
			}
		})
	}
}

// =============================================================================
// isGPUError Tests
// =============================================================================

func TestIsGPUError_NVIDIAErrors(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	tests := []struct {
		name     string
		stderr   string
		expected bool
	}{
		{"NVIDIA libcuda error", "Cannot load libcuda.so.1", true},
		{"NVIDIA no devices", "No NVENC capable devices found", true},
		{"NVIDIA unavailable", "NVENC not available", true},
		{"Generic CUDA error", "CUDA initialization failed", true},
		{"Non-GPU error", "File not found", false},
		{"Empty string", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := trans.isGPUError(tt.stderr)
			if result != tt.expected {
				t.Errorf("isGPUError(%q) = %v, want %v", tt.stderr, result, tt.expected)
			}
		})
	}
}

func TestIsGPUError_VAAPIErrors(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	tests := []struct {
		name     string
		stderr   string
		expected bool
	}{
		{"VA-API libva error", "libva error: failed to initialize", true},
		{"VA-API no display", "No VA display found", true},
		{"VA-API init failure", "Failed to initialize VAAPI", true},
		{"DRI device error", "Cannot open /dev/dri/renderD128", true},
		{"Generic hardware error", "Hardware device initialization failed", true},
		{"Non-GPU error", "Invalid parameters", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := trans.isGPUError(tt.stderr)
			if result != tt.expected {
				t.Errorf("isGPUError(%q) = %v, want %v", tt.stderr, result, tt.expected)
			}
		})
	}
}

func TestIsGPUError_VideoToolboxErrors(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	tests := []struct {
		name     string
		stderr   string
		expected bool
	}{
		{"VideoToolbox error", "VideoToolbox encoding failed", true},
		{"CoreMedia error", "CoreMedia: encoder not found", true},
		{"VT session error", "VT Session error", true},
		{"Non-GPU error", "Network timeout", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := trans.isGPUError(tt.stderr)
			if result != tt.expected {
				t.Errorf("isGPUError(%q) = %v, want %v", tt.stderr, result, tt.expected)
			}
		})
	}
}

func TestIsGPUError_CaseInsensitive(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Test that error detection is case-insensitive
	tests := []struct {
		name   string
		stderr string
	}{
		{"Lowercase", "cannot load libcuda"},
		{"Uppercase", "CANNOT LOAD LIBCUDA"},
		{"Mixed case", "Cannot Load LibCUDA"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !trans.isGPUError(tt.stderr) {
				t.Errorf("Expected isGPUError to be case-insensitive, but failed for: %q", tt.stderr)
			}
		})
	}
}

// =============================================================================
// checkGPUDeviceAccess Tests
// =============================================================================

func TestCheckGPUDeviceAccess_NVIDIA(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Test NVIDIA device check
	result := trans.checkGPUDeviceAccess(GPUAccelNVIDIA)

	// We can't predict if NVIDIA devices exist, but function should not panic
	// Just verify it returns a boolean
	t.Logf("NVIDIA GPU device access check returned: %v", result)
}

func TestCheckGPUDeviceAccess_VAAPI(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Test VA-API device check
	result := trans.checkGPUDeviceAccess(GPUAccelVAAPI)

	// We can't predict if VA-API devices exist, but function should not panic
	t.Logf("VA-API GPU device access check returned: %v", result)
}

func TestCheckGPUDeviceAccess_VideoToolbox(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Test VideoToolbox check
	result := trans.checkGPUDeviceAccess(GPUAccelVideoToolbox)

	// VideoToolbox is only available on macOS
	if runtime.GOOS == "darwin" {
		// Should return true on macOS
		if !result {
			t.Error("Expected VideoToolbox to be available on macOS")
		}
	} else {
		// Should return false on non-macOS
		if result {
			t.Error("Expected VideoToolbox to NOT be available on non-macOS systems")
		}
	}
}

func TestCheckGPUDeviceAccess_None(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Test with "none" type - should return true (no device check needed)
	result := trans.checkGPUDeviceAccess(GPUAccelNone)

	if !result {
		t.Error("Expected checkGPUDeviceAccess to return true for GPUAccelNone")
	}
}

// =============================================================================
// buildFFmpegArgsWithOptions Tests
// =============================================================================

func TestBuildFFmpegArgsWithOptions_ForceCPU(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")
	// Simulate GPU available
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_nvenc"
	trans.gpuAccel = GPUAccelNVIDIA

	info := &VideoInfo{
		Codec:  "hevc", // Needs re-encode
		Width:  1920,
		Height: 1080,
	}

	// Call with forceCPU=true
	args := trans.buildFFmpegArgsWithOptions("/test/input.mkv", "/test/output.mp4", 0, info, true, true)

	// Should use CPU encoder even though GPU is available
	foundCPUEncoder := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "libx264" {
			foundCPUEncoder = true
			break
		}
	}
	if !foundCPUEncoder {
		t.Error("Expected CPU encoder libx264 when forceCPU=true")
	}

	// Should NOT use GPU encoder
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "h264_nvenc" {
			t.Error("Did not expect GPU encoder when forceCPU=true")
		}
	}
}

func TestBuildFFmpegArgsWithOptions_GPUAvailable(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")
	// Simulate GPU available
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_nvenc"
	trans.gpuAccel = GPUAccelNVIDIA

	info := &VideoInfo{
		Codec:  "hevc", // Needs re-encode
		Width:  1920,
		Height: 1080,
	}

	// Call with forceCPU=false (should use GPU)
	args := trans.buildFFmpegArgsWithOptions("/test/input.mkv", "/test/output.mp4", 0, info, true, false)

	// Should use GPU encoder
	foundGPUEncoder := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "h264_nvenc" {
			foundGPUEncoder = true
			break
		}
	}
	if !foundGPUEncoder {
		t.Error("Expected GPU encoder h264_nvenc when forceCPU=false and GPU available")
	}
}

// =============================================================================
// testGPUEncoder Tests
// =============================================================================

func TestTestGPUEncoder_InvalidEncoder(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping ffmpeg test in short mode")
	}

	trans := New("/tmp/cache", "", true, "none")

	// Test with a non-existent encoder
	result := trans.testGPUEncoder("invalid_encoder_xyz", GPUAccelNone, "")

	if result {
		t.Error("Expected testGPUEncoder to return false for invalid encoder")
	}
}

func TestTestGPUEncoder_LibX264(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping ffmpeg test in short mode")
	}

	trans := New("/tmp/cache", "", true, "none")

	// Test with libx264 which should be available in most ffmpeg builds
	// Note: This is a CPU encoder, but we're testing the encoder detection logic
	result := trans.testGPUEncoder("libx264", GPUAccelNone, "")

	// libx264 should be available
	if !result {
		t.Log("libx264 encoder not found in ffmpeg (unexpected but not fatal)")
	}
}

// =============================================================================
// Edge Cases and Error Handling Tests
// =============================================================================

func TestDetectGPU_MultipleCallsIdempotent(t *testing.T) {
	trans := New("/tmp/cache", "", true, "auto")

	// Detection should have run once during New()
	if !trans.gpuDetectionDone {
		t.Error("Expected GPU detection to be done")
	}

	firstAvailable := trans.gpuAvailable
	firstEncoder := trans.gpuEncoder

	// Call detectGPU again - it should be idempotent
	trans.detectGPU()

	if trans.gpuAvailable != firstAvailable {
		t.Error("GPU availability changed after second detection call")
	}
	if trans.gpuEncoder != firstEncoder {
		t.Error("GPU encoder changed after second detection call")
	}
}

func TestBuildFFmpegArgsWithOptions_NoReencode(t *testing.T) {
	trans := New("/tmp/cache", "", true, "nvidia")
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_nvenc"

	info := &VideoInfo{
		Codec:  "h264", // Compatible codec
		Width:  1920,
		Height: 1080,
	}

	// No re-encode needed, should copy regardless of GPU availability
	args := trans.buildFFmpegArgsWithOptions("/test/input.mp4", "/test/output.mp4", 0, info, false, false)

	// Should use copy
	foundCopy := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "copy" {
			foundCopy = true
			break
		}
	}
	if !foundCopy {
		t.Error("Expected -c:v copy when no re-encode needed")
	}
}

func TestGPUAccel_StringConversion(t *testing.T) {
	// Test that GPUAccel types can be converted to strings
	tests := []struct {
		accel GPUAccel
		want  string
	}{
		{GPUAccelNone, "none"},
		{GPUAccelAuto, "auto"},
		{GPUAccelNVIDIA, "nvidia"},
		{GPUAccelVAAPI, "vaapi"},
		{GPUAccelVideoToolbox, "videotoolbox"},
	}

	for _, tt := range tests {
		if string(tt.accel) != tt.want {
			t.Errorf("GPUAccel string conversion: got %s, want %s", string(tt.accel), tt.want)
		}
	}
}

func TestNew_LogDirCreation(t *testing.T) {
	tmpDir := t.TempDir()
	logDir := tmpDir + "/logs"

	// logDir doesn't exist yet
	trans := New(tmpDir+"/cache", logDir, true, "none")

	if trans == nil {
		t.Fatal("New() returned nil")
	}

	// Check that log directory was created
	if _, err := os.Stat(logDir); os.IsNotExist(err) {
		t.Error("Expected log directory to be created")
	}
}

func TestDetectGPU_UnknownMode(t *testing.T) {
	trans := New("/tmp/cache", "", true, "unknown_mode")

	// Should have attempted detection
	if !trans.gpuDetectionDone {
		t.Error("Expected GPU detection to be attempted even with unknown mode")
	}

	// Should not have found GPU with unknown mode
	if trans.gpuAvailable {
		t.Error("Should not have GPU available with unknown mode")
	}
}

// =============================================================================
// Integration Test Helpers
// =============================================================================

func TestTranscodeDirectToCacheWithOptions_Context(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Test that context cancellation is respected
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
	defer cancel()

	info := &VideoInfo{
		Codec:  "hevc",
		Width:  1920,
		Height: 1080,
	}

	// This should fail due to context timeout
	err := trans.transcodeDirectToCacheWithOptions(ctx, "/nonexistent/video.mp4", tmpDir+"/output.mp4", 0, info, true, false)

	if err == nil {
		t.Error("Expected error due to context timeout")
	}
}

// =============================================================================
// GPU State Management Tests
// =============================================================================

func TestGPUDisabledAfterFailure(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Simulate GPU initially available
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_nvenc"
	trans.gpuAccel = GPUAccelNVIDIA

	// Verify GPU is available
	if !trans.gpuAvailable {
		t.Fatal("Expected GPU to be initially available")
	}

	// Simulate GPU error by manually disabling GPU (mimicking what happens on GPU error)
	trans.gpuMu.Lock()
	trans.gpuAvailable = false
	trans.gpuMu.Unlock()

	// Verify GPU is now disabled
	if trans.gpuAvailable {
		t.Error("Expected GPU to be disabled after simulated error")
	}

	// Build args should now use CPU encoder
	info := &VideoInfo{
		Codec:  "hevc",
		Width:  1920,
		Height: 1080,
	}
	args := trans.buildFFmpegArgs("/test/input.mkv", "/test/output.mp4", 0, info, true)

	// Should use CPU encoder since GPU was disabled
	foundCPUEncoder := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:v" && args[i+1] == "libx264" {
			foundCPUEncoder = true
			break
		}
	}
	if !foundCPUEncoder {
		t.Error("Expected CPU encoder after GPU was disabled")
	}
}

func TestBuildFFmpegArgsWithOptions_ScalingLogic(t *testing.T) {
	tests := []struct {
		name           string
		targetWidth    int
		videoWidth     int
		needsScaling   bool
		expectScaleArg bool
		expectedScale  string
		gpuAvailable   bool
		gpuAccel       GPUAccel
	}{
		{
			name:           "No scaling needed - GPU",
			targetWidth:    0,
			videoWidth:     1920,
			needsScaling:   false,
			expectScaleArg: true,
			expectedScale:  "scale=1920:1080",
			gpuAvailable:   true,
			gpuAccel:       GPUAccelNVIDIA,
		},
		{
			name:           "No scaling needed - CPU",
			targetWidth:    0,
			videoWidth:     1920,
			needsScaling:   false,
			expectScaleArg: true,
			expectedScale:  "scale=1920:1080",
			gpuAvailable:   false,
			gpuAccel:       GPUAccelNone,
		},
		{
			name:           "Scaling needed - GPU",
			targetWidth:    1280,
			videoWidth:     1920,
			needsScaling:   true,
			expectScaleArg: true,
			expectedScale:  "scale=1280:-2",
			gpuAvailable:   true,
			gpuAccel:       GPUAccelNVIDIA,
		},
		{
			name:           "Scaling needed - CPU",
			targetWidth:    1280,
			videoWidth:     1920,
			needsScaling:   true,
			expectScaleArg: true,
			expectedScale:  "scale=1280:-2",
			gpuAvailable:   false,
			gpuAccel:       GPUAccelNone,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trans := New("/tmp/cache", "", true, "none")
			trans.gpuAvailable = tt.gpuAvailable
			trans.gpuAccel = tt.gpuAccel
			if tt.gpuAvailable {
				trans.gpuEncoder = "h264_nvenc"
			}

			info := &VideoInfo{
				Codec:  "hevc",
				Width:  tt.videoWidth,
				Height: 1080,
			}

			args := trans.buildFFmpegArgsWithOptions("/test/input.mkv", "/test/output.mp4", tt.targetWidth, info, true, false)

			// Check if scale argument is present
			foundScale := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-vf" {
					if strings.Contains(args[i+1], tt.expectedScale) {
						foundScale = true
						break
					}
				}
			}

			if tt.expectScaleArg && !foundScale {
				t.Errorf("Expected to find scale arg with %q in args, but didn't. Args: %v", tt.expectedScale, args)
			}
		})
	}
}

// =============================================================================
// Error Pattern Matching Tests
// =============================================================================

func TestIsGPUError_MultiplePatterns(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	testCases := []struct {
		name       string
		stderr     string
		shouldFail bool
	}{
		// NVIDIA patterns
		{"NVIDIA basic", "Cannot load libcuda.so.1", true},
		{"NVIDIA no devices", "No NVENC capable devices found", true},
		{"NVIDIA not available", "NVENC not available", true},
		{"NVIDIA init failed", "nvcuda driver initialization failed", true},

		// VA-API patterns
		{"VAAPI libva", "libva: failed to initialize display", true},
		{"VAAPI no device", "/dev/dri: No such device", true},
		{"VAAPI drm", "drm: Cannot open DRM device", true},
		{"VAAPI init", "Failed to initialize VAAPI connection", true},

		// VideoToolbox patterns
		{"VideoToolbox basic", "VideoToolbox encoder failed", true},
		{"VideoToolbox core", "CoreMedia encoder not supported", true},

		// Generic hardware patterns
		{"Hardware generic 1", "Hardware device not available", true},
		{"Hardware generic 2", "Cannot initialize hardware encoder", true},
		{"Hardware generic 3", "Failed loading hardware context", true},

		// Non-GPU errors should not match
		{"File not found", "No such file or directory", false},
		{"Permission denied", "Permission denied", false},
		{"Invalid codec", "Codec not found", false},
		{"Stream error", "Invalid data found when processing input", false},
		{"Network error", "Connection timeout", false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := trans.isGPUError(tc.stderr)
			if result != tc.shouldFail {
				t.Errorf("isGPUError(%q) = %v, want %v", tc.stderr, result, tc.shouldFail)
			}
		})
	}
}

func TestIsGPUError_EmptyAndWhitespace(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	tests := []string{
		"",
		"   ",
		"\n",
		"\t",
		"   \n\t  ",
	}

	for _, input := range tests {
		if trans.isGPUError(input) {
			t.Errorf("isGPUError should return false for empty/whitespace input: %q", input)
		}
	}
}

// =============================================================================
// Concurrent Access Tests
// =============================================================================

func TestGPUStateConcurrency(_ *testing.T) {
	trans := New("/tmp/cache", "", true, "none")
	trans.gpuAvailable = true
	trans.gpuEncoder = "h264_nvenc"

	// Spawn multiple goroutines that check GPU state
	const numGoroutines = 10
	done := make(chan bool, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func() {
			// Read GPU state
			trans.gpuMu.Lock()
			_ = trans.gpuAvailable
			_ = trans.gpuEncoder
			trans.gpuMu.Unlock()
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < numGoroutines; i++ {
		<-done
	}
}

func TestDetectGPU_ConcurrentCalls(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	// Call detectGPU from multiple goroutines (should be idempotent)
	const numGoroutines = 5
	done := make(chan bool, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func() {
			trans.detectGPU()
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < numGoroutines; i++ {
		<-done
	}

	// Verify state is consistent
	if !trans.gpuDetectionDone {
		t.Error("GPU detection should be marked as done")
	}
}

// =============================================================================
// Comprehensive Encoder Arguments Tests
// =============================================================================

func TestAddGPUEncoderArgs_AllGPUTypes(t *testing.T) {
	tests := []struct {
		name          string
		gpuAccel      GPUAccel
		gpuEncoder    string
		gpuInitFilter string
		wantEncoder   string
		wantPreset    string // NVIDIA uses -preset
		wantQP        string // VA-API uses -qp
		wantBitrate   string // VideoToolbox uses -b:v
	}{
		{
			name:          "NVIDIA NVENC",
			gpuAccel:      GPUAccelNVIDIA,
			gpuEncoder:    "h264_nvenc",
			gpuInitFilter: "",
			wantEncoder:   "h264_nvenc",
			wantPreset:    "p4",
			wantQP:        "",
			wantBitrate:   "",
		},
		{
			name:          "Intel/AMD VA-API",
			gpuAccel:      GPUAccelVAAPI,
			gpuEncoder:    "h264_vaapi",
			gpuInitFilter: "format=nv12,hwupload",
			wantEncoder:   "h264_vaapi",
			wantPreset:    "",
			wantQP:        "23",
			wantBitrate:   "",
		},
		{
			name:          "Apple VideoToolbox",
			gpuAccel:      GPUAccelVideoToolbox,
			gpuEncoder:    "h264_videotoolbox",
			gpuInitFilter: "",
			wantEncoder:   "h264_videotoolbox",
			wantPreset:    "",
			wantQP:        "",
			wantBitrate:   "2M",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trans := New("/tmp/cache", "", true, "none")
			trans.gpuAvailable = true
			trans.gpuEncoder = tt.gpuEncoder
			trans.gpuAccel = tt.gpuAccel
			trans.gpuInitFilter = tt.gpuInitFilter

			info := &VideoInfo{
				Codec:  "hevc",
				Width:  1920,
				Height: 1080,
			}

			args := trans.addGPUEncoderArgs([]string{}, 0, info, false)

			// Check encoder
			foundEncoder := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-c:v" && args[i+1] == tt.wantEncoder {
					foundEncoder = true
					break
				}
			}
			if !foundEncoder {
				t.Errorf("Expected encoder %s, args: %v", tt.wantEncoder, args)
			}

			// Check preset (NVIDIA only)
			if tt.wantPreset != "" {
				foundPreset := false
				for i := 0; i < len(args)-1; i++ {
					if args[i] == "-preset" && args[i+1] == tt.wantPreset {
						foundPreset = true
						break
					}
				}
				if !foundPreset {
					t.Errorf("Expected preset %s, args: %v", tt.wantPreset, args)
				}
			}

			// Check QP (VA-API only)
			if tt.wantQP != "" {
				foundQP := false
				for i := 0; i < len(args)-1; i++ {
					if args[i] == "-qp" && args[i+1] == tt.wantQP {
						foundQP = true
						break
					}
				}
				if !foundQP {
					t.Errorf("Expected QP %s, args: %v", tt.wantQP, args)
				}
			}

			// Check bitrate (VideoToolbox only)
			if tt.wantBitrate != "" {
				foundBitrate := false
				for i := 0; i < len(args)-1; i++ {
					if args[i] == "-b:v" && args[i+1] == tt.wantBitrate {
						foundBitrate = true
						break
					}
				}
				if !foundBitrate {
					t.Errorf("Expected bitrate %s, args: %v", tt.wantBitrate, args)
				}
			}
		})
	}
}

func TestBuildFFmpegArgsWithOptions_AudioEncoding(t *testing.T) {
	trans := New("/tmp/cache", "", true, "none")

	info := &VideoInfo{
		Codec:  "hevc",
		Width:  1920,
		Height: 1080,
	}

	args := trans.buildFFmpegArgsWithOptions("/test/input.mkv", "/test/output.mp4", 0, info, true, false)

	// Should include audio encoding to AAC
	foundAudioCodec := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-c:a" && args[i+1] == "aac" {
			foundAudioCodec = true
			break
		}
	}
	if !foundAudioCodec {
		t.Error("Expected audio codec AAC in args")
	}

	// Should include audio bitrate
	foundAudioBitrate := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-b:a" {
			foundAudioBitrate = true
			break
		}
	}
	if !foundAudioBitrate {
		t.Error("Expected audio bitrate in args")
	}
}
