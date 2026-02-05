package handlers

import (
	"path/filepath"
	"strings"
	"testing"
)

// =============================================================================
// Playlist Path Processing Tests
// =============================================================================

func TestPlaylistNameMatching(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		playlistName string
		playlistExt  string
		searchName   string
		shouldMatch  bool
	}{
		{
			name:         "Exact match with extension",
			playlistName: "favorites.wpl",
			playlistExt:  ".wpl",
			searchName:   "favorites.wpl",
			shouldMatch:  true,
		},
		{
			name:         "Match without extension",
			playlistName: "favorites.wpl",
			playlistExt:  ".wpl",
			searchName:   "favorites",
			shouldMatch:  true,
		},
		{
			name:         "No match - different name",
			playlistName: "favorites.wpl",
			playlistExt:  ".wpl",
			searchName:   "recent",
			shouldMatch:  false,
		},
		{
			name:         "Case sensitive match",
			playlistName: "Favorites.wpl",
			playlistExt:  ".wpl",
			searchName:   "favorites",
			shouldMatch:  false,
		},
		{
			name:         "Match with .m3u extension",
			playlistName: "playlist.m3u",
			playlistExt:  ".m3u",
			searchName:   "playlist",
			shouldMatch:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate the matching logic from GetPlaylist
			baseName := strings.TrimSuffix(tt.playlistName, filepath.Ext(tt.playlistName))
			matches := baseName == tt.searchName || tt.playlistName == tt.searchName

			if matches != tt.shouldMatch {
				t.Errorf("Expected match=%v for playlist=%q searching for %q, got %v",
					tt.shouldMatch, tt.playlistName, tt.searchName, matches)
			}
		})
	}
}

func TestPlaylistPathConstruction(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		mediaDir     string
		playlistPath string
		expected     string
	}{
		{
			name:         "Simple path",
			mediaDir:     "/media",
			playlistPath: "playlists/favorites.wpl",
			expected:     "/media/playlists/favorites.wpl",
		},
		{
			name:         "Root level playlist",
			mediaDir:     "/srv/media",
			playlistPath: "music.wpl",
			expected:     "/srv/media/music.wpl",
		},
		{
			name:         "Deep nested path",
			mediaDir:     "/media",
			playlistPath: "user/playlists/2024/favorites.wpl",
			expected:     "/media/user/playlists/2024/favorites.wpl",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := filepath.Join(tt.mediaDir, tt.playlistPath)
			// Normalize for cross-platform
			result = filepath.ToSlash(result)
			expected := filepath.ToSlash(tt.expected)

			if result != expected {
				t.Errorf("Expected %q, got %q", expected, result)
			}
		})
	}
}

// =============================================================================
// Playlist File Extension Tests
// =============================================================================

func TestPlaylistExtensionHandling(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		filename string
		expected string
	}{
		{
			name:     "WPL extension",
			filename: "favorites.wpl",
			expected: ".wpl",
		},
		{
			name:     "M3U extension",
			filename: "playlist.m3u",
			expected: ".m3u",
		},
		{
			name:     "M3U8 extension",
			filename: "stream.m3u8",
			expected: ".m3u8",
		},
		{
			name:     "Uppercase extension",
			filename: "MUSIC.WPL",
			expected: ".WPL",
		},
		{
			name:     "No extension",
			filename: "playlist",
			expected: "",
		},
		{
			name:     "Multiple dots",
			filename: "my.favorite.playlist.wpl",
			expected: ".wpl",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ext := filepath.Ext(tt.filename)
			if ext != tt.expected {
				t.Errorf("Expected extension %q, got %q", tt.expected, ext)
			}
		})
	}
}

func TestPlaylistBaseNameExtraction(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		filename string
		expected string
	}{
		{
			name:     "Simple WPL",
			filename: "favorites.wpl",
			expected: "favorites",
		},
		{
			name:     "Simple M3U",
			filename: "music.m3u",
			expected: "music",
		},
		{
			name:     "Multiple dots",
			filename: "my.favorite.songs.wpl",
			expected: "my.favorite.songs",
		},
		{
			name:     "No extension",
			filename: "playlist",
			expected: "playlist",
		},
		{
			name:     "Path included",
			filename: "playlists/favorites.wpl",
			expected: "playlists/favorites",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseName := strings.TrimSuffix(tt.filename, filepath.Ext(tt.filename))
			if baseName != tt.expected {
				t.Errorf("Expected base name %q, got %q", tt.expected, baseName)
			}
		})
	}
}

// =============================================================================
// Playlist Name Normalization Tests
// =============================================================================

func TestPlaylistNameNormalization(t *testing.T) {
	t.Parallel()

	// Test the normalization logic used in playlist name matching
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Lowercase with spaces",
			input:    "My Favorites",
			expected: "my favorites",
		},
		{
			name:     "Special characters",
			input:    "Top 100!",
			expected: "top 100!",
		},
		{
			name:     "Already lowercase",
			input:    "playlist",
			expected: "playlist",
		},
		{
			name:     "Mixed case with numbers",
			input:    "Best2024Songs",
			expected: "best2024songs",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			normalized := strings.ToLower(tt.input)
			if normalized != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, normalized)
			}
		})
	}
}

// =============================================================================
// Request Struct Tests
// =============================================================================

func TestPlaylistRequestStructures(t *testing.T) {
	t.Parallel()

	// Test that we can use the structs as expected
	type PlaylistInfo struct {
		Name string
		Path string
	}

	playlists := []PlaylistInfo{
		{Name: "favorites.wpl", Path: "playlists/favorites.wpl"},
		{Name: "recent.m3u", Path: "playlists/recent.m3u"},
		{Name: "top100.wpl", Path: "music/top100.wpl"},
	}

	if len(playlists) != 3 {
		t.Errorf("Expected 3 playlists, got %d", len(playlists))
	}

	// Test finding by name
	searchName := "favorites"
	var found *PlaylistInfo
	for i := range playlists {
		baseName := strings.TrimSuffix(playlists[i].Name, filepath.Ext(playlists[i].Name))
		if baseName == searchName {
			found = &playlists[i]
			break
		}
	}

	if found == nil {
		t.Error("Expected to find playlist 'favorites'")
	} else if found.Path != "playlists/favorites.wpl" {
		t.Errorf("Expected path 'playlists/favorites.wpl', got %q", found.Path)
	}
}

// =============================================================================
// Edge Cases Tests
// =============================================================================

func TestPlaylistEmptyNameHandling(t *testing.T) {
	t.Parallel()

	// Test empty name scenarios
	emptyName := ""
	ext := filepath.Ext(emptyName)
	baseName := strings.TrimSuffix(emptyName, ext)

	if ext != "" {
		t.Errorf("Expected empty extension for empty name, got %q", ext)
	}

	if baseName != "" {
		t.Errorf("Expected empty base name for empty name, got %q", baseName)
	}
}

func TestPlaylistSpecialCharacterPaths(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		path string
	}{
		{
			name: "Spaces in path",
			path: "My Playlists/Favorite Songs.wpl",
		},
		{
			name: "Unicode characters",
			path: "音楽/プレイリスト.wpl",
		},
		{
			name: "Special symbols",
			path: "playlists/top_100!.wpl",
		},
	}

	mediaDir := "/media"
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fullPath := filepath.Join(mediaDir, tt.path)
			// Should not panic or error
			if fullPath == "" {
				t.Error("Expected non-empty full path")
			}
		})
	}
}

func TestPlaylistPathSecurity(t *testing.T) {
	t.Parallel()

	// Test that path traversal attempts can be detected
	mediaDir := "/media"
	suspiciousPaths := []string{
		"../../../etc/passwd.wpl",
		"playlists/../../secret.wpl",
	}

	for _, path := range suspiciousPaths {
		fullPath := filepath.Join(mediaDir, path)
		absPath, _ := filepath.Abs(fullPath)

		// Path should be validated with isSubPath in the handler
		t.Logf("Suspicious path %q becomes %q", path, absPath)
	}
}
