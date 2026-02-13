package media

import (
	"bytes"
	"context"
	"crypto/md5"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/filesystem"
	"media-viewer/internal/logging"
	"media-viewer/internal/memory"
	"media-viewer/internal/metrics"
	"media-viewer/internal/workers"

	// Image format decoders - required for image.Decode to support these formats
	_ "image/gif"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp" // WebP format support
)

// Sentinel errors
var (
	errSkipped = errors.New("skipped: thumbnail already exists")
)

const (
	folderThumbSize    = 200
	folderGridCellSize = 80
	folderGridGap      = 4
	folderGridPadding  = 20
	folderTabHeight    = 25
	maxSearchDepth     = 3

	// Background generation settings
	generationBatchSize  = 50
	generationBatchDelay = 100 * time.Millisecond

	// Cache metrics update interval
	cacheMetricsInterval = 1 * time.Minute

	// Maximum thumbnail workers (absolute cap) - capped at 6 for NFS performance
	// Thumbnail generation is I/O bound (disk reads + FFmpeg) not CPU bound
	maxThumbnailWorkers = 6

	// Metadata file extension for tracking source paths
	metaFileExtension = ".meta"
)

// ThumbnailGenerator generates and caches thumbnail images for media files.
type ThumbnailGenerator struct {
	cacheDir           string
	mediaDir           string
	enabled            bool
	db                 *database.Database
	generationInterval time.Duration
	memoryMonitor      *memory.Monitor

	// Background generation state
	stopChan        chan struct{}
	generationMu    sync.RWMutex
	isGenerating    atomic.Bool
	generationStats GenerationStats

	// Cache metrics state
	cacheMetricsMu  sync.RWMutex
	lastCacheSize   int64
	lastCacheCount  int
	cachedSize      atomic.Int64
	cachedCount     atomic.Int64
	lastCacheUpdate atomic.Int64 // Unix timestamp

	// Per-file locks to allow parallel generation of different files
	fileLocks sync.Map

	// Callback for post-index generation
	onIndexComplete chan struct{}
}

// thumbnailResult holds the result of a thumbnail generation attempt
type thumbnailResult struct {
	path    string
	skipped bool
	err     error
}

// GenerationStats tracks thumbnail generation progress
type GenerationStats struct {
	InProgress         bool      `json:"inProgress"`
	StartedAt          time.Time `json:"startedAt,omitempty"`
	LastCompleted      time.Time `json:"lastCompleted,omitempty"`
	TotalFiles         int       `json:"totalFiles"`
	Processed          int       `json:"processed"`
	Generated          int       `json:"generated"`
	Skipped            int       `json:"skipped"`
	Failed             int       `json:"failed"`
	OrphansRemoved     int       `json:"orphansRemoved"`
	FoldersUpdated     int       `json:"foldersUpdated"`
	CurrentFile        string    `json:"currentFile,omitempty"`
	IsIncremental      bool      `json:"isIncremental"`
	TotalMemoryUsed    uint64    `json:"-"` // Not exposed in JSON, internal tracking
	MemoryTrackedCount int       `json:"-"` // Count of images where memory was tracked
}

// ThumbnailStatus represents the current thumbnail system status
type ThumbnailStatus struct {
	Enabled        bool             `json:"enabled"`
	CacheDir       string           `json:"cacheDir"`
	CacheCount     int              `json:"cacheCount"`
	CacheSize      int64            `json:"cacheSize"`
	CacheSizeHuman string           `json:"cacheSizeHuman"`
	Generation     *GenerationStats `json:"generation,omitempty"`
}

// Folder colors
var (
	folderBodyColor  = color.RGBA{R: 240, G: 200, B: 100, A: 255}
	folderTabColor   = color.RGBA{R: 220, G: 180, B: 80, A: 255}
	folderInnerColor = color.RGBA{R: 250, G: 235, B: 180, A: 255}
)

// NewThumbnailGenerator creates a new ThumbnailGenerator instance.
func NewThumbnailGenerator(cacheDir, mediaDir string, enabled bool, db *database.Database, generationInterval time.Duration, memMonitor *memory.Monitor) *ThumbnailGenerator {
	if enabled {
		logging.Debug("ThumbnailGenerator: enabled, cache dir: %s", cacheDir)
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			logging.Warn("ThumbnailGenerator: failed to create cache dir: %v", err)
		}

		// Initialize libvips for memory-efficient image processing
		if err := InitVips(); err != nil {
			logging.Warn("Failed to initialize libvips: %v (will use fallback methods)", err)
		}
	} else {
		logging.Debug("ThumbnailGenerator: disabled")
	}

	if generationInterval <= 0 {
		generationInterval = 6 * time.Hour
	}

	return &ThumbnailGenerator{
		cacheDir:           cacheDir,
		mediaDir:           mediaDir,
		enabled:            enabled,
		db:                 db,
		generationInterval: generationInterval,
		memoryMonitor:      memMonitor,
		stopChan:           make(chan struct{}),
		onIndexComplete:    make(chan struct{}, 1),
	}
}

// IsEnabled returns whether thumbnail generation is enabled.
func (t *ThumbnailGenerator) IsEnabled() bool {
	return t.enabled
}

// NotifyIndexComplete signals that indexing has completed and thumbnails should be updated.
func (t *ThumbnailGenerator) NotifyIndexComplete() {
	select {
	case t.onIndexComplete <- struct{}{}:
		logging.Debug("Thumbnail generator notified of index completion")
	default:
		// Channel already has a pending notification
	}
}

// getLock gets or creates a lock for a specific file path
func (t *ThumbnailGenerator) getLock(path string) *sync.Mutex {
	lock, _ := t.fileLocks.LoadOrStore(path, &sync.Mutex{})
	mu, ok := lock.(*sync.Mutex)
	if !ok {
		mu = &sync.Mutex{}
		t.fileLocks.Store(path, mu)
	}
	return mu
}

// releaseLock removes the lock for a file path
func (t *ThumbnailGenerator) releaseLock(path string) {
	t.fileLocks.Delete(path)
}

// getCacheKey returns the cache filename for a given file path
func (t *ThumbnailGenerator) getCacheKey(filePath string, fileType database.FileType) string {
	hash := md5.Sum([]byte(filePath))
	if fileType == database.FileTypeFolder {
		return fmt.Sprintf("%x.png", hash)
	}
	return fmt.Sprintf("%x.jpg", hash)
}

// getMetaPath returns the metadata file path for a cache key
func (t *ThumbnailGenerator) getMetaPath(cacheKey string) string {
	base := strings.TrimSuffix(cacheKey, filepath.Ext(cacheKey))
	return filepath.Join(t.cacheDir, base+metaFileExtension)
}

// writeMetaFile writes the source path to a metadata file
func (t *ThumbnailGenerator) writeMetaFile(cacheKey, sourcePath string) error {
	metaPath := t.getMetaPath(cacheKey)
	return os.WriteFile(metaPath, []byte(sourcePath), 0o644)
}

// readMetaFile reads the source path from a metadata file
func (t *ThumbnailGenerator) readMetaFile(cacheKey string) (string, error) {
	metaPath := t.getMetaPath(cacheKey)
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// deleteMetaFile removes the metadata file for a cache key
func (t *ThumbnailGenerator) deleteMetaFile(cacheKey string) {
	metaPath := t.getMetaPath(cacheKey)
	if err := os.Remove(metaPath); err != nil && !os.IsNotExist(err) {
		logging.Debug("Failed to remove meta file %s: %v", metaPath, err)
	}
}

// GetThumbnail generates or retrieves a cached thumbnail for the given file.
func (t *ThumbnailGenerator) GetThumbnail(ctx context.Context, filePath string, fileType database.FileType) ([]byte, error) {
	if !t.enabled {
		return nil, fmt.Errorf("thumbnails disabled")
	}

	// Check if context is already canceled
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context canceled: %w", err)
	}

	start := time.Now()
	fileTypeStr := string(fileType)

	// Folders don't need file existence check
	if fileType != database.FileTypeFolder {
		retryConfig := filesystem.DefaultRetryConfig()
		if _, err := filesystem.StatWithRetry(filePath, retryConfig); err != nil {
			metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_not_found").Inc()
			return nil, fmt.Errorf("file not accessible: %w", err)
		}
	}

	cacheKey := t.getCacheKey(filePath, fileType)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	// Check cache first
	cacheReadStart := time.Now()
	if data, err := os.ReadFile(cachePath); err == nil {
		metrics.ThumbnailCacheReadLatency.Observe(time.Since(cacheReadStart).Seconds())
		metrics.ThumbnailCacheHits.Inc()
		return data, nil
	}
	metrics.ThumbnailCacheMisses.Inc()

	// Get per-file lock
	fileLock := t.getLock(filePath)
	fileLock.Lock()
	defer func() {
		fileLock.Unlock()
		t.releaseLock(filePath)
	}()

	// Double-check cache after acquiring lock
	if data, err := os.ReadFile(cachePath); err == nil {
		metrics.ThumbnailCacheHits.Inc()
		return data, nil
	}

	logging.Debug("Thumbnail generating: %s (type: %s)", filePath, fileType)

	// Add 30-second timeout for thumbnail generation to prevent hung FFmpeg processes
	genCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Track memory before generation
	var memBefore runtime.MemStats
	runtime.ReadMemStats(&memBefore)

	var img image.Image
	var err error

	// Decode phase with timing
	decodeStart := time.Now()
	switch fileType {
	case database.FileTypeImage:
		img, err = t.generateImageThumbnail(genCtx, filePath)
	case database.FileTypeVideo:
		img, err = t.generateVideoThumbnail(genCtx, filePath)
	case database.FileTypeFolder:
		img, err = t.generateFolderThumbnail(genCtx, filePath)
	default:
		logging.Error("Thumbnail generation failed for %s: unsupported file type %s", filePath, fileType)
		metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_unsupported").Inc()
		return nil, fmt.Errorf("unsupported file type: %s", fileType)
	}
	metrics.ThumbnailGenerationDurationDetailed.WithLabelValues(fileTypeStr, "decode").Observe(time.Since(decodeStart).Seconds())

	if err != nil {
		logging.Error("Thumbnail generation failed for %s (type: %s): %v", filePath, fileType, err)
		metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error").Inc()
		return nil, fmt.Errorf("thumbnail generation failed: %w", err)
	}

	if img == nil {
		logging.Error("Thumbnail generation failed for %s (type: %s): returned nil image", filePath, fileType)
		metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_nil").Inc()
		return nil, fmt.Errorf("thumbnail generation returned nil image")
	}

	// Resize and encode phase with timing
	// Resize BEFORE encoding to reduce memory footprint
	resizeStart := time.Now()
	var thumb image.Image
	if fileType == database.FileTypeFolder {
		thumb = img // Folders already at correct size
	} else {
		thumb = imaging.Fit(img, 200, 200, imaging.Lanczos)
		runtime.GC() // Force GC to reclaim memory from large source image
	}
	metrics.ThumbnailGenerationDurationDetailed.WithLabelValues(fileTypeStr, "resize").Observe(time.Since(resizeStart).Seconds())

	var buf bytes.Buffer

	// Encode phase with timing
	encodeStart := time.Now()
	if fileType == database.FileTypeFolder {
		if err := png.Encode(&buf, thumb); err != nil {
			logging.Error("Thumbnail encoding failed for %s (type: %s): PNG encode error: %v", filePath, fileType, err)
			metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_encode").Inc()
			return nil, fmt.Errorf("failed to encode thumbnail as PNG: %w", err)
		}
	} else {
		if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 85}); err != nil {
			logging.Error("Thumbnail encoding failed for %s (type: %s): JPEG encode error: %v", filePath, fileType, err)
			metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_encode").Inc()
			return nil, fmt.Errorf("failed to encode thumbnail as JPEG: %w", err)
		}
	}
	metrics.ThumbnailGenerationDurationDetailed.WithLabelValues(fileTypeStr, "encode").Observe(time.Since(encodeStart).Seconds())

	// Cache the result
	cacheWriteStart := time.Now()
	if err := os.WriteFile(cachePath, buf.Bytes(), 0o644); err != nil {
		logging.Warn("Failed to cache thumbnail %s: %v", cachePath, err)
	} else {
		metrics.ThumbnailCacheWriteLatency.Observe(time.Since(cacheWriteStart).Seconds())
		metrics.ThumbnailGenerationDurationDetailed.WithLabelValues(fileTypeStr, "cache").Observe(time.Since(cacheWriteStart).Seconds())

		// Write metadata file for orphan tracking
		if err := t.writeMetaFile(cacheKey, filePath); err != nil {
			logging.Debug("Failed to write meta file for %s: %v", cacheKey, err)
		}
	}

	// Track memory used
	var memAfter runtime.MemStats
	runtime.ReadMemStats(&memAfter)
	if memAfter.Alloc > memBefore.Alloc {
		memoryUsed := memAfter.Alloc - memBefore.Alloc
		metrics.ThumbnailMemoryUsageBytes.WithLabelValues(fileTypeStr).Observe(float64(memoryUsed))

		// Accumulate memory stats for generation run
		t.generationMu.Lock()
		if t.generationStats.InProgress {
			t.generationStats.TotalMemoryUsed += memoryUsed
			t.generationStats.MemoryTrackedCount++
		}
		t.generationMu.Unlock()
	}

	metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "success").Inc()
	metrics.ThumbnailGenerationDuration.WithLabelValues(fileTypeStr).Observe(time.Since(start).Seconds())

	return buf.Bytes(), nil
}

// =============================================================================
// IMAGE THUMBNAIL GENERATION
// =============================================================================

func (t *ThumbnailGenerator) generateImageThumbnail(ctx context.Context, filePath string) (image.Image, error) {
	logging.Debug("Opening image: %s", filePath)

	// Check if context is canceled before starting
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context canceled: %w", err)
	}

	// Check memory before processing
	if t.memoryMonitor != nil && !t.memoryMonitor.WaitIfPaused() {
		return nil, fmt.Errorf("thumbnail generation stopped")
	}

	// Use constrained image loading to prevent OOM
	img, err := LoadImageConstrained(filePath, MaxImageDimension, MaxImagePixels)
	if err == nil {
		return img, nil
	}

	logging.Debug("Constrained load failed for %s: %v, trying fallback methods", filePath, err)

	// Check if context is canceled before trying fallback
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context canceled: %w", err)
	}

	// Try standard imaging library
	img, err = imaging.Open(filePath, imaging.AutoOrientation(true))
	if err == nil {
		return img, nil
	}

	logging.Debug("imaging.Open failed for %s: %v, trying ffmpeg fallback", filePath, err)

	// Check if context is canceled before trying ffmpeg
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context canceled: %w", err)
	}

	// FFmpeg fallback
	img, err = t.generateImageWithFFmpeg(ctx, filePath)
	if err != nil {
		logging.Error("Image thumbnail failed for %s: all decode methods exhausted (constrained load, imaging.Open, ffmpeg): %v", filePath, err)
		return nil, fmt.Errorf("all image decode methods failed for %s: %w", filePath, err)
	}

	return img, nil
}

func (t *ThumbnailGenerator) generateImageWithFFmpeg(ctx context.Context, filePath string) (image.Image, error) {
	logging.Debug("Using ffmpeg to decode image: %s", filePath)

	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("ffmpeg not found: %w", err)
	}
	logging.Debug("Using ffmpeg: %s", ffmpegPath)

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	ffmpegStart := time.Now()
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-i", filePath,
		"-vframes", "1",
		"-f", "image2pipe",
		"-vcodec", "png",
		"-pix_fmt", "rgb24",
		"-",
	)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	metrics.ThumbnailFFmpegDuration.WithLabelValues("image").Observe(time.Since(ffmpegStart).Seconds())
	if err != nil {
		logging.Error("FFmpeg image decode failed for %s: %v, stderr: %s", filePath, err, stderr.String())
		return nil, fmt.Errorf("ffmpeg failed: %w, stderr: %s", err, stderr.String())
	}

	if stdout.Len() == 0 {
		logging.Error("FFmpeg image decode failed for %s: no output produced", filePath)
		return nil, fmt.Errorf("ffmpeg produced no output for %s", filePath)
	}

	logging.Debug("FFmpeg image output size: %d bytes", stdout.Len())

	img, _, err := image.Decode(&stdout)
	if err != nil {
		logging.Error("FFmpeg image decode failed for %s: failed to decode PNG output: %v", filePath, err)
		return nil, fmt.Errorf("failed to decode ffmpeg output: %w", err)
	}

	return img, nil
}

// =============================================================================
// VIDEO THUMBNAIL GENERATION
// =============================================================================

func (t *ThumbnailGenerator) generateVideoThumbnail(ctx context.Context, filePath string) (image.Image, error) {
	logging.Debug("Extracting video frame: %s", filePath)

	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("ffmpeg not found: %w", err)
	}
	logging.Debug("Using ffmpeg: %s", ffmpegPath)

	// Create a timeout context derived from the parent
	timeoutCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// First attempt: Use 1 second seek (fast, works for most videos)
	ffmpegStart := time.Now()
	cmd := exec.CommandContext(timeoutCtx, "ffmpeg",
		"-i", filePath,
		"-ss", "00:00:01",
		"-vframes", "1",
		"-f", "image2pipe",
		"-vcodec", "png",
		"-",
	)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	metrics.ThumbnailFFmpegDuration.WithLabelValues("video").Observe(time.Since(ffmpegStart).Seconds())

	// Check if first attempt produced output
	if err == nil && stdout.Len() > 0 {
		// Success on first attempt
		img, _, err := image.Decode(&stdout)
		if err != nil {
			logging.Error("FFmpeg video thumbnail failed for %s: failed to decode PNG output: %v", filePath, err)
			return nil, fmt.Errorf("failed to decode ffmpeg output: %w", err)
		}
		return img, nil
	}

	// First attempt failed or produced no output - likely a short video
	logging.Debug("FFmpeg first attempt failed or produced no output for %s: %v, stderr: %s", filePath, err, stderr.String())

	// Check if context is canceled before retrying
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context canceled: %w", err)
	}

	// Second attempt: Probe duration and use intelligent seek time
	duration, probeErr := t.getVideoDuration(ctx, filePath)
	if probeErr == nil && duration > 0 {
		// Calculate seek time: 10% into video, minimum 0.1s, no maximum
		seekTime := duration * 0.1
		if seekTime < 0.1 {
			seekTime = 0.1 // Minimum 0.1s to skip potential black frames
		}

		seekTimeStr := formatSeekTime(seekTime)
		logging.Debug("Video duration: %.2fs, retrying with intelligent seek time: %s for %s", duration, seekTimeStr, filePath)

		// Create a new timeout context for intelligent retry
		retryCtx, retryCancel := context.WithTimeout(ctx, 30*time.Second)
		defer retryCancel()

		// #nosec G204 -- filePath is from validated media library, not user input
		cmd = exec.CommandContext(retryCtx, "ffmpeg",
			"-i", filePath,
			"-ss", seekTimeStr,
			"-vframes", "1",
			"-f", "image2pipe",
			"-vcodec", "png",
			"-",
		)
		stdout.Reset()
		stderr.Reset()
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		if err := cmd.Run(); err == nil && stdout.Len() > 0 {
			// Success on intelligent retry
			img, _, err := image.Decode(&stdout)
			if err != nil {
				logging.Error("FFmpeg video thumbnail failed for %s: failed to decode PNG output: %v", filePath, err)
				return nil, fmt.Errorf("failed to decode ffmpeg output: %w", err)
			}
			return img, nil
		}
		logging.Debug("FFmpeg intelligent retry failed for %s: %v, stderr: %s", filePath, err, stderr.String())
	} else {
		logging.Debug("Could not probe video duration for %s: %v, skipping intelligent retry", filePath, probeErr)
	}

	// Check if context is canceled before final fallback
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context canceled: %w", err)
	}

	// Final fallback: Try without seek time (most compatible, slowest)
	logging.Debug("Attempting final fallback without seek time for %s", filePath)

	fallbackCtx, fallbackCancel := context.WithTimeout(ctx, 30*time.Second)
	defer fallbackCancel()

	cmd = exec.CommandContext(fallbackCtx, "ffmpeg",
		"-i", filePath,
		"-vframes", "1",
		"-f", "image2pipe",
		"-vcodec", "png",
		"-",
	)
	stdout.Reset()
	stderr.Reset()
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		logging.Error("FFmpeg video thumbnail failed for %s (all attempts exhausted): %v, stderr: %s", filePath, err, stderr.String())
		return nil, fmt.Errorf("ffmpeg failed: %w, stderr: %s", err, stderr.String())
	}

	if stdout.Len() == 0 {
		logging.Error("FFmpeg video thumbnail failed for %s: no output produced (all attempts exhausted)", filePath)
		return nil, fmt.Errorf("ffmpeg produced no output for %s", filePath)
	}

	logging.Debug("FFmpeg output size: %d bytes", stdout.Len())

	img, _, err := image.Decode(&stdout)
	if err != nil {
		logging.Error("FFmpeg video thumbnail failed for %s: failed to decode PNG output: %v", filePath, err)
		return nil, fmt.Errorf("failed to decode ffmpeg output: %w", err)
	}

	return img, nil
}

// getVideoDuration probes a video file to get its duration in seconds
func (t *ThumbnailGenerator) getVideoDuration(ctx context.Context, filePath string) (float64, error) {
	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		return 0, fmt.Errorf("ffprobe not found: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// #nosec G204 -- filePath is from validated media library, not user input
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		filePath,
	)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("ffprobe failed: %w, stderr: %s", err, stderr.String())
	}

	durationStr := strings.TrimSpace(stdout.String())
	if durationStr == "" || durationStr == "N/A" {
		return 0, fmt.Errorf("no duration found in video")
	}

	duration, err := strconv.ParseFloat(durationStr, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse duration '%s': %w", durationStr, err)
	}

	return duration, nil
}

// formatSeekTime formats a float64 seconds value into FFmpeg seek time format (HH:MM:SS.ms)
func formatSeekTime(seconds float64) string {
	hours := int(seconds / 3600)
	minutes := int((seconds - float64(hours*3600)) / 60)
	secs := seconds - float64(hours*3600) - float64(minutes*60)
	return fmt.Sprintf("%02d:%02d:%06.3f", hours, minutes, secs)
}

// =============================================================================
// FOLDER THUMBNAIL GENERATION
// =============================================================================

func (t *ThumbnailGenerator) generateFolderThumbnail(ctx context.Context, folderPath string) (image.Image, error) {
	logging.Debug("Generating folder thumbnail: %s", folderPath)

	// Get relative path for database queries
	relativePath := folderPath
	if strings.HasPrefix(folderPath, t.mediaDir) {
		relativePath = strings.TrimPrefix(folderPath, t.mediaDir)
		relativePath = strings.TrimPrefix(relativePath, "/")
	}

	// Find images for the grid
	images := t.findImagesForFolder(ctx, relativePath, 4)
	logging.Debug("Found %d images for folder thumbnail", len(images))

	// Create the folder thumbnail
	return t.createFolderThumbnailImage(images)
}

// findImagesForFolder finds up to maxImages images/videos in the folder and its subdirectories
func (t *ThumbnailGenerator) findImagesForFolder(ctx context.Context, relativePath string, maxImages int) []image.Image {
	images := make([]image.Image, 0, maxImages)

	if t.db == nil {
		logging.Debug("Database not available for folder thumbnail")
		return images
	}

	// First, try to get media files directly from this folder
	mediaFiles, err := t.db.GetMediaFilesInFolder(ctx, relativePath, maxImages*2) // Get extra to have options
	if err != nil {
		logging.Error("GetMediaFilesInFolder failed: %v", err)
		return images
	}

	// Filter to images and videos, preferring images
	var imageFiles []database.MediaFile
	var videoFiles []database.MediaFile
	for _, f := range mediaFiles {
		switch f.Type {
		case database.FileTypeImage:
			imageFiles = append(imageFiles, f)
		case database.FileTypeVideo:
			videoFiles = append(videoFiles, f)
		}
	}

	// Combine: prefer images, fill remaining slots with videos
	candidates := imageFiles
	remainingSlots := maxImages - len(candidates)
	if remainingSlots > 0 && len(videoFiles) > 0 {
		if len(videoFiles) > remainingSlots {
			videoFiles = videoFiles[:remainingSlots]
		}
		candidates = append(candidates, videoFiles...)
	}

	logging.Debug("Found %d images and %d videos directly in folder %s", len(imageFiles), len(videoFiles), relativePath)

	// If we don't have enough, search subdirectories
	if len(candidates) < maxImages {
		additionalNeeded := maxImages - len(candidates)
		subMedia := t.findMediaInSubdirectories(ctx, relativePath, additionalNeeded, maxSearchDepth)
		candidates = append(candidates, subMedia...)
		logging.Debug("Found %d additional media files from subdirectories", len(subMedia))
	}

	// Limit to maxImages
	if len(candidates) > maxImages {
		candidates = candidates[:maxImages]
	}

	// Generate thumbnails for each candidate
	for _, f := range candidates {
		// Check if context is canceled
		if err := ctx.Err(); err != nil {
			logging.Debug("Context canceled while generating folder thumbnail components")
			break
		}

		fullPath := filepath.Join(t.mediaDir, f.Path)

		var img image.Image
		var err error

		switch f.Type {
		case database.FileTypeImage:
			img, err = t.generateImageThumbnail(ctx, fullPath)
		case database.FileTypeVideo:
			img, err = t.generateVideoThumbnail(ctx, fullPath)
		default:
			continue
		}

		if err != nil {
			logging.Warn("Folder thumbnail: failed to generate component thumbnail for %s (type: %s): %v", f.Path, f.Type, err)
			continue
		}

		// Crop to square
		squareImg := t.cropToSquare(img)
		// Resize to cell size
		resizedImg := imaging.Resize(squareImg, folderGridCellSize, folderGridCellSize, imaging.Lanczos)
		images = append(images, resizedImg)

		if len(images) >= maxImages {
			break
		}
	}

	return images
}

// findMediaInSubdirectories recursively searches for images and videos in subdirectories
func (t *ThumbnailGenerator) findMediaInSubdirectories(ctx context.Context, parentPath string, maxFiles, maxDepth int) []database.MediaFile {
	if maxDepth <= 0 || maxFiles <= 0 {
		return nil
	}

	var results []database.MediaFile

	// Get subdirectories using the database
	subfolders, err := t.db.GetSubfolders(ctx, parentPath)
	if err != nil {
		logging.Debug("Failed to get subfolders for %s: %v", parentPath, err)
		return results
	}

	for _, subfolder := range subfolders {
		if len(results) >= maxFiles {
			break
		}

		// Get media files from this subfolder
		remaining := maxFiles - len(results)
		mediaFiles, err := t.db.GetMediaFilesInFolder(ctx, subfolder.Path, remaining*2)
		if err != nil {
			logging.Debug("Failed to get media files from %s: %v", subfolder.Path, err)
			continue
		}

		// Filter and add images first, then videos
		var images, videos []database.MediaFile
		for _, f := range mediaFiles {
			switch f.Type {
			case database.FileTypeImage:
				images = append(images, f)
			case database.FileTypeVideo:
				videos = append(videos, f)
			}
		}

		// Add images first
		for _, f := range images {
			if len(results) >= maxFiles {
				break
			}
			results = append(results, f)
		}

		// Then videos
		for _, f := range videos {
			if len(results) >= maxFiles {
				break
			}
			results = append(results, f)
		}

		// If still need more, recurse into this subfolder
		if len(results) < maxFiles {
			remaining = maxFiles - len(results)
			subResults := t.findMediaInSubdirectories(ctx, subfolder.Path, remaining, maxDepth-1)
			results = append(results, subResults...)
		}
	}

	return results
}

// cropToSquare crops an image to a centered square
func (t *ThumbnailGenerator) cropToSquare(img image.Image) image.Image {
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	if width == height {
		return img
	}

	var cropRect image.Rectangle
	if width > height {
		offset := (width - height) / 2
		cropRect = image.Rect(offset, 0, offset+height, height)
	} else {
		offset := (height - width) / 2
		cropRect = image.Rect(0, offset, width, offset+width)
	}

	return imaging.Crop(img, cropRect)
}

// createFolderThumbnailImage creates the final folder thumbnail with the grid of images
func (t *ThumbnailGenerator) createFolderThumbnailImage(images []image.Image) (image.Image, error) {
	canvas := image.NewRGBA(image.Rect(0, 0, folderThumbSize, folderThumbSize))

	// Start with fully transparent background
	draw.Draw(canvas, canvas.Bounds(), image.Transparent, image.Point{}, draw.Src)

	// Draw folder background
	t.drawFolderBackground(canvas)

	// Draw the image grid based on how many images we have
	switch len(images) {
	case 0:
		t.drawEmptyFolderIcon(canvas)
	case 1:
		t.drawSingleImage(canvas, images[0])
	case 2:
		t.drawTwoImages(canvas, images)
	case 3:
		t.drawThreeImages(canvas, images)
	default:
		t.drawFourImages(canvas, images)
	}

	return canvas, nil
}

// drawFolderBackground draws the folder shape on a transparent background
func (t *ThumbnailGenerator) drawFolderBackground(canvas *image.RGBA) {
	bounds := canvas.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// Draw shadow first (semi-transparent)
	shadowColor := color.RGBA{R: 0, G: 0, B: 0, A: 50}
	shadowOffset := 3

	// Shadow for main body
	for y := folderTabHeight + shadowOffset; y < height; y++ {
		for x := shadowOffset; x < width; x++ {
			canvas.Set(x, y, shadowColor)
		}
	}

	// Draw folder tab (top left portion)
	tabWidth := width * 2 / 5
	for y := 0; y < folderTabHeight; y++ {
		for x := 0; x < tabWidth+y/2; x++ {
			if x < width {
				canvas.Set(x, y, folderTabColor)
			}
		}
	}

	// Draw main folder body
	for y := folderTabHeight - 2; y < height-shadowOffset; y++ {
		for x := 0; x < width-shadowOffset; x++ {
			canvas.Set(x, y, folderBodyColor)
		}
	}

	// Draw inner area (where images go)
	innerMargin := 8
	for y := folderTabHeight + innerMargin - 2; y < height-innerMargin-shadowOffset; y++ {
		for x := innerMargin; x < width-innerMargin-shadowOffset; x++ {
			canvas.Set(x, y, folderInnerColor)
		}
	}
}

// getGridArea returns the rectangle where the image grid should be drawn
func (t *ThumbnailGenerator) getGridArea() image.Rectangle {
	margin := 12
	return image.Rect(
		margin,
		folderTabHeight+margin,
		folderThumbSize-margin-4,
		folderThumbSize-margin-4,
	)
}

// drawSingleImage draws a single centered image
func (t *ThumbnailGenerator) drawSingleImage(canvas *image.RGBA, img image.Image) {
	gridArea := t.getGridArea()
	gridWidth := gridArea.Dx()
	gridHeight := gridArea.Dy()

	imgSize := min(gridWidth, gridHeight) * 3 / 4
	resized := imaging.Resize(img, imgSize, imgSize, imaging.Lanczos)

	x := gridArea.Min.X + (gridWidth-imgSize)/2
	y := gridArea.Min.Y + (gridHeight-imgSize)/2

	t.drawImageWithBorder(canvas, resized, x, y)
}

// drawTwoImages draws two images side by side
func (t *ThumbnailGenerator) drawTwoImages(canvas *image.RGBA, images []image.Image) {
	gridArea := t.getGridArea()
	gridWidth := gridArea.Dx()
	gridHeight := gridArea.Dy()

	imgSize := (gridWidth - folderGridGap) / 2
	if imgSize > gridHeight*3/4 {
		imgSize = gridHeight * 3 / 4
	}

	img1 := imaging.Resize(images[0], imgSize, imgSize, imaging.Lanczos)
	img2 := imaging.Resize(images[1], imgSize, imgSize, imaging.Lanczos)

	y := gridArea.Min.Y + (gridHeight-imgSize)/2

	totalWidth := imgSize*2 + folderGridGap
	startX := gridArea.Min.X + (gridWidth-totalWidth)/2

	t.drawImageWithBorder(canvas, img1, startX, y)
	t.drawImageWithBorder(canvas, img2, startX+imgSize+folderGridGap, y)
}

// drawThreeImages draws three images (2 on top, 1 centered below)
func (t *ThumbnailGenerator) drawThreeImages(canvas *image.RGBA, images []image.Image) {
	gridArea := t.getGridArea()
	gridWidth := gridArea.Dx()
	gridHeight := gridArea.Dy()

	imgSize := (min(gridWidth, gridHeight) - folderGridGap) / 2

	resized := make([]image.Image, 3)
	for i := 0; i < 3; i++ {
		resized[i] = imaging.Resize(images[i], imgSize, imgSize, imaging.Lanczos)
	}

	totalWidth := imgSize*2 + folderGridGap
	totalHeight := imgSize*2 + folderGridGap
	startX := gridArea.Min.X + (gridWidth-totalWidth)/2
	startY := gridArea.Min.Y + (gridHeight-totalHeight)/2

	t.drawImageWithBorder(canvas, resized[0], startX, startY)
	t.drawImageWithBorder(canvas, resized[1], startX+imgSize+folderGridGap, startY)

	bottomY := startY + imgSize + folderGridGap
	centerX := gridArea.Min.X + (gridWidth-imgSize)/2
	t.drawImageWithBorder(canvas, resized[2], centerX, bottomY)
}

// drawFourImages draws four images in a 2x2 grid
func (t *ThumbnailGenerator) drawFourImages(canvas *image.RGBA, images []image.Image) {
	gridArea := t.getGridArea()
	gridWidth := gridArea.Dx()
	gridHeight := gridArea.Dy()

	imgSize := (min(gridWidth, gridHeight) - folderGridGap) / 2

	resized := make([]image.Image, 4)
	for i := 0; i < 4; i++ {
		resized[i] = imaging.Resize(images[i], imgSize, imgSize, imaging.Lanczos)
	}

	totalWidth := imgSize*2 + folderGridGap
	totalHeight := imgSize*2 + folderGridGap
	startX := gridArea.Min.X + (gridWidth-totalWidth)/2
	startY := gridArea.Min.Y + (gridHeight-totalHeight)/2

	t.drawImageWithBorder(canvas, resized[0], startX, startY)
	t.drawImageWithBorder(canvas, resized[1], startX+imgSize+folderGridGap, startY)
	t.drawImageWithBorder(canvas, resized[2], startX, startY+imgSize+folderGridGap)
	t.drawImageWithBorder(canvas, resized[3], startX+imgSize+folderGridGap, startY+imgSize+folderGridGap)
}

// drawImageWithBorder draws an image with a subtle border/shadow
func (t *ThumbnailGenerator) drawImageWithBorder(canvas *image.RGBA, img image.Image, x, y int) {
	bounds := img.Bounds()
	imgWidth := bounds.Dx()
	imgHeight := bounds.Dy()

	shadowColor := color.RGBA{R: 100, G: 80, B: 40, A: 80}
	shadowRect := image.Rect(x+2, y+2, x+imgWidth+2, y+imgHeight+2)
	draw.Draw(canvas, shadowRect, &image.Uniform{shadowColor}, image.Point{}, draw.Over)

	borderWidth := 2
	borderRect := image.Rect(x-borderWidth, y-borderWidth, x+imgWidth+borderWidth, y+imgHeight+borderWidth)
	draw.Draw(canvas, borderRect, &image.Uniform{color.White}, image.Point{}, draw.Over)

	destRect := image.Rect(x, y, x+imgWidth, y+imgHeight)
	draw.Draw(canvas, destRect, img, bounds.Min, draw.Over)
}

// drawEmptyFolderIcon draws an icon indicating an empty folder
func (t *ThumbnailGenerator) drawEmptyFolderIcon(canvas *image.RGBA) {
	gridArea := t.getGridArea()
	centerX := gridArea.Min.X + gridArea.Dx()/2
	centerY := gridArea.Min.Y + gridArea.Dy()/2

	iconSize := 40
	iconColor := color.RGBA{R: 180, G: 150, B: 100, A: 220}

	x := centerX - iconSize/2
	y := centerY - iconSize/2

	for i := 0; i < iconSize/3; i++ {
		canvas.Set(x+i, y, iconColor)
		canvas.Set(x+i, y+1, iconColor)
	}
	canvas.Set(x+iconSize/3, y+2, iconColor)
	canvas.Set(x+iconSize/3+1, y+3, iconColor)

	for i := 0; i < iconSize; i++ {
		canvas.Set(x+i, y+4, iconColor)
		canvas.Set(x+i, y+iconSize-1, iconColor)
	}
	for i := 4; i < iconSize; i++ {
		canvas.Set(x, y+i, iconColor)
		canvas.Set(x+iconSize-1, y+i, iconColor)
	}

	dotY := centerY + 5
	dotSpacing := 8
	dotColor := color.RGBA{R: 150, G: 120, B: 80, A: 200}
	for i := -1; i <= 1; i++ {
		dotX := centerX + i*dotSpacing
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				canvas.Set(dotX+dx, dotY+dy, dotColor)
			}
		}
	}
}

// =============================================================================
// BACKGROUND GENERATION
// =============================================================================

// Start begins background thumbnail generation
func (t *ThumbnailGenerator) Start() {
	if !t.enabled {
		logging.Info("Thumbnail generation disabled, skipping background generation")
		return
	}

	logging.Info("Initializing thumbnail cache metrics...")
	t.UpdateCacheMetrics()

	go t.backgroundGenerationLoop()
	go t.cacheMetricsLoop()
}

// Stop stops background thumbnail generation
func (t *ThumbnailGenerator) Stop() {
	if t.stopChan != nil {
		close(t.stopChan)
	}

	// Shutdown libvips if it was initialized
	if t.enabled {
		ShutdownVips()
	}
}

// cacheMetricsLoop periodically updates cache metrics
func (t *ThumbnailGenerator) cacheMetricsLoop() {
	ticker := time.NewTicker(cacheMetricsInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			t.UpdateCacheMetrics()
		case <-t.stopChan:
			return
		}
	}
}

// backgroundGenerationLoop runs thumbnail generation on index completion and periodic timer
func (t *ThumbnailGenerator) backgroundGenerationLoop() {
	logging.Info("Thumbnail generator started (periodic interval: %v)", t.generationInterval)

	// Check if there's already a pending notification (index completed before we started listening)
	select {
	case <-t.onIndexComplete:
		logging.Info("Initial index already complete, starting full thumbnail generation")
		t.runGeneration(false)
	default:
		// No pending notification, wait for it
		logging.Info("Waiting for initial index to complete...")
		select {
		case <-t.onIndexComplete:
			logging.Info("Initial index complete, starting full thumbnail generation")
			t.runGeneration(false)
		case <-t.stopChan:
			return
		}
	}

	// Set up periodic timer
	ticker := time.NewTicker(t.generationInterval)
	defer ticker.Stop()

	for {
		select {
		case <-t.onIndexComplete:
			logging.Info("Index complete, running incremental thumbnail generation")
			t.runGeneration(true)

		case <-ticker.C:
			logging.Info("Periodic thumbnail generation triggered")
			t.runGeneration(true)

		case <-t.stopChan:
			logging.Info("Thumbnail generator stopped")
			return
		}
	}
}

// runGeneration performs thumbnail generation (incremental or full)
func (t *ThumbnailGenerator) runGeneration(incremental bool) {
	if !t.enabled || t.db == nil {
		return
	}

	// Use CompareAndSwap to atomically check and set the flag
	// This prevents race conditions where multiple goroutines could pass a Load() check
	if !t.isGenerating.CompareAndSwap(false, true) {
		logging.Info("Thumbnail generation already in progress, skipping")
		return
	}

	defer t.isGenerating.Store(false)

	ctx := context.Background()
	startTime := time.Now()

	metrics.ThumbnailGeneratorRunning.Set(1)
	defer metrics.ThumbnailGeneratorRunning.Set(0)

	var lastRun time.Time
	var err error

	if incremental {
		lastRun, err = t.db.GetLastThumbnailRun(ctx)
		if err != nil {
			logging.Warn("Failed to get last thumbnail run time, falling back to full generation: %v", err)
			incremental = false
		} else if lastRun.IsZero() {
			logging.Info("No previous thumbnail run found, performing full generation")
			incremental = false
		}
	}

	t.generationMu.Lock()
	t.generationStats = GenerationStats{
		InProgress:    true,
		StartedAt:     startTime,
		IsIncremental: incremental,
	}
	t.generationMu.Unlock()

	var files []database.MediaFile
	var folders []database.MediaFile

	if incremental {
		now := time.Now()
		logging.Info("Running incremental thumbnail generation (changes since %v)", lastRun.Format(time.RFC3339))
		logging.Debug("Incremental generation: lastRun=%v, age=%v, now=%v",
			lastRun.Format(time.RFC3339), now.Sub(lastRun), now.Format(time.RFC3339))

		files, err = t.db.GetFilesUpdatedSince(ctx, lastRun)
		if err != nil {
			logging.Error("Failed to get updated files: %v", err)
			t.finishGeneration(startTime)
			return
		}

		folders, err = t.db.GetFoldersWithUpdatedContents(ctx, lastRun)
		if err != nil {
			logging.Error("Failed to get folders with updated contents: %v", err)
		}

		logging.Info("Found %d updated files and %d folders needing thumbnail updates", len(files), len(folders))
	} else {
		logging.Info("Running full thumbnail generation")

		files, err = t.db.GetAllMediaFilesForThumbnails()
		if err != nil {
			logging.Error("Failed to get files for thumbnail generation: %v", err)
			t.finishGeneration(startTime)
			return
		}

		logging.Info("Processing %d files for thumbnail generation", len(files))
	}

	t.generationMu.Lock()
	t.generationStats.TotalFiles = len(files) + len(folders)
	t.generationMu.Unlock()

	// Process updated files
	if len(files) > 0 {
		t.processFilesForGeneration(ctx, files, incremental)
	}

	// Process folders with updated contents (invalidate and regenerate)
	if len(folders) > 0 {
		t.processFoldersForGeneration(ctx, folders)
	}

	// Clean up orphaned thumbnails
	orphansRemoved, legacyRemoved := t.cleanupOrphanedThumbnails(ctx)

	t.generationMu.Lock()
	t.generationStats.OrphansRemoved = orphansRemoved + legacyRemoved
	t.generationMu.Unlock()

	// Update last run time
	if err := t.db.SetLastThumbnailRun(ctx, startTime); err != nil {
		logging.Error("Failed to update last thumbnail run time: %v", err)
	}

	t.finishGeneration(startTime)
}

// processFilesForGeneration processes files for thumbnail generation
func (t *ThumbnailGenerator) processFilesForGeneration(ctx context.Context, files []database.MediaFile, incremental bool) {
	for i := 0; i < len(files); i += generationBatchSize {
		select {
		case <-t.stopChan:
			return
		case <-ctx.Done():
			return
		default:
		}

		end := i + generationBatchSize
		if end > len(files) {
			end = len(files)
		}

		batch := files[i:end]

		// For incremental updates, invalidate existing thumbnails first
		if incremental {
			for _, file := range batch {
				fullPath := filepath.Join(t.mediaDir, file.Path)
				_ = t.InvalidateThumbnail(fullPath)
			}
		}

		t.processBatch(ctx, batch)
		time.Sleep(generationBatchDelay)

		if (i+generationBatchSize)%500 == 0 || end == len(files) {
			t.generationMu.RLock()
			logging.Info("Thumbnail generation progress: %d/%d (generated: %d, skipped: %d, failed: %d)",
				t.generationStats.Processed,
				t.generationStats.TotalFiles,
				t.generationStats.Generated,
				t.generationStats.Skipped,
				t.generationStats.Failed)
			t.generationMu.RUnlock()
		}
	}
}

// processFoldersForGeneration invalidates and regenerates folder thumbnails
func (t *ThumbnailGenerator) processFoldersForGeneration(ctx context.Context, folders []database.MediaFile) {
	logging.Info("Regenerating %d folder thumbnails due to content changes", len(folders))

	for _, folder := range folders {
		select {
		case <-t.stopChan:
			return
		default:
		}

		fullPath := filepath.Join(t.mediaDir, folder.Path)

		// Invalidate existing thumbnail
		_ = t.InvalidateThumbnail(fullPath)

		// Generate new thumbnail
		_, err := t.GetThumbnail(ctx, fullPath, database.FileTypeFolder)

		t.generationMu.Lock()
		t.generationStats.Processed++
		if err != nil {
			t.generationStats.Failed++
			logging.Debug("Failed to regenerate folder thumbnail for %s: %v", folder.Path, err)
		} else {
			t.generationStats.FoldersUpdated++
		}
		t.generationMu.Unlock()
	}
}

// cleanupOrphanedThumbnails removes thumbnails for files no longer in the index
// Returns count of orphaned thumbnails removed and legacy thumbnails removed.
func (t *ThumbnailGenerator) cleanupOrphanedThumbnails(ctx context.Context) (orphansRemoved, legacyRemoved int) {
	logging.Info("Checking for orphaned thumbnails...")

	// Get all indexed paths
	indexedPaths, err := t.db.GetAllIndexedPaths(ctx)
	if err != nil {
		logging.Error("Failed to get indexed paths for orphan cleanup: %v", err)
		return 0, 0
	}

	entries, err := os.ReadDir(t.cacheDir)
	if err != nil {
		logging.Error("Failed to read cache directory: %v", err)
		return 0, 0
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()

		// Skip non-thumbnail files (including .meta files)
		if !strings.HasSuffix(name, ".jpg") && !strings.HasSuffix(name, ".png") {
			continue
		}

		cacheKey := name
		cachePath := filepath.Join(t.cacheDir, cacheKey)

		// Read the metadata file to get the source path
		sourcePath, err := t.readMetaFile(cacheKey)
		if err != nil {
			// No meta file - this is a legacy thumbnail without tracking
			// Remove it; it will be regenerated on demand if source still exists
			if err := os.Remove(cachePath); err != nil {
				logging.Debug("Failed to remove legacy thumbnail %s: %v", cacheKey, err)
			} else {
				legacyRemoved++
				logging.Debug("Removed legacy thumbnail (no meta file): %s", cacheKey)
			}
			continue
		}

		// Check if source path is still in the index
		relativePath := strings.TrimPrefix(sourcePath, t.mediaDir)
		relativePath = strings.TrimPrefix(relativePath, "/")

		if !indexedPaths[relativePath] {
			// Source file no longer exists, remove thumbnail and meta
			if err := os.Remove(cachePath); err != nil {
				logging.Debug("Failed to remove orphaned thumbnail %s: %v", cacheKey, err)
			} else {
				t.deleteMetaFile(cacheKey)
				orphansRemoved++
				logging.Debug("Removed orphaned thumbnail for: %s", relativePath)
			}
		}
	}

	if orphansRemoved > 0 || legacyRemoved > 0 {
		logging.Info("Thumbnail cleanup: removed %d orphaned, %d legacy (no meta file)", orphansRemoved, legacyRemoved)
	}

	return orphansRemoved, legacyRemoved
}

// finishGeneration completes the generation run and updates stats
func (t *ThumbnailGenerator) finishGeneration(startTime time.Time) {
	duration := time.Since(startTime)

	t.generationMu.Lock()
	t.generationStats.InProgress = false
	t.generationStats.LastCompleted = time.Now()
	t.generationStats.CurrentFile = ""
	stats := t.generationStats
	t.generationMu.Unlock()

	logging.Info("Thumbnail generation complete in %v: generated %d, skipped %d, failed %d, folders updated %d, orphans removed %d",
		duration,
		stats.Generated,
		stats.Skipped,
		stats.Failed,
		stats.FoldersUpdated,
		stats.OrphansRemoved)

	// Log average memory usage if we have data
	if stats.MemoryTrackedCount > 0 {
		avgMemoryMB := float64(stats.TotalMemoryUsed) / float64(stats.MemoryTrackedCount) / 1024 / 1024
		logging.Debug("Average memory per image: %.2f MB (tracked %d images, total %.2f MB)",
			avgMemoryMB,
			stats.MemoryTrackedCount,
			float64(stats.TotalMemoryUsed)/1024/1024)
	}

	t.UpdateCacheMetrics()

	metrics.ThumbnailGenerationFilesTotal.WithLabelValues("generated").Set(float64(stats.Generated))
	metrics.ThumbnailGenerationFilesTotal.WithLabelValues("skipped").Set(float64(stats.Skipped))
	metrics.ThumbnailGenerationFilesTotal.WithLabelValues("failed").Set(float64(stats.Failed))

	metrics.ThumbnailGenerationBatchComplete.WithLabelValues("incremental").Inc()
	metrics.ThumbnailGenerationLastDuration.Set(duration.Seconds())
	metrics.ThumbnailGenerationLastTimestamp.Set(float64(time.Now().Unix()))
}

// processBatch processes a batch of files for thumbnail generation using parallel workers
func (t *ThumbnailGenerator) processBatch(ctx context.Context, files []database.MediaFile) {
	if len(files) == 0 {
		return
	}

	numWorkers := workers.ForMixed(maxThumbnailWorkers)

	if t.memoryMonitor != nil && t.memoryMonitor.ShouldThrottle() {
		numWorkers = max(1, numWorkers/2)
		logging.Info("Memory pressure detected, reducing thumbnail workers to %d", numWorkers)
	}

	if numWorkers > len(files) {
		numWorkers = len(files)
	}

	jobs := make(chan database.MediaFile, len(files))
	results := make(chan thumbnailResult, len(files))

	var wg sync.WaitGroup
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go t.thumbnailWorker(ctx, i, jobs, results, &wg)
	}

	go func() {
		defer close(jobs)
		for _, file := range files {
			select {
			case jobs <- file:
			case <-t.stopChan:
				return
			case <-ctx.Done():
				return
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	for result := range results {
		t.generationMu.Lock()
		t.generationStats.Processed++

		switch {
		case result.err != nil && errors.Is(result.err, errSkipped):
			t.generationStats.Skipped++
		case result.err != nil:
			t.generationStats.Failed++
			logging.Debug("Failed to generate thumbnail for %s: %v", result.path, result.err)
		case result.skipped:
			t.generationStats.Skipped++
		default:
			t.generationStats.Generated++
		}

		t.generationMu.Unlock()
	}
}

// thumbnailWorker processes thumbnail generation jobs
func (t *ThumbnailGenerator) thumbnailWorker(ctx context.Context, workerID int, jobs <-chan database.MediaFile, results chan<- thumbnailResult, wg *sync.WaitGroup) {
	defer wg.Done()

	logging.Debug("Thumbnail worker %d started", workerID)
	defer logging.Debug("Thumbnail worker %d stopped", workerID)

	// Create a cancellable context that responds to both parent and stop channel
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	go func() {
		select {
		case <-t.stopChan:
			cancel()
		case <-workerCtx.Done():
		}
	}()

	for file := range jobs {
		select {
		case <-t.stopChan:
			return
		case <-workerCtx.Done():
			return
		default:
		}

		if t.memoryMonitor != nil && !t.memoryMonitor.WaitIfPaused() {
			return
		}

		t.generationMu.Lock()
		t.generationStats.CurrentFile = file.Path
		t.generationMu.Unlock()

		// Check if thumbnail already exists (for non-incremental runs)
		if t.thumbnailExists(file.Path, file.Type) {
			results <- thumbnailResult{path: file.Path, skipped: true, err: errSkipped}
			continue
		}

		fullPath := filepath.Join(t.mediaDir, file.Path)
		_, err := t.GetThumbnail(workerCtx, fullPath, file.Type)

		results <- thumbnailResult{
			path:    file.Path,
			skipped: false,
			err:     err,
		}

		if t.memoryMonitor != nil && t.memoryMonitor.ShouldThrottle() {
			runtime.GC()
		}
	}
}

// thumbnailExists checks if a thumbnail already exists in the cache
func (t *ThumbnailGenerator) thumbnailExists(filePath string, fileType database.FileType) bool {
	fullPath := filepath.Join(t.mediaDir, filePath)
	cacheKey := t.getCacheKey(fullPath, fileType)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	_, err := os.Stat(cachePath)
	return err == nil
}

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================

// InvalidateThumbnail removes the cached thumbnail for a specific path
func (t *ThumbnailGenerator) InvalidateThumbnail(filePath string) error {
	if !t.enabled {
		return nil
	}

	// Try both extensions
	for _, fileType := range []database.FileType{database.FileTypeImage, database.FileTypeFolder} {
		cacheKey := t.getCacheKey(filePath, fileType)
		cachePath := filepath.Join(t.cacheDir, cacheKey)

		if err := os.Remove(cachePath); err == nil {
			t.deleteMetaFile(cacheKey)
			logging.Debug("Invalidated thumbnail: %s", cachePath)
		}
	}

	return nil
}

// InvalidateAll removes all cached thumbnails
func (t *ThumbnailGenerator) InvalidateAll() (int, error) {
	if !t.enabled {
		return 0, nil
	}

	entries, err := os.ReadDir(t.cacheDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("failed to read cache directory: %w", err)
	}

	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		cachePath := filepath.Join(t.cacheDir, name)

		if err := os.Remove(cachePath); err != nil && !os.IsNotExist(err) {
			logging.Warn("Failed to delete cached thumbnail %s: %v", name, err)
			continue
		}

		// Count thumbnails, not meta files
		if strings.HasSuffix(name, ".jpg") || strings.HasSuffix(name, ".png") {
			count++
		}
	}

	logging.Info("Invalidated %d cached thumbnails", count)
	t.UpdateCacheMetrics()

	return count, nil
}

// UpdateCacheMetrics scans the cache directory and updates Prometheus metrics
func (t *ThumbnailGenerator) UpdateCacheMetrics() {
	if !t.enabled {
		metrics.ThumbnailCacheSize.Set(0)
		metrics.ThumbnailCacheCount.Set(0)
		return
	}

	var cacheSize int64
	var cacheCount int

	entries, err := os.ReadDir(t.cacheDir)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.Debug("Failed to read cache directory for metrics: %v", err)
		}
		metrics.ThumbnailCacheSize.Set(0)
		metrics.ThumbnailCacheCount.Set(0)
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		// Only count actual thumbnails, not meta files
		if !strings.HasSuffix(name, ".jpg") && !strings.HasSuffix(name, ".png") {
			continue
		}

		cacheCount++
		if info, err := entry.Info(); err == nil {
			cacheSize += info.Size()
		}
	}

	t.cacheMetricsMu.Lock()
	t.lastCacheSize = cacheSize
	t.lastCacheCount = cacheCount
	t.cacheMetricsMu.Unlock()

	metrics.ThumbnailCacheSize.Set(float64(cacheSize))
	metrics.ThumbnailCacheCount.Set(float64(cacheCount))

	logging.Debug("Updated cache metrics: count=%d, size=%s", cacheCount, formatBytes(cacheSize))
}

// GetCachedMetrics returns the last known cache metrics without scanning
func (t *ThumbnailGenerator) GetCachedMetrics() (count int, size int64) {
	t.cacheMetricsMu.RLock()
	defer t.cacheMetricsMu.RUnlock()
	return t.lastCacheCount, t.lastCacheSize
}

// IsGenerating returns whether background generation is in progress
func (t *ThumbnailGenerator) IsGenerating() bool {
	return t.isGenerating.Load()
}

// GetStatus returns the current status of the thumbnail generator
func (t *ThumbnailGenerator) GetStatus() ThumbnailStatus {
	status := ThumbnailStatus{
		Enabled:  t.enabled,
		CacheDir: t.cacheDir,
	}

	if !t.enabled {
		return status
	}

	t.cacheMetricsMu.RLock()
	status.CacheCount = t.lastCacheCount
	status.CacheSize = t.lastCacheSize
	t.cacheMetricsMu.RUnlock()

	status.CacheSizeHuman = formatBytes(status.CacheSize)

	t.generationMu.RLock()
	stats := t.generationStats
	t.generationMu.RUnlock()
	status.Generation = &stats

	return status
}

// TriggerGeneration manually triggers a thumbnail generation run
func (t *ThumbnailGenerator) TriggerGeneration() {
	go t.runGeneration(true)
}

// RebuildAll clears the cache and triggers a full regeneration
func (t *ThumbnailGenerator) RebuildAll() {
	if !t.enabled {
		return
	}

	count, err := t.InvalidateAll()
	if err != nil {
		logging.Error("Failed to clear cache before rebuild: %v", err)
	} else {
		logging.Info("Cleared %d thumbnails, starting rebuild", count)
	}

	// Clear last run time to force full generation
	ctx := context.Background()
	if err := t.db.SetLastThumbnailRun(ctx, time.Time{}); err != nil {
		logging.Error("Failed to clear last thumbnail run time: %v", err)
	}

	go t.runGeneration(false)
}

// GetCacheSize returns the total size of the thumbnail cache in bytes and the number of files (excluding .meta files).
func (t *ThumbnailGenerator) GetCacheSize() (size int64, count int, err error) {
	if t.cacheDir == "" || !t.enabled {
		return 0, 0, nil
	}

	// Check if cached value is fresh (within 2 minutes)
	lastUpdate := t.lastCacheUpdate.Load()
	now := time.Now().Unix()
	if lastUpdate > 0 && (now-lastUpdate) < 120 {
		// Return cached values
		return t.cachedSize.Load(), int(t.cachedCount.Load()), nil
	}

	// Calculate cache size synchronously only if cache is stale
	// Use a mutex to prevent multiple simultaneous walks
	t.cacheMetricsMu.Lock()
	defer t.cacheMetricsMu.Unlock()

	// Double-check after acquiring lock
	lastUpdate = t.lastCacheUpdate.Load()
	if lastUpdate > 0 && (now-lastUpdate) < 120 {
		return t.cachedSize.Load(), int(t.cachedCount.Load()), nil
	}

	// Walk directory to calculate fresh values
	var newSize int64
	var newCount int
	err = filepath.Walk(t.cacheDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !info.IsDir() {
			newSize += info.Size()
			// Exclude .meta files from count
			if !strings.HasSuffix(path, ".meta") {
				newCount++
			}
		}
		return nil
	})

	if err == nil {
		// Update cached values atomically
		t.cachedSize.Store(newSize)
		t.cachedCount.Store(int64(newCount))
		t.lastCacheUpdate.Store(now)
		return newSize, newCount, nil
	}

	// On error, return cached values if available
	if lastUpdate > 0 {
		return t.cachedSize.Load(), int(t.cachedCount.Load()), nil
	}

	return 0, 0, err
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

// formatBytes formats bytes into human-readable string
func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
