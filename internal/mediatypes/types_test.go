package mediatypes

import (
	"testing"
)

func TestGetFileType(t *testing.T) {
	tests := []struct {
		name string
		ext  string
		want FileType
	}{
		{
			name: "JPEG image",
			ext:  ".jpg",
			want: FileTypeImage,
		},
		{
			name: "PNG image",
			ext:  ".png",
			want: FileTypeImage,
		},
		{
			name: "MP4 video",
			ext:  ".mp4",
			want: FileTypeVideo,
		},
		{
			name: "MKV video",
			ext:  ".mkv",
			want: FileTypeVideo,
		},
		{
			name: "WPL playlist",
			ext:  ".wpl",
			want: FileTypePlaylist,
		},
		{
			name: "Unknown extension",
			ext:  ".xyz",
			want: FileTypeOther,
		},
		{
			name: "Empty extension",
			ext:  "",
			want: FileTypeOther,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetFileType(tt.ext)
			if got != tt.want {
				t.Errorf("GetFileType(%q) = %v, want %v", tt.ext, got, tt.want)
			}
		})
	}
}

func TestGetMimeType(t *testing.T) {
	tests := []struct {
		name string
		ext  string
		want string
	}{
		{
			name: "JPEG mime type",
			ext:  ".jpg",
			want: "image/jpeg",
		},
		{
			name: "PNG mime type",
			ext:  ".png",
			want: "image/png",
		},
		{
			name: "MP4 mime type",
			ext:  ".mp4",
			want: "video/mp4",
		},
		{
			name: "WPL mime type",
			ext:  ".wpl",
			want: "application/vnd.ms-wpl",
		},
		{
			name: "Unknown extension returns octet-stream",
			ext:  ".unknown",
			want: "application/octet-stream",
		},
		{
			name: "Empty extension returns octet-stream",
			ext:  "",
			want: "application/octet-stream",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetMimeType(tt.ext)
			if got != tt.want {
				t.Errorf("GetMimeType(%q) = %v, want %v", tt.ext, got, tt.want)
			}
		})
	}
}

func TestIsMediaFile(t *testing.T) {
	tests := []struct {
		name string
		ext  string
		want bool
	}{
		{
			name: "JPEG is media",
			ext:  ".jpg",
			want: true,
		},
		{
			name: "MP4 is media",
			ext:  ".mp4",
			want: true,
		},
		{
			name: "WPL is media",
			ext:  ".wpl",
			want: true,
		},
		{
			name: "Unknown extension is not media",
			ext:  ".txt",
			want: false,
		},
		{
			name: "Empty extension is not media",
			ext:  "",
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsMediaFile(tt.ext)
			if got != tt.want {
				t.Errorf("IsMediaFile(%q) = %v, want %v", tt.ext, got, tt.want)
			}
		})
	}
}

func TestImageExtensions(t *testing.T) {
	// Test that common image extensions are present
	commonImages := []string{".jpg", ".jpeg", ".png", ".gif", ".webp"}
	for _, ext := range commonImages {
		if !ImageExtensions[ext] {
			t.Errorf("Expected %s to be in ImageExtensions", ext)
		}
	}
}

func TestVideoExtensions(t *testing.T) {
	// Test that common video extensions are present
	commonVideos := []string{".mp4", ".mkv", ".avi", ".mov"}
	for _, ext := range commonVideos {
		if !VideoExtensions[ext] {
			t.Errorf("Expected %s to be in VideoExtensions", ext)
		}
	}
}

func TestFileTypeConstants(t *testing.T) {
	// Ensure constants have expected values
	if FileTypeFolder != "folder" {
		t.Errorf("FileTypeFolder = %v, want 'folder'", FileTypeFolder)
	}
	if FileTypeImage != "image" {
		t.Errorf("FileTypeImage = %v, want 'image'", FileTypeImage)
	}
	if FileTypeVideo != "video" {
		t.Errorf("FileTypeVideo = %v, want 'video'", FileTypeVideo)
	}
	if FileTypePlaylist != "playlist" {
		t.Errorf("FileTypePlaylist = %v, want 'playlist'", FileTypePlaylist)
	}
	if FileTypeOther != "other" {
		t.Errorf("FileTypeOther = %v, want 'other'", FileTypeOther)
	}
}

func TestSortConstants(t *testing.T) {
	// Ensure sort constants have expected values
	if SortByName != "name" {
		t.Errorf("SortByName = %v, want 'name'", SortByName)
	}
	if SortByDate != "date" {
		t.Errorf("SortByDate = %v, want 'date'", SortByDate)
	}
	if SortBySize != "size" {
		t.Errorf("SortBySize = %v, want 'size'", SortBySize)
	}
	if SortByType != "type" {
		t.Errorf("SortByType = %v, want 'type'", SortByType)
	}
	if SortAsc != "asc" {
		t.Errorf("SortAsc = %v, want 'asc'", SortAsc)
	}
	if SortDesc != "desc" {
		t.Errorf("SortDesc = %v, want 'desc'", SortDesc)
	}
}
