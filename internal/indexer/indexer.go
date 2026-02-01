package indexer

import (
	"crypto/md5"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"
	"media-viewer/internal/mediatypes"
	"media-viewer/internal/metrics"
)

const (
	// Number of files to process before committing a batch
	batchSize = 500

	// Minimum files to index before marking server as ready
	minFilesForReady = 100

	// Delay between batches to allow other operations
	batchDelay = 10 * time.Millisecond

	// Default polling interval for change detection
	defaultPollInterval = 30 * time.Second
)

// Indexer manages the indexing of media files in the media directory.
type Indexer struct {
	db                   *database.Database
	mediaDir             string
	indexInterval        time.Duration
	pollInterval         time.Duration
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

	// Parallel walker configuration
	parallelConfig ParallelWalkerConfig
	useParallel    bool

	// Callback when indexing completes
	onIndexComplete func()

	// Last known state for change detection
	lastKnownCount   int
	lastKnownModTime time.Time
	stateMu          sync.RWMutex
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
		db:             db,
		mediaDir:       mediaDir,
		indexInterval:  indexInterval,
		pollInterval:   defaultPollInterval,
		stopChan:       make(chan struct{}),
		startTime:      time.Now(),
		parallelConfig: DefaultParallelWalkerConfig(),
		useParallel:    true,
	}
	idx.indexProgress.Store(IndexProgress{})
	return idx
}

// SetPollInterval sets the interval for polling-based change detection.
func (idx *Indexer) SetPollInterval(interval time.Duration) {
	if interval > 0 {
		idx.pollInterval = interval
	}
}

// SetParallelWalking enables or disables parallel directory walking.
func (idx *Indexer) SetParallelWalking(enabled bool) {
	idx.useParallel = enabled
}

// SetParallelConfig sets the parallel walker configuration.
func (idx *Indexer) SetParallelConfig(config ParallelWalkerConfig) {
	idx.parallelConfig = config
}

// SetOnIndexComplete sets a callback to be invoked when indexing completes.
func (idx *Indexer) SetOnIndexComplete(callback func()) {
	idx.onIndexComplete = callback
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

	// Start polling-based change detection
	go idx.pollForChanges()

	// Start periodic full re-index
	go idx.periodicIndex()

	return nil
}

// Stop stops the indexing process.
func (idx *Indexer) Stop() {
	close(idx.stopChan)
}

// IsReady returns true if the server is ready to accept traffic.
func (idx *Indexer) IsReady() bool {
	if idx.filesIndexed.Load()+idx.foldersIndexed.Load() >= minFilesForReady {
		return true
	}

	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()
	return idx.initialIndexComplete
}

// getProgress safely retrieves the current IndexProgress.
func (idx *Indexer) getProgress() IndexProgress {
	if progress, ok := idx.indexProgress.Load().(IndexProgress); ok {
		return progress
	}
	return IndexProgress{}
}

// GetHealthStatus returns detailed health information.
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

// HealthStatus contains health check information.
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

// pollForChanges periodically checks for file changes using filesystem scanning.
func (idx *Indexer) pollForChanges() {
	// Wait for initial index to complete
	for !idx.IsReady() {
		select {
		case <-time.After(1 * time.Second):
		case <-idx.stopChan:
			return
		}
	}

	logging.Info("Starting change detection polling (interval: %v)", idx.pollInterval)

	ticker := time.NewTicker(idx.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			changed, err := idx.detectChanges()
			if err != nil {
				logging.Error("Error detecting changes: %v", err)
				continue
			}
			if changed {
				logging.Info("File changes detected, triggering re-index")
				if err := idx.Index(); err != nil {
					logging.Error("Re-index after change detection failed: %v", err)
				}
			}
		case <-idx.stopChan:
			logging.Info("Change detection polling stopped")
			return
		}
	}
}

// detectChanges performs a quick scan to detect if files have changed.
func (idx *Indexer) detectChanges() (bool, error) {
	start := time.Now()
	defer func() {
		metrics.IndexerPollDuration.Observe(time.Since(start).Seconds())
		metrics.IndexerPollChecksTotal.Inc()
	}()
	var currentCount int
	var newestModTime time.Time

	err := filepath.WalkDir(idx.mediaDir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil //nolint:nilerr // Intentionally continue walking on error
		}

		// Skip hidden files and directories
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Only count media files and directories
		if d.IsDir() {
			currentCount++
		} else {
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if mediatypes.IsMediaFile(ext) {
				currentCount++

				// Get modification time
				info, err := d.Info()
				if err == nil && info.ModTime().After(newestModTime) {
					metrics.IndexerPollChangesDetected.Inc()
					newestModTime = info.ModTime()
				}
			}
		}

		return nil
	})

	if err != nil {
		return false, fmt.Errorf("failed to walk directory: %w", err)
	}

	// Compare with last known state
	idx.stateMu.RLock()
	lastCount := idx.lastKnownCount
	lastModTime := idx.lastKnownModTime
	idx.stateMu.RUnlock()

	// Check for changes
	if currentCount != lastCount {
		logging.Debug("File count changed: %d -> %d", lastCount, currentCount)
		metrics.IndexerPollChangesDetected.Inc()

		return true, nil
	}

	if newestModTime.After(lastModTime) {
		logging.Debug("Newer modification time found: %v > %v", newestModTime, lastModTime)
		metrics.IndexerPollChangesDetected.Inc()

		return true, nil
	}

	return false, nil
}

// updateLastKnownState updates the cached state after indexing.
func (idx *Indexer) updateLastKnownState() {
	var count int
	var newestModTime time.Time

	_ = filepath.WalkDir(idx.mediaDir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil //nolint:nilerr // Intentionally continue walking on error
		}

		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if d.IsDir() {
			count++
		} else {
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if mediatypes.IsMediaFile(ext) {
				count++
				info, err := d.Info()
				if err == nil && info.ModTime().After(newestModTime) {
					newestModTime = info.ModTime()
				}
			}
		}

		return nil
	})

	idx.stateMu.Lock()
	idx.lastKnownCount = count
	idx.lastKnownModTime = newestModTime
	idx.stateMu.Unlock()

	logging.Debug("Updated last known state: count=%d, newestMod=%v", count, newestModTime)
}

// Index performs a full index of the media directory.
func (idx *Indexer) Index() error {
	if !idx.tryStartIndexing() {
		logging.Info("Index already in progress, skipping...")
		return nil
	}
	defer idx.finishIndexing()

	metrics.IndexerIsRunning.Set(1)
	defer metrics.IndexerIsRunning.Set(0)
	metrics.IndexerRunsTotal.Inc()

	startTime := time.Now()
	logging.Info("Starting file indexing...")

	idx.resetCounters(startTime)

	indexTime := time.Now()

	var result indexResult
	var err error

	if idx.useParallel {
		result, err = idx.parallelWalkAndIndex(startTime)
	} else {
		result, err = idx.walkAndIndex(startTime)
	}

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

	// Update last known state for change detection
	idx.updateLastKnownState()

	// Update metrics
	duration := time.Since(startTime).Seconds()
	metrics.IndexerLastRunTimestamp.Set(float64(time.Now().Unix()))
	metrics.IndexerLastRunDuration.Set(duration)
	metrics.IndexerFilesProcessed.Add(float64(result.totalFiles))
	metrics.IndexerFoldersProcessed.Add(float64(result.totalFolders))

	return nil
}

// parallelWalkAndIndex uses parallel directory walking for faster indexing.
func (idx *Indexer) parallelWalkAndIndex(startTime time.Time) (indexResult, error) {
	logging.Info("Using parallel directory walking with %d workers", idx.parallelConfig.NumWorkers)

	walker := NewParallelWalker(idx.mediaDir, idx.parallelConfig)

	go func() {
		select {
		case <-idx.stopChan:
			walker.Stop()
		case <-walker.ctx.Done():
		}
	}()

	files, err := walker.Walk()
	if err != nil && !errors.Is(err, fs.SkipAll) {
		return indexResult{}, fmt.Errorf("parallel walk error: %w", err)
	}

	totalFiles, totalFolders, _ := walker.Stats()

	idx.filesIndexed.Store(totalFiles)
	idx.foldersIndexed.Store(totalFolders)
	idx.updateProgress(startTime)

	if err := idx.processBatchedFiles(files, startTime); err != nil {
		return indexResult{}, err
	}

	return indexResult{
		totalFiles:   totalFiles,
		totalFolders: totalFolders,
	}, nil
}

// processBatchedFiles inserts files into the database in batches.
func (idx *Indexer) processBatchedFiles(files []database.MediaFile, startTime time.Time) error {
	totalFiles := len(files)
	logging.Info("Processing %d files in batches of %d", totalFiles, idx.parallelConfig.BatchSize)

	for i := 0; i < totalFiles; i += idx.parallelConfig.BatchSize {
		select {
		case <-idx.stopChan:
			return fs.SkipAll
		default:
		}

		end := i + idx.parallelConfig.BatchSize
		if end > totalFiles {
			end = totalFiles
		}

		batch := files[i:end]

		if err := idx.processBatch(batch); err != nil {
			logging.Error("Error processing batch: %v", err)
		}

		idx.updateProgress(startTime)

		time.Sleep(batchDelay)

		if (i+idx.parallelConfig.BatchSize)%5000 == 0 || end == totalFiles {
			logging.Info("Database insert progress: %d/%d files", end, totalFiles)
		}
	}

	return nil
}

// tryStartIndexing attempts to start indexing, returns false if already in progress.
func (idx *Indexer) tryStartIndexing() bool {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()

	if idx.isIndexing {
		return false
	}
	idx.isIndexing = true
	return true
}

// finishIndexing marks indexing as complete.
func (idx *Indexer) finishIndexing() {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()

	idx.isIndexing = false
	idx.initialIndexComplete = true
}

// resetCounters resets the indexing counters.
func (idx *Indexer) resetCounters(startTime time.Time) {
	idx.filesIndexed.Store(0)
	idx.foldersIndexed.Store(0)
	idx.indexProgress.Store(IndexProgress{
		IsIndexing: true,
		StartedAt:  startTime,
	})
}

// indexResult holds the results of the walk and index operation.
type indexResult struct {
	totalFiles   int64
	totalFolders int64
}

// walkAndIndex walks the media directory and indexes files in batches (sequential mode).
func (idx *Indexer) walkAndIndex(startTime time.Time) (indexResult, error) {
	logging.Info("Using sequential directory walking")

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

// processPath processes a single path during the directory walk.
func (idx *Indexer) processPath(
	path string,
	info os.FileInfo,
	err error,
	currentBatch *[]database.MediaFile,
	result *indexResult,
	startTime time.Time,
) error {
	select {
	case <-idx.stopChan:
		return fs.SkipAll
	default:
	}

	if err != nil {
		logging.Warn("Error accessing path %s: %v", path, err)
		return nil
	}

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

	if relPath == "." {
		return nil
	}

	file, ok := idx.createMediaFile(relPath, info)
	if !ok {
		return nil
	}

	if info.IsDir() {
		result.totalFolders++
		idx.foldersIndexed.Add(1)
	} else {
		result.totalFiles++
		idx.filesIndexed.Add(1)
	}

	*currentBatch = append(*currentBatch, file)

	if len(*currentBatch) >= batchSize {
		if err := idx.processBatch(*currentBatch); err != nil {
			logging.Error("Error processing batch: %v", err)
		}
		*currentBatch = (*currentBatch)[:0]

		idx.updateProgress(startTime)

		time.Sleep(batchDelay)

		total := result.totalFiles + result.totalFolders
		if total%5000 == 0 {
			logging.Info("Indexed %d files, %d folders...", result.totalFiles, result.totalFolders)
		}
	}

	return nil
}

// createMediaFile creates a MediaFile struct from path and file info.
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
	fileType := mediatypes.GetFileType(ext)

	if fileType == mediatypes.FileTypeOther {
		return database.MediaFile{}, false
	}

	return database.MediaFile{
		Name:       info.Name(),
		Path:       relPath,
		ParentPath: parentPath,
		Type:       fileType,
		Size:       info.Size(),
		ModTime:    info.ModTime(),
		MimeType:   mediatypes.GetMimeType(ext),
		FileHash:   fmt.Sprintf("%x", md5.Sum([]byte(fmt.Sprintf("%s%d%d", relPath, info.Size(), info.ModTime().Unix())))),
	}, true
}

// updateProgress updates the indexing progress.
func (idx *Indexer) updateProgress(startTime time.Time) {
	idx.indexProgress.Store(IndexProgress{
		FilesIndexed:   idx.filesIndexed.Load(),
		FoldersIndexed: idx.foldersIndexed.Load(),
		IsIndexing:     true,
		StartedAt:      startTime,
	})
}

// finalizeIndex completes the indexing process and updates stats.
func (idx *Indexer) finalizeIndex(startTime time.Time, totalFiles, totalFolders int64) {
	duration := time.Since(startTime)

	idx.indexMu.Lock()
	idx.lastIndexTime = time.Now()
	idx.indexMu.Unlock()

	idx.indexProgress.Store(IndexProgress{
		FilesIndexed:   totalFiles,
		FoldersIndexed: totalFolders,
		IsIndexing:     false,
	})

	stats, _ := idx.db.CalculateStats()
	stats.LastIndexed = idx.lastIndexTime
	stats.IndexDuration = duration.String()
	idx.db.UpdateStats(stats)

	logging.Info("Index complete: %d files, %d folders in %v", totalFiles, totalFolders, duration)

	if idx.onIndexComplete != nil {
		idx.onIndexComplete()
	}
}

// processBatch processes a batch of files in a single transaction.
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

// cleanupMissingFiles removes files from the database that no longer exist on disk.
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

// TriggerIndex manually triggers a re-index.
func (idx *Indexer) TriggerIndex() {
	go func() {
		if err := idx.Index(); err != nil {
			logging.Error("manually triggered re-index failed: %v", err)
		}
	}()
}

// GetProgress returns the current indexing progress.
func (idx *Indexer) GetProgress() IndexProgress {
	return idx.getProgress()
}
