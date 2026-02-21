package media

import (
	"context"
	"fmt"
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
	if testing.Short() {
		t.Skip("skipping integration test")
	}
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
	if testing.Short() {
		t.Skip("skipping integration test")
	}
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
	if testing.Short() {
		t.Skip("skipping integration test")
	}
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

func TestGenerateVideoThumbnailShortVideo(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available, skipping video thumbnail test")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not available, skipping short video test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create a very short test video (0.5 seconds)
	videoFile := filepath.Join(mediaDir, "short.mp4")
	if err := createShortTestVideoFile(videoFile, 0.5); err != nil {
		t.Skipf("Could not create short test video: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	img, err := gen.generateVideoThumbnail(ctx, videoFile)
	if err != nil {
		t.Fatalf("generateVideoThumbnail failed for short video: %v", err)
	}

	if img == nil {
		t.Fatal("Generated thumbnail is nil")
	}

	bounds := img.Bounds()
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		t.Error("Generated thumbnail has invalid dimensions")
	}
}

func TestGetVideoDuration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available, skipping test")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not available, skipping test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	tests := []struct {
		name        string
		duration    float64
		expectedMin float64
		expectedMax float64
	}{
		{
			name:        "Short video",
			duration:    0.5,
			expectedMin: 0.4,
			expectedMax: 0.6,
		},
		{
			name:        "Normal video",
			duration:    3.0,
			expectedMin: 2.9,
			expectedMax: 3.1,
		},
		{
			name:        "Long video",
			duration:    10.0,
			expectedMin: 9.9,
			expectedMax: 10.1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			videoFile := filepath.Join(mediaDir, tt.name+".mp4")
			if err := createShortTestVideoFile(videoFile, tt.duration); err != nil {
				t.Skipf("Could not create test video: %v", err)
			}

			ctx := context.Background()
			duration, err := gen.getVideoDuration(ctx, videoFile)
			if err != nil {
				t.Fatalf("getVideoDuration failed: %v", err)
			}

			if duration < tt.expectedMin || duration > tt.expectedMax {
				t.Errorf("Duration = %.2f, want between %.2f and %.2f", duration, tt.expectedMin, tt.expectedMax)
			}
		})
	}
}

func TestGetVideoDurationNonexistent(t *testing.T) {
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not available, skipping test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()
	_, err := gen.getVideoDuration(ctx, "/nonexistent/video.mp4")
	if err == nil {
		t.Error("Expected error for nonexistent video file")
	}
}

func TestGetThumbnailFullIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
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
	if testing.Short() {
		t.Skip("skipping integration test")
	}
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
	for range numRequests {
		go func() {
			_, err := gen.GetThumbnail(ctx, filename, database.FileTypeImage)
			results <- err
		}()
	}

	// Collect results
	for i := range numRequests {
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
	for i := range 5 {
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
	for i := range 3 {
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

func createShortTestVideoFile(path string, duration float64) error {
	// Create a short test video with a blue background
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	durationStr := fmt.Sprintf("%.2f", duration)

	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-f", "lavfi",
		"-i", fmt.Sprintf("color=c=blue:s=320x240:d=%s", durationStr),
		"-c:v", "libx264",
		"-t", durationStr,
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

	for b.Loop() {
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

	for i := 0; b.Loop(); i++ {
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
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Create test files
	numFiles := 20
	files := make([]database.MediaFile, numFiles)

	for i := range numFiles {
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
	if testing.Short() {
		t.Skip("skipping integration test")
	}
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

	for i := range numFiles {
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

	for i := range numFiles {
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
	files := make([]database.MediaFile, 0, 8)

	// Create images
	for i := range 5 {
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
	for i := range 3 {
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

			for i := range batchSize {
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

	for i := range numFiles {
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
	// Note: race detector makes operations significantly slower (5-10x),
	// so we use a generous timeout that works for both normal and race builds
	maxExpected := 3 * time.Second
	if elapsed > maxExpected {
		t.Errorf("Processing took %v, expected quicker cancellation (max %v)", elapsed, maxExpected)
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

	for i := range numFiles {
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

	for i := range numFiles {
		filename := filepath.Join(mediaDir, "bench"+string(rune('a'+i))+".jpg")
		createTestImageFile(b, filename, 800, 600, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		files[i] = database.MediaFile{
			Path: relPath,
			Type: database.FileTypeImage,
			Name: filepath.Base(filename),
		}
	}

	for b.Loop() {
		// Clear cache between iterations
		gen.InvalidateAll()

		gen.generationMu.Lock()
		gen.generationStats = GenerationStats{}
		gen.generationMu.Unlock()

		gen.processBatch(ctx, files)
	}
}

// TestConcurrentRunGeneration verifies that concurrent calls to runGeneration
// are properly serialized and only one generation runs at a time
func TestConcurrentRunGeneration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	// Set up database
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	// Create generator with a short generation interval
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)

	// Launch multiple concurrent runGeneration calls
	const numConcurrent = 10
	done := make(chan bool, numConcurrent)

	// Launch multiple concurrent runGeneration calls
	for i := range numConcurrent {
		go func(id int) {
			// Each goroutine attempts to run generation
			// The atomic check should prevent more than one from actually running
			before := gen.isGenerating.Load()
			gen.runGeneration(false)
			after := gen.isGenerating.Load()

			// If this goroutine ran generation (wasn't skipped), count it
			// We can't directly count executions, but we verify the flag behavior
			t.Logf("Goroutine %d: before=%v, after=%v", id, before, after)
			done <- true
		}(i)
	}

	// Wait for all goroutines to complete
	for range numConcurrent {
		<-done
	}

	// The key assertion: verify the flag is properly reset
	if gen.IsGenerating() {
		t.Error("IsGenerating should be false after all generations complete")
	}

	// Verify no panics or data races occurred (the real value of this test)
	// The test passing without the race detector firing means our fix works
	t.Log("All concurrent calls completed successfully without race conditions")
}

// =============================================================================
// VIDEO END-TO-END INTEGRATION TESTS
// =============================================================================

func TestGetThumbnailVideoEndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available, skipping video end-to-end test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create a test video
	videoFile := filepath.Join(mediaDir, "test_video.mp4")
	if err := createTestVideoFile(videoFile); err != nil {
		t.Skipf("Could not create test video: %v", err)
	}

	ctx := context.Background()

	// First request — should generate and cache
	data1, err := gen.GetThumbnail(ctx, videoFile, database.FileTypeVideo)
	if err != nil {
		t.Fatalf("First GetThumbnail for video failed: %v", err)
	}
	if len(data1) == 0 {
		t.Error("Video thumbnail data is empty")
	}

	// Verify it's valid JPEG (videos produce JPEG thumbnails)
	if len(data1) < 2 || data1[0] != 0xFF || data1[1] != 0xD8 {
		t.Error("Video thumbnail doesn't appear to be valid JPEG")
	}

	// Verify cache file was created
	cacheKey := gen.getCacheKey(videoFile, database.FileTypeVideo)
	cachePath := filepath.Join(tmpDir, cacheKey)
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		t.Error("Cache file was not created for video thumbnail")
	}

	// Verify meta file was created
	metaPath := gen.getMetaPath(cacheKey)
	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		t.Error("Meta file was not created for video thumbnail")
	}

	// Second request — should hit cache
	data2, err := gen.GetThumbnail(ctx, videoFile, database.FileTypeVideo)
	if err != nil {
		t.Fatalf("Second GetThumbnail for video failed: %v", err)
	}
	if len(data2) != len(data1) {
		t.Error("Cached video thumbnail data differs from original")
	}
}

// =============================================================================
// INVALIDATE + REGENERATE INTEGRATION TESTS
// =============================================================================

func TestInvalidateThenRegenerateIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create test image
	filename := filepath.Join(mediaDir, "regen_test.jpg")
	createTestImageFile(t, filename, 800, 600, "jpeg", 85)

	ctx := context.Background()

	// Generate thumbnail
	data1, err := gen.GetThumbnail(ctx, filename, database.FileTypeImage)
	if err != nil {
		t.Fatalf("First GetThumbnail failed: %v", err)
	}

	cacheKey := gen.getCacheKey(filename, database.FileTypeImage)
	cachePath := filepath.Join(tmpDir, cacheKey)
	metaPath := gen.getMetaPath(cacheKey)

	// Verify files exist
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		t.Fatal("Cache file should exist before invalidation")
	}
	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		t.Fatal("Meta file should exist before invalidation")
	}

	// Invalidate
	if err := gen.InvalidateThumbnail(filename); err != nil {
		t.Fatalf("InvalidateThumbnail failed: %v", err)
	}

	// Verify files are removed
	if _, err := os.Stat(cachePath); !os.IsNotExist(err) {
		t.Error("Cache file should be removed after invalidation")
	}
	if _, err := os.Stat(metaPath); !os.IsNotExist(err) {
		t.Error("Meta file should be removed after invalidation")
	}

	// Regenerate — should create new cache + meta
	data2, err := gen.GetThumbnail(ctx, filename, database.FileTypeImage)
	if err != nil {
		t.Fatalf("GetThumbnail after invalidation failed: %v", err)
	}
	if len(data2) == 0 {
		t.Error("Regenerated thumbnail data is empty")
	}

	// Verify files recreated
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		t.Error("Cache file should be recreated after regeneration")
	}
	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		t.Error("Meta file should be recreated after regeneration")
	}

	// Verify data is valid JPEG (regenerated, not stale)
	if len(data2) < 2 || data2[0] != 0xFF || data2[1] != 0xD8 {
		t.Error("Regenerated thumbnail doesn't appear to be valid JPEG")
	}

	_ = data1 // used above for generation
}

func TestInvalidateAllThenRegenerateIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Generate several thumbnails
	filenames := make([]string, 5)
	for i := range 5 {
		filenames[i] = filepath.Join(mediaDir, "invalidate_all_"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filenames[i], 400, 300, "jpeg", 85)

		_, err := gen.GetThumbnail(ctx, filenames[i], database.FileTypeImage)
		if err != nil {
			t.Fatalf("GetThumbnail failed for file %d: %v", i, err)
		}
	}

	// Verify cache has files
	gen.UpdateCacheMetrics()
	count, _ := gen.GetCachedMetrics()
	if count < 5 {
		t.Errorf("Expected at least 5 cached thumbnails, got %d", count)
	}

	// Invalidate all
	removed, err := gen.InvalidateAll()
	if err != nil {
		t.Fatalf("InvalidateAll failed: %v", err)
	}
	if removed < 5 {
		t.Errorf("InvalidateAll removed %d, expected at least 5", removed)
	}

	// Verify cache is empty
	gen.UpdateCacheMetrics()
	count, _ = gen.GetCachedMetrics()
	if count != 0 {
		t.Errorf("Expected 0 cached thumbnails after InvalidateAll, got %d", count)
	}

	// Regenerate one — should work fine
	data, err := gen.GetThumbnail(ctx, filenames[0], database.FileTypeImage)
	if err != nil {
		t.Fatalf("GetThumbnail after InvalidateAll failed: %v", err)
	}
	if len(data) == 0 {
		t.Error("Regenerated thumbnail data is empty")
	}

	// Verify metrics updated
	gen.UpdateCacheMetrics()
	count, _ = gen.GetCachedMetrics()
	if count != 1 {
		t.Errorf("Expected 1 cached thumbnail after regeneration, got %d", count)
	}
}

// =============================================================================
// ORPHAN CLEANUP INTEGRATION TESTS
// =============================================================================

func TestCleanupOrphanedThumbnailsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "orphan_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)
	ctx := context.Background()

	file1 := filepath.Join(mediaDir, "keep.jpg")
	file2 := filepath.Join(mediaDir, "remove.jpg")
	createTestImageFile(t, file1, 200, 200, "jpeg", 85)
	createTestImageFile(t, file2, 200, 200, "jpeg", 85)

	relPath1, _ := filepath.Rel(mediaDir, file1)
	relPath2, _ := filepath.Rel(mediaDir, file2)

	// Index both files using the real transactional API
	file1Record := database.MediaFile{
		Path:       relPath1,
		Name:       "keep.jpg",
		ParentPath: ".",
		Type:       database.FileTypeImage,
	}
	file2Record := database.MediaFile{
		Path:       relPath2,
		Name:       "remove.jpg",
		ParentPath: ".",
		Type:       database.FileTypeImage,
	}
	upsertTestFile(ctx, t, db, file1Record)
	upsertTestFile(ctx, t, db, file2Record)

	// Generate thumbnails for both
	_, err = gen.GetThumbnail(ctx, file1, database.FileTypeImage)
	if err != nil {
		t.Fatalf("GetThumbnail for file1 failed: %v", err)
	}
	_, err = gen.GetThumbnail(ctx, file2, database.FileTypeImage)
	if err != nil {
		t.Fatalf("GetThumbnail for file2 failed: %v", err)
	}

	// Remove file2 from the index by re-upserting only file1 then deleting stale rows
	deleteTestFile(ctx, t, db, []database.MediaFile{file1Record})

	// Create a legacy thumbnail (no meta file)
	legacyCachePath := filepath.Join(tmpDir, "deadbeefdeadbeefdeadbeefdeadbeef.jpg")
	if err := os.WriteFile(legacyCachePath, []byte("legacy thumb"), 0o644); err != nil {
		t.Fatalf("Failed to create legacy thumbnail: %v", err)
	}

	orphansRemoved, legacyRemoved := gen.cleanupOrphanedThumbnails(ctx)

	if orphansRemoved < 1 {
		t.Errorf("Expected at least 1 orphan removed, got %d", orphansRemoved)
	}
	if legacyRemoved < 1 {
		t.Errorf("Expected at least 1 legacy removed, got %d", legacyRemoved)
	}

	cacheKey1 := gen.getCacheKey(file1, database.FileTypeImage)
	cachePath1 := filepath.Join(tmpDir, cacheKey1)
	if _, err := os.Stat(cachePath1); os.IsNotExist(err) {
		t.Error("Thumbnail for indexed file should be preserved")
	}

	cacheKey2 := gen.getCacheKey(file2, database.FileTypeImage)
	cachePath2 := filepath.Join(tmpDir, cacheKey2)
	if _, err := os.Stat(cachePath2); !os.IsNotExist(err) {
		t.Error("Thumbnail for removed file should be deleted")
	}

	if _, err := os.Stat(legacyCachePath); !os.IsNotExist(err) {
		t.Error("Legacy thumbnail should be deleted")
	}
}

// =============================================================================
// INCREMENTAL GENERATION INTEGRATION TESTS
// =============================================================================

func TestRunGenerationFullWithDB(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "gen_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)
	ctx := context.Background()

	// Create and index media files
	numFiles := 5
	for i := range numFiles {
		filename := filepath.Join(mediaDir, "gen_"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filename, 400, 300, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		upsertTestFile(ctx, t, db, database.MediaFile{
			Path:       relPath,
			Name:       filepath.Base(filename),
			ParentPath: ".",
			Type:       database.FileTypeImage,
		})
	}

	// Run full generation
	gen.runGeneration(false)

	// Verify stats
	stats := gen.GetStatus().Generation
	if stats.Generated+stats.Skipped < numFiles {
		t.Errorf("Expected at least %d generated+skipped, got generated=%d skipped=%d",
			numFiles, stats.Generated, stats.Skipped)
	}

	// Verify IsGenerating is false after completion
	if gen.IsGenerating() {
		t.Error("IsGenerating should be false after generation completes")
	}

	// Verify last run time was set
	lastRun, err := db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun failed: %v", err)
	}
	if lastRun.IsZero() {
		t.Error("Last thumbnail run time should be set after generation")
	}

	// Verify cache has thumbnails
	gen.UpdateCacheMetrics()
	count, _ := gen.GetCachedMetrics()
	if count < numFiles {
		t.Errorf("Expected at least %d cached thumbnails, got %d", numFiles, count)
	}

	t.Logf("Full generation: generated=%d, skipped=%d, failed=%d, cache count=%d",
		stats.Generated, stats.Skipped, stats.Failed, count)
}

func TestRunGenerationIncrementalWithDB(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "incr_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)
	ctx := context.Background()

	// Create and index initial files
	initialFiles := 3
	for i := range initialFiles {
		filename := filepath.Join(mediaDir, "initial_"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filename, 400, 300, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		upsertTestFile(ctx, t, db, database.MediaFile{
			Path:       relPath,
			Name:       filepath.Base(filename),
			Type:       database.FileTypeImage,
			ParentPath: ".",
		})
	}

	// Run full generation first
	gen.runGeneration(false)

	firstStats := gen.GetStatus().Generation
	t.Logf("Full generation: generated=%d, skipped=%d", firstStats.Generated, firstStats.Skipped)

	// Small delay to ensure timestamp difference
	time.Sleep(100 * time.Millisecond)

	// Add new files after the first run
	newFiles := 2
	for i := range newFiles {
		filename := filepath.Join(mediaDir, "new_"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filename, 400, 300, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		upsertTestFile(ctx, t, db, database.MediaFile{
			Path:       relPath,
			Name:       filepath.Base(filename),
			ParentPath: ".",
			Type:       database.FileTypeImage,
		})
	}

	// Run incremental generation
	gen.runGeneration(true)

	incrStats := gen.GetStatus().Generation
	t.Logf("Incremental generation: generated=%d, skipped=%d, total=%d, isIncremental=%v",
		incrStats.Generated, incrStats.Skipped, incrStats.TotalFiles, incrStats.IsIncremental)

	// Incremental should process fewer files than full
	// (only the new files, not the already-thumbnailed ones)
	if incrStats.TotalFiles > initialFiles+newFiles {
		t.Errorf("Incremental should not process more than %d files, got TotalFiles=%d",
			initialFiles+newFiles, incrStats.TotalFiles)
	}

	// Verify all files now have thumbnails
	gen.UpdateCacheMetrics()
	count, _ := gen.GetCachedMetrics()
	if count < initialFiles+newFiles {
		t.Errorf("Expected at least %d cached thumbnails after incremental, got %d",
			initialFiles+newFiles, count)
	}
}

// =============================================================================
// FOLDER THUMBNAIL WITH DB INTEGRATION TESTS
// =============================================================================

func TestGenerateFolderThumbnailWithDBImages(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "folder_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)
	ctx := context.Background()

	// Create folder structure with images
	folderPath := filepath.Join(mediaDir, "photos")
	if err := os.MkdirAll(folderPath, 0o755); err != nil {
		t.Fatalf("Failed to create folder: %v", err)
	}

	// Index the folder
	upsertTestFile(ctx, t, db, database.MediaFile{
		Path:       "photos",
		Name:       "photos",
		ParentPath: ".",
		Type:       database.FileTypeFolder,
	})

	// Create and index images inside the folder
	numImages := 4
	for i := range numImages {
		filename := filepath.Join(folderPath, "img_"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filename, 400, 300, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		upsertTestFile(ctx, t, db, database.MediaFile{
			Path:       relPath,
			Name:       filepath.Base(filename),
			Type:       database.FileTypeImage,
			ParentPath: "photos",
		})
	}

	// Generate folder thumbnail
	img, err := gen.generateFolderThumbnail(ctx, folderPath)
	if err != nil {
		t.Fatalf("generateFolderThumbnail failed: %v", err)
	}

	if img == nil {
		t.Fatal("Folder thumbnail is nil")
	}

	bounds := img.Bounds()
	if bounds.Dx() != folderThumbSize || bounds.Dy() != folderThumbSize {
		t.Errorf("Folder thumbnail size = %dx%d, want %dx%d",
			bounds.Dx(), bounds.Dy(), folderThumbSize, folderThumbSize)
	}
}

func TestGenerateFolderThumbnailWithSubdirectoryImages(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "subfolder_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)
	ctx := context.Background()

	// Create parent folder (empty) and subfolder with images
	parentPath := filepath.Join(mediaDir, "albums")
	subPath := filepath.Join(parentPath, "vacation")
	if err := os.MkdirAll(subPath, 0o755); err != nil {
		t.Fatalf("Failed to create folders: %v", err)
	}

	// Index folders
	upsertTestFile(ctx, t, db, database.MediaFile{
		Path:       "albums",
		Name:       "albums",
		ParentPath: ".",
		Type:       database.FileTypeFolder,
	})
	upsertTestFile(ctx, t, db, database.MediaFile{
		Path:       "albums/vacation",
		Name:       "vacation",
		Type:       database.FileTypeFolder,
		ParentPath: "albums",
	})

	// Create images only in subfolder
	for i := range 2 {
		filename := filepath.Join(subPath, "sub_img_"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filename, 300, 300, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		upsertTestFile(ctx, t, db, database.MediaFile{
			Path:       relPath,
			Name:       filepath.Base(filename),
			Type:       database.FileTypeImage,
			ParentPath: "albums/vacation",
		})
	}

	// Generate thumbnail for parent folder — should discover images in subdirectory
	img, err := gen.generateFolderThumbnail(ctx, parentPath)
	if err != nil {
		t.Fatalf("generateFolderThumbnail failed: %v", err)
	}

	if img == nil {
		t.Fatal("Folder thumbnail is nil")
	}

	bounds := img.Bounds()
	if bounds.Dx() != folderThumbSize || bounds.Dy() != folderThumbSize {
		t.Errorf("Folder thumbnail size = %dx%d, want %dx%d",
			bounds.Dx(), bounds.Dy(), folderThumbSize, folderThumbSize)
	}
}

func TestGetThumbnailFolderEndToEndWithDB(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "folder_e2e_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)
	ctx := context.Background()

	// Create folder with one image
	folderPath := filepath.Join(mediaDir, "myfolder")
	if err := os.MkdirAll(folderPath, 0o755); err != nil {
		t.Fatalf("Failed to create folder: %v", err)
	}

	upsertTestFile(ctx, t, db, database.MediaFile{
		Path:       "myfolder",
		Name:       "myfolder",
		ParentPath: ".",
		Type:       database.FileTypeFolder,
	})

	imgFile := filepath.Join(folderPath, "photo.jpg")
	createTestImageFile(t, imgFile, 600, 400, "jpeg", 85)

	relPath, _ := filepath.Rel(mediaDir, imgFile)
	upsertTestFile(ctx, t, db, database.MediaFile{
		Path:       relPath,
		Name:       "photo.jpg",
		Type:       database.FileTypeImage,
		ParentPath: "myfolder",
	})

	// Full end-to-end: GetThumbnail for folder
	data, err := gen.GetThumbnail(ctx, folderPath, database.FileTypeFolder)
	if err != nil {
		t.Fatalf("GetThumbnail for folder failed: %v", err)
	}

	if len(data) == 0 {
		t.Error("Folder thumbnail data is empty")
	}

	// Verify PNG format
	if len(data) < 8 {
		t.Fatal("Thumbnail data too short")
	}
	pngSignature := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	for i, b := range pngSignature {
		if data[i] != b {
			t.Error("Folder thumbnail doesn't appear to be valid PNG")
			break
		}
	}

	// Verify cache and meta files
	cacheKey := gen.getCacheKey(folderPath, database.FileTypeFolder)
	cachePath := filepath.Join(tmpDir, cacheKey)
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		t.Error("Cache file was not created for folder thumbnail")
	}
	metaPath := gen.getMetaPath(cacheKey)
	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		t.Error("Meta file was not created for folder thumbnail")
	}

	// Second call should hit cache
	data2, err := gen.GetThumbnail(ctx, folderPath, database.FileTypeFolder)
	if err != nil {
		t.Fatalf("Second GetThumbnail for folder failed: %v", err)
	}
	if len(data2) != len(data) {
		t.Error("Cached folder thumbnail data differs from original")
	}
}

// =============================================================================
// REBUILD ALL INTEGRATION TEST
// =============================================================================

// In TestRebuildAllIntegration, replace the wait loop:
func TestRebuildAllIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "rebuild_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)
	ctx := context.Background()

	// Create and index files
	numFiles := 3
	for i := range numFiles {
		filename := filepath.Join(mediaDir, "rebuild_"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filename, 400, 300, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		upsertTestFile(ctx, t, db, database.MediaFile{
			Path:       relPath,
			Name:       filepath.Base(filename),
			ParentPath: ".",
			Type:       database.FileTypeImage,
		})
	}

	// Set a last run time (simulating previous generation)
	if err := db.SetLastThumbnailRun(ctx, time.Now()); err != nil {
		t.Fatalf("Failed to set last run time: %v", err)
	}

	// Generate initial thumbnails
	gen.runGeneration(false)

	gen.UpdateCacheMetrics()
	countBefore, _ := gen.GetCachedMetrics()
	if countBefore < numFiles {
		t.Fatalf("Expected at least %d thumbnails before rebuild, got %d", numFiles, countBefore)
	}

	// RebuildAll clears cache and triggers full generation in a goroutine
	gen.RebuildAll()

	// Wait for the async generation to START first, then wait for it to complete.
	// There is a race window between the goroutine launch in RebuildAll and the
	// CompareAndSwap in runGeneration — IsGenerating() can briefly be false.
	deadline := time.After(10 * time.Second)

	// Phase 1: wait for generation to start
	for {
		select {
		case <-deadline:
			t.Fatal("RebuildAll generation never started within timeout")
		default:
			if gen.IsGenerating() {
				goto started
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
started:

	// Phase 2: wait for generation to complete
	for {
		select {
		case <-deadline:
			t.Fatal("RebuildAll did not complete within timeout")
		default:
			if !gen.IsGenerating() {
				// Give a small buffer for final stats update
				time.Sleep(100 * time.Millisecond)
				goto done
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
done:

	// Verify last run time was cleared and reset
	lastRun, err := db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun failed: %v", err)
	}
	if lastRun.IsZero() {
		t.Error("Last run time should be set after rebuild completes")
	}

	// Verify thumbnails were regenerated
	gen.UpdateCacheMetrics()
	countAfter, _ := gen.GetCachedMetrics()
	if countAfter < numFiles {
		t.Errorf("Expected at least %d thumbnails after rebuild, got %d", numFiles, countAfter)
	}

	t.Logf("Rebuild: before=%d, after=%d", countBefore, countAfter)
}

// =============================================================================
// NOTIFY INDEX COMPLETE + BACKGROUND LOOP INTEGRATION TEST
// =============================================================================

func TestNotifyIndexCompleteTriggersGeneration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "notify_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, 24*time.Hour, nil)
	ctx := context.Background()

	// Create and index a file
	filename := filepath.Join(mediaDir, "notify_test.jpg")
	createTestImageFile(t, filename, 400, 300, "jpeg", 85)

	relPath, _ := filepath.Rel(mediaDir, filename)
	upsertTestFile(ctx, t, db, database.MediaFile{
		Path:       relPath,
		Name:       filepath.Base(filename),
		ParentPath: ".",
		Type:       database.FileTypeImage,
	})

	// Start the background loop
	gen.Start()
	defer gen.Stop()

	// Send index complete notification
	gen.NotifyIndexComplete()

	// Wait for generation to start and complete
	deadline := time.After(15 * time.Second)
	generationStarted := false
	for {
		select {
		case <-deadline:
			if !generationStarted {
				t.Fatal("Generation never started after NotifyIndexComplete")
			}
			t.Fatal("Generation did not complete within timeout")
		default:
			if gen.IsGenerating() {
				generationStarted = true
			}
			if generationStarted && !gen.IsGenerating() {
				goto done
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
done:

	// Verify thumbnail was generated
	gen.UpdateCacheMetrics()
	count, _ := gen.GetCachedMetrics()
	if count < 1 {
		t.Errorf("Expected at least 1 cached thumbnail after NotifyIndexComplete, got %d", count)
	}

	// Verify last run time was set
	lastRun, err := db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun failed: %v", err)
	}
	if lastRun.IsZero() {
		t.Error("Last run time should be set after generation triggered by NotifyIndexComplete")
	}
}

// =============================================================================
// PROCESS FOLDERS FOR GENERATION INTEGRATION TEST
// =============================================================================

func TestProcessFoldersForGenerationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "folders_gen_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)
	ctx := context.Background()

	// Create folder with an image
	folderPath := filepath.Join(mediaDir, "testfolder")
	if err := os.MkdirAll(folderPath, 0o755); err != nil {
		t.Fatalf("Failed to create folder: %v", err)
	}

	upsertTestFile(ctx, t, db, database.MediaFile{
		Path:       "testfolder",
		Name:       "testfolder",
		ParentPath: ".",
		Type:       database.FileTypeFolder,
	})

	imgFile := filepath.Join(folderPath, "img.jpg")
	createTestImageFile(t, imgFile, 400, 300, "jpeg", 85)
	relPath, _ := filepath.Rel(mediaDir, imgFile)
	upsertTestFile(ctx, t, db, database.MediaFile{
		Path:       relPath,
		Name:       "img.jpg",
		Type:       database.FileTypeImage,
		ParentPath: "testfolder",
	})

	// Generate initial folder thumbnail
	_, err = gen.GetThumbnail(ctx, folderPath, database.FileTypeFolder)
	if err != nil {
		t.Fatalf("Initial folder thumbnail failed: %v", err)
	}

	// Reset stats
	gen.generationMu.Lock()
	gen.generationStats = GenerationStats{InProgress: true}
	gen.generationMu.Unlock()

	// Process folders for generation (simulating content change)
	folders := []database.MediaFile{
		{Path: "testfolder", Name: "testfolder", Type: database.FileTypeFolder},
	}
	gen.processFoldersForGeneration(ctx, folders)

	// Verify stats
	gen.generationMu.RLock()
	stats := gen.generationStats
	gen.generationMu.RUnlock()

	if stats.Processed != 1 {
		t.Errorf("Processed = %d, want 1", stats.Processed)
	}
	if stats.FoldersUpdated < 1 {
		t.Errorf("FoldersUpdated = %d, want at least 1", stats.FoldersUpdated)
	}

	// Verify the folder thumbnail was regenerated (cache file exists)
	cacheKey := gen.getCacheKey(folderPath, database.FileTypeFolder)
	cachePath := filepath.Join(tmpDir, cacheKey)
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		t.Error("Folder thumbnail should exist after processFoldersForGeneration")
	}
}

// =============================================================================
// TRIGGER GENERATION WITH DB INTEGRATION TEST
// =============================================================================

func TestTriggerGenerationWithDB(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()

	dbPath := filepath.Join(t.TempDir(), "trigger_test.db")
	db, _, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, db, time.Hour, nil)
	ctx := context.Background()

	// Create and index a file
	filename := filepath.Join(mediaDir, "trigger.jpg")
	createTestImageFile(t, filename, 400, 300, "jpeg", 85)

	relPath, _ := filepath.Rel(mediaDir, filename)
	upsertTestFile(ctx, t, db, database.MediaFile{
		Path:       relPath,
		Name:       filepath.Base(filename),
		ParentPath: ".",
		Type:       database.FileTypeImage,
	})

	// Trigger generation
	gen.TriggerGeneration()

	// Wait for completion
	deadline := time.After(10 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatal("TriggerGeneration did not complete within timeout")
		default:
			time.Sleep(50 * time.Millisecond)
			if !gen.IsGenerating() {
				// Check if it actually ran (last run time set)
				lastRun, err := db.GetLastThumbnailRun(ctx)
				if err == nil && !lastRun.IsZero() {
					goto done
				}
			}
		}
	}
done:

	// Verify thumbnail was generated
	gen.UpdateCacheMetrics()
	count, _ := gen.GetCachedMetrics()
	if count < 1 {
		t.Errorf("Expected at least 1 cached thumbnail after TriggerGeneration, got %d", count)
	}
}

// =============================================================================
// PROCESS FILES FOR GENERATION (INCREMENTAL) INTEGRATION TEST
// =============================================================================

func TestProcessFilesForGenerationIncrementalIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	ctx := context.Background()

	// Create files and generate thumbnails (first pass)
	numFiles := 5
	files := make([]database.MediaFile, numFiles)
	for i := 0; i < numFiles; i++ {
		filename := filepath.Join(mediaDir, "incr_"+string(rune('a'+i))+".jpg")
		createTestImageFile(t, filename, 400, 300, "jpeg", 85)

		relPath, _ := filepath.Rel(mediaDir, filename)
		files[i] = database.MediaFile{
			Path: relPath,
			Type: database.FileTypeImage,
			Name: filepath.Base(filename),
		}
	}

	// Generate all thumbnails first
	gen.generationMu.Lock()
	gen.generationStats = GenerationStats{}
	gen.generationMu.Unlock()
	gen.processBatch(ctx, files)

	// Verify all generated
	gen.generationMu.RLock()
	firstGenerated := gen.generationStats.Generated
	gen.generationMu.RUnlock()
	if firstGenerated < numFiles {
		t.Fatalf("Expected at least %d generated in first pass, got %d", numFiles, firstGenerated)
	}

	// Now run processFilesForGeneration with incremental=true
	// This should invalidate existing thumbnails first, then regenerate
	gen.generationMu.Lock()
	gen.generationStats = GenerationStats{}
	gen.generationMu.Unlock()

	gen.processFilesForGeneration(ctx, files[:2], true) // Only process first 2 files

	gen.generationMu.RLock()
	stats := gen.generationStats
	gen.generationMu.RUnlock()

	// Should have processed 2 files
	if stats.Processed != 2 {
		t.Errorf("Processed = %d, want 2", stats.Processed)
	}

	// Should have generated (not skipped) since we invalidated first
	if stats.Generated < 2 {
		t.Errorf("Generated = %d, want at least 2 (incremental should invalidate then regenerate)", stats.Generated)
	}

	t.Logf("Incremental processFiles: processed=%d, generated=%d, skipped=%d, failed=%d",
		stats.Processed, stats.Generated, stats.Skipped, stats.Failed)
}

// upsertTestFile is a test helper that wraps BeginBatch/UpsertFile/EndBatch
// to insert a single file using the real database API.
func upsertTestFile(ctx context.Context, t *testing.T, db *database.Database, file database.MediaFile) {
	t.Helper()
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	upsertErr := db.UpsertFile(ctx, tx, &file)
	if err := db.EndBatch(tx, upsertErr); err != nil {
		t.Fatalf("UpsertFile failed: %v", err)
	}
}

// deleteTestFile simulates removing a file from the index the way the real
// indexer does: re-upsert only the files to keep, then delete anything
// not updated since before the re-upsert batch.
func deleteTestFile(ctx context.Context, t *testing.T, db *database.Database, keepFiles []database.MediaFile) {
	t.Helper()

	// Wait so the next second boundary is crossed — the re-upserted files
	// will get an updated_at that is strictly greater than the originals.
	time.Sleep(1100 * time.Millisecond)

	// Cutoff: anything not re-upserted after this point is stale.
	// SQLite stores updated_at as integer seconds via strftime('%s','now').
	// After sleeping 1.1s, time.Now() truncated to whole seconds is strictly
	// greater than the original insert timestamp. The previous value of
	// time.Now().Add(-500ms) could truncate to the SAME second as the
	// original inserts, causing DeleteMissingFiles to find nothing to delete.
	cutoff := time.Now()

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range keepFiles {
		if upsertErr := db.UpsertFile(ctx, tx, &keepFiles[i]); upsertErr != nil {
			_ = db.EndBatch(tx, upsertErr)
			t.Fatalf("UpsertFile failed: %v", upsertErr)
		}
	}

	deleted, deleteErr := db.DeleteMissingFiles(ctx, tx, cutoff)
	if err := db.EndBatch(tx, deleteErr); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}
	t.Logf("DeleteMissingFiles removed %d rows", deleted)
}
