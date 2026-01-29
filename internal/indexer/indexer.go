package indexer

import (
	"crypto/md5"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"

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

const (
	// Number of files to process before committing a batch
	batchSize = 500

	// Minimum files to index before marking server as ready
	minFilesForReady = 100

	// Delay between batches to allow other operations
	batchDelay = 10 * time.Millisecond
)

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

	// Progress tracking
	filesIndexed   atomic.Int64
	foldersIndexed atomic.Int64
	indexProgress  atomic.Value // stores IndexProgress
}

// IndexProgress tracks the current indexing progress
type IndexProgress struct {
	FilesIndexed   int64     `json:"filesIndexed"`
	FoldersIndexed int64     `json:"foldersIndexed"`
	IsIndexing     bool      `json:"isIndexing"`
	StartedAt      time.Time `json:"startedAt,omitempty"`
}

// New creates a new Indexer instance.
func New(db *database.Database, mediaDir string, indexInterval time.Duration) *Indexer {
	idx := &Indexer{
		db:            db,
		mediaDir:      mediaDir,
		indexInterval: indexInterval,
		stopChan:      make(chan struct{}),
		startTime:     time.Now(),
	}
	idx.indexProgress.Store(IndexProgress{})
	return idx
}

// Start begins the indexing process.
func (idx *Indexer) Start() error {
	// Start initial index in background
	go func() {
		logging.Info("Starting initial index in background...")
		if err := idx.Index(); err != nil {
			logging.Error("Initial index error: %v", err)
			idx.indexMu.Lock()
			idx.initialIndexError = err
			idx.indexMu.Unlock()
		}
	}()

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

// IsReady returns true if the server is ready to accept traffic
// Now returns true early once minimum files are indexed
func (idx *Indexer) IsReady() bool {
	// Ready if we've indexed minimum files OR initial index is complete
	if idx.filesIndexed.Load()+idx.foldersIndexed.Load() >= minFilesForReady {
		return true
	}

	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()
	return idx.initialIndexComplete
}

// getProgress safely retrieves the current IndexProgress
func (idx *Indexer) getProgress() IndexProgress {
	if progress, ok := idx.indexProgress.Load().(IndexProgress); ok {
		return progress
	}
	return IndexProgress{}
}

// GetHealthStatus returns detailed health information
func (idx *Indexer) GetHealthStatus() HealthStatus {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()

	progress := idx.getProgress()

	status := HealthStatus{
		Ready:          idx.initialIndexComplete || (idx.filesIndexed.Load()+idx.foldersIndexed.Load() >= minFilesForReady),
		Indexing:       idx.isIndexing,
		StartTime:      idx.startTime,
		Uptime:         time.Since(idx.startTime).String(),
		LastIndexed:    idx.lastIndexTime,
		FilesIndexed:   idx.filesIndexed.Load(),
		FoldersIndexed: idx.foldersIndexed.Load(),
	}

	if idx.isIndexing {
		status.IndexProgress = &progress
	}

	if idx.initialIndexError != nil {
		status.InitialIndexError = idx.initialIndexError.Error()
	}

	return status
}

// HealthStatus contains health check information
type HealthStatus struct {
	Ready             bool           `json:"ready"`
	Indexing          bool           `json:"indexing"`
	StartTime         time.Time      `json:"startTime"`
	Uptime            string         `json:"uptime"`
	LastIndexed       time.Time      `json:"lastIndexed,omitempty"`
	InitialIndexError string         `json:"initialIndexError,omitempty"`
	FilesIndexed      int64          `json:"filesIndexed"`
	FoldersIndexed    int64          `json:"foldersIndexed"`
	IndexProgress     *IndexProgress `json:"indexProgress,omitempty"`
}

// Index performs a full index of the media directory.
// Uses batched commits to avoid blocking other database operations.
func (idx *Indexer) Index() error {
	if !idx.tryStartIndexing() {
		logging.Info("Index already in progress, skipping...")
		return nil
	}
	defer idx.finishIndexing()

	// Update metrics
	metrics.IndexerIsRunning.Set(1)
	defer metrics.IndexerIsRunning.Set(0)
	metrics.IndexerRunsTotal.Inc()

	startTime := time.Now()
	logging.Info("Starting file indexing...")

	idx.resetCounters(startTime)

	indexTime := time.Now()
	result, err := idx.walkAndIndex(startTime)
	if err != nil {
		metrics.IndexerErrors.Inc()
		return err
	}

	// Delete files that no longer exist
	if err := idx.cleanupMissingFiles(indexTime); err != nil {
		logging.Error("Error cleaning up missing files: %v", err)
		metrics.IndexerErrors.Inc()
	}

	idx.finalizeIndex(startTime, result.totalFiles, result.totalFolders)

	// Update metrics
	duration := time.Since(startTime).Seconds()
	metrics.IndexerLastRunTimestamp.Set(float64(time.Now().Unix()))
	metrics.IndexerLastRunDuration.Set(duration)
	metrics.IndexerFilesProcessed.Add(float64(result.totalFiles))
	metrics.IndexerFoldersProcessed.Add(float64(result.totalFolders))

	return nil
}

// tryStartIndexing attempts to start indexing, returns false if already in progress
func (idx *Indexer) tryStartIndexing() bool {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()

	if idx.isIndexing {
		return false
	}
	idx.isIndexing = true
	return true
}

// finishIndexing marks indexing as complete
func (idx *Indexer) finishIndexing() {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()

	idx.isIndexing = false
	idx.initialIndexComplete = true
}

// resetCounters resets the indexing counters
func (idx *Indexer) resetCounters(startTime time.Time) {
	idx.filesIndexed.Store(0)
	idx.foldersIndexed.Store(0)
	idx.indexProgress.Store(IndexProgress{
		IsIndexing: true,
		StartedAt:  startTime,
	})
}

// indexResult holds the results of the walk and index operation
type indexResult struct {
	totalFiles   int64
	totalFolders int64
}

// walkAndIndex walks the media directory and indexes files in batches
func (idx *Indexer) walkAndIndex(startTime time.Time) (indexResult, error) {
	var currentBatch []database.MediaFile
	var result indexResult

	err := filepath.Walk(idx.mediaDir, func(path string, info os.FileInfo, err error) error {
		return idx.processPath(path, info, err, &currentBatch, &result, startTime)
	})

	if err != nil && !errors.Is(err, fs.SkipAll) {
		return result, fmt.Errorf("walk error: %w", err)
	}

	// Process remaining files in the last batch
	if len(currentBatch) > 0 {
		if err := idx.processBatch(currentBatch); err != nil {
			logging.Error("Error processing final batch: %v", err)
		}
	}

	return result, nil
}

// processPath processes a single path during the directory walk
func (idx *Indexer) processPath(
	path string,
	info os.FileInfo,
	err error,
	currentBatch *[]database.MediaFile,
	result *indexResult,
	startTime time.Time,
) error {
	// Check for stop signal
	select {
	case <-idx.stopChan:
		return fs.SkipAll
	default:
	}

	if err != nil {
		logging.Warn("Error accessing path %s: %v", path, err)
		return nil
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

	file, ok := idx.createMediaFile(relPath, info)
	if !ok {
		return nil // Unsupported file type
	}

	// Update counters
	if info.IsDir() {
		result.totalFolders++
		idx.foldersIndexed.Add(1)
	} else {
		result.totalFiles++
		idx.filesIndexed.Add(1)
	}

	*currentBatch = append(*currentBatch, file)

	// Process batch when it reaches the batch size
	if len(*currentBatch) >= batchSize {
		if err := idx.processBatch(*currentBatch); err != nil {
			logging.Error("Error processing batch: %v", err)
		}
		*currentBatch = (*currentBatch)[:0] // Reset slice but keep capacity

		idx.updateProgress(startTime)

		// Small delay to allow other operations
		time.Sleep(batchDelay)

		// Log progress
		total := result.totalFiles + result.totalFolders
		if total%5000 == 0 {
			logging.Info("Indexed %d files, %d folders...", result.totalFiles, result.totalFolders)
		}
	}

	return nil
}

// createMediaFile creates a MediaFile struct from path and file info
func (idx *Indexer) createMediaFile(relPath string, info os.FileInfo) (database.MediaFile, bool) {
	parentPath := filepath.Dir(relPath)
	if parentPath == "." {
		parentPath = ""
	}

	if info.IsDir() {
		return database.MediaFile{
			Name:       info.Name(),
			Path:       relPath,
			ParentPath: parentPath,
			Type:       database.FileTypeFolder,
			Size:       0,
			ModTime:    info.ModTime(),
			FileHash:   fmt.Sprintf("%x", md5.Sum([]byte(relPath+info.ModTime().String()))),
		}, true
	}

	ext := strings.ToLower(filepath.Ext(info.Name()))
	fileType := getFileType(ext)

	// Skip unsupported files
	if fileType == "" {
		return database.MediaFile{}, false
	}

	return database.MediaFile{
		Name:       info.Name(),
		Path:       relPath,
		ParentPath: parentPath,
		Type:       database.FileType(fileType),
		Size:       info.Size(),
		ModTime:    info.ModTime(),
		MimeType:   mimeTypes[ext],
		FileHash:   fmt.Sprintf("%x", md5.Sum([]byte(fmt.Sprintf("%s%d%d", relPath, info.Size(), info.ModTime().Unix())))),
	}, true
}

// updateProgress updates the indexing progress
func (idx *Indexer) updateProgress(startTime time.Time) {
	idx.indexProgress.Store(IndexProgress{
		FilesIndexed:   idx.filesIndexed.Load(),
		FoldersIndexed: idx.foldersIndexed.Load(),
		IsIndexing:     true,
		StartedAt:      startTime,
	})
}

// finalizeIndex completes the indexing process and updates stats
func (idx *Indexer) finalizeIndex(startTime time.Time, totalFiles, totalFolders int64) {
	duration := time.Since(startTime)

	idx.indexMu.Lock()
	idx.lastIndexTime = time.Now()
	idx.indexMu.Unlock()

	// Update progress to complete
	idx.indexProgress.Store(IndexProgress{
		FilesIndexed:   totalFiles,
		FoldersIndexed: totalFolders,
		IsIndexing:     false,
	})

	// Update stats
	stats, _ := idx.db.CalculateStats()
	stats.LastIndexed = idx.lastIndexTime
	stats.IndexDuration = duration.String()
	idx.db.UpdateStats(stats)

	logging.Info("Index complete: %d files, %d folders in %v", totalFiles, totalFolders, duration)
}

// processBatch processes a batch of files in a single transaction
func (idx *Indexer) processBatch(files []database.MediaFile) error {
	if len(files) == 0 {
		return nil
	}

	tx, err := idx.db.BeginBatch()
	if err != nil {
		return fmt.Errorf("failed to begin batch transaction: %w", err)
	}

	for i := range files {
		if err := idx.db.UpsertFile(tx, &files[i]); err != nil {
			logging.Warn("Error upserting file %s: %v", files[i].Path, err)
		}
	}

	if err := idx.db.EndBatch(tx, nil); err != nil {
		return fmt.Errorf("failed to commit batch: %w", err)
	}

	return nil
}

// cleanupMissingFiles removes files from the database that no longer exist on disk
func (idx *Indexer) cleanupMissingFiles(indexTime time.Time) error {
	tx, err := idx.db.BeginBatch()
	if err != nil {
		return fmt.Errorf("failed to begin cleanup transaction: %w", err)
	}

	deleted, err := idx.db.DeleteMissingFiles(tx, indexTime)
	if err != nil {
		if endErr := idx.db.EndBatch(tx, err); endErr != nil {
			logging.Error("failed to end batch after cleanup error: %v", endErr)
		}
		return err
	}

	if err := idx.db.EndBatch(tx, nil); err != nil {
		return fmt.Errorf("failed to commit cleanup: %w", err)
	}

	if deleted > 0 {
		logging.Info("Removed %d missing files from index", deleted)
	}

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

// GetProgress returns the current indexing progress
func (idx *Indexer) GetProgress() IndexProgress {
	return idx.getProgress()
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
