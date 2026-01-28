package media

import (
	"bytes"
	"context"
	"crypto/md5"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"

	_ "image/gif" // GIF image support
	_ "image/png"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp" // WebP image support
)

// ThumbnailGenerator generates and caches thumbnail images for media files.
type ThumbnailGenerator struct {
	cacheDir string
	mediaDir string
	enabled  bool
	db       *database.Database
	mu       sync.Mutex
}

// NewThumbnailGenerator creates a new ThumbnailGenerator instance.
func NewThumbnailGenerator(cacheDir, mediaDir string, enabled bool, db *database.Database) *ThumbnailGenerator {
	if enabled {
		logging.Debug("ThumbnailGenerator: enabled, cache dir: %s", cacheDir)
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			logging.Warn("ThumbnailGenerator: failed to create cache dir: %v", err)
		}
	} else {
		logging.Debug("ThumbnailGenerator: disabled")
	}
	return &ThumbnailGenerator{
		cacheDir: cacheDir,
		mediaDir: mediaDir,
		enabled:  enabled,
		db:       db,
	}
}

// IsEnabled returns whether thumbnail generation is enabled.
func (t *ThumbnailGenerator) IsEnabled() bool {
	return t.enabled
}

// GetThumbnail generates or retrieves a cached thumbnail for the given file.
func (t *ThumbnailGenerator) GetThumbnail(filePath string, fileType database.FileType) ([]byte, error) {
	if !t.enabled {
		return nil, fmt.Errorf("thumbnails disabled")
	}

	// Folders don't need file existence check (they're virtual paths)
	if fileType != database.FileTypeFolder {
		if _, err := os.Stat(filePath); err != nil {
			return nil, fmt.Errorf("file not accessible: %w", err)
		}
	}

	hash := md5.Sum([]byte(filePath))
	cacheKey := fmt.Sprintf("%x.jpg", hash)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	// Skip cache for folders (contents may change) or check cache for files
	if fileType != database.FileTypeFolder {
		if data, err := os.ReadFile(cachePath); err == nil {
			logging.Debug("Thumbnail cache hit: %s", filePath)
			return data, nil
		}
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	// Double-check cache after acquiring lock (for non-folders)
	if fileType != database.FileTypeFolder {
		if data, err := os.ReadFile(cachePath); err == nil {
			return data, nil
		}
	}

	logging.Debug("Thumbnail generating: %s (type: %s)", filePath, fileType)

	var img image.Image
	var err error

	switch fileType {
	case database.FileTypeImage:
		img, err = t.generateImageThumbnail(filePath)
	case database.FileTypeVideo:
		img, err = t.generateVideoThumbnail(filePath)
	case database.FileTypeFolder:
		img, err = t.generateFolderThumbnail(filePath)
	case database.FileTypePlaylist, database.FileTypeOther:
		return nil, fmt.Errorf("unsupported file type: %s", fileType)
	}

	if err != nil {
		return nil, fmt.Errorf("thumbnail generation failed: %w", err)
	}

	if img == nil {
		return nil, fmt.Errorf("thumbnail generation returned nil image")
	}

	// For folders, we already have the composite image at the right size
	var thumb image.Image
	if fileType == database.FileTypeFolder {
		thumb = img
	} else {
		thumb = imaging.Fit(img, 200, 200, imaging.Lanczos)
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 80}); err != nil {
		return nil, fmt.Errorf("failed to encode thumbnail: %w", err)
	}

	// Cache the result (including folders - accept potential staleness)
	if err := os.WriteFile(cachePath, buf.Bytes(), 0o644); err != nil {
		logging.Warn("Failed to cache thumbnail %s: %v", cachePath, err)
	} else {
		logging.Debug("Thumbnail cached: %s", cachePath)
	}

	return buf.Bytes(), nil
}

func (t *ThumbnailGenerator) generateFolderThumbnail(folderPath string) (image.Image, error) {
	logging.Debug("=== generateFolderThumbnail START ===")
	logging.Debug("folderPath (raw): %s", folderPath)
	logging.Debug("mediaDir: %s", t.mediaDir)

	// Strip mediaDir prefix to get the relative path for database queries
	relativePath := folderPath
	if strings.HasPrefix(folderPath, t.mediaDir) {
		relativePath = strings.TrimPrefix(folderPath, t.mediaDir)
		relativePath = strings.TrimPrefix(relativePath, "/") // Remove leading slash
	}
	logging.Debug("folderPath (relative): %s", relativePath)

	if t.db == nil {
		logging.Error("database is nil")
		return nil, fmt.Errorf("database not available for folder thumbnail generation")
	}

	// Query for images and videos in this folder using relative path
	mediaFiles, err := t.db.GetMediaFilesInFolder(relativePath, 15) // Increased limit
	if err != nil {
		logging.Error("GetMediaFilesInFolder failed: %v", err)
		return nil, fmt.Errorf("failed to query folder contents: %w", err)
	}

	logging.Debug("GetMediaFilesInFolder returned %d files", len(mediaFiles))

	// Filter to only images and videos
	var candidates []database.MediaFile
	for _, f := range mediaFiles {
		if f.Type == database.FileTypeImage || f.Type == database.FileTypeVideo {
			candidates = append(candidates, f)
		}
	}

	logging.Debug("After filtering: %d candidates", len(candidates))

	if len(candidates) == 0 {
		logging.Debug("No candidates, returning empty folder thumbnail")
		return t.generateEmptyFolderThumbnail()
	}

	// Select up to 6 files deterministically
	selected := t.selectFilesForStack(candidates, relativePath, 6)
	logging.Debug("Selected %d files for stack", len(selected))

	// Generate thumbnails for selected files
	var thumbnails []image.Image
	for _, f := range selected {
		fullPath := filepath.Join(t.mediaDir, f.Path)
		logging.Debug("Processing: %s -> %s", f.Path, fullPath)

		if _, err := os.Stat(fullPath); err != nil {
			logging.Error("File not accessible: %s - %v", fullPath, err)
			continue
		}

		var thumb image.Image
		var err error

		switch f.Type {
		case database.FileTypeImage:
			thumb, err = t.generateImageThumbnail(fullPath)
		case database.FileTypeVideo:
			thumb, err = t.generateVideoThumbnail(fullPath)
		case database.FileTypeFolder, database.FileTypePlaylist, database.FileTypeOther:
			// Skip non-media types (shouldn't happen due to earlier filtering)
			continue
		}

		if err != nil {
			logging.Error("Thumbnail generation failed for %s: %v", fullPath, err)
			continue
		}

		if thumb != nil {
			thumb = imaging.Fit(thumb, 120, 120, imaging.Lanczos)
			thumbnails = append(thumbnails, thumb)
			logging.Debug("Successfully added thumbnail for: %s", f.Name)
		}
	}

	logging.Debug("Total thumbnails generated: %d", len(thumbnails))

	if len(thumbnails) == 0 {
		logging.Debug("No thumbnails generated, returning empty folder thumbnail")
		return t.generateEmptyFolderThumbnail()
	}

	logging.Debug("=== generateFolderThumbnail END - compositing %d thumbnails ===", len(thumbnails))
	return t.compositeStackedThumbnails(thumbnails)
}

func (t *ThumbnailGenerator) selectFilesForStack(files []database.MediaFile, seed string, count int) []database.MediaFile {
	if len(files) <= count {
		return files
	}

	// Sort for deterministic ordering first
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})

	// Create a seeded random generator for consistent selection
	h := md5.Sum([]byte(seed))
	seedInt := int64(h[0])<<56 | int64(h[1])<<48 | int64(h[2])<<40 | int64(h[3])<<32 |
		int64(h[4])<<24 | int64(h[5])<<16 | int64(h[6])<<8 | int64(h[7])
	rng := rand.New(rand.NewSource(seedInt))

	// Shuffle and take first 'count'
	rng.Shuffle(len(files), func(i, j int) {
		files[i], files[j] = files[j], files[i]
	})

	return files[:count]
}

func (t *ThumbnailGenerator) compositeStackedThumbnails(thumbnails []image.Image) (image.Image, error) {
	canvasSize := 200
	canvas := image.NewRGBA(image.Rect(0, 0, canvasSize, canvasSize))

	// Manila folder background color
	manilaColor := color.RGBA{R: 240, G: 220, B: 180, A: 255}
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{manilaColor}, image.Point{}, draw.Src)

	// Draw folder tab at top
	tabColor := color.RGBA{R: 220, G: 195, B: 150, A: 255}
	for y := 0; y < 25; y++ {
		for x := 10; x < 80; x++ {
			canvas.Set(x, y, tabColor)
		}
	}
	// Rounded corner for tab
	for y := 20; y < 25; y++ {
		for x := 75; x < 85; x++ {
			canvas.Set(x, y, tabColor)
		}
	}

	// Stack positions for up to 6 images - spread across the folder
	type stackPosition struct {
		angle   float64
		offsetX int
		offsetY int
	}

	positions := []stackPosition{
		{angle: -15, offsetX: 5, offsetY: 35}, // Back left
		{angle: 12, offsetX: 85, offsetY: 30}, // Back right
		{angle: -8, offsetX: 15, offsetY: 50}, // Middle left
		{angle: 10, offsetX: 70, offsetY: 45}, // Middle right
		{angle: -4, offsetX: 35, offsetY: 55}, // Front left
		{angle: 5, offsetX: 55, offsetY: 60},  // Front center-right
	}

	// Shadow color
	shadowColor := color.RGBA{R: 180, G: 160, B: 120, A: 80}

	// Draw thumbnails - first ones at back, last ones on top
	numThumbs := len(thumbnails)
	for i := 0; i < numThumbs && i < len(positions); i++ {
		pos := positions[i]
		thumb := thumbnails[i]

		// Add white border around thumbnail
		bordered := t.addBorder(thumb, color.White, 3)

		// Rotate the thumbnail
		rotated := imaging.Rotate(bordered, pos.angle, color.Transparent)

		bounds := rotated.Bounds()
		x := pos.offsetX
		y := pos.offsetY

		// Draw shadow
		shadowRect := image.Rect(x+3, y+3, x+bounds.Dx()+3, y+bounds.Dy()+3)
		draw.Draw(canvas, shadowRect, &image.Uniform{shadowColor}, image.Point{}, draw.Over)

		// Draw the rotated thumbnail
		destRect := image.Rect(x, y, x+bounds.Dx(), y+bounds.Dy())
		draw.Draw(canvas, destRect, rotated, bounds.Min, draw.Over)
	}

	// Add subtle folder edge/border
	folderEdge := color.RGBA{R: 200, G: 175, B: 130, A: 255}
	t.drawBorder(canvas, folderEdge, 2)

	return canvas, nil
}

func (t *ThumbnailGenerator) addBorder(img image.Image, borderColor color.Color, width int) image.Image {
	bounds := img.Bounds()
	newWidth := bounds.Dx() + (width * 2)
	newHeight := bounds.Dy() + (width * 2)

	bordered := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))

	// Fill with border color
	draw.Draw(bordered, bordered.Bounds(), &image.Uniform{borderColor}, image.Point{}, draw.Src)

	// Draw original image centered
	destRect := image.Rect(width, width, width+bounds.Dx(), width+bounds.Dy())
	draw.Draw(bordered, destRect, img, bounds.Min, draw.Over)

	return bordered
}

func (t *ThumbnailGenerator) drawBorder(img *image.RGBA, c color.Color, width int) {
	bounds := img.Bounds()
	for i := 0; i < width; i++ {
		// Top and bottom
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			img.Set(x, bounds.Min.Y+i, c)
			img.Set(x, bounds.Max.Y-1-i, c)
		}
		// Left and right
		for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
			img.Set(bounds.Min.X+i, y, c)
			img.Set(bounds.Max.X-1-i, y, c)
		}
	}
}

func (t *ThumbnailGenerator) generateEmptyFolderThumbnail() (image.Image, error) {
	size := 200
	canvas := image.NewRGBA(image.Rect(0, 0, size, size))

	// Manila folder background
	manilaColor := color.RGBA{R: 240, G: 220, B: 180, A: 255}
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{manilaColor}, image.Point{}, draw.Src)

	// Folder tab
	tabColor := color.RGBA{R: 220, G: 195, B: 150, A: 255}
	for y := 0; y < 25; y++ {
		for x := 10; x < 80; x++ {
			canvas.Set(x, y, tabColor)
		}
	}
	for y := 20; y < 25; y++ {
		for x := 75; x < 85; x++ {
			canvas.Set(x, y, tabColor)
		}
	}

	// Draw "empty" indicator - a subtle folder icon in center
	emptyColor := color.RGBA{R: 200, G: 175, B: 130, A: 255}

	// Simple folder outline in center
	for y := 70; y < 140; y++ {
		for x := 50; x < 150; x++ {
			// Border only
			if y < 75 || y > 135 || x < 55 || x > 145 {
				canvas.Set(x, y, emptyColor)
			}
		}
	}
	// Inner folder tab
	for y := 60; y < 70; y++ {
		for x := 50; x < 90; x++ {
			canvas.Set(x, y, emptyColor)
		}
	}

	// Add folder edge border
	folderEdge := color.RGBA{R: 200, G: 175, B: 130, A: 255}
	t.drawBorder(canvas, folderEdge, 2)

	return canvas, nil
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
	defer func() {
		if err := file.Close(); err != nil {
			logging.Warn("failed to close image file %s: %v", filePath, err)
		}
	}()

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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

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
	if err != nil {
		return nil, fmt.Errorf("ffmpeg failed: %w, stderr: %s", err, stderr.String())
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg",
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

		cmd = exec.CommandContext(ctx, "ffmpeg",
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
			return nil, fmt.Errorf("ffmpeg failed: %w, stderr: %s", err, stderr.String())
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

// GetFileType determines the file type based on the file extension.
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
	defer func() {
		if err := file.Close(); err != nil {
			logging.Warn("failed to close file %s: %v", filePath, err)
		}
	}()

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

// InvalidateFolderThumbnail removes the cached thumbnail for a folder
// Call this when folder contents change
func (t *ThumbnailGenerator) InvalidateFolderThumbnail(folderPath string) error {
	if !t.enabled {
		return nil
	}

	hash := md5.Sum([]byte(folderPath))
	cacheKey := fmt.Sprintf("%x.jpg", hash)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	if err := os.Remove(cachePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to invalidate folder thumbnail: %w", err)
	}

	logging.Debug("Invalidated folder thumbnail cache: %s", folderPath)
	return nil
}
