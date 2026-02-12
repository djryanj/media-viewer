package database

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// TestGetMediaInDirectoryWithFavoritesAndTags tests the optimized query's handling
// of favorites and tags using JOINs instead of N+1 queries.
func TestGetMediaInDirectoryWithFavoritesAndTags(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create test files
	files := []MediaFile{
		{Name: "alpha.jpg", Path: "photos/alpha.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 1024, ModTime: time.Now(), MimeType: "image/jpeg"},
		{Name: "beta.jpg", Path: "photos/beta.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 2048, ModTime: time.Now(), MimeType: "image/jpeg"},
		{Name: "gamma.mp4", Path: "photos/gamma.mp4", ParentPath: "photos", Type: FileTypeVideo, Size: 4096, ModTime: time.Now(), MimeType: "video/mp4"},
		{Name: "delta.jpg", Path: "photos/delta.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 1024, ModTime: time.Now(), MimeType: "image/jpeg"},
	}

	// Insert files
	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	for i := range files {
		if err := db.UpsertFile(tx, &files[i]); err != nil {
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Create tags
	tag1, err := db.GetOrCreateTag(ctx, "landscape")
	if err != nil {
		t.Fatalf("GetOrCreateTag failed: %v", err)
	}
	tag2, err := db.GetOrCreateTag(ctx, "portrait")
	if err != nil {
		t.Fatalf("GetOrCreateTag failed: %v", err)
	}
	tag3, err := db.GetOrCreateTag(ctx, "sunset")
	if err != nil {
		t.Fatalf("GetOrCreateTag failed: %v", err)
	}

	// Add favorites and tags
	// alpha.jpg: favorite, tags: landscape, sunset
	if err := db.AddFavorite(ctx, "photos/alpha.jpg", "alpha.jpg", FileTypeImage); err != nil {
		t.Fatalf("AddFavorite failed: %v", err)
	}
	if err := db.AddTagToFile(ctx, "photos/alpha.jpg", tag1.Name); err != nil {
		t.Fatalf("AddTagToFile failed: %v", err)
	}
	if err := db.AddTagToFile(ctx, "photos/alpha.jpg", tag3.Name); err != nil {
		t.Fatalf("AddTagToFile failed: %v", err)
	}

	// beta.jpg: tags: portrait
	if err := db.AddTagToFile(ctx, "photos/beta.jpg", tag2.Name); err != nil {
		t.Fatalf("AddTagToFile failed: %v", err)
	}

	// gamma.mp4: favorite, no tags
	if err := db.AddFavorite(ctx, "photos/gamma.mp4", "gamma.mp4", FileTypeVideo); err != nil {
		t.Fatalf("AddFavorite failed: %v", err)
	}

	// delta.jpg: no favorite, no tags

	// Fetch media files using optimized query
	mediaFiles, err := db.GetMediaInDirectory(ctx, "photos", SortByName, SortAsc)
	if err != nil {
		t.Fatalf("GetMediaInDirectory failed: %v", err)
	}

	// Verify count
	if len(mediaFiles) != 4 {
		t.Fatalf("Expected 4 files, got %d", len(mediaFiles))
	}

	// Verify sorting (alphabetical)
	if mediaFiles[0].Name != "alpha.jpg" {
		t.Errorf("First file = %s, want alpha.jpg", mediaFiles[0].Name)
	}
	if mediaFiles[1].Name != "beta.jpg" {
		t.Errorf("Second file = %s, want beta.jpg", mediaFiles[1].Name)
	}
	if mediaFiles[2].Name != "delta.jpg" {
		t.Errorf("Third file = %s, want delta.jpg", mediaFiles[2].Name)
	}
	if mediaFiles[3].Name != "gamma.mp4" {
		t.Errorf("Fourth file = %s, want gamma.mp4", mediaFiles[3].Name)
	}

	// Verify alpha.jpg
	alpha := mediaFiles[0]
	if !alpha.IsFavorite {
		t.Error("alpha.jpg should be a favorite")
	}
	if len(alpha.Tags) != 2 {
		t.Errorf("alpha.jpg should have 2 tags, got %d", len(alpha.Tags))
	}
	// Tags should be in alphabetical order from GROUP_CONCAT
	sort.Strings(alpha.Tags)
	expectedTags := []string{"landscape", "sunset"}
	sort.Strings(expectedTags)
	for i, tag := range expectedTags {
		if i >= len(alpha.Tags) || alpha.Tags[i] != tag {
			t.Errorf("alpha.jpg tags = %v, want %v", alpha.Tags, expectedTags)
			break
		}
	}

	// Verify beta.jpg
	beta := mediaFiles[1]
	if beta.IsFavorite {
		t.Error("beta.jpg should not be a favorite")
	}
	if len(beta.Tags) != 1 {
		t.Errorf("beta.jpg should have 1 tag, got %d", len(beta.Tags))
	}
	if len(beta.Tags) > 0 && beta.Tags[0] != "portrait" {
		t.Errorf("beta.jpg tag = %s, want portrait", beta.Tags[0])
	}

	// Verify delta.jpg
	delta := mediaFiles[2]
	if delta.IsFavorite {
		t.Error("delta.jpg should not be a favorite")
	}
	if len(delta.Tags) != 0 {
		t.Errorf("delta.jpg should have 0 tags, got %d: %v", len(delta.Tags), delta.Tags)
	}

	// Verify gamma.mp4
	gamma := mediaFiles[3]
	if !gamma.IsFavorite {
		t.Error("gamma.mp4 should be a favorite")
	}
	if len(gamma.Tags) != 0 {
		t.Errorf("gamma.mp4 should have 0 tags, got %d: %v", len(gamma.Tags), gamma.Tags)
	}
}

// TestGetMediaInDirectorySorting verifies that sorting works correctly with the optimized query.
func TestGetMediaInDirectorySorting(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create files with different attributes
	now := time.Now()
	files := []MediaFile{
		{Name: "zebra.jpg", Path: "sort/zebra.jpg", ParentPath: "sort", Type: FileTypeImage, Size: 1000, ModTime: now.Add(-3 * time.Hour), MimeType: "image/jpeg"},
		{Name: "alpha.jpg", Path: "sort/alpha.jpg", ParentPath: "sort", Type: FileTypeImage, Size: 5000, ModTime: now.Add(-1 * time.Hour), MimeType: "image/jpeg"},
		{Name: "beta.mp4", Path: "sort/beta.mp4", ParentPath: "sort", Type: FileTypeVideo, Size: 3000, ModTime: now.Add(-2 * time.Hour), MimeType: "video/mp4"},
	}

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	tests := []struct {
		name      string
		sortField SortField
		sortOrder SortOrder
		want      []string
	}{
		{
			name:      "sort by name ascending",
			sortField: SortByName,
			sortOrder: SortAsc,
			want:      []string{"alpha.jpg", "beta.mp4", "zebra.jpg"},
		},
		{
			name:      "sort by name descending",
			sortField: SortByName,
			sortOrder: SortDesc,
			want:      []string{"zebra.jpg", "beta.mp4", "alpha.jpg"},
		},
		{
			name:      "sort by date ascending (oldest first)",
			sortField: SortByDate,
			sortOrder: SortAsc,
			want:      []string{"zebra.jpg", "beta.mp4", "alpha.jpg"},
		},
		{
			name:      "sort by date descending (newest first)",
			sortField: SortByDate,
			sortOrder: SortDesc,
			want:      []string{"alpha.jpg", "beta.mp4", "zebra.jpg"},
		},
		{
			name:      "sort by size ascending",
			sortField: SortBySize,
			sortOrder: SortAsc,
			want:      []string{"zebra.jpg", "beta.mp4", "alpha.jpg"},
		},
		{
			name:      "sort by size descending",
			sortField: SortBySize,
			sortOrder: SortDesc,
			want:      []string{"alpha.jpg", "beta.mp4", "zebra.jpg"},
		},
		{
			name:      "sort by type ascending",
			sortField: SortByType,
			sortOrder: SortAsc,
			want:      []string{"alpha.jpg", "zebra.jpg", "beta.mp4"},
		},
		{
			name:      "sort by type descending",
			sortField: SortByType,
			sortOrder: SortDesc,
			want:      []string{"beta.mp4", "alpha.jpg", "zebra.jpg"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mediaFiles, err := db.GetMediaInDirectory(ctx, "sort", tt.sortField, tt.sortOrder)
			if err != nil {
				t.Fatalf("GetMediaInDirectory failed: %v", err)
			}

			if len(mediaFiles) != len(tt.want) {
				t.Fatalf("Got %d files, want %d", len(mediaFiles), len(tt.want))
			}

			for i, wantName := range tt.want {
				if mediaFiles[i].Name != wantName {
					t.Errorf("Position %d: got %s, want %s", i, mediaFiles[i].Name, wantName)
				}
			}
		})
	}
}

// TestGetMediaInDirectoryEmpty verifies handling of empty directories.
func TestGetMediaInDirectoryEmpty(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	mediaFiles, err := db.GetMediaInDirectory(ctx, "nonexistent", SortByName, SortAsc)
	if err != nil {
		t.Fatalf("GetMediaInDirectory failed: %v", err)
	}

	if len(mediaFiles) != 0 {
		t.Errorf("Expected 0 files for empty directory, got %d", len(mediaFiles))
	}
}

// TestGetMediaInDirectoryOnlyFolders verifies that folders are excluded (only images and videos).
func TestGetMediaInDirectoryOnlyFolders(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create only folder items
	files := []MediaFile{
		{Name: "subfolder1", Path: "mixed/subfolder1", ParentPath: "mixed", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "subfolder2", Path: "mixed/subfolder2", ParentPath: "mixed", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	mediaFiles, err := db.GetMediaInDirectory(ctx, "mixed", SortByName, SortAsc)
	if err != nil {
		t.Fatalf("GetMediaInDirectory failed: %v", err)
	}

	// Should return 0 since folders are not included
	if len(mediaFiles) != 0 {
		t.Errorf("Expected 0 media files (folders excluded), got %d", len(mediaFiles))
	}
}

// TestGetMediaInDirectoryManyTags verifies handling of files with many tags.
func TestGetMediaInDirectoryManyTags(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create a file
	file := MediaFile{
		Name:       "tagged.jpg",
		Path:       "tagged/tagged.jpg",
		ParentPath: "tagged",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
		MimeType:   "image/jpeg",
	}

	tx, _ := db.BeginBatch()
	_ = db.UpsertFile(tx, &file)
	_ = db.EndBatch(tx, nil)

	// Add many tags (10 tags)
	tagNames := []string{"tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"}
	for _, tagName := range tagNames {
		tag, err := db.GetOrCreateTag(ctx, tagName)
		if err != nil {
			t.Fatalf("GetOrCreateTag failed: %v", err)
		}
		if err := db.AddTagToFile(ctx, file.Path, tag.Name); err != nil {
			t.Fatalf("AddTagToFile failed: %v", err)
		}
	}

	mediaFiles, err := db.GetMediaInDirectory(ctx, "tagged", SortByName, SortAsc)
	if err != nil {
		t.Fatalf("GetMediaInDirectory failed: %v", err)
	}

	if len(mediaFiles) != 1 {
		t.Fatalf("Expected 1 file, got %d", len(mediaFiles))
	}

	if len(mediaFiles[0].Tags) != 10 {
		t.Errorf("Expected 10 tags, got %d: %v", len(mediaFiles[0].Tags), mediaFiles[0].Tags)
	}

	// Verify all tags are present
	tagMap := make(map[string]bool)
	for _, tag := range mediaFiles[0].Tags {
		tagMap[tag] = true
	}
	for _, expectedTag := range tagNames {
		if !tagMap[expectedTag] {
			t.Errorf("Missing expected tag: %s", expectedTag)
		}
	}
}

// TestGetMediaInDirectoryLargeDataset tests performance with a larger dataset.
func TestGetMediaInDirectoryLargeDataset(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create 1000 files with varying favorites and tags
	fileCount := 1000
	tx, _ := db.BeginBatch()

	for i := 0; i < fileCount; i++ {
		file := MediaFile{
			Name:       fmt.Sprintf("file_%04d.jpg", i),
			Path:       filepath.Join("large", fmt.Sprintf("file_%04d.jpg", i)),
			ParentPath: "large",
			Type:       FileTypeImage,
			Size:       1024 * int64(i+1),
			ModTime:    time.Now(),
			MimeType:   "image/jpeg",
		}
		_ = db.UpsertFile(tx, &file)
	}
	_ = db.EndBatch(tx, nil)

	// Add some favorites and tags
	tag1, _ := db.GetOrCreateTag(ctx, "test-tag")
	for i := 0; i < fileCount; i++ {
		filePath := filepath.Join("large", fmt.Sprintf("file_%04d.jpg", i))

		// Every 10th file is a favorite
		if i%10 == 0 {
			fileName := fmt.Sprintf("file_%04d.jpg", i)
			_ = db.AddFavorite(ctx, filePath, fileName, FileTypeImage)
		}

		// Every 5th file gets a tag
		if i%5 == 0 {
			_ = db.AddTagToFile(ctx, filePath, tag1.Name)
		}
	}

	// Measure execution time
	start := time.Now()
	mediaFiles, err := db.GetMediaInDirectory(ctx, "large", SortByName, SortAsc)
	duration := time.Since(start)

	if err != nil {
		t.Fatalf("GetMediaInDirectory failed: %v", err)
	}

	if len(mediaFiles) != fileCount {
		t.Errorf("Expected %d files, got %d", fileCount, len(mediaFiles))
	}

	t.Logf("Retrieved %d files with favorites and tags in %v", fileCount, duration)

	// Verify some samples
	if !mediaFiles[0].IsFavorite {
		t.Error("file_0000.jpg should be a favorite")
	}
	if len(mediaFiles[0].Tags) == 0 {
		t.Error("file_0000.jpg should have tags")
	}

	if mediaFiles[1].IsFavorite {
		t.Error("file_0001.jpg should not be a favorite")
	}
	if len(mediaFiles[1].Tags) != 0 {
		t.Error("file_0001.jpg should not have tags")
	}
}

// TestGetMediaInDirectoryDefaultParameters verifies default sort parameters.
func TestGetMediaInDirectoryDefaultParameters(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	files := []MediaFile{
		{Name: "zebra.jpg", Path: "default/zebra.jpg", ParentPath: "default", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "alpha.jpg", Path: "default/alpha.jpg", ParentPath: "default", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	// Call with empty sort parameters (should default to name ascending)
	mediaFiles, err := db.GetMediaInDirectory(ctx, "default", "", "")
	if err != nil {
		t.Fatalf("GetMediaInDirectory failed: %v", err)
	}

	if len(mediaFiles) != 2 {
		t.Fatalf("Expected 2 files, got %d", len(mediaFiles))
	}

	// Should be sorted by name ascending by default
	if mediaFiles[0].Name != "alpha.jpg" {
		t.Errorf("First file = %s, want alpha.jpg", mediaFiles[0].Name)
	}
	if mediaFiles[1].Name != "zebra.jpg" {
		t.Errorf("Second file = %s, want zebra.jpg", mediaFiles[1].Name)
	}
}
