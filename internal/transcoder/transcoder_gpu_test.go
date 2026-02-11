package transcoder

import (
	"strings"
	"testing"
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
