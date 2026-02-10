package metrics

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// =============================================================================
// Mock StatsProvider
// =============================================================================

type mockStatsProvider struct {
	stats Stats
}

func (m *mockStatsProvider) GetStats() Stats {
	return m.stats
}

// =============================================================================
// Collector Tests
// =============================================================================

func TestNewCollector(t *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{
			TotalFiles:     100,
			TotalFolders:   10,
			TotalImages:    80,
			TotalVideos:    20,
			TotalPlaylists: 5, TotalFavorites: 15, TotalTags: 8,
		},
	}

	collector := NewCollector(provider, "/tmp/test.db", 5*time.Second)

	if collector == nil {
		t.Fatal("NewCollector returned nil")
	}

	if collector.statsProvider != provider {
		t.Error("statsProvider not set correctly")
	}

	if collector.dbPath != "/tmp/test.db" {
		t.Errorf("dbPath = %q, want %q", collector.dbPath, "/tmp/test.db")
	}

	if collector.interval != 5*time.Second {
		t.Errorf("interval = %v, want %v", collector.interval, 5*time.Second)
	}

	if collector.stopChan == nil {
		t.Error("stopChan not initialized")
	}
}

func TestNewCollectorWithNilProvider(t *testing.T) {
	collector := NewCollector(nil, "/tmp/test.db", 5*time.Second)

	if collector == nil {
		t.Fatal("NewCollector returned nil")
	}

	if collector.statsProvider != nil {
		t.Error("statsProvider should be nil")
	}
}

func TestCollectorStartStop(_ *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 50},
	}

	collector := NewCollector(provider, "/tmp/test.db", 100*time.Millisecond)

	// Start collector
	collector.Start()

	// Let it run briefly
	time.Sleep(150 * time.Millisecond)

	// Stop collector
	collector.Stop()

	// Test should complete without hanging
}

func TestCollectorMultipleCollectCycles(_ *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{
			TotalImages: 100,
			TotalVideos: 50,
		},
	}

	collector := NewCollector(provider, "/tmp/test.db", 50*time.Millisecond)

	collector.Start()

	// Let it run through multiple collection cycles
	time.Sleep(200 * time.Millisecond)

	collector.Stop()

	// Test should complete without hanging
}

func TestCollectorWithMinimalInterval(_ *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 10},
	}

	// Very small interval should work
	collector := NewCollector(provider, "", 1*time.Millisecond)

	collector.Start()
	time.Sleep(10 * time.Millisecond)
	collector.Stop()
}

func TestCollectWithNilProvider(t *testing.T) {
	collector := NewCollector(nil, "/tmp/test.db", 1*time.Second)

	// Should not panic when collecting with nil provider
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("collect() panicked with nil provider: %v", r)
		}
	}()

	collector.collect()
}

func TestCollectMemoryMetrics(t *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)

	// Should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("collectMemoryMetrics() panicked: %v", r)
		}
	}()

	collector.collectMemoryMetrics()

	// Call again to test GC counter delta
	collector.collectMemoryMetrics()
}

func TestCollectMemoryMetricsMultipleTimes(t *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)

	// Collect multiple times to ensure GC counter tracks properly
	for i := 0; i < 5; i++ {
		collector.collectMemoryMetrics()
		// The lastGCCount should be updated each time
	}

	if collector.lastGCCount == 0 {
		t.Log("No GC runs detected (expected in short test)")
	}
}

func TestCollectDBSizeWithValidDatabase(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	// Create a test database file
	if err := os.WriteFile(dbPath, []byte("test database content"), 0o644); err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}

	collector := NewCollector(nil, dbPath, 1*time.Second)

	// Should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("collectDBSize() panicked: %v", r)
		}
	}()

	collector.collectDBSize()
}

func TestCollectDBSizeWithWALAndSHM(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	// Create database files
	if err := os.WriteFile(dbPath, []byte("main db"), 0o644); err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}
	if err := os.WriteFile(dbPath+"-wal", []byte("wal file"), 0o644); err != nil {
		t.Fatalf("failed to create WAL file: %v", err)
	}
	if err := os.WriteFile(dbPath+"-shm", []byte("shm file"), 0o644); err != nil {
		t.Fatalf("failed to create SHM file: %v", err)
	}

	collector := NewCollector(nil, dbPath, 1*time.Second)
	collector.collectDBSize()

	// Should complete without error
}

func TestCollectDBSizeWithMissingDatabase(t *testing.T) {
	collector := NewCollector(nil, "/nonexistent/path/db.db", 1*time.Second)

	// Should not panic when database doesn't exist
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("collectDBSize() panicked with missing database: %v", r)
		}
	}()

	collector.collectDBSize()
}

func TestCollectDBSizeWithEmptyPath(t *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)

	// Should not panic with empty path
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("collectDBSize() panicked with empty path: %v", r)
		}
	}()

	collector.collectDBSize()
}

func TestCollectWithStatsProvider(t *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{
			TotalFiles:     150,
			TotalFolders:   25,
			TotalImages:    100,
			TotalVideos:    45,
			TotalPlaylists: 5,
			TotalFavorites: 30,
			TotalTags:      12,
		},
	}

	collector := NewCollector(provider, "", 1*time.Second)

	// Should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("collect() panicked: %v", r)
		}
	}()

	collector.collect()
}

func TestCollectUpdatesMetrics(_ *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{
			TotalImages:    50,
			TotalVideos:    25,
			TotalPlaylists: 10,
			TotalFolders:   5,
			TotalFavorites: 15,
			TotalTags:      8,
		},
	}

	collector := NewCollector(provider, "", 1*time.Second)
	collector.collect()

	// Verify metrics can be collected again without error
	collector.collect()
}

func TestCollectorStopBeforeStart(t *testing.T) {
	provider := &mockStatsProvider{}
	collector := NewCollector(provider, "", 1*time.Second)

	// Stopping before starting should close the channel
	// This is a valid use case - the goroutine was never started
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Stop() before Start() panicked: %v", r)
		}
	}()

	collector.Stop()
	// Note: Starting after Stop() would cause issues, so we don't test that
}

func TestCollectorMultipleStops(_ *testing.T) {
	// Test that stopping multiple collectors doesn't cause issues
	// Each collector should be independent
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 10},
	}

	for i := 0; i < 3; i++ {
		collector := NewCollector(provider, "", 10*time.Millisecond)
		collector.Start()
		time.Sleep(5 * time.Millisecond)
		collector.Stop()
	}
}

func TestCollectorRapidStartStop(_ *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 10},
	}

	// Rapid start/stop cycles
	for i := 0; i < 5; i++ {
		collector := NewCollector(provider, "", 10*time.Millisecond)
		collector.Start()
		time.Sleep(5 * time.Millisecond)
		collector.Stop()
	}
}

func TestCollectorConcurrentAccess(_ *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 100},
	}

	collector := NewCollector(provider, "", 20*time.Millisecond)
	collector.Start()

	// Let multiple collection cycles run
	time.Sleep(100 * time.Millisecond)

	collector.Stop()
}

func TestStatsProviderInterface(_ *testing.T) {
	// Verify our mock implements the interface
	var _ StatsProvider = (*mockStatsProvider)(nil)
}

func TestStatsStructFields(t *testing.T) {
	stats := Stats{
		TotalFiles:     100,
		TotalFolders:   10,
		TotalImages:    80,
		TotalVideos:    15,
		TotalPlaylists: 5,

		TotalFavorites: 20,
		TotalTags:      8,
	}

	if stats.TotalFiles != 100 {
		t.Errorf("TotalFiles = %d, want 100", stats.TotalFiles)
	}
	if stats.TotalFolders != 10 {
		t.Errorf("TotalFolders = %d, want 10", stats.TotalFolders)
	}
	if stats.TotalImages != 80 {
		t.Errorf("TotalImages = %d, want 80", stats.TotalImages)
	}
	if stats.TotalVideos != 15 {
		t.Errorf("TotalVideos = %d, want 15", stats.TotalVideos)
	}
	if stats.TotalPlaylists != 5 {
		t.Errorf("TotalPlaylists = %d, want 5", stats.TotalPlaylists)
	}
	if stats.TotalFavorites != 20 {
		t.Errorf("TotalFavorites = %d, want 20", stats.TotalFavorites)
	}
	if stats.TotalTags != 8 {
		t.Errorf("TotalTags = %d, want 8", stats.TotalTags)
	}
}

func TestCollectorImmediateCollection(_ *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 50},
	}

	collector := NewCollector(provider, "", 1*time.Hour)

	// Start should trigger immediate collection
	collector.Start()

	// Give it a moment to collect
	time.Sleep(10 * time.Millisecond)

	collector.Stop()
}

func TestCollectorWithLargeStats(_ *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{
			TotalFiles:     1000000,
			TotalFolders:   50000,
			TotalImages:    800000,
			TotalVideos:    150000,
			TotalPlaylists: 50000,
			TotalFavorites: 100000,
			TotalTags:      10000,
		},
	}

	collector := NewCollector(provider, "", 1*time.Second)
	collector.collect()
}

func TestCollectorWithVeryLongInterval(t *testing.T) {
	provider := &mockStatsProvider{}

	// Very long interval should work (won't trigger during test)
	collector := NewCollector(provider, "", 1*time.Hour)

	// Should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("NewCollector with long interval panicked: %v", r)
		}
	}()

	// Start and stop immediately
	collector.Start()
	time.Sleep(5 * time.Millisecond)
	collector.Stop()
}

func TestCollectorMemoryMetricsConsistency(t *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)

	// Collect twice and verify no panic
	collector.collectMemoryMetrics()
	firstGCCount := collector.lastGCCount

	collector.collectMemoryMetrics()
	secondGCCount := collector.lastGCCount

	// GC count should not decrease
	if secondGCCount < firstGCCount {
		t.Errorf("GC count decreased: %d -> %d", firstGCCount, secondGCCount)
	}
}

func TestCollectorDBSizeWithSymlink(t *testing.T) {
	if os.Getenv("CI") != "" {
		t.Skip("Skipping symlink test in CI environment")
	}

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")
	symlinkPath := filepath.Join(tempDir, "link.db")

	// Create database file
	if err := os.WriteFile(dbPath, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to create database: %v", err)
	}

	// Create symlink
	if err := os.Symlink(dbPath, symlinkPath); err != nil {
		t.Skipf("failed to create symlink (may not be supported): %v", err)
	}

	collector := NewCollector(nil, symlinkPath, 1*time.Second)
	collector.collectDBSize()
}

func TestCollectorWithDifferentIntervals(t *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 10},
	}

	intervals := []time.Duration{
		1 * time.Millisecond,
		10 * time.Millisecond,
		50 * time.Millisecond,
		100 * time.Millisecond,
	}

	for _, interval := range intervals {
		t.Run(interval.String(), func(_ *testing.T) {
			collector := NewCollector(provider, "", interval)
			collector.Start()
			time.Sleep(interval * 3)
			collector.Stop()
		})
	}
}

func TestCollectorStopCompletesCleanly(_ *testing.T) {
	provider := &mockStatsProvider{}
	collector := NewCollector(provider, "", 50*time.Millisecond)

	// Start and stop
	collector.Start()

	// Let it run for a bit
	time.Sleep(100 * time.Millisecond)

	// Stop should complete without hanging
	collector.Stop()

	// Give goroutine time to exit
	time.Sleep(10 * time.Millisecond)

	// Test completes successfully if we get here
}
func TestCollectorTranscoderCacheSizeCollection(t *testing.T) {
	tempDir := t.TempDir()
	cacheDir := filepath.Join(tempDir, "transcoder-cache")

	// Create cache directory
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("failed to create cache dir: %v", err)
	}

	// Create some test files
	testFiles := []struct {
		name   string
		size   int
		subdir string
	}{
		{"video1.mp4", 1024 * 1024, ""},      // 1 MB
		{"video2.mp4", 512 * 1024, ""},       // 512 KB
		{"video3.mp4", 256 * 1024, "subdir"}, // 256 KB in subdirectory
	}

	var expectedSize int64
	for _, tf := range testFiles {
		var filePath string
		if tf.subdir != "" {
			subPath := filepath.Join(cacheDir, tf.subdir)
			if err := os.MkdirAll(subPath, 0o755); err != nil {
				t.Fatalf("failed to create subdir: %v", err)
			}
			filePath = filepath.Join(subPath, tf.name)
		} else {
			filePath = filepath.Join(cacheDir, tf.name)
		}

		data := make([]byte, tf.size)
		if err := os.WriteFile(filePath, data, 0o644); err != nil {
			t.Fatalf("failed to create test file: %v", err)
		}
		expectedSize += int64(tf.size)
	}

	collector := NewCollector(nil, "", 1*time.Second)
	collector.SetTranscoderCacheDir(cacheDir)
	collector.collectTranscoderCacheSize()

	// Note: We can't easily verify the metric value directly in tests
	// without exposing it or using the prometheus registry,
	// but we can verify the method doesn't panic or error
}

func TestCollectorTranscoderCacheSizeWithEmptyDir(t *testing.T) {
	tempDir := t.TempDir()
	cacheDir := filepath.Join(tempDir, "empty-cache")

	// Create empty cache directory
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("failed to create cache dir: %v", err)
	}

	collector := NewCollector(nil, "", 1*time.Second)
	collector.SetTranscoderCacheDir(cacheDir)
	collector.collectTranscoderCacheSize()
}

func TestCollectorTranscoderCacheSizeWithNonexistentDir(_ *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)
	collector.SetTranscoderCacheDir("/nonexistent/cache/dir")

	// Should not panic, should set metric to 0
	collector.collectTranscoderCacheSize()
}

func TestCollectorSetTranscoderCacheDir(t *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)

	if collector.transcoderCacheDir != "" {
		t.Errorf("initial transcoderCacheDir should be empty, got %q", collector.transcoderCacheDir)
	}

	testPath := "/path/to/cache"
	collector.SetTranscoderCacheDir(testPath)

	if collector.transcoderCacheDir != testPath {
		t.Errorf("transcoderCacheDir = %q, want %q", collector.transcoderCacheDir, testPath)
	}
}

func TestCollectorGetDirSize(t *testing.T) {
	tempDir := t.TempDir()

	// Create test files
	files := []struct {
		path string
		size int
	}{
		{"file1.txt", 100},
		{"file2.txt", 200},
		{"subdir/file3.txt", 300},
	}

	var expectedSize int64
	for _, f := range files {
		path := filepath.Join(tempDir, f.path)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("failed to create directory: %v", err)
		}
		data := make([]byte, f.size)
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatalf("failed to create file: %v", err)
		}
		expectedSize += int64(f.size)
	}

	collector := NewCollector(nil, "", 1*time.Second)
	size, err := collector.getDirSize(tempDir)
	if err != nil {
		t.Fatalf("getDirSize failed: %v", err)
	}

	if size != expectedSize {
		t.Errorf("getDirSize() = %d, want %d", size, expectedSize)
	}
}
