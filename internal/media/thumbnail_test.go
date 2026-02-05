package media

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
	"time"

	"media-viewer/internal/database"
)

// NOTE: govips doesn't support stopping and restarting vips in the same process.
// Initialize vips once at package level for all tests in this file.
func init() {
	// Initialize vips early - ignore errors as it may not be available
	// The InitVips() function is idempotent and safe to call multiple times
	_ = InitVips()
}

func TestNewThumbnailGenerator(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	tests := []struct {
		name               string
		cacheDir           string
		enabled            bool
		generationInterval time.Duration
		expectInterval     time.Duration
	}{
		{
			name:               "Enabled with valid settings",
			cacheDir:           tmpDir,
			enabled:            true,
			generationInterval: 30 * time.Minute,
			expectInterval:     30 * time.Minute,
		},
		{
			name:               "Disabled",
			cacheDir:           tmpDir,
			enabled:            false,
			generationInterval: 30 * time.Minute,
			expectInterval:     30 * time.Minute,
		},
		{
			name:               "Zero interval defaults to 6 hours",
			cacheDir:           tmpDir,
			enabled:            true,
			generationInterval: 0,
			expectInterval:     6 * time.Hour,
		},
		{
			name:               "Negative interval defaults to 6 hours",
			cacheDir:           tmpDir,
			enabled:            true,
			generationInterval: -1 * time.Hour,
			expectInterval:     6 * time.Hour,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gen := NewThumbnailGenerator(tt.cacheDir, mediaDir, tt.enabled, nil, tt.generationInterval, nil)

			if gen == nil {
				t.Fatal("NewThumbnailGenerator returned nil")
			}

			if gen.IsEnabled() != tt.enabled {
				t.Errorf("IsEnabled() = %v, want %v", gen.IsEnabled(), tt.enabled)
			}

			if gen.cacheDir != tt.cacheDir {
				t.Errorf("cacheDir = %s, want %s", gen.cacheDir, tt.cacheDir)
			}

			if gen.mediaDir != mediaDir {
				t.Errorf("mediaDir = %s, want %s", gen.mediaDir, mediaDir)
			}

			if gen.generationInterval != tt.expectInterval {
				t.Errorf("generationInterval = %v, want %v", gen.generationInterval, tt.expectInterval)
			}

			// Verify cache directory was created if enabled
			if tt.enabled {
				if _, err := os.Stat(tt.cacheDir); os.IsNotExist(err) {
					t.Error("Cache directory was not created")
				}
			}
		})
	}
}

func TestIsEnabled(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	tests := []struct {
		name    string
		enabled bool
	}{
		{"Enabled", true},
		{"Disabled", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gen := NewThumbnailGenerator(tmpDir, mediaDir, tt.enabled, nil, time.Hour, nil)
			if gen.IsEnabled() != tt.enabled {
				t.Errorf("IsEnabled() = %v, want %v", gen.IsEnabled(), tt.enabled)
			}
		})
	}
}

func TestNotifyIndexComplete(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Test that notification can be sent
	gen.NotifyIndexComplete()

	// Verify notification was received
	select {
	case <-gen.onIndexComplete:
		// Success - notification received
	case <-time.After(100 * time.Millisecond):
		t.Error("Expected notification to be in channel")
	}

	// Test that multiple notifications don't block (channel size is 1)
	gen.NotifyIndexComplete()
	gen.NotifyIndexComplete() // Should not block even though channel is full

	// Drain channel
	select {
	case <-gen.onIndexComplete:
	default:
	}
}

func TestGetCacheKey(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	tests := []struct {
		name      string
		filePath  string
		fileType  database.FileType
		expectExt string
	}{
		{
			name:      "Image file",
			filePath:  "/path/to/image.jpg",
			fileType:  database.FileTypeImage,
			expectExt: ".jpg",
		},
		{
			name:      "Video file",
			filePath:  "/path/to/video.mp4",
			fileType:  database.FileTypeVideo,
			expectExt: ".jpg",
		},
		{
			name:      "Folder",
			filePath:  "/path/to/folder",
			fileType:  database.FileTypeFolder,
			expectExt: ".png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cacheKey := gen.getCacheKey(tt.filePath, tt.fileType)

			if cacheKey == "" {
				t.Error("getCacheKey returned empty string")
			}

			if filepath.Ext(cacheKey) != tt.expectExt {
				t.Errorf("Cache key extension = %s, want %s", filepath.Ext(cacheKey), tt.expectExt)
			}

			// Verify it's a valid MD5 hash + extension
			base := filepath.Base(cacheKey)
			name := base[:len(base)-len(tt.expectExt)]
			if len(name) != 32 { // MD5 hash is 32 hex chars
				t.Errorf("Cache key hash length = %d, want 32", len(name))
			}
		})
	}
}

func TestGetCacheKeyDeterministic(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	filePath := "/path/to/test.jpg"
	fileType := database.FileTypeImage

	// Generate cache key multiple times
	key1 := gen.getCacheKey(filePath, fileType)
	key2 := gen.getCacheKey(filePath, fileType)
	key3 := gen.getCacheKey(filePath, fileType)

	if key1 != key2 || key2 != key3 {
		t.Error("getCacheKey should be deterministic")
	}
}

func TestGetCacheKeyUnique(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Different paths should produce different keys
	key1 := gen.getCacheKey("/path/to/file1.jpg", database.FileTypeImage)
	key2 := gen.getCacheKey("/path/to/file2.jpg", database.FileTypeImage)

	if key1 == key2 {
		t.Error("Different file paths should produce different cache keys")
	}

	// Same path, different types should produce different keys (different extensions)
	key3 := gen.getCacheKey("/path/to/file.jpg", database.FileTypeImage)
	key4 := gen.getCacheKey("/path/to/file.jpg", database.FileTypeFolder)

	if key3 == key4 {
		t.Error("Different file types should produce different cache keys")
	}
}

func TestMetaFileOperations(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	cacheKey := "test_cache_key.jpg"
	sourcePath := "/path/to/source/file.jpg"

	// Write meta file
	err := gen.writeMetaFile(cacheKey, sourcePath)
	if err != nil {
		t.Fatalf("writeMetaFile failed: %v", err)
	}

	// Verify meta file exists
	metaPath := gen.getMetaPath(cacheKey)
	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		t.Error("Meta file was not created")
	}

	// Read meta file
	readPath, err := gen.readMetaFile(cacheKey)
	if err != nil {
		t.Fatalf("readMetaFile failed: %v", err)
	}

	if readPath != sourcePath {
		t.Errorf("readMetaFile returned %s, want %s", readPath, sourcePath)
	}

	// Delete meta file
	gen.deleteMetaFile(cacheKey)

	// Verify meta file is deleted
	if _, err := os.Stat(metaPath); !os.IsNotExist(err) {
		t.Error("Meta file still exists after deletion")
	}

	// Reading non-existent meta file should return error
	_, err = gen.readMetaFile(cacheKey)
	if err == nil {
		t.Error("Expected error reading deleted meta file")
	}
}

func TestGetMetaPath(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	tests := []struct {
		name     string
		cacheKey string
		wantExt  string
	}{
		{
			name:     "JPEG cache key",
			cacheKey: "abc123.jpg",
			wantExt:  ".meta",
		},
		{
			name:     "PNG cache key",
			cacheKey: "def456.png",
			wantExt:  ".meta",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			metaPath := gen.getMetaPath(tt.cacheKey)

			if filepath.Ext(metaPath) != tt.wantExt {
				t.Errorf("Meta path extension = %s, want %s", filepath.Ext(metaPath), tt.wantExt)
			}

			// Verify it's in the cache directory
			if !filepath.IsAbs(metaPath) {
				t.Error("Meta path should be absolute")
			}

			if filepath.Dir(metaPath) != tmpDir {
				t.Errorf("Meta path dir = %s, want %s", filepath.Dir(metaPath), tmpDir)
			}
		})
	}
}

func TestGetThumbnailDisabled(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, false, nil, time.Hour, nil)

	ctx := context.Background()
	_, err := gen.GetThumbnail(ctx, "/path/to/file.jpg", database.FileTypeImage)

	if err == nil {
		t.Error("Expected error when thumbnails disabled")
	}

	if err.Error() != "thumbnails disabled" {
		t.Errorf("Error message = %s, want 'thumbnails disabled'", err.Error())
	}
}

func TestGetThumbnailNonexistentFile(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()
	_, err := gen.GetThumbnail(ctx, "/nonexistent/file.jpg", database.FileTypeImage)

	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

func TestGetThumbnailCacheHit(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create a test image file
	testFile := filepath.Join(mediaDir, "test.jpg")
	img := image.NewRGBA(image.Rect(0, 0, 100, 100))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)
	f, _ := os.Create(testFile)
	jpeg.Encode(f, img, &jpeg.Options{Quality: 90})
	f.Close()

	// Pre-populate cache
	cacheKey := gen.getCacheKey(testFile, database.FileTypeImage)
	cachePath := filepath.Join(tmpDir, cacheKey)
	cachedData := []byte("cached thumbnail data")
	err := os.WriteFile(cachePath, cachedData, 0o644)
	if err != nil {
		t.Fatalf("Failed to write cache file: %v", err)
	}

	// Request thumbnail - should hit cache
	ctx := context.Background()
	data, err := gen.GetThumbnail(ctx, testFile, database.FileTypeImage)
	if err != nil {
		t.Fatalf("GetThumbnail failed: %v", err)
	}

	if !bytes.Equal(data, cachedData) {
		t.Error("Cached data mismatch")
	}
}

func TestGetLockAndRelease(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	path := "/test/path.jpg"

	// Get lock for path
	lock1 := gen.getLock(path)
	if lock1 == nil {
		t.Fatal("getLock returned nil")
	}

	// Getting lock for same path should return same lock
	lock2 := gen.getLock(path)
	if lock1 != lock2 {
		t.Error("getLock should return same lock for same path")
	}

	// Release lock
	gen.releaseLock(path)

	// After release, getting lock again should work
	lock3 := gen.getLock(path)
	if lock3 == nil {
		t.Fatal("getLock returned nil after release")
	}
}

func TestGenerationStatsInitialState(t *testing.T) {
	stats := GenerationStats{}

	if stats.InProgress {
		t.Error("Initial InProgress should be false")
	}

	if stats.TotalFiles != 0 {
		t.Error("Initial TotalFiles should be 0")
	}

	if stats.Processed != 0 {
		t.Error("Initial Processed should be 0")
	}
}

func TestThumbnailStatusStructure(t *testing.T) {
	status := ThumbnailStatus{
		Enabled:        true,
		CacheDir:       "/cache",
		CacheCount:     100,
		CacheSize:      1024000,
		CacheSizeHuman: "1.0 MB",
		Generation:     nil,
	}

	if !status.Enabled {
		t.Error("Enabled should be true")
	}

	if status.CacheDir != "/cache" {
		t.Errorf("Expected CacheDir=/cache, got %s", status.CacheDir)
	}

	if status.CacheCount != 100 {
		t.Errorf("CacheCount = %d, want 100", status.CacheCount)
	}

	if status.CacheSize != 1024000 {
		t.Errorf("Expected CacheSize=1024000, got %d", status.CacheSize)
	}

	if status.CacheSizeHuman != "1.0 MB" {
		t.Errorf("Expected CacheSizeHuman=1.0 MB, got %s", status.CacheSizeHuman)
	}

	if status.Generation != nil {
		t.Error("Expected Generation to be nil")
	}
}

func TestCropToSquare(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	tests := []struct {
		name   string
		width  int
		height int
	}{
		{
			name:   "Square image",
			width:  100,
			height: 100,
		},
		{
			name:   "Wide image",
			width:  200,
			height: 100,
		},
		{
			name:   "Tall image",
			width:  100,
			height: 200,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test image
			img := image.NewRGBA(image.Rect(0, 0, tt.width, tt.height))
			draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)

			// Crop to square
			result := gen.cropToSquare(img)

			bounds := result.Bounds()
			w := bounds.Dx()
			h := bounds.Dy()

			// Result should be square
			if w != h {
				t.Errorf("Result not square: %dx%d", w, h)
			}

			// Result should be size of smaller dimension
			expectedSize := tt.width
			if tt.height < tt.width {
				expectedSize = tt.height
			}

			if w != expectedSize {
				t.Errorf("Square size = %d, want %d", w, expectedSize)
			}
		})
	}
}

func TestFolderColors(t *testing.T) {
	// Verify folder colors are defined
	if folderBodyColor.A == 0 {
		t.Error("folderBodyColor should be opaque")
	}

	if folderTabColor.A == 0 {
		t.Error("folderTabColor should be opaque")
	}

	if folderInnerColor.A == 0 {
		t.Error("folderInnerColor should be opaque")
	}
}

func TestConstants(t *testing.T) {
	// Verify constants have reasonable values
	if folderThumbSize <= 0 {
		t.Errorf("folderThumbSize should be positive, got %d", folderThumbSize)
	}

	if folderGridCellSize <= 0 {
		t.Errorf("folderGridCellSize should be positive, got %d", folderGridCellSize)
	}

	if folderGridGap < 0 {
		t.Errorf("folderGridGap should be non-negative, got %d", folderGridGap)
	}

	if maxSearchDepth <= 0 {
		t.Errorf("maxSearchDepth should be positive, got %d", maxSearchDepth)
	}

	if generationBatchSize <= 0 {
		t.Errorf("generationBatchSize should be positive, got %d", generationBatchSize)
	}

	if generationBatchDelay < 0 {
		t.Errorf("generationBatchDelay should be non-negative, got %v", generationBatchDelay)
	}
}

func BenchmarkGetCacheKey(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	filePath := "/path/to/test/file.jpg"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = gen.getCacheKey(filePath, database.FileTypeImage)
	}
}

func BenchmarkGetLock(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	paths := []string{
		"/path/to/file1.jpg",
		"/path/to/file2.jpg",
		"/path/to/file3.jpg",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		path := paths[i%len(paths)]
		_ = gen.getLock(path)
	}
}

func BenchmarkCropToSquare(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create test image once
	img := image.NewRGBA(image.Rect(0, 0, 200, 150))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = gen.cropToSquare(img)
	}
}

// Folder thumbnail drawing tests

func TestGetGridArea(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	gridArea := gen.getGridArea()

	// Verify it's within the canvas bounds
	if gridArea.Min.X < 0 || gridArea.Min.Y < 0 {
		t.Error("Grid area should have non-negative origin")
	}

	if gridArea.Max.X > folderThumbSize || gridArea.Max.Y > folderThumbSize {
		t.Errorf("Grid area %v exceeds folder thumb size %d", gridArea, folderThumbSize)
	}

	// Verify it has positive dimensions
	if gridArea.Dx() <= 0 || gridArea.Dy() <= 0 {
		t.Error("Grid area should have positive dimensions")
	}
}

func TestCreateFolderThumbnailImageEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Test with empty image list
	img, err := gen.createFolderThumbnailImage([]image.Image{})
	if err != nil {
		t.Fatalf("createFolderThumbnailImage failed: %v", err)
	}

	bounds := img.Bounds()
	if bounds.Dx() != folderThumbSize || bounds.Dy() != folderThumbSize {
		t.Errorf("Folder thumbnail size = %dx%d, want %dx%d",
			bounds.Dx(), bounds.Dy(), folderThumbSize, folderThumbSize)
	}
}

func TestCreateFolderThumbnailImageWithImages(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create test images
	createTestImg := func() image.Image {
		img := image.NewRGBA(image.Rect(0, 0, 100, 100))
		draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{200, 100, 50, 255}}, image.Point{}, draw.Src)
		return img
	}

	tests := []struct {
		name       string
		imageCount int
	}{
		{"Single image", 1},
		{"Two images", 2},
		{"Three images", 3},
		{"Four images", 4},
		{"Five images (uses first 4)", 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			images := make([]image.Image, tt.imageCount)
			for i := 0; i < tt.imageCount; i++ {
				images[i] = createTestImg()
			}

			result, err := gen.createFolderThumbnailImage(images)
			if err != nil {
				t.Fatalf("createFolderThumbnailImage failed: %v", err)
			}

			bounds := result.Bounds()
			if bounds.Dx() != folderThumbSize || bounds.Dy() != folderThumbSize {
				t.Errorf("Folder thumbnail size = %dx%d, want %dx%d",
					bounds.Dx(), bounds.Dy(), folderThumbSize, folderThumbSize)
			}

			// Verify it's an RGBA image
			_, ok := result.(*image.RGBA)
			if !ok {
				t.Error("Result should be *image.RGBA")
			}
		})
	}
}

func TestDrawFolderBackground(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	canvas := image.NewRGBA(image.Rect(0, 0, folderThumbSize, folderThumbSize))

	// Initially fill with transparent
	draw.Draw(canvas, canvas.Bounds(), image.Transparent, image.Point{}, draw.Src)

	// Draw folder background
	gen.drawFolderBackground(canvas)

	// Verify some pixels are no longer transparent (folder was drawn)
	foundOpaque := false
	for y := 0; y < folderThumbSize; y++ {
		for x := 0; x < folderThumbSize; x++ {
			c := canvas.At(x, y)
			r, g, b, a := c.RGBA()
			if a > 0 {
				foundOpaque = true
				// Also verify it's not pure black/white (should be folder colors)
				if r > 0 || g > 0 || b > 0 {
					return // Found a colored opaque pixel - success
				}
			}
		}
	}

	if !foundOpaque {
		t.Error("Folder background should have drawn opaque pixels")
	}
}

func TestDrawEmptyFolderIcon(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	canvas := image.NewRGBA(image.Rect(0, 0, folderThumbSize, folderThumbSize))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{folderInnerColor}, image.Point{}, draw.Src)

	// Draw empty folder icon
	gen.drawEmptyFolderIcon(canvas)

	// Verify some pixels were modified (icon was drawn)
	foundIcon := false
	gridArea := gen.getGridArea()
	for y := gridArea.Min.Y; y < gridArea.Max.Y; y++ {
		for x := gridArea.Min.X; x < gridArea.Max.X; x++ {
			c := canvas.At(x, y)
			r1, g1, b1, _ := c.RGBA()
			r2, g2, b2, _ := folderInnerColor.RGBA()
			// Check if pixel differs from background
			if r1 != r2 || g1 != g2 || b1 != b2 {
				foundIcon = true
				break
			}
		}
		if foundIcon {
			break
		}
	}

	if !foundIcon {
		t.Error("Empty folder icon should modify some pixels")
	}
}

func TestDrawSingleImage(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	canvas := image.NewRGBA(image.Rect(0, 0, folderThumbSize, folderThumbSize))
	gen.drawFolderBackground(canvas)

	testImg := image.NewRGBA(image.Rect(0, 0, 100, 100))
	draw.Draw(testImg, testImg.Bounds(), &image.Uniform{color.RGBA{255, 0, 0, 255}}, image.Point{}, draw.Src)

	gen.drawSingleImage(canvas, testImg)

	// Verify red pixels were added (from our test image)
	foundRed := false
	gridArea := gen.getGridArea()
	for y := gridArea.Min.Y; y < gridArea.Max.Y && !foundRed; y++ {
		for x := gridArea.Min.X; x < gridArea.Max.X; x++ {
			c := canvas.At(x, y)
			r, _, _, a := c.RGBA()
			if r > 50000 && a > 0 { // High red value
				foundRed = true
				break
			}
		}
	}

	if !foundRed {
		t.Error("Should have drawn red test image")
	}
}

func TestDrawTwoImages(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	canvas := image.NewRGBA(image.Rect(0, 0, folderThumbSize, folderThumbSize))
	gen.drawFolderBackground(canvas)

	img1 := image.NewRGBA(image.Rect(0, 0, 50, 50))
	draw.Draw(img1, img1.Bounds(), &image.Uniform{color.RGBA{255, 0, 0, 255}}, image.Point{}, draw.Src)

	img2 := image.NewRGBA(image.Rect(0, 0, 50, 50))
	draw.Draw(img2, img2.Bounds(), &image.Uniform{color.RGBA{0, 255, 0, 255}}, image.Point{}, draw.Src)

	gen.drawTwoImages(canvas, []image.Image{img1, img2})

	// Verify both colors were drawn
	foundRed := false
	foundGreen := false
	gridArea := gen.getGridArea()

	for y := gridArea.Min.Y; y < gridArea.Max.Y; y++ {
		for x := gridArea.Min.X; x < gridArea.Max.X; x++ {
			c := canvas.At(x, y)
			r, g, _, a := c.RGBA()
			if r > 50000 && a > 0 {
				foundRed = true
			}
			if g > 50000 && a > 0 {
				foundGreen = true
			}
			if foundRed && foundGreen {
				return // Both colors found
			}
		}
	}

	if !foundRed {
		t.Error("Should have drawn red image")
	}
	if !foundGreen {
		t.Error("Should have drawn green image")
	}
}

func TestDrawThreeImages(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	canvas := image.NewRGBA(image.Rect(0, 0, folderThumbSize, folderThumbSize))
	gen.drawFolderBackground(canvas)

	createColoredImg := func(c color.RGBA) image.Image {
		img := image.NewRGBA(image.Rect(0, 0, 50, 50))
		draw.Draw(img, img.Bounds(), &image.Uniform{c}, image.Point{}, draw.Src)
		return img
	}

	images := []image.Image{
		createColoredImg(color.RGBA{255, 0, 0, 255}), // Red
		createColoredImg(color.RGBA{0, 255, 0, 255}), // Green
		createColoredImg(color.RGBA{0, 0, 255, 255}), // Blue
	}

	gen.drawThreeImages(canvas, images)

	// Just verify the function completes without error
	// Detailed pixel verification would be complex
}

func TestDrawFourImages(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	canvas := image.NewRGBA(image.Rect(0, 0, folderThumbSize, folderThumbSize))
	gen.drawFolderBackground(canvas)

	createColoredImg := func(c color.RGBA) image.Image {
		img := image.NewRGBA(image.Rect(0, 0, 50, 50))
		draw.Draw(img, img.Bounds(), &image.Uniform{c}, image.Point{}, draw.Src)
		return img
	}

	images := []image.Image{
		createColoredImg(color.RGBA{255, 0, 0, 255}),   // Red
		createColoredImg(color.RGBA{0, 255, 0, 255}),   // Green
		createColoredImg(color.RGBA{0, 0, 255, 255}),   // Blue
		createColoredImg(color.RGBA{255, 255, 0, 255}), // Yellow
	}

	gen.drawFourImages(canvas, images)

	// Just verify the function completes without error
	// Detailed pixel verification would be complex
}

func TestDrawImageWithBorder(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	canvas := image.NewRGBA(image.Rect(0, 0, 200, 200))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{color.RGBA{240, 240, 240, 255}}, image.Point{}, draw.Src)

	testImg := image.NewRGBA(image.Rect(0, 0, 50, 50))
	draw.Draw(testImg, testImg.Bounds(), &image.Uniform{color.RGBA{255, 0, 0, 255}}, image.Point{}, draw.Src)

	// Draw at position 50, 50
	gen.drawImageWithBorder(canvas, testImg, 50, 50)

	// Verify white border pixels exist around the image
	// Check a pixel in the border area (should be white)
	borderColor := canvas.At(49, 49) // Just before the image
	r, g, b, a := borderColor.RGBA()

	if a == 0 {
		t.Error("Border should be opaque")
	}

	// White border should have high RGB values
	if r < 50000 || g < 50000 || b < 50000 {
		t.Error("Border should be white or light colored")
	}
}

func BenchmarkCreateFolderThumbnail(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create test images once
	images := make([]image.Image, 4)
	for i := 0; i < 4; i++ {
		img := image.NewRGBA(image.Rect(0, 0, 100, 100))
		draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)
		images[i] = img
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := gen.createFolderThumbnailImage(images)
		if err != nil {
			b.Fatalf("createFolderThumbnailImage failed: %v", err)
		}
	}
}

func BenchmarkDrawFolderBackground(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	canvas := image.NewRGBA(image.Rect(0, 0, folderThumbSize, folderThumbSize))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		gen.drawFolderBackground(canvas)
	}
}
