// Package media provides media file processing utilities for the media viewer
// application.
//
// # Thumbnail Generation
//
// The [ThumbnailGenerator] creates and caches thumbnail images for media files:
//   - Images: Resized using the imaging library with auto-orientation
//   - Videos: Frame extraction at 1 second using FFmpeg
//   - Folders: Composite grid of up to 4 contained images/videos
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
// Large image processing is memory-constrained to prevent OOM:
//   - Images exceeding [MaxImageDimension] (4096px) are downscaled
//   - Images exceeding [MaxImagePixels] (20MP) are downscaled
//   - Memory monitor integration pauses processing under pressure
//   - Worker count is reduced when memory usage is high
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
//   - Generation duration histograms
//   - Cache hit/miss rates
//   - Cache size and count
//   - Background generation progress
//
// # Example Usage
//
//	thumbGen := media.NewThumbnailGenerator(
//	    "/cache/thumbnails",
//	    "/media",
//	    true, // enabled
//	    db,
//	    6*time.Hour,
//	    memMonitor,
//	)
//	thumbGen.Start()
//	defer thumbGen.Stop()
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
package media
