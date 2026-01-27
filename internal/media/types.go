package media

import "time"

type FileType string

const (
	FileTypeFolder   FileType = "folder"
	FileTypeImage    FileType = "image"
	FileTypeVideo    FileType = "video"
	FileTypePlaylist FileType = "playlist"
	FileTypeOther    FileType = "other"
)

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

type DirectoryListing struct {
	Path       string      `json:"path"`
	Name       string      `json:"name"`
	Parent     string      `json:"parent,omitempty"`
	Breadcrumb []PathPart  `json:"breadcrumb"`
	Items      []MediaFile `json:"items"`
}

type PathPart struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type SortField string
type SortOrder string

const (
	SortByName SortField = "name"
	SortByDate SortField = "date"
	SortBySize SortField = "size"
	SortByType SortField = "type"
	SortAsc    SortOrder = "asc"
	SortDesc   SortOrder = "desc"
)

var ImageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
	".bmp": true, ".webp": true, ".svg": true, ".ico": true,
	".tiff": true, ".tif": true, ".heic": true, ".heif": true,
}

var VideoExtensions = map[string]bool{
	".mp4": true, ".mkv": true, ".avi": true, ".mov": true,
	".wmv": true, ".flv": true, ".webm": true, ".m4v": true,
	".mpeg": true, ".mpg": true, ".3gp": true, ".ts": true,
}

var PlaylistExtensions = map[string]bool{
	".wpl": true,
}
