// Package mediatypes provides shared type definitions and utilities for media file
// handling across the media-viewer application.
//
// This package exists as a dependency-free foundation that can be imported by other
// packages without creating import cycles. It contains primitive types, constants,
// and pure utility functions with no external dependencies beyond the standard library.
//
// # File Types
//
// The package defines a FileType enum for categorizing media files:
//
//	mediatypes.FileTypeFolder   // Directories
//	mediatypes.FileTypeImage    // Supported image formats (jpg, png, gif, etc.)
//	mediatypes.FileTypeVideo    // Supported video formats (mp4, mkv, avi, etc.)
//	mediatypes.FileTypePlaylist // Playlist files (wpl)
//	mediatypes.FileTypeOther    // Unrecognized or unsupported files
//
// # Extension Detection
//
// Use GetFileType to determine the type of a file based on its extension:
//
//	ext := strings.ToLower(filepath.Ext(filename))
//	fileType := mediatypes.GetFileType(ext)
//
//	switch fileType {
//	case mediatypes.FileTypeImage:
//	    // Handle image
//	case mediatypes.FileTypeVideo:
//	    // Handle video
//	}
//
// # MIME Types
//
// Use GetMimeType to get the appropriate MIME type for HTTP responses:
//
//	ext := strings.ToLower(filepath.Ext(filename))
//	mimeType := mediatypes.GetMimeType(ext) // e.g., "image/jpeg"
//
// # Sorting
//
// The package provides SortField and SortOrder types for consistent sorting
// across the application:
//
//	sort := mediatypes.SortByName
//	order := mediatypes.SortAsc
//
// # Supported Formats
//
// The extension maps (ImageExtensions, VideoExtensions, PlaylistExtensions) can be
// used directly for format validation or iteration:
//
//	if mediatypes.ImageExtensions[ext] {
//	    // File is a supported image
//	}
package mediatypes
