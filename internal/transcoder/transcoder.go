package transcoder

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

type Transcoder struct {
	cacheDir  string
	enabled   bool
	processes map[string]*exec.Cmd
	processMu sync.Mutex
}

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

func New(cacheDir string, enabled bool) *Transcoder {
	return &Transcoder{
		cacheDir:  cacheDir,
		enabled:   enabled,
		processes: make(map[string]*exec.Cmd),
	}
}

func (t *Transcoder) IsEnabled() bool {
	return t.enabled
}

func (t *Transcoder) GetVideoInfo(filePath string) (*VideoInfo, error) {
	cmd := exec.Command("ffprobe",
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
		return nil, fmt.Errorf("ffprobe error: %v - %s", err, stderr.String())
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
		end := strings.Index(output[start:], ",")
		if end == -1 {
			end = strings.Index(output[start:], "}")
		}
		widthStr := strings.TrimSpace(output[start : start+end])
		info.Width, _ = strconv.Atoi(widthStr)
	}
	if idx := strings.Index(output, `"height"`); idx != -1 {
		start := strings.Index(output[idx:], ":") + idx + 1
		end := strings.Index(output[start:], ",")
		if end == -1 {
			end = strings.Index(output[start:], "}")
		}
		heightStr := strings.TrimSpace(output[start : start+end])
		info.Height, _ = strconv.Atoi(heightStr)
	}

	// Check if transcoding is needed
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	info.NeedsTranscode = !compatibleCodecs[info.Codec] || !compatibleContainers[ext]

	return info, nil
}

func (t *Transcoder) StreamVideo(ctx context.Context, filePath string, w io.Writer, targetWidth int) error {
	info, err := t.GetVideoInfo(filePath)
	if err != nil {
		return err
	}

	// If no transcoding needed and no resize, just stream the file
	if !info.NeedsTranscode && (targetWidth == 0 || targetWidth >= info.Width) {
		file, err := os.Open(filePath)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(w, file)
		return err
	}

	// Check if transcoding is enabled
	if !t.enabled {
		return fmt.Errorf("transcoding required but disabled (cache directory not writable)")
	}

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
	cmd.Stdout = w

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	t.processMu.Lock()
	t.processes[filePath] = cmd
	t.processMu.Unlock()

	defer func() {
		t.processMu.Lock()
		delete(t.processes, filePath)
		t.processMu.Unlock()
	}()

	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		log.Printf("FFmpeg stderr: %s", stderr.String())
		return fmt.Errorf("transcoding error: %v", err)
	}

	return nil
}

func (t *Transcoder) Cleanup() {
	t.processMu.Lock()
	defer t.processMu.Unlock()

	for path, cmd := range t.processes {
		if cmd.Process != nil {
			log.Printf("Killing transcoding process for: %s", path)
			cmd.Process.Kill()
		}
	}
}
