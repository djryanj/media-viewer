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
	dbOpts := &Options{
		MmapDisabled: false, // Set to true if you want to disable mmap
	}
	db, _, err := New(context.Background(), dbPath, dbOpts)
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
	batch, err := db.BeginBatch(ctx)
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

		if err := batch.UpsertFile(ctx, &file); err != nil {
			b.Fatalf("Failed to upsert file: %v", err)
		}
	}

	if err = db.EndBatch(batch, err); err != nil {
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
	dbOpts := &Options{
		MmapDisabled: false, // Set to true if you want to disable mmap
	}
	db, _, err := New(context.Background(), dbPath, dbOpts)
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

// =============================================================================
// Covering Index Performance Tests
// =============================================================================

// BenchmarkGetMediaInDirectory_CoveringIndex_RealWorld simulates the user's exact scenario
// A directory with 1000 files with tags and favorites, sorted by name
// This demonstrates the performance improvement from covering indexes
func BenchmarkGetMediaInDirectory_CoveringIndex_RealWorld(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping real-world benchmark in short mode")
	}

	// Setup: 1000 files, 10% favorites, 2-3 tags per file (typical usage)
	db, cleanup := setupBenchmarkDatabase(b, 1000, 0.1, 2)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs() // Track allocations to show memory efficiency

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		if len(files) == 0 {
			b.Fatal("Expected files to be returned")
		}
	}
}

// BenchmarkGetMediaInDirectory_CoveringIndex_DateSort tests date sorting performance
// This uses the idx_files_media_directory_date covering index
func BenchmarkGetMediaInDirectory_CoveringIndex_DateSort(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping real-world benchmark in short mode")
	}

	db, cleanup := setupBenchmarkDatabase(b, 1000, 0.1, 2)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByDate, SortDesc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		if len(files) == 0 {
			b.Fatal("Expected files to be returned")
		}
	}
}

// BenchmarkGetMediaInDirectory_PathIndexJoins benchmarks JOIN performance with path index
// Tests the idx_files_path index optimization for favorites and file_tags JOINs
func BenchmarkGetMediaInDirectory_PathIndexJoins(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping path index benchmark in short mode")
	}

	// Many favorites and tags to stress-test JOIN performance
	db, cleanup := setupBenchmarkDatabase(b, 1000, 0.5, 5)
	defer cleanup()

	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		files, err := db.GetMediaInDirectory(ctx, "bench", SortByName, SortAsc)
		if err != nil {
			b.Fatalf("GetMediaInDirectory failed: %v", err)
		}
		if len(files) == 0 {
			b.Fatal("Expected files to be returned")
		}
	}
}

// =============================================================================
// Helper for ListDirectory, Search, and GetFavorites benchmarks
// =============================================================================

// setupBenchmarkDatabaseWithDirs creates a test database with multiple directories
func setupBenchmarkDatabaseWithDirs(b *testing.B, filesPerDir, numDirs int, favoriteRatio float64, avgTagsPerFile int) (db *Database, cleanup func()) {
	b.Helper()

	tmpDir := b.TempDir()
	dbPath := filepath.Join(tmpDir, "bench.db")
	dbOpts := &Options{
		MmapDisabled: false, // Set to true if you want to disable mmap
	}
	db, _, err := New(context.Background(), dbPath, dbOpts)
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

	// Create files in multiple directories
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		b.Fatalf("Failed to begin batch: %v", err)
	}

	allFiles := make([]string, 0, filesPerDir*numDirs)

	for dirNum := 0; dirNum < numDirs; dirNum++ {
		dirName := fmt.Sprintf("bench_dir_%03d", dirNum)

		// Add folder itself
		folder := MediaFile{
			Name:       dirName,
			Path:       dirName,
			ParentPath: "",
			Type:       FileTypeFolder,
			Size:       0,
			ModTime:    time.Now(),
		}
		if err := batch.UpsertFile(ctx, &folder); err != nil {
			b.Fatalf("Failed to upsert folder: %v", err)
		}

		// Add files in directory
		for i := 0; i < filesPerDir; i++ {
			fileName := fmt.Sprintf("file_%05d.jpg", i)
			filePath := filepath.Join(dirName, fileName)

			file := MediaFile{
				Name:       fileName,
				Path:       filePath,
				ParentPath: dirName,
				Type:       FileTypeImage,
				Size:       1024 * 1024, // 1MB
				ModTime:    time.Now().Add(time.Duration(i) * time.Second),
				MimeType:   "image/jpeg",
			}

			if err := batch.UpsertFile(ctx, &file); err != nil {
				b.Fatalf("Failed to upsert file: %v", err)
			}

			allFiles = append(allFiles, filePath)
		}
	}

	if err = db.EndBatch(batch, err); err != nil {
		b.Fatalf("Failed to end batch: %v", err)
	}

	// Add favorites and tags
	for i, filePath := range allFiles {
		fileName := filepath.Base(filePath)

		// Add to favorites based on ratio
		if float64(i)/float64(len(allFiles)) < favoriteRatio {
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

// =============================================================================
// ListDirectory Benchmarks
// =============================================================================

// BenchmarkListDirectory_Small benchmarks with a small directory (100 files)
func BenchmarkListDirectory_Small(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 100, 1, 0.2, 2)
	defer cleanup()

	ctx := context.Background()
	opts := ListOptions{
		Path:      "bench_dir_000",
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

// BenchmarkListDirectory_Medium benchmarks with a medium directory (1,000 files)
func BenchmarkListDirectory_Medium(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 1000, 1, 0.2, 2)
	defer cleanup()

	ctx := context.Background()
	opts := ListOptions{
		Path:      "bench_dir_000",
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

// BenchmarkListDirectory_Large benchmarks with a large directory (5,000 files)
func BenchmarkListDirectory_Large(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 5000, 1, 0.2, 2)
	defer cleanup()

	ctx := context.Background()
	opts := ListOptions{
		Path:      "bench_dir_000",
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

// BenchmarkListDirectory_WithFoldersAndFiles benchmarks mixed content
func BenchmarkListDirectory_WithFoldersAndFiles(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 1000, 10, 0.3, 3)
	defer cleanup()

	ctx := context.Background()
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

// =============================================================================
// Search Benchmarks
// =============================================================================

// BenchmarkSearch_TagFilters_Small benchmarks tag search with small result set
func BenchmarkSearch_TagFilters_Small(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 500, 2, 0.3, 2)
	defer cleanup()

	ctx := context.Background()
	opts := SearchOptions{
		Query:    "tag:tag1",
		Page:     1,
		PageSize: 50,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.Search(ctx, opts)
		if err != nil {
			b.Fatalf("Search failed: %v", err)
		}
	}
}

// BenchmarkSearch_TagFilters_Large benchmarks tag search with large result set
func BenchmarkSearch_TagFilters_Large(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 2000, 3, 0.3, 3)
	defer cleanup()

	ctx := context.Background()
	opts := SearchOptions{
		Query:    "tag:tag1",
		Page:     1,
		PageSize: 100,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.Search(ctx, opts)
		if err != nil {
			b.Fatalf("Search failed: %v", err)
		}
	}
}

// BenchmarkSearch_MultipleTagFilters benchmarks search with multiple tag filters
func BenchmarkSearch_MultipleTagFilters(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 1000, 2, 0.3, 4)
	defer cleanup()

	ctx := context.Background()
	opts := SearchOptions{
		Query:    "tag:tag1 tag:tag2",
		Page:     1,
		PageSize: 50,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.Search(ctx, opts)
		if err != nil {
			b.Fatalf("Search failed: %v", err)
		}
	}
}

// BenchmarkSearch_TextPlusTags benchmarks combined text and tag search
func BenchmarkSearch_TextPlusTags(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 1000, 2, 0.3, 3)
	defer cleanup()

	ctx := context.Background()
	opts := SearchOptions{
		Query:    "file tag:tag1",
		Page:     1,
		PageSize: 50,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.Search(ctx, opts)
		if err != nil {
			b.Fatalf("Search failed: %v", err)
		}
	}
}

// BenchmarkSearch_WithExclusion benchmarks search with tag exclusions
func BenchmarkSearch_WithExclusion(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 1000, 2, 0.3, 3)
	defer cleanup()

	ctx := context.Background()
	opts := SearchOptions{
		Query:    "tag:tag1 -tag:tag5",
		Page:     1,
		PageSize: 50,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.Search(ctx, opts)
		if err != nil {
			b.Fatalf("Search failed: %v", err)
		}
	}
}

// =============================================================================
// ListDirectory – targeted subquery and sort benchmarks
// =============================================================================

// setupBenchmarkDatabaseWithMixedDir creates a database where the queried
// directory ("mixed_dir") contains both direct image/video files AND
// named subdirectories, each with their own child files. This is the shape
// that exercises all three correlated subqueries in fetchDirectoryItems:
//   - EXISTS(SELECT 1 FROM favorites ...) — once per image/video row
//   - GROUP_CONCAT tag subquery         — once per image/video row
//   - COUNT(*) child files subquery     — once per folder row
//
// Parameters:
//
//	subfolderCount  – number of subdirectory entries in "mixed_dir"
//	filesPerSubdir  – number of child files in each subdirectory (determines child-count result)
//	directFiles     – number of image files directly in "mixed_dir"
//	favoriteRatio   – fraction of direct files added to favorites
//	avgTagsPerFile  – average number of tags applied to each direct file
func setupBenchmarkDatabaseWithMixedDir(
	b *testing.B,
	subfolderCount, filesPerSubdir, directFiles int,
	favoriteRatio float64,
	avgTagsPerFile int,
) (db *Database, cleanup func()) {
	b.Helper()

	tmpDir := b.TempDir()
	dbPath := filepath.Join(tmpDir, "bench.db")
	db, _, err := New(context.Background(), dbPath, &Options{})
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}

	ctx := context.Background()

	tagNames := []string{"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"}
	for _, name := range tagNames {
		if _, err := db.GetOrCreateTag(ctx, name); err != nil {
			b.Fatalf("Failed to create tag %q: %v", name, err)
		}
	}

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		b.Fatalf("Failed to begin batch: %v", err)
	}

	const parent = "mixed_dir"

	// Insert the parent directory itself.
	if err := batch.UpsertFile(ctx, &MediaFile{
		Name: parent, Path: parent, ParentPath: "", Type: FileTypeFolder,
	}); err != nil {
		b.Fatalf("Failed to upsert parent dir: %v", err)
	}

	// Insert subdirectories under mixed_dir, each with filesPerSubdir children.
	for i := 0; i < subfolderCount; i++ {
		subdirName := fmt.Sprintf("sub_%03d", i)
		subdirPath := parent + "/" + subdirName
		if err := batch.UpsertFile(ctx, &MediaFile{
			Name: subdirName, Path: subdirPath, ParentPath: parent, Type: FileTypeFolder,
		}); err != nil {
			b.Fatalf("Failed to upsert subdir: %v", err)
		}
		for j := 0; j < filesPerSubdir; j++ {
			childName := fmt.Sprintf("child_%05d.jpg", j)
			childPath := subdirPath + "/" + childName
			if err := batch.UpsertFile(ctx, &MediaFile{
				Name: childName, Path: childPath, ParentPath: subdirPath,
				Type: FileTypeImage, Size: 512 * 1024,
				ModTime: time.Now().Add(time.Duration(j) * time.Second),
			}); err != nil {
				b.Fatalf("Failed to upsert child file: %v", err)
			}
		}
	}

	// Insert direct image files under mixed_dir.
	directFilePaths := make([]string, 0, directFiles)
	for i := 0; i < directFiles; i++ {
		fileName := fmt.Sprintf("img_%05d.jpg", i)
		filePath := parent + "/" + fileName
		if err := batch.UpsertFile(ctx, &MediaFile{
			Name: fileName, Path: filePath, ParentPath: parent,
			Type: FileTypeImage, Size: int64(1024*1024 + i*1024),
			ModTime:  time.Now().Add(time.Duration(i) * time.Second),
			MimeType: "image/jpeg",
		}); err != nil {
			b.Fatalf("Failed to upsert direct file: %v", err)
		}
		directFilePaths = append(directFilePaths, filePath)
	}

	if err = db.EndBatch(batch, err); err != nil {
		b.Fatalf("Failed to end batch: %v", err)
	}

	// Apply favorites and tags to direct files only (mirrors real usage).
	for i, fp := range directFilePaths {
		if float64(i)/float64(len(directFilePaths)) < favoriteRatio {
			if err := db.AddFavorite(ctx, fp, filepath.Base(fp), FileTypeImage); err != nil {
				b.Fatalf("Failed to add favorite: %v", err)
			}
		}
		for j := 0; j < avgTagsPerFile && j < len(tagNames); j++ {
			if err := db.AddTagToFile(ctx, fp, tagNames[(i+j)%len(tagNames)]); err != nil {
				b.Fatalf("Failed to add tag: %v", err)
			}
		}
	}

	return db, func() {
		db.Close()
		os.RemoveAll(tmpDir)
	}
}

// BenchmarkListDirectory_MixedContent_SortByName benchmarks a directory that
// contains both subfolders and image files sorted by name — the most common
// real-world case. All three correlated subqueries (favorites EXISTS, tag
// GROUP_CONCAT, folder child COUNT) fire on every page.
func BenchmarkListDirectory_MixedContent_SortByName(b *testing.B) {
	// 20 subfolders (each with 50 children → child-COUNT fires 20×),
	// 200 direct images (favorites + tag subqueries fire 200× per page).
	db, cleanup := setupBenchmarkDatabaseWithMixedDir(b, 20, 50, 200, 0.25, 3)
	defer cleanup()

	ctx := context.Background()
	opts := ListOptions{
		Path: "mixed_dir", SortField: SortByName, SortOrder: SortAsc,
		Page: 1, PageSize: 50,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := db.ListDirectory(ctx, opts); err != nil {
			b.Fatalf("ListDirectory failed: %v", err)
		}
	}
}

// BenchmarkListDirectory_MixedContent_SortByDate benchmarks the same mixed
// directory sorted by modification date. Uses the idx_files_media_directory_date
// covering index (when the CASE WHEN ORDER BY is not present).
func BenchmarkListDirectory_MixedContent_SortByDate(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithMixedDir(b, 20, 50, 200, 0.25, 3)
	defer cleanup()

	ctx := context.Background()
	opts := ListOptions{
		Path: "mixed_dir", SortField: SortByDate, SortOrder: SortDesc,
		Page: 1, PageSize: 50,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := db.ListDirectory(ctx, opts); err != nil {
			b.Fatalf("ListDirectory failed: %v", err)
		}
	}
}

// BenchmarkListDirectory_MixedContent_SortBySize benchmarks the same mixed
// directory sorted by file size.
func BenchmarkListDirectory_MixedContent_SortBySize(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithMixedDir(b, 20, 50, 200, 0.25, 3)
	defer cleanup()

	ctx := context.Background()
	opts := ListOptions{
		Path: "mixed_dir", SortField: SortBySize, SortOrder: SortDesc,
		Page: 1, PageSize: 50,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := db.ListDirectory(ctx, opts); err != nil {
			b.Fatalf("ListDirectory failed: %v", err)
		}
	}
}

// BenchmarkListDirectory_ManySubfolders benchmarks a directory composed almost
// entirely of subfolders (50 subfolders, each with 100 children). The folder
// child-COUNT correlated subquery dominates because it fires once per folder
// row with a full index scan of files.parent_path per folder.
func BenchmarkListDirectory_ManySubfolders(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithMixedDir(b, 50, 100, 10, 0.1, 1)
	defer cleanup()

	ctx := context.Background()
	opts := ListOptions{
		Path: "mixed_dir", SortField: SortByName, SortOrder: SortAsc,
		Page: 1, PageSize: 60,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := db.ListDirectory(ctx, opts); err != nil {
			b.Fatalf("ListDirectory failed: %v", err)
		}
	}
}

// BenchmarkListDirectory_HighTagDensity benchmarks the GROUP_CONCAT tag
// subquery cost at near-maximum tag density (9 tags per file, 300 files).
// With the current per-row subquery design this is the worst case for tag
// aggregation: 300 JOIN-based subqueries per page.
func BenchmarkListDirectory_HighTagDensity(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithMixedDir(b, 5, 20, 300, 0.3, 9)
	defer cleanup()

	ctx := context.Background()
	opts := ListOptions{
		Path: "mixed_dir", SortField: SortByName, SortOrder: SortAsc,
		Page: 1, PageSize: 50,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := db.ListDirectory(ctx, opts); err != nil {
			b.Fatalf("ListDirectory failed: %v", err)
		}
	}
}

// =============================================================================
// GetFavorites Benchmarks
// =============================================================================

// BenchmarkGetFavorites_Small benchmarks with few favorites (20)
func BenchmarkGetFavorites_Small(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 100, 2, 0.1, 2)
	defer cleanup()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.GetFavorites(ctx)
		if err != nil {
			b.Fatalf("GetFavorites failed: %v", err)
		}
	}
}

// BenchmarkGetFavorites_Medium benchmarks with medium favorites (100)
func BenchmarkGetFavorites_Medium(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 500, 2, 0.2, 2)
	defer cleanup()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.GetFavorites(ctx)
		if err != nil {
			b.Fatalf("GetFavorites failed: %v", err)
		}
	}
}

// BenchmarkGetFavorites_Large benchmarks with many favorites (500)
func BenchmarkGetFavorites_Large(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 1000, 5, 0.3, 2)
	defer cleanup()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.GetFavorites(ctx)
		if err != nil {
			b.Fatalf("GetFavorites failed: %v", err)
		}
	}
}

// BenchmarkGetFavorites_ManyFolders benchmarks with many favorited folders
func BenchmarkGetFavorites_ManyFolders(b *testing.B) {
	db, cleanup := setupBenchmarkDatabaseWithDirs(b, 100, 50, 0.1, 2)
	defer cleanup()

	ctx := context.Background()

	// Favorite all folders
	for i := 0; i < 50; i++ {
		dirName := fmt.Sprintf("bench_dir_%03d", i)
		if err := db.AddFavorite(ctx, dirName, dirName, FileTypeFolder); err != nil {
			b.Fatalf("Failed to add favorite folder: %v", err)
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := db.GetFavorites(ctx)
		if err != nil {
			b.Fatalf("GetFavorites failed: %v", err)
		}
	}
}
