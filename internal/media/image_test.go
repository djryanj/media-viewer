package media

import (
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// createTestImage creates a solid color test image and saves it to the given path
func createTestImage(t *testing.T, path string, width, height int, format string) {
	t.Helper()

	// Create image
	img := image.NewRGBA(image.Rect(0, 0, width, height))

	// Fill with a gradient pattern so we can verify resizing
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			c := color.RGBA{
				R: uint8((x * 255) / width),
				G: uint8((y * 255) / height),
				B: 128,
				A: 255,
			}
			img.Set(x, y, c)
		}
	}

	// Save image
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("Failed to create test image file: %v", err)
	}
	defer f.Close()

	switch format {
	case "jpeg", "jpg":
		err = jpeg.Encode(f, img, &jpeg.Options{Quality: 90})
	case "png":
		err = png.Encode(f, img)
	default:
		t.Fatalf("Unsupported test image format: %s", format)
	}

	if err != nil {
		t.Fatalf("Failed to encode test image: %v", err)
	}
}

func TestGetImageDimensions(t *testing.T) {
	tmpDir := t.TempDir()

	tests := []struct {
		name          string
		width         int
		height        int
		format        string
		expectError   bool
		errorContains string
	}{
		{
			name:   "Small JPEG",
			width:  100,
			height: 100,
			format: "jpeg",
		},
		{
			name:   "Large JPEG",
			width:  4000,
			height: 3000,
			format: "jpeg",
		},
		{
			name:   "Small PNG",
			width:  200,
			height: 150,
			format: "png",
		},
		{
			name:   "Wide image",
			width:  1920,
			height: 1080,
			format: "jpeg",
		},
		{
			name:   "Tall image",
			width:  1080,
			height: 1920,
			format: "jpeg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test image
			filename := filepath.Join(tmpDir, tt.name+"."+tt.format)
			createTestImage(t, filename, tt.width, tt.height, tt.format)

			// Get dimensions
			dims, err := GetImageDimensions(filename)

			if tt.expectError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if dims.Width != tt.width {
				t.Errorf("Width = %d, want %d", dims.Width, tt.width)
			}

			if dims.Height != tt.height {
				t.Errorf("Height = %d, want %d", dims.Height, tt.height)
			}
		})
	}
}

func TestGetImageDimensionsErrors(t *testing.T) {
	tests := []struct {
		name string
		path string
	}{
		{
			name: "Nonexistent file",
			path: "/nonexistent/path/to/image.jpg",
		},
		{
			name: "Invalid image file",
			path: "/tmp/not-an-image.txt",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.name == "Invalid image file" {
				// Create a text file to test invalid image
				tmpFile, err := os.CreateTemp("", "not-image-*.txt")
				if err != nil {
					t.Fatalf("Failed to create temp file: %v", err)
				}
				defer os.Remove(tmpFile.Name())
				tmpFile.WriteString("This is not an image")
				tmpFile.Close()
				tt.path = tmpFile.Name()
			}

			_, err := GetImageDimensions(tt.path)
			if err == nil {
				t.Error("Expected error but got none")
			}
		})
	}
}

func TestLoadImageConstrained(t *testing.T) {
	tmpDir := t.TempDir()

	tests := []struct {
		name            string
		width           int
		height          int
		maxDimension    int
		maxPixels       int
		expectConstrain bool
		format          string
	}{
		{
			name:            "Small image - no constraint",
			width:           800,
			height:          600,
			maxDimension:    1600,
			maxPixels:       2560000,
			expectConstrain: false,
			format:          "jpeg",
		},
		{
			name:            "Large dimension - constrain by width",
			width:           3200,
			height:          1600,
			maxDimension:    1600,
			maxPixels:       10000000,
			expectConstrain: true,
			format:          "jpeg",
		},
		{
			name:            "Large dimension - constrain by height",
			width:           1600,
			height:          3200,
			maxDimension:    1600,
			maxPixels:       10000000,
			expectConstrain: true,
			format:          "jpeg",
		},
		{
			name:            "Large pixels - constrain by total pixels",
			width:           2000,
			height:          2000,
			maxDimension:    5000,
			maxPixels:       1000000,
			expectConstrain: true,
			format:          "jpeg",
		},
		{
			name:            "PNG image - constrain",
			width:           2400,
			height:          1800,
			maxDimension:    1600,
			maxPixels:       2560000,
			expectConstrain: true,
			format:          "png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test image
			filename := filepath.Join(tmpDir, tt.name+"."+tt.format)
			createTestImage(t, filename, tt.width, tt.height, tt.format)

			// Load with constraints
			img, err := LoadImageConstrained(filename, tt.maxDimension, tt.maxPixels)
			if err != nil {
				t.Fatalf("LoadImageConstrained failed: %v", err)
			}

			bounds := img.Bounds()
			resultWidth := bounds.Dx()
			resultHeight := bounds.Dy()

			// Check that result is within constraints
			if resultWidth > tt.maxDimension {
				t.Errorf("Result width %d exceeds maxDimension %d", resultWidth, tt.maxDimension)
			}

			if resultHeight > tt.maxDimension {
				t.Errorf("Result height %d exceeds maxDimension %d", resultHeight, tt.maxDimension)
			}

			resultPixels := resultWidth * resultHeight
			if resultPixels > tt.maxPixels {
				t.Errorf("Result pixels %d exceeds maxPixels %d", resultPixels, tt.maxPixels)
			}

			// If we expected constraining, verify the image was actually resized
			if tt.expectConstrain {
				if resultWidth >= tt.width || resultHeight >= tt.height {
					t.Errorf("Expected image to be constrained, but dimensions are still %dx%d (original %dx%d)",
						resultWidth, resultHeight, tt.width, tt.height)
				}
			}
		})
	}
}

func TestLoadJPEGDownsampled(t *testing.T) {
	tmpDir := t.TempDir()

	tests := []struct {
		name           string
		width          int
		height         int
		targetWidth    int
		targetHeight   int
		expectTwoStage bool
	}{
		{
			name:           "Small JPEG - single stage",
			width:          800,
			height:         600,
			targetWidth:    200,
			targetHeight:   150,
			expectTwoStage: false,
		},
		{
			name:           "Large JPEG - two stage resize",
			width:          6400,
			height:         4800,
			targetWidth:    400,
			targetHeight:   300,
			expectTwoStage: true, // More than 4x larger
		},
		{
			name:           "4x larger - boundary case",
			width:          1600,
			height:         1200,
			targetWidth:    400,
			targetHeight:   300,
			expectTwoStage: false, // Exactly 4x doesn't trigger two-stage
		},
		{
			name:           "Just over 4x - two stage",
			width:          1700,
			height:         1300,
			targetWidth:    400,
			targetHeight:   300,
			expectTwoStage: true, // More than 4x
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test JPEG
			filename := filepath.Join(tmpDir, tt.name+".jpg")
			createTestImage(t, filename, tt.width, tt.height, "jpeg")

			// Load with downsampling
			img, err := LoadJPEGDownsampled(filename, tt.targetWidth, tt.targetHeight)
			if err != nil {
				t.Fatalf("LoadJPEGDownsampled failed: %v", err)
			}

			// Verify result dimensions match target
			bounds := img.Bounds()
			if bounds.Dx() != tt.targetWidth {
				t.Errorf("Width = %d, want %d", bounds.Dx(), tt.targetWidth)
			}
			if bounds.Dy() != tt.targetHeight {
				t.Errorf("Height = %d, want %d", bounds.Dy(), tt.targetHeight)
			}
		})
	}
}

func TestLoadJPEGDownsampledErrors(t *testing.T) {
	tests := []struct {
		name         string
		path         string
		targetWidth  int
		targetHeight int
	}{
		{
			name:         "Nonexistent file",
			path:         "/nonexistent/image.jpg",
			targetWidth:  100,
			targetHeight: 100,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := LoadJPEGDownsampled(tt.path, tt.targetWidth, tt.targetHeight)
			if err == nil {
				t.Error("Expected error but got none")
			}
		})
	}
}

func TestImageConstants(t *testing.T) {
	// Verify constants have sensible values
	if MaxImageDimension <= 0 {
		t.Errorf("MaxImageDimension should be positive, got %d", MaxImageDimension)
	}

	if MaxImagePixels <= 0 {
		t.Errorf("MaxImagePixels should be positive, got %d", MaxImagePixels)
	}

	// Verify MaxImagePixels is reasonable for MaxImageDimension
	expectedMaxPixels := MaxImageDimension * MaxImageDimension
	if MaxImagePixels > expectedMaxPixels*2 {
		t.Errorf("MaxImagePixels (%d) seems too large for MaxImageDimension (%d)",
			MaxImagePixels, MaxImageDimension)
	}
}

func TestLoadImageConstrainedWithRealScenarios(t *testing.T) {
	tmpDir := t.TempDir()

	// Test with MaxImageDimension and MaxImagePixels constants
	tests := []struct {
		name   string
		width  int
		height int
		format string
	}{
		{
			name:   "Typical camera photo",
			width:  4032,
			height: 3024,
			format: "jpeg",
		},
		{
			name:   "High-res screenshot",
			width:  2560,
			height: 1440,
			format: "png",
		},
		{
			name:   "Ultra-wide image",
			width:  3440,
			height: 1440,
			format: "jpeg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filename := filepath.Join(tmpDir, tt.name+"."+tt.format)
			createTestImage(t, filename, tt.width, tt.height, tt.format)

			img, err := LoadImageConstrained(filename, MaxImageDimension, MaxImagePixels)
			if err != nil {
				t.Fatalf("LoadImageConstrained failed: %v", err)
			}

			bounds := img.Bounds()
			w, h := bounds.Dx(), bounds.Dy()

			// Verify constraints are met
			if w > MaxImageDimension {
				t.Errorf("Width %d exceeds MaxImageDimension %d", w, MaxImageDimension)
			}
			if h > MaxImageDimension {
				t.Errorf("Height %d exceeds MaxImageDimension %d", h, MaxImageDimension)
			}
			if w*h > MaxImagePixels {
				t.Errorf("Pixels %d exceeds MaxImagePixels %d", w*h, MaxImagePixels)
			}
		})
	}
}

func BenchmarkGetImageDimensions(b *testing.B) {
	tmpDir := b.TempDir()
	filename := filepath.Join(tmpDir, "test.jpg")

	// Create test image once
	img := image.NewRGBA(image.Rect(0, 0, 1920, 1080))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{100, 100, 100, 255}}, image.Point{}, draw.Src)
	f, _ := os.Create(filename)
	jpeg.Encode(f, img, &jpeg.Options{Quality: 90})
	f.Close()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := GetImageDimensions(filename)
		if err != nil {
			b.Fatalf("GetImageDimensions failed: %v", err)
		}
	}
}

func BenchmarkLoadImageConstrained(b *testing.B) {
	tmpDir := b.TempDir()

	sizes := []struct {
		name   string
		width  int
		height int
	}{
		{"Small", 800, 600},
		{"Medium", 1920, 1080},
		{"Large", 4032, 3024},
	}

	for _, size := range sizes {
		b.Run(size.name, func(b *testing.B) {
			filename := filepath.Join(tmpDir, size.name+".jpg")

			// Create test image once
			img := image.NewRGBA(image.Rect(0, 0, size.width, size.height))
			draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)
			f, _ := os.Create(filename)
			jpeg.Encode(f, img, &jpeg.Options{Quality: 85})
			f.Close()

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := LoadImageConstrained(filename, MaxImageDimension, MaxImagePixels)
				if err != nil {
					b.Fatalf("LoadImageConstrained failed: %v", err)
				}
			}
		})
	}
}

func BenchmarkLoadJPEGDownsampled(b *testing.B) {
	tmpDir := b.TempDir()
	filename := filepath.Join(tmpDir, "large.jpg")

	// Create large test image once
	img := image.NewRGBA(image.Rect(0, 0, 6400, 4800))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)
	f, _ := os.Create(filename)
	jpeg.Encode(f, img, &jpeg.Options{Quality: 85})
	f.Close()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := LoadJPEGDownsampled(filename, 400, 300)
		if err != nil {
			b.Fatalf("LoadJPEGDownsampled failed: %v", err)
		}
	}
}
