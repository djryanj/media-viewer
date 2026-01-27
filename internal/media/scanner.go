package media

import (
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
)

type Scanner struct {
	mediaDir string
	mu       sync.RWMutex
}

func NewScanner(mediaDir string) *Scanner {
	return &Scanner{
		mediaDir: mediaDir,
	}
}

// GetDirectory returns the contents of a specific directory
func (s *Scanner) GetDirectory(relativePath string, sortField SortField, sortOrder SortOrder, filterType string) (*DirectoryListing, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Clean and validate the path
	relativePath = filepath.Clean(relativePath)
	if relativePath == "." {
		relativePath = ""
	}

	fullPath := filepath.Join(s.mediaDir, relativePath)

	// Security check - ensure we're still within media directory
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		return nil, err
	}
	absMediaDir, _ := filepath.Abs(s.mediaDir)
	if !strings.HasPrefix(absPath, absMediaDir) {
		return nil, os.ErrPermission
	}

	// Check if directory exists
	info, err := os.Stat(fullPath)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, os.ErrInvalid
	}

	// Read directory contents
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	var items []MediaFile

	for _, entry := range entries {
		// Skip hidden files
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		entryInfo, err := entry.Info()
		if err != nil {
			continue
		}

		entryPath := filepath.Join(relativePath, entry.Name())
		if relativePath == "" {
			entryPath = entry.Name()
		}

		if entry.IsDir() {
			// Count items in subdirectory
			itemCount := s.countDirItems(filepath.Join(fullPath, entry.Name()))

			items = append(items, MediaFile{
				Name:      entry.Name(),
				Path:      entryPath,
				Type:      FileTypeFolder,
				Size:      0,
				ModTime:   entryInfo.ModTime(),
				ItemCount: itemCount,
			})
		} else {
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			fileType := s.getFileType(ext)

			// Skip unsupported files unless showing all
			if fileType == FileTypeOther {
				continue
			}

			mf := MediaFile{
				Name:     entry.Name(),
				Path:     entryPath,
				Type:     fileType,
				Size:     entryInfo.Size(),
				ModTime:  entryInfo.ModTime(),
				MimeType: s.getMimeType(ext),
			}

			if fileType == FileTypeImage || fileType == FileTypeVideo {
				mf.ThumbnailURL = "/api/thumbnail/" + entryPath
			}

			items = append(items, mf)
		}
	}

	// Apply filter
	if filterType != "" {
		var filtered []MediaFile
		for _, item := range items {
			// Always show folders when filtering
			if item.Type == FileTypeFolder || string(item.Type) == filterType {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}

	// Sort items (folders first, then by specified field)
	s.sortItems(items, sortField, sortOrder)

	// Build breadcrumb
	breadcrumb := s.buildBreadcrumb(relativePath)

	// Determine parent path
	var parent string
	if relativePath != "" {
		parent = filepath.Dir(relativePath)
		if parent == "." {
			parent = ""
		}
	}

	// Directory name
	dirName := filepath.Base(relativePath)
	if relativePath == "" {
		dirName = "Media"
	}

	return &DirectoryListing{
		Path:       relativePath,
		Name:       dirName,
		Parent:     parent,
		Breadcrumb: breadcrumb,
		Items:      items,
	}, nil
}

func (s *Scanner) countDirItems(path string) int {
	entries, err := os.ReadDir(path)
	if err != nil {
		return 0
	}

	count := 0
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if entry.IsDir() {
			count++
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if s.getFileType(ext) != FileTypeOther {
			count++
		}
	}
	return count
}

func (s *Scanner) buildBreadcrumb(relativePath string) []PathPart {
	breadcrumb := []PathPart{
		{Name: "Media", Path: ""},
	}

	if relativePath == "" {
		return breadcrumb
	}

	parts := strings.Split(relativePath, string(filepath.Separator))
	currentPath := ""

	for _, part := range parts {
		if part == "" {
			continue
		}
		if currentPath == "" {
			currentPath = part
		} else {
			currentPath = filepath.Join(currentPath, part)
		}
		breadcrumb = append(breadcrumb, PathPart{
			Name: part,
			Path: currentPath,
		})
	}

	return breadcrumb
}

func (s *Scanner) sortItems(items []MediaFile, sortField SortField, sortOrder SortOrder) {
	sort.Slice(items, func(i, j int) bool {
		// Folders always come first
		if items[i].Type == FileTypeFolder && items[j].Type != FileTypeFolder {
			return true
		}
		if items[i].Type != FileTypeFolder && items[j].Type == FileTypeFolder {
			return false
		}

		var less bool
		switch sortField {
		case SortByName:
			less = strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
		case SortByDate:
			less = items[i].ModTime.Before(items[j].ModTime)
		case SortBySize:
			less = items[i].Size < items[j].Size
		case SortByType:
			if items[i].Type == items[j].Type {
				less = strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
			} else {
				less = items[i].Type < items[j].Type
			}
		default:
			less = strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
		}

		if sortOrder == SortDesc {
			return !less
		}
		return less
	})
}

// GetPlaylists returns all playlist files (searches recursively)
func (s *Scanner) GetPlaylists() []MediaFile {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var playlists []MediaFile

	filepath.Walk(s.mediaDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(info.Name()))
		if PlaylistExtensions[ext] {
			relPath, _ := filepath.Rel(s.mediaDir, path)
			playlists = append(playlists, MediaFile{
				Name:     info.Name(),
				Path:     relPath,
				Type:     FileTypePlaylist,
				Size:     info.Size(),
				ModTime:  info.ModTime(),
				MimeType: s.getMimeType(ext),
			})
		}
		return nil
	})

	return playlists
}

func (s *Scanner) Watch() {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("Failed to create file watcher: %v", err)
		return
	}
	defer watcher.Close()

	// Add all directories
	filepath.Walk(s.mediaDir, func(path string, info os.FileInfo, err error) error {
		if err == nil && info.IsDir() {
			watcher.Add(path)
		}
		return nil
	})

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			// Add new directories to watcher
			if event.Op&fsnotify.Create != 0 {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					watcher.Add(event.Name)
				}
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Watcher error: %v", err)
		}
	}
}

func (s *Scanner) getFileType(ext string) FileType {
	if ImageExtensions[ext] {
		return FileTypeImage
	}
	if VideoExtensions[ext] {
		return FileTypeVideo
	}
	if PlaylistExtensions[ext] {
		return FileTypePlaylist
	}
	return FileTypeOther
}

func (s *Scanner) getMimeType(ext string) string {
	mimeTypes := map[string]string{
		".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
		".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
		".svg": "image/svg+xml", ".ico": "image/x-icon",
		".mp4": "video/mp4", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
		".mov": "video/quicktime", ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv",
		".webm": "video/webm", ".m4v": "video/x-m4v",
		".wpl": "application/vnd.ms-wpl",
	}
	if mime, ok := mimeTypes[ext]; ok {
		return mime
	}
	return "application/octet-stream"
}
