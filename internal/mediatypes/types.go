package mediatypes

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
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".gif":  true,
	".bmp":  true,
	".webp": true,
	".svg":  true,
	".ico":  true,
	".tiff": true,
	".tif":  true,
	".heic": true,
	".heif": true,
}

// VideoExtensions maps file extensions to whether they are supported video formats.
var VideoExtensions = map[string]bool{
	".mp4":  true,
	".mkv":  true,
	".avi":  true,
	".mov":  true,
	".wmv":  true,
	".flv":  true,
	".webp": true,
	".m4v":  true,
	".mpeg": true,
	".mpg":  true,
	".3gp":  true,
	".ts":   true,
}

// PlaylistExtensions maps file extensions to whether they are supported playlist formats.
var PlaylistExtensions = map[string]bool{
	".wpl": true,
}

// MimeTypes maps file extensions to their MIME types.
var MimeTypes = map[string]string{
	// Images
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".gif":  "image/gif",
	".bmp":  "image/bmp",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".ico":  "image/x-icon",
	".tiff": "image/tiff",
	".tif":  "image/tiff",
	".heic": "image/heic",
	".heif": "image/heif",

	// Videos
	".mp4":  "video/mp4",
	".mkv":  "video/x-matroska",
	".avi":  "video/x-msvideo",
	".mov":  "video/quicktime",
	".wmv":  "video/x-ms-wmv",
	".flv":  "video/x-flv",
	".webm": "video/webm",
	".m4v":  "video/x-m4v",
	".mpeg": "video/mpeg",
	".mpg":  "video/mpeg",
	".3gp":  "video/3gpp",
	".ts":   "video/mp2t",

	// Playlists
	".wpl": "application/vnd.ms-wpl",
}

// GetFileType returns the FileType for a given file extension.
// The extension should be lowercase and include the leading dot (e.g., ".jpg").
// Returns FileTypeOther if the extension is not recognized.
func GetFileType(ext string) FileType {
	if ImageExtensions[ext] {
		return FileTypeImage
	}
	if VideoExtensions[ext] {
		return FileTypeVideo
	}
	if PlaylistExtensions[ext] {
		return FileTypePlaylist
	}
	return FileTypeOther
}

// GetMimeType returns the MIME type for a given file extension.
// The extension should be lowercase and include the leading dot (e.g., ".jpg").
// Returns "application/octet-stream" if the extension is not recognized.
func GetMimeType(ext string) string {
	if mime, ok := MimeTypes[ext]; ok {
		return mime
	}
	return "application/octet-stream"
}

// IsMediaFile returns true if the extension represents a supported media file.
func IsMediaFile(ext string) bool {
	return GetFileType(ext) != FileTypeOther
}
