// Package indexer provides background media file indexing for the media viewer.
//
// The indexer scans the configured media directory and maintains a database
// of all media files with their metadata including:
//   - File names, paths, and sizes
//   - Modification times
//   - MIME types
//   - File type classification (image, video, folder, playlist)
//   - Content hashes for change detection
//
// Supported file types are defined in the mediatypes package and include:
//   - Images: jpg, jpeg, png, gif, bmp, webp, svg, ico, tiff, heic, heif, avif, jxl, raw, cr2, nef, arw, dng
//   - Videos: mp4, mkv, avi, mov, wmv, flv, webm, m4v, mpeg, mpg, 3gp, ts
//   - Playlists: wpl (Windows Media Player)
//
// # Indexing Modes
//
// The indexer operates in multiple modes:
//   - Initial index: Full scan on application startup
//   - Periodic index: Configurable interval-based full re-indexing
//   - Polling-based change detection: Lightweight filesystem scans to detect changes
//   - Manual trigger: On-demand re-indexing via API
//
// # Change Detection
//
// The indexer uses polling-based change detection rather than filesystem watchers
// (fsnotify) for improved reliability in containerized environments. The polling
// mechanism compares:
//   - Total file count against the last known state
//   - Newest modification timestamp against the last index time
//
// When changes are detected, a full re-index is triggered automatically.
// The polling interval is configurable via [Indexer.SetPollInterval].
//
// # Parallel Processing
//
// For large media libraries, the indexer supports parallel directory walking
// with configurable worker counts. This significantly improves indexing
// performance on systems with fast storage. Configuration is available via
// [Indexer.SetParallelConfig] and [Indexer.SetParallelWalking].
//
// # Cleanup
//
// Files that no longer exist on disk are automatically removed from the
// index during each scan. Hidden files and directories (prefixed with '.')
// are excluded from indexing.
//
// # Integration
//
// The indexer can notify other components when indexing completes via
// [Indexer.SetOnIndexComplete]. This is used to trigger incremental
// thumbnail generation after the index is updated.
//
// # Example Usage
//
//	idx := indexer.New(db, "/media", 30*time.Minute)
//	idx.SetPollInterval(30 * time.Second)
//	idx.SetOnIndexComplete(func() {
//	    thumbnailGenerator.NotifyIndexComplete()
//	})
//	idx.Start()
//	defer idx.Stop()
package indexer
