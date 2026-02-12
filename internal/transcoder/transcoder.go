package transcoder

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"media-viewer/internal/logging"
	"media-viewer/internal/streaming"
)

// GPUAccel represents the GPU acceleration method
type GPUAccel string

// GPU acceleration mode constants
const (
	GPUAccelNone         GPUAccel = "none"         // Disable GPU acceleration
	GPUAccelAuto         GPUAccel = "auto"         // Auto-detect available GPU
	GPUAccelNVIDIA       GPUAccel = "nvidia"       // NVENC (NVIDIA)
	GPUAccelVAAPI        GPUAccel = "vaapi"        // VA-API (Intel/AMD)
	GPUAccelVideoToolbox GPUAccel = "videotoolbox" // VideoToolbox (macOS)
)

// Transcoder manages video transcoding operations for compatible playback.
type Transcoder struct {
	cacheDir  string
	logDir    string
	enabled   bool
	processes map[string]*exec.Cmd
	processMu sync.Mutex

	// Cache locks for preventing concurrent transcode of same file
	cacheLocks map[string]*sync.Mutex
	locksMu    sync.Mutex

	// Streaming configuration
	streamConfig streaming.TimeoutWriterConfig

	// GPU acceleration
	gpuAccel         GPUAccel
	gpuEncoder       string // Actual encoder to use (e.g., "h264_nvenc", "h264_vaapi")
	gpuInitFilter    string // Hardware initialization filter if needed
	gpuAvailable     bool
	gpuDetectionDone bool
	gpuMu            sync.Mutex

	// Shutdown flag to prevent retries during cleanup
	shuttingDown atomic.Bool
}

// VideoInfo contains information about a video file.
type VideoInfo struct {
	Duration       float64 `json:"duration"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	Codec          string  `json:"codec"`
	NeedsTranscode bool    `json:"needsTranscode"`
}

var compatibleCodecs = map[string]bool{
	"h264": true,
	"vp8":  true,
	"vp9":  true,
	"av1":  true,
}

var compatibleContainers = map[string]bool{
	"mp4":  true,
	"webm": true,
	"ogg":  true,
}

// New creates a new Transcoder instance with the specified GPU acceleration mode.
func New(cacheDir, logDir string, enabled bool, gpuAccel string) *Transcoder {
	config := streaming.DefaultTimeoutWriterConfig()
	config.WriteTimeout = 30 * time.Second
	config.IdleTimeout = 60 * time.Second
	config.ChunkSize = 256 * 1024 // 256KB chunks for video

	logging.Info("Transcoder initialized: cacheDir=%q, logDir=%q, enabled=%v, gpuAccel=%q", cacheDir, logDir, enabled, gpuAccel)

	// Create log directory if specified
	if logDir != "" {
		if err := os.MkdirAll(logDir, 0o750); err != nil {
			logging.Warn("Failed to create transcoder log directory %s: %v", logDir, err)
		}
	}

	t := &Transcoder{
		cacheDir:     cacheDir,
		logDir:       logDir,
		enabled:      enabled,
		processes:    make(map[string]*exec.Cmd),
		cacheLocks:   make(map[string]*sync.Mutex),
		streamConfig: config,
		gpuAccel:     GPUAccel(gpuAccel),
	}

	// Detect GPU capabilities if auto or specific GPU requested
	if t.gpuAccel != GPUAccelNone {
		logging.Info("------------------------------------------------------------")
		t.detectGPU()
		logging.Info("------------------------------------------------------------")
	}

	return t
}

// IsEnabled returns whether transcoding is enabled.
func (t *Transcoder) IsEnabled() bool {
	return t.enabled
}

// GetCacheDir returns the cache directory path.
func (t *Transcoder) GetCacheDir() string {
	return t.cacheDir
}

// GetVideoInfo retrieves codec and dimension information about a video file.
func (t *Transcoder) GetVideoInfo(ctx context.Context, filePath string) (*VideoInfo, error) {
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		filePath,
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffprobe error: %w - %s", err, stderr.String())
	}

	output := stdout.String()
	info := &VideoInfo{}

	// Extract duration
	if idx := strings.Index(output, `"duration"`); idx != -1 {
		start := strings.Index(output[idx:], ":") + idx + 1
		end := strings.Index(output[start:], ",")
		if end == -1 {
			end = strings.Index(output[start:], "}")
		}
		durStr := strings.Trim(output[start:start+end], ` "`)
		info.Duration, _ = strconv.ParseFloat(durStr, 64)
	}

	// Extract codec
	if idx := strings.Index(output, `"codec_name"`); idx != -1 {
		start := strings.Index(output[idx:], ":") + idx + 1
		end := strings.Index(output[start:], ",")
		info.Codec = strings.Trim(output[start:start+end], ` "`)
	}

	// Extract dimensions
	if idx := strings.Index(output, `"width"`); idx != -1 {
		start := strings.Index(output[idx:], ":") + idx + 1
		endComma := strings.Index(output[start:], ",")
		endBrace := strings.Index(output[start:], "}")
		end := endComma
		if end == -1 || (endBrace != -1 && endBrace < end) {
			end = endBrace
		}
		widthStr := strings.TrimSpace(output[start : start+end])
		info.Width, _ = strconv.Atoi(widthStr)
	}
	if idx := strings.Index(output, `"height"`); idx != -1 {
		start := strings.Index(output[idx:], ":") + idx + 1
		endComma := strings.Index(output[start:], ",")
		endBrace := strings.Index(output[start:], "}")
		end := endComma
		if end == -1 || (endBrace != -1 && endBrace < end) {
			end = endBrace
		}
		heightStr := strings.TrimSpace(output[start : start+end])
		info.Height, _ = strconv.Atoi(heightStr)
	}

	// Tier 1: Ensure dimensions are even (required by H.264 encoder)
	// Adjust odd dimensions to prevent encoding failures
	if info.Width%2 != 0 {
		logging.Debug("Adjusting odd width %d to %d for H.264 compatibility", info.Width, info.Width+1)
		info.Width++
	}
	if info.Height%2 != 0 {
		logging.Debug("Adjusting odd height %d to %d for H.264 compatibility", info.Height, info.Height+1)
		info.Height++
	}

	// Check if transcoding is needed
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	info.NeedsTranscode = !compatibleCodecs[info.Codec] || !compatibleContainers[ext]

	return info, nil
}

// GetOrStartTranscode checks if video is cached, or starts transcoding in background
// Returns: cachePath, isCached, error
func (t *Transcoder) GetOrStartTranscode(_ context.Context, filePath string, targetWidth int, info *VideoInfo) (cachePath string, isCached bool, err error) {
	if !t.enabled {
		return "", false, fmt.Errorf("transcoding required but disabled (cache directory not writable)")
	}

	// Generate cache key and path
	cacheKey := fmt.Sprintf("%s_w%d.mp4", filepath.Base(filePath), targetWidth)
	cachePath = filepath.Join(t.cacheDir, cacheKey)

	// Check if already fully cached and valid
	if cachedFile, err := t.getCachedFile(filePath, cachePath); err == nil {
		_ = cachedFile.Close()
		logging.Info("Video already cached: %s", cachePath)
		return cachePath, true, nil
	}

	// Not cached - start transcoding in background if not already running
	cacheLock := t.getCacheLock(cacheKey)
	if !cacheLock.TryLock() {
		// Another goroutine is already transcoding this file
		logging.Info("Transcode already in progress, will serve partial cache: %s", cachePath)
		return cachePath, false, nil
	}

	// We got the lock - check once more if cache was created while we waited
	if cachedFile, err := t.getCachedFile(filePath, cachePath); err == nil {
		_ = cachedFile.Close()
		cacheLock.Unlock()
		logging.Info("Cache completed while waiting: %s", cachePath)
		return cachePath, true, nil
	}

	// Clean up any stale error file from previous failed attempts
	errorPath := cachePath + ".err"
	_ = os.Remove(errorPath)

	// Start background transcoding
	logging.Info("Starting background transcode: %s -> %s", filePath, cachePath)

	needsScaling := targetWidth > 0 && targetWidth < info.Width
	needsReencode := !compatibleCodecs[info.Codec] || needsScaling

	//nolint:contextcheck // Intentionally using background context so transcoding continues if request is canceled
	go func() {
		defer cacheLock.Unlock()

		// Use a background context so transcoding continues even if request is canceled
		bgCtx := context.Background()

		if err := t.transcodeDirectToCache(bgCtx, filePath, cachePath, targetWidth, info, needsReencode); err != nil {
			logging.Error("Background transcode failed for %s: %v", filePath, err)
			// Write error to .err file so other code can detect it
			errorPath := cachePath + ".err"
			if writeErr := os.WriteFile(errorPath, []byte(err.Error()), 0o600); writeErr != nil {
				logging.Warn("Failed to write error file: %v", writeErr)
			}
			// Clean up partial cache on error
			_ = os.Remove(cachePath)
			_ = os.Remove(cachePath + ".tmp")
		} else {
			logging.Info("Background transcode completed: %s", cachePath)
			// Remove any error file from previous failed attempts
			_ = os.Remove(cachePath + ".err")
		}
	}()

	return cachePath, false, nil
}

// GetOrStartTranscodeAndWait waits for initial transcode data to be available before returning
// This ensures the browser can start playback immediately
//
//nolint:gocognit // Complexity from state management and polling logic is necessary
func (t *Transcoder) GetOrStartTranscodeAndWait(ctx context.Context, filePath string, targetWidth int, info *VideoInfo) (string, error) {
	if !t.enabled {
		return "", fmt.Errorf("transcoding required but disabled (cache directory not writable)")
	}

	// Generate cache key and path
	cacheKey := fmt.Sprintf("%s_w%d.mp4", filepath.Base(filePath), targetWidth)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	// Check if already fully cached and valid
	if cachedFile, err := t.getCachedFile(filePath, cachePath); err == nil {
		_ = cachedFile.Close()
		logging.Info("Video already cached: %s", cachePath)
		return cachePath, nil
	}

	// Not cached - start transcoding in background if not already running
	cacheLock := t.getCacheLock(cacheKey)
	alreadyTranscoding := !cacheLock.TryLock()

	if !alreadyTranscoding {
		// We got the lock - check once more if cache was created while we waited
		if cachedFile, err := t.getCachedFile(filePath, cachePath); err == nil {
			_ = cachedFile.Close()
			cacheLock.Unlock()
			logging.Info("Cache completed while waiting: %s", cachePath)
			return cachePath, nil
		}

		// Clean up any stale error file from previous failed attempts
		errorPath := cachePath + ".err"
		_ = os.Remove(errorPath)

		// Start background transcoding
		logging.Info("Starting background transcode: %s -> %s", filePath, cachePath)

		needsScaling := targetWidth > 0 && targetWidth < info.Width
		needsReencode := !compatibleCodecs[info.Codec] || needsScaling

		//nolint:contextcheck // Intentionally using background context so transcoding continues if request is canceled
		go func() {
			defer cacheLock.Unlock()

			// Use a background context so transcoding continues even if request is canceled
			bgCtx := context.Background()

			if err := t.transcodeDirectToCache(bgCtx, filePath, cachePath, targetWidth, info, needsReencode); err != nil {
				logging.Error("Background transcode failed for %s: %v", filePath, err)
				// Write error to .err file so waiting code can detect it
				errorPath := cachePath + ".err"
				if writeErr := os.WriteFile(errorPath, []byte(err.Error()), 0o600); writeErr != nil {
					logging.Warn("Failed to write error file: %v", writeErr)
				}
				// Clean up partial cache on error
				_ = os.Remove(cachePath)
				_ = os.Remove(cachePath + ".tmp")
			} else {
				logging.Info("Background transcode completed: %s", cachePath)
				// Remove any error file from previous failed attempts
				_ = os.Remove(cachePath + ".err")
			}
		}()
	} else {
		logging.Info("Transcode already in progress: %s", cachePath)
	}

	// Wait for transcode to complete
	// We need the complete file for proper HTTP Range support
	maxWaitTime := 5 * time.Minute // Reasonable timeout for most videos
	startWait := time.Now()
	lastLogTime := time.Now()
	lastSize := int64(0)

	logging.Info("Waiting for transcode to complete: %s", filePath)

	for {
		tmpPath := cachePath + ".tmp"
		errorPath := cachePath + ".err"

		// Check if transcoding failed (error file exists)
		if errorData, err := os.ReadFile(errorPath); err == nil {
			// Clean up error file
			_ = os.Remove(errorPath)
			return "", fmt.Errorf("transcode failed: %s", string(errorData))
		}

		// Check if transcode is complete (.tmp file gone)
		if _, err := os.Stat(tmpPath); os.IsNotExist(err) {
			// Check final cache file exists
			if stat, err := os.Stat(cachePath); err == nil {
				logging.Info("Transcode complete: %.2f MB for %s (took %.1fs)",
					float64(stat.Size())/(1024*1024), filePath, time.Since(startWait).Seconds())
				// Clean up any stale error files
				_ = os.Remove(errorPath)
				return cachePath, nil
			}
		} else {
			// .tmp still exists, transcode in progress
			// Log progress every 2 seconds
			if time.Since(lastLogTime) > 2*time.Second {
				if stat, err := os.Stat(tmpPath); err == nil {
					currentSize := stat.Size()
					rate := float64(currentSize-lastSize) / time.Since(lastLogTime).Seconds() / (1024 * 1024)
					logging.Info("Transcode progress: %.2f MB (%.2f MB/s)",
						float64(currentSize)/(1024*1024), rate)
					lastSize = currentSize
					lastLogTime = time.Now()
				}
			}
		}

		// Check timeout
		if time.Since(startWait) > maxWaitTime {
			// Check if we have a complete file anyway
			if stat, err := os.Stat(cachePath); err == nil {
				logging.Warn("Transcode took longer than timeout but completed: %.2f MB",
					float64(stat.Size())/(1024*1024))
				return cachePath, nil
			}
			return "", fmt.Errorf("transcode timeout after %v: %s", maxWaitTime, filePath)
		}

		// Check context
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(200 * time.Millisecond):
			// Continue waiting
		}
	}
}

// TranscodeToCache transcodes a video to the cache and returns the cache file path
// This method ensures the video is fully transcoded and cached before returning
func (t *Transcoder) TranscodeToCache(ctx context.Context, filePath string, targetWidth int) (string, error) {
	info, err := t.GetVideoInfo(ctx, filePath)
	if err != nil {
		return "", fmt.Errorf("failed to get video info: %w", err)
	}

	// Check if transcoding is enabled
	if !t.enabled {
		return "", fmt.Errorf("transcoding required but disabled (cache directory not writable)")
	}

	// Generate cache key and path
	cacheKey := fmt.Sprintf("%s_w%d.mp4", filepath.Base(filePath), targetWidth)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	// Determine if we need to re-encode or just remux
	needsScaling := targetWidth > 0 && targetWidth < info.Width
	needsReencode := !compatibleCodecs[info.Codec] || needsScaling

	t.logTranscodeDecision(info, needsScaling, cachePath)

	// Check if already cached and valid
	if _, err := t.getCachedFile(filePath, cachePath); err == nil {
		logging.Info("Using existing cached file: %s", cachePath)
		return cachePath, nil
	}

	// Acquire lock for this cache key
	cacheLock := t.getCacheLock(cacheKey)
	cacheLock.Lock()
	defer cacheLock.Unlock()

	// Check again after acquiring lock
	if _, err := t.getCachedFile(filePath, cachePath); err == nil {
		logging.Info("Using cached file (created while waiting): %s", cachePath)
		return cachePath, nil
	}

	// Transcode directly to cache file (no streaming to client)
	logging.Info("Transcoding to cache: %s", cachePath)
	if err := t.transcodeDirectToCache(ctx, filePath, cachePath, targetWidth, info, needsReencode); err != nil {
		return "", err
	}

	return cachePath, nil
}

// transcodeDirectToCache transcodes a video directly to a cache file without streaming
func (t *Transcoder) transcodeDirectToCache(ctx context.Context, filePath, cachePath string, targetWidth int, info *VideoInfo, needsReencode bool) error {
	// Try with GPU first, then retry with CPU if GPU fails
	err := t.transcodeDirectToCacheWithOptions(ctx, filePath, cachePath, targetWidth, info, needsReencode, false)
	if err != nil && t.gpuAvailable && t.isGPUError(err.Error()) {
		// Don't retry if shutting down or context canceled
		if t.shuttingDown.Load() {
			logging.Info("Shutdown in progress, skipping CPU retry for: %s", filePath)
			return err
		}
		if ctx.Err() != nil {
			logging.Info("Context canceled during GPU transcode, skipping CPU retry: %s", filePath)
			return ctx.Err()
		}

		logging.Warn("GPU encoding failed for background transcode of %s, retrying with CPU...", filePath)

		// Disable GPU
		t.gpuMu.Lock()
		t.gpuAvailable = false
		t.gpuMu.Unlock()

		// Clean up failed attempt
		_ = os.Remove(cachePath + ".tmp")

		// Retry with CPU
		return t.transcodeDirectToCacheWithOptions(ctx, filePath, cachePath, targetWidth, info, needsReencode, true)
	}
	return err
}

// transcodeDirectToCacheWithOptions performs the actual transcoding to cache with optional CPU-only mode
func (t *Transcoder) transcodeDirectToCacheWithOptions(ctx context.Context, filePath, cachePath string, targetWidth int, info *VideoInfo, needsReencode, forceCPU bool) error {
	// Create temporary file path for atomic write
	tmpPath := cachePath + ".tmp"

	// Ensure temp file is cleaned up on error
	success := false
	defer func() {
		if !success {
			_ = os.Remove(tmpPath)
		}
	}()

	// Run FFmpeg to transcode directly to file (not stdout)
	// This allows +faststart to work since it needs a seekable output
	args := t.buildFFmpegArgsWithOptions(filePath, tmpPath, targetWidth, info, needsReencode, forceCPU)
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	// Setup stderr capture and optional logging
	var stderr bytes.Buffer
	logFile := t.createTranscoderLog(filePath, targetWidth)
	if logFile != nil {
		defer func() {
			if err := logFile.Close(); err != nil {
				logging.Warn("Failed to close transcode log file: %v", err)
			}
		}()
		cmd.Stderr = io.MultiWriter(&stderr, logFile)
	} else {
		cmd.Stderr = &stderr
	}

	// Start FFmpeg (it will write directly to tmpPath)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	// Track the process AFTER Start() succeeds to avoid race with Cleanup()
	t.processMu.Lock()
	t.processes[filePath] = cmd
	t.processMu.Unlock()

	defer func() {
		t.processMu.Lock()
		delete(t.processes, filePath)
		t.processMu.Unlock()
	}()

	// Wait for FFmpeg to complete
	cmdErr := cmd.Wait()

	// Check for errors
	if cmdErr != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("ffmpeg error: %w - %s", cmdErr, stderr.String())
	}

	logging.Info("FFmpeg completed, renaming %s to %s", tmpPath, cachePath)

	// Rename temp file to final cache file (atomic)
	if err := os.Rename(tmpPath, cachePath); err != nil {
		return fmt.Errorf("failed to rename cache file: %w", err)
	}

	// Verify the file is readable and has the expected size
	stat, err := os.Stat(cachePath)
	if err != nil {
		return fmt.Errorf("failed to verify cache file after rename: %w", err)
	}
	if stat.Size() == 0 {
		return fmt.Errorf("cache file is empty after transcode: %s", cachePath)
	}

	success = true
	logging.Info("Successfully cached transcoded video: %s (%.2f MB)", cachePath, float64(stat.Size())/(1024*1024))
	return nil
}

// StreamVideo streams a video file, transcoding if necessary for browser compatibility.
// Now uses timeout-protected chunked streaming.
func (t *Transcoder) StreamVideo(ctx context.Context, filePath string, w io.Writer, targetWidth int) error {
	info, err := t.GetVideoInfo(ctx, filePath)
	if err != nil {
		logging.Error("Failed to get video info for %s: %v", filePath, err)
		return err
	}

	logging.Debug("StreamVideo: file=%s, codec=%s, needsTranscode=%v, width=%d->%d",
		filePath, info.Codec, info.NeedsTranscode, info.Width, targetWidth)

	// If no transcoding needed and no resize, just stream the file
	if !info.NeedsTranscode && (targetWidth == 0 || targetWidth >= info.Width) {
		logging.Debug("StreamVideo: Direct streaming (no transcode needed) for %s", filePath)
		return t.streamFile(ctx, filePath, w)
	}

	// Check if transcoding is enabled
	if !t.enabled {
		logging.Warn("Transcoding required but disabled for %s (cache directory not writable)", filePath)
		return fmt.Errorf("transcoding required but disabled (cache directory not writable)")
	}

	logging.Info("StreamVideo: Transcoding required for %s (codec=%s, targetWidth=%d)", filePath, info.Codec, targetWidth)
	return t.transcodeAndStream(ctx, filePath, w, targetWidth, info)
}

// streamFile streams a file directly with timeout protection
func (t *Transcoder) streamFile(ctx context.Context, filePath string, w io.Writer) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer func() {
		if err := file.Close(); err != nil {
			log.Printf("failed to close video file %s: %v", filePath, err)
		}
	}()

	// If w is an http.ResponseWriter, use timeout-protected streaming
	if hw, ok := w.(http.ResponseWriter); ok {
		return streaming.StreamWithTimeout(ctx, hw, file, t.streamConfig)
	}

	// Fallback for non-HTTP writers (e.g., tests)
	_, err = io.Copy(w, file)
	return err
}

// transcodeAndStream transcodes video to cache first, then serves from cache
// This enables proper HTTP Range support and Content-Length headers for seeking
func (t *Transcoder) transcodeAndStream(ctx context.Context, filePath string, w io.Writer, targetWidth int, info *VideoInfo) error {
	// Generate cache key
	cacheKey := fmt.Sprintf("%s_w%d.mp4", filepath.Base(filePath), targetWidth)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	// Determine if we can just copy streams (remux) or need to re-encode
	needsScaling := targetWidth > 0 && targetWidth < info.Width
	needsReencode := !compatibleCodecs[info.Codec] || needsScaling

	t.logTranscodeDecision(info, needsScaling, cachePath)

	// Check if cached version exists and is valid
	if err := t.serveCachedFile(filePath, cachePath, w); err == nil {
		return nil
	}

	// Not in cache or invalid - transcode and cache with locking
	cacheLock := t.getCacheLock(cacheKey)
	cacheLock.Lock()
	defer cacheLock.Unlock()

	// Check again after acquiring lock (might have been created by another request)
	if err := t.serveCachedFile(filePath, cachePath, w); err == nil {
		logging.Info("Serving from cache (created while waiting): %s", cachePath)
		return nil
	}

	logging.Info("Transcoding to cache, then serving: %s -> %s", filePath, cachePath)
	return t.transcodeAndCache(ctx, filePath, w, cachePath, targetWidth, info, needsReencode)
}

// logTranscodeDecision logs the transcoding decision based on codec and scaling requirements
func (t *Transcoder) logTranscodeDecision(info *VideoInfo, needsScaling bool, cachePath string) {
	switch {
	case !compatibleCodecs[info.Codec]:
		logging.Info("Re-encoding video: incompatible codec %s (caching to %s)", info.Codec, cachePath)
	case needsScaling:
		logging.Info("Re-encoding video: scaling required %dx%d (caching to %s)",
			info.Width, info.Height, cachePath)
	default:
		logging.Info("Remuxing: codec %s compatible, changing container (caching to %s)", info.Codec, cachePath)
	}
}

// serveCachedFile attempts to serve a cached file if it exists and is valid
func (t *Transcoder) serveCachedFile(sourcePath, cachePath string, w io.Writer) error {
	cachedFile, err := t.getCachedFile(sourcePath, cachePath)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := cachedFile.Close(); closeErr != nil {
			logging.Warn("Failed to close cached file: %v", closeErr)
		}
	}()

	logging.Info("Serving from cache: %s", cachePath)

	// Set Content-Length header for HTTP responses
	if hw, ok := w.(http.ResponseWriter); ok {
		if fileInfo, err := cachedFile.Stat(); err == nil {
			hw.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))
			hw.Header().Del("Transfer-Encoding") // Remove chunked encoding
			logging.Debug("Serving cached file: size=%d bytes", fileInfo.Size())
		}
	}

	_, err = io.Copy(w, cachedFile)
	return err
}

// getCachedFile checks if a cached file exists and is valid (newer than source)
func (t *Transcoder) getCachedFile(sourcePath, cachePath string) (*os.File, error) {
	cacheInfo, err := os.Stat(cachePath)
	if err != nil {
		return nil, err
	}

	sourceInfo, err := os.Stat(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("source file stat: %w", err)
	}

	// Cache is invalid if source is newer
	if sourceInfo.ModTime().After(cacheInfo.ModTime()) {
		logging.Debug("Cache invalid: source modified after cache (source=%v, cache=%v)",
			sourceInfo.ModTime(), cacheInfo.ModTime())
		// Delete stale cache
		_ = os.Remove(cachePath)
		return nil, errors.New("cache is stale")
	}

	return os.Open(cachePath)
}

// getCacheLock gets or creates a lock for a cache key
func (t *Transcoder) getCacheLock(cacheKey string) *sync.Mutex {
	t.locksMu.Lock()
	defer t.locksMu.Unlock()

	if lock, exists := t.cacheLocks[cacheKey]; exists {
		return lock
	}

	lock := &sync.Mutex{}
	t.cacheLocks[cacheKey] = lock
	return lock
}

// transcodeAndCache transcodes and simultaneously streams to response and saves to cache
func (t *Transcoder) transcodeAndCache(ctx context.Context, filePath string, w io.Writer, cachePath string, targetWidth int, info *VideoInfo, needsReencode bool) error {
	// Create cache directory if needed
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o750); err != nil {
		logging.Warn("Failed to create cache directory: %v (continuing without cache)", err)
		return t.transcodeStream(ctx, filePath, w, targetWidth, info, needsReencode)
	}

	// Create temporary file for atomic write
	tempPath := cachePath + ".tmp"
	cacheFile, err := os.Create(tempPath)
	if err != nil {
		logging.Warn("Failed to create cache file: %v (continuing without cache)", err)
		return t.transcodeStream(ctx, filePath, w, targetWidth, info, needsReencode)
	}
	defer func() {
		if closeErr := cacheFile.Close(); closeErr != nil {
			logging.Warn("Failed to close cache file: %v", closeErr)
		}
		// Clean up temp file if we didn't rename it
		_ = os.Remove(tempPath)
	}()

	// Build ffmpeg command - output to stdout for streaming
	args := t.buildFFmpegArgs(filePath, "-", targetWidth, info, needsReencode)
	logging.Debug("FFmpeg command: ffmpeg %v", args)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	// Create a pipe for ffmpeg output
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	// Set up ffmpeg stderr capture
	var stderr bytes.Buffer
	logFile := t.createTranscoderLog(filePath, targetWidth)
	if logFile != nil {
		defer func() {
			if err := logFile.Close(); err != nil {
				logging.Warn("Failed to close transcoder log file: %v", err)
			}
		}()
		// Write to both buffer and log file
		cmd.Stderr = io.MultiWriter(&stderr, logFile)
	} else {
		cmd.Stderr = &stderr
	}

	// Start ffmpeg
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	// Track the process AFTER Start() succeeds to avoid race with Cleanup()
	t.processMu.Lock()
	t.processes[filePath] = cmd
	t.processMu.Unlock()

	defer func() {
		t.processMu.Lock()
		delete(t.processes, filePath)
		t.processMu.Unlock()
	}()

	// Log transcoding start with encoder info
	encoderInfo := t.getEncoderInfo(targetWidth, info, needsReencode)
	logging.Info("FFmpeg started%s, streaming to client...", encoderInfo)

	// Stream and cache the output
	streamErr := t.streamToCacheAndWriter(ctx, stdout, cacheFile, w, filePath)

	// Wait for ffmpeg to complete
	cmdErr := cmd.Wait()

	// Handle transcode result
	if streamErr != nil || cmdErr != nil {
		return t.handleTranscodeFailure(ctx, filePath, w, cachePath, targetWidth, info, needsReencode,
			streamErr, cmdErr, &stderr, cacheFile, tempPath)
	}

	// Close cache file before renaming
	if err := cacheFile.Close(); err != nil {
		logging.Warn("Failed to close cache file: %v", err)
		return nil // Transcode succeeded, cache is bonus
	}

	// Finalize cache file
	t.finalizeCache(tempPath, cachePath)
	return nil
}

// getEncoderInfo returns a string describing the encoder being used
func (t *Transcoder) getEncoderInfo(targetWidth int, info *VideoInfo, needsReencode bool) string {
	needsScaling := targetWidth > 0 && targetWidth < info.Width

	type encoderMode int
	const (
		modeStreamCopy encoderMode = iota
		modeGPU
		modeCPU
	)

	var mode encoderMode
	switch {
	case !needsReencode && !needsScaling:
		mode = modeStreamCopy
	case t.gpuAvailable && t.gpuEncoder != "":
		mode = modeGPU
	default:
		mode = modeCPU
	}

	switch mode {
	case modeStreamCopy:
		return " [stream copy]"
	case modeGPU:
		return fmt.Sprintf(" [GPU: %s/%s]", t.gpuAccel, t.gpuEncoder)
	case modeCPU:
		return " [CPU: libx264]"
	default:
		return ""
	}
}

// streamToCacheAndWriter streams ffmpeg output to both cache file and writer
func (t *Transcoder) streamToCacheAndWriter(ctx context.Context, stdout io.ReadCloser, cacheFile *os.File, w io.Writer, filePath string) error {
	// Create TeeReader to write to cache as we read
	teeReader := io.TeeReader(stdout, cacheFile)

	// Wrap reader with progress tracking
	startTime := time.Now()
	progressReader := &progressTrackingReader{
		reader:   teeReader,
		filePath: filePath,
		lastLog:  startTime,
	}

	// Stream output with timeout protection
	var streamErr error
	if hw, ok := w.(http.ResponseWriter); ok {
		streamErr = streaming.StreamWithTimeout(ctx, hw, progressReader, t.streamConfig)
	} else {
		_, streamErr = io.Copy(w, progressReader)
	}

	elapsed := time.Since(startTime)
	logging.Info("Streaming completed: %d bytes in %.2fs (%.2f KB/s) - waiting for ffmpeg to finish...",
		progressReader.totalBytes, elapsed.Seconds(), float64(progressReader.totalBytes)/1024/elapsed.Seconds())

	return streamErr
}

// handleTranscodeFailure handles errors during transcoding
func (t *Transcoder) handleTranscodeFailure(ctx context.Context, filePath string, w io.Writer, cachePath string,
	targetWidth int, info *VideoInfo, needsReencode bool, streamErr, cmdErr error,
	stderr *bytes.Buffer, cacheFile *os.File, tempPath string) error {
	stderrStr := stderr.String()

	// Check if this is a GPU-related error and retry with CPU if we haven't already
	if t.gpuAvailable && t.isGPUError(stderrStr) {
		// Don't retry if shutting down or context canceled
		if t.shuttingDown.Load() {
			logging.Info("Shutdown in progress, skipping CPU retry for: %s", filePath)
			// Close and remove the failed temp file
			if err := cacheFile.Close(); err != nil {
				logging.Debug("Error closing temp file: %v", err)
			}
			if err := os.Remove(tempPath); err != nil {
				logging.Debug("Error removing temp file: %v", err)
			}
			return fmt.Errorf("transcode canceled during shutdown")
		}
		if ctx.Err() != nil {
			logging.Info("Context canceled during GPU transcode, skipping CPU retry: %s", filePath)
			// Close and remove the failed temp file
			if err := cacheFile.Close(); err != nil {
				logging.Debug("Error closing temp file: %v", err)
			}
			if err := os.Remove(tempPath); err != nil {
				logging.Debug("Error removing temp file: %v", err)
			}
			return ctx.Err()
		}

		logging.Warn("GPU encoding failed for %s, retrying with CPU encoder...", filePath)
		logging.Debug("GPU error: %s", stderrStr)

		// Disable GPU to prevent further attempts
		t.gpuMu.Lock()
		t.gpuAvailable = false
		t.gpuMu.Unlock()

		// Close and remove the failed temp file
		if err := cacheFile.Close(); err != nil {
			logging.Debug("Error closing temp file: %v", err)
		}
		if err := os.Remove(tempPath); err != nil {
			logging.Debug("Error removing temp file: %v", err)
		}

		// Retry with CPU encoding
		return t.retryTranscodeWithCPU(ctx, filePath, w, cachePath, targetWidth, info, needsReencode)
	}

	logging.Warn("Transcode failed, not saving to cache (stream=%v, cmd=%v)", streamErr, cmdErr)
	return t.handleTranscodeError(ctx, filePath, streamErr, cmdErr, stderrStr)
}

// finalizeCache closes, verifies, and renames the cache file
func (t *Transcoder) finalizeCache(tempPath, cachePath string) {
	// Verify cache file was written
	fileInfo, err := os.Stat(tempPath)
	if err != nil {
		logging.Warn("Cache file missing after write: %v", err)
		return
	}
	logging.Debug("Cache temp file written: %d bytes", fileInfo.Size())

	// Atomic rename to final cache path
	if err := os.Rename(tempPath, cachePath); err != nil {
		logging.Warn("Failed to rename cache file: %v", err)
		return // Transcode succeeded, cache is bonus
	}

	// Verify final cache file
	if fileInfo, err := os.Stat(cachePath); err != nil {
		logging.Warn("Cache file missing after rename: %v", err)
	} else {
		logging.Info("Transcode completed and cached to %s (%d bytes)", cachePath, fileInfo.Size())
	}
}

// transcodeStream transcodes and streams directly without caching
func (t *Transcoder) transcodeStream(ctx context.Context, filePath string, w io.Writer, targetWidth int, info *VideoInfo, needsReencode bool) error {
	// Build ffmpeg command - output to stdout for streaming
	args := t.buildFFmpegArgs(filePath, "-", targetWidth, info, needsReencode)
	logging.Debug("FFmpeg command: ffmpeg %v", args)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	// Create a pipe for ffmpeg output
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	// Set up ffmpeg stderr capture
	var stderr bytes.Buffer
	logFile := t.createTranscoderLog(filePath, targetWidth)
	if logFile != nil {
		defer func() {
			if err := logFile.Close(); err != nil {
				logging.Warn("Failed to close transcoder log file: %v", err)
			}
		}()
		// Write to both buffer and log file
		cmd.Stderr = io.MultiWriter(&stderr, logFile)
	} else {
		cmd.Stderr = &stderr
	}

	// Start ffmpeg
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	// Track the process AFTER Start() succeeds to avoid race with Cleanup()
	t.processMu.Lock()
	t.processes[filePath] = cmd
	t.processMu.Unlock()

	defer func() {
		t.processMu.Lock()
		delete(t.processes, filePath)
		t.processMu.Unlock()
	}()

	// Stream output with timeout protection
	var streamErr error
	if hw, ok := w.(http.ResponseWriter); ok {
		streamErr = streaming.StreamWithTimeout(ctx, hw, stdout, t.streamConfig)
	} else {
		_, streamErr = io.Copy(w, stdout)
	}

	// Wait for ffmpeg to complete
	cmdErr := cmd.Wait()

	return t.handleTranscodeError(ctx, filePath, streamErr, cmdErr, stderr.String())
}

// buildFFmpegArgs builds ffmpeg arguments for transcoding
func (t *Transcoder) buildFFmpegArgs(inputPath, outputPath string, targetWidth int, info *VideoInfo, needsReencode bool) []string {
	return t.buildFFmpegArgsWithOptions(inputPath, outputPath, targetWidth, info, needsReencode, false)
}

// buildFFmpegArgsWithOptions builds ffmpeg arguments with option to force CPU encoding
func (t *Transcoder) buildFFmpegArgsWithOptions(inputPath, outputPath string, targetWidth int, info *VideoInfo, needsReencode, forceCPU bool) []string {
	var args []string

	// Initialize hardware device for VA-API if using GPU
	if !forceCPU && t.gpuAvailable && t.gpuEncoder != "" && t.gpuAccel == GPUAccelVAAPI {
		args = append(args, "-init_hw_device", "vaapi=vaapi0:/dev/dri/renderD128", "-filter_hw_device", "vaapi0")
	}

	args = append(args, "-i", inputPath)

	// Check if we need to scale the video
	needsScaling := targetWidth > 0 && targetWidth < info.Width

	// If codec is compatible AND no scaling needed, just copy the video stream (much faster)
	// Otherwise, we must re-encode
	if !needsReencode && !needsScaling {
		logging.Info("Using stream copy (no re-encoding needed)")
		args = append(args, "-c:v", "copy")
	} else {
		// Re-encode with h264 - use GPU if available and not forced to CPU, otherwise CPU
		if !forceCPU && t.gpuAvailable && t.gpuEncoder != "" {
			// Build a description of the encoding configuration
			var filterDesc string
			if t.gpuInitFilter != "" {
				filterDesc = fmt.Sprintf(" with filters: %s", t.gpuInitFilter)
			}
			if needsScaling {
				if filterDesc != "" {
					filterDesc += fmt.Sprintf(", scale=%dx-2", targetWidth)
				} else {
					filterDesc = fmt.Sprintf(" with scale=%dx-2", targetWidth)
				}
			}
			logging.Info("Using GPU encoder: %s (%s)%s", t.gpuEncoder, t.gpuAccel, filterDesc)
			logging.Debug("GPU encoder details: encoder=%s, accel=%s, initFilter=%q, scaling=%v",
				t.gpuEncoder, t.gpuAccel, t.gpuInitFilter, needsScaling)
			args = t.addGPUEncoderArgs(args, targetWidth, info, needsScaling)
		} else {
			if forceCPU && t.gpuAvailable {
				logging.Info("Falling back to CPU encoder after GPU failure")
			}
			var scaleDesc string
			if needsScaling {
				scaleDesc = fmt.Sprintf(" with scale=%dx-2", targetWidth)
			} else {
				scaleDesc = " (maintaining dimensions)"
			}
			logging.Info("Using CPU encoder: libx264%s", scaleDesc)
			logging.Debug("CPU encoder details: preset=fast, crf=23, scaling=%v", needsScaling)
			args = t.addCPUEncoderArgs(args, targetWidth, info, needsScaling)
		}
	}

	// Always re-encode audio to AAC for web compatibility
	args = append(args, "-c:a", "aac", "-b:a", "128k")

	// MP4 muxer configuration depends on output type
	if outputPath != "-" {
		// For file output: use +faststart to put moov atom at beginning for better seeking
		logging.Debug("Using +faststart for file output: %s", outputPath)
		args = append(args, "-movflags", "+faststart")
	} else {
		// For stdout/pipe: use fragmented MP4 which supports non-seekable output
		logging.Debug("Using fragmented MP4 for stdout streaming")
		args = append(args, "-movflags", "frag_keyframe+empty_moov")
	}

	args = append(args, "-f", "mp4", outputPath)
	return args
}

// handleTranscodeError handles errors from transcoding
func (t *Transcoder) handleTranscodeError(ctx context.Context, filePath string, streamErr, cmdErr error, stderrOutput string) error {
	// Determine the actual error
	if streamErr != nil {
		if errors.Is(streamErr, streaming.ErrClientGone) || errors.Is(streamErr, streaming.ErrWriteTimeout) {
			logging.Debug("Stream ended: %v for %s", streamErr, filePath)
			return nil // Not really an error, client just left
		}
		return streamErr
	}

	if cmdErr != nil {
		if ctx.Err() != nil {
			logging.Debug("Transcode canceled for %s: %v", filePath, ctx.Err())
			return ctx.Err()
		}
		logging.Error("Transcode failed for %s. FFmpeg stderr: %s", filePath, stderrOutput)
		return fmt.Errorf("transcoding error: %w", cmdErr)
	}

	logging.Info("Transcode completed successfully for %s", filePath)
	return nil
}

// isGPUError checks if an ffmpeg error is related to GPU hardware access
func (t *Transcoder) isGPUError(stderrOutput string) bool {
	lowerOutput := strings.ToLower(stderrOutput)

	// NVIDIA NVENC errors
	nvidiaErrors := []string{
		"cannot load libcuda",
		"libcuda",
		"no nvenc capable devices found",
		"nvenc not available",
		"nvenc",
		"cuda",
		"nvcuda",
	}

	// VA-API (Intel/AMD) errors
	vaapiErrors := []string{
		"libva",
		"vaapi",
		"/dev/dri",
		"no va display found",
		"failed to initialize vaapi",
		"vaapiencodevp",
		"cannot open render node",
		"drm",
	}

	// VideoToolbox (Apple) errors
	videotoolboxErrors := []string{
		"videotoolbox",
		"kvtcouldnotfindvideoencoder",
		"coremedia",
		"vt session",
		"vtcompressionoutputcallback",
	}

	// Generic hardware errors
	genericErrors := []string{
		"cannot load",
		"cannot open",
		"not supported",
		"no device available",
		"failed loading",
		"cannot initialize",
		"hardware",
		"device creation failed",
		"no hwaccel",
	}

	// Check all error patterns
	allErrors := make([]string, 0, len(nvidiaErrors)+len(vaapiErrors)+len(videotoolboxErrors)+len(genericErrors))
	allErrors = append(allErrors, nvidiaErrors...)
	allErrors = append(allErrors, vaapiErrors...)
	allErrors = append(allErrors, videotoolboxErrors...)
	allErrors = append(allErrors, genericErrors...)

	for _, errMsg := range allErrors {
		if strings.Contains(lowerOutput, errMsg) {
			return true
		}
	}
	return false
}

// retryTranscodeWithCPU retries transcoding with CPU encoder after GPU failure
func (t *Transcoder) retryTranscodeWithCPU(ctx context.Context, filePath string, w io.Writer, cachePath string, targetWidth int, info *VideoInfo, needsReencode bool) error {
	// Create cache directory if needed
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o750); err != nil {
		logging.Warn("Failed to create cache directory: %v (continuing without cache)", err)
		return t.transcodeStream(ctx, filePath, w, targetWidth, info, needsReencode)
	}

	// Create temporary file for atomic write
	tempPath := cachePath + ".tmp"
	cacheFile, err := os.Create(tempPath)
	if err != nil {
		logging.Warn("Failed to create cache file: %v (continuing without cache)", err)
		return t.transcodeStream(ctx, filePath, w, targetWidth, info, needsReencode)
	}
	defer func() {
		if closeErr := cacheFile.Close(); closeErr != nil {
			logging.Warn("Failed to close cache file: %v", closeErr)
		}
		// Clean up temp file if we didn't rename it
		_ = os.Remove(tempPath)
	}()

	// Build ffmpeg command with CPU encoding forced
	args := t.buildFFmpegArgsWithOptions(filePath, "-", targetWidth, info, needsReencode, true)
	logging.Debug("FFmpeg command (CPU retry): ffmpeg %v", args)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	// Create a pipe for ffmpeg output
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	// Set up ffmpeg stderr capture
	var stderr bytes.Buffer
	logFile := t.createTranscoderLog(filePath, targetWidth)
	if logFile != nil {
		defer func() {
			if err := logFile.Close(); err != nil {
				logging.Warn("Failed to close transcoder log file: %v", err)
			}
		}()
		cmd.Stderr = io.MultiWriter(&stderr, logFile)
	} else {
		cmd.Stderr = &stderr
	}

	// Start ffmpeg
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	// Track the process
	t.processMu.Lock()
	t.processes[filePath] = cmd
	t.processMu.Unlock()

	defer func() {
		t.processMu.Lock()
		delete(t.processes, filePath)
		t.processMu.Unlock()
	}()

	logging.Info("FFmpeg (CPU) started, beginning to stream chunks to client...")

	// Create TeeReader to write to cache as we read
	teeReader := io.TeeReader(stdout, cacheFile)

	// Wrap reader with progress tracking
	startTime := time.Now()
	progressReader := &progressTrackingReader{
		reader:   teeReader,
		filePath: filePath,
		lastLog:  startTime,
	}

	// Stream output
	var streamErr error
	if hw, ok := w.(http.ResponseWriter); ok {
		streamErr = streaming.StreamWithTimeout(ctx, hw, progressReader, t.streamConfig)
	} else {
		_, streamErr = io.Copy(w, progressReader)
	}

	elapsed := time.Since(startTime)
	logging.Info("Streaming (CPU) completed: %d bytes in %.2fs (%.2f KB/s) - waiting for ffmpeg to finish...",
		progressReader.totalBytes, elapsed.Seconds(), float64(progressReader.totalBytes)/1024/elapsed.Seconds())

	// Wait for ffmpeg to complete
	cmdErr := cmd.Wait()

	totalElapsed := time.Since(startTime)
	logging.Info("FFmpeg (CPU) process completed after %.2fs total", totalElapsed.Seconds())

	// Handle errors
	if streamErr != nil || cmdErr != nil {
		logging.Warn("CPU transcode failed, not saving to cache (stream=%v, cmd=%v)", streamErr, cmdErr)
		return t.handleTranscodeError(ctx, filePath, streamErr, cmdErr, stderr.String())
	}

	// Close cache file before renaming
	if err := cacheFile.Close(); err != nil {
		logging.Warn("Failed to close cache file: %v", err)
		return nil // Transcode succeeded, cache is bonus
	}

	// Verify cache file was written
	fileInfo, err := os.Stat(tempPath)
	if err != nil {
		logging.Warn("Cache file missing after write: %v", err)
		return nil
	}
	logging.Debug("Cache temp file written: %d bytes", fileInfo.Size())

	// Atomic rename to final cache path
	logging.Info("FFmpeg completed, renaming %s to %s", tempPath, cachePath)
	if err := os.Rename(tempPath, cachePath); err != nil {
		logging.Warn("Failed to rename cache file: %v", err)
		return nil // Transcode succeeded, cache is bonus
	}

	fileSize := float64(fileInfo.Size()) / (1024 * 1024)
	logging.Info("Successfully cached transcoded video: %s (%.2f MB)", cachePath, fileSize)

	return nil
}

// Cleanup stops all active transcoding processes.
func (t *Transcoder) Cleanup() {
	// Set shutdown flag to prevent GPU-to-CPU retries
	t.shuttingDown.Store(true)

	t.processMu.Lock()
	defer t.processMu.Unlock()

	for path, cmd := range t.processes {
		if cmd.Process != nil {
			logging.Info("Killing transcoding process for: %s", path)
			if err := cmd.Process.Kill(); err != nil {
				logging.Warn("failed to kill transcoding process for %s: %v", path, err)
			}
		}
	}
}

// ClearCache removes all cached transcoded files and returns the number of bytes freed.
func (t *Transcoder) ClearCache() (int64, error) {
	logging.Info("ClearCache called: cacheDir=%q", t.cacheDir)

	if t.cacheDir == "" {
		logging.Warn("ClearCache: No cache directory configured")
		return 0, nil
	}

	var freedBytes int64

	entries, err := os.ReadDir(t.cacheDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("failed to read transcode cache directory: %w", err)
	}

	for _, entry := range entries {
		path := filepath.Join(t.cacheDir, entry.Name())

		// Get file size before deletion
		info, err := entry.Info()
		if err != nil {
			logging.Warn("failed to get info for %s: %v", path, err)
			continue
		}

		if entry.IsDir() {
			// Calculate directory size
			dirSize, _ := t.getDirSize(path)
			if err := os.RemoveAll(path); err != nil {
				logging.Warn("failed to remove directory %s: %v", path, err)
				continue
			}
			freedBytes += dirSize
		} else {
			freedBytes += info.Size()
			if err := os.Remove(path); err != nil {
				logging.Warn("failed to remove file %s: %v", path, err)
				continue
			}
		}
	}

	logging.Info("Cleared transcode cache: freed %d bytes", freedBytes)
	return freedBytes, nil
}

// GetCacheSize returns the total size of the transcoder cache in bytes and the number of files (excluding .err files).
func (t *Transcoder) GetCacheSize() (size int64, count int, err error) {
	if t.cacheDir == "" || !t.enabled {
		return 0, 0, nil
	}

	return t.getDirSizeAndCount(t.cacheDir)
}

// progressTrackingReader wraps an io.Reader to log streaming progress
type progressTrackingReader struct {
	reader     io.Reader
	filePath   string
	totalBytes int64
	lastLog    time.Time
	lastBytes  int64
}

func (r *progressTrackingReader) Read(p []byte) (n int, err error) {
	n, err = r.reader.Read(p)
	r.totalBytes += int64(n)

	// Log progress every 500ms to show chunks streaming
	now := time.Now()
	if now.Sub(r.lastLog) >= 500*time.Millisecond {
		bytesSinceLastLog := r.totalBytes - r.lastBytes
		elapsed := now.Sub(r.lastLog).Seconds()
		logging.Debug("Streaming progress: %d KB sent (%.2f KB/s current, %.2f KB total)",
			bytesSinceLastLog/1024, float64(bytesSinceLastLog)/1024/elapsed, float64(r.totalBytes)/1024)
		r.lastLog = now
		r.lastBytes = r.totalBytes
	}

	return n, err
}

// createTranscoderLog creates a log file for transcoder operations
func (t *Transcoder) createTranscoderLog(filePath string, targetWidth int) *os.File {
	if t.logDir == "" {
		return nil
	}

	// Create log filename with timestamp and video info
	timestamp := time.Now().Format("20060102-150405")
	videoBaseName := filepath.Base(filePath)
	logFileName := fmt.Sprintf("%s-%s-w%d.log", timestamp, videoBaseName, targetWidth)
	logPath := filepath.Join(t.logDir, logFileName)

	logFile, err := os.Create(logPath)
	if err != nil {
		logging.Warn("Failed to create transcoder log file %s: %v", logPath, err)
		return nil
	}

	// Write header to log file
	header := fmt.Sprintf("=== Transcoder Log ===\nTimestamp: %s\nSource: %s\nTarget Width: %d\nFFmpeg Output:\n\n",
		time.Now().Format(time.RFC3339), filePath, targetWidth)
	if _, err := logFile.WriteString(header); err != nil {
		logging.Warn("Failed to write header to transcoder log: %v", err)
	}

	logging.Debug("Created transcoder log: %s", logPath)
	return logFile
}

// getDirSize calculates the total size of a directory
func (t *Transcoder) getDirSize(path string) (int64, error) {
	size, _, err := t.getDirSizeAndCount(path)
	return size, err
}

func (t *Transcoder) getDirSizeAndCount(path string) (size int64, count int, err error) {
	err = filepath.Walk(path, func(filePath string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			size += info.Size()
			// Exclude .err files from count
			if !strings.HasSuffix(filePath, ".err") {
				count++
			}
		}
		return nil
	})
	return size, count, err
}

// detectGPU detects available GPU hardware encoders
func (t *Transcoder) detectGPU() {
	t.gpuMu.Lock()
	defer t.gpuMu.Unlock()

	if t.gpuDetectionDone {
		return
	}
	t.gpuDetectionDone = true

	// If explicitly set to none, don't detect
	if t.gpuAccel == GPUAccelNone {
		logging.Info("GPU acceleration disabled (GPU_ACCEL=none)")
		return
	}

	logging.Info("Detecting GPU acceleration capabilities (GPU_ACCEL=%s)...", t.gpuAccel)

	// Try encoders in priority order based on configuration
	var encodersToTry []struct {
		accel   GPUAccel
		encoder string
		filter  string
	}

	switch t.gpuAccel {
	case GPUAccelNone:
		// GPU disabled, nothing to detect
		return
	case GPUAccelNVIDIA:
		encodersToTry = []struct {
			accel   GPUAccel
			encoder string
			filter  string
		}{{GPUAccelNVIDIA, "h264_nvenc", ""}}
	case GPUAccelVAAPI:
		encodersToTry = []struct {
			accel   GPUAccel
			encoder string
			filter  string
		}{{GPUAccelVAAPI, "h264_vaapi", "format=nv12,hwupload"}}
	case GPUAccelVideoToolbox:
		encodersToTry = []struct {
			accel   GPUAccel
			encoder string
			filter  string
		}{{GPUAccelVideoToolbox, "h264_videotoolbox", ""}}
	case GPUAccelAuto:
		// Try in order: NVIDIA, VA-API, VideoToolbox
		encodersToTry = []struct {
			accel   GPUAccel
			encoder string
			filter  string
		}{
			{GPUAccelNVIDIA, "h264_nvenc", ""},
			{GPUAccelVAAPI, "h264_vaapi", "format=nv12,hwupload"},
			{GPUAccelVideoToolbox, "h264_videotoolbox", ""},
		}
	default:
		logging.Warn("Unknown GPU acceleration mode: %s, falling back to CPU", t.gpuAccel)
		return
	}

	// Test each encoder
	for _, test := range encodersToTry {
		logging.Debug("Checking GPU encoder: %s (accel=%s, encoder=%s, filter=%q)", test.accel, test.accel, test.encoder, test.filter)

		// Pre-check: Verify hardware device accessibility before testing encoder
		if !t.checkGPUDeviceAccess(test.accel) {
			logging.Debug("  Skipping %s: GPU device not accessible", test.accel)
			continue
		}
		logging.Debug("  Device check passed for %s", test.accel)

		logging.Info("Testing %s encoder (%s)...", test.accel, test.encoder)
		if !t.testGPUEncoder(test.encoder, test.accel, test.filter) {
			logging.Info("✗ %s encoder test failed", test.accel)
			logging.Debug("  Encoder test failed for %s", test.encoder)
			continue
		}
		t.gpuAvailable = true
		t.gpuEncoder = test.encoder
		t.gpuInitFilter = test.filter
		t.gpuAccel = test.accel
		logging.Info("✓ GPU acceleration enabled: %s (encoder: %s)", test.accel, test.encoder)
		return
	}

	logging.Warn("No GPU encoder available, falling back to CPU encoding")
}

// checkGPUDeviceAccess verifies that GPU hardware devices are accessible
func (t *Transcoder) checkGPUDeviceAccess(accel GPUAccel) bool {
	switch accel {
	case GPUAccelNVIDIA:
		// Check for NVIDIA device files
		logging.Debug("Checking for NVIDIA GPU hardware...")
		nvidiaDevices := []string{
			"/dev/nvidia0",
			"/dev/nvidiactl",
			"/dev/nvidia-uvm",
		}

		foundDevice := false
		for _, device := range nvidiaDevices {
			if stat, err := os.Stat(device); err == nil {
				logging.Info("✓ Found NVIDIA device: %s (mode: %v)", device, stat.Mode())
				foundDevice = true
			} else {
				logging.Debug("  Device %s: %v", device, err)
			}
		}

		if foundDevice {
			return true
		}

		// Fallback: Check if nvidia-smi is available and working
		logging.Debug("NVIDIA device files not found, trying nvidia-smi as fallback...")
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		cmd := exec.CommandContext(ctx, "nvidia-smi", "-L")
		output, err := cmd.Output()
		if err == nil && len(output) > 0 {
			logging.Info("✓ NVIDIA GPU detected via nvidia-smi: %s", strings.TrimSpace(string(output)))
			logging.Warn("NVIDIA GPU detected but device files not accessible - container may need --gpus=all")
			// Allow encoder test to proceed even without device files
			// The encoder test will definitively determine if GPU encoding works
			return true
		}

		logging.Debug("nvidia-smi not available or returned no GPUs")
		logging.Info("No NVIDIA GPU found (checked /dev/nvidia* and nvidia-smi)")
		return false

	case GPUAccelVAAPI:
		// Check for DRI render nodes (VA-API)
		logging.Debug("Checking for Intel/AMD GPU (VA-API) hardware...")
		driDevices := []string{
			"/dev/dri/renderD128",
			"/dev/dri/renderD129",
			"/dev/dri/card0",
			"/dev/dri/card1",
		}

		for _, device := range driDevices {
			stat, err := os.Stat(device)
			if err != nil {
				logging.Debug("  Device %s: %v", device, err)
				continue
			}
			logging.Info("✓ Found DRI device: %s (mode: %v)", device, stat.Mode())
			return true
		}

		logging.Info("No VA-API GPU found (checked /dev/dri/*)")
		return false

	case GPUAccelVideoToolbox:
		// VideoToolbox is macOS-only, check if we're on Darwin
		logging.Debug("Checking for Apple VideoToolbox...")
		if runtime.GOOS == "darwin" {
			logging.Info("✓ Running on macOS, VideoToolbox may be available")
			return true
		}
		logging.Debug("Not running on macOS (OS: %s), VideoToolbox not available", runtime.GOOS)
		return false

	case GPUAccelNone:
		// No GPU acceleration requested, no device check needed
		return true

	case GPUAccelAuto:
		// Auto mode doesn't call this function directly, return true if called
		return true

	default:
		// Unknown GPU type, allow test to proceed
		return true
	}
}

// testGPUEncoder tests if a GPU encoder is available and actually works
func (t *Transcoder) testGPUEncoder(encoder string, accel GPUAccel, initFilter string) bool {
	// Step 1: Check if encoder is in ffmpeg's encoders list
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-encoders")
	output, err := cmd.Output()
	if err != nil {
		logging.Debug("Failed to list encoders: %v", err)
		return false
	}

	// Check if encoder is listed
	if !bytes.Contains(output, []byte(encoder)) {
		logging.Info("  Encoder %s not available in ffmpeg", encoder)
		logging.Debug("Encoder %s not found in ffmpeg", encoder)
		return false
	}

	// Step 2: Try to actually use the encoder with a test encode
	// Generate a 1-frame test video in memory
	logging.Debug("Testing %s with real encode (accel=%s, filter=%q)...", encoder, accel, initFilter)
	testCtx, testCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer testCancel()

	// Create a simple test: generate 1 frame with testsrc, encode with GPU encoder, output to null
	var testArgs []string

	// Initialize hardware device for VA-API
	if accel == GPUAccelVAAPI {
		logging.Debug("  Initializing VA-API hardware device")
		testArgs = append(testArgs, "-init_hw_device", "vaapi=vaapi0:/dev/dri/renderD128", "-filter_hw_device", "vaapi0")
	}

	testArgs = append(testArgs, "-f", "lavfi", "-i", "testsrc=duration=0.1:size=320x240:rate=1", "-frames:v", "1")

	// Add hardware-specific initialization if needed
	if initFilter != "" {
		logging.Debug("  Adding video filter: %s", initFilter)
		testArgs = append(testArgs, "-vf", initFilter)
	}

	testArgs = append(testArgs, "-c:v", encoder)

	// Add encoder-specific options
	switch accel {
	case GPUAccelNVIDIA:
		logging.Debug("  Adding NVIDIA preset: p1")
		testArgs = append(testArgs, "-preset", "p1") // Fastest preset for test
	case GPUAccelVAAPI:
		logging.Debug("  Adding VA-API qp: 30")
		testArgs = append(testArgs, "-qp", "30")
	case GPUAccelVideoToolbox:
		logging.Debug("  Adding VideoToolbox bitrate: 500k")
		testArgs = append(testArgs, "-b:v", "500k")
	case GPUAccelNone, GPUAccelAuto:
		// No specific encoder options needed
	}

	testArgs = append(testArgs, "-f", "null", "-")

	// Log the full command for debugging
	logging.Debug("  Running: ffmpeg %v", testArgs)

	testCmd := exec.CommandContext(testCtx, "ffmpeg", testArgs...)
	var stderr bytes.Buffer
	testCmd.Stderr = &stderr

	if err := testCmd.Run(); err != nil {
		stderrStr := stderr.String()
		logging.Debug("✗ Encoder %s test failed with exit code: %v", encoder, err)
		logging.Debug("  FFmpeg stderr output:")
		for _, line := range strings.Split(stderrStr, "\n") {
			if line != "" {
				logging.Debug("    %s", line)
			}
		}
		// Use the isGPUError helper to check if this is a GPU hardware issue
		if t.isGPUError(stderrStr) {
			logging.Info("  Hardware initialization failed (enable DEBUG logging for details)")
			logging.Debug("  → Classified as GPU hardware error")
			return false
		}
		logging.Info("  Encoder test failed: %v (enable DEBUG logging for details)", err)
		logging.Debug("  → Classified as non-GPU error")
		return false
	}

	logging.Debug("✓ Encoder %s is available and working", encoder)
	return true
}

// addGPUEncoderArgs adds GPU encoder arguments to ffmpeg command
func (t *Transcoder) addGPUEncoderArgs(args []string, targetWidth int, info *VideoInfo, needsScaling bool) []string {
	var filters []string

	// Add hardware upload filter if needed (VA-API)
	if t.gpuInitFilter != "" {
		filters = append(filters, t.gpuInitFilter)
	}

	// Add scaling if needed
	if needsScaling {
		logging.Debug("Adding GPU scale filter: %dx-2", targetWidth)
		// For VA-API, use scale_vaapi; for others, use regular scale before encoding
		if t.gpuAccel == GPUAccelVAAPI {
			filters = append(filters, fmt.Sprintf("scale_vaapi=w=%d:h=-2", targetWidth))
		} else {
			filters = append(filters, fmt.Sprintf("scale=%d:-2", targetWidth))
		}
	} else {
		// Force exact dimensions for odd dimension handling
		logging.Debug("Adding GPU scale filter for exact dimensions: %dx%d", info.Width, info.Height)
		if t.gpuAccel == GPUAccelVAAPI {
			filters = append(filters, fmt.Sprintf("scale_vaapi=w=%d:h=%d", info.Width, info.Height))
		} else {
			filters = append(filters, fmt.Sprintf("scale=%d:%d", info.Width, info.Height))
		}
	}

	// Apply filters if any
	if len(filters) > 0 {
		args = append(args, "-vf", strings.Join(filters, ","))
	}

	// Add GPU encoder
	args = append(args, "-c:v", t.gpuEncoder)

	// Add encoder-specific options
	switch t.gpuAccel {
	case GPUAccelNVIDIA:
		// NVENC options
		args = append(args, "-preset", "p4", "-cq", "23") // p4 = medium quality preset
	case GPUAccelVAAPI:
		// VA-API options
		args = append(args, "-qp", "23")
	case GPUAccelVideoToolbox:
		// VideoToolbox options
		args = append(args, "-b:v", "2M") // Target bitrate for quality
	case GPUAccelNone, GPUAccelAuto:
		// Should not reach here, but handle gracefully
		logging.Warn("Unexpected GPU accel type in addGPUEncoderArgs: %s", t.gpuAccel)
	}

	return args
}

// addCPUEncoderArgs adds CPU encoder arguments to ffmpeg command
func (t *Transcoder) addCPUEncoderArgs(args []string, targetWidth int, info *VideoInfo, needsScaling bool) []string {
	args = append(args, "-c:v", "libx264", "-preset", "fast", "-crf", "23")

	// Tier 2: Always add scale filter when re-encoding to ensure output dimensions
	// match the (possibly adjusted) dimensions from GetVideoInfo
	if needsScaling {
		// Scale to requested width, maintaining aspect ratio with even height
		logging.Debug("Adding scale filter: %dx-2", targetWidth)
		args = append(args, "-vf", fmt.Sprintf("scale=%d:-2", targetWidth))
	} else {
		// No size reduction, but force exact dimensions to handle odd dimensions
		// This ensures output matches Tier 1 adjusted dimensions (always even)
		logging.Debug("Adding scale filter for exact dimensions: %dx%d", info.Width, info.Height)
		args = append(args, "-vf", fmt.Sprintf("scale=%d:%d", info.Width, info.Height))
	}

	return args
}
