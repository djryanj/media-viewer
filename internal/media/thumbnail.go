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
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"

	// Image format decoders - required for image.Decode to support these formats
	_ "image/gif"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp" // WebP format support
)

// ThumbnailGenerator generates and caches thumbnail images for media files.
type ThumbnailGenerator struct {
	cacheDir           string
	mediaDir           string
	enabled            bool
	db                 *database.Database
	mu                 sync.Mutex
	generationInterval time.Duration

	// Background generation state
	stopChan        chan struct{}
	generationMu    sync.RWMutex
	isGenerating    atomic.Bool
	generationStats GenerationStats
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

const (
	folderThumbSize    = 200
	folderGridCellSize = 80
	folderGridGap      = 4
	folderGridPadding  = 20
	folderTabHeight    = 25
	maxSearchDepth     = 3

	// Background generation settings
	generationBatchSize  = 50                     // Files per batch
	generationBatchDelay = 100 * time.Millisecond // Delay between batches
	generationInterval   = 6 * time.Hour          // How often to run full generation
)

// NewThumbnailGenerator creates a new ThumbnailGenerator instance.
func NewThumbnailGenerator(cacheDir, mediaDir string, enabled bool, db *database.Database, generationInterval time.Duration) *ThumbnailGenerator {
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
		stopChan:           make(chan struct{}),
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

	// Use PNG extension for folders (transparency support), JPG for others
	hash := md5.Sum([]byte(filePath))
	var cacheKey string
	if fileType == database.FileTypeFolder {
		cacheKey = fmt.Sprintf("%x.png", hash)
	} else {
		cacheKey = fmt.Sprintf("%x.jpg", hash)
	}
	cachePath := filepath.Join(t.cacheDir, cacheKey)

	// Check cache (for all types now, including folders during background generation)
	if data, err := os.ReadFile(cachePath); err == nil {
		return data, nil
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	// Double-check cache after acquiring lock
	if data, err := os.ReadFile(cachePath); err == nil {
		return data, nil
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

	var buf bytes.Buffer

	if fileType == database.FileTypeFolder {
		// Folders use PNG for transparency
		if err := png.Encode(&buf, img); err != nil {
			return nil, fmt.Errorf("failed to encode thumbnail as PNG: %w", err)
		}
	} else {
		// Other types use JPEG
		thumb := imaging.Fit(img, 200, 200, imaging.Lanczos)
		if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 85}); err != nil {
			return nil, fmt.Errorf("failed to encode thumbnail as JPEG: %w", err)
		}
	}

	// Cache the result
	if err := os.WriteFile(cachePath, buf.Bytes(), 0o644); err != nil {
		logging.Warn("Failed to cache thumbnail %s: %v", cachePath, err)
	}

	return buf.Bytes(), nil
}

// =============================================================================
// FOLDER THUMBNAIL GENERATION
// =============================================================================

// Folder colors
var (
	folderBodyColor  = color.RGBA{R: 240, G: 200, B: 100, A: 255} // Main folder body
	folderTabColor   = color.RGBA{R: 220, G: 180, B: 80, A: 255}  // Folder tab (darker)
	folderInnerColor = color.RGBA{R: 250, G: 235, B: 180, A: 255} // Inner area (lighter)
)

func (t *ThumbnailGenerator) generateFolderThumbnail(folderPath string) (image.Image, error) {
	logging.Debug("Generating folder thumbnail: %s", folderPath)

	// Get relative path for database queries
	relativePath := folderPath
	if strings.HasPrefix(folderPath, t.mediaDir) {
		relativePath = strings.TrimPrefix(folderPath, t.mediaDir)
		relativePath = strings.TrimPrefix(relativePath, "/")
	}

	// Find images for the grid
	images := t.findImagesForFolder(relativePath, 4)
	logging.Debug("Found %d images for folder thumbnail", len(images))

	// Create the folder thumbnail
	return t.createFolderThumbnailImage(images)
}

// findImagesForFolder finds up to maxImages images in the folder and its subdirectories
func (t *ThumbnailGenerator) findImagesForFolder(relativePath string, maxImages int) []image.Image {
	// Pre-allocate with expected capacity
	images := make([]image.Image, 0, maxImages)

	if t.db == nil {
		logging.Debug("Database not available for folder thumbnail")
		return images
	}

	// First, try to get images directly from this folder
	mediaFiles, err := t.db.GetMediaFilesInFolder(relativePath, maxImages)
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
		subImages := t.findImagesInSubdirectories(relativePath, additionalNeeded, maxSearchDepth)
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

		img, err := t.generateImageThumbnail(fullPath)
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
func (t *ThumbnailGenerator) findImagesInSubdirectories(parentPath string, maxImages, maxDepth int) []database.MediaFile {
	if maxDepth <= 0 || maxImages <= 0 {
		return nil
	}

	var results []database.MediaFile

	// Get subdirectories using the database
	subfolders, err := t.db.GetSubfolders(parentPath)
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
		mediaFiles, err := t.db.GetMediaFilesInFolder(subfolder.Path, remaining)
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
			subResults := t.findImagesInSubdirectories(subfolder.Path, remaining, maxDepth-1)
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

// =============================================================================
// IMAGE THUMBNAIL GENERATION
// =============================================================================

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

// =============================================================================
// VIDEO THUMBNAIL GENERATION
// =============================================================================

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
	return count, nil
}

// Start begins background thumbnail generation
func (t *ThumbnailGenerator) Start() {
	if !t.enabled {
		logging.Info("Thumbnail generation disabled, skipping background generation")
		return
	}

	go t.backgroundGenerationLoop()
}

// Stop stops background thumbnail generation
func (t *ThumbnailGenerator) Stop() {
	if t.stopChan != nil {
		close(t.stopChan)
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
	t.generationMu.Unlock()

	duration := time.Since(startTime)
	t.generationMu.RLock()
	logging.Info("Thumbnail generation complete in %v: generated %d, skipped %d, failed %d",
		duration,
		t.generationStats.Generated,
		t.generationStats.Skipped,
		t.generationStats.Failed)
	t.generationMu.RUnlock()
}

// processBatch processes a batch of files for thumbnail generation
func (t *ThumbnailGenerator) processBatch(files []database.MediaFile) {
	for _, file := range files {
		t.generationMu.Lock()
		t.generationStats.Processed++
		t.generationStats.CurrentFile = file.Path
		t.generationMu.Unlock()

		// Check if thumbnail already exists
		if t.thumbnailExists(file.Path, file.Type) {
			t.generationMu.Lock()
			t.generationStats.Skipped++
			t.generationMu.Unlock()
			continue
		}

		// Generate thumbnail
		fullPath := filepath.Join(t.mediaDir, file.Path)
		_, err := t.GetThumbnail(fullPath, file.Type)

		t.generationMu.Lock()
		if err != nil {
			t.generationStats.Failed++
			logging.Debug("Failed to generate thumbnail for %s: %v", file.Path, err)
		} else {
			t.generationStats.Generated++
		}
		t.generationMu.Unlock()
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

	// Count cache files and size
	entries, err := os.ReadDir(t.cacheDir)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if strings.HasSuffix(name, ".jpg") || strings.HasSuffix(name, ".png") {
				status.CacheCount++
				if info, err := entry.Info(); err == nil {
					status.CacheSize += info.Size()
				}
			}
		}
	}

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
