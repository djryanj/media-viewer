package transcoder

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// TestGetCacheSize_Caching tests that cache size results are cached for 2 minutes
func TestGetCacheSize_Caching(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create initial test file
	content1 := []byte("transcode data 1")
	file1 := filepath.Join(tmpDir, "video1.mp4")
	if err := os.WriteFile(file1, content1, 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// First call - should calculate
	size1, count1, err := trans.GetCacheSize()
	if err != nil {
		t.Fatalf("GetCacheSize() error: %v", err)
	}

	if size1 != int64(len(content1)) {
		t.Errorf("Expected size=%d, got %d", len(content1), size1)
	}
	if count1 != 1 {
		t.Errorf("Expected count=1, got %d", count1)
	}

	// Add another file
	content2 := []byte("transcode data 2 - much longer content")
	file2 := filepath.Join(tmpDir, "video2.mp4")
	if err := os.WriteFile(file2, content2, 0o644); err != nil {
		t.Fatalf("Failed to create second test file: %v", err)
	}

	// Second call immediately - should return cached values (not see new file)
	size2, count2, err := trans.GetCacheSize()
	if err != nil {
		t.Fatalf("GetCacheSize() error: %v", err)
	}

	if size2 != size1 {
		t.Errorf("Expected cached size=%d, got %d", size1, size2)
	}
	if count2 != count1 {
		t.Errorf("Expected cached count=%d, got %d", count1, count2)
	}

	// Force cache expiration by manipulating lastCacheUpdate
	trans.lastCacheUpdate.Store(0)

	// Third call - should recalculate and see both files
	size3, count3, err := trans.GetCacheSize()
	if err != nil {
		t.Fatalf("GetCacheSize() error: %v", err)
	}

	expectedSize := int64(len(content1) + len(content2))
	if size3 != expectedSize {
		t.Errorf("Expected size=%d, got %d", expectedSize, size3)
	}
	if count3 != 2 {
		t.Errorf("Expected count=2, got %d", count3)
	}
}

// TestGetCacheSize_ConcurrentAccess tests concurrent access to GetCacheSize
func TestGetCacheSize_ConcurrentAccess(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create test files
	for i := 0; i < 10; i++ {
		content := []byte("transcode data")
		file := filepath.Join(tmpDir, fmt.Sprintf("video%d.mp4", i))
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
			_, _, err := trans.GetCacheSize()
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

// TestGetCacheSize_ErrorFallback tests fallback to cached values on filesystem errors
func TestGetCacheSize_ErrorFallback(t *testing.T) {
	tmpDir := t.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create test file
	content := []byte("transcode data")
	file := filepath.Join(tmpDir, "video.mp4")
	if err := os.WriteFile(file, content, 0o644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// First call - should succeed
	size1, count1, err := trans.GetCacheSize()
	if err != nil {
		t.Fatalf("GetCacheSize() error: %v", err)
	}

	// Force cache expiration
	trans.lastCacheUpdate.Store(0)

	// Make directory unreadable
	if err := os.Chmod(tmpDir, 0o000); err != nil {
		t.Fatalf("Failed to remove permissions: %v", err)
	}
	defer os.Chmod(tmpDir, 0o755) // Restore for cleanup

	// Should return cached values despite error
	size2, count2, _ := trans.GetCacheSize()
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
	trans := New(tmpDir, "", true, "none")

	// Create many test files to simulate real cache
	for i := 0; i < 1000; i++ {
		content := []byte("transcode data for testing")
		file := filepath.Join(tmpDir, fmt.Sprintf("video%d.mp4", i))
		if err := os.WriteFile(file, content, 0o644); err != nil {
			b.Fatalf("Failed to create test file: %v", err)
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Expire cache each time to force recalculation
		trans.lastCacheUpdate.Store(0)
		_, _, err := trans.GetCacheSize()
		if err != nil {
			b.Fatalf("GetCacheSize() error: %v", err)
		}
	}
}

// BenchmarkGetCacheSize_Cached benchmarks cache size retrieval from cache
func BenchmarkGetCacheSize_Cached(b *testing.B) {
	tmpDir := b.TempDir()
	trans := New(tmpDir, "", true, "none")

	// Create many test files
	for i := 0; i < 1000; i++ {
		content := []byte("transcode data for testing")
		file := filepath.Join(tmpDir, fmt.Sprintf("video%d.mp4", i))
		if err := os.WriteFile(file, content, 0o644); err != nil {
			b.Fatalf("Failed to create test file: %v", err)
		}
	}

	// Populate cache once
	_, _, err := trans.GetCacheSize()
	if err != nil {
		b.Fatalf("Initial GetCacheSize() error: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, err := trans.GetCacheSize()
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
	trans := New(tmpDir, "", true, "none")

	// Create 10,000 files to simulate large production cache
	for i := 0; i < 10000; i++ {
		content := []byte("transcode data for testing performance")
		file := filepath.Join(tmpDir, fmt.Sprintf("video%d.mp4", i))
		if err := os.WriteFile(file, content, 0o644); err != nil {
			b.Fatalf("Failed to create test file: %v", err)
		}
	}

	b.ResetTimer()
	b.Run("Fresh", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			trans.lastCacheUpdate.Store(0)
			_, _, err := trans.GetCacheSize()
			if err != nil {
				b.Fatalf("GetCacheSize() error: %v", err)
			}
		}
	})

	b.Run("Cached", func(b *testing.B) {
		// Populate cache once
		trans.lastCacheUpdate.Store(0)
		_, _, err := trans.GetCacheSize()
		if err != nil {
			b.Fatalf("Initial GetCacheSize() error: %v", err)
		}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _, err := trans.GetCacheSize()
			if err != nil {
				b.Fatalf("GetCacheSize() error: %v", err)
			}
		}
	})
}
