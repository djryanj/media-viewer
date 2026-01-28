// Package database provides SQLite database operations for the media viewer
// application.
//
// It handles storage and retrieval of:
//   - Media file metadata (images, videos, folders, playlists)
//   - User accounts and authentication sessions
//   - Favorites and tags
//   - Full-text search indexing
//
// The database uses WAL mode for improved concurrent read performance
// and includes automatic schema initialization.
package database
