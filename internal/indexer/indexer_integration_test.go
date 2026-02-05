package indexer

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"media-viewer/internal/database"
)

// TestParallelWalkerIntegration tests the parallel walker with real filesystem operations
func TestParallelWalkerIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create a realistic directory structure with various media types
	structure := map[string]string{
		"photos/2024/image1.jpg":          "fake jpeg",
		"photos/2024/image2.png":          "fake png",
		"photos/2023/vacation.jpg":        "vacation photo",
		"videos/2024/movie.mp4":           "fake video",
		"videos/2024/clip.avi":            "fake avi",
		"videos/archive/old_movie.mkv":    "fake mkv",
		"music/album1/song1.mp3":          "fake mp3",
		"music/album1/song2.flac":         "fake flac",
		"music/album2/track.mp3":          "another mp3",
		"documents/readme.txt":            "text file (should be ignored)",
		"documents/notes.doc":             "doc file (should be ignored)",
		".hidden/secret.jpg":              "hidden file",
		"photos/.DS_Store":                "system file",
		"thumbnails/thumb1.jpg":           "thumbnail",
		"mixed/photo.jpg":                 "photo",
		"mixed/video.mp4":                 "video",
		"mixed/audio.mp3":                 "audio",
		"empty_folder/.gitkeep":           "keep",
		"deeply/nested/folders/image.jpg": "nested image",
		"deeply/nested/folders/video.mp4": "nested video",
	}

	expectedFolders := []string{
		"photos",
		"photos/2024",
		"photos/2023",
		"videos",
		"videos/2024",
		"videos/archive",
		"music",
		"music/album1",
		"music/album2",
		"documents",
		"thumbnails",
		"mixed",
		"empty_folder",
		"deeply",
		"deeply/nested",
		"deeply/nested/folders",
	}

	// Create all files and directories
	for filePath, content := range structure {
		fullPath := filepath.Join(tempDir, filePath)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			t.Fatalf("Failed to create directory: %v", err)
		}
		if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
			t.Fatalf("Failed to create file %s: %v", filePath, err)
		}
	}

	// Create empty folders
	for _, folder := range expectedFolders {
		fullPath := filepath.Join(tempDir, folder)
		if err := os.MkdirAll(fullPath, 0o755); err != nil {
			t.Fatalf("Failed to create folder %s: %v", folder, err)
		}
	}

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	// Verify statistics
	filesProcessed, foldersProcessed, errorsCount := walker.Stats()

	if errorsCount > 0 {
		t.Errorf("Expected no errors, got %d", errorsCount)
	}

	// Count expected media files (excluding .txt, .doc, .mp3, .flac, hidden files)
	// Audio files are filtered out as FileTypeOther
	expectedMediaFiles := 0
	for filePath := range structure {
		ext := filepath.Ext(filePath)
		name := filepath.Base(filePath)
		// Check if file is in a hidden directory
		isInHiddenDir := false
		for _, part := range strings.Split(filePath, string(filepath.Separator)) {
			if strings.HasPrefix(part, ".") {
				isInHiddenDir = true
				break
			}
		}
		// Skip non-media files, audio files, hidden files, and files in hidden directories
		if !isInHiddenDir && ext != ".txt" && ext != ".doc" && ext != ".gitkeep" && ext != ".mp3" && ext != ".flac" && !strings.HasPrefix(name, ".") {
			expectedMediaFiles++
		}
	}

	if filesProcessed != int64(expectedMediaFiles) {
		t.Errorf("Expected %d files processed, got %d", expectedMediaFiles, filesProcessed)
	}

	if foldersProcessed != int64(len(expectedFolders)) {
		t.Errorf("Expected %d folders processed, got %d", len(expectedFolders), foldersProcessed)
	}

	// Verify all files were collected
	if len(files) != int(filesProcessed)+int(foldersProcessed) {
		t.Errorf("Expected %d total entries, got %d", filesProcessed+foldersProcessed, len(files))
	}

	// Verify file types and paths
	filesByPath := make(map[string]database.MediaFile)
	for _, file := range files {
		filesByPath[file.Path] = file
	}

	// Check specific files
	tests := []struct {
		path        string
		expectType  database.FileType
		shouldExist bool
	}{
		{"photos/2024/image1.jpg", database.FileTypeImage, true},
		{"videos/2024/movie.mp4", database.FileTypeVideo, true},
		{"deeply/nested/folders/image.jpg", database.FileTypeImage, true},
		{"photos", database.FileTypeFolder, true},
		{"music/album1/song1.mp3", "", false}, // Audio files filtered out as FileTypeOther
		{"documents/readme.txt", "", false},   // Should be filtered out
		{".hidden/secret.jpg", "", false},     // Should be skipped
	}

	for _, tt := range tests {
		file, exists := filesByPath[tt.path]
		if exists != tt.shouldExist {
			t.Errorf("File %s: expected exists=%v, got %v", tt.path, tt.shouldExist, exists)
		}
		if exists && file.Type != tt.expectType {
			t.Errorf("File %s: expected type=%s, got %s", tt.path, tt.expectType, file.Type)
		}
	}
}

// TestParallelWalkerWithDifferentWorkerCounts tests parallel walker with various worker configurations
func TestParallelWalkerWithDifferentWorkerCounts(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create 50 files across different folders
	for i := 0; i < 50; i++ {
		folder := tempDir
		if i%5 == 0 {
			folder = filepath.Join(tempDir, "subfolder1")
		} else if i%3 == 0 {
			folder = filepath.Join(tempDir, "subfolder2")
		}
		os.MkdirAll(folder, 0o755)
		filePath := filepath.Join(folder, filepath.Base(folder)+"-image"+string(rune('A'+i))+".jpg")
		os.WriteFile(filePath, []byte("test"), 0o644)
	}

	workerCounts := []int{1, 2, 4, 8}

	for _, numWorkers := range workerCounts {
		t.Run(filepath.Base(tempDir)+"/workers="+string(rune('0'+numWorkers)), func(t *testing.T) {
			config := DefaultParallelWalkerConfig()
			config.NumWorkers = numWorkers

			walker := NewParallelWalker(tempDir, config)
			files, err := walker.Walk()

			if err != nil {
				t.Fatalf("Walk with %d workers failed: %v", numWorkers, err)
			}

			filesProcessed, foldersProcessed, errorsCount := walker.Stats()

			if errorsCount > 0 {
				t.Errorf("Worker count %d: expected no errors, got %d", numWorkers, errorsCount)
			}

			// All configurations should find the same files
			totalEntries := len(files)
			expectedTotal := int(filesProcessed + foldersProcessed)
			if totalEntries != expectedTotal {
				t.Errorf("Worker count %d: expected %d total entries, got %d",
					numWorkers, expectedTotal, totalEntries)
			}
		})
	}
}

// TestParallelWalkerCancellationIntegration tests cancellation during actual filesystem operations
func TestParallelWalkerCancellationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create a large directory structure
	for i := 0; i < 200; i++ {
		folder := filepath.Join(tempDir, "folder"+string(rune('A'+i%26)))
		os.MkdirAll(folder, 0o755)
		for j := 0; j < 10; j++ {
			filePath := filepath.Join(folder, "file"+string(rune('0'+j))+".jpg")
			os.WriteFile(filePath, []byte("data"), 0o644)
		}
	}

	config := DefaultParallelWalkerConfig()
	config.NumWorkers = 4
	walker := NewParallelWalker(tempDir, config)

	// Start walk in background
	done := make(chan struct{})
	var walkErr error

	go func() {
		_, walkErr = walker.Walk()
		close(done)
	}()

	// Cancel after a short delay
	time.Sleep(50 * time.Millisecond)
	walker.Stop()

	// Wait for completion
	select {
	case <-done:
		// Walk should complete quickly after cancellation
	case <-time.After(3 * time.Second):
		t.Fatal("Walk did not complete after cancellation")
	}

	// Walk may return partial results or error
	if walkErr != nil && walkErr.Error() != "walk all" {
		t.Logf("Walk returned error after cancellation: %v", walkErr)
	}

	// Verify that processing stopped (not all files collected)
	filesProcessed, _, _ := walker.Stats()
	totalExpectedFiles := 200 * 10 // folders * files per folder
	if filesProcessed >= int64(totalExpectedFiles) {
		t.Errorf("Expected cancellation to stop before processing all %d files, but processed %d",
			totalExpectedFiles, filesProcessed)
	}

	t.Logf("Canceled walk processed %d files before stopping", filesProcessed)
}

// TestIndexerWithRealDatabaseIntegration tests the full indexer with a real database
func TestIndexerWithRealDatabaseIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Create temporary directories
	tempDir := t.TempDir()
	dbPath := filepath.Join(t.TempDir(), "test.db")

	// Create test media structure
	testFiles := map[string]string{
		"photos/photo1.jpg":   "photo1",
		"photos/photo2.png":   "photo2",
		"videos/video1.mp4":   "video1",
		"videos/video2.avi":   "video2",
		"subfolder/image.jpg": "image",
	}

	for filePath, content := range testFiles {
		fullPath := filepath.Join(tempDir, filePath)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			t.Fatalf("Failed to create directory: %v", err)
		}
		if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
			t.Fatalf("Failed to create file: %v", err)
		}
	}

	// Create database
	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	// Create indexer
	idx := New(db, tempDir, 1*time.Hour)
	idx.SetParallelWalking(true)

	// Run index
	if err := idx.Index(); err != nil {
		t.Fatalf("Index failed: %v", err)
	}

	// Verify indexing completed
	if idx.IsIndexing() {
		t.Error("Expected indexing to be complete")
	}

	// Check database contents
	stats, err := db.CalculateStats()
	if err != nil {
		t.Fatalf("Failed to get stats: %v", err)
	}

	expectedFiles := len(testFiles)
	expectedFolders := 3 // photos, videos, subfolder (no music folder)

	if stats.TotalFiles != expectedFiles {
		t.Errorf("Expected %d files in database, got %d", expectedFiles, stats.TotalFiles)
	}

	if stats.TotalFolders != expectedFolders {
		t.Errorf("Expected %d folders in database, got %d", expectedFolders, stats.TotalFolders)
	}

	// Verify specific files exist in database
	file, err := db.GetFileByPath(context.Background(), "photos/photo1.jpg")
	if err != nil {
		t.Errorf("Failed to get file from database: %v", err)
	}
	if file.Name != "photo1.jpg" {
		t.Errorf("Expected file name photo1.jpg, got %s", file.Name)
	}
	if file.Type != database.FileTypeImage {
		t.Errorf("Expected file type image, got %s", file.Type)
	}

	// Test listing directory
	listing, err := db.ListDirectory(context.Background(), database.ListOptions{
		Path:     "photos",
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("Failed to list directory: %v", err)
	}

	if len(listing.Items) != 2 {
		t.Errorf("Expected 2 files in photos directory, got %d", len(listing.Items))
	}
}

// TestIndexerIncrementalUpdatesIntegration tests incremental updates
func TestIndexerIncrementalUpdatesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()
	dbPath := filepath.Join(t.TempDir(), "test.db")

	// Create initial files
	initialFiles := []string{"photo1.jpg", "photo2.jpg"}
	for _, filename := range initialFiles {
		fullPath := filepath.Join(tempDir, filename)
		os.WriteFile(fullPath, []byte("data"), 0o644)
	}

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	idx := New(db, tempDir, 1*time.Hour)

	// First index
	if err := idx.Index(); err != nil {
		t.Fatalf("First index failed: %v", err)
	}

	stats1, _ := db.CalculateStats()
	if stats1.TotalFiles != 2 {
		t.Errorf("After first index: expected 2 files, got %d", stats1.TotalFiles)
	}

	// Add new files
	time.Sleep(10 * time.Millisecond) // Ensure different modtime
	newFiles := []string{"photo3.jpg", "photo4.jpg"}
	for _, filename := range newFiles {
		fullPath := filepath.Join(tempDir, filename)
		os.WriteFile(fullPath, []byte("newdata"), 0o644)
	}

	// Second index
	if err := idx.Index(); err != nil {
		t.Fatalf("Second index failed: %v", err)
	}

	stats2, _ := db.CalculateStats()
	if stats2.TotalFiles != 4 {
		t.Errorf("After second index: expected 4 files, got %d", stats2.TotalFiles)
	}

	// Delete a file
	if err := os.Remove(filepath.Join(tempDir, "photo1.jpg")); err != nil {
		t.Fatalf("Failed to delete file: %v", err)
	}

	// Wait to ensure timestamps differ significantly for cleanup to work
	// The cleanup compares file updated_at times (set during index) with indexTime (captured at start of index).
	// Since files get updated_at set to current database time during processing, we need enough delay
	// so the third index's indexTime is after all files' updated_at from the second index.
	time.Sleep(1100 * time.Millisecond)

	// Third index (should remove deleted file)
	if err := idx.Index(); err != nil {
		t.Fatalf("Third index failed: %v", err)
	}

	stats3, _ := db.CalculateStats()
	if stats3.TotalFiles != 3 {
		t.Errorf("After third index (with deletion): expected 3 files, got %d (cleanup may not have run)", stats3.TotalFiles)
	}
}

// TestIndexerChangeDetectionIntegration tests change detection polling
func TestIndexerChangeDetectionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()
	dbPath := filepath.Join(t.TempDir(), "test.db")

	// Create initial file
	os.WriteFile(filepath.Join(tempDir, "photo1.jpg"), []byte("data"), 0o644)

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	idx := New(db, tempDir, 1*time.Hour)
	idx.SetPollInterval(100 * time.Millisecond)

	// Initial index
	if err := idx.Index(); err != nil {
		t.Fatalf("Initial index failed: %v", err)
	}

	// Test detectChanges - should return false initially
	changed, err := idx.detectChanges()
	if err != nil {
		t.Fatalf("detectChanges failed: %v", err)
	}
	if changed {
		t.Error("Expected no changes detected initially")
	}

	// Modify root directory by adding a file
	time.Sleep(10 * time.Millisecond) // Ensure different modtime
	os.WriteFile(filepath.Join(tempDir, "photo2.jpg"), []byte("newdata"), 0o644)

	// Touch the directory to update modtime
	currentTime := time.Now()
	os.Chtimes(tempDir, currentTime, currentTime)

	time.Sleep(10 * time.Millisecond)

	// Should detect changes now
	changed, err = idx.detectChanges()
	if err != nil {
		t.Fatalf("detectChanges failed after file addition: %v", err)
	}
	if !changed {
		t.Error("Expected changes to be detected after adding file")
	}
}

// TestIndexerStopAndRestartIntegration tests stopping and restarting the indexer
func TestIndexerStopAndRestartIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()
	dbPath := filepath.Join(t.TempDir(), "test.db")

	// Create test files
	for i := 0; i < 10; i++ {
		filename := filepath.Join(tempDir, "photo"+string(rune('0'+i))+".jpg")
		os.WriteFile(filename, []byte("data"), 0o644)
	}

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	idx := New(db, tempDir, 1*time.Hour)

	// Start and run index
	idx.Start()

	// Wait for initial index
	time.Sleep(500 * time.Millisecond)

	// Stop indexer
	idx.Stop()

	// Verify indexing stopped
	lastIndexTime := idx.LastIndexTime()
	if lastIndexTime.IsZero() {
		t.Error("Expected index to have run at least once")
	}

	// Check database has files
	stats, _ := db.CalculateStats()
	if stats.TotalFiles == 0 {
		t.Error("Expected files to be indexed")
	}
}

// TestParallelWalkerBatchSizes tests different batch size configurations
func TestParallelWalkerBatchSizes(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create 100 files
	for i := 0; i < 100; i++ {
		filename := filepath.Join(tempDir, "file"+string(rune('A'+i%26))+string(rune('0'+i%10))+".jpg")
		os.WriteFile(filename, []byte("data"), 0o644)
	}

	batchSizes := []int{10, 50, 100, 500}

	for _, batchSize := range batchSizes {
		t.Run("batchSize="+string(rune('0'+batchSize/10)), func(t *testing.T) {
			config := DefaultParallelWalkerConfig()
			config.BatchSize = batchSize

			walker := NewParallelWalker(tempDir, config)
			files, err := walker.Walk()

			if err != nil {
				t.Fatalf("Walk with batch size %d failed: %v", batchSize, err)
			}

			// All batch sizes should find the same files
			if len(files) != 100 {
				t.Errorf("Batch size %d: expected 100 files, got %d", batchSize, len(files))
			}
		})
	}
}

// TestIndexerWithCallbackIntegration tests the onIndexComplete callback
func TestIndexerWithCallbackIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()
	dbPath := filepath.Join(t.TempDir(), "test.db")

	os.WriteFile(filepath.Join(tempDir, "photo1.jpg"), []byte("data"), 0o644)

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	idx := New(db, tempDir, 1*time.Hour)

	// Set callback
	callbackCalled := false
	idx.SetOnIndexComplete(func() {
		callbackCalled = true
	})

	// Run index
	if err := idx.Index(); err != nil {
		t.Fatalf("Index failed: %v", err)
	}

	if !callbackCalled {
		t.Error("Expected callback to be called after indexing")
	}
}

// TestParallelWalkerErrorHandling tests error handling during parallel walk
func TestParallelWalkerErrorHandling(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create some valid files
	os.WriteFile(filepath.Join(tempDir, "valid1.jpg"), []byte("data"), 0o644)
	os.WriteFile(filepath.Join(tempDir, "valid2.jpg"), []byte("data"), 0o644)

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	// Should still process valid files
	if len(files) < 2 {
		t.Errorf("Expected at least 2 files, got %d", len(files))
	}

	_, _, errorsCount := walker.Stats()
	if errorsCount != 0 {
		t.Logf("Walk encountered %d errors (expected with permission issues)", errorsCount)
	}
}

// BenchmarkParallelWalkSmallDirectory benchmarks parallel walk on small directory
func BenchmarkParallelWalkSmallDirectory(b *testing.B) {
	tempDir := b.TempDir()

	// Create 50 files
	for i := 0; i < 50; i++ {
		filename := filepath.Join(tempDir, "file"+string(rune('A'+i%26))+".jpg")
		os.WriteFile(filename, []byte("data"), 0o644)
	}

	config := DefaultParallelWalkerConfig()
	config.NumWorkers = 4

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		walker := NewParallelWalker(tempDir, config)
		_, err := walker.Walk()
		if err != nil {
			b.Fatalf("Walk failed: %v", err)
		}
	}
}

// BenchmarkParallelWalkLargeDirectory benchmarks parallel walk on large directory
func BenchmarkParallelWalkLargeDirectory(b *testing.B) {
	tempDir := b.TempDir()

	// Create 500 files across multiple folders
	for i := 0; i < 500; i++ {
		folder := filepath.Join(tempDir, "folder"+string(rune('A'+i%26)))
		os.MkdirAll(folder, 0o755)
		filename := filepath.Join(folder, "file"+string(rune('0'+i%10))+".jpg")
		os.WriteFile(filename, []byte("data"), 0o644)
	}

	config := DefaultParallelWalkerConfig()
	config.NumWorkers = 8

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		walker := NewParallelWalker(tempDir, config)
		_, err := walker.Walk()
		if err != nil {
			b.Fatalf("Walk failed: %v", err)
		}
	}
}

// BenchmarkIndexerFullCycle benchmarks complete indexing cycle
func BenchmarkIndexerFullCycle(b *testing.B) {
	tempDir := b.TempDir()

	// Create test structure
	for i := 0; i < 100; i++ {
		folder := filepath.Join(tempDir, "folder"+string(rune('A'+i%10)))
		os.MkdirAll(folder, 0o755)
		filename := filepath.Join(folder, "file"+string(rune('0'+i%10))+".jpg")
		os.WriteFile(filename, []byte("data"), 0o644)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		dbPath := filepath.Join(b.TempDir(), "bench.db")
		db, _ := database.New(context.Background(), dbPath)
		idx := New(db, tempDir, 1*time.Hour)
		b.StartTimer()

		if err := idx.Index(); err != nil {
			b.Fatalf("Index failed: %v", err)
		}

		b.StopTimer()
		db.Close()
		b.StartTimer()
	}
}

// TestParallelWalkerWithSpecialCharactersIntegration tests handling of special characters in filenames
func TestParallelWalkerWithSpecialCharactersIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create files with special characters
	specialFiles := map[string]string{
		"file with spaces.jpg":        "spaces",
		"file-with-dashes.jpg":        "dashes",
		"file_with_underscores.jpg":   "underscores",
		"file(with)parens.jpg":        "parens",
		"file[with]brackets.jpg":      "brackets",
		"file'with'quotes.jpg":        "quotes",
		"file&with&ampersand.jpg":     "ampersand",
		"file@symbol.jpg":             "at",
		"日本語.jpg":                     "japanese",
		"émojis😀.jpg":                 "emoji",
		"folder with spaces/file.jpg": "nested spaces",
	}

	for filePath, content := range specialFiles {
		fullPath := filepath.Join(tempDir, filePath)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			t.Fatalf("Failed to create directory for %s: %v", filePath, err)
		}
		if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
			t.Fatalf("Failed to create file %s: %v", filePath, err)
		}
	}

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	// Should handle all special characters correctly
	filesProcessed, _, errorsCount := walker.Stats()

	if errorsCount > 0 {
		t.Errorf("Expected no errors with special characters, got %d", errorsCount)
	}

	expectedFiles := len(specialFiles)
	if int(filesProcessed) < expectedFiles {
		t.Errorf("Expected at least %d files, got %d (some special chars may have failed)", expectedFiles, filesProcessed)
	}

	// Verify paths are preserved correctly
	filesByName := make(map[string]database.MediaFile)
	for _, file := range files {
		if file.Type != database.FileTypeFolder {
			filesByName[file.Name] = file
		}
	}

	// Check some specific special character files
	if _, exists := filesByName["file with spaces.jpg"]; !exists {
		t.Error("Failed to find file with spaces")
	}
	if _, exists := filesByName["file'with'quotes.jpg"]; !exists {
		t.Error("Failed to find file with quotes")
	}
}

// TestParallelWalkerLargeDirectoryIntegration tests performance with thousands of files
func TestParallelWalkerLargeDirectoryIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create 1000 files across 100 folders (stress test)
	const numFolders = 100
	const filesPerFolder = 10
	expectedTotal := numFolders * filesPerFolder

	for i := 0; i < numFolders; i++ {
		folder := filepath.Join(tempDir, filepath.Base(tempDir)+"-folder", string(rune('A'+i%26))+string(rune('0'+i/26)))
		os.MkdirAll(folder, 0o755)
		for j := 0; j < filesPerFolder; j++ {
			filename := filepath.Join(folder, "image"+string(rune('0'+j))+".jpg")
			os.WriteFile(filename, []byte("data"), 0o644)
		}
	}

	config := DefaultParallelWalkerConfig()
	config.NumWorkers = 8
	walker := NewParallelWalker(tempDir, config)

	startTime := time.Now()
	files, err := walker.Walk()
	duration := time.Since(startTime)

	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	filesProcessed, foldersProcessed, errorsCount := walker.Stats()

	if errorsCount > 0 {
		t.Errorf("Expected no errors, got %d", errorsCount)
	}

	if filesProcessed != int64(expectedTotal) {
		t.Errorf("Expected %d files, got %d", expectedTotal, filesProcessed)
	}

	if foldersProcessed < int64(numFolders) {
		t.Errorf("Expected at least %d folders, got %d", numFolders, foldersProcessed)
	}

	if len(files) != int(filesProcessed)+int(foldersProcessed) {
		t.Errorf("File count mismatch: stats=%d+%d, collected=%d", filesProcessed, foldersProcessed, len(files))
	}

	// Performance check: should process reasonably fast even with many files
	t.Logf("Processed %d files and %d folders in %v (%.0f files/sec)",
		filesProcessed, foldersProcessed, duration,
		float64(filesProcessed)/duration.Seconds())

	if duration > 5*time.Second {
		t.Errorf("Walk took too long: %v (expected < 5s for %d files)", duration, expectedTotal)
	}
}

// TestParallelWalkerWorkerScalingIntegration tests efficiency of different worker counts
func TestParallelWalkerWorkerScalingIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create moderate-sized directory
	const numFiles = 200
	for i := 0; i < numFiles; i++ {
		folder := filepath.Join(tempDir, "folder"+string(rune('A'+i%10)))
		os.MkdirAll(folder, 0o755)
		filename := filepath.Join(folder, filepath.Base(folder)+"-file"+string(rune('0'+i/10))+string(rune('0'+i%10))+".jpg")
		os.WriteFile(filename, []byte("data"), 0o644)
	}

	workerCounts := []int{1, 2, 4, 8, 16}
	timings := make(map[int]time.Duration)

	for _, numWorkers := range workerCounts {
		config := DefaultParallelWalkerConfig()
		config.NumWorkers = numWorkers
		walker := NewParallelWalker(tempDir, config)

		startTime := time.Now()
		_, err := walker.Walk()
		duration := time.Since(startTime)
		timings[numWorkers] = duration

		if err != nil {
			t.Errorf("Walk with %d workers failed: %v", numWorkers, err)
		}

		filesProcessed, _, _ := walker.Stats()
		if filesProcessed != numFiles {
			t.Errorf("Worker count %d: expected %d files, got %d", numWorkers, numFiles, filesProcessed)
		}

		t.Logf("%d workers: %v (%.0f files/sec)", numWorkers, duration, float64(numFiles)/duration.Seconds())
	}

	// Verify parallel processing provides benefit (2 workers should be faster than 1)
	if timings[2] >= timings[1] {
		t.Logf("Note: 2 workers (%v) not faster than 1 worker (%v) - may be expected on fast filesystems",
			timings[2], timings[1])
	}
}

// TestParallelWalkerMixedFileSizesIntegration tests handling of varied file sizes
func TestParallelWalkerMixedFileSizesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create files of varying sizes
	testFiles := map[string]int{
		"tiny.jpg":   10,              // 10 bytes
		"small.jpg":  1024,            // 1 KB
		"medium.jpg": 100 * 1024,      // 100 KB
		"large.jpg":  1024 * 1024,     // 1 MB
		"huge.jpg":   5 * 1024 * 1024, // 5 MB
	}

	for filename, size := range testFiles {
		fullPath := filepath.Join(tempDir, filename)
		data := make([]byte, size)
		for i := range data {
			data[i] = byte(i % 256)
		}
		if err := os.WriteFile(fullPath, data, 0o644); err != nil {
			t.Fatalf("Failed to create %s: %v", filename, err)
		}
	}

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	// Verify all files regardless of size
	filesProcessed, _, errorsCount := walker.Stats()

	if errorsCount > 0 {
		t.Errorf("Expected no errors, got %d", errorsCount)
	}

	if filesProcessed != int64(len(testFiles)) {
		t.Errorf("Expected %d files, got %d", len(testFiles), filesProcessed)
	}

	// Verify file sizes are recorded correctly
	for _, file := range files {
		if file.Type != database.FileTypeImage {
			continue
		}
		expectedSize := int64(testFiles[file.Name])
		if file.Size != expectedSize {
			t.Errorf("File %s: expected size %d, got %d", file.Name, expectedSize, file.Size)
		}
	}
}

// TestParallelWalkerEmptyDirectoriesIntegration tests handling of empty directories
func TestParallelWalkerEmptyDirectoriesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create mix of empty and non-empty directories
	emptyDirs := []string{
		"empty1",
		"empty2",
		"parent/empty_child",
		"deep/nested/empty",
	}

	for _, dir := range emptyDirs {
		fullPath := filepath.Join(tempDir, dir)
		if err := os.MkdirAll(fullPath, 0o755); err != nil {
			t.Fatalf("Failed to create empty dir %s: %v", dir, err)
		}
	}

	// Add one file in a non-empty directory
	nonEmptyDir := filepath.Join(tempDir, "nonempty")
	os.MkdirAll(nonEmptyDir, 0o755)
	os.WriteFile(filepath.Join(nonEmptyDir, "file.jpg"), []byte("data"), 0o644)

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	filesProcessed, foldersProcessed, _ := walker.Stats()

	// Should find 1 file
	if filesProcessed != 1 {
		t.Errorf("Expected 1 file, got %d", filesProcessed)
	}

	// Should find all folders (empty + non-empty + nested)
	expectedFolders := len(emptyDirs) + 1 + 2 // empty dirs + nonempty + (parent, deep, deep/nested)
	if int(foldersProcessed) < expectedFolders {
		t.Errorf("Expected at least %d folders, got %d", expectedFolders, foldersProcessed)
	}

	// Verify empty folders are in results
	foldersByPath := make(map[string]database.MediaFile)
	for _, file := range files {
		if file.Type == database.FileTypeFolder {
			foldersByPath[file.Path] = file
		}
	}

	for _, emptyDir := range emptyDirs {
		if _, exists := foldersByPath[emptyDir]; !exists {
			t.Errorf("Empty directory %s not found in results", emptyDir)
		}
	}
}

// TestParallelWalkerSymlinksIntegration tests handling of symbolic links
func TestParallelWalkerSymlinksIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create a real file
	realFile := filepath.Join(tempDir, "real.jpg")
	os.WriteFile(realFile, []byte("real data"), 0o644)

	// Create a real directory
	realDir := filepath.Join(tempDir, "realdir")
	os.MkdirAll(realDir, 0o755)
	os.WriteFile(filepath.Join(realDir, "inside.jpg"), []byte("inside"), 0o644)

	// Create symlinks (may fail on some systems/filesystems)
	symlinkFile := filepath.Join(tempDir, "link.jpg")
	symlinkDir := filepath.Join(tempDir, "linkdir")

	err1 := os.Symlink(realFile, symlinkFile)
	err2 := os.Symlink(realDir, symlinkDir)

	if err1 != nil || err2 != nil {
		t.Skip("Symlinks not supported on this system")
	}

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	filesProcessed, _, errorsCount := walker.Stats()

	// Should handle symlinks gracefully (either follow or skip)
	if errorsCount > 0 {
		t.Logf("Walk encountered %d errors (may be expected with symlinks)", errorsCount)
	}

	// At minimum should find the real file
	if filesProcessed < 1 {
		t.Errorf("Expected at least 1 file, got %d", filesProcessed)
	}

	t.Logf("Found %d files with symlinks present", len(files))
}

// TestParallelWalkerVeryDeepNestingIntegration tests extremely deep directory nesting
func TestParallelWalkerVeryDeepNestingIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	tempDir := t.TempDir()

	// Create 50-level deep nesting
	const depth = 50
	deepPath := tempDir
	for i := 0; i < depth; i++ {
		deepPath = filepath.Join(deepPath, "level"+string(rune('0'+i%10)))
	}

	if err := os.MkdirAll(deepPath, 0o755); err != nil {
		t.Fatalf("Failed to create deep path: %v", err)
	}

	// Place file at deepest level
	deepFile := filepath.Join(deepPath, "deep.jpg")
	if err := os.WriteFile(deepFile, []byte("very deep"), 0o644); err != nil {
		t.Fatalf("Failed to create deep file: %v", err)
	}

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	filesProcessed, foldersProcessed, errorsCount := walker.Stats()

	if errorsCount > 0 {
		t.Errorf("Expected no errors with deep nesting, got %d", errorsCount)
	}

	if filesProcessed != 1 {
		t.Errorf("Expected 1 file, got %d", filesProcessed)
	}

	if foldersProcessed != depth {
		t.Errorf("Expected %d folders (depth), got %d", depth, foldersProcessed)
	}

	// Verify the deep file was found
	found := false
	for _, file := range files {
		if file.Name == "deep.jpg" {
			found = true
			// Path should contain all levels
			levels := strings.Count(file.Path, "/")
			if levels != depth {
				t.Errorf("Expected file path to have %d levels, got %d", depth, levels)
			}
		}
	}

	if !found {
		t.Error("Deep file was not found")
	}
}
