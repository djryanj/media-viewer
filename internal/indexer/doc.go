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
// Supported file types:
//   - Images: jpg, jpeg, png, gif, bmp, webp, svg, ico, tiff, heic, heif
//   - Videos: mp4, mkv, avi, mov, wmv, flv, webm, m4v, mpeg, mpg, 3gp, ts
//   - Playlists: wpl (Windows Media Player)
//
// The indexer operates in multiple modes:
//   - Initial index: Full scan on application startup
//   - Periodic index: Configurable interval-based re-indexing
//   - File watching: Real-time updates via fsnotify with debouncing
//   - Manual trigger: On-demand re-indexing via API
//
// Files that no longer exist on disk are automatically removed from the
// index during each scan. Hidden files and directories (prefixed with '.')
// are excluded from indexing.
package indexer
