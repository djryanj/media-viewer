package media

import (
	"bytes"
	"crypto/md5"
	"fmt"
	"image"
	"image/jpeg"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"media-viewer/internal/database"

	"github.com/disintegration/imaging"
)

type ThumbnailGenerator struct {
	cacheDir string
	enabled  bool
	mu       sync.Mutex
}

func NewThumbnailGenerator(cacheDir string, enabled bool) *ThumbnailGenerator {
	if enabled {
		log.Printf("[DEBUG] ThumbnailGenerator: enabled, cache dir: %s", cacheDir)
	} else {
		log.Printf("[DEBUG] ThumbnailGenerator: disabled")
	}
	return &ThumbnailGenerator{
		cacheDir: cacheDir,
		enabled:  enabled,
	}
}

func (t *ThumbnailGenerator) IsEnabled() bool {
	return t.enabled
}

func (t *ThumbnailGenerator) GetThumbnail(filePath string, fileType database.FileType) ([]byte, error) {
	if !t.enabled {
		return nil, fmt.Errorf("thumbnails disabled")
	}

	// Validate file exists
	if _, err := os.Stat(filePath); err != nil {
		return nil, fmt.Errorf("file not accessible: %w", err)
	}

	// Generate cache key
	hash := md5.Sum([]byte(filePath))
	cacheKey := fmt.Sprintf("%x.jpg", hash)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	// Check cache
	if data, err := os.ReadFile(cachePath); err == nil {
		log.Printf("[DEBUG] Thumbnail cache hit: %s", filePath)
		return data, nil
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	// Double-check after acquiring lock
	if data, err := os.ReadFile(cachePath); err == nil {
		return data, nil
	}

	log.Printf("[DEBUG] Thumbnail generating: %s (type: %s)", filePath, fileType)

	var img image.Image
	var err error

	if fileType == database.FileTypeImage {
		img, err = t.generateImageThumbnail(filePath)
	} else if fileType == database.FileTypeVideo {
		img, err = t.generateVideoThumbnail(filePath)
	} else {
		return nil, fmt.Errorf("unsupported file type: %s", fileType)
	}

	if err != nil {
		return nil, fmt.Errorf("thumbnail generation failed: %w", err)
	}

	if img == nil {
		return nil, fmt.Errorf("thumbnail generation returned nil image")
	}

	// Resize
	thumb := imaging.Fit(img, 200, 200, imaging.Lanczos)

	// Encode to JPEG
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 80}); err != nil {
		return nil, fmt.Errorf("failed to encode thumbnail: %w", err)
	}

	// Save to cache (ignore errors - cache is optional)
	if err := os.WriteFile(cachePath, buf.Bytes(), 0644); err != nil {
		log.Printf("[WARN] Failed to cache thumbnail %s: %v", cachePath, err)
	} else {
		log.Printf("[DEBUG] Thumbnail cached: %s", cachePath)
	}

	return buf.Bytes(), nil
}

func (t *ThumbnailGenerator) generateImageThumbnail(filePath string) (image.Image, error) {
	log.Printf("[DEBUG] Opening image: %s", filePath)

	img, err := imaging.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open image %s: %w", filePath, err)
	}

	return img, nil
}

func (t *ThumbnailGenerator) generateVideoThumbnail(filePath string) (image.Image, error) {
	log.Printf("[DEBUG] Extracting video frame: %s", filePath)

	// Check if ffmpeg is available
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("ffmpeg not found: %w", err)
	}
	log.Printf("[DEBUG] Using ffmpeg: %s", ffmpegPath)

	// Try to extract frame at 1 second
	cmd := exec.Command("ffmpeg",
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
	if err != nil {
		log.Printf("[DEBUG] FFmpeg first attempt failed for %s: %v\nStderr: %s", filePath, err, stderr.String())

		// Try at 0 seconds if 1 second fails (video might be shorter)
		cmd = exec.Command("ffmpeg",
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
			return nil, fmt.Errorf("ffmpeg failed: %v, stderr: %s", err, stderr.String())
		}
	}

	if stdout.Len() == 0 {
		return nil, fmt.Errorf("ffmpeg produced no output for %s", filePath)
	}

	log.Printf("[DEBUG] FFmpeg output size: %d bytes", stdout.Len())

	img, _, err := image.Decode(&stdout)
	if err != nil {
		return nil, fmt.Errorf("failed to decode ffmpeg output: %w", err)
	}

	return img, nil
}

func (t *ThumbnailGenerator) GetFileType(path string) database.FileType {
	ext := strings.ToLower(filepath.Ext(path))

	imageExts := map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
		".bmp": true, ".webp": true, ".svg": true, ".ico": true,
		".tiff": true, ".tif": true, ".heic": true, ".heif": true,
	}

	videoExts := map[string]bool{
		".mp4": true, ".mkv": true, ".avi": true, ".mov": true,
		".wmv": true, ".flv": true, ".webm": true, ".m4v": true,
		".mpeg": true, ".mpg": true, ".3gp": true, ".ts": true,
	}

	if imageExts[ext] {
		return database.FileTypeImage
	}
	if videoExts[ext] {
		return database.FileTypeVideo
	}
	return database.FileTypeOther
}
