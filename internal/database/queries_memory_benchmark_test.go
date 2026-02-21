package database

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// =============================================================================
// GetAllMediaFilesForThumbnails Benchmarks
// =============================================================================

// BenchmarkGetAllMediaFilesForThumbnails_Small benchmarks with a small library (500 files)
func BenchmarkGetAllMediaFilesForThumbnails_Small(b *testing.B) {
	db, cleanup := setupGetAllFilesBenchmark(b, 500)
	defer cleanup()

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetAllMediaFilesForThumbnails()
		if err != nil {
			b.Fatalf("GetAllMediaFilesForThumbnails failed: %v", err)
		}
	}
}

// BenchmarkGetAllMediaFilesForThumbnails_Medium benchmarks with a medium library (2,000 files)
func BenchmarkGetAllMediaFilesForThumbnails_Medium(b *testing.B) {
	db, cleanup := setupGetAllFilesBenchmark(b, 2000)
	defer cleanup()

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetAllMediaFilesForThumbnails()
		if err != nil {
			b.Fatalf("GetAllMediaFilesForThumbnails failed: %v", err)
		}
	}
}

// BenchmarkGetAllMediaFilesForThumbnails_Large benchmarks with a large library (5,000 files)
func BenchmarkGetAllMediaFilesForThumbnails_Large(b *testing.B) {
	db, cleanup := setupGetAllFilesBenchmark(b, 5000)
	defer cleanup()

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetAllMediaFilesForThumbnails()
		if err != nil {
			b.Fatalf("GetAllMediaFilesForThumbnails failed: %v", err)
		}
	}
}

// BenchmarkGetAllMediaFilesForThumbnails_Huge benchmarks with a huge library (10,000 files)
func BenchmarkGetAllMediaFilesForThumbnails_Huge(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping huge benchmark in short mode")
	}

	db, cleanup := setupGetAllFilesBenchmark(b, 10000)
	defer cleanup()

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := db.GetAllMediaFilesForThumbnails()
		if err != nil {
			b.Fatalf("GetAllMediaFilesForThumbnails failed: %v", err)
		}
	}
}

// setupGetAllFilesBenchmark creates a test database with files across multiple directories
func setupGetAllFilesBenchmark(b *testing.B, fileCount int) (db *Database, cleanup func()) {
	b.Helper()

	tmpDir := b.TempDir()
	dbPath := filepath.Join(tmpDir, "bench.db")

	db, _, err := New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}

	// Create files distributed across multiple directories
	dirCount := 10
	filesPerDir := fileCount / dirCount

	ctx := context.Background()
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		b.Fatalf("Failed to begin batch: %v", err)
	}

	for dir := 0; dir < dirCount; dir++ {
		dirName := fmt.Sprintf("dir_%02d", dir)

		for i := 0; i < filesPerDir; i++ {
			fileName := fmt.Sprintf("file_%05d.jpg", i)
			filePath := filepath.Join(dirName, fileName)

			file := MediaFile{
				Name:       fileName,
				Path:       filePath,
				ParentPath: dirName,
				Type:       FileTypeImage,
				Size:       1024 * 1024, // 1MB
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

	cleanup = func() {
		db.Close()
		os.RemoveAll(tmpDir)
	}

	return db, cleanup
}

// =============================================================================
// Memory Allocation Benchmarks
// =============================================================================

// These benchmarks specifically track memory allocations to verify
// that slice pre-allocation optimizations are effective.

// BenchmarkGetMediaInDirectory_MemorySmall tracks allocations for small directories (100 files)
func BenchmarkGetMediaInDirectory_MemorySmall(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 100, 0.1, 2)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs() // Report allocations

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		_ = files
	}
}

// BenchmarkGetMediaInDirectory_MemoryMedium tracks allocations for medium directories (1,000 files)
func BenchmarkGetMediaInDirectory_MemoryMedium(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 1000, 0.1, 2)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		_ = files
	}
}

// BenchmarkGetMediaInDirectory_MemoryLarge tracks allocations for large directories (5,000 files)
func BenchmarkGetMediaInDirectory_MemoryLarge(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 5000, 0.1, 2)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		_ = files
	}
}

// =============================================================================
// Covering Index Optimization Benchmarks
// =============================================================================

// BenchmarkGetMediaInDirectory_CoveringIndexName benchmarks the covering index for name sorting
// This specifically tests the idx_files_media_directory_name covering index optimization
func BenchmarkGetMediaInDirectory_CoveringIndexName(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping covering index benchmark in short mode")
	}

	db, cleanup := setupBenchmarkDatabase(b, 10000, 0.1, 3)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		_ = files
	}
}

// BenchmarkGetMediaInDirectory_CoveringIndexDate benchmarks the covering index for date sorting
// This specifically tests the idx_files_media_directory_date covering index optimization
func BenchmarkGetMediaInDirectory_CoveringIndexDate(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping covering index benchmark in short mode")
	}

	db, cleanup := setupBenchmarkDatabase(b, 10000, 0.1, 3)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByDate, SortDesc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		_ = files
	}
}

// BenchmarkGetMediaInDirectory_CoveringIndexNameDesc benchmarks name sorting descending
func BenchmarkGetMediaInDirectory_CoveringIndexNameDesc(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping covering index benchmark in short mode")
	}

	db, cleanup := setupBenchmarkDatabase(b, 10000, 0.1, 3)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortDesc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		_ = files
	}
}

// BenchmarkGetMediaInDirectory_CoveringIndexDateAsc benchmarks date sorting ascending
func BenchmarkGetMediaInDirectory_CoveringIndexDateAsc(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping covering index benchmark in short mode")
	}

	db, cleanup := setupBenchmarkDatabase(b, 10000, 0.1, 3)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByDate, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		_ = files
	}
}

// BenchmarkListDirectory_MemorySmall tracks allocations for small directories
func BenchmarkListDirectory_MemorySmall(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 100, 0.1, 2)
	defer cleanup()

	opts := ListOptions{
		Path:      "bench",
		SortField: SortByName,
		SortOrder: SortAsc,
		Page:      1,
		PageSize:  50,
	}

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		listing, err := db.ListDirectory(ctx, opts)
		if err != nil {
			b.Fatalf("ListDirectory failed: %v", err)
		}
		_ = listing
	}
}

// BenchmarkListDirectory_MemoryMedium tracks allocations for medium directories
func BenchmarkListDirectory_MemoryMedium(b *testing.B) {
	db, cleanup := setupBenchmarkDatabase(b, 1000, 0.1, 2)
	defer cleanup()

	opts := ListOptions{
		Path:      "bench",
		SortField: SortByName,
		SortOrder: SortAsc,
		Page:      1,
		PageSize:  50,
	}

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		listing, err := db.ListDirectory(ctx, opts)
		if err != nil {
			b.Fatalf("ListDirectory failed: %v", err)
		}
		_ = listing
	}
}

// BenchmarkGetAllMediaFilesForThumbnails_Memory tracks allocations for large file sets
func BenchmarkGetAllMediaFilesForThumbnails_Memory(b *testing.B) {
	db, cleanup := setupGetAllFilesBenchmark(b, 2000)
	defer cleanup()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		files, err := db.GetAllMediaFilesForThumbnails()
		if err != nil {
			b.Fatalf("GetAllMediaFilesForThumbnails failed: %v", err)
		}
		_ = files
	}
}

// =============================================================================
// GetAllIndexedPaths Benchmarks
// =============================================================================

// BenchmarkGetAllIndexedPaths_Small benchmarks with a small library (500 files)
func BenchmarkGetAllIndexedPaths_Small(b *testing.B) {
	db, cleanup := setupGetAllFilesBenchmark(b, 500)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		paths, err := db.GetAllIndexedPaths(ctx)
		if err != nil {
			b.Fatalf("GetAllIndexedPaths failed: %v", err)
		}
		_ = paths
	}
}

// BenchmarkGetAllIndexedPaths_Medium benchmarks with a medium library (2,000 files)
func BenchmarkGetAllIndexedPaths_Medium(b *testing.B) {
	db, cleanup := setupGetAllFilesBenchmark(b, 2000)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		paths, err := db.GetAllIndexedPaths(ctx)
		if err != nil {
			b.Fatalf("GetAllIndexedPaths failed: %v", err)
		}
		_ = paths
	}
}

// BenchmarkGetAllIndexedPaths_Large benchmarks with a large library (5,000 files)
func BenchmarkGetAllIndexedPaths_Large(b *testing.B) {
	db, cleanup := setupGetAllFilesBenchmark(b, 5000)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		paths, err := db.GetAllIndexedPaths(ctx)
		if err != nil {
			b.Fatalf("GetAllIndexedPaths failed: %v", err)
		}
		_ = paths
	}
}

// BenchmarkGetAllIndexedPaths_Huge benchmarks with a huge library (10,000 files)
func BenchmarkGetAllIndexedPaths_Huge(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping huge benchmark in short mode")
	}

	db, cleanup := setupGetAllFilesBenchmark(b, 10000)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		paths, err := db.GetAllIndexedPaths(ctx)
		if err != nil {
			b.Fatalf("GetAllIndexedPaths failed: %v", err)
		}
		_ = paths
	}
}

// BenchmarkGetAllIndexedPaths_RealWorld benchmarks with a real-world sized library (40,000 files)
// This matches the user's production scenario where latency was 2.5 seconds
func BenchmarkGetAllIndexedPaths_RealWorld(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping real-world benchmark in short mode")
	}

	db, cleanup := setupGetAllFilesBenchmark(b, 40000)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		paths, err := db.GetAllIndexedPaths(ctx)
		if err != nil {
			b.Fatalf("GetAllIndexedPaths failed: %v", err)
		}
		_ = paths
	}
}

// =============================================================================
// Helper Functions
// =============================================================================

// setupBenchmarkDatabase is imported from queries_benchmark_test.go
// We reuse the existing function for consistency
