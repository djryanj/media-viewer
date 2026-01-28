// Package playlist provides parsing and resolution of playlist files.
//
// Currently supported formats:
//   - WPL (Windows Playlist): XML-based playlist format used by Windows Media Player
//
// The package handles various path formats found in playlist files:
//   - UNC paths (e.g., \\server\share\folder\file.mp4)
//   - Absolute paths with drive letters (e.g., C:\folder\file.mp4)
//   - Relative paths (e.g., ../folder/file.mp4)
//
// Path resolution employs multiple strategies to locate media files:
//   - Direct path matching relative to playlist location
//   - Progressive path component matching
//   - Recursive file search by filename
//
// This allows playlists created on different systems or with different
// directory structures to be used when the underlying media files exist
// in the configured media directory.
package playlist
