package media

import (
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

// NOTE: govips doesn't support stopping and restarting vips in the same process.
// Once vips.Shutdown() is called, vips.Startup() cannot be called again.
// These tests are ordered to handle this limitation - tests that need vips run first,
// shutdown tests run last.

func TestIsVipsAvailable(t *testing.T) {
	// Test that IsVipsAvailable returns a boolean without panicking
	available := IsVipsAvailable()

	// We can't assume vips is available in all test environments
	// Just verify it returns a valid boolean
	t.Logf("libvips available: %v", available)
}

func TestInitVipsIdempotency(t *testing.T) {
	// Check if already initialized from a previous test
	wasAvailable := IsVipsAvailable()

	// Test that InitVips can be called multiple times safely
	err := InitVips()
	if err != nil {
		// It's okay if vips isn't available in test environment
		t.Logf("libvips not available in test environment: %v", err)
		return
	}

	// Call again - should be idempotent
	err = InitVips()
	if err != nil {
		t.Errorf("Second InitVips() call failed: %v", err)
	}

	// Verify it's marked as available
	if !IsVipsAvailable() {
		t.Error("After successful InitVips, IsVipsAvailable should return true")
	}

	// Only log if state changed
	if !wasAvailable && IsVipsAvailable() {
		t.Log("libvips successfully initialized in this test")
	}
}

func TestLoadImageWithVipsIfAvailable(t *testing.T) {
	// Initialize vips if not already initialized
	if !IsVipsAvailable() {
		err := InitVips()
		if err != nil {
			t.Skip("libvips not available in test environment, skipping vips-specific tests")
			return
		}
	}

	tmpDir := t.TempDir()

	tests := []struct {
		name         string
		width        int
		height       int
		targetWidth  int
		targetHeight int
	}{
		{
			name:         "Resize large JPEG",
			width:        2000,
			height:       1500,
			targetWidth:  400,
			targetHeight: 300,
		},
		{
			name:         "Resize small image",
			width:        400,
			height:       300,
			targetWidth:  200,
			targetHeight: 150,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filename := filepath.Join(tmpDir, tt.name+".jpg")

			// Create test image
			img := image.NewRGBA(image.Rect(0, 0, tt.width, tt.height))
			// Create a gradient pattern
			for y := 0; y < tt.height; y++ {
				for x := 0; x < tt.width; x++ {
					c := color.RGBA{
						R: uint8((x * 255) / tt.width),
						G: uint8((y * 255) / tt.height),
						B: 128,
						A: 255,
					}
					img.Set(x, y, c)
				}
			}

			f, err := os.Create(filename)
			if err != nil {
				t.Fatalf("Failed to create test file: %v", err)
			}
			err = jpeg.Encode(f, img, &jpeg.Options{Quality: 90})
			f.Close()
			if err != nil {
				t.Fatalf("Failed to encode test image: %v", err)
			}

			// Load with vips
			result, err := LoadImageWithVips(filename, tt.targetWidth, tt.targetHeight)
			if err != nil {
				t.Fatalf("LoadImageWithVips failed: %v", err)
			}

			// Verify dimensions
			bounds := result.Bounds()
			w, h := bounds.Dx(), bounds.Dy()

			// Allow some tolerance in dimensions due to aspect ratio preservation
			tolerance := 10
			if w < tt.targetWidth-tolerance || w > tt.targetWidth+tolerance {
				t.Errorf("Width %d not close to target %d", w, tt.targetWidth)
			}
			if h < tt.targetHeight-tolerance || h > tt.targetHeight+tolerance {
				t.Errorf("Height %d not close to target %d", h, tt.targetHeight)
			}
		})
	}
}

func TestLoadImageWithVipsErrors(t *testing.T) {
	// Initialize vips if not already initialized
	if !IsVipsAvailable() {
		err := InitVips()
		if err != nil {
			t.Skip("libvips not available in test environment")
			return
		}
	}

	tests := []struct {
		name string
		path string
	}{
		{
			name: "Nonexistent file",
			path: "/nonexistent/path/image.jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := LoadImageWithVips(tt.path, 100, 100)
			if err == nil {
				t.Error("Expected error for invalid file, got nil")
			}
		})
	}
}

func TestVipsInitializationConcurrency(t *testing.T) {
	// Check if already initialized
	if IsVipsAvailable() {
		t.Skip("Vips already initialized, cannot test concurrent initialization")
		return
	}

	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func() {
			InitVips()
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify we can still check availability safely
	_ = IsVipsAvailable()
}

// Tests that interact with shutdown should run last to avoid breaking other tests
func TestLoadImageWithVipsNotAvailable(t *testing.T) {
	// Store original state
	wasAvailable := IsVipsAvailable()

	// Temporarily mark as unavailable
	if wasAvailable {
		ShutdownVips()
	}

	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test.jpg")

	// Create a simple test image
	img := image.NewRGBA(image.Rect(0, 0, 100, 100))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)
	f, err := os.Create(filename)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
	jpeg.Encode(f, img, &jpeg.Options{Quality: 90})
	f.Close()

	// Try to load with vips when it's not available
	_, err = LoadImageWithVips(filename, 50, 50)
	if err == nil {
		t.Error("Expected error when vips not available, got nil")
	}

	// Note: We cannot restore the original state because vips cannot be restarted
	if wasAvailable {
		t.Log("Warning: vips was shutdown and cannot be restarted in this test run")
	}
}

func TestVipsShutdownConcurrency(t *testing.T) {
	// Only test if vips is currently available
	if !IsVipsAvailable() {
		t.Skip("Vips not available, cannot test shutdown")
		return
	}

	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func() {
			ShutdownVips()
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify availability check is still safe
	available := IsVipsAvailable()
	if available {
		t.Error("After shutdown, IsVipsAvailable should return false")
	}
}

func TestShutdownVips(t *testing.T) {
	// This test should run last as vips cannot be restarted
	// Test that ShutdownVips can be called safely even if already shut down
	ShutdownVips()

	// Calling shutdown multiple times should be safe
	ShutdownVips()

	// After shutdown, it should not be available
	if IsVipsAvailable() {
		t.Error("After ShutdownVips, IsVipsAvailable should return false")
	}
}

func BenchmarkLoadImageWithVips(b *testing.B) {
	// Check if vips is available or can be initialized
	if !IsVipsAvailable() {
		err := InitVips()
		if err != nil {
			b.Skip("libvips not available in test environment")
			return
		}
	}

	tmpDir := b.TempDir()
	filename := filepath.Join(tmpDir, "bench.jpg")

	// Create test image once
	img := image.NewRGBA(image.Rect(0, 0, 4000, 3000))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)
	f, _ := os.Create(filename)
	jpeg.Encode(f, img, &jpeg.Options{Quality: 85})
	f.Close()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := LoadImageWithVips(filename, 400, 300)
		if err != nil {
			b.Fatalf("LoadImageWithVips failed: %v", err)
		}
	}
}

func BenchmarkIsVipsAvailable(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = IsVipsAvailable()
	}
}
