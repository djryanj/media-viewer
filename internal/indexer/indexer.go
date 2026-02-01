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
	indexProgress  atomic.Value

	// Parallel walker configuration
	parallelConfig ParallelWalkerConfig
	useParallel    bool

	// Callback when indexing completes
	onIndexComplete func()

	// Last known state for lightweight change detection
	stateMu            sync.RWMutex
	lastRootModTime    time.Time
	lastTopLevelCount  int
	lastSubdirModTimes map[string]time.Time
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
		db:                 db,
		mediaDir:           mediaDir,
		indexInterval:      indexInterval,
		pollInterval:       defaultPollInterval,
		stopChan:           make(chan struct{}),
		startTime:          time.Now(),
		parallelConfig:     DefaultParallelWalkerConfig(),
		useParallel:        true,
		lastSubdirModTimes: make(map[string]time.Time),
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

// pollForChanges periodically checks for file changes.
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

// detectChanges performs a lightweight check to detect if files have changed.
// It only checks the root directory's modification time and does a quick count
// of top-level entries, avoiding expensive recursive walks on NFS.
func (idx *Indexer) detectChanges() (bool, error) {
	start := time.Now()
	defer func() {
		metrics.IndexerPollDuration.Observe(time.Since(start).Seconds())
		metrics.IndexerPollChecksTotal.Inc()
	}()

	// Check if root directory has been modified
	rootInfo, err := os.Stat(idx.mediaDir)
	if err != nil {
		return false, fmt.Errorf("failed to stat media directory: %w", err)
	}

	idx.stateMu.RLock()
	lastRootModTime := idx.lastRootModTime
	lastTopLevelCount := idx.lastTopLevelCount
	idx.stateMu.RUnlock()

	// Check root directory modification time
	if rootInfo.ModTime().After(lastRootModTime) {
		logging.Debug("Root directory modified: %v > %v", rootInfo.ModTime(), lastRootModTime)
		metrics.IndexerPollChangesDetected.Inc()
		return true, nil
	}

	// Quick count of top-level entries (not recursive)
	entries, err := os.ReadDir(idx.mediaDir)
	if err != nil {
		return false, fmt.Errorf("failed to read media directory: %w", err)
	}

	topLevelCount := 0
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".") {
			topLevelCount++
		}
	}

	if topLevelCount != lastTopLevelCount {
		logging.Debug("Top-level count changed: %d -> %d", lastTopLevelCount, topLevelCount)
		metrics.IndexerPollChangesDetected.Inc()
		return true, nil
	}

	// Check a sample of subdirectories for modification
	if idx.checkSubdirectorySample(entries) {
		metrics.IndexerPollChangesDetected.Inc()
		return true, nil
	}

	return false, nil
}

// checkSubdirectorySample checks modification times of a sample of subdirectories.
// This catches changes in nested folders without walking the entire tree.
func (idx *Indexer) checkSubdirectorySample(entries []fs.DirEntry) bool {
	idx.stateMu.RLock()
	lastSubdirModTimes := idx.lastSubdirModTimes
	idx.stateMu.RUnlock()

	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		path := filepath.Join(idx.mediaDir, entry.Name())
		info, err := os.Stat(path)
		if err != nil {
			continue
		}

		if lastMod, exists := lastSubdirModTimes[entry.Name()]; exists {
			if info.ModTime().After(lastMod) {
				logging.Debug("Subdirectory %s modified: %v > %v", entry.Name(), info.ModTime(), lastMod)
				return true
			}
		} else {
			// New subdirectory
			logging.Debug("New subdirectory detected: %s", entry.Name())
			return true
		}
	}

	return false
}

// updateLastKnownState updates the cached state after indexing.
func (idx *Indexer) updateLastKnownState() {
	rootInfo, err := os.Stat(idx.mediaDir)
	if err != nil {
		logging.Warn("Failed to stat media directory for state update: %v", err)
		return
	}

	entries, err := os.ReadDir(idx.mediaDir)
	if err != nil {
		logging.Warn("Failed to read media directory for state update: %v", err)
		return
	}

	topLevelCount := 0
	subdirModTimes := make(map[string]time.Time)

	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		topLevelCount++

		if entry.IsDir() {
			path := filepath.Join(idx.mediaDir, entry.Name())
			if info, err := os.Stat(path); err == nil {
				subdirModTimes[entry.Name()] = info.ModTime()
			}
		}
	}

	idx.stateMu.Lock()
	idx.lastRootModTime = rootInfo.ModTime()
	idx.lastTopLevelCount = topLevelCount
	idx.lastSubdirModTimes = subdirModTimes
	idx.stateMu.Unlock()

	logging.Debug("Updated last known state: rootMod=%v, topLevel=%d, subdirs=%d",
		rootInfo.ModTime(), topLevelCount, len(subdirModTimes))
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
