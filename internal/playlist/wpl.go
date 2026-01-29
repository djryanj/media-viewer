package playlist

import (
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"media-viewer/internal/logging"
)

// WPL represents a Windows Playlist file
type WPL struct {
	XMLName xml.Name `xml:"smil"`
	Head    struct {
		Title string `xml:"title"`
	} `xml:"head"`
	Body struct {
		Seq struct {
			Media []struct {
				Src string `xml:"src,attr"`
			} `xml:"media"`
		} `xml:"seq"`
	} `xml:"body"`
}

// Playlist represents a parsed playlist
type Playlist struct {
	Name  string         `json:"name"`
	Path  string         `json:"path"`
	Items []PlaylistItem `json:"items"`
}

// PlaylistItem represents a single item in a playlist
type PlaylistItem struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	OrigPath  string `json:"origPath,omitempty"`
	Exists    bool   `json:"exists"`
	MediaType string `json:"mediaType,omitempty"`
}

// ParseWPL parses a Windows Playlist file
func ParseWPL(wplPath, mediaDir string) (*Playlist, error) {
	logging.Debug("Parsing WPL: %s (mediaDir: %s)", wplPath, mediaDir)

	data, err := os.ReadFile(wplPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read playlist file: %w", err)
	}

	var wpl WPL
	if err := xml.Unmarshal(data, &wpl); err != nil {
		return nil, fmt.Errorf("failed to parse playlist XML: %w", err)
	}

	playlistDir := filepath.Dir(wplPath)
	playlistName := strings.TrimSuffix(filepath.Base(wplPath), filepath.Ext(wplPath))

	if wpl.Head.Title != "" {
		playlistName = wpl.Head.Title
	}

	logging.Debug("Playlist name: %s, directory: %s", playlistName, playlistDir)

	playlist := &Playlist{
		Name:  playlistName,
		Path:  wplPath,
		Items: make([]PlaylistItem, 0, len(wpl.Body.Seq.Media)),
	}

	for _, media := range wpl.Body.Seq.Media {
		item := resolveMediaPath(media.Src, playlistDir, mediaDir)
		playlist.Items = append(playlist.Items, item)
	}

	logging.Debug("Parsed %d items from playlist", len(playlist.Items))

	return playlist, nil
}

// resolveMediaPath resolves a media path from the playlist to an actual file
// This version prioritizes speed over exhaustive searching
func resolveMediaPath(src, playlistDir, mediaDir string) PlaylistItem {
	item := PlaylistItem{
		OrigPath: src,
		Name:     filepath.Base(src),
	}

	// Normalize the source path (convert backslashes to forward slashes for processing)
	normalizedSrc := strings.ReplaceAll(src, "\\", "/")

	// Extract just the filename for fallback matching
	filename := filepath.Base(normalizedSrc)
	item.Name = filename

	// Determine media type early
	item.MediaType = getMediaType(filename)

	// Try resolution strategies in order of speed (fastest first)
	switch {
	case strings.HasPrefix(normalizedSrc, "//"):
		// UNC path
		item = resolveUNCPath(normalizedSrc, playlistDir, mediaDir, item)
	case filepath.IsAbs(src) || (len(src) > 1 && src[1] == ':'):
		// Absolute path (including Windows drive letters)
		item = resolveAbsolutePath(normalizedSrc, playlistDir, mediaDir, item)
	default:
		// Relative path
		item = resolveRelativePath(src, playlistDir, mediaDir, item)
	}

	return item
}

// resolveUNCPath handles UNC paths like \\server\share\path\file.mp4
// Optimized version - no directory walking
func resolveUNCPath(normalizedSrc, playlistDir, mediaDir string, item PlaylistItem) PlaylistItem {
	// Remove the leading // and split into components
	pathWithoutPrefix := strings.TrimPrefix(normalizedSrc, "//")
	parts := strings.Split(pathWithoutPrefix, "/")

	if len(parts) < 3 {
		return item
	}

	filename := parts[len(parts)-1]

	// Strategy 1: Try just the filename in the playlist directory (instant)
	testPath := filepath.Join(playlistDir, filename)
	if fileExists(testPath) {
		item.Path = getRelativePath(testPath, mediaDir)
		item.Exists = true
		return item
	}

	// Strategy 2: Try progressively shorter subpaths (fast - just stat calls)
	// Skip server (parts[0]) and share (parts[1]), use remaining path
	for i := 2; i < len(parts); i++ {
		subPath := strings.Join(parts[i:], string(filepath.Separator))

		// Try in media directory
		testPath = filepath.Join(mediaDir, subPath)
		if fileExists(testPath) {
			item.Path = getRelativePath(testPath, mediaDir)
			item.Exists = true
			return item
		}

		// Try in playlist directory
		testPath = filepath.Join(playlistDir, subPath)
		if fileExists(testPath) {
			item.Path = getRelativePath(testPath, mediaDir)
			item.Exists = true
			return item
		}
	}

	// Strategy 3: Try common path transformations
	// Sometimes the share name maps to a subdirectory
	if len(parts) >= 3 {
		// Try without server, using share as root folder
		// e.g., //server/Videos/folder/file.mp4 -> Videos/folder/file.mp4
		sharePath := strings.Join(parts[1:], string(filepath.Separator))
		testPath = filepath.Join(mediaDir, sharePath)
		if fileExists(testPath) {
			item.Path = getRelativePath(testPath, mediaDir)
			item.Exists = true
			return item
		}
	}

	// Not found - return item with exists=false
	// The path field remains empty, client will show as unavailable
	return item
}

// resolveAbsolutePath handles absolute paths like C:\folder\file.mp4
// Optimized version - no directory walking
func resolveAbsolutePath(normalizedSrc, playlistDir, mediaDir string, item PlaylistItem) PlaylistItem {
	// Remove drive letter if present (e.g., "C:/folder" -> "folder")
	pathWithoutDrive := normalizedSrc
	if len(normalizedSrc) > 2 && normalizedSrc[1] == ':' {
		pathWithoutDrive = normalizedSrc[3:] // Skip "C:/"
	}

	parts := strings.Split(pathWithoutDrive, "/")
	filename := parts[len(parts)-1]

	// Strategy 1: Try just the filename in the playlist directory
	testPath := filepath.Join(playlistDir, filename)
	if fileExists(testPath) {
		item.Path = getRelativePath(testPath, mediaDir)
		item.Exists = true
		return item
	}

	// Strategy 2: Try progressively shorter subpaths
	for i := 0; i < len(parts); i++ {
		subPath := filepath.Join(parts[i:]...)

		testPath = filepath.Join(mediaDir, subPath)
		if fileExists(testPath) {
			item.Path = getRelativePath(testPath, mediaDir)
			item.Exists = true
			return item
		}

		testPath = filepath.Join(playlistDir, subPath)
		if fileExists(testPath) {
			item.Path = getRelativePath(testPath, mediaDir)
			item.Exists = true
			return item
		}
	}

	return item
}

// resolveRelativePath handles relative paths
func resolveRelativePath(src, playlistDir, mediaDir string, item PlaylistItem) PlaylistItem {
	// Normalize path separators
	normalizedSrc := filepath.FromSlash(src)

	// Try relative to playlist directory first
	testPath := filepath.Join(playlistDir, normalizedSrc)
	if fileExists(testPath) {
		item.Path = getRelativePath(testPath, mediaDir)
		item.Exists = true
		return item
	}

	// Try relative to media directory
	testPath = filepath.Join(mediaDir, normalizedSrc)
	if fileExists(testPath) {
		item.Path = getRelativePath(testPath, mediaDir)
		item.Exists = true
		return item
	}

	// Try just the filename in playlist directory
	filename := filepath.Base(normalizedSrc)
	testPath = filepath.Join(playlistDir, filename)
	if fileExists(testPath) {
		item.Path = getRelativePath(testPath, mediaDir)
		item.Exists = true
		return item
	}

	return item
}

// fileExists checks if a file exists and is not a directory
func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

// getRelativePath returns the path relative to mediaDir, or the original path if not under mediaDir
func getRelativePath(fullPath, mediaDir string) string {
	relPath, err := filepath.Rel(mediaDir, fullPath)
	if err != nil {
		return fullPath
	}
	// Make sure it doesn't escape mediaDir
	if strings.HasPrefix(relPath, "..") {
		return fullPath
	}
	return relPath
}

// getMediaType returns the media type based on file extension
func getMediaType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))

	videoExts := map[string]bool{
		".mp4": true, ".mkv": true, ".avi": true, ".mov": true,
		".wmv": true, ".flv": true, ".webm": true, ".m4v": true,
		".mpeg": true, ".mpg": true, ".3gp": true, ".ts": true,
	}

	audioExts := map[string]bool{
		".mp3": true, ".wav": true, ".flac": true, ".aac": true,
		".ogg": true, ".wma": true, ".m4a": true,
	}

	if videoExts[ext] {
		return "video"
	}
	if audioExts[ext] {
		return "audio"
	}
	return "unknown"
}
