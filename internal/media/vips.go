package media

import (
	"bytes"
	"fmt"
	"image"
	"path/filepath"
	"sync"

	"media-viewer/internal/logging"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/disintegration/imaging"
)

var (
	vipsInitialized bool
	vipsInitMutex   sync.Mutex
	vipsAvailable   bool
)

// InitVips initializes the libvips library
// This should be called once at startup
func InitVips() error {
	vipsInitMutex.Lock()
	defer vipsInitMutex.Unlock()

	if vipsInitialized {
		return nil
	}

	// Map our log level to vips log level
	// Configure vips logging BEFORE Startup() to respect LOG_LEVEL environment variable
	var vipsLogLevel vips.LogLevel
	var logHandler func(string, vips.LogLevel, string)

	appLevel := logging.GetLevel()
	switch appLevel {
	case logging.LevelDebug:
		// Debug: Show all vips messages including INFO
		vipsLogLevel = vips.LogLevelInfo
		logHandler = func(domain string, level vips.LogLevel, msg string) {
			switch level {
			case vips.LogLevelError, vips.LogLevelCritical:
				logging.Error("[%s] %s", domain, msg)
			case vips.LogLevelWarning:
				logging.Warn("[%s] %s", domain, msg)
			case vips.LogLevelMessage, vips.LogLevelInfo, vips.LogLevelDebug:
				logging.Debug("[%s] %s", domain, msg)
			}
		}
	case logging.LevelInfo:
		// Info: Only show warnings and errors
		vipsLogLevel = vips.LogLevelWarning
		logHandler = func(domain string, level vips.LogLevel, msg string) {
			switch level {
			case vips.LogLevelError, vips.LogLevelCritical:
				logging.Error("[%s] %s", domain, msg)
			case vips.LogLevelWarning:
				logging.Warn("[%s] %s", domain, msg)
			case vips.LogLevelMessage, vips.LogLevelInfo, vips.LogLevelDebug:
				// Suppressed at Info level
			}
		}
	case logging.LevelWarn:
		// Warn: Only show errors
		vipsLogLevel = vips.LogLevelError
		logHandler = func(domain string, level vips.LogLevel, msg string) {
			if level >= vips.LogLevelError {
				logging.Error("[%s] %s", domain, msg)
			}
		}
	case logging.LevelError:
		// Error: Only show critical errors
		vipsLogLevel = vips.LogLevelCritical
		logHandler = func(domain string, level vips.LogLevel, msg string) {
			if level >= vips.LogLevelCritical {
				logging.Error("[%s] %s", domain, msg)
			}
		}
	default:
		// Default to suppressing most logs
		vipsLogLevel = vips.LogLevelWarning
		logHandler = func(domain string, level vips.LogLevel, msg string) {
			if level >= vips.LogLevelError {
				logging.Warn("[%s] %s", domain, msg)
			}
		}
	}

	vips.LoggingSettings(logHandler, vipsLogLevel)

	// Start vips with conservative memory settings
	vips.Startup(&vips.Config{
		ConcurrencyLevel: 1,                // Process one image at a time to control memory
		MaxCacheMem:      50 * 1024 * 1024, // 50MB cache
		MaxCacheSize:     100,              // Max 100 operations cached
		ReportLeaks:      false,
		CacheTrace:       false,
		CollectStats:     false,
	})

	vipsInitialized = true
	vipsAvailable = true
	logging.Info("libvips initialized successfully (version: %s)", vips.Version)
	return nil
}

// ShutdownVips cleans up libvips resources
func ShutdownVips() {
	vipsInitMutex.Lock()
	defer vipsInitMutex.Unlock()

	if vipsInitialized {
		vips.Shutdown()
		vipsInitialized = false
		vipsAvailable = false
		logging.Info("libvips shutdown complete")
	}
}

// LoadImageWithVips loads and resizes an image using libvips with decode-time shrinking
// This is much more memory efficient than loading the full image then resizing
func LoadImageWithVips(path string, targetWidth, targetHeight int) (image.Image, error) {
	if !vipsAvailable {
		return nil, fmt.Errorf("libvips not available")
	}

	// libvips can shrink during decode, which is MUCH more memory efficient
	// Load image with vips - it will automatically use decode-time shrinking for JPEGs
	logging.Debug("Loading %s with vips (target: %dx%d)", filepath.Base(path), targetWidth, targetHeight)

	// Load image with vips (uses default import params with auto-orientation)
	importParams := vips.NewImportParams()
	ref, err := vips.LoadImageFromFile(path, importParams)
	if err != nil {
		return nil, fmt.Errorf("vips failed to load image: %w", err)
	}
	defer ref.Close()

	// Get original dimensions
	origWidth := ref.Width()
	origHeight := ref.Height()

	logging.Debug("Vips loaded %s: %dx%d, shrinking to %dx%d",
		filepath.Base(path), origWidth, origHeight, targetWidth, targetHeight)

	// Resize to target dimensions using vips high-quality resampling
	// Use Lanczos3 for best quality
	err = ref.Thumbnail(targetWidth, targetHeight, vips.InterestingNone)
	if err != nil {
		return nil, fmt.Errorf("vips resize failed: %w", err)
	}

	// Export to JPEG bytes (we'll convert to image.Image)
	imgBytes, _, err := ref.ExportJpeg(&vips.JpegExportParams{
		Quality:        95,
		StripMetadata:  false,
		OptimizeCoding: true,
	})
	if err != nil {
		return nil, fmt.Errorf("vips export failed: %w", err)
	}

	// Convert bytes back to image.Image for compatibility
	// This adds a small overhead but keeps the API consistent
	img, err := imaging.Decode(bytes.NewReader(imgBytes), imaging.AutoOrientation(true))
	if err != nil {
		return nil, fmt.Errorf("failed to decode vips output: %w", err)
	}

	logging.Debug("Vips processing complete for %s: final size %dx%d",
		filepath.Base(path), img.Bounds().Dx(), img.Bounds().Dy())

	return img, nil
}

// IsVipsAvailable returns whether libvips is initialized and available
func IsVipsAvailable() bool {
	vipsInitMutex.Lock()
	defer vipsInitMutex.Unlock()
	return vipsAvailable
}
