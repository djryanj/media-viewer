package database

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

type Tag struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color,omitempty"`
	ItemCount int       `json:"itemCount"`
	CreatedAt time.Time `json:"createdAt"`
}

type Favorite struct {
	ID        int64     `json:"id"`
	Path      string    `json:"path"`
	Name      string    `json:"name"`
	Type      FileType  `json:"type"`
	CreatedAt time.Time `json:"createdAt"`
}

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

type PathPart struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type SearchResult struct {
	Items      []MediaFile `json:"items"`
	Query      string      `json:"query"`
	TotalItems int         `json:"totalItems"`
	Page       int         `json:"page"`
	PageSize   int         `json:"pageSize"`
	TotalPages int         `json:"totalPages"`
}

type SearchSuggestion struct {
	Path      string   `json:"path"`
	Name      string   `json:"name"`
	Type      FileType `json:"type"`
	Highlight string   `json:"highlight"`
}

type IndexStats struct {
	TotalFiles     int       `json:"totalFiles"`
	TotalFolders   int       `json:"totalFolders"`
	TotalImages    int       `json:"totalImages"`
	TotalVideos    int       `json:"totalVideos"`
	TotalPlaylists int       `json:"totalPlaylists"`
	TotalFavorites int       `json:"totalFavorites"`
	TotalTags      int       `json:"totalTags"`
	LastIndexed    time.Time `json:"lastIndexed"`
	IndexDuration  string    `json:"indexDuration"`
}
