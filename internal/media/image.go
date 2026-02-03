package media

import (
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"media-viewer/internal/logging"

	// Image format decoders
	_ "image/gif"
	_ "image/png"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp" // WebP format support
)

const (
	// MaxImageDimension is the maximum width or height we'll process
	// Images larger than this will be downscaled first
	// MaxImageDimension = 4096
	MaxImageDimension = 1600

	// MaxImagePixels is the maximum total pixels (width * height) we'll process
	// For thumbnail generation, we don't need to preserve large source images
	// 1600x1600 = 2.56MP, uses ~10MB in RGBA
	// MaxImagePixels = 20_000_000
	MaxImagePixels = 2_560_000 // ~2.6MP, uses ~10MB in RGBA
)

// LoadJPEGDownsampled loads a JPEG with optimized memory usage
// Uses JPEG-specific DCT-based decoding for better memory efficiency
func LoadJPEGDownsampled(path string, targetWidth, targetHeight int) (image.Image, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open JPEG: %w", err)
	}
	defer func() {
		if err := file.Close(); err != nil {
			logging.Warn("failed to close JPEG file %s: %v", path, err)
		}
	}()

	// Decode config to get dimensions without loading full image
	config, err := jpeg.DecodeConfig(file)
	if err != nil {
		return nil, fmt.Errorf("failed to decode JPEG config: %w", err)
	}

	// Seek back to start for actual decode
	if _, err := file.Seek(0, 0); err != nil {
		return nil, fmt.Errorf("failed to seek: %w", err)
	}

	// Calculate if we should use an intermediate downscale
	// For very large JPEGs, we decode and immediately downscale aggressively
	if config.Width > targetWidth*4 || config.Height > targetHeight*4 {
		// For 4x+ larger images, use two-stage resize
		// Stage 1: Fast resize to 2x target (reduces memory before Lanczos)
		logging.Debug("JPEG two-stage resize %s: %dx%d -> intermediate -> %dx%d",
			filepath.Base(path), config.Width, config.Height, targetWidth, targetHeight)

		img, err := jpeg.Decode(file)
		if err != nil {
			return nil, fmt.Errorf("failed to decode JPEG: %w", err)
		}

		// Stage 1: Fast box filter to intermediate size (2x target)
		// This is much faster and reduces memory for stage 2
		intermediateWidth := targetWidth * 2
		intermediateHeight := targetHeight * 2
		intermediate := imaging.Resize(img, intermediateWidth, intermediateHeight, imaging.Box)
		runtime.GC() // Force GC to reclaim large image memory

		// Stage 2: High-quality resize to final size
		return imaging.Resize(intermediate, targetWidth, targetHeight, imaging.Lanczos), nil
	}

	// For smaller images, single-stage decode and resize
	img, err := jpeg.Decode(file)
	if err != nil {
		return nil, fmt.Errorf("failed to decode JPEG: %w", err)
	}

	return imaging.Resize(img, targetWidth, targetHeight, imaging.Lanczos), nil
}

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

	// Calculate target dimensions for constrained images
	targetWidth, targetHeight := width, height

	// Constrain by max dimension
	if width > maxDimension || height > maxDimension {
		if width > height {
			targetWidth = maxDimension
			targetHeight = height * maxDimension / width
		} else {
			targetHeight = maxDimension
			targetWidth = width * maxDimension / height
		}
	}

	// Try libvips first for all supported formats (most memory efficient with decode-time shrinking)
	// vips supports: JPEG, PNG, WebP, HEIF/HEIC, GIF, TIFF, SVG, PDF, JP2K, JXL, and more
	if IsVipsAvailable() {
		img, err := LoadImageWithVips(path, targetWidth, targetHeight)
		if err == nil {
			logging.Debug("Successfully loaded %s using libvips", filepath.Base(path))
			return img, nil
		}
		logging.Debug("libvips loading failed for %s: %v, falling back to standard loader", filepath.Base(path), err)
	}

	// For JPEG files specifically, try optimized JPEG two-stage loading as fallback
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".jpg" || ext == ".jpeg" {
		img, err := LoadJPEGDownsampled(path, targetWidth, targetHeight)
		if err == nil {
			return img, nil
		}
		logging.Debug("JPEG optimized loading failed for %s: %v, falling back to standard method", path, err)
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
	// Note: imaging.Open still loads full image, but we resize immediately
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
