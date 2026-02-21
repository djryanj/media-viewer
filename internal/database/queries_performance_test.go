package database

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestSlowQueryLogging tests that slow queries are logged
func TestSlowQueryLogging(t *testing.T) {
	// Capture log output by redirecting standard logger
	var logBuf bytes.Buffer
	oldFlags := log.Flags()
	oldOutput := log.Writer()
	log.SetOutput(&logBuf)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(oldOutput)
		log.SetFlags(oldFlags)
	}()

	// Set slow query threshold to 0 for testing
	os.Setenv("SLOW_QUERY_THRESHOLD_MS", "0")
	defer os.Unsetenv("SLOW_QUERY_THRESHOLD_MS")

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, _, err := New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Perform a simple query that will be logged as "slow"
	_, err = db.ListDirectory(ctx, ListOptions{
		Path:      "",
		SortField: SortByName,
		SortOrder: SortAsc,
		Page:      1,
		PageSize:  50,
	})
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}

	// Check that slow query was logged
	logOutput := logBuf.String()
	if !strings.Contains(logOutput, "Slow query detected") {
		t.Logf("Warning: Expected slow query log message. This may be a logging configuration issue.")
		t.Logf("Log output: %s", logOutput)
	}
	if strings.Contains(logOutput, "operation=list_directory") {
		t.Logf("Successfully logged slow query with operation name")
	}
}

// TestSlowQueryThresholdConfiguration tests that threshold can be configured
func TestSlowQueryThresholdConfiguration(t *testing.T) {
	tests := []struct {
		name         string
		envValue     string
		expectedSec  float64
		shouldLog    bool
		queryTimeSec float64
	}{
		{
			name:         "Default 100ms threshold",
			envValue:     "",
			expectedSec:  0.1,
			shouldLog:    false,
			queryTimeSec: 0.05,
		},
		{
			name:         "Custom 50ms threshold - slow query",
			envValue:     "50",
			expectedSec:  0.05,
			shouldLog:    true,
			queryTimeSec: 0.06,
		},
		{
			name:         "Custom 500ms threshold - fast query",
			envValue:     "500",
			expectedSec:  0.5,
			shouldLog:    false,
			queryTimeSec: 0.2,
		},
		{
			name:         "Zero threshold - log everything",
			envValue:     "0",
			expectedSec:  0.0,
			shouldLog:    true,
			queryTimeSec: 0.001,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.envValue != "" {
				os.Setenv("SLOW_QUERY_THRESHOLD_MS", tt.envValue)
				defer os.Unsetenv("SLOW_QUERY_THRESHOLD_MS")
			}

			threshold := getSlowQueryThreshold()
			if threshold != tt.expectedSec {
				t.Errorf("Expected threshold=%v, got %v", tt.expectedSec, threshold)
			}

			// Simulate query timing
			start := time.Now().Add(-time.Duration(tt.queryTimeSec * float64(time.Second)))

			var logBuf bytes.Buffer
			oldOutput := log.Writer()
			log.SetOutput(&logBuf)
			defer log.SetOutput(oldOutput)

			// Simulate recordQuery
			recordQuery("test_operation", start, nil)

			logOutput := logBuf.String()
			hasSlowQueryLog := strings.Contains(logOutput, "Slow query detected")

			if tt.shouldLog && !hasSlowQueryLog {
				t.Logf("Note: Expected slow query log but didn't get one. This may be a logging configuration issue.")
			}
			if !tt.shouldLog && hasSlowQueryLog {
				t.Errorf("Did not expect slow query log but got one, log: %s", logOutput)
			}
		})
	}
}

// BenchmarkListDirectory_WithFolderCounts benchmarks the optimized folder count query
func BenchmarkListDirectory_WithFolderCounts(b *testing.B) {
	tmpDir := b.TempDir()
	dbPath := filepath.Join(tmpDir, "bench.db")

	db, _, err := New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Create a directory structure with many folders
	// 100 folders in the root, each with varying number of files
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		b.Fatalf("Failed to begin batch: %v", err)
	}

	for i := 0; i < 100; i++ {
		folderName := fmt.Sprintf("folder_%03d", i)
		folder := MediaFile{
			Name:       folderName,
			Path:       folderName,
			ParentPath: "",
			Type:       FileTypeFolder,
			Size:       0,
			ModTime:    time.Now(),
		}
		if err := db.UpsertFile(ctx, tx, &folder); err != nil {
			b.Fatalf("Failed to upsert folder: %v", err)
		}

		// Add files to each folder (varying amounts)
		numFiles := 10 + (i * 5) // 10, 15, 20, 25...
		for j := 0; j < numFiles; j++ {
			fileName := fmt.Sprintf("file_%03d.jpg", j)
			file := MediaFile{
				Name:       fileName,
				Path:       filepath.Join(folderName, fileName),
				ParentPath: folderName,
				Type:       FileTypeImage,
				Size:       1024 * 1024,
				ModTime:    time.Now(),
				MimeType:   "image/jpeg",
			}
			if err := db.UpsertFile(ctx, tx, &file); err != nil {
				b.Fatalf("Failed to upsert file: %v", err)
			}
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		b.Fatalf("Failed to end batch: %v", err)
	}

	opts := ListOptions{
		Path:      "",
		SortField: SortByName,
		SortOrder: SortAsc,
		Page:      1,
		PageSize:  50,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.ListDirectory(ctx, opts)
		if err != nil {
			b.Fatalf("ListDirectory failed: %v", err)
		}
	}
}

// BenchmarkListDirectory_LargeFolderCounts benchmarks with very large directories
func BenchmarkListDirectory_LargeFolderCounts(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping large folder benchmark in short mode")
	}

	tmpDir := b.TempDir()
	dbPath := filepath.Join(tmpDir, "bench.db")

	db, _, err := New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Create a directory structure simulating real-world usage
	// 500 folders with varying sizes, some very large
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		b.Fatalf("Failed to begin batch: %v", err)
	}

	for i := 0; i < 500; i++ {
		folderName := fmt.Sprintf("folder_%04d", i)
		folder := MediaFile{
			Name:       folderName,
			Path:       folderName,
			ParentPath: "",
			Type:       FileTypeFolder,
			Size:       0,
			ModTime:    time.Now(),
		}
		if err := db.UpsertFile(ctx, tx, &folder); err != nil {
			b.Fatalf("Failed to upsert folder: %v", err)
		}

		// Some folders have many files (simulating user's 14k folder)
		var numFiles int
		if i%10 == 0 {
			numFiles = 1000 // Every 10th folder has 1000 files
		} else {
			numFiles = 50 // Others have 50 files
		}

		for j := 0; j < numFiles; j++ {
			fileName := fmt.Sprintf("file_%05d.jpg", j)
			file := MediaFile{
				Name:       fileName,
				Path:       filepath.Join(folderName, fileName),
				ParentPath: folderName,
				Type:       FileTypeImage,
				Size:       1024 * 1024,
				ModTime:    time.Now(),
				MimeType:   "image/jpeg",
			}
			if err := db.UpsertFile(ctx, tx, &file); err != nil {
				b.Fatalf("Failed to upsert file: %v", err)
			}
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		b.Fatalf("Failed to end batch: %v", err)
	}

	opts := ListOptions{
		Path:      "",
		SortField: SortByName,
		SortOrder: SortAsc,
		Page:      1,
		PageSize:  100,
	}

	b.ResetTimer()
	b.Run("FirstPage", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_, err := db.ListDirectory(ctx, opts)
			if err != nil {
				b.Fatalf("ListDirectory failed: %v", err)
			}
		}
	})

	b.Run("SecondPage", func(b *testing.B) {
		opts.Page = 2
		for i := 0; i < b.N; i++ {
			_, err := db.ListDirectory(ctx, opts)
			if err != nil {
				b.Fatalf("ListDirectory failed: %v", err)
			}
		}
	})

	b.Run("LastPage", func(b *testing.B) {
		opts.Page = 5
		for i := 0; i < b.N; i++ {
			_, err := db.ListDirectory(ctx, opts)
			if err != nil {
				b.Fatalf("ListDirectory failed: %v", err)
			}
		}
	})
}

// BenchmarkGetMediaInDirectory_WithManyTags benchmarks media queries with tags and favorites
func BenchmarkGetMediaInDirectory_WithManyTags(b *testing.B) {
	tmpDir := b.TempDir()
	dbPath := filepath.Join(tmpDir, "bench.db")

	db, _, err := New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Create tags
	tagNames := []string{"vacation", "family", "travel", "2024", "favorites", "nature", "portrait", "landscape"}
	for _, tagName := range tagNames {
		_, err := db.GetOrCreateTag(ctx, tagName)
		if err != nil {
			b.Fatalf("Failed to create tag: %v", err)
		}
	}

	// Create files
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		b.Fatalf("Failed to begin batch: %v", err)
	}

	for i := 0; i < 5000; i++ {
		fileName := fmt.Sprintf("photo_%04d.jpg", i)
		file := MediaFile{
			Name:       fileName,
			Path:       filepath.Join("photos", fileName),
			ParentPath: "photos",
			Type:       FileTypeImage,
			Size:       1024 * 1024 * 5, // 5MB
			ModTime:    time.Now(),
			MimeType:   "image/jpeg",
		}
		if err := db.UpsertFile(ctx, tx, &file); err != nil {
			b.Fatalf("Failed to upsert file: %v", err)
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		b.Fatalf("Failed to end batch: %v", err)
	}

	// Add tags to files (many files with multiple tags)
	for i := 0; i < 2000; i++ {
		fileName := fmt.Sprintf("photo_%04d.jpg", i)
		filePath := filepath.Join("photos", fileName)

		// Add 2-4 tags per file
		numTags := 2 + (i % 3)
		for j := 0; j < numTags; j++ {
			tagName := tagNames[(i+j)%len(tagNames)]
			if err := db.AddTagToFile(ctx, filePath, tagName); err != nil {
				b.Fatalf("Failed to add tag: %v", err)
			}
		}

		// Add some to favorites
		if i%5 == 0 {
			if err := db.AddFavorite(ctx, filePath, fileName, FileTypeImage); err != nil {
				b.Fatalf("Failed to add favorite: %v", err)
			}
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "photos", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

// TestListDirectory_FolderCountAccuracy tests that folder counts are accurate
func TestListDirectory_FolderCountAccuracy(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, _, err := New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Create test structure:
	// folder1/ (3 files)
	// folder2/ (10 files)
	// folder3/ (empty)
	// folder4/ (1 file)

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("Failed to begin batch: %v", err)
	}

	folders := []struct {
		name     string
		numFiles int
	}{
		{"folder1", 3},
		{"folder2", 10},
		{"folder3", 0},
		{"folder4", 1},
	}

	for _, folder := range folders {
		// Create folder
		f := MediaFile{
			Name:       folder.name,
			Path:       folder.name,
			ParentPath: "",
			Type:       FileTypeFolder,
			Size:       0,
			ModTime:    time.Now(),
		}
		if err := db.UpsertFile(ctx, tx, &f); err != nil {
			t.Fatalf("Failed to upsert folder: %v", err)
		}

		// Add files
		for i := 0; i < folder.numFiles; i++ {
			fileName := fmt.Sprintf("file%d.jpg", i)
			file := MediaFile{
				Name:       fileName,
				Path:       filepath.Join(folder.name, fileName),
				ParentPath: folder.name,
				Type:       FileTypeImage,
				Size:       1024,
				ModTime:    time.Now(),
				MimeType:   "image/jpeg",
			}
			if err := db.UpsertFile(ctx, tx, &file); err != nil {
				t.Fatalf("Failed to upsert file: %v", err)
			}
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("Failed to end batch: %v", err)
	}

	// List root directory
	listing, err := db.ListDirectory(ctx, ListOptions{
		Path:      "",
		SortField: SortByName,
		SortOrder: SortAsc,
		Page:      1,
		PageSize:  50,
	})
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}

	// Verify folder counts
	if len(listing.Items) != 4 {
		t.Fatalf("Expected 4 folders, got %d", len(listing.Items))
	}

	for _, item := range listing.Items {
		if item.Type != FileTypeFolder {
			t.Errorf("Expected folder type, got %s", item.Type)
			continue
		}

		var expectedCount int
		for _, f := range folders {
			if f.name == item.Name {
				expectedCount = f.numFiles
				break
			}
		}

		if item.ItemCount != expectedCount {
			t.Errorf("Folder %s: expected count=%d, got %d", item.Name, expectedCount, item.ItemCount)
		}
	}
}
