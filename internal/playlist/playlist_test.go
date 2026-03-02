package playlist

import (
	"context"
	"errors"
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

	_, err := ParseWPL(context.Background(), wplPath, mediaDir)
	if err == nil {
		t.Error("Expected error when parsing invalid XML")
	}
}

func TestParseWPLNonexistent(t *testing.T) {
	tmpDir := t.TempDir()
	wplPath := filepath.Join(tmpDir, "nonexistent.wpl")
	mediaDir := tmpDir

	_, err := ParseWPL(context.Background(), wplPath, mediaDir)
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

	playlist, err := ParseWPL(context.Background(), wplPath, mediaDir)
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

	playlist, err := ParseWPL(context.Background(), wplPath, tmpDir)
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

// TestParseWPLCancelledBeforeRead verifies that ParseWPL respects a context that
// is already canceled before the call is made, returning the context error rather
// than attempting any filesystem I/O.
func TestParseWPLCancelledBeforeRead(t *testing.T) {
	tmpDir := t.TempDir()
	wplPath := filepath.Join(tmpDir, "test.wpl")
	mediaDir := tmpDir

	wplContent := `<?xml version="1.0" encoding="UTF-8"?>
<smil><head><title>Test</title></head><body><seq></seq></body></smil>`
	if err := os.WriteFile(wplPath, []byte(wplContent), 0o644); err != nil {
		t.Fatalf("failed to write wpl file: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	_, err := ParseWPL(ctx, wplPath, mediaDir)
	if err == nil {
		t.Fatal("expected error for canceled context, got nil")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

// TestParseWPLDeadlineExceeded verifies that ParseWPL returns an error when the
// context deadline has already passed.
func TestParseWPLDeadlineExceeded(t *testing.T) {
	tmpDir := t.TempDir()
	wplPath := filepath.Join(tmpDir, "test.wpl")
	mediaDir := tmpDir

	wplContent := `<?xml version="1.0" encoding="UTF-8"?>
<smil><head><title>Test</title></head><body><seq></seq></body></smil>`
	if err := os.WriteFile(wplPath, []byte(wplContent), 0o644); err != nil {
		t.Fatalf("failed to write wpl file: %v", err)
	}

	// Create a context whose deadline is already exceeded
	ctx, cancel := context.WithTimeout(context.Background(), 1)
	defer cancel()
	// Ensure it has expired
	<-ctx.Done()

	_, err := ParseWPL(ctx, wplPath, mediaDir)
	if err == nil {
		t.Fatal("expected error for expired deadline, got nil")
	}
}

// TestParseWPLActiveContextSucceeds confirms that ParseWPL works normally when
// the context is active (regression guard for the context checks).
func TestParseWPLActiveContextSucceeds(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	playlistDir := filepath.Join(tmpDir, "playlists")

	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		t.Fatalf("failed to create mediaDir: %v", err)
	}
	if err := os.MkdirAll(playlistDir, 0o755); err != nil {
		t.Fatalf("failed to create playlistDir: %v", err)
	}

	wplPath := filepath.Join(playlistDir, "ctx.wpl")
	wplContent := `<?xml version="1.0" encoding="UTF-8"?>
<smil>
	<head><title>Context Test</title></head>
	<body><seq><media src="track.mp3"/></seq></body>
</smil>`
	if err := os.WriteFile(wplPath, []byte(wplContent), 0o644); err != nil {
		t.Fatalf("failed to write wpl file: %v", err)
	}

	pl, err := ParseWPL(context.Background(), wplPath, mediaDir)
	if err != nil {
		t.Fatalf("unexpected error with active context: %v", err)
	}
	if pl.Name != "Context Test" {
		t.Errorf("expected Name='Context Test', got %q", pl.Name)
	}
	if len(pl.Items) != 1 {
		t.Errorf("expected 1 item, got %d", len(pl.Items))
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

// =============================================================================
// resolveUNCPath coverage
// =============================================================================

// makeUNCItem returns a minimal PlaylistItem suitable for direct calls to
// resolveUNCPath / resolveAbsolutePath.
func makeUNCItem(src string) PlaylistItem {
	return PlaylistItem{
		OrigPath:  src,
		Name:      filepath.Base(src),
		MediaType: getMediaType(filepath.Base(src)),
	}
}

// TestResolveUNCPathMalformed verifies that a UNC path with fewer than three
// components (server + share + filename) is returned unchanged with Exists=false.
func TestResolveUNCPathMalformed(t *testing.T) {
	tmpDir := t.TempDir()
	// "//server" → only 1 component after stripping "//", so len(parts) < 3.
	src := "//server"
	item := resolveUNCPath(src, tmpDir, tmpDir, makeUNCItem(src))
	if item.Exists {
		t.Errorf("expected Exists=false for malformed UNC path, got true")
	}
	if item.Path != "" {
		t.Errorf("expected empty Path for malformed UNC path, got %q", item.Path)
	}
}

// TestResolveUNCPathStrategy1PlaylistDir verifies Strategy 1: the bare filename
// is found directly inside the playlist directory.
func TestResolveUNCPathStrategy1PlaylistDir(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")
	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// Place the file in the playlist directory so Strategy 1 hits.
	os.WriteFile(filepath.Join(playlistDir, "clip.mp4"), []byte("v"), 0o644)

	src := "//server/share/nested/clip.mp4"
	item := resolveUNCPath(src, playlistDir, mediaDir, makeUNCItem(src))
	if !item.Exists {
		t.Errorf("expected Exists=true when file is in playlistDir (Strategy 1)")
	}
}

// TestResolveUNCPathStrategy2PlaylistDir verifies Strategy 2 (sub-path match)
// when the file is found inside the playlist directory rather than the media
// directory.
func TestResolveUNCPathStrategy2PlaylistDir(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")
	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// UNC: //server/share/sub/clip.mp4 – parts=[server,share,sub,clip.mp4]
	// Strategy 2 i=2: subPath = "sub/clip.mp4"
	//   → mediaDir/sub/clip.mp4   (don't create)
	//   → playlistDir/sub/clip.mp4 (create this)
	subDir := filepath.Join(playlistDir, "sub")
	os.MkdirAll(subDir, 0o755)
	os.WriteFile(filepath.Join(subDir, "clip.mp4"), []byte("v"), 0o644)

	src := "//server/share/sub/clip.mp4"
	item := resolveUNCPath(src, playlistDir, mediaDir, makeUNCItem(src))
	if !item.Exists {
		t.Errorf("expected Exists=true when file is in playlistDir sub-path (Strategy 2)")
	}
}

// TestResolveUNCPathStrategy3ShareAsRoot verifies Strategy 3: the UNC share
// name maps to a sub-directory of the media directory.
func TestResolveUNCPathStrategy3ShareAsRoot(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")
	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// UNC: //server/Videos/sub/clip.mp4 – parts=[server,Videos,sub,clip.mp4]
	// Strategy 1 & 2 must all miss; Strategy 3 tries
	//   mediaDir/Videos/sub/clip.mp4
	shareSubDir := filepath.Join(mediaDir, "Videos", "sub")
	os.MkdirAll(shareSubDir, 0o755)
	os.WriteFile(filepath.Join(shareSubDir, "clip.mp4"), []byte("v"), 0o644)

	src := "//server/Videos/sub/clip.mp4"
	item := resolveUNCPath(src, playlistDir, mediaDir, makeUNCItem(src))
	if !item.Exists {
		t.Errorf("expected Exists=true when file matches share-as-root (Strategy 3)")
	}
}

// TestResolveUNCPathNotFound verifies the final return path: all strategies
// exhausted, Exists stays false.
func TestResolveUNCPathNotFound(t *testing.T) {
	tmpDir := t.TempDir()
	src := "//server/share/missing/clip.mp4"
	item := resolveUNCPath(src, tmpDir, tmpDir, makeUNCItem(src))
	if item.Exists {
		t.Errorf("expected Exists=false when no strategy finds the file")
	}
}

// =============================================================================
// resolveAbsolutePath coverage
// =============================================================================

// TestResolveAbsolutePathStrategy1PlaylistDir verifies Strategy 1: the bare
// filename is found directly in the playlist directory.
func TestResolveAbsolutePathStrategy1PlaylistDir(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")
	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// Place only the filename in the playlist directory.
	os.WriteFile(filepath.Join(playlistDir, "clip.mp4"), []byte("v"), 0o644)

	src := "C:/Videos/folder/clip.mp4"
	// normalizedSrc = "C:/Videos/folder/clip.mp4", filename = "clip.mp4"
	// Strategy 1 tries playlistDir/clip.mp4 → exists
	item := resolveAbsolutePath(src, playlistDir, mediaDir, makeUNCItem(src))
	if !item.Exists {
		t.Errorf("expected Exists=true when filename found in playlistDir (Strategy 1)")
	}
}

// TestResolveAbsolutePathStrategy2PlaylistDir verifies Strategy 2 (sub-path
// match) when the file is found in the playlist directory tree.
func TestResolveAbsolutePathStrategy2PlaylistDir(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")
	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// src = "C:/Videos/folder/clip.mp4"
	// pathWithoutDrive = "Videos/folder/clip.mp4", parts = [Videos, folder, clip.mp4]
	// Strategy 1: playlistDir/clip.mp4 – don't create
	// Strategy 2 i=0: subPath = "Videos/folder/clip.mp4"
	//   → mediaDir/Videos/folder/clip.mp4 – don't create
	//   → playlistDir/Videos/folder/clip.mp4 – CREATE this
	subDir := filepath.Join(playlistDir, "Videos", "folder")
	os.MkdirAll(subDir, 0o755)
	os.WriteFile(filepath.Join(subDir, "clip.mp4"), []byte("v"), 0o644)

	src := "C:/Videos/folder/clip.mp4"
	item := resolveAbsolutePath(src, playlistDir, mediaDir, makeUNCItem(src))
	if !item.Exists {
		t.Errorf("expected Exists=true when sub-path found in playlistDir (Strategy 2)")
	}
}

// TestResolveAbsolutePathNotFound verifies the final return when every strategy
// fails to locate the file.
func TestResolveAbsolutePathNotFound(t *testing.T) {
	tmpDir := t.TempDir()
	src := "C:/Videos/missing/clip.mp4"
	item := resolveAbsolutePath(src, tmpDir, tmpDir, makeUNCItem(src))
	if item.Exists {
		t.Errorf("expected Exists=false when no strategy finds the file")
	}
}

// TestParsePlaylistContextAlreadyCanceled verifies that Parse returns the
// context error when the context is already canceled after ReadFile succeeds
// but before XML unmarshalling (wpl.go:60-62).
func TestParsePlaylistContextAlreadyCanceled(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	os.MkdirAll(mediaDir, 0o755)

	// Minimal valid WPL file.
	wplContent := `<?xml version="1.0" encoding="UTF-8"?>
<smil>
  <head><title>Test</title></head>
  <body><seq></seq></body>
</smil>`
	wplPath := filepath.Join(tmpDir, "test.wpl")
	if err := os.WriteFile(wplPath, []byte(wplContent), 0o644); err != nil {
		t.Fatalf("failed to write wpl file: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before calling Parse

	_, err := ParseWPL(ctx, wplPath, mediaDir)
	if err == nil {
		t.Fatal("expected an error from canceled context, got nil")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

// TestGetRelativePathOutsideMediaDir verifies that getRelativePath returns the
// original fullPath when the computed relative path escapes mediaDir via ".."
// (wpl.go:277-279).
func TestGetRelativePathOutsideMediaDir(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	// fullPath is a sibling directory — relative path will start with ".."
	fullPath := filepath.Join(tmpDir, "other", "clip.mp4")

	result := getRelativePath(fullPath, mediaDir)
	if result != fullPath {
		t.Errorf("expected original fullPath %q, got %q", fullPath, result)
	}
	if !strings.HasPrefix(result, tmpDir) {
		t.Errorf("expected result to be an absolute path under tmpDir, got %q", result)
	}
}

// =============================================================================
// resolveRelativePath strategy 2 & 3 (wpl.go:239-243, 256-260)
// =============================================================================

// TestResolveRelativePathStrategy2MediaDir verifies that resolveRelativePath
// finds a file by looking up its relative sub-path inside mediaDir when it is
// absent from playlistDir (wpl.go:239-243: testPath = filepath.Join(mediaDir,
// normalizedSrc); fileExists(testPath) == true).
func TestResolveRelativePathStrategy2MediaDir(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")
	os.MkdirAll(playlistDir, 0o755)

	// Create the file only under mediaDir, not under playlistDir.
	subDir := filepath.Join(mediaDir, "sub")
	os.MkdirAll(subDir, 0o755)
	os.WriteFile(filepath.Join(subDir, "clip.mp4"), []byte("v"), 0o644)

	// src = "sub/clip.mp4":
	//   Strategy 1: playlistDir/sub/clip.mp4  — doesn't exist.
	//   Strategy 2: mediaDir/sub/clip.mp4     — exists (covered by this test).
	src := "sub/clip.mp4"
	item := resolveRelativePath(src, playlistDir, mediaDir, makeUNCItem(src))
	if !item.Exists {
		t.Errorf("expected Exists=true when file is found via mediaDir subpath (Strategy 2)")
	}
	if item.Path != "sub/clip.mp4" && item.Path != filepath.Join("sub", "clip.mp4") {
		t.Errorf("unexpected Path %q", item.Path)
	}
}

// TestResolveRelativePathStrategy3BareFilenamePlaylistDir verifies that
// resolveRelativePath finds a file by matching just its basename in playlistDir
// when neither the full sub-path in playlistDir nor any path in mediaDir
// exists (wpl.go:256-260: testPath = filepath.Join(playlistDir, filename)).
func TestResolveRelativePathStrategy3BareFilenamePlaylistDir(t *testing.T) {
	tmpDir := t.TempDir()
	playlistDir := filepath.Join(tmpDir, "playlists")
	mediaDir := filepath.Join(tmpDir, "media")
	os.MkdirAll(playlistDir, 0o755)
	os.MkdirAll(mediaDir, 0o755)

	// Create the file as a bare filename in playlistDir only.
	os.WriteFile(filepath.Join(playlistDir, "clip.mp4"), []byte("v"), 0o644)

	// src = "folder/2024/clip.mp4":
	//   Strategy 1: playlistDir/folder/2024/clip.mp4 — doesn't exist.
	//   Strategy 2: mediaDir/folder/2024/clip.mp4    — doesn't exist.
	//   Strategy 3: playlistDir/clip.mp4             — exists (covered here).
	src := "folder/2024/clip.mp4"
	item := resolveRelativePath(src, playlistDir, mediaDir, makeUNCItem(src))
	if !item.Exists {
		t.Errorf("expected Exists=true when bare filename is found in playlistDir (Strategy 3)")
	}
}
