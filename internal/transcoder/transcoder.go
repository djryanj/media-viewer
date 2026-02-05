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
	enabled   bool
	processes map[string]*exec.Cmd
	processMu sync.Mutex

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
func New(cacheDir string, enabled bool) *Transcoder {
	config := streaming.DefaultTimeoutWriterConfig()
	config.WriteTimeout = 30 * time.Second
	config.IdleTimeout = 60 * time.Second
	config.ChunkSize = 256 * 1024 // 256KB chunks for video

	return &Transcoder{
		cacheDir:     cacheDir,
		enabled:      enabled,
		processes:    make(map[string]*exec.Cmd),
		streamConfig: config,
	}
}

// IsEnabled returns whether transcoding is enabled.
func (t *Transcoder) IsEnabled() bool {
	return t.enabled
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

	// Check if transcoding is needed
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	info.NeedsTranscode = !compatibleCodecs[info.Codec] || !compatibleContainers[ext]

	return info, nil
}

// StreamVideo streams a video file, transcoding if necessary for browser compatibility.
// Now uses timeout-protected chunked streaming.
func (t *Transcoder) StreamVideo(ctx context.Context, filePath string, w io.Writer, targetWidth int) error {
	info, err := t.GetVideoInfo(ctx, filePath)
	if err != nil {
		return err
	}

	// If no transcoding needed and no resize, just stream the file
	if !info.NeedsTranscode && (targetWidth == 0 || targetWidth >= info.Width) {
		return t.streamFile(ctx, filePath, w)
	}

	// Check if transcoding is enabled
	if !t.enabled {
		return fmt.Errorf("transcoding required but disabled (cache directory not writable)")
	}

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

// transcodeAndStream transcodes video and streams with timeout protection
func (t *Transcoder) transcodeAndStream(ctx context.Context, filePath string, w io.Writer, targetWidth int, info *VideoInfo) error {
	// Build ffmpeg command for transcoding
	args := []string{
		"-i", filePath,
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-c:a", "aac",
		"-b:a", "128k",
		"-movflags", "frag_keyframe+empty_moov+faststart",
		"-f", "mp4",
	}

	if targetWidth > 0 && targetWidth < info.Width {
		args = append(args, "-vf", fmt.Sprintf("scale=%d:-2", targetWidth))
	}

	args = append(args, "-")

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	// Create a pipe for ffmpeg output
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	// Track the process
	t.processMu.Lock()
	t.processes[filePath] = cmd
	t.processMu.Unlock()

	defer func() {
		t.processMu.Lock()
		delete(t.processes, filePath)
		t.processMu.Unlock()
	}()

	// Start ffmpeg
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	// Stream output with timeout protection
	var streamErr error
	if hw, ok := w.(http.ResponseWriter); ok {
		streamErr = streaming.StreamWithTimeout(ctx, hw, stdout, t.streamConfig)
	} else {
		_, streamErr = io.Copy(w, stdout)
	}

	// Wait for ffmpeg to complete
	cmdErr := cmd.Wait()

	// Determine the actual error
	if streamErr != nil {
		// Client disconnected or timeout - kill ffmpeg if still running
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}

		if errors.Is(streamErr, streaming.ErrClientGone) || errors.Is(streamErr, streaming.ErrWriteTimeout) {
			logging.Debug("Stream ended: %v for %s", streamErr, filePath)
			return nil // Not really an error, client just left
		}
		return streamErr
	}

	if cmdErr != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		logging.Error("FFmpeg stderr: %s", stderr.String())
		return fmt.Errorf("transcoding error: %w", cmdErr)
	}

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
	if t.cacheDir == "" {
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

// getDirSize calculates the total size of a directory
func (t *Transcoder) getDirSize(path string) (int64, error) {
	var size int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}
