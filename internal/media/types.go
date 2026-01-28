package media

import "time"

// FileType represents the type of a media file.
type FileType string

const (
	// FileTypeFolder represents a directory.
	FileTypeFolder FileType = "folder"
	// FileTypeImage represents an image file.
	FileTypeImage FileType = "image"
	// FileTypeVideo represents a video file.
	FileTypeVideo FileType = "video"
	// FileTypePlaylist represents a playlist file.
	FileTypePlaylist FileType = "playlist"
	// FileTypeOther represents an unknown or unsupported file type.
	FileTypeOther FileType = "other"
)

// MediaFile represents a file or folder in the media library.
type MediaFile struct {
	Name         string    `json:"name"`
	Path         string    `json:"path"`
	Type         FileType  `json:"type"`
	Size         int64     `json:"size"`
	ModTime      time.Time `json:"modTime"`
	MimeType     string    `json:"mimeType,omitempty"`
	ThumbnailURL string    `json:"thumbnailUrl,omitempty"`
	ItemCount    int       `json:"itemCount,omitempty"` // For folders: number of items inside
}

// DirectoryListing represents the contents of a directory.
type DirectoryListing struct {
	Path       string      `json:"path"`
	Name       string      `json:"name"`
	Parent     string      `json:"parent,omitempty"`
	Breadcrumb []PathPart  `json:"breadcrumb"`
	Items      []MediaFile `json:"items"`
}

// PathPart represents a single component of a breadcrumb path.
type PathPart struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// SortField specifies which field to sort by.
type SortField string

// SortOrder specifies the direction of sorting.
type SortOrder string

const (
	// SortByName sorts results by filename.
	SortByName SortField = "name"
	// SortByDate sorts results by modification time.
	SortByDate SortField = "date"
	// SortBySize sorts results by file size.
	SortBySize SortField = "size"
	// SortByType sorts results by file type.
	SortByType SortField = "type"
	// SortAsc sorts in ascending order.
	SortAsc SortOrder = "asc"
	// SortDesc sorts in descending order.
	SortDesc SortOrder = "desc"
)

// ImageExtensions maps file extensions to whether they are supported image formats.
var ImageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
	".bmp": true, ".webp": true, ".svg": true, ".ico": true,
	".tiff": true, ".tif": true, ".heic": true, ".heif": true,
}

// VideoExtensions maps file extensions to whether they are supported video formats.
var VideoExtensions = map[string]bool{
	".mp4": true, ".mkv": true, ".avi": true, ".mov": true,
	".wmv": true, ".flv": true, ".webm": true, ".m4v": true,
	".mpeg": true, ".mpg": true, ".3gp": true, ".ts": true,
}

// PlaylistExtensions maps file extensions to whether they are supported playlist formats.
var PlaylistExtensions = map[string]bool{
	".wpl": true,
}
