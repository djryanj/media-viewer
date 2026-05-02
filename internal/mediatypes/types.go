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

// File extension constants.
const (
	ExtJPG  = ".jpg"
	ExtJPEG = ".jpeg"
	ExtPNG  = ".png"
	ExtGIF  = ".gif"
	ExtWEBP = ".webp"
	ExtMP4  = ".mp4"
	ExtMKV  = ".mkv"
	ExtAVI  = ".avi"
	ExtMOV  = ".mov"
	ExtWPL  = ".wpl"

	// Image-only extensions.
	ExtBMP  = ".bmp"
	ExtSVG  = ".svg"
	ExtICO  = ".ico"
	ExtTIFF = ".tiff"
	ExtTIF  = ".tif"
	ExtHEIC = ".heic"
	ExtHEIF = ".heif"
	ExtAVIF = ".avif"
	ExtJXL  = ".jxl"
	ExtRAW  = ".raw"
	ExtCR2  = ".cr2"
	ExtNEF  = ".nef"
	ExtARW  = ".arw"
	ExtDNG  = ".dng"
)

// MIME type constants.
const (
	MimeJPEG        = "image/jpeg"
	MimeVideoMP4    = "video/mp4"
	MimeOctetStream = "application/octet-stream"
)

// ImageExtensions maps supported image file extensions to a fast lookup set.
var ImageExtensions = map[string]bool{
	ExtJPG:  true,
	ExtJPEG: true,
	ExtPNG:  true,
	ExtGIF:  true,
	ExtBMP:  true,
	ExtWEBP: true,
	ExtSVG:  true,
	ExtICO:  true,
	ExtTIFF: true,
	ExtTIF:  true,
	ExtHEIC: true,
	ExtHEIF: true,
	ExtAVIF: true,
	ExtJXL:  true,
	ExtRAW:  true,
	ExtCR2:  true,
	ExtNEF:  true,
	ExtARW:  true,
	ExtDNG:  true,
}

// VideoExtensions maps file extensions to whether they are supported video formats.
var VideoExtensions = map[string]bool{
	ExtMP4:  true,
	ExtMKV:  true,
	ExtAVI:  true,
	ExtMOV:  true,
	".wmv":  true,
	".flv":  true,
	ExtWEBP: true,
	".m4v":  true,
	".mpeg": true,
	".mpg":  true,
	".3gp":  true,
	".ts":   true,
}

// PlaylistExtensions maps file extensions to whether they are supported playlist formats.
var PlaylistExtensions = map[string]bool{
	ExtWPL: true,
}

// MimeTypes maps file extensions to their MIME types.
var MimeTypes = map[string]string{
	// Images
	ExtJPG:  MimeJPEG,
	ExtJPEG: MimeJPEG,
	ExtPNG:  "image/png",
	ExtGIF:  "image/gif",
	ExtBMP:  "image/bmp",
	ExtWEBP: "image/webp",
	ExtSVG:  "image/svg+xml",
	ExtICO:  "image/x-icon",
	ExtTIFF: "image/tiff",
	ExtTIF:  "image/tiff",
	ExtHEIC: "image/heic",
	ExtHEIF: "image/heif",

	// Videos
	ExtMP4:  MimeVideoMP4,
	ExtMKV:  "video/x-matroska",
	ExtAVI:  "video/x-msvideo",
	ExtMOV:  "video/quicktime",
	".wmv":  "video/x-ms-wmv",
	".flv":  "video/x-flv",
	".webm": "video/webm",
	".m4v":  "video/x-m4v",
	".mpeg": "video/mpeg",
	".mpg":  "video/mpeg",
	".3gp":  "video/3gpp",
	".ts":   "video/mp2t",

	// Playlists
	ExtWPL: "application/vnd.ms-wpl",
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
	return MimeOctetStream
}

// IsMediaFile returns true if the extension represents a supported media file.
func IsMediaFile(ext string) bool {
	return GetFileType(ext) != FileTypeOther
}
