package media

import (
	"fmt"
	"image"
	"os"

	"media-viewer/internal/logging"

	// Image format decoders
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp" // WebP format support
)

const (
	// MaxImageDimension is the maximum width or height we'll process
	// Images larger than this will be downscaled first
	MaxImageDimension = 4096

	// MaxImagePixels is the maximum total pixels (width * height) we'll process
	// A 50MP image would be ~50,000,000 pixels, which uses ~200MB in RGBA
	MaxImagePixels = 20_000_000 // ~20MP, uses ~80MB in RGBA
)

// LoadImageConstrained loads an image, downscaling if it exceeds size limits
// This prevents OOM when processing very large images
func LoadImageConstrained(path string, maxDimension, maxPixels int) (image.Image, error) {
	// First, try to get image dimensions without fully decoding
	dimensions, err := GetImageDimensions(path)
	if err != nil {
		logging.Debug("Could not get image dimensions for %s: %v, loading with constraints", path, err)
		// Fall back to loading with auto-orientation and hope for the best
		return imaging.Open(path, imaging.AutoOrientation(true))
	}

	width, height := dimensions.Width, dimensions.Height
	pixels := width * height

	logging.Debug("Image %s dimensions: %dx%d (%d pixels)", path, width, height, pixels)

	// Check if image needs to be constrained
	needsConstraint := width > maxDimension || height > maxDimension || pixels > maxPixels

	if !needsConstraint {
		// Image is within limits, load normally
		return imaging.Open(path, imaging.AutoOrientation(true))
	}

	// Calculate target dimensions
	targetWidth, targetHeight := width, height

	// First, constrain by max dimension
	if width > maxDimension || height > maxDimension {
		if width > height {
			targetWidth = maxDimension
			targetHeight = height * maxDimension / width
		} else {
			targetHeight = maxDimension
			targetWidth = width * maxDimension / height
		}
	}

	// Then, constrain by total pixels if still too large
	targetPixels := targetWidth * targetHeight
	if targetPixels > maxPixels {
		scale := float64(maxPixels) / float64(targetPixels)
		targetWidth = int(float64(targetWidth) * scale)
		targetHeight = int(float64(targetHeight) * scale)
	}

	logging.Info("Constraining large image %s from %dx%d to %dx%d", path, width, height, targetWidth, targetHeight)

	// Load and resize in one operation using imaging library
	// This is more memory efficient than loading full size then resizing
	img, err := imaging.Open(path, imaging.AutoOrientation(true))
	if err != nil {
		return nil, fmt.Errorf("failed to open image: %w", err)
	}

	// Resize to constrained dimensions
	return imaging.Resize(img, targetWidth, targetHeight, imaging.Lanczos), nil
}

// ImageDimensions holds image width and height
type ImageDimensions struct {
	Width  int
	Height int
}

// GetImageDimensions returns image dimensions without fully decoding the image
func GetImageDimensions(path string) (*ImageDimensions, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := file.Close(); err != nil {
			logging.Warn("failed to close image file %s: %v", path, err)
		}
	}()

	config, _, err := image.DecodeConfig(file)
	if err != nil {
		return nil, err
	}

	return &ImageDimensions{
		Width:  config.Width,
		Height: config.Height,
	}, nil
}
