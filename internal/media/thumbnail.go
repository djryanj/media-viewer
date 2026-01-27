package media

import (
	"bytes"
	"crypto/md5"
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"

	_ "image/gif"
	_ "image/png"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

type ThumbnailGenerator struct {
	cacheDir string
	enabled  bool
	mu       sync.Mutex
}

func NewThumbnailGenerator(cacheDir string, enabled bool) *ThumbnailGenerator {
	if enabled {
		logging.Debug("ThumbnailGenerator: enabled, cache dir: %s", cacheDir)
		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			logging.Warn("ThumbnailGenerator: failed to create cache dir: %v", err)
		}
	} else {
		logging.Debug("ThumbnailGenerator: disabled")
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

	if _, err := os.Stat(filePath); err != nil {
		return nil, fmt.Errorf("file not accessible: %w", err)
	}

	hash := md5.Sum([]byte(filePath))
	cacheKey := fmt.Sprintf("%x.jpg", hash)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	if data, err := os.ReadFile(cachePath); err == nil {
		logging.Debug("Thumbnail cache hit: %s", filePath)
		return data, nil
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	if data, err := os.ReadFile(cachePath); err == nil {
		return data, nil
	}

	logging.Debug("Thumbnail generating: %s (type: %s)", filePath, fileType)

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

	thumb := imaging.Fit(img, 200, 200, imaging.Lanczos)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 80}); err != nil {
		return nil, fmt.Errorf("failed to encode thumbnail: %w", err)
	}

	if err := os.WriteFile(cachePath, buf.Bytes(), 0644); err != nil {
		logging.Warn("Failed to cache thumbnail %s: %v", cachePath, err)
	} else {
		logging.Debug("Thumbnail cached: %s", cachePath)
	}

	return buf.Bytes(), nil
}

func (t *ThumbnailGenerator) generateImageThumbnail(filePath string) (image.Image, error) {
	logging.Debug("Opening image: %s", filePath)

	actualType, err := detectFileType(filePath)
	if err != nil {
		logging.Debug("Could not detect file type for %s: %v", filePath, err)
	} else {
		logging.Debug("Detected file type: %s for %s", actualType, filePath)
	}

	img, err := imaging.Open(filePath, imaging.AutoOrientation(true))
	if err == nil {
		return img, nil
	}

	logging.Debug("imaging.Open failed for %s: %v, trying fallback methods", filePath, err)

	img, err = decodeImageFile(filePath)
	if err == nil {
		return img, nil
	}

	logging.Debug("Standard decode failed for %s: %v, trying ffmpeg fallback", filePath, err)

	img, err = t.generateImageWithFFmpeg(filePath)
	if err != nil {
		return nil, fmt.Errorf("all image decode methods failed for %s: %w", filePath, err)
	}

	return img, nil
}

func decodeImageFile(filePath string) (image.Image, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	img, format, err := image.Decode(file)
	if err != nil {
		return nil, err
	}

	logging.Debug("Decoded image format: %s for %s", format, filePath)
	return img, nil
}

func (t *ThumbnailGenerator) generateImageWithFFmpeg(filePath string) (image.Image, error) {
	logging.Debug("Using ffmpeg to decode image: %s", filePath)

	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("ffmpeg not found: %w", err)
	}
	logging.Debug("Using ffmpeg: %s", ffmpegPath)

	cmd := exec.Command("ffmpeg",
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
	if err != nil {
		return nil, fmt.Errorf("ffmpeg failed: %v, stderr: %s", err, stderr.String())
	}

	if stdout.Len() == 0 {
		return nil, fmt.Errorf("ffmpeg produced no output for %s", filePath)
	}

	logging.Debug("FFmpeg image output size: %d bytes", stdout.Len())

	img, _, err := image.Decode(&stdout)
	if err != nil {
		return nil, fmt.Errorf("failed to decode ffmpeg output: %w", err)
	}

	return img, nil
}

func (t *ThumbnailGenerator) generateVideoThumbnail(filePath string) (image.Image, error) {
	logging.Debug("Extracting video frame: %s", filePath)

	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("ffmpeg not found: %w", err)
	}
	logging.Debug("Using ffmpeg: %s", ffmpegPath)

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
		logging.Debug("FFmpeg first attempt failed for %s: %v, stderr: %s", filePath, err, stderr.String())

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

	logging.Debug("FFmpeg output size: %d bytes", stdout.Len())

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
		".avif": true, ".jxl": true, ".raw": true, ".cr2": true,
		".nef": true, ".arw": true, ".dng": true,
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

func detectFileType(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	header := make([]byte, 32)
	n, err := file.Read(header)
	if err != nil {
		return "", err
	}
	header = header[:n]

	switch {
	case len(header) >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF:
		return "jpeg", nil

	case len(header) >= 8 && header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47:
		return "png", nil

	case len(header) >= 4 && header[0] == 0x47 && header[1] == 0x49 && header[2] == 0x46 && header[3] == 0x38:
		return "gif", nil

	case len(header) >= 12 && header[0] == 0x52 && header[1] == 0x49 && header[2] == 0x46 && header[3] == 0x46 &&
		header[8] == 0x57 && header[9] == 0x45 && header[10] == 0x42 && header[11] == 0x50:
		return "webp", nil

	case len(header) >= 2 && header[0] == 0x42 && header[1] == 0x4D:
		return "bmp", nil

	case len(header) >= 4 && ((header[0] == 0x49 && header[1] == 0x49 && header[2] == 0x2A && header[3] == 0x00) ||
		(header[0] == 0x4D && header[1] == 0x4D && header[2] == 0x00 && header[3] == 0x2A)):
		return "tiff", nil

	case len(header) >= 12 && header[4] == 0x66 && header[5] == 0x74 && header[6] == 0x79 && header[7] == 0x70:
		brand := string(header[8:12])
		if brand == "heic" || brand == "heix" || brand == "hevc" || brand == "hevx" || brand == "mif1" || brand == "msf1" {
			return "heif", nil
		}
		if brand == "avif" || brand == "avis" {
			return "avif", nil
		}
		return "mp4-container", nil

	case len(header) >= 2 && header[0] == 0xFF && header[1] == 0x0A:
		return "jxl", nil

	case len(header) >= 12 && header[0] == 0x00 && header[1] == 0x00 && header[2] == 0x00 && header[3] == 0x0C &&
		header[4] == 0x4A && header[5] == 0x58 && header[6] == 0x4C && header[7] == 0x20:
		return "jxl", nil
	}

	return "unknown", nil
}
