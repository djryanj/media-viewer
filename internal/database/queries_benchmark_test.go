package database

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// setupBenchmarkDatabase creates a test database with a specified number of files, favorites, and tags.
func setupBenchmarkDatabase(b *testing.B, fileCount int, favoriteRatio float64, avgTagsPerFile int) (db *Database, cleanup func()) {
	b.Helper()

	tmpDir := b.TempDir()
	dbPath := filepath.Join(tmpDir, "bench.db")

	db, err := New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}

	ctx := context.Background()

	// Create tags first
	tagNames := []string{"tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"}
	for _, tagName := range tagNames {
		_, err := db.GetOrCreateTag(ctx, tagName)
		if err != nil {
			b.Fatalf("Failed to create tag: %v", err)
		}
	}

	// Create files
	tx, err := db.BeginBatch()
	if err != nil {
		b.Fatalf("Failed to begin batch: %v", err)
	}

	for i := 0; i < fileCount; i++ {
		fileName := fmt.Sprintf("file_%05d.jpg", i)
		filePath := filepath.Join("bench", fileName)

		file := MediaFile{
			Name:       fileName,
			Path:       filePath,
			ParentPath: "bench",
			Type:       FileTypeImage,
			Size:       1024 * 1024, // 1MB
			ModTime:    time.Now(),
			MimeType:   "image/jpeg",
		}

		if err := db.UpsertFile(tx, &file); err != nil {
			b.Fatalf("Failed to upsert file: %v", err)
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		b.Fatalf("Failed to end batch: %v", err)
	}

	// Add favorites and tags
	for i := 0; i < fileCount; i++ {
		fileName := fmt.Sprintf("file_%05d.jpg", i)
		filePath := filepath.Join("bench", fileName)

		// Add to favorites based on ratio
		if float64(i)/float64(fileCount) < favoriteRatio {
			if err := db.AddFavorite(ctx, filePath, fileName, FileTypeImage); err != nil {
				b.Fatalf("Failed to add favorite: %v", err)
			}
		}

		// Add tags
		for j := 0; j < avgTagsPerFile && j < len(tagNames); j++ {
			tagIndex := (i + j) % len(tagNames)
			if err := db.AddTagToFile(ctx, filePath, tagNames[tagIndex]); err != nil {
				b.Fatalf("Failed to add tag to file: %v", err)
			}
		}
	}

	cleanup = func() {
		db.Close()
		os.RemoveAll(tmpDir)
	}

	return db, cleanup
}

// BenchmarkGetMediaInDirectory_Small benchmarks with a small directory (100 files).
func BenchmarkGetMediaInDirectory_Small(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 100, 0.2, 2) // 100 files, 20% favorites, avg 2 tags per file
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

// BenchmarkGetMediaInDirectory_Medium benchmarks with a medium directory (1,000 files).
func BenchmarkGetMediaInDirectory_Medium(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 1000, 0.15, 3) // 1000 files, 15% favorites, avg 3 tags per file
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

// BenchmarkGetMediaInDirectory_Large benchmarks with a large directory (5,000 files).
func BenchmarkGetMediaInDirectory_Large(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 5000, 0.1, 4) // 5000 files, 10% favorites, avg 4 tags per file
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

// BenchmarkGetMediaInDirectory_Huge benchmarks with a huge directory (14,000 files).
// This simulates the user's actual use case with 14,000 items in a directory.
func BenchmarkGetMediaInDirectory_Huge(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping huge benchmark in short mode")
	}

	db, cleanup := setupBenchmarkDatabase(b, 14000, 0.08, 3) // 14000 files, 8% favorites, avg 3 tags per file
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

// BenchmarkGetMediaInDirectory_HugeNoFavoritesNoTags benchmarks the best-case scenario
// where files have no favorites or tags (minimal JOIN overhead).
func BenchmarkGetMediaInDirectory_HugeNoFavoritesNoTags(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping huge benchmark in short mode")
	}

	db, cleanup := setupBenchmarkDatabase(b, 14000, 0.0, 0) // 14000 files, no favorites, no tags
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

// BenchmarkGetMediaInDirectory_HugeManyTags benchmarks the worst-case scenario
// where files have many tags (testing GROUP_CONCAT performance).
func BenchmarkGetMediaInDirectory_HugeManyTags(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping huge benchmark in short mode")
	}

	db, cleanup := setupBenchmarkDatabase(b, 14000, 0.15, 8) // 14000 files, 15% favorites, avg 8 tags per file
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

// BenchmarkGetMediaInDirectory_Sorting benchmarks different sort options.
func BenchmarkGetMediaInDirectory_SortByName(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 5000, 0.1, 3)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

func BenchmarkGetMediaInDirectory_SortByDate(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 5000, 0.1, 3)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "bench", SortByDate, SortDesc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

func BenchmarkGetMediaInDirectory_SortBySize(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 5000, 0.1, 3)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "bench", SortBySize, SortDesc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}

// BenchmarkGetMediaInDirectory_Empty benchmarks an empty directory.
func BenchmarkGetMediaInDirectory_Empty(b *testing.B) {
	tmpDir := b.TempDir()
	dbPath := filepath.Join(tmpDir, "bench.db")

	db, err := New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetMediaInDirectory(ctx, "empty", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
	}
}
