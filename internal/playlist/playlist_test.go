package playlist

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlaylistItem(t *testing.T) {
	item := PlaylistItem{
		Name:      "test.mp4",
		Path:      "videos/test.mp4",
		OrigPath:  "C:\\Videos\\test.mp4",
		Exists:    true,
		MediaType: "video",
	}

	if item.Name != "test.mp4" {
		t.Errorf("Expected Name=test.mp4, got %s", item.Name)
	}
	if item.Path != "videos/test.mp4" {
		t.Errorf("Expected Path=videos/test.mp4, got %s", item.Path)
	}
	if item.OrigPath != "C:\\Videos\\test.mp4" {
		t.Errorf("Expected OrigPath=C:\\Videos\\test.mp4, got %s", item.OrigPath)
	}
	if item.MediaType != "video" {
		t.Errorf("Expected MediaType=video, got %s", item.MediaType)
	}
	if !item.Exists {
		t.Error("Expected Exists=true")
	}
}

func TestGetMediaType(t *testing.T) {
	tests := []struct {
		filename string
		expected string
	}{
		{"video.mp4", "video"},
		{"video.mkv", "video"},
		{"video.avi", "video"},
		{"video.mov", "video"},
		{"audio.mp3", "audio"},
		{"audio.wav", "audio"},
		{"audio.flac", "audio"},
		{"document.txt", "unknown"},
		{"image.jpg", "unknown"},
		{"noext", "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			got := getMediaType(tt.filename)
			if got != tt.expected {
				t.Errorf("getMediaType(%s) = %s, want %s", tt.filename, got, tt.expected)
			}
		})
	}
}

func TestFileExists(t *testing.T) {
	// Create a temp file
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	err := os.WriteFile(testFile, []byte("test"), 0o644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	tests := []struct {
		name     string
		path     string
		expected bool
	}{
		{
			name:     "Existing file",
			path:     testFile,
			expected: true,
		},
		{
			name:     "Non-existent file",
			path:     filepath.Join(tmpDir, "nonexistent.txt"),
			expected: false,
		},
		{
			name:     "Directory",
			path:     tmpDir,
			expected: false, // fileExists should return false for directories
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := fileExists(tt.path)
			if got != tt.expected {
				t.Errorf("fileExists(%s) = %v, want %v", tt.path, got, tt.expected)
			}
		})
	}
}

func TestGetRelativePath(t *testing.T) {
	tests := []struct {
		name      string
		fullPath  string
		mediaDir  string
		expectRel bool
	}{
		{
			name:      "Path under mediaDir",
			fullPath:  "/media/videos/test.mp4",
			mediaDir:  "/media",
			expectRel: true,
		},
		{
			name:      "Path outside mediaDir",
			fullPath:  "/other/videos/test.mp4",
			mediaDir:  "/media",
			expectRel: false,
		},
		{
			name:      "Path attempting to escape",
			fullPath:  "/test.mp4",
			mediaDir:  "/media/videos",
			expectRel: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := getRelativePath(tt.fullPath, tt.mediaDir)

			if tt.expectRel {
				// Should be a relative path
				if filepath.IsAbs(got) {
					t.Errorf("Expected relative path, got absolute: %s", got)
				}
				// Should not start with ".."
				if strings.HasPrefix(got, "..") {
					t.Errorf("Relative path should not escape mediaDir: %s", got)
				}
			} else if got != tt.fullPath {
				// Should return original path if not under mediaDir
				t.Errorf("Expected original path %s, got %s", tt.fullPath, got)
			}
		})
	}
}

func TestResolveMediaPathTypes(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")
	// Create directories
	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// Create a test video file
	testFile := filepath.Join(mediaDir, "test.mp4")
	os.WriteFile(testFile, []byte("fake video"), 0o644)

	tests := []struct {
		name       string
		src        string
		expectType string
	}{
		{
			name:       "Relative path",
			src:        "test.mp4",
			expectType: "relative",
		},
		{
			name:       "UNC path",
			src:        "//server/share/test.mp4",
			expectType: "unc",
		},
		{
			name:       "Windows absolute path",
			src:        "C:/videos/test.mp4",
			expectType: "absolute",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item := resolveMediaPath(tt.src, playlistDir, mediaDir)

			if item.Name == "" {
				t.Error("Expected Name to be populated")
			}
			if item.OrigPath != tt.src {
				t.Errorf("Expected OrigPath=%s, got %s", tt.src, item.OrigPath)
			}
			if item.MediaType == "" {
				t.Error("Expected MediaType to be set")
			}
		})
	}
}

func TestResolveRelativePath(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")

	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// Create test file in media directory
	testFile := filepath.Join(mediaDir, "video.mp4")
	os.WriteFile(testFile, []byte("test"), 0o644)

	item := PlaylistItem{
		OrigPath: "video.mp4",
		Name:     "video.mp4",
	}

	resolved := resolveRelativePath("video.mp4", playlistDir, mediaDir, item)

	if !resolved.Exists {
		t.Error("Expected file to be found and Exists=true")
	}
	if resolved.Path == "" {
		t.Error("Expected Path to be set")
	}
}

func TestResolveMediaPathNotFound(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")

	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	item := resolveMediaPath("nonexistent.mp4", playlistDir, mediaDir)

	if item.Exists {
		t.Error("Expected Exists=false for nonexistent file")
	}
	if item.Name != "nonexistent.mp4" {
		t.Errorf("Expected Name=nonexistent.mp4, got %s", item.Name)
	}
}

func TestParseWPLInvalidFile(t *testing.T) {
	tmpDir := t.TempDir()
	wplPath := filepath.Join(tmpDir, "test.wpl")
	mediaDir := tmpDir

	// Create an invalid WPL file (not XML)
	os.WriteFile(wplPath, []byte("not xml"), 0o644)

	_, err := ParseWPL(wplPath, mediaDir)
	if err == nil {
		t.Error("Expected error when parsing invalid XML")
	}
}

func TestParseWPLNonexistent(t *testing.T) {
	tmpDir := t.TempDir()
	wplPath := filepath.Join(tmpDir, "nonexistent.wpl")
	mediaDir := tmpDir

	_, err := ParseWPL(wplPath, mediaDir)
	if err == nil {
		t.Error("Expected error when parsing nonexistent file")
	}
}

func TestParseWPLValidFile(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")

	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// Create a test video file
	testVideo := filepath.Join(mediaDir, "test.mp4")
	os.WriteFile(testVideo, []byte("fake video"), 0o644)

	// Create a valid WPL file
	wplPath := filepath.Join(playlistDir, "test.wpl")
	wplContent := `<?xml version="1.0" encoding="UTF-8"?>
<smil>
	<head>
		<title>Test Playlist</title>
	</head>
	<body>
		<seq>
			<media src="test.mp4"/>
		</seq>
	</body>
</smil>`

	os.WriteFile(wplPath, []byte(wplContent), 0o644)

	playlist, err := ParseWPL(wplPath, mediaDir)
	if err != nil {
		t.Fatalf("Failed to parse valid WPL: %v", err)
	}

	if playlist.Name != "Test Playlist" {
		t.Errorf("Expected Name='Test Playlist', got %s", playlist.Name)
	}

	if len(playlist.Items) != 1 {
		t.Fatalf("Expected 1 item, got %d", len(playlist.Items))
	}

	item := playlist.Items[0]
	if item.Name != "test.mp4" {
		t.Errorf("Expected item Name=test.mp4, got %s", item.Name)
	}
}

func TestParseWPLEmptyPlaylist(t *testing.T) {
	tmpDir := t.TempDir()
	wplPath := filepath.Join(tmpDir, "empty.wpl")

	wplContent := `<?xml version="1.0" encoding="UTF-8"?>
<smil>
	<head>
		<title>Empty Playlist</title>
	</head>
	<body>
		<seq>
		</seq>
	</body>
</smil>`

	os.WriteFile(wplPath, []byte(wplContent), 0o644)

	playlist, err := ParseWPL(wplPath, tmpDir)
	if err != nil {
		t.Fatalf("Failed to parse empty playlist: %v", err)
	}

	if len(playlist.Items) != 0 {
		t.Errorf("Expected 0 items in empty playlist, got %d", len(playlist.Items))
	}
}

func TestPlaylistStruct(t *testing.T) {
	playlist := &Playlist{
		Name: "Test",
		Path: "/path/to/test.wpl",
		Items: []PlaylistItem{
			{Name: "video1.mp4", Exists: true},
			{Name: "video2.mp4", Exists: false},
		},
	}

	if playlist.Name != "Test" {
		t.Errorf("Expected Name=Test, got %s", playlist.Name)
	}

	if playlist.Path != "/path/to/test.wpl" {
		t.Errorf("Expected Path=/path/to/test.wpl, got %s", playlist.Path)
	}

	if len(playlist.Items) != 2 {
		t.Errorf("Expected 2 items, got %d", len(playlist.Items))
	}

	existingCount := 0
	for _, item := range playlist.Items {
		if item.Exists {
			existingCount++
		}
	}

	if existingCount != 1 {
		t.Errorf("Expected 1 existing file, got %d", existingCount)
	}
}

func BenchmarkResolveMediaPath(b *testing.B) {
	tmpDir := b.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")

	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// Create a test file
	testFile := filepath.Join(mediaDir, "test.mp4")
	os.WriteFile(testFile, []byte("test"), 0o644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = resolveMediaPath("test.mp4", playlistDir, mediaDir)
	}
}

func BenchmarkGetMediaType(b *testing.B) {
	filenames := []string{
		"video.mp4",
		"video.mkv",
		"audio.mp3",
		"document.txt",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, fn := range filenames {
			_ = getMediaType(fn)
		}
	}
}
