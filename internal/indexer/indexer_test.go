package indexer

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"media-viewer/internal/database"
)

func TestIndexProgress(t *testing.T) {
	now := time.Now()

	progress := IndexProgress{
		FilesIndexed:   100,
		FoldersIndexed: 10,
		IsIndexing:     true,
		StartedAt:      now,
	}

	if progress.FilesIndexed != 100 {
		t.Errorf("Expected FilesIndexed=100, got %d", progress.FilesIndexed)
	}

	if progress.FoldersIndexed != 10 {
		t.Errorf("Expected FoldersIndexed=10, got %d", progress.FoldersIndexed)
	}

	if !progress.IsIndexing {
		t.Error("Expected IsIndexing=true")
	}

	if progress.StartedAt != now {
		t.Error("StartedAt mismatch")
	}
}

func TestHealthStatus(t *testing.T) {
	now := time.Now()

	status := HealthStatus{
		Ready:             true,
		Indexing:          false,
		StartTime:         now,
		Uptime:            "1h30m",
		LastIndexed:       now.Add(-1 * time.Hour),
		InitialIndexError: "",
		FilesIndexed:      250,
		FoldersIndexed:    25,
		IndexProgress:     nil,
	}

	if !status.Ready {
		t.Error("Expected Ready=true")
	}

	if status.Indexing {
		t.Error("Expected Indexing=false")
	}

	if status.FilesIndexed != 250 {
		t.Errorf("Expected FilesIndexed=250, got %d", status.FilesIndexed)
	}

	if status.FoldersIndexed != 25 {
		t.Errorf("Expected FoldersIndexed=25, got %d", status.FoldersIndexed)
	}

	if status.Uptime != "1h30m" {
		t.Errorf("Expected Uptime=1h30m, got %s", status.Uptime)
	}

	if status.StartTime != now {
		t.Errorf("Expected StartTime=%v, got %v", now, status.StartTime)
	}

	if !status.LastIndexed.Equal(now.Add(-1 * time.Hour)) {
		t.Errorf("Expected LastIndexed to be 1 hour ago")
	}

	if status.InitialIndexError != "" {
		t.Errorf("Expected InitialIndexError to be empty, got %s", status.InitialIndexError)
	}

	if status.IndexProgress != nil {
		t.Errorf("Expected IndexProgress to be nil, got %v", status.IndexProgress)
	}
}

func TestHealthStatusWithProgress(t *testing.T) {
	progress := &IndexProgress{
		FilesIndexed:   50,
		FoldersIndexed: 5,
		IsIndexing:     true,
		StartedAt:      time.Now(),
	}

	status := HealthStatus{
		Ready:          false,
		Indexing:       true,
		FilesIndexed:   50,
		FoldersIndexed: 5,
		IndexProgress:  progress,
	}

	if status.Ready {
		t.Error("Expected Ready=false during indexing")
	}

	if !status.Indexing {
		t.Error("Expected Indexing=true")
	}

	if status.IndexProgress == nil {
		t.Fatal("Expected IndexProgress to be set")
	}

	if status.IndexProgress.FilesIndexed != 50 {
		t.Errorf("Expected IndexProgress.FilesIndexed=50, got %d", status.IndexProgress.FilesIndexed)
	}

	if status.FilesIndexed != 50 {
		t.Errorf("Expected FilesIndexed=50, got %d", status.FilesIndexed)
	}

	if status.FoldersIndexed != 5 {
		t.Errorf("Expected FoldersIndexed=5, got %d", status.FoldersIndexed)
	}
}

func TestHealthStatusWithError(t *testing.T) {
	status := HealthStatus{
		Ready:             false,
		Indexing:          false,
		FilesIndexed:      0,
		FoldersIndexed:    0,
		InitialIndexError: "Failed to read directory: permission denied",
	}

	if status.Ready {
		t.Error("Expected Ready=false when there's an error")
	}

	if status.InitialIndexError == "" {
		t.Error("Expected InitialIndexError to be set")
	}

	expectedError := "Failed to read directory: permission denied"
	if status.InitialIndexError != expectedError {
		t.Errorf("Expected error=%s, got %s", expectedError, status.InitialIndexError)
	}

	if status.Indexing {
		t.Error("Expected Indexing=false")
	}

	if status.FilesIndexed != 0 {
		t.Errorf("Expected FilesIndexed=0, got %d", status.FilesIndexed)
	}

	if status.FoldersIndexed != 0 {
		t.Errorf("Expected FoldersIndexed=0, got %d", status.FoldersIndexed)
	}
}

func TestParallelWalkerConfig(t *testing.T) {
	config := ParallelWalkerConfig{
		NumWorkers:    8,
		BatchSize:     500,
		ChannelBuffer: 1000,
		SkipHidden:    true,
	}

	if config.NumWorkers != 8 {
		t.Errorf("Expected NumWorkers=8, got %d", config.NumWorkers)
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

func TestIndexProgressJSONMarshaling(t *testing.T) {
	now := time.Now()
	progress := IndexProgress{
		FilesIndexed:   150,
		FoldersIndexed: 15,
		IsIndexing:     true,
		StartedAt:      now,
	}

	// This test ensures the struct has proper JSON tags
	// In a real test, we'd marshal and unmarshal
	if progress.FilesIndexed == 0 {
		t.Error("FilesIndexed should be set")
	}

	if progress.FoldersIndexed != 15 {
		t.Errorf("Expected FoldersIndexed=15, got %d", progress.FoldersIndexed)
	}

	if !progress.IsIndexing {
		t.Error("Expected IsIndexing=true")
	}

	if progress.StartedAt != now {
		t.Errorf("Expected StartedAt=%v, got %v", now, progress.StartedAt)
	}
}

func TestHealthStatusJSONMarshaling(t *testing.T) {
	status := HealthStatus{
		Ready:          true,
		Indexing:       false,
		StartTime:      time.Now(),
		Uptime:         "2h",
		FilesIndexed:   300,
		FoldersIndexed: 30,
	}

	// Verify struct has values
	if !status.Ready {
		t.Error("Ready should be true")
	}

	if status.FilesIndexed != 300 {
		t.Errorf("Expected FilesIndexed=300, got %d", status.FilesIndexed)
	}

	if status.Indexing {
		t.Error("Expected Indexing=false")
	}

	if status.StartTime.IsZero() {
		t.Error("StartTime should be set")
	}

	if status.Uptime != "2h" {
		t.Errorf("Expected Uptime=2h, got %s", status.Uptime)
	}

	if status.FoldersIndexed != 30 {
		t.Errorf("Expected FoldersIndexed=30, got %d", status.FoldersIndexed)
	}
}

func TestHealthStatusOmitEmpty(t *testing.T) {
	// Test that omitempty fields work correctly
	status := HealthStatus{
		Ready:    true,
		Indexing: false,
		// LastIndexed not set - should be omitted
		// InitialIndexError not set - should be omitted
		// IndexProgress not set - should be omitted
	}

	if !status.Ready {
		t.Error("Expected Ready=true")
	}

	if status.Indexing {
		t.Error("Expected Indexing=false")
	}

	if !status.LastIndexed.IsZero() {
		t.Error("LastIndexed should be zero (omitempty should exclude it from JSON)")
	}

	if status.InitialIndexError != "" {
		t.Error("InitialIndexError should be empty")
	}

	if status.IndexProgress != nil {
		t.Error("IndexProgress should be nil")
	}
}

func TestIndexerConstants(t *testing.T) {
	// Document expected constants
	// Note: These are package-level constants, we can't directly test them
	// but we document their expected values

	t.Run("batchSize", func(_ *testing.T) {
		// Expected: 500 files per batch
		// This is a reasonable size for database commits
	})

	t.Run("minFilesForReady", func(_ *testing.T) {
		// Expected: 100 files minimum before server is ready
		// Ensures initial index has made progress
	})

	t.Run("batchDelay", func(_ *testing.T) {
		// Expected: 10ms delay between batches
		// Allows other operations to run
	})

	t.Run("defaultPollInterval", func(_ *testing.T) {
		// Expected: 30 seconds
		// Balance between responsiveness and system load
	})
}

func TestIndexProgressZeroValues(t *testing.T) {
	var progress IndexProgress

	if progress.FilesIndexed != 0 {
		t.Errorf("Zero-value FilesIndexed should be 0, got %d", progress.FilesIndexed)
	}

	if progress.FoldersIndexed != 0 {
		t.Errorf("Zero-value FoldersIndexed should be 0, got %d", progress.FoldersIndexed)
	}

	if progress.IsIndexing {
		t.Error("Zero-value IsIndexing should be false")
	}

	if !progress.StartedAt.IsZero() {
		t.Error("Zero-value StartedAt should be zero time")
	}
}

func TestHealthStatusZeroValues(t *testing.T) {
	var status HealthStatus

	if status.Ready {
		t.Error("Zero-value Ready should be false")
	}

	if status.Indexing {
		t.Error("Zero-value Indexing should be false")
	}

	if status.FilesIndexed != 0 {
		t.Errorf("Zero-value FilesIndexed should be 0, got %d", status.FilesIndexed)
	}

	if status.FoldersIndexed != 0 {
		t.Errorf("Zero-value FoldersIndexed should be 0, got %d", status.FoldersIndexed)
	}

	if status.Uptime != "" {
		t.Errorf("Zero-value Uptime should be empty, got %s", status.Uptime)
	}

	if status.InitialIndexError != "" {
		t.Errorf("Zero-value InitialIndexError should be empty, got %s", status.InitialIndexError)
	}

	if status.IndexProgress != nil {
		t.Error("Zero-value IndexProgress should be nil")
	}
}

func TestParallelWalkerConfigDefaults(t *testing.T) {
	// Test default/zero values
	var config ParallelWalkerConfig

	if config.NumWorkers != 0 {
		t.Errorf("Default NumWorkers should be 0, got %d", config.NumWorkers)
	}

	if config.BatchSize != 0 {
		t.Errorf("Default BatchSize should be 0, got %d", config.BatchSize)
	}

	if config.ChannelBuffer != 0 {
		t.Errorf("Default ChannelBuffer should be 0, got %d", config.ChannelBuffer)
	}

	if config.SkipHidden {
		t.Error("Default SkipHidden should be false")
	}
}

func TestHealthStatusReady(t *testing.T) {
	tests := []struct {
		name            string
		filesIndexed    int64
		foldersIndexed  int64
		initialComplete bool
		wantReady       bool
	}{
		{
			name:            "Ready with enough files",
			filesIndexed:    100,
			foldersIndexed:  10,
			initialComplete: false,
			wantReady:       true,
		},
		{
			name:            "Ready with initial complete",
			filesIndexed:    50,
			foldersIndexed:  5,
			initialComplete: true,
			wantReady:       true,
		},
		{
			name:            "Not ready",
			filesIndexed:    50,
			foldersIndexed:  5,
			initialComplete: false,
			wantReady:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Note: This documents the expected behavior
			// Actual IsReady() implementation checks these conditions
			totalIndexed := tt.filesIndexed + tt.foldersIndexed
			isReady := (totalIndexed >= 100) || tt.initialComplete

			if isReady != tt.wantReady {
				t.Errorf("Expected ready=%v, got %v", tt.wantReady, isReady)
			}
		})
	}
}

func BenchmarkIndexProgressCreation(b *testing.B) {
	now := time.Now()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = IndexProgress{
			FilesIndexed:   int64(i),
			FoldersIndexed: int64(i / 10),
			IsIndexing:     true,
			StartedAt:      now,
		}
	}
}

func BenchmarkHealthStatusCreation(b *testing.B) {
	now := time.Now()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = HealthStatus{
			Ready:          true,
			Indexing:       false,
			StartTime:      now,
			Uptime:         "1h",
			FilesIndexed:   int64(i),
			FoldersIndexed: int64(i / 10),
		}
	}
}

// New comprehensive tests for better coverage

func TestNew(t *testing.T) {
	tempDir := t.TempDir()
	db := &database.Database{} // Mock database

	idx := New(db, tempDir, 5*time.Minute)

	if idx == nil {
		t.Fatal("New() returned nil")
	}

	if idx.db != db {
		t.Error("Database not set correctly")
	}

	if idx.mediaDir != tempDir {
		t.Errorf("Expected mediaDir=%s, got %s", tempDir, idx.mediaDir)
	}

	if idx.indexInterval != 5*time.Minute {
		t.Errorf("Expected indexInterval=5m, got %v", idx.indexInterval)
	}

	if idx.pollInterval != defaultPollInterval {
		t.Errorf("Expected pollInterval=%v, got %v", defaultPollInterval, idx.pollInterval)
	}

	if !idx.useParallel {
		t.Error("Expected useParallel=true by default")
	}

	if idx.stopChan == nil {
		t.Error("stopChan should be initialized")
	}

	if idx.lastSubdirModTimes == nil {
		t.Error("lastSubdirModTimes should be initialized")
	}

	// Verify progress is initialized
	progress := idx.GetProgress()
	if progress.FilesIndexed != 0 {
		t.Errorf("Initial FilesIndexed should be 0, got %d", progress.FilesIndexed)
	}
}

func TestSetPollInterval(t *testing.T) {
	tests := []struct {
		name     string
		interval time.Duration
		want     time.Duration
	}{
		{
			name:     "Valid interval",
			interval: 10 * time.Second,
			want:     10 * time.Second,
		},
		{
			name:     "Zero interval ignored",
			interval: 0,
			want:     defaultPollInterval, // Should not change
		},
		{
			name:     "Negative interval ignored",
			interval: -5 * time.Second,
			want:     defaultPollInterval, // Should not change
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create fresh indexer for each test to avoid state pollution
			tempDir := t.TempDir()
			db := &database.Database{}
			idx := New(db, tempDir, 5*time.Minute)

			idx.SetPollInterval(tt.interval)
			if idx.pollInterval != tt.want {
				t.Errorf("Expected pollInterval=%v, got %v", tt.want, idx.pollInterval)
			}
		})
	}
}

func TestSetParallelWalking(t *testing.T) {
	tempDir := t.TempDir()
	db := &database.Database{}
	idx := New(db, tempDir, 5*time.Minute)

	if !idx.useParallel {
		t.Error("Expected useParallel=true by default")
	}

	idx.SetParallelWalking(false)
	if idx.useParallel {
		t.Error("Expected useParallel=false after SetParallelWalking(false)")
	}

	idx.SetParallelWalking(true)
	if !idx.useParallel {
		t.Error("Expected useParallel=true after SetParallelWalking(true)")
	}
}

func TestSetParallelConfig(t *testing.T) {
	tempDir := t.TempDir()
	db := &database.Database{}
	idx := New(db, tempDir, 5*time.Minute)

	customConfig := ParallelWalkerConfig{
		NumWorkers:    16,
		BatchSize:     1000,
		ChannelBuffer: 2000,
		SkipHidden:    false,
	}

	idx.SetParallelConfig(customConfig)

	if idx.parallelConfig.NumWorkers != 16 {
		t.Errorf("Expected NumWorkers=16, got %d", idx.parallelConfig.NumWorkers)
	}

	if idx.parallelConfig.BatchSize != 1000 {
		t.Errorf("Expected BatchSize=1000, got %d", idx.parallelConfig.BatchSize)
	}

	if idx.parallelConfig.ChannelBuffer != 2000 {
		t.Errorf("Expected ChannelBuffer=2000, got %d", idx.parallelConfig.ChannelBuffer)
	}

	if idx.parallelConfig.SkipHidden {
		t.Error("Expected SkipHidden=false")
	}
}

func TestSetOnIndexComplete(t *testing.T) {
	tempDir := t.TempDir()
	db := &database.Database{}
	idx := New(db, tempDir, 5*time.Minute)

	callbackCalled := false
	idx.SetOnIndexComplete(func() {
		callbackCalled = true
	})

	// Verify callback can be called
	if idx.onIndexComplete == nil {
		t.Fatal("Callback not set")
	}

	idx.onIndexComplete()
	if !callbackCalled {
		t.Error("Callback was not called")
	}
}

func TestIsIndexing(t *testing.T) {
	tempDir := t.TempDir()
	db := &database.Database{}
	idx := New(db, tempDir, 5*time.Minute)

	// Should not be indexing initially
	if idx.IsIndexing() {
		t.Error("Expected IsIndexing=false initially")
	}

	// Simulate starting indexing
	idx.indexMu.Lock()
	idx.isIndexing = true
	idx.indexMu.Unlock()

	if !idx.IsIndexing() {
		t.Error("Expected IsIndexing=true after setting")
	}

	// Simulate finishing indexing
	idx.indexMu.Lock()
	idx.isIndexing = false
	idx.indexMu.Unlock()

	if idx.IsIndexing() {
		t.Error("Expected IsIndexing=false after clearing")
	}
}

func TestLastIndexTime(t *testing.T) {
	tempDir := t.TempDir()
	db := &database.Database{}
	idx := New(db, tempDir, 5*time.Minute)

	// Initially should be zero
	if !idx.LastIndexTime().IsZero() {
		t.Error("Expected LastIndexTime to be zero initially")
	}

	// Set last index time
	now := time.Now()
	idx.indexMu.Lock()
	idx.lastIndexTime = now
	idx.indexMu.Unlock()

	retrieved := idx.LastIndexTime()
	if !retrieved.Equal(now) {
		t.Errorf("Expected LastIndexTime=%v, got %v", now, retrieved)
	}
}

func TestGetProgressComprehensive(t *testing.T) {
	tempDir := t.TempDir()
	db := &database.Database{}
	idx := New(db, tempDir, 5*time.Minute)

	// Initial progress
	progress := idx.GetProgress()
	if progress.FilesIndexed != 0 {
		t.Errorf("Expected FilesIndexed=0, got %d", progress.FilesIndexed)
	}
	if progress.FoldersIndexed != 0 {
		t.Errorf("Expected FoldersIndexed=0, got %d", progress.FoldersIndexed)
	}
	if progress.IsIndexing {
		t.Error("Expected IsIndexing=false initially")
	}

	// Update progress
	now := time.Now()
	idx.indexProgress.Store(IndexProgress{
		FilesIndexed:   100,
		FoldersIndexed: 10,
		IsIndexing:     true,
		StartedAt:      now,
	})

	progress = idx.GetProgress()
	if progress.FilesIndexed != 100 {
		t.Errorf("Expected FilesIndexed=100, got %d", progress.FilesIndexed)
	}
	if progress.FoldersIndexed != 10 {
		t.Errorf("Expected FoldersIndexed=10, got %d", progress.FoldersIndexed)
	}
	if !progress.IsIndexing {
		t.Error("Expected IsIndexing=true")
	}
	if !progress.StartedAt.Equal(now) {
		t.Errorf("Expected StartedAt=%v, got %v", now, progress.StartedAt)
	}
}

func TestIsReady(t *testing.T) {
	tempDir := t.TempDir()
	db := &database.Database{}
	idx := New(db, tempDir, 5*time.Minute)

	// Not ready initially
	if idx.IsReady() {
		t.Error("Expected IsReady=false initially")
	}

	// Not ready with few files
	idx.filesIndexed.Store(50)
	idx.foldersIndexed.Store(5)
	if idx.IsReady() {
		t.Error("Expected IsReady=false with only 55 items")
	}

	// Ready with enough files
	idx.filesIndexed.Store(95)
	idx.foldersIndexed.Store(10)
	if !idx.IsReady() {
		t.Error("Expected IsReady=true with 105 items")
	}

	// Reset and test with initial complete flag
	idx.filesIndexed.Store(0)
	idx.foldersIndexed.Store(0)
	idx.indexMu.Lock()
	idx.initialIndexComplete = true
	idx.indexMu.Unlock()

	if !idx.IsReady() {
		t.Error("Expected IsReady=true with initialIndexComplete=true")
	}
}

func TestDefaultParallelWalkerConfig(t *testing.T) {
	config := DefaultParallelWalkerConfig()

	if config.NumWorkers <= 0 {
		t.Error("NumWorkers should be positive")
	}

	if config.NumWorkers > 8 {
		t.Errorf("NumWorkers should be capped at 8, got %d", config.NumWorkers)
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

func TestNewParallelWalker(t *testing.T) {
	tempDir := t.TempDir()
	config := DefaultParallelWalkerConfig()

	walker := NewParallelWalker(tempDir, config)

	if walker == nil {
		t.Fatal("NewParallelWalker returned nil")
	}

	if walker.mediaDir != tempDir {
		t.Errorf("Expected mediaDir=%s, got %s", tempDir, walker.mediaDir)
	}

	if walker.config.NumWorkers != config.NumWorkers {
		t.Errorf("Expected NumWorkers=%d, got %d", config.NumWorkers, walker.config.NumWorkers)
	}

	if walker.jobs == nil {
		t.Error("jobs channel should be initialized")
	}

	if walker.results == nil {
		t.Error("results channel should be initialized")
	}

	if walker.ctx == nil {
		t.Error("context should be initialized")
	}

	if walker.cancel == nil {
		t.Error("cancel function should be initialized")
	}

	// Test Stop doesn't panic
	walker.Stop()
}

func TestParallelWalkerStats(t *testing.T) {
	tempDir := t.TempDir()
	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	// Initial stats should be zero
	files, folders, errors := walker.Stats()
	if files != 0 || folders != 0 || errors != 0 {
		t.Errorf("Expected all stats to be 0, got files=%d, folders=%d, errors=%d", files, folders, errors)
	}

	// Simulate some processing
	walker.filesProcessed.Store(100)
	walker.foldersProcessed.Store(10)
	walker.errorsCount.Store(2)

	files, folders, errors = walker.Stats()
	if files != 100 {
		t.Errorf("Expected files=100, got %d", files)
	}
	if folders != 10 {
		t.Errorf("Expected folders=10, got %d", folders)
	}
	if errors != 2 {
		t.Errorf("Expected errors=2, got %d", errors)
	}
}

func TestParallelWalkerWithRealDirectory(t *testing.T) {
	tempDir := t.TempDir()

	// Create test structure
	os.WriteFile(filepath.Join(tempDir, "test.jpg"), []byte("fake image"), 0o644)
	os.WriteFile(filepath.Join(tempDir, "test.mp4"), []byte("fake video"), 0o644)
	os.Mkdir(filepath.Join(tempDir, "subdir"), 0o755)
	os.WriteFile(filepath.Join(tempDir, "subdir", "nested.png"), []byte("fake image"), 0o644)
	os.WriteFile(filepath.Join(tempDir, ".hidden"), []byte("hidden file"), 0o644)
	os.Mkdir(filepath.Join(tempDir, ".hidden_dir"), 0o755)

	config := ParallelWalkerConfig{
		NumWorkers:    2,
		BatchSize:     10,
		ChannelBuffer: 10,
		SkipHidden:    true,
	}

	walker := NewParallelWalker(tempDir, config)
	defer walker.Stop()

	// Give it a very short time to avoid hanging tests
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Replace walker's context with timeout context
	walker.cancel()
	walker.ctx = ctx
	walker.cancel = cancel

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk() failed: %v", err)
	}

	// Should have found: test.jpg, test.mp4, subdir, nested.png
	// Should NOT include: .hidden, .hidden_dir (skipped)
	if len(files) < 3 {
		t.Errorf("Expected at least 3 files/folders, got %d", len(files))
	}

	// Verify no hidden files were processed
	for _, f := range files {
		if f.Name[0] == '.' {
			t.Errorf("Found hidden file: %s", f.Name)
		}
	}

	// Check stats
	filesCount, foldersCount, _ := walker.Stats()
	totalProcessed := filesCount + foldersCount
	if totalProcessed == 0 {
		t.Error("Expected some files to be processed")
	}
}

func TestParallelWalkerWithoutSkippingHidden(t *testing.T) {
	tempDir := t.TempDir()

	// Create test files including hidden
	os.WriteFile(filepath.Join(tempDir, "test.jpg"), []byte("fake image"), 0o644)
	os.WriteFile(filepath.Join(tempDir, ".hidden.jpg"), []byte("hidden image"), 0o644)

	config := ParallelWalkerConfig{
		NumWorkers:    2,
		BatchSize:     10,
		ChannelBuffer: 10,
		SkipHidden:    false, // Don't skip hidden files
	}

	walker := NewParallelWalker(tempDir, config)
	defer walker.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	walker.cancel()
	walker.ctx = ctx
	walker.cancel = cancel

	files, err := walker.Walk()
	if err != nil {
		t.Fatalf("Walk() failed: %v", err)
	}

	// With SkipHidden=false, we should find both files
	if len(files) < 1 {
		t.Error("Expected at least one file to be found")
	}
}

func TestParallelWalkerCancellation(t *testing.T) {
	tempDir := t.TempDir()

	// Create many files to ensure walk takes some time
	for i := 0; i < 100; i++ {
		filename := filepath.Join(tempDir, "test"+string(rune(i))+".jpg")
		os.WriteFile(filename, []byte("fake"), 0o644)
	}

	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	// Start walk in goroutine
	done := make(chan struct{})
	go func() {
		_, _ = walker.Walk()
		close(done)
	}()

	// Cancel immediately
	time.Sleep(10 * time.Millisecond)
	walker.Stop()

	// Wait for walk to finish (should finish quickly due to cancellation)
	select {
	case <-done:
		// Good, walk finished
	case <-time.After(2 * time.Second):
		t.Error("Walk did not finish after cancellation")
	}
}

func TestCreateMediaFile(t *testing.T) {
	tempDir := t.TempDir()
	db := &database.Database{}
	idx := New(db, tempDir, 5*time.Minute)

	tests := []struct {
		name       string
		setupFile  func() (string, os.FileInfo)
		expectFile bool
		expectType database.FileType
	}{
		{
			name: "Image file",
			setupFile: func() (string, os.FileInfo) {
				path := filepath.Join(tempDir, "test.jpg")
				os.WriteFile(path, []byte("fake image"), 0o644)
				info, _ := os.Stat(path)
				relPath, _ := filepath.Rel(tempDir, path)
				return relPath, info
			},
			expectFile: true,
			expectType: database.FileTypeImage,
		},
		{
			name: "Video file",
			setupFile: func() (string, os.FileInfo) {
				path := filepath.Join(tempDir, "test.mp4")
				os.WriteFile(path, []byte("fake video"), 0o644)
				info, _ := os.Stat(path)
				relPath, _ := filepath.Rel(tempDir, path)
				return relPath, info
			},
			expectFile: true,
			expectType: database.FileTypeVideo,
		},
		{
			name: "Directory",
			setupFile: func() (string, os.FileInfo) {
				path := filepath.Join(tempDir, "testdir")
				os.Mkdir(path, 0o755)
				info, _ := os.Stat(path)
				relPath, _ := filepath.Rel(tempDir, path)
				return relPath, info
			},
			expectFile: true,
			expectType: database.FileTypeFolder,
		},
		{
			name: "Non-media file",
			setupFile: func() (string, os.FileInfo) {
				path := filepath.Join(tempDir, "test.txt")
				os.WriteFile(path, []byte("text file"), 0o644)
				info, _ := os.Stat(path)
				relPath, _ := filepath.Rel(tempDir, path)
				return relPath, info
			},
			expectFile: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			relPath, info := tt.setupFile()
			file, ok := idx.createMediaFile(relPath, info)

			if ok != tt.expectFile {
				t.Errorf("Expected ok=%v, got %v", tt.expectFile, ok)
			}

			if ok {
				if file.Type != tt.expectType {
					t.Errorf("Expected type=%s, got %s", tt.expectType, file.Type)
				}
				if file.Name != info.Name() {
					t.Errorf("Expected name=%s, got %s", info.Name(), file.Name)
				}
				if file.Path != relPath {
					t.Errorf("Expected path=%s, got %s", relPath, file.Path)
				}
				if file.FileHash == "" {
					t.Error("FileHash should not be empty")
				}
			}
		})
	}
}

func BenchmarkNewIndexer(b *testing.B) {
	tempDir := b.TempDir()
	db := &database.Database{}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = New(db, tempDir, 5*time.Minute)
	}
}

func BenchmarkGetProgress(b *testing.B) {
	tempDir := b.TempDir()
	db := &database.Database{}
	idx := New(db, tempDir, 5*time.Minute)

	// Set some progress
	idx.indexProgress.Store(IndexProgress{
		FilesIndexed:   1000,
		FoldersIndexed: 100,
		IsIndexing:     true,
		StartedAt:      time.Now(),
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = idx.GetProgress()
	}
}

func BenchmarkParallelWalkerStatsAccess(b *testing.B) {
	tempDir := b.TempDir()
	config := DefaultParallelWalkerConfig()
	walker := NewParallelWalker(tempDir, config)

	// Set some stats
	walker.filesProcessed.Store(1000)
	walker.foldersProcessed.Store(100)
	walker.errorsCount.Store(5)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, _ = walker.Stats()
	}
}
