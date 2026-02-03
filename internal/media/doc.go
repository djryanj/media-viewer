// Package media provides media file processing utilities for the media viewer
// application.
//
// # Thumbnail Generation
//
// The [ThumbnailGenerator] creates and caches thumbnail images for media files:
//   - Images: Resized using libvips (preferred) or imaging library with auto-orientation
//   - Videos: Frame extraction at 1 second using FFmpeg
//   - Folders: Composite grid of up to 4 contained images/videos
//
// For JPEG images, libvips provides decode-time shrinking which dramatically
// reduces memory usage by never loading the full-resolution image into memory.
//
// Thumbnails are cached to disk with MD5-hashed filenames. Each thumbnail
// has an associated .meta sidecar file tracking the source path for orphan
// detection and cleanup.
//
// # Incremental Generation
//
// The thumbnail generator supports incremental updates:
//   - Listens for index completion notifications
//   - Only processes files changed since the last run
//   - Automatically regenerates folder thumbnails when contents change
//   - Cleans up orphaned thumbnails for deleted files
//   - Removes legacy thumbnails without meta file tracking
//
// # Memory Management
//
// The thumbnail generator uses multiple strategies for memory-efficient processing:
//
//  1. libvips Integration (Primary - All Supported Formats):
//     - Decode-time shrinking: decodes directly to target resolution
//     - Never loads full-size image into memory
//     - Example: 6000×4000 JPEG → 1600×1600 uses ~10MB peak (vs ~106MB standard)
//     - Supports: JPEG, PNG, WebP, HEIF/HEIC, GIF, TIFF, SVG, PDF, JP2K, JXL, and more
//     - Gracefully falls back if libvips unavailable or fails for specific formats
//
//  2. Two-Stage Resize (Fallback - Large JPEG files):
//     - Stage 1: Fast box filter resize to 2× target (reduces memory quickly)
//     - Explicit GC between stages to reclaim large image memory
//     - Stage 2: High-quality Lanczos resize to final dimensions
//     - Used when libvips unavailable and JPEG image >4× target size
//
//  3. Standard Processing (Final Fallback - All formats):
//     - Images exceeding [MaxImageDimension] (1600px) are downscaled
//     - Images exceeding [MaxImagePixels] (2.56MP) are downscaled
//     - Constrained loading prevents OOM on very large images
//
//  4. System-Wide Controls:
//     - Memory monitor integration pauses processing under pressure
//     - Worker count is reduced when memory usage is high
//     - Explicit GC calls after processing large images
//
// The multi-tier approach ensures optimal memory usage with graceful degradation
// across different environments (production with libvips, development without).
//
// # FFmpeg Integration
//
// Video thumbnails and problematic image formats use FFmpeg as a fallback:
//   - Video frame extraction with configurable seek time
//   - Image decoding for formats not supported by Go's image package
//   - 30 second timeout per FFmpeg operation
//
// # Background Processing
//
// The generator runs background goroutines for:
//   - Initial full generation after first index completion
//   - Incremental generation after subsequent index completions
//   - Periodic full scans as a fallback (configurable interval)
//   - Cache metrics updates every minute
//
// # Metrics
//
// Thumbnail operations are instrumented with Prometheus metrics:
//   - Generation counts by file type and status
//   - Generation duration histograms (overall and per-phase)
//   - Memory usage per thumbnail operation
//   - Cache hit/miss rates
//   - Cache size and count
//   - Background generation progress
//
// # Example Usage
//
//	// Initialize thumbnail generator (automatically initializes libvips if available)
//	thumbGen := media.NewThumbnailGenerator(
//	    "/cache/thumbnails",
//	    "/media",
//	    true, // enabled
//	    db,
//	    6*time.Hour,
//	    memMonitor,
//	)
//	thumbGen.Start()
//	defer thumbGen.Stop() // Cleans up libvips resources
//
//	// Get or generate a thumbnail
//	data, err := thumbGen.GetThumbnail(ctx, "/media/photo.jpg", database.FileTypeImage)
//
//	// Notify after indexing completes
//	thumbGen.NotifyIndexComplete()
//
//	// Manual cache invalidation
//	thumbGen.InvalidateThumbnail("/media/photo.jpg")
//	thumbGen.InvalidateAll()
//	thumbGen.RebuildAll()
//
//	// Check if libvips is available
//	if media.IsVipsAvailable() {
//	    // Using optimized decode-time shrinking for JPEGs
//	}
package media
