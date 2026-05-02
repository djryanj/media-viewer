package media

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

// ImageExtensions maps supported image file extensions to a fast lookup set.
var ImageExtensions = map[string]bool{
	jpegExt:     true,
	jpegExtLong: true,
	pngExt:      true,
	gifExt:      true,
	bmpExt:      true,
	webpExt:     true,
	svgExt:      true,
	icoExt:      true,
	tiffExt:     true,
	tifExt:      true,
	heicExt:     true,
	heifExt:     true,
}

// VideoExtensions maps file extensions to whether they are supported video formats.
var VideoExtensions = map[string]bool{
	mp4Ext:  true,
	mkvExt:  true,
	aviExt:  true,
	movExt:  true,
	wmvExt:  true,
	flvExt:  true,
	webmExt: true,
	m4vExt:  true,
	mpegExt: true,
	mpgExt:  true,
	gp3Ext:  true,
	tsExt:   true,
}

// PlaylistExtensions maps file extensions to whether they are supported playlist formats.
var PlaylistExtensions = map[string]bool{
	wplExt: true,
}

// MimeTypes maps file extensions to their MIME types.
var MimeTypes = map[string]string{
	// Images
	jpegExt:     mimeJPEG,
	jpegExtLong: mimeJPEG,
	pngExt:      mimePNG,
	gifExt:      mimeGIF,
	bmpExt:      "image/bmp",
	webpExt:     "image/webp",
	svgExt:      "image/svg+xml",
	icoExt:      "image/x-icon",
	tiffExt:     "image/tiff",
	tifExt:      "image/tiff",
	heicExt:     "image/heic",
	heifExt:     "image/heif",

	// Videos
	mp4Ext:  mimeMP4,
	mkvExt:  "video/x-matroska",
	aviExt:  "video/x-msvideo",
	movExt:  "video/quicktime",
	wmvExt:  "video/x-ms-wmv",
	flvExt:  "video/x-flv",
	webmExt: mimeWEBM,
	m4vExt:  "video/x-m4v",
	mpegExt: "video/mpeg",
	mpgExt:  "video/mpeg",
	gp3Ext:  "video/3gpp",
	tsExt:   "video/mp2t",

	// Playlists
	wplExt: "application/vnd.ms-wpl",
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
	return mimeFallback
}

// IsMediaFile returns true if the extension represents a supported media file.
func IsMediaFile(ext string) bool {
	return GetFileType(ext) != FileTypeOther
}

// IsSupportedImage returns true if the extension is a supported image format.
func IsSupportedImage(ext string) bool {
	return ImageExtensions[ext]
}

// IsSupportedVideo returns true if the extension is a supported video format.
func IsSupportedVideo(ext string) bool {
	return VideoExtensions[ext]
}
