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
func ParseWPL(wplPath string, mediaDir string) (*Playlist, error) {
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
func resolveMediaPath(src string, playlistDir string, mediaDir string) PlaylistItem {
	logging.Debug("Resolving media path: %s", src)

	item := PlaylistItem{
		OrigPath: src,
		Name:     filepath.Base(src),
	}

	// Normalize the source path (convert backslashes to forward slashes for processing)
	normalizedSrc := strings.ReplaceAll(src, "\\", "/")

	// Check if it's a UNC path (starts with // after normalization)
	if strings.HasPrefix(normalizedSrc, "//") {
		item = resolveUNCPath(normalizedSrc, playlistDir, mediaDir, item)
	} else if filepath.IsAbs(src) || (len(src) > 1 && src[1] == ':') {
		// Absolute path (including Windows drive letters like C:$
		item = resolveAbsolutePath(normalizedSrc, playlistDir, mediaDir, item)
	} else {
		// Relative path
		item = resolveRelativePath(src, playlistDir, mediaDir, item)
	}

	// Determine media type based on extension
	item.MediaType = getMediaType(item.Name)

	logging.Debug("Resolved: %s -> %s (exists: %v)", src, item.Path, item.Exists)

	return item
}

// resolveUNCPath handles UNC paths like \\server\share\path\file.mp4
func resolveUNCPath(normalizedSrc string, playlistDir string, mediaDir string, item PlaylistItem) PlaylistItem {
	logging.Debug("Resolving UNC path: %s", normalizedSrc)

	// Remove the leading // and split into components
	// Example: //server/share/folder/subfolder/file.mp4
	pathWithoutPrefix := strings.TrimPrefix(normalizedSrc, "//")
	parts := strings.Split(pathWithoutPrefix, "/")

	if len(parts) < 3 {
		// Not enough parts for a valid UNC path (need at least server/share/file)
		logging.Debug("UNC path too short: %s", normalizedSrc)
		return item
	}

	// Try progressively shorter paths to find the file
	// Start from just the filename and work up to include more path components
	filename := parts[len(parts)-1]

	// Strategy 1: Try just the filename in the playlist directory
	testPath := filepath.Join(playlistDir, filename)
	if fileExists(testPath) {
		item.Path = getRelativePath(testPath, mediaDir)
		item.Exists = true
		logging.Debug("Found via filename in playlist dir: %s", testPath)
		return item
	}

	// Strategy 2: Try to match path components from the end
	// Skip server (parts[0]) and share (parts[1]), use remaining path
	for i := 2; i < len(parts); i++ {
		subPath := strings.Join(parts[i:], string(filepath.Separator))

		// Try in media directory
		testPath = filepath.Join(mediaDir, subPath)
		if fileExists(testPath) {
			item.Path = getRelativePath(testPath, mediaDir)
			item.Exists = true
			logging.Debug("Found via subpath in media dir: %s", testPath)
			return item
		}

		// Try in playlist directory
		testPath = filepath.Join(playlistDir, subPath)
		if fileExists(testPath) {
			item.Path = getRelativePath(testPath, mediaDir)
			item.Exists = true
			logging.Debug("Found via subpath in playlist dir: %s", testPath)
			return item
		}
	}

	// Strategy 3: Search for the file by name in the playlist directory and subdirectories
	foundPath := searchForFile(playlistDir, filename, 3) // Search up to 3 levels deep
	if foundPath != "" {
		item.Path = getRelativePath(foundPath, mediaDir)
		item.Exists = true
		logging.Debug("Found via search: %s", foundPath)
		return item
	}

	// Strategy 4: Search in media directory
	foundPath = searchForFile(mediaDir, filename, 5) // Search up to 5 levels deep
	if foundPath != "" {
		item.Path = getRelativePath(foundPath, mediaDir)
		item.Exists = true
		logging.Debug("Found via media dir search: %s", foundPath)
		return item
	}

	logging.Debug("Could not resolve UNC path: %s", normalizedSrc)
	return item
}

// resolveAbsolutePath handles absolute paths like C:\folder\file.mp4
func resolveAbsolutePath(normalizedSrc string, playlistDir string, mediaDir string, item PlaylistItem) PlaylistItem {
	logging.Debug("Resolving absolute path: %s", normalizedSrc)

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

	// Strategy 2: Try progressively shorter paths
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

	// Strategy 3: Search for file
	foundPath := searchForFile(playlistDir, filename, 3)
	if foundPath != "" {
		item.Path = getRelativePath(foundPath, mediaDir)
		item.Exists = true
		return item
	}

	return item
}

// resolveRelativePath handles relative paths
func resolveRelativePath(src string, playlistDir string, mediaDir string, item PlaylistItem) PlaylistItem {
	logging.Debug("Resolving relative path: %s", src)

	// Normalize path separators
	normalizedSrc := filepath.FromSlash(src)

	// Try relative to playlist directory first
	testPath := filepath.Join(playlistDir, normalizedSrc)
	if fileExists(testPath) {
		item.Path = getRelativePath(testPath, mediaDir)
		item.Exists = true
		logging.Debug("Found relative to playlist dir: %s", testPath)
		return item
	}

	// Try relative to media directory
	testPath = filepath.Join(mediaDir, normalizedSrc)
	if fileExists(testPath) {
		item.Path = getRelativePath(testPath, mediaDir)
		item.Exists = true
		logging.Debug("Found relative to media dir: %s", testPath)
		return item
	}

	// Try just the filename in playlist directory
	filename := filepath.Base(normalizedSrc)
	testPath = filepath.Join(playlistDir, filename)
	if fileExists(testPath) {
		item.Path = getRelativePath(testPath, mediaDir)
		item.Exists = true
		logging.Debug("Found filename in playlist dir: %s", testPath)
		return item
	}

	logging.Debug("Could not resolve relative path: %s", src)
	return item
}

// searchForFile searches for a file by name in a directory tree
func searchForFile(rootDir string, filename string, maxDepth int) string {
	if maxDepth <= 0 {
		return ""
	}

	var foundPath string

	filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Continue on errors
		}

		// Check depth
		relPath, _ := filepath.Rel(rootDir, path)
		depth := strings.Count(relPath, string(filepath.Separator))
		if depth > maxDepth {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Check if this is the file we're looking for (case-insensitive)
		if !info.IsDir() && strings.EqualFold(info.Name(), filename) {
			foundPath = path
			return filepath.SkipAll // Stop walking
		}

		return nil
	})

	return foundPath
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
func getRelativePath(fullPath string, mediaDir string) string {
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
