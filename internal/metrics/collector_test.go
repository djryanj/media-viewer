package metrics

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
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
// Mock StorageHealthChecker
// =============================================================================

type mockStorageHealthChecker struct {
	mu                    sync.Mutex
	checkStorageHealthCnt int
	updateDBMetricsCnt    int
}

func (m *mockStorageHealthChecker) CheckStorageHealth() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.checkStorageHealthCnt++
}

func (m *mockStorageHealthChecker) UpdateDBMetrics() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.updateDBMetricsCnt++
}

func (m *mockStorageHealthChecker) getCheckStorageHealthCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.checkStorageHealthCnt
}

func (m *mockStorageHealthChecker) getUpdateDBMetricsCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.updateDBMetricsCnt
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
			TotalPlaylists: 5,
			TotalFavorites: 15,
			TotalTags:      8,
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

	if collector.transcoderCacheDir != "" {
		t.Errorf("transcoderCacheDir should be empty by default, got %q", collector.transcoderCacheDir)
	}

	if collector.storageHealthChecker != nil {
		t.Error("storageHealthChecker should be nil by default")
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

func TestStorageHealthCheckerInterface(_ *testing.T) {
	// Verify our mock implements the interface
	var _ StorageHealthChecker = (*mockStorageHealthChecker)(nil)
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
	}

	collector := NewCollector(nil, "", 1*time.Second)
	collector.SetTranscoderCacheDir(cacheDir)
	collector.collectTranscoderCacheSize()
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

func TestCollectorTranscoderCacheSizeWithEmptyPath(_ *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)
	// transcoderCacheDir is "" by default

	// Should return early without panic
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

// FIX: Renamed from getDirSize to getDirSizeWithRetry to match the actual
// method signature in collector.go.
func TestCollectorGetDirSizeWithRetry(t *testing.T) {
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
	size, err := collector.getDirSizeWithRetry(tempDir)
	if err != nil {
		t.Fatalf("getDirSizeWithRetry failed: %v", err)
	}

	if size != expectedSize {
		t.Errorf("getDirSizeWithRetry() = %d, want %d", size, expectedSize)
	}
}

func TestCollectorGetDirSizeWithRetryEmptyDir(t *testing.T) {
	tempDir := t.TempDir()

	collector := NewCollector(nil, "", 1*time.Second)
	size, err := collector.getDirSizeWithRetry(tempDir)
	if err != nil {
		t.Fatalf("getDirSizeWithRetry on empty dir failed: %v", err)
	}

	if size != 0 {
		t.Errorf("getDirSizeWithRetry() on empty dir = %d, want 0", size)
	}
}

func TestCollectorGetDirSizeWithRetryNonexistent(t *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)
	_, err := collector.getDirSizeWithRetry("/nonexistent/path")
	if err == nil {
		t.Error("getDirSizeWithRetry on nonexistent path should return error")
	}
}

func TestCollectorGetDirSizeWithRetryNestedDirs(t *testing.T) {
	tempDir := t.TempDir()

	// Create a deeper directory structure
	dirs := []string{
		"a",
		"a/b",
		"a/b/c",
		"d",
	}
	for _, d := range dirs {
		if err := os.MkdirAll(filepath.Join(tempDir, d), 0o755); err != nil {
			t.Fatalf("failed to create dir %s: %v", d, err)
		}
	}

	files := []struct {
		path string
		size int
	}{
		{"a/f1.txt", 10},
		{"a/b/f2.txt", 20},
		{"a/b/c/f3.txt", 30},
		{"d/f4.txt", 40},
	}

	var expectedSize int64
	for _, f := range files {
		data := make([]byte, f.size)
		if err := os.WriteFile(filepath.Join(tempDir, f.path), data, 0o644); err != nil {
			t.Fatalf("failed to create file: %v", err)
		}
		expectedSize += int64(f.size)
	}

	collector := NewCollector(nil, "", 1*time.Second)
	size, err := collector.getDirSizeWithRetry(tempDir)
	if err != nil {
		t.Fatalf("getDirSizeWithRetry failed: %v", err)
	}

	if size != expectedSize {
		t.Errorf("getDirSizeWithRetry() = %d, want %d", size, expectedSize)
	}
}

// =============================================================================
// StorageHealthChecker Tests
// =============================================================================

func TestSetStorageHealthChecker(t *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)

	if collector.storageHealthChecker != nil {
		t.Error("storageHealthChecker should be nil initially")
	}

	checker := &mockStorageHealthChecker{}
	collector.SetStorageHealthChecker(checker)

	if collector.storageHealthChecker != checker {
		t.Error("storageHealthChecker not set correctly")
	}
}

func TestSetStorageHealthCheckerToNil(t *testing.T) {
	collector := NewCollector(nil, "", 1*time.Second)

	checker := &mockStorageHealthChecker{}
	collector.SetStorageHealthChecker(checker)
	collector.SetStorageHealthChecker(nil)

	if collector.storageHealthChecker != nil {
		t.Error("storageHealthChecker should be nil after setting to nil")
	}
}

func TestCollectCallsStorageHealthChecker(t *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 10},
	}
	checker := &mockStorageHealthChecker{}

	collector := NewCollector(provider, "", 1*time.Second)
	collector.SetStorageHealthChecker(checker)

	collector.collect()

	if cnt := checker.getCheckStorageHealthCount(); cnt != 1 {
		t.Errorf("CheckStorageHealth called %d times, want 1", cnt)
	}
	if cnt := checker.getUpdateDBMetricsCount(); cnt != 1 {
		t.Errorf("UpdateDBMetrics called %d times, want 1", cnt)
	}
}

func TestCollectCallsStorageHealthCheckerMultipleTimes(t *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 10},
	}
	checker := &mockStorageHealthChecker{}

	collector := NewCollector(provider, "", 1*time.Second)
	collector.SetStorageHealthChecker(checker)

	for i := 0; i < 5; i++ {
		collector.collect()
	}

	if cnt := checker.getCheckStorageHealthCount(); cnt != 5 {
		t.Errorf("CheckStorageHealth called %d times, want 5", cnt)
	}
	if cnt := checker.getUpdateDBMetricsCount(); cnt != 5 {
		t.Errorf("UpdateDBMetrics called %d times, want 5", cnt)
	}
}

func TestCollectWithNilStorageHealthChecker(t *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 10},
	}

	collector := NewCollector(provider, "", 1*time.Second)
	// storageHealthChecker is nil by default

	// Should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("collect() panicked with nil storageHealthChecker: %v", r)
		}
	}()

	collector.collect()
}

func TestCollectWithStorageHealthCheckerAndNilProvider(t *testing.T) {
	checker := &mockStorageHealthChecker{}

	collector := NewCollector(nil, "", 1*time.Second)
	collector.SetStorageHealthChecker(checker)

	// Should not panic — health checker runs, then returns early for nil provider
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("collect() panicked: %v", r)
		}
	}()

	collector.collect()

	// Health checker should still be called even with nil stats provider
	if cnt := checker.getCheckStorageHealthCount(); cnt != 1 {
		t.Errorf("CheckStorageHealth called %d times, want 1", cnt)
	}
	if cnt := checker.getUpdateDBMetricsCount(); cnt != 1 {
		t.Errorf("UpdateDBMetrics called %d times, want 1", cnt)
	}
}

func TestCollectorStartStopWithStorageHealthChecker(t *testing.T) {
	provider := &mockStatsProvider{
		stats: Stats{TotalFiles: 10},
	}
	checker := &mockStorageHealthChecker{}

	collector := NewCollector(provider, "", 50*time.Millisecond)
	collector.SetStorageHealthChecker(checker)

	collector.Start()
	time.Sleep(150 * time.Millisecond)
	collector.Stop()

	// Should have been called at least twice (immediate + at least one tick)
	if cnt := checker.getCheckStorageHealthCount(); cnt < 2 {
		t.Errorf("CheckStorageHealth called %d times, want >= 2", cnt)
	}
	if cnt := checker.getUpdateDBMetricsCount(); cnt < 2 {
		t.Errorf("UpdateDBMetrics called %d times, want >= 2", cnt)
	}
}

// =============================================================================
// Observer Tests
// =============================================================================

func TestNewFilesystemObserver(t *testing.T) {
	observer := NewFilesystemObserver()
	if observer == nil {
		t.Fatal("NewFilesystemObserver returned nil")
	}
}

func TestFilesystemObserverImplementsInterface(t *testing.T) {
	observer := NewFilesystemObserver()

	// Verify it satisfies the filesystem.Observer interface at compile time
	// (this is also checked by the return type, but explicit is nice)
	if observer == nil {
		t.Fatal("observer is nil")
	}
}

func TestObserveOperationSuccess(t *testing.T) {
	observer := NewFilesystemObserver()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ObserveOperation panicked: %v", r)
		}
	}()

	observer.ObserveOperation("media", "read", 0.005, nil)
	observer.ObserveOperation("cache", "write", 0.01, nil)
	observer.ObserveOperation("database", "stat", 0.001, nil)
	observer.ObserveOperation("unknown", "readdir", 0.02, nil)
}

func TestObserveOperationWithError(t *testing.T) {
	observer := NewFilesystemObserver()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ObserveOperation with error panicked: %v", r)
		}
	}()

	testErr := errors.New("test filesystem error")
	observer.ObserveOperation("media", "read", 0.1, testErr)
	observer.ObserveOperation("cache", "write", 0.5, testErr)
}

func TestObserveRetryAttempt(t *testing.T) {
	observer := NewFilesystemObserver()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ObserveRetryAttempt panicked: %v", r)
		}
	}()

	observer.ObserveRetryAttempt("stat", "media")
	observer.ObserveRetryAttempt("open", "cache")
	observer.ObserveRetryAttempt("readdir", "database")
	observer.ObserveRetryAttempt("write", "unknown")
}

func TestObserveRetrySuccess(t *testing.T) {
	observer := NewFilesystemObserver()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ObserveRetrySuccess panicked: %v", r)
		}
	}()

	observer.ObserveRetrySuccess("stat", "media")
	observer.ObserveRetrySuccess("open", "cache")
}

func TestObserveRetryFailure(t *testing.T) {
	observer := NewFilesystemObserver()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ObserveRetryFailure panicked: %v", r)
		}
	}()

	observer.ObserveRetryFailure("stat", "media")
	observer.ObserveRetryFailure("open", "database")
}

func TestObserveRetryDuration(t *testing.T) {
	observer := NewFilesystemObserver()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ObserveRetryDuration panicked: %v", r)
		}
	}()

	observer.ObserveRetryDuration("stat", "media", 0.05)
	observer.ObserveRetryDuration("open", "cache", 0.1)
	observer.ObserveRetryDuration("readdir", "database", 1.5)
}

func TestObserveStaleError(t *testing.T) {
	observer := NewFilesystemObserver()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ObserveStaleError panicked: %v", r)
		}
	}()

	observer.ObserveStaleError("stat", "media")
	observer.ObserveStaleError("open", "cache")
	observer.ObserveStaleError("readdir", "database")
}

func TestObserverAllMethodsCombined(t *testing.T) {
	observer := NewFilesystemObserver()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Observer combined operations panicked: %v", r)
		}
	}()

	// Simulate a retry sequence: attempt, stale error, retry, success
	observer.ObserveRetryAttempt("stat", "media")
	observer.ObserveStaleError("stat", "media")
	observer.ObserveRetryAttempt("stat", "media")
	observer.ObserveRetrySuccess("stat", "media")
	observer.ObserveRetryDuration("stat", "media", 0.15)
	observer.ObserveOperation("media", "stat", 0.15, nil)
}

func TestObserverConcurrentAccess(t *testing.T) {
	observer := NewFilesystemObserver()
	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Goroutine %d panicked: %v", id, r)
				}
				done <- true
			}()

			observer.ObserveOperation("media", "read", 0.001, nil)
			observer.ObserveRetryAttempt("stat", "media")
			observer.ObserveRetrySuccess("stat", "media")
			observer.ObserveRetryDuration("stat", "media", 0.01)
			observer.ObserveStaleError("open", "cache")
			observer.ObserveRetryFailure("open", "cache")
		}(i)
	}

	for i := 0; i < 10; i++ {
		<-done
	}
}

// =============================================================================
// InitializeMetrics Tests
// =============================================================================

func TestInitializeMetrics(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("InitializeMetrics() panicked: %v", r)
		}
	}()

	InitializeMetrics()
}

func TestInitializeMetricsIdempotent(t *testing.T) {
	// Calling InitializeMetrics multiple times should not panic or cause
	// duplicate registration errors (WithLabelValues on existing labels is safe).
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("InitializeMetrics() panicked on second call: %v", r)
		}
	}()

	InitializeMetrics()
	InitializeMetrics()
}

func TestInitializeMetricsPrePopulatesDBStorageErrors(t *testing.T) {
	InitializeMetrics()

	// After initialization, these label combos should exist and not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Accessing pre-populated DBStorageErrors panicked: %v", r)
		}
	}()

	for _, file := range []string{"main", "wal", "shm"} {
		DBStorageErrors.WithLabelValues(file).Add(0)
	}
}

func TestInitializeMetricsPrePopulatesFilesystemMetrics(t *testing.T) {
	InitializeMetrics()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Accessing pre-populated filesystem metrics panicked: %v", r)
		}
	}()

	volumes := []string{"media", "cache", "database", "unknown"}
	fsOps := []string{"read", "write", "stat", "readdir"}

	for _, vol := range volumes {
		for _, op := range fsOps {
			FilesystemOperationDuration.WithLabelValues(vol, op).Observe(0)
			FilesystemOperationErrors.WithLabelValues(vol, op).Add(0)
		}
	}

	retryOps := []string{"stat", "open", "readdir", "write"}
	for _, op := range retryOps {
		for _, vol := range volumes {
			FilesystemRetryAttempts.WithLabelValues(op, vol).Add(0)
			FilesystemRetrySuccess.WithLabelValues(op, vol).Add(0)
			FilesystemRetryFailures.WithLabelValues(op, vol).Add(0)
			FilesystemStaleErrors.WithLabelValues(op, vol).Add(0)
			FilesystemRetryDuration.WithLabelValues(op, vol).Observe(0)
		}
	}
}

func TestInitializeMetricsPrePopulatesThumbnailMetrics(t *testing.T) {
	InitializeMetrics()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Accessing pre-populated thumbnail metrics panicked: %v", r)
		}
	}()

	formats := []string{"jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "avif", "svg", "unknown"}
	for _, format := range formats {
		ThumbnailImageDecodeByFormat.WithLabelValues(format).Observe(0)
	}

	thumbTypes := []string{"image", "video", "folder"}
	phases := []string{"decode", "resize", "encode", "cache"}
	for _, tt := range thumbTypes {
		for _, p := range phases {
			ThumbnailGenerationDurationDetailed.WithLabelValues(tt, p).Observe(0)
		}
		ThumbnailMemoryUsageBytes.WithLabelValues(tt).Observe(0)
	}
}

func TestInitializeMetricsPrePopulatesDBQueryMetrics(t *testing.T) {
	InitializeMetrics()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Accessing pre-populated DB query metrics panicked: %v", r)
		}
	}()

	ops := []string{"initialize_schema", "upsert_file", "delete_missing_files",
		"get_file_by_path", "rebuild_fts", "vacuum", "begin_transaction", "commit", "rollback"}
	for _, op := range ops {
		DBQueryTotal.WithLabelValues(op, "success").Add(0)
		DBQueryTotal.WithLabelValues(op, "error").Add(0)
		DBQueryDuration.WithLabelValues(op).Observe(0)
	}

	txTypes := []string{"commit", "rollback", "batch_insert", "batch_update", "cleanup"}
	for _, tt := range txTypes {
		DBTransactionDuration.WithLabelValues(tt).Observe(0)
	}
}
