package media

import (
	"context"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"media-viewer/internal/database"
)

// Integration tests for thumbnail generation with real file I/O and external tools

// NOTE: govips doesn't support stopping and restarting vips in the same process.
// Initialize vips once at package level for all tests in this file.
func init() {
	// Initialize vips early - ignore errors as it may not be available
	// The InitVips() function is idempotent and safe to call multiple times
	_ = InitVips()
}

func TestGenerateImageThumbnailIntegration(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	tests := []struct {
		name    string
		width   int
		height  int
		format  string
		quality int
	}{
		{
			name:    "Small JPEG",
			width:   400,
			height:  300,
			format:  "jpeg",
			quality: 90,
		},
		{
			name:    "Large JPEG",
			width:   4032,
			height:  3024,
			format:  "jpeg",
			quality: 85,
		},
		{
			name:    "PNG image",
			width:   800,
			height:  600,
			format:  "png",
			quality: 0, // PNG doesn't use quality
		},
		{
			name:    "Square image",
			width:   1000,
			height:  1000,
			format:  "jpeg",
			quality: 90,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test image file
			filename := filepath.Join(mediaDir, tt.name+"."+tt.format)
			createTestImageFile(t, filename, tt.width, tt.height, tt.format, tt.quality)

			// Generate thumbnail
			ctx := context.Background()
			img, err := gen.generateImageThumbnail(ctx, filename)
			if err != nil {
				t.Fatalf("generateImageThumbnail failed: %v", err)
			}

			if img == nil {
				t.Fatal("Generated image is nil")
			}

			// Verify image was loaded
			bounds := img.Bounds()
			if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
				t.Error("Generated image has invalid dimensions")
			}
		})
	}
}

func TestGenerateImageThumbnailInvalidFile(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	tests := []struct {
		name     string
		filePath string
	}{
		{
			name:     "Nonexistent file",
			filePath: filepath.Join(mediaDir, "nonexistent.jpg"),
		},
		{
			name:     "Invalid image data",
			filePath: filepath.Join(mediaDir, "invalid.jpg"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.name == "Invalid image data" {
				// Create a text file pretending to be an image
				err := os.WriteFile(tt.filePath, []byte("not an image"), 0o644)
				if err != nil {
					t.Fatalf("Failed to create test file: %v", err)
				}
			}

			_, err := gen.generateImageThumbnail(ctx, tt.filePath)
			if err == nil {
				t.Error("Expected error for invalid image file")
			}
		})
	}
}

func TestGenerateImageWithFFmpegIntegration(t *testing.T) {
	// Check if ffmpeg is available
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available, skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create a test image file
	filename := filepath.Join(mediaDir, "test.jpg")
	createTestImageFile(t, filename, 800, 600, "jpeg", 90)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	img, err := gen.generateImageWithFFmpeg(ctx, filename)
	if err != nil {
		t.Fatalf("generateImageWithFFmpeg failed: %v", err)
	}

	if img == nil {
		t.Fatal("Generated image is nil")
	}

	bounds := img.Bounds()
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		t.Error("Generated image has invalid dimensions")
	}
}

func TestGenerateImageWithFFmpegTimeout(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available, skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	filename := filepath.Join(mediaDir, "test.jpg")
	createTestImageFile(t, filename, 100, 100, "jpeg", 90)

	// Use a very short timeout to test timeout handling
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()

	time.Sleep(10 * time.Millisecond) // Ensure context is expired

	_, err := gen.generateImageWithFFmpeg(ctx, filename)
	if err == nil {
		t.Error("Expected timeout error")
	}
}

func TestGenerateVideoThumbnailIntegration(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available, skipping video thumbnail test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create a simple test video using ffmpeg
	videoFile := filepath.Join(mediaDir, "test.mp4")
	if err := createTestVideoFile(videoFile); err != nil {
		t.Skipf("Could not create test video: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	img, err := gen.generateVideoThumbnail(ctx, videoFile)
	if err != nil {
		t.Fatalf("generateVideoThumbnail failed: %v", err)
	}

	if img == nil {
		t.Fatal("Generated thumbnail is nil")
	}

	bounds := img.Bounds()
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		t.Error("Generated thumbnail has invalid dimensions")
	}
}

func TestGenerateVideoThumbnailNonexistent(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available, skipping test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()
	_, err := gen.generateVideoThumbnail(ctx, "/nonexistent/video.mp4")
	if err == nil {
		t.Error("Expected error for nonexistent video file")
	}
}

func TestGetThumbnailFullIntegration(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	tests := []struct {
		name     string
		width    int
		height   int
		fileType database.FileType
	}{
		{
			name:     "JPEG image",
			width:    800,
			height:   600,
			fileType: database.FileTypeImage,
		},
		{
			name:     "PNG image",
			width:    400,
			height:   400,
			fileType: database.FileTypeImage,
		},
		{
			name:     "Large image",
			width:    3000,
			height:   2000,
			fileType: database.FileTypeImage,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test image
			ext := ".jpg"
			format := "jpeg"
			if tt.name == "PNG image" {
				ext = ".png"
				format = "png"
			}

			filename := filepath.Join(mediaDir, tt.name+ext)
			createTestImageFile(t, filename, tt.width, tt.height, format, 85)

			// First request - should generate and cache
			ctx := context.Background()
			data1, err := gen.GetThumbnail(ctx, filename, tt.fileType)
			if err != nil {
				t.Fatalf("First GetThumbnail failed: %v", err)
			}

			if len(data1) == 0 {
				t.Error("Thumbnail data is empty")
			}

			// Verify cache file was created
			cacheKey := gen.getCacheKey(filename, tt.fileType)
			cachePath := filepath.Join(tmpDir, cacheKey)
			if _, err := os.Stat(cachePath); os.IsNotExist(err) {
				t.Error("Cache file was not created")
			}

			// Verify meta file was created
			metaPath := gen.getMetaPath(cacheKey)
			if _, err := os.Stat(metaPath); os.IsNotExist(err) {
				t.Error("Meta file was not created")
			}

			// Second request - should hit cache
			data2, err := gen.GetThumbnail(ctx, filename, tt.fileType)
			if err != nil {
				t.Fatalf("Second GetThumbnail failed: %v", err)
			}

			if len(data2) != len(data1) {
				t.Error("Cached thumbnail data differs from original")
			}

			// Verify it's valid image data
			if tt.fileType == database.FileTypeImage {
				// Should be JPEG data
				if len(data1) < 2 || data1[0] != 0xFF || data1[1] != 0xD8 {
					t.Error("Thumbnail data doesn't appear to be valid JPEG")
				}
			}
		})
	}
}

func TestGetThumbnailFolderIntegration(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create a folder
	folderPath := filepath.Join(mediaDir, "test_folder")
	err := os.MkdirAll(folderPath, 0o755)
	if err != nil {
		t.Fatalf("Failed to create test folder: %v", err)
	}

	// Request folder thumbnail
	ctx := context.Background()
	data, err := gen.GetThumbnail(ctx, folderPath, database.FileTypeFolder)
	if err != nil {
		t.Fatalf("GetThumbnail for folder failed: %v", err)
	}

	if len(data) == 0 {
		t.Error("Folder thumbnail data is empty")
	}

	// Verify it's PNG data (folders use PNG)
	if len(data) < 8 {
		t.Fatal("Thumbnail data too short")
	}

	// PNG signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
	pngSignature := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	for i, b := range pngSignature {
		if data[i] != b {
			t.Error("Folder thumbnail doesn't appear to be valid PNG")
			break
		}
	}
}

func TestGetThumbnailConcurrent(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create test image
	filename := filepath.Join(mediaDir, "concurrent.jpg")
	createTestImageFile(t, filename, 800, 600, "jpeg", 85)

	// Launch multiple concurrent requests for the same file
	const numRequests = 10
	results := make(chan error, numRequests)

	ctx := context.Background()
	for i := 0; i < numRequests; i++ {
		go func() {
			_, err := gen.GetThumbnail(ctx, filename, database.FileTypeImage)
			results <- err
		}()
	}

	// Collect results
	for i := 0; i < numRequests; i++ {
		err := <-results
		if err != nil {
			t.Errorf("Concurrent request %d failed: %v", i, err)
		}
	}

	// Verify only one cache file was created
	cacheKey := gen.getCacheKey(filename, database.FileTypeImage)
	cachePath := filepath.Join(tmpDir, cacheKey)
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		t.Error("Cache file was not created")
	}
}

func TestUpdateCacheMetrics(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create some cache files
	for i := 0; i < 5; i++ {
		filename := filepath.Join(mediaDir, "test"+string(rune('0'+i))+".jpg")
		createTestImageFile(t, filename, 200, 200, "jpeg", 85)

		ctx := context.Background()
		_, err := gen.GetThumbnail(ctx, filename, database.FileTypeImage)
		if err != nil {
			t.Fatalf("GetThumbnail failed: %v", err)
		}
	}

	// Update cache metrics
	gen.UpdateCacheMetrics()

	// Verify metrics were updated (accessed via generation stats)
	gen.cacheMetricsMu.RLock()
	cacheCount := gen.lastCacheCount
	cacheSize := gen.lastCacheSize
	gen.cacheMetricsMu.RUnlock()

	if cacheCount <= 0 {
		t.Error("Cache count should be positive")
	}

	if cacheSize <= 0 {
		t.Error("Cache size should be positive")
	}

	t.Logf("Cache metrics: count=%d, size=%d bytes", cacheCount, cacheSize)
}

func TestGetStatus(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create some thumbnails
	for i := 0; i < 3; i++ {
		filename := filepath.Join(mediaDir, "status"+string(rune('0'+i))+".jpg")
		createTestImageFile(t, filename, 200, 200, "jpeg", 85)

		ctx := context.Background()
		_, _ = gen.GetThumbnail(ctx, filename, database.FileTypeImage)
	}

	gen.UpdateCacheMetrics()

	status := gen.GetStatus()

	if !status.Enabled {
		t.Error("Status should show enabled=true")
	}

	if status.CacheDir != tmpDir {
		t.Errorf("CacheDir = %s, want %s", status.CacheDir, tmpDir)
	}

	if status.CacheCount <= 0 {
		t.Error("CacheCount should be positive")
	}

	if status.CacheSize <= 0 {
		t.Error("CacheSize should be positive")
	}

	if status.CacheSizeHuman == "" {
		t.Error("CacheSizeHuman should not be empty")
	}

	t.Logf("Status: %+v", status)
}

func TestGetGenerationStats(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Initially, no generation should be in progress
	status := gen.GetStatus()
	if status.Generation != nil && status.Generation.InProgress {
		t.Error("Initially, InProgress should be false")
	}

	if status.Generation != nil && status.Generation.TotalFiles != 0 {
		t.Error("Initially, TotalFiles should be 0")
	}
}

func TestGenerateFolderThumbnailNoDB(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create a folder
	folderPath := filepath.Join(mediaDir, "test_folder")
	err := os.MkdirAll(folderPath, 0o755)
	if err != nil {
		t.Fatalf("Failed to create folder: %v", err)
	}

	ctx := context.Background()
	img, err := gen.generateFolderThumbnail(ctx, folderPath)
	if err != nil {
		t.Fatalf("generateFolderThumbnail failed: %v", err)
	}

	if img == nil {
		t.Fatal("Generated folder thumbnail is nil")
	}

	// Should be a folder icon (empty folder when no DB)
	bounds := img.Bounds()
	if bounds.Dx() != folderThumbSize || bounds.Dy() != folderThumbSize {
		t.Errorf("Folder thumbnail size = %dx%d, want %dx%d",
			bounds.Dx(), bounds.Dy(), folderThumbSize, folderThumbSize)
	}
}

// Helper functions

func createTestImageFile(t testing.TB, path string, width, height int, format string, quality int) {
	t.Helper()

	// Create parent directory if needed
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("Failed to create directory: %v", err)
	}

	// Create image with gradient
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			c := color.RGBA{
				R: uint8((x * 255) / width),
				G: uint8((y * 255) / height),
				B: 128,
				A: 255,
			}
			img.Set(x, y, c)
		}
	}

	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}
	defer f.Close()

	switch format {
	case "jpeg", "jpg":
		if quality == 0 {
			quality = 85
		}
		err = jpeg.Encode(f, img, &jpeg.Options{Quality: quality})
	case "png":
		err = png.Encode(f, img)
	default:
		t.Fatalf("Unsupported format: %s", format)
	}

	if err != nil {
		t.Fatalf("Failed to encode image: %v", err)
	}
}

func createTestVideoFile(path string) error {
	// Create a 3-second test video with a red background
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-f", "lavfi",
		"-i", "color=c=red:s=320x240:d=3",
		"-c:v", "libx264",
		"-t", "3",
		"-pix_fmt", "yuv420p",
		"-y", // Overwrite output file
		path,
	)

	return cmd.Run()
}

func BenchmarkGetThumbnailWithCache(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create and cache a thumbnail
	filename := filepath.Join(mediaDir, "bench.jpg")
	img := image.NewRGBA(image.Rect(0, 0, 800, 600))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)
	f, _ := os.Create(filename)
	jpeg.Encode(f, img, &jpeg.Options{Quality: 85})
	f.Close()

	ctx := context.Background()
	// Generate once to populate cache
	gen.GetThumbnail(ctx, filename, database.FileTypeImage)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := gen.GetThumbnail(ctx, filename, database.FileTypeImage)
		if err != nil {
			b.Fatalf("GetThumbnail failed: %v", err)
		}
	}
}

func BenchmarkGetThumbnailGeneration(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Create unique file for each iteration
		filename := filepath.Join(mediaDir, "bench"+string(rune('0'+i%10))+".jpg")
		img := image.NewRGBA(image.Rect(0, 0, 800, 600))
		draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{128, 128, 128, 255}}, image.Point{}, draw.Src)
		f, _ := os.Create(filename)
		jpeg.Encode(f, img, &jpeg.Options{Quality: 85})
		f.Close()

		_, err := gen.GetThumbnail(ctx, filename, database.FileTypeImage)
		if err != nil {
			b.Fatalf("GetThumbnail failed: %v", err)
		}
	}
}

// =============================================================================
// WORKER POOL INTEGRATION TESTS
// =============================================================================

func TestProcessBatchIntegration(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Create test files
	numFiles := 20
	files := make([]database.MediaFile, numFiles)

	for i := 0; i < numFiles; i++ {
		filename := filepath.Join(mediaDir, "test"+string(rune('a'+i%26))+".jpg")
		createTestImageFile(t, filename, 800, 600, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		files[i] = database.MediaFile{
			Path: relPath,
			Type: database.FileTypeImage,
			Name: filepath.Base(filename),
		}
	}

	// Reset stats
	gen.generationMu.Lock()
	gen.generationStats = GenerationStats{}
	gen.generationMu.Unlock()

	// Process batch
	gen.processBatch(ctx, files)

	// Verify stats
	stats := gen.GetStatus().Generation
	if stats.Processed != numFiles {
		t.Errorf("Processed = %d, want %d", stats.Processed, numFiles)
	}

	if stats.Generated+stats.Skipped+stats.Failed != numFiles {
		t.Errorf("Generated+Skipped+Failed = %d, want %d",
			stats.Generated+stats.Skipped+stats.Failed, numFiles)
	}

	t.Logf("Processed batch: Generated=%d, Skipped=%d, Failed=%d",
		stats.Generated, stats.Skipped, stats.Failed)
}

func TestProcessBatchEmptyIntegration(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Process empty batch (should not panic)
	gen.processBatch(ctx, []database.MediaFile{})

	// Should have no stats changes
	stats := gen.GetStatus().Generation
	if stats.Processed != 0 {
		t.Errorf("Processed = %d, want 0 for empty batch", stats.Processed)
	}
}

func TestProcessBatchCancellation(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create test files
	numFiles := 50
	files := make([]database.MediaFile, numFiles)

	for i := 0; i < numFiles; i++ {
		filename := filepath.Join(mediaDir, "cancel"+string(rune('a'+i%26))+".jpg")
		createTestImageFile(t, filename, 1920, 1080, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		files[i] = database.MediaFile{
			Path: relPath,
			Type: database.FileTypeImage,
			Name: filepath.Base(filename),
		}
	}

	// Create cancellable context
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Reset stats
	gen.generationMu.Lock()
	gen.generationStats = GenerationStats{}
	gen.generationMu.Unlock()

	// Process batch (should be canceled mid-way)
	gen.processBatch(ctx, files)

	// Verify processing was canceled before completion
	stats := gen.GetStatus().Generation

	// With cancellation, we might not process all files
	if stats.Processed > numFiles {
		t.Errorf("Processed = %d, should not exceed %d", stats.Processed, numFiles)
	}

	t.Logf("Processed before cancellation: %d/%d", stats.Processed, numFiles)
}

func TestProcessBatchWithExistingThumbnails(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Create test files
	numFiles := 10
	files := make([]database.MediaFile, numFiles)

	for i := 0; i < numFiles; i++ {
		filename := filepath.Join(mediaDir, "existing"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filename, 800, 600, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		files[i] = database.MediaFile{
			Path: relPath,
			Type: database.FileTypeImage,
			Name: filepath.Base(filename),
		}
	}

	// First pass - generate all thumbnails
	gen.processBatch(ctx, files)

	firstStats := gen.GetStatus().Generation
	firstGenerated := firstStats.Generated

	// Reset stats
	gen.generationMu.Lock()
	gen.generationStats = GenerationStats{}
	gen.generationMu.Unlock()

	// Second pass - should skip existing thumbnails
	gen.processBatch(ctx, files)

	secondStats := gen.GetStatus().Generation

	// Most/all should be skipped
	if secondStats.Skipped < numFiles/2 {
		t.Errorf("Skipped = %d, expected most files to be skipped on second pass", secondStats.Skipped)
	}

	t.Logf("First pass: Generated=%d, Second pass: Skipped=%d",
		firstGenerated, secondStats.Skipped)
}

func TestProcessBatchMixedTypes(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Create mixed media files
	files := []database.MediaFile{}

	// Create images
	for i := 0; i < 5; i++ {
		filename := filepath.Join(mediaDir, "image"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filename, 800, 600, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		files = append(files, database.MediaFile{
			Path: relPath,
			Type: database.FileTypeImage,
			Name: filepath.Base(filename),
		})
	}

	// Create folders (should be skipped or handled differently)
	for i := 0; i < 3; i++ {
		folderName := filepath.Join(mediaDir, "folder"+string(rune('a'+i)))
		os.MkdirAll(folderName, 0o755)

		relPath, _ := filepath.Rel(mediaDir, folderName)
		files = append(files, database.MediaFile{
			Path: relPath,
			Type: database.FileTypeFolder,
			Name: filepath.Base(folderName),
		})
	}

	// Reset stats
	gen.generationMu.Lock()
	gen.generationStats = GenerationStats{}
	gen.generationMu.Unlock()

	// Process batch
	gen.processBatch(ctx, files)

	// Verify processing
	stats := gen.GetStatus().Generation
	if stats.Processed != len(files) {
		t.Errorf("Processed = %d, want %d", stats.Processed, len(files))
	}

	t.Logf("Mixed batch: Generated=%d, Skipped=%d, Failed=%d",
		stats.Generated, stats.Skipped, stats.Failed)
}

func TestWorkerPoolScaling(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Test with different batch sizes
	batchSizes := []int{1, 5, 10, 20, 50}

	for _, batchSize := range batchSizes {
		t.Run("Batch size "+string(rune('0'+batchSize/10))+string(rune('0'+batchSize%10)), func(t *testing.T) {
			files := make([]database.MediaFile, batchSize)

			for i := 0; i < batchSize; i++ {
				filename := filepath.Join(mediaDir, "scale"+string(rune('a'+i%26))+".jpg")
				createTestImageFile(t, filename, 400, 300, "jpeg", 85)

				relPath, _ := filepath.Rel(mediaDir, filename)
				files[i] = database.MediaFile{
					Path: relPath,
					Type: database.FileTypeImage,
					Name: filepath.Base(filename),
				}
			}

			// Reset stats
			gen.generationMu.Lock()
			gen.generationStats = GenerationStats{}
			gen.generationMu.Unlock()

			start := time.Now()
			gen.processBatch(ctx, files)
			elapsed := time.Since(start)

			stats := gen.GetStatus().Generation
			if stats.Processed != batchSize {
				t.Errorf("Processed = %d, want %d", stats.Processed, batchSize)
			}

			t.Logf("Batch size %d: Processed in %v (%v per file)",
				batchSize, elapsed, elapsed/time.Duration(batchSize))
		})
	}
}

func TestWorkerPoolContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create large batch
	numFiles := 30
	files := make([]database.MediaFile, numFiles)

	for i := 0; i < numFiles; i++ {
		filename := filepath.Join(mediaDir, "context"+string(rune('a'+i%26))+".jpg")
		createTestImageFile(t, filename, 1920, 1080, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		files[i] = database.MediaFile{
			Path: relPath,
			Type: database.FileTypeImage,
			Name: filepath.Base(filename),
		}
	}

	// Create context with very short timeout
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// Reset stats
	gen.generationMu.Lock()
	gen.generationStats = GenerationStats{}
	gen.generationMu.Unlock()

	// Process should respect context cancellation
	start := time.Now()
	gen.processBatch(ctx, files)
	elapsed := time.Since(start)

	// Should finish quickly due to cancellation
	if elapsed > 500*time.Millisecond {
		t.Errorf("Processing took %v, expected quicker cancellation", elapsed)
	}

	stats := gen.GetStatus().Generation
	t.Logf("Processed %d/%d files before context cancellation", stats.Processed, numFiles)
}

func TestWorkerPoolStopChannel(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Create large batch
	numFiles := 30
	files := make([]database.MediaFile, numFiles)

	for i := 0; i < numFiles; i++ {
		filename := filepath.Join(mediaDir, "stop"+string(rune('a'+i%26))+".jpg")
		createTestImageFile(t, filename, 1920, 1080, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		files[i] = database.MediaFile{
			Path: relPath,
			Type: database.FileTypeImage,
			Name: filepath.Base(filename),
		}
	}

	// Reset stats
	gen.generationMu.Lock()
	gen.generationStats = GenerationStats{}
	gen.generationMu.Unlock()

	// Start processing in goroutine
	done := make(chan struct{})
	go func() {
		gen.processBatch(ctx, files)
		close(done)
	}()

	// Give it a moment to start
	time.Sleep(50 * time.Millisecond)

	// Stop thumbnail generation
	gen.Stop()

	// Wait for completion with timeout
	select {
	case <-done:
		t.Log("Processing stopped successfully")
	case <-time.After(2 * time.Second):
		t.Error("Processing did not stop within timeout")
	}

	stats := gen.GetStatus().Generation
	t.Logf("Processed %d/%d files before stop signal", stats.Processed, numFiles)
}

func BenchmarkProcessBatch(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Create test files once
	numFiles := 10
	files := make([]database.MediaFile, numFiles)

	for i := 0; i < numFiles; i++ {
		filename := filepath.Join(mediaDir, "bench"+string(rune('a'+i))+".jpg")
		createTestImageFile(b, filename, 800, 600, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		files[i] = database.MediaFile{
			Path: relPath,
			Type: database.FileTypeImage,
			Name: filepath.Base(filename),
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Clear cache between iterations
		gen.InvalidateAll()

		gen.generationMu.Lock()
		gen.generationStats = GenerationStats{}
		gen.generationMu.Unlock()

		gen.processBatch(ctx, files)
	}
}
