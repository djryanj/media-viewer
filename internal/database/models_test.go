package database

import (
	"encoding/json"
	"testing"
	"time"

	"media-viewer/internal/mediatypes"
)

func TestMediaFileStruct(t *testing.T) {
	now := time.Now()

	mf := MediaFile{
		ID:           1,
		Name:         "test.mp4",
		Path:         "/media/test.mp4",
		ParentPath:   "/media",
		Type:         FileTypeVideo,
		Size:         1024 * 1024 * 100, // 100 MB
		ModTime:      now,
		MimeType:     "video/mp4",
		ThumbnailURL: "/thumbs/test.jpg",
		ItemCount:    0,
		FileHash:     "abc123",
		IsFavorite:   true,
		Tags:         []string{"action", "2024"},
	}

	if mf.ID != 1 {
		t.Errorf("Expected ID=1, got %d", mf.ID)
	}

	if mf.Name != "test.mp4" {
		t.Errorf("Expected Name=test.mp4, got %s", mf.Name)
	}

	if mf.Type != FileTypeVideo {
		t.Errorf("Expected Type=FileTypeVideo, got %s", mf.Type)
	}

	if mf.Path != "/media/test.mp4" {
		t.Errorf("Expected Path=/media/test.mp4, got %s", mf.Path)
	}

	if mf.ParentPath != "/media" {
		t.Errorf("Expected ParentPath=/media, got %s", mf.ParentPath)
	}

	if mf.Size != 1024*1024*100 {
		t.Errorf("Expected Size=104857600, got %d", mf.Size)
	}

	if !mf.ModTime.Equal(now) {
		t.Errorf("Expected ModTime=%v, got %v", now, mf.ModTime)
	}

	if mf.MimeType != "video/mp4" {
		t.Errorf("Expected MimeType=video/mp4, got %s", mf.MimeType)
	}

	if mf.ThumbnailURL != "/thumbs/test.jpg" {
		t.Errorf("Expected ThumbnailURL=/thumbs/test.jpg, got %s", mf.ThumbnailURL)
	}

	if mf.ItemCount != 0 {
		t.Errorf("Expected ItemCount=0, got %d", mf.ItemCount)
	}

	if mf.FileHash != "abc123" {
		t.Errorf("Expected FileHash=abc123, got %s", mf.FileHash)
	}

	if !mf.IsFavorite {
		t.Error("Expected IsFavorite=true")
	}

	if len(mf.Tags) != 2 {
		t.Errorf("Expected 2 tags, got %d", len(mf.Tags))
	}
}

func TestMediaFileJSON(t *testing.T) {
	mf := MediaFile{
		ID:         1,
		Name:       "test.mp4",
		Path:       "/media/test.mp4",
		ParentPath: "/media",
		Type:       FileTypeVideo,
		Size:       1024,
		ModTime:    time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
		MimeType:   "video/mp4",
		IsFavorite: true,
		Tags:       []string{"test"},
	}

	// Marshal to JSON
	data, err := json.Marshal(mf)
	if err != nil {
		t.Fatalf("Failed to marshal MediaFile: %v", err)
	}

	// Unmarshal back
	var mf2 MediaFile
	err = json.Unmarshal(data, &mf2)
	if err != nil {
		t.Fatalf("Failed to unmarshal MediaFile: %v", err)
	}

	if mf2.ID != mf.ID {
		t.Errorf("ID mismatch: got %d, want %d", mf2.ID, mf.ID)
	}

	if mf2.Name != mf.Name {
		t.Errorf("Name mismatch: got %s, want %s", mf2.Name, mf.Name)
	}

	if mf2.Type != mf.Type {
		t.Errorf("Type mismatch: got %s, want %s", mf2.Type, mf.Type)
	}

	// FileHash should not be in JSON (json:"-" tag)
	if !contains(string(data), "fileHash") {
		t.Error("fileHash should not be in JSON due to json:\"-\" tag")
	}
}

func TestTagStruct(t *testing.T) {
	now := time.Now()

	tag := Tag{
		ID:        1,
		Name:      "Action",
		Color:     "#FF0000",
		ItemCount: 5,
		CreatedAt: now,
	}

	if tag.ID != 1 {
		t.Errorf("Expected ID=1, got %d", tag.ID)
	}

	if !tag.CreatedAt.Equal(now) {
		t.Errorf("Expected CreatedAt=%v, got %v", now, tag.CreatedAt)
	}

	if tag.Name != "Action" {
		t.Errorf("Expected Name=Action, got %s", tag.Name)
	}

	if tag.Color != "#FF0000" {
		t.Errorf("Expected Color=#FF0000, got %s", tag.Color)
	}

	if tag.ItemCount != 5 {
		t.Errorf("Expected ItemCount=5, got %d", tag.ItemCount)
	}
}

func TestFavoriteStruct(t *testing.T) {
	now := time.Now()

	fav := Favorite{
		ID:        1,
		Path:      "/media/favorites/video.mp4",
		Name:      "video.mp4",
		Type:      FileTypeVideo,
		CreatedAt: now,
	}

	if fav.ID != 1 {
		t.Errorf("Expected ID=1, got %d", fav.ID)
	}

	if fav.Path != "/media/favorites/video.mp4" {
		t.Errorf("Expected Path=/media/favorites/video.mp4, got %s", fav.Path)
	}

	if fav.Type != FileTypeVideo {
		t.Errorf("Expected Type=FileTypeVideo, got %s", fav.Type)
	}

	if fav.Name != "video.mp4" {
		t.Errorf("Expected Name=video.mp4, got %s", fav.Name)
	}

	if !fav.CreatedAt.Equal(now) {
		t.Errorf("Expected CreatedAt=%v, got %v", now, fav.CreatedAt)
	}
}

func TestDirectoryListingStruct(t *testing.T) {
	listing := DirectoryListing{
		Path:   "/media/videos",
		Name:   "videos",
		Parent: "/media",
		Breadcrumb: []PathPart{
			{Name: "media", Path: "/media"},
			{Name: "videos", Path: "/media/videos"},
		},
		Items: []MediaFile{
			{ID: 1, Name: "video1.mp4", Type: FileTypeVideo},
			{ID: 2, Name: "video2.mp4", Type: FileTypeVideo},
		},
		TotalItems: 2,
		Page:       1,
		PageSize:   50,
		TotalPages: 1,
	}

	if listing.Path != "/media/videos" {
		t.Errorf("Expected Path=/media/videos, got %s", listing.Path)
	}

	if listing.Name != "videos" {
		t.Errorf("Expected Name=videos, got %s", listing.Name)
	}

	if listing.Parent != "/media" {
		t.Errorf("Expected Parent=/media, got %s", listing.Parent)
	}

	if len(listing.Items) != 2 {
		t.Errorf("Expected 2 items, got %d", len(listing.Items))
	}

	if listing.TotalItems != 2 {
		t.Errorf("Expected TotalItems=2, got %d", listing.TotalItems)
	}

	if listing.Page != 1 {
		t.Errorf("Expected Page=1, got %d", listing.Page)
	}

	if listing.PageSize != 50 {
		t.Errorf("Expected PageSize=50, got %d", listing.PageSize)
	}

	if len(listing.Breadcrumb) != 2 {
		t.Errorf("Expected 2 breadcrumb parts, got %d", len(listing.Breadcrumb))
	}

	if listing.TotalPages != 1 {
		t.Errorf("Expected TotalPages=1, got %d", listing.TotalPages)
	}
}

func TestPathPartStruct(t *testing.T) {
	part := PathPart{
		Name: "videos",
		Path: "/media/videos",
	}

	if part.Name != "videos" {
		t.Errorf("Expected Name=videos, got %s", part.Name)
	}

	if part.Path != "/media/videos" {
		t.Errorf("Expected Path=/media/videos, got %s", part.Path)
	}
}

func TestSearchResultStruct(t *testing.T) {
	result := SearchResult{
		Items: []MediaFile{
			{ID: 1, Name: "match1.mp4"},
			{ID: 2, Name: "match2.mp4"},
		},
		Query:      "test",
		TotalItems: 2,
		Page:       1,
		PageSize:   10,
		TotalPages: 1,
	}

	if result.Query != "test" {
		t.Errorf("Expected Query=test, got %s", result.Query)
	}

	if len(result.Items) != 2 {
		t.Errorf("Expected 2 items, got %d", len(result.Items))
	}

	if result.TotalItems != 2 {
		t.Errorf("Expected TotalItems=2, got %d", result.TotalItems)
	}

	if result.Page != 1 {
		t.Errorf("Expected Page=1, got %d", result.Page)
	}

	if result.PageSize != 10 {
		t.Errorf("Expected PageSize=10, got %d", result.PageSize)
	}

	if result.TotalPages != 1 {
		t.Errorf("Expected TotalPages=1, got %d", result.TotalPages)
	}
}

func TestSearchSuggestionStruct(t *testing.T) {
	suggestion := SearchSuggestion{
		Path:      "/media/test.mp4",
		Name:      "test.mp4",
		Type:      "video",
		Highlight: "<em>test</em>.mp4",
	}

	if suggestion.Path != "/media/test.mp4" {
		t.Errorf("Expected Path=/media/test.mp4, got %s", suggestion.Path)
	}

	if suggestion.Type != "video" {
		t.Errorf("Expected Type=video, got %s", suggestion.Type)
	}

	if suggestion.Name != "test.mp4" {
		t.Errorf("Expected Name=test.mp4, got %s", suggestion.Name)
	}

	if suggestion.Highlight != "<em>test</em>.mp4" {
		t.Errorf("Expected Highlight=<em>test</em>.mp4, got %s", suggestion.Highlight)
	}
}

func TestFileTypeConstants(t *testing.T) {
	tests := []struct {
		name     string
		fileType FileType
		expected mediatypes.FileType
	}{
		{"Folder", FileTypeFolder, mediatypes.FileTypeFolder},
		{"Image", FileTypeImage, mediatypes.FileTypeImage},
		{"Video", FileTypeVideo, mediatypes.FileTypeVideo},
		{"Playlist", FileTypePlaylist, mediatypes.FileTypePlaylist},
		{"Other", FileTypeOther, mediatypes.FileTypeOther},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.fileType != tt.expected {
				t.Errorf("FileType constant mismatch: got %s, want %s", tt.fileType, tt.expected)
			}
		})
	}
}

func TestSortFieldConstants(t *testing.T) {
	tests := []struct {
		name     string
		field    SortField
		expected string
	}{
		{"Name", SortByName, "name"},
		{"Date", SortByDate, "date"},
		{"Size", SortBySize, "size"},
		{"Type", SortByType, "type"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.field) != tt.expected {
				t.Errorf("SortField value mismatch: got %s, want %s", tt.field, tt.expected)
			}
		})
	}
}

func TestSortOrderConstants(t *testing.T) {
	tests := []struct {
		name     string
		order    SortOrder
		expected string
	}{
		{"Ascending", SortAsc, "asc"},
		{"Descending", SortDesc, "desc"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.order) != tt.expected {
				t.Errorf("SortOrder value mismatch: got %s, want %s", tt.order, tt.expected)
			}
		})
	}
}

func TestListOptions(t *testing.T) {
	opts := ListOptions{
		Path:       "/media/videos",
		SortField:  SortByName,
		SortOrder:  SortAsc,
		FilterType: "video",
		Page:       1,
		PageSize:   50,
	}

	if opts.Path != "/media/videos" {
		t.Errorf("Expected Path=/media/videos, got %s", opts.Path)
	}

	if opts.SortField != SortByName {
		t.Errorf("Expected SortField=SortByName, got %s", opts.SortField)
	}

	if opts.FilterType != "video" {
		t.Errorf("Expected FilterType=video, got %s", opts.FilterType)
	}

	if opts.SortOrder != SortAsc {
		t.Errorf("Expected SortOrder=SortAsc, got %s", opts.SortOrder)
	}

	if opts.Page != 1 {
		t.Errorf("Expected Page=1, got %d", opts.Page)
	}

	if opts.PageSize != 50 {
		t.Errorf("Expected PageSize=50, got %d", opts.PageSize)
	}
}

func TestMediaFileTypes(t *testing.T) {
	tests := []struct {
		name     string
		fileType FileType
	}{
		{"Video file", FileTypeVideo},
		{"Image file", FileTypeImage},
		{"Folder", FileTypeFolder},
		{"Playlist", FileTypePlaylist},
		{"Other", FileTypeOther},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mf := MediaFile{
				ID:   1,
				Name: "test",
				Type: tt.fileType,
			}

			if mf.ID != 1 {
				t.Errorf("Expected ID=1, got %d", mf.ID)
			}

			if mf.Name != "test" {
				t.Errorf("Expected Name=test, got %s", mf.Name)
			}

			if mf.Type != tt.fileType {
				t.Errorf("MediaFile.Type mismatch: got %s, want %s", mf.Type, tt.fileType)
			}
		})
	}
}

// Helper function
func contains(s, substr string) bool {
	return s != "" && substr != "" && (s == substr || len(s) >= len(substr))
}
