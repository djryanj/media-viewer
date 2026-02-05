package media

import (
	"testing"
)

func TestFileTypeConstants(t *testing.T) {
	tests := []struct {
		name     string
		fileType FileType
		expected string
	}{
		{"Folder", FileTypeFolder, "folder"},
		{"Image", FileTypeImage, "image"},
		{"Video", FileTypeVideo, "video"},
		{"Playlist", FileTypePlaylist, "playlist"},
		{"Other", FileTypeOther, "other"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.fileType) != tt.expected {
				t.Errorf("FileType value mismatch: got %s, want %s", tt.fileType, tt.expected)
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

func TestImageExtensions(t *testing.T) {
	tests := []struct {
		ext      string
		expected bool
	}{
		{".jpg", true},
		{".jpeg", true},
		{".png", true},
		{".gif", true},
		{".bmp", true},
		{".webp", true},
		{".svg", true},
		{".ico", true},
		{".tiff", true},
		{".tif", true},
		{".heic", true},
		{".heif", true},
		{".txt", false},
		{".mp4", false},
	}

	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			got := ImageExtensions[tt.ext]
			if got != tt.expected {
				t.Errorf("ImageExtensions[%s] = %v, want %v", tt.ext, got, tt.expected)
			}
		})
	}
}

func TestVideoExtensions(t *testing.T) {
	tests := []struct {
		ext      string
		expected bool
	}{
		{".mp4", true},
		{".mkv", true},
		{".avi", true},
		{".mov", true},
		{".wmv", true},
		{".flv", true},
		{".webm", true},
		{".m4v", true},
		{".mpeg", true},
		{".mpg", true},
		{".3gp", true},
		{".ts", true},
		{".txt", false},
		{".jpg", false},
	}

	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			got := VideoExtensions[tt.ext]
			if got != tt.expected {
				t.Errorf("VideoExtensions[%s] = %v, want %v", tt.ext, got, tt.expected)
			}
		})
	}
}

func TestPlaylistExtensions(t *testing.T) {
	tests := []struct {
		ext      string
		expected bool
	}{
		{".wpl", true},
		{".m3u", false},
		{".pls", false},
		{".txt", false},
	}

	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			got := PlaylistExtensions[tt.ext]
			if got != tt.expected {
				t.Errorf("PlaylistExtensions[%s] = %v, want %v", tt.ext, got, tt.expected)
			}
		})
	}
}

func TestMimeTypes(t *testing.T) {
	tests := []struct {
		ext      string
		expected string
	}{
		// Images
		{".jpg", "image/jpeg"},
		{".jpeg", "image/jpeg"},
		{".png", "image/png"},
		{".gif", "image/gif"},
		{".webp", "image/webp"},
		// Videos
		{".mp4", "video/mp4"},
		{".mkv", "video/x-matroska"},
		{".avi", "video/x-msvideo"},
		{".mov", "video/quicktime"},
		{".webm", "video/webm"},
	}

	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			got := MimeTypes[tt.ext]
			if got != tt.expected {
				t.Errorf("MimeTypes[%s] = %s, want %s", tt.ext, got, tt.expected)
			}
		})
	}
}

func TestMimeTypesExistence(t *testing.T) {
	// Ensure all image extensions have mime types
	for ext := range ImageExtensions {
		if MimeTypes[ext] == "" {
			t.Errorf("Image extension %s missing from MimeTypes", ext)
		}
	}

	// Ensure all video extensions have mime types
	for ext := range VideoExtensions {
		if MimeTypes[ext] == "" {
			t.Errorf("Video extension %s missing from MimeTypes", ext)
		}
	}
}

func TestExtensionMaps(t *testing.T) {
	// Test that extension maps are not empty
	if len(ImageExtensions) == 0 {
		t.Error("ImageExtensions map is empty")
	}

	if len(VideoExtensions) == 0 {
		t.Error("VideoExtensions map is empty")
	}

	if len(PlaylistExtensions) == 0 {
		t.Error("PlaylistExtensions map is empty")
	}

	if len(MimeTypes) == 0 {
		t.Error("MimeTypes map is empty")
	}
}

func TestExtensionMapsNoOverlap(t *testing.T) {
	// Check that image and video extensions don't overlap
	for ext := range ImageExtensions {
		if VideoExtensions[ext] {
			t.Errorf("Extension %s found in both ImageExtensions and VideoExtensions", ext)
		}
	}

	// Check that video and playlist extensions don't overlap
	for ext := range VideoExtensions {
		if PlaylistExtensions[ext] {
			t.Errorf("Extension %s found in both VideoExtensions and PlaylistExtensions", ext)
		}
	}

	// Check that image and playlist extensions don't overlap
	for ext := range ImageExtensions {
		if PlaylistExtensions[ext] {
			t.Errorf("Extension %s found in both ImageExtensions and PlaylistExtensions", ext)
		}
	}
}

func TestMimeTypeFormat(t *testing.T) {
	// Verify all MIME types follow the type/subtype format
	for ext, mimeType := range MimeTypes {
		if mimeType == "" {
			t.Errorf("Empty MIME type for extension %s", ext)
			continue
		}

		// Check for slash
		hasSlash := false
		for _, ch := range mimeType {
			if ch == '/' {
				hasSlash = true
				break
			}
		}

		if !hasSlash {
			t.Errorf("MIME type for %s (%s) does not contain '/'", ext, mimeType)
		}
	}
}

func TestGetFileType(t *testing.T) {
	tests := []struct {
		name     string
		ext      string
		expected FileType
	}{
		{"JPEG image", ".jpg", FileTypeImage},
		{"PNG image", ".png", FileTypeImage},
		{"MP4 video", ".mp4", FileTypeVideo},
		{"MKV video", ".mkv", FileTypeVideo},
		{"WPL playlist", ".wpl", FileTypePlaylist},
		{"Unknown extension", ".xyz", FileTypeOther},
		{"Text file", ".txt", FileTypeOther},
		{"Empty extension", "", FileTypeOther},
		{"Case sensitive - uppercase", ".JPG", FileTypeOther}, // Should be lowercase
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GetFileType(tt.ext)
			if result != tt.expected {
				t.Errorf("GetFileType(%s) = %v, want %v", tt.ext, result, tt.expected)
			}
		})
	}
}

func TestGetMimeType(t *testing.T) {
	tests := []struct {
		name     string
		ext      string
		expected string
	}{
		{"JPEG", ".jpg", "image/jpeg"},
		{"PNG", ".png", "image/png"},
		{"GIF", ".gif", "image/gif"},
		{"MP4", ".mp4", "video/mp4"},
		{"WebM", ".webm", "video/webm"},
		{"WPL playlist", ".wpl", "application/vnd.ms-wpl"},
		{"Unknown extension", ".xyz", "application/octet-stream"},
		{"Empty extension", "", "application/octet-stream"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GetMimeType(tt.ext)
			if result != tt.expected {
				t.Errorf("GetMimeType(%s) = %s, want %s", tt.ext, result, tt.expected)
			}
		})
	}
}

func TestIsMediaFile(t *testing.T) {
	tests := []struct {
		name     string
		ext      string
		expected bool
	}{
		{"JPEG is media", ".jpg", true},
		{"PNG is media", ".png", true},
		{"MP4 is media", ".mp4", true},
		{"WPL is media", ".wpl", true},
		{"TXT is not media", ".txt", false},
		{"Unknown is not media", ".xyz", false},
		{"Empty is not media", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsMediaFile(tt.ext)
			if result != tt.expected {
				t.Errorf("IsMediaFile(%s) = %v, want %v", tt.ext, result, tt.expected)
			}
		})
	}
}

func TestIsSupportedImage(t *testing.T) {
	tests := []struct {
		name     string
		ext      string
		expected bool
	}{
		{"JPEG supported", ".jpg", true},
		{"PNG supported", ".png", true},
		{"GIF supported", ".gif", true},
		{"WebP supported", ".webp", true},
		{"HEIC supported", ".heic", true},
		{"MP4 not image", ".mp4", false},
		{"TXT not image", ".txt", false},
		{"Empty not image", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsSupportedImage(tt.ext)
			if result != tt.expected {
				t.Errorf("IsSupportedImage(%s) = %v, want %v", tt.ext, result, tt.expected)
			}
		})
	}
}

func TestIsSupportedVideo(t *testing.T) {
	tests := []struct {
		name     string
		ext      string
		expected bool
	}{
		{"MP4 supported", ".mp4", true},
		{"MKV supported", ".mkv", true},
		{"AVI supported", ".avi", true},
		{"WebM supported", ".webm", true},
		{"JPEG not video", ".jpg", false},
		{"TXT not video", ".txt", false},
		{"Empty not video", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsSupportedVideo(tt.ext)
			if result != tt.expected {
				t.Errorf("IsSupportedVideo(%s) = %v, want %v", tt.ext, result, tt.expected)
			}
		})
	}
}

func TestGetFileTypeConsistency(t *testing.T) {
	// Test that GetFileType is consistent with IsSupportedImage/IsSupportedVideo
	for ext := range ImageExtensions {
		if !IsSupportedImage(ext) {
			t.Errorf("Extension %s in ImageExtensions but IsSupportedImage returns false", ext)
		}
		if GetFileType(ext) != FileTypeImage {
			t.Errorf("Extension %s in ImageExtensions but GetFileType returns %v", ext, GetFileType(ext))
		}
	}

	for ext := range VideoExtensions {
		if !IsSupportedVideo(ext) {
			t.Errorf("Extension %s in VideoExtensions but IsSupportedVideo returns false", ext)
		}
		if GetFileType(ext) != FileTypeVideo {
			t.Errorf("Extension %s in VideoExtensions but GetFileType returns %v", ext, GetFileType(ext))
		}
	}
}

func TestGetMimeTypeConsistency(t *testing.T) {
	// All known extensions should have MIME types
	allExts := make(map[string]bool)
	for ext := range ImageExtensions {
		allExts[ext] = true
	}
	for ext := range VideoExtensions {
		allExts[ext] = true
	}
	for ext := range PlaylistExtensions {
		allExts[ext] = true
	}

	for ext := range allExts {
		mimeType := GetMimeType(ext)
		if mimeType == "application/octet-stream" {
			t.Errorf("Extension %s is a known media type but has no specific MIME type", ext)
		}
	}
}

func BenchmarkExtensionLookup(b *testing.B) {
	exts := []string{".jpg", ".mp4", ".png", ".mkv", ".gif", ".avi"}

	b.Run("ImageExtensions", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			for _, ext := range exts {
				_ = ImageExtensions[ext]
			}
		}
	})

	b.Run("VideoExtensions", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			for _, ext := range exts {
				_ = VideoExtensions[ext]
			}
		}
	})

	b.Run("MimeTypes", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			for _, ext := range exts {
				_ = MimeTypes[ext]
			}
		}
	})
}

func BenchmarkGetFileType(b *testing.B) {
	exts := []string{".jpg", ".mp4", ".png", ".mkv", ".gif", ".avi", ".txt", ".xyz"}

	for i := 0; i < b.N; i++ {
		for _, ext := range exts {
			_ = GetFileType(ext)
		}
	}
}

func BenchmarkGetMimeType(b *testing.B) {
	exts := []string{".jpg", ".mp4", ".png", ".mkv", ".gif", ".avi", ".txt", ".xyz"}

	for i := 0; i < b.N; i++ {
		for _, ext := range exts {
			_ = GetMimeType(ext)
		}
	}
}

func BenchmarkIsMediaFile(b *testing.B) {
	exts := []string{".jpg", ".mp4", ".png", ".mkv", ".gif", ".avi", ".txt", ".xyz"}

	for i := 0; i < b.N; i++ {
		for _, ext := range exts {
			_ = IsMediaFile(ext)
		}
	}
}
