package database

import (
	"time"

	"media-viewer/internal/mediatypes"
)

// FileType re-exported for convenience
type FileType = mediatypes.FileType

// Re-exported FileType constants from mediatypes package for convenience.
// These allow consumers of the database package to use FileType constants
// without importing mediatypes directly.
const (
	// FileTypeFolder represents a directory.
	FileTypeFolder = mediatypes.FileTypeFolder
	// FileTypeImage represents an image file.
	FileTypeImage = mediatypes.FileTypeImage
	// FileTypeVideo represents a video file.
	FileTypeVideo = mediatypes.FileTypeVideo
	// FileTypePlaylist represents a playlist file.
	FileTypePlaylist = mediatypes.FileTypePlaylist
	// FileTypeOther represents an unknown or unsupported file type.
	FileTypeOther = mediatypes.FileTypeOther
)

// MediaFile represents a file or folder in the media library.
type MediaFile struct {
	ID           int64     `json:"id"`
	Name         string    `json:"name"`
	Path         string    `json:"path"`
	ParentPath   string    `json:"parentPath"`
	Type         FileType  `json:"type"`
	Size         int64     `json:"size"`
	ModTime      time.Time `json:"modTime"`
	MimeType     string    `json:"mimeType,omitempty"`
	ThumbnailURL string    `json:"thumbnailUrl,omitempty"`
	ItemCount    int       `json:"itemCount,omitempty"`
	FileHash     string    `json:"-"`
	IsFavorite   bool      `json:"isFavorite,omitempty"`
	Tags         []string  `json:"tags,omitempty"`
}

// Tag represents a label that can be applied to media files.
type Tag struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color,omitempty"`
	ItemCount int       `json:"itemCount"`
	CreatedAt time.Time `json:"createdAt"`
}

// Favorite represents a user's favorite media file or folder.
type Favorite struct {
	ID        int64     `json:"id"`
	Path      string    `json:"path"`
	Name      string    `json:"name"`
	Type      FileType  `json:"type"`
	CreatedAt time.Time `json:"createdAt"`
}

// DirectoryListing represents the contents of a directory.
type DirectoryListing struct {
	Path       string      `json:"path"`
	Name       string      `json:"name"`
	Parent     string      `json:"parent,omitempty"`
	Breadcrumb []PathPart  `json:"breadcrumb"`
	Items      []MediaFile `json:"items"`
	Favorites  []MediaFile `json:"favorites,omitempty"`
	TotalItems int         `json:"totalItems"`
	Page       int         `json:"page"`
	PageSize   int         `json:"pageSize"`
	TotalPages int         `json:"totalPages"`
}

// PathPart represents a single component of a breadcrumb path.
type PathPart struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// SearchResult represents the results of a search query.
type SearchResult struct {
	Items      []MediaFile `json:"items"`
	Query      string      `json:"query"`
	TotalItems int         `json:"totalItems"`
	Page       int         `json:"page"`
	PageSize   int         `json:"pageSize"`
	TotalPages int         `json:"totalPages"`
}

// SearchSuggestion represents an autocomplete suggestion for search.
type SearchSuggestion struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Highlight string `json:"highlight"`
	ItemCount int    `json:"itemCount,omitempty"`
}

// IndexStats contains statistics about the indexed media library.
type IndexStats struct {
	TotalFiles          int       `json:"totalFiles"`
	TotalFolders        int       `json:"totalFolders"`
	TotalImages         int       `json:"totalImages"`
	TotalVideos         int       `json:"totalVideos"`
	TotalPlaylists      int       `json:"totalPlaylists"`
	TotalFavorites      int       `json:"totalFavorites"`
	TotalTags           int       `json:"totalTags"`
	ThumbnailCacheBytes int64     `json:"thumbnailCacheBytes"`
	ThumbnailCacheFiles int       `json:"thumbnailCacheFiles"`
	TranscodeCacheBytes int64     `json:"transcodeCacheBytes"`
	TranscodeCacheFiles int       `json:"transcodeCacheFiles"`
	LastIndexed         time.Time `json:"lastIndexed"`
	IndexDuration       string    `json:"indexDuration"`
}
