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
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"media-viewer/internal/database"
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

	// Maximum thumbnail workers (absolute cap)
	maxThumbnailWorkers = 8
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
	cacheMetricsMu sync.RWMutex
	lastCacheSize  int64
	lastCacheCount int

	// Per-file locks to allow parallel generation of different files
	fileLocks sync.Map // map[string]*sync.Mutex
}

// thumbnailResult holds the result of a thumbnail generation attempt
type thumbnailResult struct {
	path    string
	skipped bool
	err     error
}

// RebuildProgress tracks thumbnail rebuild progress
type RebuildProgress struct {
	InProgress  bool      `json:"inProgress"`
	StartedAt   time.Time `json:"startedAt,omitempty"`
	TotalFiles  int       `json:"totalFiles"`
	Processed   int       `json:"processed"`
	Succeeded   int       `json:"succeeded"`
	Failed      int       `json:"failed"`
	CurrentFile string    `json:"currentFile,omitempty"`
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

// GenerationStats tracks thumbnail generation progress
type GenerationStats struct {
	InProgress    bool      `json:"inProgress"`
	StartedAt     time.Time `json:"startedAt,omitempty"`
	LastCompleted time.Time `json:"lastCompleted,omitempty"`
	TotalFiles    int       `json:"totalFiles"`
	Processed     int       `json:"processed"`
	Generated     int       `json:"generated"`
	Skipped       int       `json:"skipped"`
	Failed        int       `json:"failed"`
	CurrentFile   string    `json:"currentFile,omitempty"`
}

// NewThumbnailGenerator creates a new ThumbnailGenerator instance.
func NewThumbnailGenerator(cacheDir, mediaDir string, enabled bool, db *database.Database, generationInterval time.Duration, memMonitor *memory.Monitor) *ThumbnailGenerator {
	if enabled {
		logging.Debug("ThumbnailGenerator: enabled, cache dir: %s", cacheDir)
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			logging.Warn("ThumbnailGenerator: failed to create cache dir: %v", err)
		}
	} else {
		logging.Debug("ThumbnailGenerator: disabled")
	}

	// Default to 6 hours if not specified
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
	}
}

// IsEnabled returns whether thumbnail generation is enabled.
func (t *ThumbnailGenerator) IsEnabled() bool {
	return t.enabled
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

// GetThumbnail generates or retrieves a cached thumbnail for the given file.
func (t *ThumbnailGenerator) GetThumbnail(ctx context.Context, filePath string, fileType database.FileType) ([]byte, error) {
	if !t.enabled {
		return nil, fmt.Errorf("thumbnails disabled")
	}

	start := time.Now()
	fileTypeStr := string(fileType)

	// Folders don't need file existence check (they're virtual paths)
	if fileType != database.FileTypeFolder {
		if _, err := os.Stat(filePath); err != nil {
			metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_not_found").Inc()
			return nil, fmt.Errorf("file not accessible: %w", err)
		}
	}

	// Use PNG extension for folders (transparency support), JPG for others
	hash := md5.Sum([]byte(filePath))
	var cacheKey string
	if fileType == database.FileTypeFolder {
		cacheKey = fmt.Sprintf("%x.png", hash)
	} else {
		cacheKey = fmt.Sprintf("%x.jpg", hash)
	}
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	// Check cache first (no lock needed for read)
	if data, err := os.ReadFile(cachePath); err == nil {
		metrics.ThumbnailCacheHits.Inc()
		return data, nil
	}
	metrics.ThumbnailCacheMisses.Inc()

	// Get per-file lock (allows parallel generation of different files)
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

	var img image.Image
	var err error

	switch fileType {
	case database.FileTypeImage:
		img, err = t.generateImageThumbnail(ctx, filePath)
	case database.FileTypeVideo:
		img, err = t.generateVideoThumbnail(ctx, filePath)
	case database.FileTypeFolder:
		img, err = t.generateFolderThumbnail(ctx, filePath)
	case database.FileTypePlaylist, database.FileTypeOther:
		metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_unsupported").Inc()
		return nil, fmt.Errorf("unsupported file type: %s", fileType)
	}

	if err != nil {
		metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error").Inc()
		return nil, fmt.Errorf("thumbnail generation failed: %w", err)
	}

	if img == nil {
		metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_nil").Inc()
		return nil, fmt.Errorf("thumbnail generation returned nil image")
	}

	var buf bytes.Buffer

	if fileType == database.FileTypeFolder {
		// Folders use PNG for transparency
		if err := png.Encode(&buf, img); err != nil {
			metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_encode").Inc()
			return nil, fmt.Errorf("failed to encode thumbnail as PNG: %w", err)
		}
	} else {
		// Other types use JPEG
		thumb := imaging.Fit(img, 200, 200, imaging.Lanczos)
		if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 85}); err != nil {
			metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "error_encode").Inc()
			return nil, fmt.Errorf("failed to encode thumbnail as JPEG: %w", err)
		}
	}

	// Cache the result
	if err := os.WriteFile(cachePath, buf.Bytes(), 0o644); err != nil {
		logging.Warn("Failed to cache thumbnail %s: %v", cachePath, err)
		// Don't fail the request, just log the warning
	}

	// Record success metrics
	metrics.ThumbnailGenerationsTotal.WithLabelValues(fileTypeStr, "success").Inc()
	metrics.ThumbnailGenerationDuration.WithLabelValues(fileTypeStr).Observe(time.Since(start).Seconds())

	return buf.Bytes(), nil
}

// Folder colors
var (
	folderBodyColor  = color.RGBA{R: 240, G: 200, B: 100, A: 255} // Main folder body
	folderTabColor   = color.RGBA{R: 220, G: 180, B: 80, A: 255}  // Folder tab (darker)
	folderInnerColor = color.RGBA{R: 250, G: 235, B: 180, A: 255} // Inner area (lighter)
)

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

// findImagesForFolder finds up to maxImages images in the folder and its subdirectories
func (t *ThumbnailGenerator) findImagesForFolder(ctx context.Context, relativePath string, maxImages int) []image.Image {
	// Pre-allocate with expected capacity
	images := make([]image.Image, 0, maxImages)

	if t.db == nil {
		logging.Debug("Database not available for folder thumbnail")
		return images
	}

	// First, try to get images directly from this folder
	mediaFiles, err := t.db.GetMediaFilesInFolder(ctx, relativePath, maxImages)
	if err != nil {
		logging.Error("GetMediaFilesInFolder failed: %v", err)
		return images
	}

	// Filter to only images
	var candidates []database.MediaFile
	for _, f := range mediaFiles {
		if f.Type == database.FileTypeImage {
			candidates = append(candidates, f)
		}
	}

	logging.Debug("Found %d images directly in folder %s", len(candidates), relativePath)

	// If we don't have enough, search subdirectories
	if len(candidates) < maxImages {
		additionalNeeded := maxImages - len(candidates)
		subImages := t.findImagesInSubdirectories(ctx, relativePath, additionalNeeded, maxSearchDepth)
		candidates = append(candidates, subImages...)
		logging.Debug("Found %d additional images from subdirectories", len(subImages))
	}

	// Limit to maxImages
	if len(candidates) > maxImages {
		candidates = candidates[:maxImages]
	}

	// Generate thumbnails for each candidate
	for _, f := range candidates {
		fullPath := filepath.Join(t.mediaDir, f.Path)

		img, err := t.generateImageThumbnail(ctx, fullPath)
		if err != nil {
			logging.Debug("Failed to generate thumbnail for %s: %v", f.Path, err)
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

// findImagesInSubdirectories recursively searches for images in subdirectories
func (t *ThumbnailGenerator) findImagesInSubdirectories(ctx context.Context, parentPath string, maxImages, maxDepth int) []database.MediaFile {
	if maxDepth <= 0 || maxImages <= 0 {
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
		if len(results) >= maxImages {
			break
		}

		// Get images from this subfolder
		remaining := maxImages - len(results)
		mediaFiles, err := t.db.GetMediaFilesInFolder(ctx, subfolder.Path, remaining)
		if err != nil {
			logging.Debug("Failed to get media files from %s: %v", subfolder.Path, err)
			continue
		}

		for _, f := range mediaFiles {
			if f.Type == database.FileTypeImage {
				results = append(results, f)
				if len(results) >= maxImages {
					break
				}
			}
		}

		// If still need more, recurse into this subfolder
		if len(results) < maxImages {
			remaining = maxImages - len(results)
			subResults := t.findImagesInSubdirectories(ctx, subfolder.Path, remaining, maxDepth-1)
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
		// Landscape - crop sides
		offset := (width - height) / 2
		cropRect = image.Rect(offset, 0, offset+height, height)
	} else {
		// Portrait - crop top and bottom
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

	// Size the image to fit nicely (not too big)
	imgSize := min(gridWidth, gridHeight) * 3 / 4
	resized := imaging.Resize(img, imgSize, imgSize, imaging.Lanczos)

	// Center it
	x := gridArea.Min.X + (gridWidth-imgSize)/2
	y := gridArea.Min.Y + (gridHeight-imgSize)/2

	t.drawImageWithBorder(canvas, resized, x, y)
}

// drawTwoImages draws two images side by side
func (t *ThumbnailGenerator) drawTwoImages(canvas *image.RGBA, images []image.Image) {
	gridArea := t.getGridArea()
	gridWidth := gridArea.Dx()
	gridHeight := gridArea.Dy()

	// Calculate image size (fit two with a gap)
	imgSize := (gridWidth - folderGridGap) / 2
	if imgSize > gridHeight*3/4 {
		imgSize = gridHeight * 3 / 4
	}

	// Resize images
	img1 := imaging.Resize(images[0], imgSize, imgSize, imaging.Lanczos)
	img2 := imaging.Resize(images[1], imgSize, imgSize, imaging.Lanczos)

	// Center vertically
	y := gridArea.Min.Y + (gridHeight-imgSize)/2

	// Position horizontally with gap
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

	// Calculate image size for 2x2 grid layout
	imgSize := (min(gridWidth, gridHeight) - folderGridGap) / 2

	// Resize all images
	resized := make([]image.Image, 3)
	for i := 0; i < 3; i++ {
		resized[i] = imaging.Resize(images[i], imgSize, imgSize, imaging.Lanczos)
	}

	// Calculate positions
	totalWidth := imgSize*2 + folderGridGap
	totalHeight := imgSize*2 + folderGridGap
	startX := gridArea.Min.X + (gridWidth-totalWidth)/2
	startY := gridArea.Min.Y + (gridHeight-totalHeight)/2

	// Top row - 2 images
	t.drawImageWithBorder(canvas, resized[0], startX, startY)
	t.drawImageWithBorder(canvas, resized[1], startX+imgSize+folderGridGap, startY)

	// Bottom row - 1 centered image
	bottomY := startY + imgSize + folderGridGap
	centerX := gridArea.Min.X + (gridWidth-imgSize)/2
	t.drawImageWithBorder(canvas, resized[2], centerX, bottomY)
}

// drawFourImages draws four images in a 2x2 grid
func (t *ThumbnailGenerator) drawFourImages(canvas *image.RGBA, images []image.Image) {
	gridArea := t.getGridArea()
	gridWidth := gridArea.Dx()
	gridHeight := gridArea.Dy()

	// Calculate image size for 2x2 grid
	imgSize := (min(gridWidth, gridHeight) - folderGridGap) / 2

	// Resize all images
	resized := make([]image.Image, 4)
	for i := 0; i < 4; i++ {
		resized[i] = imaging.Resize(images[i], imgSize, imgSize, imaging.Lanczos)
	}

	// Calculate starting position to center the grid
	totalWidth := imgSize*2 + folderGridGap
	totalHeight := imgSize*2 + folderGridGap
	startX := gridArea.Min.X + (gridWidth-totalWidth)/2
	startY := gridArea.Min.Y + (gridHeight-totalHeight)/2

	// Draw 2x2 grid
	// Top left
	t.drawImageWithBorder(canvas, resized[0], startX, startY)
	// Top right
	t.drawImageWithBorder(canvas, resized[1], startX+imgSize+folderGridGap, startY)
	// Bottom left
	t.drawImageWithBorder(canvas, resized[2], startX, startY+imgSize+folderGridGap)
	// Bottom right
	t.drawImageWithBorder(canvas, resized[3], startX+imgSize+folderGridGap, startY+imgSize+folderGridGap)
}

// drawImageWithBorder draws an image with a subtle border/shadow
func (t *ThumbnailGenerator) drawImageWithBorder(canvas *image.RGBA, img image.Image, x, y int) {
	bounds := img.Bounds()
	imgWidth := bounds.Dx()
	imgHeight := bounds.Dy()

	// Draw shadow (1 pixel offset)
	shadowColor := color.RGBA{R: 100, G: 80, B: 40, A: 80}
	shadowRect := image.Rect(x+2, y+2, x+imgWidth+2, y+imgHeight+2)
	draw.Draw(canvas, shadowRect, &image.Uniform{shadowColor}, image.Point{}, draw.Over)

	// Draw white border
	borderWidth := 2
	borderRect := image.Rect(x-borderWidth, y-borderWidth, x+imgWidth+borderWidth, y+imgHeight+borderWidth)
	draw.Draw(canvas, borderRect, &image.Uniform{color.White}, image.Point{}, draw.Over)

	// Draw the image
	destRect := image.Rect(x, y, x+imgWidth, y+imgHeight)
	draw.Draw(canvas, destRect, img, bounds.Min, draw.Over)
}

// drawEmptyFolderIcon draws an icon indicating an empty folder
func (t *ThumbnailGenerator) drawEmptyFolderIcon(canvas *image.RGBA) {
	gridArea := t.getGridArea()
	centerX := gridArea.Min.X + gridArea.Dx()/2
	centerY := gridArea.Min.Y + gridArea.Dy()/2

	// Draw a simple "empty" indicator - a small folder outline
	iconSize := 40
	iconColor := color.RGBA{R: 180, G: 150, B: 100, A: 220}

	// Folder outline
	x := centerX - iconSize/2
	y := centerY - iconSize/2

	// Draw folder shape outline
	// Tab
	for i := 0; i < iconSize/3; i++ {
		canvas.Set(x+i, y, iconColor)
		canvas.Set(x+i, y+1, iconColor)
	}
	// Tab diagonal
	canvas.Set(x+iconSize/3, y+2, iconColor)
	canvas.Set(x+iconSize/3+1, y+3, iconColor)

	// Body outline
	for i := 0; i < iconSize; i++ {
		// Top
		canvas.Set(x+i, y+4, iconColor)
		// Bottom
		canvas.Set(x+i, y+iconSize-1, iconColor)
	}
	for i := 4; i < iconSize; i++ {
		// Left
		canvas.Set(x, y+i, iconColor)
		// Right
		canvas.Set(x+iconSize-1, y+i, iconColor)
	}

	// Draw "empty" dots
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

func (t *ThumbnailGenerator) generateImageThumbnail(ctx context.Context, filePath string) (image.Image, error) {
	logging.Debug("Opening image: %s", filePath)

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

	// Try standard imaging library
	img, err = imaging.Open(filePath, imaging.AutoOrientation(true))
	if err == nil {
		return img, nil
	}

	logging.Debug("imaging.Open failed for %s: %v, trying ffmpeg fallback", filePath, err)

	// FFmpeg fallback
	img, err = t.generateImageWithFFmpeg(ctx, filePath)
	if err != nil {
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

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
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

func (t *ThumbnailGenerator) generateVideoThumbnail(ctx context.Context, filePath string) (image.Image, error) {
	logging.Debug("Extracting video frame: %s", filePath)

	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("ffmpeg not found: %w", err)
	}
	logging.Debug("Using ffmpeg: %s", ffmpegPath)

	// Use passed context with timeout
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
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

		// Reset context timeout for retry
		ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
		defer cancel()

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

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

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

// InvalidateThumbnail removes the cached thumbnail for a specific path
func (t *ThumbnailGenerator) InvalidateThumbnail(filePath string) error {
	if !t.enabled {
		return nil
	}

	hash := md5.Sum([]byte(filePath))

	extensions := []string{".jpg", ".png"}
	deleted := false

	for _, ext := range extensions {
		cacheKey := fmt.Sprintf("%x%s", hash, ext)
		cachePath := filepath.Join(t.cacheDir, cacheKey)

		err := os.Remove(cachePath)
		if err == nil {
			deleted = true
			logging.Debug("Deleted cached thumbnail: %s", cachePath)
		} else if !os.IsNotExist(err) {
			logging.Warn("Failed to delete thumbnail %s: %v", cachePath, err)
		}
	}

	if deleted {
		logging.Debug("Invalidated thumbnail cache for: %s", filePath)
		// Update cache metrics after invalidation
		t.UpdateCacheMetrics()
	}

	return nil
}

// InvalidateAll removes all cached thumbnails and returns the count of deleted files
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
		if !strings.HasSuffix(name, ".jpg") && !strings.HasSuffix(name, ".png") {
			continue
		}

		cachePath := filepath.Join(t.cacheDir, name)
		if err := os.Remove(cachePath); err != nil && !os.IsNotExist(err) {
			logging.Warn("Failed to delete cached thumbnail %s: %v", name, err)
			continue
		}
		count++
	}

	logging.Info("Invalidated %d cached thumbnails", count)

	// Update cache metrics after invalidation
	t.UpdateCacheMetrics()

	return count, nil
}

// =============================================================================
// CACHE METRICS
// =============================================================================

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
		if !strings.HasSuffix(name, ".jpg") && !strings.HasSuffix(name, ".png") {
			continue
		}

		cacheCount++
		if info, err := entry.Info(); err == nil {
			cacheSize += info.Size()
		}
	}

	// Update cached values
	t.cacheMetricsMu.Lock()
	t.lastCacheSize = cacheSize
	t.lastCacheCount = cacheCount
	t.cacheMetricsMu.Unlock()

	// Update Prometheus metrics
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

// =============================================================================
// BACKGROUND GENERATION
// =============================================================================

// Start begins background thumbnail generation
func (t *ThumbnailGenerator) Start() {
	if !t.enabled {
		logging.Info("Thumbnail generation disabled, skipping background generation")
		return
	}

	// Update cache metrics immediately on startup
	logging.Info("Initializing thumbnail cache metrics...")
	t.UpdateCacheMetrics()

	// Start background loops
	go t.backgroundGenerationLoop()
	go t.cacheMetricsLoop()
}

// Stop stops background thumbnail generation
func (t *ThumbnailGenerator) Stop() {
	if t.stopChan != nil {
		close(t.stopChan)
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

// backgroundGenerationLoop runs periodic thumbnail generation
func (t *ThumbnailGenerator) backgroundGenerationLoop() {
	// Wait a bit for initial indexing to complete
	initialDelay := 30 * time.Second
	logging.Info("Thumbnail generator will start in %v (regeneration interval: %v)", initialDelay, t.generationInterval)

	select {
	case <-time.After(initialDelay):
	case <-t.stopChan:
		return
	}

	// Run initial generation
	t.runGeneration()

	// Set up periodic regeneration using configured interval
	ticker := time.NewTicker(t.generationInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			logging.Info("Starting periodic thumbnail generation")
			t.runGeneration()
		case <-t.stopChan:
			logging.Info("Thumbnail generator stopped")
			return
		}
	}
}

// runGeneration performs a full thumbnail generation pass
func (t *ThumbnailGenerator) runGeneration() {
	if !t.enabled || t.db == nil {
		return
	}

	// Check if already running
	if t.isGenerating.Load() {
		logging.Info("Thumbnail generation already in progress, skipping")
		return
	}

	t.isGenerating.Store(true)
	defer t.isGenerating.Store(false)

	startTime := time.Now()
	logging.Info("Starting background thumbnail generation...")

	metrics.ThumbnailGeneratorRunning.Set(1)
	defer metrics.ThumbnailGeneratorRunning.Set(0)

	// Reset stats
	t.generationMu.Lock()
	t.generationStats = GenerationStats{
		InProgress: true,
		StartedAt:  startTime,
	}
	t.generationMu.Unlock()

	// Get all files that need thumbnails, ordered by path depth (root first)
	files, err := t.db.GetAllMediaFilesForThumbnails()
	if err != nil {
		logging.Error("Failed to get files for thumbnail generation: %v", err)
		t.generationMu.Lock()
		t.generationStats.InProgress = false
		t.generationMu.Unlock()
		return
	}

	t.generationMu.Lock()
	t.generationStats.TotalFiles = len(files)
	t.generationMu.Unlock()

	logging.Info("Processing %d files for thumbnail generation", len(files))

	// Process in batches
	for i := 0; i < len(files); i += generationBatchSize {
		// Check for stop signal
		select {
		case <-t.stopChan:
			logging.Info("Thumbnail generation stopped by signal")
			t.generationMu.Lock()
			t.generationStats.InProgress = false
			t.generationMu.Unlock()
			return
		default:
		}

		end := i + generationBatchSize
		if end > len(files) {
			end = len(files)
		}

		batch := files[i:end]
		t.processBatch(batch)

		// Small delay between batches to avoid overwhelming the system
		time.Sleep(generationBatchDelay)

		// Log progress periodically
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

	// Mark complete
	t.generationMu.Lock()
	t.generationStats.InProgress = false
	t.generationStats.LastCompleted = time.Now()
	t.generationStats.CurrentFile = ""
	stats := t.generationStats // Copy for logging
	t.generationMu.Unlock()

	duration := time.Since(startTime)
	logging.Info("Thumbnail generation complete in %v: generated %d, skipped %d, failed %d",
		duration,
		stats.Generated,
		stats.Skipped,
		stats.Failed)

	// Update cache metrics after generation completes
	t.UpdateCacheMetrics()

	// Record generation metrics
	metrics.ThumbnailGenerationBatchComplete.WithLabelValues("full").Inc()
	metrics.ThumbnailGenerationLastDuration.Set(duration.Seconds())
	metrics.ThumbnailGenerationLastTimestamp.Set(float64(time.Now().Unix()))
}

// processBatch processes a batch of files for thumbnail generation using parallel workers
func (t *ThumbnailGenerator) processBatch(files []database.MediaFile) {
	if len(files) == 0 {
		return
	}

	// Get base worker count
	numWorkers := workers.ForMixed(maxThumbnailWorkers)

	// Reduce workers if memory is under pressure
	if t.memoryMonitor != nil && t.memoryMonitor.ShouldThrottle() {
		numWorkers = max(1, numWorkers/2)
		logging.Info("Memory pressure detected, reducing thumbnail workers to %d", numWorkers)
	}

	if numWorkers > len(files) {
		numWorkers = len(files)
	}

	logging.Debug("Processing thumbnail batch with %d workers", numWorkers)

	// Channels for work distribution
	jobs := make(chan database.MediaFile, len(files))
	results := make(chan thumbnailResult, len(files))

	// Start workers
	var wg sync.WaitGroup
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go t.thumbnailWorker(i, jobs, results, &wg)
	}

	// Send jobs in a goroutine
	go func() {
		defer close(jobs)

		for _, file := range files {
			select {
			case jobs <- file:
				// Job sent successfully
			case <-t.stopChan:
				return // Exit the goroutine entirely
			}
		}
	}()

	// Wait for workers in background and close results
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
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

// thumbnailWorker processes thumbnail generation jobs.
func (t *ThumbnailGenerator) thumbnailWorker(workerID int, jobs <-chan database.MediaFile, results chan<- thumbnailResult, wg *sync.WaitGroup) {
	defer wg.Done()

	logging.Debug("Thumbnail worker %d started", workerID)
	defer logging.Debug("Thumbnail worker %d stopped", workerID)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		select {
		case <-t.stopChan:
			cancel()
		case <-ctx.Done():
		}
	}()

	for file := range jobs {
		// Check for stop signal
		select {
		case <-t.stopChan:
			return
		default:
		}

		// Wait if memory is critical
		if t.memoryMonitor != nil && !t.memoryMonitor.WaitIfPaused() {
			return // Stop signal received while waiting
		}

		// Update current file being processed
		t.generationMu.Lock()
		t.generationStats.CurrentFile = file.Path
		t.generationMu.Unlock()

		// Check if thumbnail already exists
		if t.thumbnailExists(file.Path, file.Type) {
			results <- thumbnailResult{path: file.Path, skipped: true, err: errSkipped}
			continue
		}

		// Generate thumbnail
		fullPath := filepath.Join(t.mediaDir, file.Path)
		_, err := t.GetThumbnail(ctx, fullPath, file.Type)

		results <- thumbnailResult{
			path:    file.Path,
			skipped: false,
			err:     err,
		}

		// If memory is under pressure, trigger GC after each image
		if t.memoryMonitor != nil && t.memoryMonitor.ShouldThrottle() {
			runtime.GC()
		}
	}
}

// thumbnailExists checks if a thumbnail already exists in the cache
func (t *ThumbnailGenerator) thumbnailExists(filePath string, fileType database.FileType) bool {
	fullPath := filepath.Join(t.mediaDir, filePath)
	hash := md5.Sum([]byte(fullPath))

	var ext string
	if fileType == database.FileTypeFolder {
		ext = ".png"
	} else {
		ext = ".jpg"
	}

	cacheKey := fmt.Sprintf("%x%s", hash, ext)
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	_, err := os.Stat(cachePath)
	return err == nil
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

	// Use cached metrics for quick response
	t.cacheMetricsMu.RLock()
	status.CacheCount = t.lastCacheCount
	status.CacheSize = t.lastCacheSize
	t.cacheMetricsMu.RUnlock()

	status.CacheSizeHuman = formatBytes(status.CacheSize)

	// Include generation stats
	t.generationMu.RLock()
	stats := t.generationStats
	t.generationMu.RUnlock()
	status.Generation = &stats

	return status
}

// TriggerGeneration manually triggers a thumbnail generation run
func (t *ThumbnailGenerator) TriggerGeneration() {
	go t.runGeneration()
}

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

	t.TriggerGeneration()
}
