package indexer

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"media-viewer/internal/database"
)

// TestNewParallelWalkerConfiguration tests NewParallelWalker with various configurations
func TestNewParallelWalkerConfiguration(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		mediaDir  string
		config    ParallelWalkerConfig
		expectNil bool
	}{
		{
			name:     "default config",
			mediaDir: "/test/media",
			config:   DefaultParallelWalkerConfig(),
		},
		{
			name:     "custom workers",
			mediaDir: "/test/media2",
			config: ParallelWalkerConfig{
				NumWorkers:    2,
				BatchSize:     100,
				ChannelBuffer: 500,
				SkipHidden:    true,
			},
		},
		{
			name:     "single worker",
			mediaDir: "/test/media3",
			config: ParallelWalkerConfig{
				NumWorkers:    1,
				BatchSize:     50,
				ChannelBuffer: 100,
				SkipHidden:    false,
			},
		},
		{
			name:     "large buffer",
			mediaDir: "/test/media4",
			config: ParallelWalkerConfig{
				NumWorkers:    16,
				BatchSize:     1000,
				ChannelBuffer: 5000,
				SkipHidden:    true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			walker := NewParallelWalker(tt.mediaDir, tt.config)

			if walker == nil {
				t.Fatal("Expected non-nil walker")
			}

			if walker.mediaDir != tt.mediaDir {
				t.Errorf("Expected mediaDir=%s, got %s", tt.mediaDir, walker.mediaDir)
			}

			if walker.config.NumWorkers != tt.config.NumWorkers {
				t.Errorf("Expected NumWorkers=%d, got %d", tt.config.NumWorkers, walker.config.NumWorkers)
			}

			if walker.config.BatchSize != tt.config.BatchSize {
				t.Errorf("Expected BatchSize=%d, got %d", tt.config.BatchSize, walker.config.BatchSize)
			}

			if walker.config.ChannelBuffer != tt.config.ChannelBuffer {
				t.Errorf("Expected ChannelBuffer=%d, got %d", tt.config.ChannelBuffer, walker.config.ChannelBuffer)
			}

			if walker.config.SkipHidden != tt.config.SkipHidden {
				t.Errorf("Expected SkipHidden=%v, got %v", tt.config.SkipHidden, walker.config.SkipHidden)
			}

			// Check channels are initialized
			if walker.jobs == nil {
				t.Error("Expected jobs channel to be initialized")
			}

			if walker.results == nil {
				t.Error("Expected results channel to be initialized")
			}

			// Check context is initialized
			if walker.ctx == nil {
				t.Error("Expected context to be initialized")
			}

			// Verify we can cancel the context
			walker.Stop()
			select {
			case <-walker.ctx.Done():
				// Good, context was canceled
			case <-time.After(100 * time.Millisecond):
				t.Error("Expected context to be canceled after Stop()")
			}
		})
	}
}

// TestParallelWalkerStatsOperations tests atomic statistics operations
func TestParallelWalkerStatsOperations(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	// Initial stats should be zero
	files, folders, errors := walker.Stats()
	if files != 0 || folders != 0 || errors != 0 {
		t.Errorf("Expected initial stats to be (0,0,0), got (%d,%d,%d)", files, folders, errors)
	}

	// Manually update stats (simulating worker updates)
	walker.filesProcessed.Add(10)
	walker.foldersProcessed.Add(5)
	walker.errorsCount.Add(2)

	files, folders, errors = walker.Stats()
	if files != 10 {
		t.Errorf("Expected 10 files, got %d", files)
	}
	if folders != 5 {
		t.Errorf("Expected 5 folders, got %d", folders)
	}
	if errors != 2 {
		t.Errorf("Expected 2 errors, got %d", errors)
	}

	// Test multiple increments
	for i := 0; i < 100; i++ {
		walker.filesProcessed.Add(1)
	}

	files, _, _ = walker.Stats()
	if files != 110 {
		t.Errorf("Expected 110 files after increments, got %d", files)
	}
}

// TestParallelWalkerProcessFile tests the processFile method
func TestParallelWalkerProcessFile(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	tests := []struct {
		name        string
		setupFile   func() fileJob
		expectFile  bool
		expectIsDir bool
		expectType  database.FileType
		expectErr   bool
	}{
		{
			name: "image file",
			setupFile: func() fileJob {
				path := filepath.Join(tempDir, "test.jpg")
				os.WriteFile(path, []byte("fake"), 0o644)
				info, _ := os.Stat(path)
				return fileJob{
					path:    path,
					info:    info,
					relPath: "test.jpg",
				}
			},
			expectFile:  true,
			expectIsDir: false,
			expectType:  database.FileTypeImage,
		},
		{
			name: "video file",
			setupFile: func() fileJob {
				path := filepath.Join(tempDir, "video.mp4")
				os.WriteFile(path, []byte("fake"), 0o644)
				info, _ := os.Stat(path)
				return fileJob{
					path:    path,
					info:    info,
					relPath: "video.mp4",
				}
			},
			expectFile:  true,
			expectIsDir: false,
			expectType:  database.FileTypeVideo,
		},
		{
			name: "audio file",
			setupFile: func() fileJob {
				path := filepath.Join(tempDir, "audio.mp3")
				os.WriteFile(path, []byte("fake"), 0o644)
				info, _ := os.Stat(path)
				return fileJob{
					path:    path,
					info:    info,
					relPath: "audio.mp3",
				}
			},
			expectFile:  false, // Audio files are filtered out (FileTypeOther)
			expectIsDir: false,
		},
		{
			name: "directory",
			setupFile: func() fileJob {
				path := filepath.Join(tempDir, "testdir")
				os.Mkdir(path, 0o755)
				info, _ := os.Stat(path)
				return fileJob{
					path:    path,
					info:    info,
					relPath: "testdir",
				}
			},
			expectFile:  true,
			expectIsDir: true,
			expectType:  database.FileTypeFolder,
		},
		{
			name: "non-media file",
			setupFile: func() fileJob {
				path := filepath.Join(tempDir, "document.txt")
				os.WriteFile(path, []byte("text"), 0o644)
				info, _ := os.Stat(path)
				return fileJob{
					path:    path,
					info:    info,
					relPath: "document.txt",
				}
			},
			expectFile: false,
		},
		{
			name: "nested file",
			setupFile: func() fileJob {
				dirPath := filepath.Join(tempDir, "nested", "deep")
				os.MkdirAll(dirPath, 0o755)
				path := filepath.Join(dirPath, "photo.jpg")
				os.WriteFile(path, []byte("photo"), 0o644)
				info, _ := os.Stat(path)
				return fileJob{
					path:    path,
					info:    info,
					relPath: "nested/deep/photo.jpg",
				}
			},
			expectFile:  true,
			expectIsDir: false,
			expectType:  database.FileTypeImage,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			job := tt.setupFile()
			result := walker.processFile(job)

			if tt.expectErr {
				if result.err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if result.err != nil {
				t.Errorf("Unexpected error: %v", result.err)
			}

			if (result.file != nil) != tt.expectFile {
				t.Errorf("Expected file presence=%v, got %v", tt.expectFile, result.file != nil)
			}

			if result.isDir != tt.expectIsDir {
				t.Errorf("Expected isDir=%v, got %v", tt.expectIsDir, result.isDir)
			}

			if result.file != nil {
				if result.file.Type != tt.expectType {
					t.Errorf("Expected type=%s, got %s", tt.expectType, result.file.Type)
				}

				if result.file.Path != job.relPath {
					t.Errorf("Expected path=%s, got %s", job.relPath, result.file.Path)
				}

				if result.file.FileHash == "" {
					t.Error("Expected FileHash to be set")
				}

				// Verify parent path is correct
				expectedParent := filepath.Dir(job.relPath)
				if expectedParent == "." {
					expectedParent = ""
				}
				if result.file.ParentPath != expectedParent {
					t.Errorf("Expected ParentPath=%s, got %s", expectedParent, result.file.ParentPath)
				}
			}
		})
	}
}

// TestParallelWalkerContextCancellation tests context cancellation handling
func TestParallelWalkerContextCancellation(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()

	// Create some files
	for i := 0; i < 10; i++ {
		filename := filepath.Join(tempDir, "file"+string(rune('0'+i))+".jpg")
		os.WriteFile(filename, []byte("data"), 0o644)
	}

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	// Cancel context immediately
	walker.cancel()

	// Walk should handle cancellation gracefully
	_, err := walker.Walk()

	// May return SkipAll or no error depending on timing
	if err != nil {
		t.Logf("Walk returned error after cancellation: %v", err)
	}
}

// TestParallelWalkerStop tests the Stop method
func TestParallelWalkerStop(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	// Call Stop multiple times (should be safe)
	walker.Stop()
	walker.Stop()
	walker.Stop()

	// Context should be done
	select {
	case <-walker.ctx.Done():
		// Good
	default:
		t.Error("Expected context to be canceled after Stop()")
	}
}

// TestParallelWalkerWithEmptyDirectory tests walking an empty directory
func TestParallelWalkerWithEmptyDirectory(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	if len(files) != 0 {
		t.Errorf("Expected 0 files in empty directory, got %d", len(files))
	}

	filesCount, foldersCount, errorsCount := walker.Stats()
	if filesCount != 0 || foldersCount != 0 || errorsCount != 0 {
		t.Errorf("Expected stats (0,0,0), got (%d,%d,%d)", filesCount, foldersCount, errorsCount)
	}
}

// TestParallelWalkerWithOnlyHiddenFiles tests walking directory with only hidden files
func TestParallelWalkerWithOnlyHiddenFiles(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()

	// Create only hidden files
	os.WriteFile(filepath.Join(tempDir, ".hidden1.jpg"), []byte("data"), 0o644)
	os.WriteFile(filepath.Join(tempDir, ".hidden2.jpg"), []byte("data"), 0o644)
	os.Mkdir(filepath.Join(tempDir, ".hiddenfolder"), 0o755)

	config := DefaultParallelWalkerConfig()
	config.SkipHidden = true
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	if len(files) != 0 {
		t.Errorf("Expected 0 files (all hidden), got %d", len(files))
	}
}

// TestParallelWalkerWithSkipHiddenFalse tests walking with SkipHidden=false
func TestParallelWalkerWithSkipHiddenFalse(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()

	// Create hidden and visible files
	os.WriteFile(filepath.Join(tempDir, ".hidden.jpg"), []byte("data"), 0o644)
	os.WriteFile(filepath.Join(tempDir, "visible.jpg"), []byte("data"), 0o644)

	config := DefaultParallelWalkerConfig()
	config.SkipHidden = false
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	// Should include both files
	if len(files) != 2 {
		t.Errorf("Expected 2 files (including hidden), got %d", len(files))
	}
}

// TestParallelWalkerFileHashConsistency tests that file hashes are consistent
func TestParallelWalkerFileHashConsistency(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()

	// Create a test file
	testFile := filepath.Join(tempDir, "test.jpg")
	os.WriteFile(testFile, []byte("consistent data"), 0o644)

	config := DefaultParallelWalkerConfig()
	walker1 := NewParallelWalker(tempDir, config)
	walker2 := NewParallelWalker(tempDir, config)

	files1, _ := walker1.Walk()
	time.Sleep(10 * time.Millisecond) // Small delay
	files2, _ := walker2.Walk()

	if len(files1) != 1 || len(files2) != 1 {
		t.Fatalf("Expected 1 file from each walk")
	}

	// File hashes should be the same if file hasn't changed
	if files1[0].FileHash != files2[0].FileHash {
		t.Errorf("Expected consistent file hashes, got %s and %s", files1[0].FileHash, files2[0].FileHash)
	}
}

// TestParallelWalkerFileHashChanges tests that file hashes change when file changes
func TestParallelWalkerFileHashChanges(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	testFile := filepath.Join(tempDir, "test.jpg")

	// Create initial file
	os.WriteFile(testFile, []byte("original"), 0o644)

	config := DefaultParallelWalkerConfig()
	walker1 := NewParallelWalker(tempDir, config)
	files1, _ := walker1.Walk()

	if len(files1) != 1 {
		t.Fatalf("Expected 1 file")
	}
	hash1 := files1[0].FileHash

	// Modify file (change size and modtime)
	time.Sleep(10 * time.Millisecond) // Ensure different modtime
	os.WriteFile(testFile, []byte("modified with different size"), 0o644)

	walker2 := NewParallelWalker(tempDir, config)
	files2, _ := walker2.Walk()

	if len(files2) != 1 {
		t.Fatalf("Expected 1 file")
	}
	hash2 := files2[0].FileHash

	// Hashes should be different
	if hash1 == hash2 {
		t.Errorf("Expected file hash to change after modification, both are %s", hash1)
	}
}

// TestParallelWalkerMixedFileTypes tests processing of mixed media types
func TestParallelWalkerMixedFileTypes(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()

	// Create various file types
	files := map[string]database.FileType{
		"image.jpg": database.FileTypeImage,
		"image.png": database.FileTypeImage,
		"video.mp4": database.FileTypeVideo,
		"video.avi": database.FileTypeVideo,
	}

	for filename := range files {
		os.WriteFile(filepath.Join(tempDir, filename), []byte("data"), 0o644)
	}

	// Also create non-media files that should be filtered
	os.WriteFile(filepath.Join(tempDir, "document.txt"), []byte("text"), 0o644)
	os.WriteFile(filepath.Join(tempDir, "readme.md"), []byte("markdown"), 0o644)

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	results, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	// Should only have media files
	if len(results) != len(files) {
		t.Errorf("Expected %d media files, got %d", len(files), len(results))
	}

	// Verify each file type
	resultsByName := make(map[string]database.FileType)
	for _, file := range results {
		resultsByName[file.Name] = file.Type
	}

	for filename, expectedType := range files {
		gotType, exists := resultsByName[filename]
		if !exists {
			t.Errorf("Expected file %s to be processed", filename)
			continue
		}
		if gotType != expectedType {
			t.Errorf("File %s: expected type %s, got %s", filename, expectedType, gotType)
		}
	}
}

// TestParallelWalkerDeepNesting tests walking deeply nested directories
func TestParallelWalkerDeepNesting(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()

	// Create deeply nested structure
	deepPath := tempDir
	for i := 0; i < 10; i++ {
		deepPath = filepath.Join(deepPath, "level"+string(rune('0'+i)))
		os.MkdirAll(deepPath, 0o755)
	}

	// Create file at deepest level
	testFile := filepath.Join(deepPath, "deep.jpg")
	os.WriteFile(testFile, []byte("deep file"), 0o644)

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	// Should find 10 folders + 1 file
	filesCount, foldersCount, _ := walker.Stats()
	if foldersCount != 10 {
		t.Errorf("Expected 10 folders, got %d", foldersCount)
	}
	if filesCount != 1 {
		t.Errorf("Expected 1 file, got %d", filesCount)
	}

	// Verify the file was found
	found := false
	for _, file := range files {
		if file.Name == "deep.jpg" {
			found = true
			// Check relative path includes all nesting
			if len(file.Path) < 50 { // Rough check for deep path
				t.Errorf("Expected deep path, got %s", file.Path)
			}
		}
	}

	if !found {
		t.Error("Expected to find deep.jpg")
	}
}

// TestParallelWalkerChannelBuffering tests channel buffer handling
func TestParallelWalkerChannelBuffering(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()

	// Create files
	for i := 0; i < 20; i++ {
		filename := filepath.Join(tempDir, "file"+string(rune('0'+i))+".jpg")
		os.WriteFile(filename, []byte("data"), 0o644)
	}

	// Test with small buffer
	config := DefaultParallelWalkerConfig()
	config.ChannelBuffer = 2 // Very small buffer
	config.NumWorkers = 2

	walker := NewParallelWalker(tempDir, config)
	files, err := walker.Walk()

	if err != nil {
		t.Fatalf("Walk with small buffer failed: %v", err)
	}

	if len(files) != 20 {
		t.Errorf("Expected 20 files with small buffer, got %d", len(files))
	}
}

// TestParallelWalkerConcurrentStats tests concurrent stats access
func TestParallelWalkerConcurrentStats(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	// Simulate concurrent updates and reads
	done := make(chan struct{})
	const goroutines = 10
	const operations = 100

	// Writers
	for i := 0; i < goroutines; i++ {
		go func() {
			for j := 0; j < operations; j++ {
				walker.filesProcessed.Add(1)
				walker.foldersProcessed.Add(1)
			}
			done <- struct{}{}
		}()
	}

	// Readers
	for i := 0; i < goroutines; i++ {
		go func() {
			for j := 0; j < operations; j++ {
				walker.Stats()
			}
			done <- struct{}{}
		}()
	}

	// Wait for all goroutines
	for i := 0; i < goroutines*2; i++ {
		<-done
	}

	// Verify final counts
	files, folders, _ := walker.Stats()
	expectedCount := int64(goroutines * operations)

	if files != expectedCount {
		t.Errorf("Expected %d files, got %d", expectedCount, files)
	}
	if folders != expectedCount {
		t.Errorf("Expected %d folders, got %d", expectedCount, folders)
	}
}

// TestDefaultParallelWalkerConfigValues tests default configuration values
func TestDefaultParallelWalkerConfigValues(t *testing.T) {
	t.Parallel()

	config := DefaultParallelWalkerConfig()

	if config.NumWorkers <= 0 {
		t.Error("Expected NumWorkers > 0")
	}

	if config.NumWorkers > 8 {
		t.Errorf("Expected NumWorkers <= 8 for I/O bound operations, got %d", config.NumWorkers)
	}

	if config.BatchSize != 500 {
		t.Errorf("Expected BatchSize=500, got %d", config.BatchSize)
	}

	if config.ChannelBuffer != 1000 {
		t.Errorf("Expected ChannelBuffer=1000, got %d", config.ChannelBuffer)
	}

	if !config.SkipHidden {
		t.Error("Expected SkipHidden=true")
	}
}

// BenchmarkProcessFile benchmarks the processFile method
func BenchmarkProcessFile(b *testing.B) {
	tempDir := b.TempDir()
	testFile := filepath.Join(tempDir, "test.jpg")
	os.WriteFile(testFile, []byte("benchmark data"), 0o644)
	info, _ := os.Stat(testFile)

	job := fileJob{
		path:    testFile,
		info:    info,
		relPath: "test.jpg",
	}

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = walker.processFile(job)
	}
}

// BenchmarkParallelWalkerStats benchmarks stats access
func BenchmarkParallelWalkerStats(b *testing.B) {
	tempDir := b.TempDir()
	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	// Set some values
	walker.filesProcessed.Store(1000)
	walker.foldersProcessed.Store(100)
	walker.errorsCount.Store(5)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, _ = walker.Stats()
	}
}

// BenchmarkParallelWalkerStatsUpdate benchmarks concurrent stats updates
func BenchmarkParallelWalkerStatsUpdate(b *testing.B) {
	tempDir := b.TempDir()
	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			walker.filesProcessed.Add(1)
		}
	})
}

// TestDefaultParallelWalkerConfig_NFSWorkersDefault tests NFS worker default
func TestDefaultParallelWalkerConfig_NFSWorkersDefault(t *testing.T) {
	// Clear env var to ensure default behavior
	oldValue := os.Getenv("INDEX_WORKERS")
	os.Unsetenv("INDEX_WORKERS")
	defer func() {
		if oldValue != "" {
			os.Setenv("INDEX_WORKERS", oldValue)
		}
	}()

	config := DefaultParallelWalkerConfig()

	// Should default to 3 workers for NFS safety
	if config.NumWorkers != 3 {
		t.Errorf("NumWorkers = %d, want 3 (default NFS-friendly value)", config.NumWorkers)
	}

	if config.BatchSize != 500 {
		t.Errorf("BatchSize = %d, want 500", config.BatchSize)
	}

	if config.ChannelBuffer != 1000 {
		t.Errorf("ChannelBuffer = %d, want 1000", config.ChannelBuffer)
	}

	if !config.SkipHidden {
		t.Error("SkipHidden should be true by default")
	}
}

// TestDefaultParallelWalkerConfig_NFSWorkersEnvVar tests INDEX_WORKERS override
func TestDefaultParallelWalkerConfig_NFSWorkersEnvVar(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		want     int
	}{
		{
			name:     "INDEX_WORKERS set to 1",
			envValue: "1",
			want:     1,
		},
		{
			name:     "INDEX_WORKERS set to 5",
			envValue: "5",
			want:     5,
		},
		{
			name:     "INDEX_WORKERS set to 10",
			envValue: "10",
			want:     10,
		},
		{
			name:     "INDEX_WORKERS set to 16",
			envValue: "16",
			want:     16,
		},
		{
			name:     "INDEX_WORKERS invalid (non-numeric)",
			envValue: "invalid",
			want:     3, // Falls back to default
		},
		{
			name:     "INDEX_WORKERS invalid (negative)",
			envValue: "-5",
			want:     3, // Falls back to default
		},
		{
			name:     "INDEX_WORKERS invalid (zero)",
			envValue: "0",
			want:     3, // Falls back to default
		},
		{
			name:     "INDEX_WORKERS empty string",
			envValue: "",
			want:     3, // Falls back to default (or ForIO calculation, depends on implementation)
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			oldValue := os.Getenv("INDEX_WORKERS")
			if tt.envValue == "" {
				os.Unsetenv("INDEX_WORKERS")
			} else {
				os.Setenv("INDEX_WORKERS", tt.envValue)
			}
			defer func() {
				if oldValue != "" {
					os.Setenv("INDEX_WORKERS", oldValue)
				} else {
					os.Unsetenv("INDEX_WORKERS")
				}
			}()

			config := DefaultParallelWalkerConfig()

			if config.NumWorkers != tt.want {
				t.Errorf("NumWorkers = %d, want %d for INDEX_WORKERS=%q", config.NumWorkers, tt.want, tt.envValue)
			}
		})
	}
}

// TestDefaultParallelWalkerConfig_LocalFilesystemOverride tests higher worker count for local FS
func TestDefaultParallelWalkerConfig_LocalFilesystemOverride(t *testing.T) {
	// Test that default is 3 (NFS-safe), and can be overridden with INDEX_WORKERS
	oldValue := os.Getenv("INDEX_WORKERS")
	os.Unsetenv("INDEX_WORKERS")
	defer func() {
		if oldValue != "" {
			os.Setenv("INDEX_WORKERS", oldValue)
		}
	}()

	config := DefaultParallelWalkerConfig()

	// Should be 3 by default (NFS-safe)
	if config.NumWorkers != 3 {
		t.Errorf("NumWorkers = %d (expected 3 for NFS-safe default)", config.NumWorkers)
	}

	// Test with explicit local filesystem override
	os.Setenv("INDEX_WORKERS", "8")
	defer os.Unsetenv("INDEX_WORKERS")

	config = DefaultParallelWalkerConfig()
	if config.NumWorkers != 8 {
		t.Errorf("NumWorkers = %d, want 8 when INDEX_WORKERS=8", config.NumWorkers)
	}
}

// BenchmarkDefaultParallelWalkerConfig_NoEnvVar benchmarks default config creation
func BenchmarkDefaultParallelWalkerConfig_NoEnvVar(b *testing.B) {
	oldValue := os.Getenv("INDEX_WORKERS")
	os.Unsetenv("INDEX_WORKERS")
	defer func() {
		if oldValue != "" {
			os.Setenv("INDEX_WORKERS", oldValue)
		}
	}()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = DefaultParallelWalkerConfig()
	}
}

// BenchmarkDefaultParallelWalkerConfig_WithEnvVar benchmarks config with env override
func BenchmarkDefaultParallelWalkerConfig_WithEnvVar(b *testing.B) {
	oldValue := os.Getenv("INDEX_WORKERS")
	os.Setenv("INDEX_WORKERS", "5")
	defer func() {
		if oldValue != "" {
			os.Setenv("INDEX_WORKERS", oldValue)
		} else {
			os.Unsetenv("INDEX_WORKERS")
		}
	}()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = DefaultParallelWalkerConfig()
	}
}

// BenchmarkDefaultParallelWalkerConfig_InvalidEnvVar benchmarks with invalid env value
func BenchmarkDefaultParallelWalkerConfig_InvalidEnvVar(b *testing.B) {
	oldValue := os.Getenv("INDEX_WORKERS")
	os.Setenv("INDEX_WORKERS", "invalid")
	defer func() {
		if oldValue != "" {
			os.Setenv("INDEX_WORKERS", oldValue)
		} else {
			os.Unsetenv("INDEX_WORKERS")
		}
	}()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = DefaultParallelWalkerConfig()
	}
}
