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
	"strconv"
	"strings"
	"sync"
	"time"

	"media-viewer/internal/logging"
	"media-viewer/internal/streaming"
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

// New creates a new Transcoder instance.
func New(cacheDir, logDir string, enabled bool) *Transcoder {
	config := streaming.DefaultTimeoutWriterConfig()
	config.WriteTimeout = 30 * time.Second
	config.IdleTimeout = 60 * time.Second
	config.ChunkSize = 256 * 1024 // 256KB chunks for video

	logging.Info("Transcoder initialized: cacheDir=%q, logDir=%q, enabled=%v", cacheDir, logDir, enabled)

	// Create log directory if specified
	if logDir != "" {
		if err := os.MkdirAll(logDir, 0o750); err != nil {
			logging.Warn("Failed to create transcoder log directory %s: %v", logDir, err)
		}
	}

	return &Transcoder{
		cacheDir:     cacheDir,
		logDir:       logDir,
		enabled:      enabled,
		processes:    make(map[string]*exec.Cmd),
		cacheLocks:   make(map[string]*sync.Mutex),
		streamConfig: config,
	}
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
	args := t.buildFFmpegArgs(filePath, tmpPath, targetWidth, info, needsReencode)
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

	logging.Info("FFmpeg started, beginning to stream chunks to client...")

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

	// Wait for ffmpeg to complete
	cmdErr := cmd.Wait()

	totalElapsed := time.Since(startTime)
	logging.Info("FFmpeg process completed after %.2fs total", totalElapsed.Seconds())

	// Handle errors
	if streamErr != nil || cmdErr != nil {
		logging.Warn("Transcode failed, not saving to cache (stream=%v, cmd=%v)", streamErr, cmdErr)
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
	if err := os.Rename(tempPath, cachePath); err != nil {
		logging.Warn("Failed to rename cache file: %v", err)
		return nil // Transcode succeeded, cache is bonus
	}

	// Verify final cache file
	if fileInfo, err := os.Stat(cachePath); err != nil {
		logging.Warn("Cache file missing after rename: %v", err)
	} else {
		logging.Info("Transcode completed and cached to %s (%d bytes)", cachePath, fileInfo.Size())
	}
	return nil
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
	args := []string{"-i", inputPath}

	// Check if we need to scale the video
	needsScaling := targetWidth > 0 && targetWidth < info.Width

	// If codec is compatible AND no scaling needed, just copy the video stream (much faster)
	// Otherwise, we must re-encode
	if !needsReencode && !needsScaling {
		args = append(args, "-c:v", "copy")
	} else {
		// Re-encode with h264
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

// Cleanup stops all active transcoding processes.
func (t *Transcoder) Cleanup() {
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
