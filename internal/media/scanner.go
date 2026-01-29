package media

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"

	"github.com/fsnotify/fsnotify"
)

// Scanner provides methods for scanning and listing media directories.
type Scanner struct {
	mediaDir string
	mu       sync.RWMutex
}

// NewScanner creates a new Scanner instance.
func NewScanner(mediaDir string) *Scanner {
	return &Scanner{
		mediaDir: mediaDir,
	}
}

// GetDirectory returns the contents of a specific directory
func (s *Scanner) GetDirectory(relativePath string, sortField SortField, sortOrder SortOrder, filterType string) (*DirectoryListing, error) {
	start := time.Now()
	var err error
	defer func() {
		status := "success"
		if err != nil {
			status = "error"
		}
		metrics.ScannerOperationsTotal.WithLabelValues("get_directory", status).Inc()
		metrics.ScannerOperationDuration.WithLabelValues("get_directory").Observe(time.Since(start).Seconds())
	}()

	s.mu.RLock()
	defer s.mu.RUnlock()

	relativePath = normalizePath(relativePath)

	fullPath, err := s.validatePath(relativePath)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	items := s.processEntries(entries, relativePath, fullPath, filterType)

	s.sortItems(items, sortField, sortOrder)

	listing := s.buildListing(relativePath, items)

	// Record items returned
	metrics.ScannerItemsReturned.WithLabelValues("get_directory").Observe(float64(len(items)))

	return listing, nil
}

// normalizePath cleans and normalizes a relative path
func normalizePath(relativePath string) string {
	relativePath = filepath.Clean(relativePath)
	if relativePath == "." {
		relativePath = ""
	}
	return relativePath
}

// validatePath ensures the path is valid and within the media directory
func (s *Scanner) validatePath(relativePath string) (string, error) {
	fullPath := filepath.Join(s.mediaDir, relativePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", err
	}

	absMediaDir, _ := filepath.Abs(s.mediaDir)
	if !strings.HasPrefix(absPath, absMediaDir) {
		return "", os.ErrPermission
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", os.ErrInvalid
	}

	return fullPath, nil
}

// processEntries converts directory entries to MediaFile items
func (s *Scanner) processEntries(entries []os.DirEntry, relativePath, fullPath, filterType string) []MediaFile {
	var items []MediaFile

	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		item, ok := s.entryToMediaFile(entry, relativePath, fullPath)
		if !ok {
			continue
		}

		if s.shouldIncludeItem(item, filterType) {
			items = append(items, item)
		}
	}

	return items
}

// entryToMediaFile converts a directory entry to a MediaFile
func (s *Scanner) entryToMediaFile(entry os.DirEntry, relativePath, fullPath string) (MediaFile, bool) {
	entryInfo, err := entry.Info()
	if err != nil {
		return MediaFile{}, false
	}

	entryPath := entry.Name()
	if relativePath != "" {
		entryPath = filepath.Join(relativePath, entry.Name())
	}

	if entry.IsDir() {
		return s.createFolderItem(entry, entryInfo, entryPath, fullPath), true
	}

	return s.createFileItem(entry, entryInfo, entryPath)
}

// createFolderItem creates a MediaFile for a directory
func (s *Scanner) createFolderItem(entry os.DirEntry, info os.FileInfo, entryPath, fullPath string) MediaFile {
	itemCount := s.countDirItems(filepath.Join(fullPath, entry.Name()))

	return MediaFile{
		Name:      entry.Name(),
		Path:      entryPath,
		Type:      FileTypeFolder,
		Size:      0,
		ModTime:   info.ModTime(),
		ItemCount: itemCount,
	}
}

// createFileItem creates a MediaFile for a file
func (s *Scanner) createFileItem(entry os.DirEntry, info os.FileInfo, entryPath string) (MediaFile, bool) {
	ext := strings.ToLower(filepath.Ext(entry.Name()))
	fileType := s.getFileType(ext)

	if fileType == FileTypeOther {
		return MediaFile{}, false
	}

	mf := MediaFile{
		Name:     entry.Name(),
		Path:     entryPath,
		Type:     fileType,
		Size:     info.Size(),
		ModTime:  info.ModTime(),
		MimeType: s.getMimeType(ext),
	}

	if fileType == FileTypeImage || fileType == FileTypeVideo {
		mf.ThumbnailURL = "/api/thumbnail/" + entryPath
	}

	return mf, true
}

// shouldIncludeItem checks if an item passes the filter
func (s *Scanner) shouldIncludeItem(item MediaFile, filterType string) bool {
	if filterType == "" {
		return true
	}
	return item.Type == FileTypeFolder || string(item.Type) == filterType
}

// buildListing constructs the DirectoryListing response
func (s *Scanner) buildListing(relativePath string, items []MediaFile) *DirectoryListing {
	breadcrumb := s.buildBreadcrumb(relativePath)

	var parent string
	if relativePath != "" {
		parent = filepath.Dir(relativePath)
		if parent == "." {
			parent = ""
		}
	}

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
	}
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
	start := time.Now()
	var scanErr error
	defer func() {
		status := "success"
		if scanErr != nil {
			status = "error"
		}
		metrics.ScannerOperationsTotal.WithLabelValues("get_playlists", status).Inc()
		metrics.ScannerOperationDuration.WithLabelValues("get_playlists").Observe(time.Since(start).Seconds())
	}()

	s.mu.RLock()
	defer s.mu.RUnlock()

	var playlists []MediaFile
	var filesScanned int

	scanErr = filepath.Walk(s.mediaDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}

		filesScanned++

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

	if scanErr != nil {
		logging.Error("failed to walk media directory for playlists: %v", scanErr)
	}

	// Record metrics
	metrics.ScannerItemsReturned.WithLabelValues("get_playlists").Observe(float64(len(playlists)))
	metrics.ScannerFilesScanned.WithLabelValues("get_playlists").Add(float64(filesScanned))

	return playlists
}

// Watch monitors the media directory for changes using fsnotify
func (s *Scanner) Watch() {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		logging.Error("Failed to create file watcher: %v", err)
		metrics.ScannerWatcherErrors.Inc()
		return
	}
	defer func() {
		if err := watcher.Close(); err != nil {
			logging.Error("failed to close file watcher: %v", err)
		}
	}()

	watchCount := s.addDirectoriesToWatcher(watcher)
	logging.Debug("Scanner watcher started, watching %d directories", watchCount)

	// Set initial watched directories count
	metrics.ScannerWatchedDirectories.Set(float64(watchCount))

	s.processWatcherEvents(watcher)
}

// addDirectoriesToWatcher adds all directories in mediaDir to the watcher
func (s *Scanner) addDirectoriesToWatcher(watcher *fsnotify.Watcher) int {
	watchCount := 0
	err := filepath.Walk(s.mediaDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() && !strings.HasPrefix(info.Name(), ".") {
			if addErr := watcher.Add(path); addErr != nil {
				logging.Warn("failed to add path to watcher %s: %v", path, addErr)
				metrics.ScannerWatcherErrors.Inc()
			} else {
				watchCount++
			}
		}
		return nil
	})
	if err != nil {
		logging.Error("failed to walk media directory for watcher: %v", err)
		metrics.ScannerWatcherErrors.Inc()
	}
	return watchCount
}

// processWatcherEvents handles file system events from the watcher
func (s *Scanner) processWatcherEvents(watcher *fsnotify.Watcher) {
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			s.handleWatcherEvent(watcher, event)

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			logging.Error("Watcher error: %v", err)
			metrics.ScannerWatcherErrors.Inc()
		}
	}
}

// handleWatcherEvent processes a single file system event
func (s *Scanner) handleWatcherEvent(watcher *fsnotify.Watcher, event fsnotify.Event) {
	// Skip hidden files
	if strings.Contains(event.Name, "/.") {
		return
	}

	// Record the event
	eventType := s.getEventType(event.Op)
	metrics.ScannerWatcherEventsTotal.WithLabelValues(eventType).Inc()

	if event.Op&fsnotify.Create != 0 {
		s.handleCreateEvent(watcher, event)
	}
}

// getEventType returns a string representation of the fsnotify operation
func (s *Scanner) getEventType(op fsnotify.Op) string {
	switch {
	case op&fsnotify.Create != 0:
		return "create"
	case op&fsnotify.Write != 0:
		return "write"
	case op&fsnotify.Remove != 0:
		return "remove"
	case op&fsnotify.Rename != 0:
		return "rename"
	case op&fsnotify.Chmod != 0:
		return "chmod"
	default:
		return "unknown"
	}
}

// handleCreateEvent handles file/directory creation events
func (s *Scanner) handleCreateEvent(watcher *fsnotify.Watcher, event fsnotify.Event) {
	info, err := os.Stat(event.Name)
	if err != nil {
		return
	}
	if info.IsDir() {
		if addErr := watcher.Add(event.Name); addErr != nil {
			logging.Warn("failed to add new directory to watcher %s: %v", event.Name, addErr)
			metrics.ScannerWatcherErrors.Inc()
		} else {
			logging.Debug("Added new directory to watcher: %s", event.Name)
			// Increment watched directories count
			metrics.ScannerWatchedDirectories.Inc()
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
