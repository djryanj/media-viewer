package indexer

import (
	"crypto/md5"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"

	"github.com/fsnotify/fsnotify"
)

var imageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
	".bmp": true, ".webp": true, ".svg": true, ".ico": true,
	".tiff": true, ".tif": true, ".heic": true, ".heif": true,
}

var videoExtensions = map[string]bool{
	".mp4": true, ".mkv": true, ".avi": true, ".mov": true,
	".wmv": true, ".flv": true, ".webm": true, ".m4v": true,
	".mpeg": true, ".mpg": true, ".3gp": true, ".ts": true,
}

var playlistExtensions = map[string]bool{
	".wpl": true,
}

var mimeTypes = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
	".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
	".svg": "image/svg+xml", ".ico": "image/x-icon",
	".mp4": "video/mp4", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
	".mov": "video/quicktime", ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv",
	".webm": "video/webm", ".m4v": "video/x-m4v",
	".wpl": "application/vnd.ms-wpl",
}

// Indexer manages the indexing of media files in the media directory.
type Indexer struct {
	db                   *database.Database
	mediaDir             string
	indexInterval        time.Duration
	watcher              *fsnotify.Watcher
	stopChan             chan struct{}
	indexMu              sync.Mutex
	isIndexing           bool
	lastIndexTime        time.Time
	initialIndexComplete bool
	initialIndexError    error
	startTime            time.Time
}

// New creates a new Indexer instance.
func New(db *database.Database, mediaDir string, indexInterval time.Duration) *Indexer {
	return &Indexer{
		db:            db,
		mediaDir:      mediaDir,
		indexInterval: indexInterval,
		stopChan:      make(chan struct{}),
		startTime:     time.Now(),
	}
}

// Start begins the indexing process.
func (idx *Indexer) Start() error {
	// Initial index
	logging.Info("Starting initial index...")
	if err := idx.Index(); err != nil {
		logging.Error("Initial index error: %v", err)
		idx.indexMu.Lock()
		idx.initialIndexError = err
		idx.indexMu.Unlock()
	}

	// Mark initial index as complete (even if it failed, we tried)
	idx.indexMu.Lock()
	idx.initialIndexComplete = true
	idx.indexMu.Unlock()

	// Start file watcher
	go idx.watchFiles()

	// Start periodic re-index
	go idx.periodicIndex()

	return nil
}

// Stop stops the indexing process.
func (idx *Indexer) Stop() {
	close(idx.stopChan)
	if idx.watcher != nil {
		if err := idx.watcher.Close(); err != nil {
			log.Printf("error closing file watcher: %v", err)
		}
	}
}

// IsReady returns true if the initial index has completed
func (idx *Indexer) IsReady() bool {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()
	return idx.initialIndexComplete
}

// GetHealthStatus returns detailed health information
func (idx *Indexer) GetHealthStatus() HealthStatus {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()

	status := HealthStatus{
		Ready:       idx.initialIndexComplete,
		Indexing:    idx.isIndexing,
		StartTime:   idx.startTime,
		Uptime:      time.Since(idx.startTime).String(),
		LastIndexed: idx.lastIndexTime,
	}

	if idx.initialIndexError != nil {
		status.InitialIndexError = idx.initialIndexError.Error()
	}

	return status
}

// HealthStatus contains health check information
type HealthStatus struct {
	Ready             bool      `json:"ready"`
	Indexing          bool      `json:"indexing"`
	StartTime         time.Time `json:"startTime"`
	Uptime            string    `json:"uptime"`
	LastIndexed       time.Time `json:"lastIndexed,omitempty"`
	InitialIndexError string    `json:"initialIndexError,omitempty"`
}

// Index performs a full index of the media directory.
func (idx *Indexer) Index() error {
	idx.indexMu.Lock()
	if idx.isIndexing {
		idx.indexMu.Unlock()
		logging.Info("Index already in progress, skipping...")
		return nil
	}
	idx.isIndexing = true
	idx.indexMu.Unlock()

	defer func() {
		idx.indexMu.Lock()
		idx.isIndexing = false
		idx.indexMu.Unlock()
	}()

	startTime := time.Now()
	logging.Info("Starting file indexing. If this is the first time it has run and you have a lot of files, the server will not be available until after the index is complete. Be patient...")

	logging.Debug("Acquiring database lock...")

	tx, err := idx.db.BeginBatch()
	if err != nil {
		logging.Error("Failed to begin transaction: %v", err)
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	logging.Debug("Database lock acquired, scanning files...")

	indexTime := time.Now()
	fileCount := 0
	folderCount := 0

	err = filepath.Walk(idx.mediaDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			logging.Warn("Error accessing path %s: %v", path, err)
			return nil // Continue walking
		}

		// Skip hidden files and directories
		if strings.HasPrefix(info.Name(), ".") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		relPath, err := filepath.Rel(idx.mediaDir, path)
		if err != nil {
			return err
		}

		// Skip root
		if relPath == "." {
			return nil
		}

		// Determine parent path
		parentPath := filepath.Dir(relPath)
		if parentPath == "." {
			parentPath = ""
		}

		var file database.MediaFile

		if info.IsDir() {
			file = database.MediaFile{
				Name:       info.Name(),
				Path:       relPath,
				ParentPath: parentPath,
				Type:       database.FileTypeFolder,
				Size:       0,
				ModTime:    info.ModTime(),
				FileHash:   fmt.Sprintf("%x", md5.Sum([]byte(relPath+info.ModTime().String()))),
			}
			folderCount++
		} else {
			ext := strings.ToLower(filepath.Ext(info.Name()))
			fileType := getFileType(ext)

			// Skip unsupported files
			if fileType == "" {
				return nil
			}

			file = database.MediaFile{
				Name:       info.Name(),
				Path:       relPath,
				ParentPath: parentPath,
				Type:       database.FileType(fileType),
				Size:       info.Size(),
				ModTime:    info.ModTime(),
				MimeType:   mimeTypes[ext],
				FileHash:   fmt.Sprintf("%x", md5.Sum([]byte(fmt.Sprintf("%s%d%d", relPath, info.Size(), info.ModTime().Unix())))),
			}
			fileCount++
		}

		if err := idx.db.UpsertFile(tx, &file); err != nil {
			logging.Error("Error upserting file %s: %v", relPath, err)
		}

		// Log progress every 1000 items
		if (fileCount+folderCount)%1000 == 0 {
			logging.Info("Indexed %d files, %d folders...", fileCount, folderCount)
		}

		return nil
	})

	if err != nil {
		if endErr := idx.db.EndBatch(tx, err); endErr != nil {
			logging.Error("failed to end batch after walk error: %v", endErr)
		}
		return fmt.Errorf("walk error: %w", err)
	}

	// Delete files that no longer exist
	deleted, err := idx.db.DeleteMissingFiles(tx, indexTime)
	if err != nil {
		logging.Error("Error deleting missing files: %v", err)
	} else if deleted > 0 {
		logging.Info("Removed %d missing files from index", deleted)
	}

	if err := idx.db.EndBatch(tx, nil); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	duration := time.Since(startTime)
	idx.indexMu.Lock()
	idx.lastIndexTime = time.Now()
	idx.indexMu.Unlock()

	// Update stats
	stats, _ := idx.db.CalculateStats()
	stats.LastIndexed = idx.lastIndexTime
	stats.IndexDuration = duration.String()
	idx.db.UpdateStats(stats)

	logging.Info("Index complete: %d files, %d folders in %v", fileCount, folderCount, duration)

	return nil
}

func (idx *Indexer) watchFiles() {
	var err error
	idx.watcher, err = fsnotify.NewWatcher()
	if err != nil {
		logging.Error("Failed to create file watcher: %v", err)
		return
	}

	watchCount := idx.addDirectoriesToWatcher()
	logging.Debug("File watcher started, watching %d directories", watchCount)

	idx.processWatcherEvents()
}

// addDirectoriesToWatcher adds all directories in mediaDir to the watcher
func (idx *Indexer) addDirectoriesToWatcher() int {
	watchCount := 0
	err := filepath.Walk(idx.mediaDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() && !strings.HasPrefix(info.Name(), ".") {
			if addErr := idx.watcher.Add(path); addErr != nil {
				logging.Warn("failed to add path to watcher %s: %v", path, addErr)
			} else {
				watchCount++
			}
		}
		return nil
	})
	if err != nil {
		logging.Error("failed to walk media directory for watcher: %v", err)
	}
	return watchCount
}

// processWatcherEvents handles file system events from the watcher
func (idx *Indexer) processWatcherEvents() {
	debouncer := newIndexDebouncer(2*time.Second, func() {
		logging.Debug("File changes detected, re-indexing...")
		if err := idx.Index(); err != nil {
			logging.Error("re-index after file change failed: %v", err)
		}
	})

	for {
		select {
		case event, ok := <-idx.watcher.Events:
			if !ok {
				return
			}
			idx.handleWatcherEvent(event, debouncer)

		case err, ok := <-idx.watcher.Errors:
			if !ok {
				return
			}
			logging.Error("Watcher error: %v", err)

		case <-idx.stopChan:
			return
		}
	}
}

// handleWatcherEvent processes a single file system event
func (idx *Indexer) handleWatcherEvent(event fsnotify.Event, debouncer *indexDebouncer) {
	// Skip hidden files
	if strings.Contains(event.Name, "/.") {
		return
	}

	switch {
	case event.Op&fsnotify.Create != 0:
		idx.handleCreateEvent(event)
		debouncer.trigger()

	case event.Op&fsnotify.Remove != 0:
		debouncer.trigger()

	case event.Op&fsnotify.Rename != 0:
		debouncer.trigger()

	case event.Op&fsnotify.Write != 0:
		idx.handleWriteEvent(event, debouncer)
	}
}

// handleCreateEvent handles file/directory creation events
func (idx *Indexer) handleCreateEvent(event fsnotify.Event) {
	info, err := os.Stat(event.Name)
	if err != nil {
		return
	}
	if info.IsDir() {
		if addErr := idx.watcher.Add(event.Name); addErr != nil {
			logging.Warn("failed to add new directory to watcher %s: %v", event.Name, addErr)
		} else {
			logging.Debug("Added new directory to watcher: %s", event.Name)
		}
	}
}

// handleWriteEvent handles file write events
func (idx *Indexer) handleWriteEvent(event fsnotify.Event, debouncer *indexDebouncer) {
	info, err := os.Stat(event.Name)
	if err != nil {
		return
	}
	if !info.IsDir() {
		debouncer.trigger()
	}
}

// indexDebouncer provides debounced triggering of the index function
type indexDebouncer struct {
	delay    time.Duration
	callback func()
	timer    *time.Timer
	mu       sync.Mutex
}

// newIndexDebouncer creates a new debouncer with the specified delay and callback
func newIndexDebouncer(delay time.Duration, callback func()) *indexDebouncer {
	return &indexDebouncer{
		delay:    delay,
		callback: callback,
	}
}

// trigger resets the debounce timer
func (d *indexDebouncer) trigger() {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.timer != nil {
		d.timer.Stop()
	}
	d.timer = time.AfterFunc(d.delay, d.callback)
}

func (idx *Indexer) periodicIndex() {
	ticker := time.NewTicker(idx.indexInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			logging.Debug("Periodic re-index triggered")
			if err := idx.Index(); err != nil {
				logging.Error("periodic re-index failed: %v", err)
			}
		case <-idx.stopChan:
			return
		}
	}
}

// IsIndexing returns whether an index operation is currently in progress.
func (idx *Indexer) IsIndexing() bool {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()
	return idx.isIndexing
}

// LastIndexTime returns the time of the last completed index operation.
func (idx *Indexer) LastIndexTime() time.Time {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()
	return idx.lastIndexTime
}

// TriggerIndex manually triggers a re-index
func (idx *Indexer) TriggerIndex() {
	go func() {
		if err := idx.Index(); err != nil {
			logging.Error("manually triggered re-index failed: %v", err)
		}
	}()
}

func getFileType(ext string) string {
	if imageExtensions[ext] {
		return "image"
	}
	if videoExtensions[ext] {
		return "video"
	}
	if playlistExtensions[ext] {
		return "playlist"
	}
	return ""
}
