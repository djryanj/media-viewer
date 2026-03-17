package indexer

import (
	"context"
	"crypto/md5" //nolint:gosec // MD5 used for cache key generation, not security
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"
	"media-viewer/internal/mediatypes"
	"media-viewer/internal/metrics"
)

// ParallelWalkerConfig configures the parallel directory walker
type ParallelWalkerConfig struct {
	// NumWorkers is the number of parallel workers (0 = auto based on CPU)
	NumWorkers int
	// BatchSize is the number of files to collect before sending to database
	BatchSize int
	// ChannelBuffer is the size of the work channel buffer
	ChannelBuffer int
	// SkipHidden skips files and directories starting with "."
	SkipHidden bool
}

// DefaultParallelWalkerConfig returns sensible defaults based on available resources
func DefaultParallelWalkerConfig() ParallelWalkerConfig {
	// Default to 3 workers - safe for NFS and still performant for local filesystems
	// Users can override with INDEX_WORKERS environment variable if needed
	numWorkers := 3
	if override := os.Getenv("INDEX_WORKERS"); override != "" {
		if count, err := strconv.Atoi(override); err == nil && count > 0 {
			numWorkers = count
		}
	}

	return ParallelWalkerConfig{
		NumWorkers:    numWorkers,
		BatchSize:     500,
		ChannelBuffer: 1000,
		SkipHidden:    true,
	}
}

// fileJob represents a file to be processed
type fileJob struct {
	path       string
	info       os.FileInfo
	relPath    string
	enqueuedAt time.Time // when the job was sent to the jobs channel; used to measure worker queue wait time
}

// fileResult represents a processed file
type fileResult struct {
	file  *database.MediaFile
	isDir bool
	err   error
}

// ParallelWalker walks directories in parallel
type ParallelWalker struct {
	config   ParallelWalkerConfig
	mediaDir string

	// Channels
	jobs    chan fileJob
	results chan fileResult

	// Synchronization
	wg     sync.WaitGroup
	ctx    context.Context
	cancel context.CancelFunc

	// Statistics
	filesProcessed   atomic.Int64
	foldersProcessed atomic.Int64
	errorsCount      atomic.Int64
}

// NewParallelWalker creates a new parallel directory walker
func NewParallelWalker(mediaDir string, config ParallelWalkerConfig) *ParallelWalker {
	ctx, cancel := context.WithCancel(context.Background())

	return &ParallelWalker{
		config:   config,
		mediaDir: mediaDir,
		jobs:     make(chan fileJob, config.ChannelBuffer),
		results:  make(chan fileResult, config.ChannelBuffer),
		ctx:      ctx,
		cancel:   cancel,
	}
}

// Walk performs a parallel walk of the directory tree
// Returns all media files found, organized for batch database insertion
func (pw *ParallelWalker) Walk() ([]database.MediaFile, error) {
	logging.Info("Starting parallel directory walk with %d workers", pw.config.NumWorkers)
	startTime := time.Now()

	// Record worker count metric
	metrics.IndexerParallelWorkers.Set(float64(pw.config.NumWorkers))

	// Start workers
	for i := 0; i < pw.config.NumWorkers; i++ {
		pw.wg.Add(1)
		go pw.worker(i)
	}

	// Start result collector
	var allFiles []database.MediaFile
	var collectorWg sync.WaitGroup
	var collectorErr error
	var mu sync.Mutex

	var walkCount int64

	collectorWg.Add(1)
	go func() {
		defer collectorWg.Done()
		for result := range pw.results {
			if result.err != nil {
				pw.errorsCount.Add(1)
				logging.Debug("Error processing file: %v", result.err)
				continue
			}
			if result.file != nil {
				mu.Lock()
				allFiles = append(allFiles, *result.file)
				mu.Unlock()

				n := atomic.AddInt64(&walkCount, 1)
				if n%500 == 0 {
					elapsed := time.Since(startTime)
					itemsPerSecond := 0.0
					if elapsed.Seconds() > 0 {
						itemsPerSecond = float64(n) / elapsed.Seconds()
					}
					logging.Info("Walk progress: %d items discovered (%.0f items/s)",
						n, itemsPerSecond)
				}
			}
		}
	}()

	// Walk directory tree and send jobs
	err := pw.walkAndEnqueue()

	// Close jobs channel to signal workers to stop
	close(pw.jobs)

	// Wait for all workers to complete
	pw.wg.Wait()

	// Close results channel
	close(pw.results)

	// Wait for collector to finish
	collectorWg.Wait()

	duration := time.Since(startTime)
	metrics.IndexerWalkPhaseDuration.Set(duration.Seconds())
	logging.Info("Parallel walk complete: %d files, %d folders in %v (errors: %d)",
		pw.filesProcessed.Load(),
		pw.foldersProcessed.Load(),
		duration,
		pw.errorsCount.Load())

	if err != nil {
		return allFiles, err
	}
	return allFiles, collectorErr
}

// walkAndEnqueue walks the directory tree and sends jobs to workers
func (pw *ParallelWalker) walkAndEnqueue() error {
	return filepath.WalkDir(pw.mediaDir, func(path string, d fs.DirEntry, err error) error {
		// Check for cancellation
		select {
		case <-pw.ctx.Done():
			return fs.SkipAll
		default:
		}

		if err != nil {
			logging.Warn("Error accessing path %s: %v", path, err)
			return nil // Continue walking
		}

		// Skip hidden files and directories
		if pw.config.SkipHidden && strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Get relative path
		relPath, err := filepath.Rel(pw.mediaDir, path)
		if err != nil {
			//nolint:nilerr // Intentionally continue walking on error - skip this file but process others
			return nil
		}

		// Skip root
		if relPath == "." {
			//nolint:nilerr // Intentionally continue walking on error - skip this file but process others
			return nil
		}

		// Time the actual NFS stat call (d.Info() is a GETATTR round-trip).
		// This directly measures per-file NFS latency independent of CPU load.
		// If P99 of IndexerDirStatDuration is fast but IndexerJobQueueWait is
		// high, the bottleneck is CPU/scheduling, not NFS.
		statStart := time.Now()
		info, err := d.Info()
		metrics.IndexerDirStatDuration.Observe(time.Since(statStart).Seconds())
		if err != nil {
			logging.Warn("Error getting info for %s: %v", path, err)
			return nil
		}

		// Send job to workers
		select {
		case pw.jobs <- fileJob{path: path, info: info, relPath: relPath, enqueuedAt: time.Now()}:
		case <-pw.ctx.Done():
			return fs.SkipAll
		}

		return nil
	})
}

// worker processes files from the jobs channel
func (pw *ParallelWalker) worker(id int) {
	defer pw.wg.Done()

	logging.Debug("Worker %d started", id)

	for job := range pw.jobs {
		select {
		case <-pw.ctx.Done():
			return
		default:
		}

		// Measure how long this job waited in the channel before we picked it up.
		// High values (>10ms) indicate CPU/goroutine scheduling pressure rather
		// than NFS slowness — the workers are not getting scheduled promptly.
		metrics.IndexerJobQueueWait.Observe(time.Since(job.enqueuedAt).Seconds())

		result := pw.processFile(job)

		// Update counters
		if result.err == nil && result.file != nil {
			if result.isDir {
				pw.foldersProcessed.Add(1)
			} else {
				pw.filesProcessed.Add(1)
			}
		}

		// Send result
		select {
		case pw.results <- result:
		case <-pw.ctx.Done():
			return
		}
	}

	logging.Debug("Worker %d finished", id)
}

// processFile processes a single file job
func (pw *ParallelWalker) processFile(job fileJob) fileResult {
	parentPath := filepath.Dir(job.relPath)
	if parentPath == "." {
		parentPath = ""
	}

	if job.info.IsDir() {
		hashStart := time.Now()
		hash := fmt.Sprintf("%x", md5.Sum([]byte(job.relPath+job.info.ModTime().String()))) //nolint:gosec // MD5 used for cache key generation, not security
		metrics.FileHashComputeDuration.Observe(time.Since(hashStart).Seconds())
		depth := strings.Count(job.relPath, string(filepath.Separator)) + 1
		metrics.DirectoryWalkDepth.Observe(float64(depth))
		return fileResult{
			file: &database.MediaFile{
				Name:       job.info.Name(),
				Path:       job.relPath,
				ParentPath: parentPath,
				Type:       database.FileTypeFolder,
				Size:       0,
				ModTime:    job.info.ModTime(),
				FileHash:   hash,
			},
			isDir: true,
		}
	}

	ext := strings.ToLower(filepath.Ext(job.info.Name()))
	fileType := mediatypes.GetFileType(ext)

	if fileType == mediatypes.FileTypeOther {
		return fileResult{}
	}

	mimeType := mediatypes.GetMimeType(ext)

	// Content-sniff image files to catch misnamed media (e.g. an animated GIF
	// saved with a .jpg extension).  Mirrors the same logic in createMediaFile.
	if fileType == mediatypes.FileTypeImage {
		if sniffedType, sniffedMime, ok := mediatypes.SniffFileType(filepath.Join(pw.mediaDir, job.relPath)); ok {
			logging.Debug("parallel processFile: content sniff overrides type for %s: %s → %s",
				job.relPath, fileType, sniffedType)
			fileType = sniffedType
			mimeType = sniffedMime
		}
	}

	hashStart := time.Now()
	hash := fmt.Sprintf("%x", md5.Sum([]byte(fmt.Sprintf("%s%d%d", job.relPath, job.info.Size(), job.info.ModTime().Unix())))) //nolint:gosec // MD5 used for cache key generation, not security
	metrics.FileHashComputeDuration.Observe(time.Since(hashStart).Seconds())
	return fileResult{
		file: &database.MediaFile{
			Name:       job.info.Name(),
			Path:       job.relPath,
			ParentPath: parentPath,
			Type:       fileType,
			Size:       job.info.Size(),
			ModTime:    job.info.ModTime(),
			MimeType:   mimeType,
			FileHash:   hash,
		},
		isDir: false,
	}
}

// Stop cancels the parallel walk
func (pw *ParallelWalker) Stop() {
	pw.cancel()
}

// Stats returns current processing statistics
func (pw *ParallelWalker) Stats() (files, folders, errors int64) {
	return pw.filesProcessed.Load(), pw.foldersProcessed.Load(), pw.errorsCount.Load()
}
