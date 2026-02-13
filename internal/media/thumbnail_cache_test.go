package media

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestGetCacheSize_Caching tests that cache size results are cached for 2 minutes
func TestGetCacheSize_Caching(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create initial test file
	content1 := []byte("thumbnail data 1")
	file1 := filepath.Join(tmpDir, "thumb1.jpg")
	if err := os.WriteFile(file1, content1, 0o644); err != nil {
		t.Fatalf("Failed to create file1: %v", err)
	}

	// First call should calculate
	size1, count1, err := gen.GetCacheSize()
	if err != nil {
		t.Fatalf("First GetCacheSize() error: %v", err)
	}
	if size1 != int64(len(content1)) {
		t.Errorf("Expected size=%d, got %d", len(content1), size1)
	}
	if count1 != 1 {
		t.Errorf("Expected count=1, got %d", count1)
	}

	// Add another file
	content2 := []byte("thumbnail data 2 with more content")
	file2 := filepath.Join(tmpDir, "thumb2.jpg")
	if err := os.WriteFile(file2, content2, 0o644); err != nil {
		t.Fatalf("Failed to create file2: %v", err)
	}

	// Second call immediately should return CACHED values (not see file2)
	size2, count2, err := gen.GetCacheSize()
	if err != nil {
		t.Fatalf("Second GetCacheSize() error: %v", err)
	}
	if size2 != size1 {
		t.Errorf("Expected cached size=%d, got %d (cache not working)", size1, size2)
	}
	if count2 != count1 {
		t.Errorf("Expected cached count=%d, got %d (cache not working)", count1, count2)
	}

	// Manually expire cache by setting timestamp to old value
	gen.lastCacheUpdate.Store(time.Now().Unix() - 121) // 121 seconds ago

	// Third call should recalculate and see both files
	size3, count3, err := gen.GetCacheSize()
	if err != nil {
		t.Fatalf("Third GetCacheSize() error: %v", err)
	}
	expectedSize := int64(len(content1) + len(content2))
	if size3 != expectedSize {
		t.Errorf("Expected recalculated size=%d, got %d", expectedSize, size3)
	}
	if count3 != 2 {
		t.Errorf("Expected recalculated count=2, got %d", count3)
	}
}

// TestGetCacheSize_ConcurrentAccess tests that concurrent calls don't cause races
func TestGetCacheSize_ConcurrentAccess(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create test files
	for i := 0; i < 10; i++ {
		content := []byte("thumbnail data")
		file := filepath.Join(tmpDir, fmt.Sprintf("thumb%d.jpg", i))
		if err := os.WriteFile(file, content, 0o644); err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}
	}

	// Call GetCacheSize concurrently
	var wg sync.WaitGroup
	errors := make(chan error, 50)

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := gen.GetCacheSize()
			if err != nil {
				errors <- err
			}
		}()
	}

	wg.Wait()
	close(errors)

	// Check for errors
	for err := range errors {
		t.Errorf("Concurrent GetCacheSize() error: %v", err)
	}
}

// TestGetCacheSize_FallbackOnError tests that cached values are returned on filesystem errors
func TestGetCacheSize_FallbackOnError(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create initial test file
	content := []byte("thumbnail data")
	file := filepath.Join(tmpDir, "thumb1.jpg")
	if err := os.WriteFile(file, content, 0o644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}

	// First call to populate cache
	size1, count1, err := gen.GetCacheSize()
	if err != nil {
		t.Fatalf("First GetCacheSize() error: %v", err)
	}

	// Expire cache
	gen.lastCacheUpdate.Store(time.Now().Unix() - 121)

	// Remove read permissions to cause error
	if err := os.Chmod(tmpDir, 0o000); err != nil {
		t.Fatalf("Failed to remove permissions: %v", err)
	}
	defer os.Chmod(tmpDir, 0o755) // Restore for cleanup

	// Should return cached values despite error
	size2, count2, _ := gen.GetCacheSize()
	// err may or may not be nil (we return cached on error)
	if size2 != size1 {
		t.Errorf("Expected fallback to cached size=%d, got %d", size1, size2)
	}
	if count2 != count1 {
		t.Errorf("Expected fallback to cached count=%d, got %d", count1, count2)
	}
}

// BenchmarkGetCacheSize_Fresh benchmarks cache size calculation without cache
func BenchmarkGetCacheSize_Fresh(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create many test files to simulate real cache
	for i := 0; i < 1000; i++ {
		content := []byte("thumbnail data for testing")
		file := filepath.Join(tmpDir, fmt.Sprintf("thumb%d.jpg", i))
		if err := os.WriteFile(file, content, 0o644); err != nil {
			b.Fatalf("Failed to create test file: %v", err)
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Expire cache each time to force recalculation
		gen.lastCacheUpdate.Store(0)
		_, _, err := gen.GetCacheSize()
		if err != nil {
			b.Fatalf("GetCacheSize() error: %v", err)
		}
	}
}

// BenchmarkGetCacheSize_Cached benchmarks cache size retrieval from cache
func BenchmarkGetCacheSize_Cached(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create many test files
	for i := 0; i < 1000; i++ {
		content := []byte("thumbnail data for testing")
		file := filepath.Join(tmpDir, fmt.Sprintf("thumb%d.jpg", i))
		if err := os.WriteFile(file, content, 0o644); err != nil {
			b.Fatalf("Failed to create test file: %v", err)
		}
	}

	// Populate cache once
	_, _, err := gen.GetCacheSize()
	if err != nil {
		b.Fatalf("Initial GetCacheSize() error: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, err := gen.GetCacheSize()
		if err != nil {
			b.Fatalf("GetCacheSize() error: %v", err)
		}
	}
}

// BenchmarkGetCacheSize_LargeCache benchmarks with a very large cache (simulating production)
func BenchmarkGetCacheSize_LargeCache(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping large cache benchmark in short mode")
	}

	tmpDir := b.TempDir()
	mediaDir := b.TempDir()
	gen := NewThumbnailGenerator(tmpDir, mediaDir, true, nil, time.Hour, nil)

	// Create 10,000 files to simulate large production cache
	for i := 0; i < 10000; i++ {
		content := []byte("thumbnail data for testing performance")
		file := filepath.Join(tmpDir, fmt.Sprintf("thumb%d.jpg", i))
		if err := os.WriteFile(file, content, 0o644); err != nil {
			b.Fatalf("Failed to create test file: %v", err)
		}
	}

	b.ResetTimer()
	b.Run("Fresh", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			gen.lastCacheUpdate.Store(0)
			_, _, err := gen.GetCacheSize()
			if err != nil {
				b.Fatalf("GetCacheSize() error: %v", err)
			}
		}
	})

	b.Run("Cached", func(b *testing.B) {
		// Populate cache once
		gen.lastCacheUpdate.Store(0)
		_, _, err := gen.GetCacheSize()
		if err != nil {
			b.Fatalf("Initial GetCacheSize() error: %v", err)
		}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _, err := gen.GetCacheSize()
			if err != nil {
				b.Fatalf("GetCacheSize() error: %v", err)
			}
		}
	})
}
