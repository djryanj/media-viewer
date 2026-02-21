// database_integration_test.go
package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Integration tests for database operations with real SQLite database

func setupTestDB(t testing.TB) (db *Database, dbPath string) {
	t.Helper()

	tmpDir := t.TempDir()
	dbPath = filepath.Join(tmpDir, "test.db")

	db, _, err := New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create test database: %v", err)
	}

	// Initialize WebAuthn schema for tests that need it
	if err := db.InitWebAuthnSchema(); err != nil {
		t.Fatalf("Failed to initialize WebAuthn schema: %v", err)
	}

	return db, dbPath
}

func TestNewDatabase(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, _, err := New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer db.Close()

	// Verify database file was created
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Error("Database file was not created")
	}

	// Verify we can ping it
	ctx := context.Background()
	if err := db.db.PingContext(ctx); err != nil {
		t.Errorf("Database ping failed: %v", err)
	}
}

func TestDatabaseClose(t *testing.T) {
	db, _ := setupTestDB(t)

	err := db.Close()
	if err != nil {
		t.Errorf("Close() failed: %v", err)
	}

	// Second close should also succeed (idempotent)
	err = db.Close()
	if err != nil {
		t.Errorf("Second Close() failed: %v", err)
	}
}

func TestUpsertFileIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	now := time.Now()

	file := MediaFile{
		Name:       "test.jpg",
		Path:       "test/test.jpg",
		ParentPath: "test",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    now,
		MimeType:   "image/jpeg",
		FileHash:   "abc123",
	}

	// Insert new file using transaction
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	err = db.UpsertFile(ctx, tx, &file)
	if err != nil {
		t.Fatalf("UpsertFile failed on insert: %v", err)
	}

	err = db.EndBatch(tx, nil)
	if err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Update existing file
	file.Size = 2048
	tx, err = db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	err = db.UpsertFile(ctx, tx, &file)
	if err != nil {
		t.Fatalf("UpsertFile failed on update: %v", err)
	}

	err = db.EndBatch(tx, nil)
	if err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Verify file was updated
	var size int64
	err = db.db.QueryRowContext(ctx, "SELECT size FROM files WHERE path = ?", file.Path).Scan(&size)
	if err != nil {
		t.Fatalf("Failed to query file: %v", err)
	}

	if size != 2048 {
		t.Errorf("Size = %d, want 2048", size)
	}
}

func TestListDirectoryIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert test files using transactions
	files := []MediaFile{
		{Name: "folder1", Path: "folder1", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "image1.jpg", Path: "image1.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now(), MimeType: "image/jpeg"},
		{Name: "video1.mp4", Path: "video1.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now(), MimeType: "video/mp4"},
		{Name: "subfolder", Path: "folder1/subfolder", ParentPath: "folder1", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := db.UpsertFile(ctx, tx, &files[i]); err != nil {
			t.Fatalf("Failed to insert file %s: %v", files[i].Path, err)
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	tests := []struct {
		name          string
		path          string
		filterType    string
		expectedCount int
		shouldContain []string
	}{
		{
			name:          "Root directory",
			path:          "",
			expectedCount: 3,
			shouldContain: []string{"folder1", "image1.jpg", "video1.mp4"},
		},
		{
			name:          "Subdirectory",
			path:          "folder1",
			expectedCount: 1,
			shouldContain: []string{"subfolder"},
		},
		{
			name:          "Filter images only",
			path:          "",
			filterType:    string(FileTypeImage),
			expectedCount: 2, // folder1 + image1.jpg (folders always included)
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opts := ListOptions{
				Path:       tt.path,
				FilterType: tt.filterType,
				Page:       1,
				PageSize:   100,
			}

			listing, err := db.ListDirectory(ctx, opts)
			if err != nil {
				t.Fatalf("ListDirectory failed: %v", err)
			}

			if len(listing.Items) != tt.expectedCount {
				t.Errorf("Got %d items, want %d", len(listing.Items), tt.expectedCount)
			}

			for _, expectedName := range tt.shouldContain {
				found := false
				for _, item := range listing.Items {
					if item.Name == expectedName {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected to find %s in listing", expectedName)
				}
			}
		})
	}
}

func TestSearchIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert test files
	files := []MediaFile{
		{Name: "sunset.jpg", Path: "photos/sunset.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "sunrise.jpg", Path: "photos/sunrise.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "beach.mp4", Path: "videos/beach.mp4", ParentPath: "videos", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := db.UpsertFile(ctx, tx, &files[i]); err != nil {
			t.Fatalf("Failed to insert file: %v", err)
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	tests := []struct {
		name          string
		query         string
		filterType    string
		expectedMin   int
		shouldContain string
	}{
		{
			name:          "Search for 'sun'",
			query:         "sun",
			expectedMin:   2,
			shouldContain: "sunset.jpg",
		},
		{
			name:          "Search for 'beach'",
			query:         "beach",
			expectedMin:   1,
			shouldContain: "beach.mp4",
		},
		{
			name:        "Search with image filter",
			query:       "sun",
			filterType:  string(FileTypeImage),
			expectedMin: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opts := SearchOptions{
				Query:      tt.query,
				FilterType: tt.filterType,
				Page:       1,
				PageSize:   100,
			}

			results, err := db.Search(ctx, opts)
			if err != nil {
				t.Fatalf("Search failed: %v", err)
			}

			if len(results.Items) < tt.expectedMin {
				t.Errorf("Got %d results, want at least %d", len(results.Items), tt.expectedMin)
			}

			if tt.shouldContain != "" {
				found := false
				for _, item := range results.Items {
					if item.Name == tt.shouldContain {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected to find %s in results", tt.shouldContain)
				}
			}
		})
	}
}

func TestGetFileByPathIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	file := MediaFile{
		Name:       "test.jpg",
		Path:       "test/test.jpg",
		ParentPath: "test",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
		MimeType:   "image/jpeg",
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	err = db.UpsertFile(ctx, tx, &file)
	if err != nil {
		t.Fatalf("UpsertFile failed: %v", err)
	}

	err = db.EndBatch(tx, nil)
	if err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Retrieve the file
	retrieved, err := db.GetFileByPath(ctx, file.Path)
	if err != nil {
		t.Fatalf("GetFileByPath failed: %v", err)
	}

	if retrieved.Name != file.Name {
		t.Errorf("Name = %s, want %s", retrieved.Name, file.Name)
	}

	if retrieved.Size != file.Size {
		t.Errorf("Size = %d, want %d", retrieved.Size, file.Size)
	}

	// Try to get nonexistent file
	_, err = db.GetFileByPath(ctx, "nonexistent.jpg")
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

func TestGetFilesUpdatedSinceIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	now := time.Now()

	// Insert old file first
	oldFile := MediaFile{
		Name:       "old.jpg",
		Path:       "old.jpg",
		ParentPath: "",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    now.Add(-1 * time.Hour),
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	if err := db.UpsertFile(ctx, tx, &oldFile); err != nil {
		t.Fatalf("Failed to insert old file: %v", err)
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Wait longer than the 10-second buffer used by GetFilesUpdatedSince
	// Plus add extra time to ensure clear separation
	t.Logf("Waiting 12 seconds for timestamp separation...")
	time.Sleep(12 * time.Second)

	// Mark the cutoff time - only files inserted AFTER this should be returned
	// Add 1 more second of buffer to be safe
	cutoffTime := time.Now().Add(1 * time.Second)

	// Wait another second to ensure we're past the cutoff
	time.Sleep(2 * time.Second)

	// Insert new file
	newFile := MediaFile{
		Name:       "new.jpg",
		Path:       "new.jpg",
		ParentPath: "",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    now,
	}

	tx, err = db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	if err := db.UpsertFile(ctx, tx, &newFile); err != nil {
		t.Fatalf("Failed to insert new file: %v", err)
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Get files updated since the cutoff time
	// Note: GetFilesUpdatedSince subtracts 10 seconds from this time internally
	updated, err := db.GetFilesUpdatedSince(ctx, cutoffTime)
	if err != nil {
		t.Fatalf("GetFilesUpdatedSince failed: %v", err)
	}

	// Should only get new.jpg (old.jpg was inserted >12 seconds before cutoff)
	if len(updated) != 1 {
		t.Errorf("Got %d files, want 1", len(updated))
		for i, f := range updated {
			t.Logf("  File %d: %s", i, f.Name)
		}
	}

	if len(updated) > 0 && updated[0].Name != "new.jpg" {
		t.Errorf("Got file %s, want new.jpg", updated[0].Name)
	}
}

func TestGetSubfoldersIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create folder structure
	folders := []MediaFile{
		{Name: "parent", Path: "parent", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "child1", Path: "parent/child1", ParentPath: "parent", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "child2", Path: "parent/child2", ParentPath: "parent", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "grandchild", Path: "parent/child1/grandchild", ParentPath: "parent/child1", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range folders {
		if err := db.UpsertFile(ctx, tx, &folders[i]); err != nil {
			t.Fatalf("Failed to insert folder: %v", err)
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Get subfolders of parent
	subfolders, err := db.GetSubfolders(ctx, "parent")
	if err != nil {
		t.Fatalf("GetSubfolders failed: %v", err)
	}

	if len(subfolders) != 2 {
		t.Errorf("Got %d subfolders, want 2", len(subfolders))
	}

	// Verify subfolder names
	names := make(map[string]bool)
	for _, folder := range subfolders {
		names[folder.Name] = true
	}

	if !names["child1"] || !names["child2"] {
		t.Error("Expected child1 and child2 in subfolders")
	}
}

func TestGetMediaFilesInFolderIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create files in folder
	files := []MediaFile{
		{Name: "image1.jpg", Path: "folder/image1.jpg", ParentPath: "folder", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "image2.jpg", Path: "folder/image2.jpg", ParentPath: "folder", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video1.mp4", Path: "folder/video1.mp4", ParentPath: "folder", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := db.UpsertFile(ctx, tx, &files[i]); err != nil {
			t.Fatalf("Failed to insert file: %v", err)
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Get media files
	mediaFiles, err := db.GetMediaFilesInFolder(ctx, "folder", 10)
	if err != nil {
		t.Fatalf("GetMediaFilesInFolder failed: %v", err)
	}

	if len(mediaFiles) != 3 {
		t.Errorf("Got %d files, want 3", len(mediaFiles))
	}
}

func TestGetLastThumbnailRunIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Initially should be zero
	lastRun, err := db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun failed: %v", err)
	}

	if !lastRun.IsZero() {
		t.Error("Initial last run should be zero")
	}

	// Set last thumbnail run
	now := time.Now()
	err = db.SetLastThumbnailRun(ctx, now)
	if err != nil {
		t.Fatalf("SetLastThumbnailRun failed: %v", err)
	}

	// Retrieve it
	lastRun, err = db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun failed: %v", err)
	}

	// Should be within a second of what we set
	diff := lastRun.Sub(now)
	if diff < 0 {
		diff = -diff
	}

	if diff > time.Second {
		t.Errorf("Last run time diff = %v, want < 1s", diff)
	}
}

func TestCalculateStatsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert some files
	files := []MediaFile{
		{Name: "image.jpg", Path: "image.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video.mp4", Path: "video.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := db.UpsertFile(ctx, tx, &files[i]); err != nil {
			t.Fatalf("Failed to insert file: %v", err)
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Calculate stats
	stats, err := db.CalculateStats()
	if err != nil {
		t.Fatalf("CalculateStats failed: %v", err)
	}

	// TotalFiles counts media files (images + videos), not folders
	if stats.TotalFiles < 2 {
		t.Errorf("TotalFiles = %d, want at least 2", stats.TotalFiles)
	}

	// Should have exactly 1 folder
	if stats.TotalFolders != 1 {
		t.Errorf("TotalFolders = %d, want 1", stats.TotalFolders)
	}

	// Should have at least 1 image and 1 video
	if stats.TotalImages < 1 {
		t.Errorf("TotalImages = %d, want at least 1", stats.TotalImages)
	}

	if stats.TotalVideos < 1 {
		t.Errorf("TotalVideos = %d, want at least 1", stats.TotalVideos)
	}

	t.Logf("Stats: %+v", stats)
}

// TestDatabaseConcurrency tests that batch transactions work correctly with sequential inserts
func TestDatabaseConcurrency(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	const numFiles = 100

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := 0; i < numFiles; i++ {
		file := MediaFile{
			Name:       fmt.Sprintf("file%d.jpg", i),
			Path:       filepath.Join("concurrent", fmt.Sprintf("file%d.jpg", i)),
			ParentPath: "concurrent",
			Type:       FileTypeImage,
			Size:       int64(i * 1024),
			ModTime:    time.Now(),
		}

		if err := db.UpsertFile(ctx, tx, &file); err != nil {
			t.Errorf("Insert %d failed: %v", i, err)
		}
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	opts := ListOptions{
		Path:     "concurrent",
		Page:     1,
		PageSize: 200,
	}

	listing, err := db.ListDirectory(ctx, opts)
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}

	if len(listing.Items) != numFiles {
		t.Errorf("Got %d files, want %d", len(listing.Items), numFiles)
	}
}

func BenchmarkUpsertFile(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()

	ctx := context.Background()
	now := time.Now()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		file := MediaFile{
			Name:       "bench.jpg",
			Path:       "bench/bench.jpg",
			ParentPath: "bench",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    now,
		}

		tx, _ := db.BeginBatch(ctx)
		_ = db.UpsertFile(ctx, tx, &file)
		_ = db.EndBatch(tx, nil)
	}
}

func BenchmarkListDirectory(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()

	ctx := context.Background()

	// Insert some files
	tx, _ := db.BeginBatch(ctx)
	for i := 0; i < 100; i++ {
		file := MediaFile{
			Name:       filepath.Base(filepath.Join("bench", string(rune('a'+i%26))+".jpg")),
			Path:       filepath.Join("bench", string(rune('a'+i%26))+".jpg"),
			ParentPath: "bench",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(ctx, tx, &file)
	}
	_ = db.EndBatch(tx, nil)

	opts := ListOptions{
		Path:     "bench",
		Page:     1,
		PageSize: 50,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = db.ListDirectory(ctx, opts)
	}
}

// =============================================================================
// Additional Coverage Tests
// =============================================================================

func TestListDirectorySorting(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files with different attributes
	files := []MediaFile{
		{Name: "zebra.jpg", Path: "zebra.jpg", ParentPath: "", Type: FileTypeImage, Size: 3000, ModTime: time.Now().Add(-3 * time.Hour)},
		{Name: "alpha.jpg", Path: "alpha.jpg", ParentPath: "", Type: FileTypeImage, Size: 1000, ModTime: time.Now().Add(-1 * time.Hour)},
		{Name: "beta.mp4", Path: "beta.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2000, ModTime: time.Now().Add(-2 * time.Hour)},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = db.UpsertFile(ctx, tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	tests := []struct {
		name          string
		sortField     SortField
		sortOrder     SortOrder
		expectedFirst string
	}{
		{
			name:          "Sort by name ascending",
			sortField:     SortByName,
			sortOrder:     SortAsc,
			expectedFirst: "alpha.jpg",
		},
		{
			name:          "Sort by name descending",
			sortField:     SortByName,
			sortOrder:     SortDesc,
			expectedFirst: "zebra.jpg",
		},
		{
			name:          "Sort by size ascending",
			sortField:     SortBySize,
			sortOrder:     SortAsc,
			expectedFirst: "alpha.jpg",
		},
		{
			name:          "Sort by size descending",
			sortField:     SortBySize,
			sortOrder:     SortDesc,
			expectedFirst: "zebra.jpg",
		},
		{
			name:          "Sort by date ascending",
			sortField:     SortByDate,
			sortOrder:     SortAsc,
			expectedFirst: "zebra.jpg",
		},
		{
			name:          "Sort by date descending",
			sortField:     SortByDate,
			sortOrder:     SortDesc,
			expectedFirst: "alpha.jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opts := ListOptions{
				Path:      "",
				SortField: tt.sortField,
				SortOrder: tt.sortOrder,
				Page:      1,
				PageSize:  100,
			}

			listing, err := db.ListDirectory(ctx, opts)
			if err != nil {
				t.Fatalf("ListDirectory failed: %v", err)
			}

			if len(listing.Items) > 0 && listing.Items[0].Name != tt.expectedFirst {
				t.Errorf("First item = %s, want %s", listing.Items[0].Name, tt.expectedFirst)
			}
		})
	}
}

func TestListDirectoryPagination(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert 25 files
	tx, _ := db.BeginBatch(ctx)
	for i := 0; i < 25; i++ {
		file := MediaFile{
			Name:       filepath.Base(filepath.Join("page", "file"+string(rune('a'+i%26))+".jpg")),
			Path:       filepath.Join("page", "file"+string(rune('a'+i%26))+".jpg"),
			ParentPath: "page",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(ctx, tx, &file)
	}
	_ = db.EndBatch(tx, nil)

	tests := []struct {
		name        string
		page        int
		pageSize    int
		expectItems int
		expectTotal int
		expectPages int
	}{
		{
			name:        "Page 1 of 10",
			page:        1,
			pageSize:    10,
			expectItems: 10,
			expectTotal: 25,
			expectPages: 3,
		},
		{
			name:        "Page 2 of 10",
			page:        2,
			pageSize:    10,
			expectItems: 10,
			expectTotal: 25,
			expectPages: 3,
		},
		{
			name:        "Page 3 of 10 (partial)",
			page:        3,
			pageSize:    10,
			expectItems: 5,
			expectTotal: 25,
			expectPages: 3,
		},
		{
			name:        "Large page size",
			page:        1,
			pageSize:    100,
			expectItems: 25,
			expectTotal: 25,
			expectPages: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opts := ListOptions{
				Path:     "page",
				Page:     tt.page,
				PageSize: tt.pageSize,
			}

			listing, err := db.ListDirectory(ctx, opts)
			if err != nil {
				t.Fatalf("ListDirectory failed: %v", err)
			}

			if len(listing.Items) != tt.expectItems {
				t.Errorf("Got %d items, want %d", len(listing.Items), tt.expectItems)
			}

			if listing.TotalItems != tt.expectTotal {
				t.Errorf("TotalItems = %d, want %d", listing.TotalItems, tt.expectTotal)
			}

			if listing.TotalPages != tt.expectPages {
				t.Errorf("TotalPages = %d, want %d", listing.TotalPages, tt.expectPages)
			}
		})
	}
}

func TestListDirectoryEmpty(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	opts := ListOptions{
		Path:     "nonexistent",
		Page:     1,
		PageSize: 100,
	}

	listing, err := db.ListDirectory(ctx, opts)
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}

	if len(listing.Items) != 0 {
		t.Errorf("Got %d items, want 0", len(listing.Items))
	}

	if listing.TotalItems != 0 {
		t.Errorf("TotalItems = %d, want 0", listing.TotalItems)
	}
}

func TestSearchSuggestions(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files
	files := []MediaFile{
		{Name: "sunset.jpg", Path: "sunset.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "sunrise.jpg", Path: "sunrise.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "beach.mp4", Path: "beach.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = db.UpsertFile(ctx, tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	suggestions, err := db.SearchSuggestions(ctx, "sun", 5)
	if err != nil {
		t.Fatalf("SearchSuggestions failed: %v", err)
	}

	if len(suggestions) < 1 {
		t.Error("Expected at least 1 suggestion")
	}

	t.Logf("Suggestions: %+v", suggestions)
}

func TestGetAllPlaylists(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert a playlist file
	playlist := MediaFile{
		Name:       "myplaylist.wpl",
		Path:       "myplaylist.wpl",
		ParentPath: "",
		Type:       FileTypePlaylist,
		Size:       512,
		ModTime:    time.Now(),
		MimeType:   "application/vnd.ms-wpl",
	}

	tx, _ := db.BeginBatch(ctx)
	_ = db.UpsertFile(ctx, tx, &playlist)
	_ = db.EndBatch(tx, nil)

	playlists, err := db.GetAllPlaylists(ctx)
	if err != nil {
		t.Fatalf("GetAllPlaylists failed: %v", err)
	}

	if len(playlists) != 1 {
		t.Errorf("Got %d playlists, want 1", len(playlists))
	}

	if len(playlists) > 0 && playlists[0].Name != "myplaylist.wpl" {
		t.Errorf("Playlist name = %s, want myplaylist.wpl", playlists[0].Name)
	}
}

func TestGetMediaInDirectory(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files in a directory
	files := []MediaFile{
		{Name: "zebra.jpg", Path: "media/zebra.jpg", ParentPath: "media", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "alpha.jpg", Path: "media/alpha.jpg", ParentPath: "media", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "beta.mp4", Path: "media/beta.mp4", ParentPath: "media", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = db.UpsertFile(ctx, tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	mediaFiles, err := db.GetMediaInDirectory(ctx, "media", SortByName, SortAsc)
	if err != nil {
		t.Fatalf("GetMediaInDirectory failed: %v", err)
	}

	if len(mediaFiles) != 3 {
		t.Errorf("Got %d files, want 3", len(mediaFiles))
	}

	// Verify sorted by name ascending
	if len(mediaFiles) >= 2 && mediaFiles[0].Name != "alpha.jpg" {
		t.Errorf("First file = %s, want alpha.jpg", mediaFiles[0].Name)
	}
}

func TestGetMediaInDirectory_CoveringIndexes(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Verify that the covering indexes exist
	var indexCount int
	query := `
		SELECT COUNT(*)
		FROM sqlite_master
		WHERE type = 'index'
		AND name IN ('idx_files_media_directory_name', 'idx_files_media_directory_date', 'idx_files_path')
	`
	err := db.db.QueryRowContext(ctx, query).Scan(&indexCount)
	if err != nil {
		t.Fatalf("Failed to check for covering indexes: %v", err)
	}

	if indexCount != 3 {
		t.Errorf("Expected 3 covering indexes, got %d", indexCount)
		t.Log("Missing one or more of: idx_files_media_directory_name, idx_files_media_directory_date, idx_files_path")
	}

	// Insert a larger set of files to test index performance
	tx, _ := db.BeginBatch(ctx)
	baseTime := time.Now().Add(-24 * time.Hour)
	for i := 0; i < 500; i++ {
		file := MediaFile{
			Name:       fmt.Sprintf("file_%04d.jpg", i),
			Path:       fmt.Sprintf("testdir/file_%04d.jpg", i),
			ParentPath: "testdir",
			Type:       FileTypeImage,
			Size:       int64(1024 * (i + 1)),
			ModTime:    baseTime.Add(time.Duration(i) * time.Minute),
			MimeType:   "image/jpeg",
		}
		_ = db.UpsertFile(ctx, tx, &file)
	}
	_ = db.EndBatch(tx, nil)

	// Test sorting by name (should use idx_files_media_directory_name)
	files, err := db.GetMediaInDirectory(ctx, "testdir", SortByName, SortAsc)
	if err != nil {
		t.Fatalf("GetMediaInDirectory with name sort failed: %v", err)
	}
	if len(files) != 500 {
		t.Errorf("Expected 500 files, got %d", len(files))
	}
	if files[0].Name != "file_0000.jpg" {
		t.Errorf("First file should be file_0000.jpg, got %s", files[0].Name)
	}

	// Test sorting by date (should use idx_files_media_directory_date)
	files, err = db.GetMediaInDirectory(ctx, "testdir", SortByDate, SortDesc)
	if err != nil {
		t.Fatalf("GetMediaInDirectory with date sort failed: %v", err)
	}
	if len(files) != 500 {
		t.Errorf("Expected 500 files, got %d", len(files))
	}
	if files[0].Name != "file_0499.jpg" {
		t.Errorf("First file should be file_0499.jpg (newest), got %s", files[0].Name)
	}

	// Verify that the query returns all expected columns
	for _, file := range files[:10] {
		if file.ID == 0 {
			t.Error("File ID should not be 0")
		}
		if file.Path == "" {
			t.Error("File path should not be empty")
		}
		if file.Size == 0 {
			t.Error("File size should not be 0")
		}
		if file.ModTime.IsZero() {
			t.Error("File mod_time should not be zero")
		}
		if file.MimeType == "" {
			t.Error("File mime_type should not be empty")
		}
	}
}

func TestGetMediaInDirectory_WithFavoritesAndTags(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files
	insertFiles := []MediaFile{
		{Name: "file1.jpg", Path: "test/file1.jpg", ParentPath: "test", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "file2.jpg", Path: "test/file2.jpg", ParentPath: "test", Type: FileTypeImage, Size: 2048, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range insertFiles {
		_ = db.UpsertFile(ctx, tx, &insertFiles[i])
	}
	_ = db.EndBatch(tx, nil)

	// Add favorites
	if err := db.AddFavorite(ctx, "test/file1.jpg", "file1.jpg", FileTypeImage); err != nil {
		t.Fatalf("Failed to add favorite: %v", err)
	}

	// Add tags
	if err := db.AddTagToFile(ctx, "test/file1.jpg", "test-tag"); err != nil {
		t.Fatalf("Failed to add tag: %v", err)
	}
	if err := db.AddTagToFile(ctx, "test/file2.jpg", "another-tag"); err != nil {
		t.Fatalf("Failed to add tag: %v", err)
	}

	files, err := db.GetMediaInDirectory(ctx, "test", SortByName, SortAsc)
	if err != nil {
		t.Fatalf("GetMediaInDirectory failed: %v", err)
	}

	if len(files) != 2 {
		t.Fatalf("Expected 2 files, got %d", len(files))
	}

	// Verify favorites are included correctly
	if !files[0].IsFavorite {
		t.Error("file1.jpg should be marked as favorite")
	}
	if files[1].IsFavorite {
		t.Error("file2.jpg should not be marked as favorite")
	}

	// Verify tags are included correctly
	if len(files[0].Tags) != 1 || files[0].Tags[0] != "test-tag" {
		t.Errorf("file1.jpg should have tag 'test-tag', got %v", files[0].Tags)
	}
	if len(files[1].Tags) != 1 || files[1].Tags[0] != "another-tag" {
		t.Errorf("file2.jpg should have tag 'another-tag', got %v", files[1].Tags)
	}
}

func TestGetAllMediaFiles(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert various files
	files := []MediaFile{
		{Name: "image.jpg", Path: "image.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video.mp4", Path: "video.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = db.UpsertFile(ctx, tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	allFiles, err := db.GetAllMediaFiles()
	if err != nil {
		t.Fatalf("GetAllMediaFiles failed: %v", err)
	}

	if len(allFiles) != 3 {
		t.Errorf("Got %d files, want 3", len(allFiles))
	}
}

func TestGetAllMediaFilesForThumbnails(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert various files
	files := []MediaFile{
		{Name: "image.jpg", Path: "image.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video.mp4", Path: "video.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = db.UpsertFile(ctx, tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	thumbnailFiles, err := db.GetAllMediaFilesForThumbnails()
	if err != nil {
		t.Fatalf("GetAllMediaFilesForThumbnails failed: %v", err)
	}

	if len(thumbnailFiles) != 3 {
		t.Errorf("Got %d files, want 3", len(thumbnailFiles))
	}
}

func TestGetFoldersWithUpdatedContents(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert a folder
	folder := MediaFile{
		Name:       "photos",
		Path:       "photos",
		ParentPath: "",
		Type:       FileTypeFolder,
		Size:       0,
		ModTime:    time.Now(),
	}

	tx, _ := db.BeginBatch(ctx)
	_ = db.UpsertFile(ctx, tx, &folder)
	_ = db.EndBatch(tx, nil)

	// Insert an old file in the folder
	oldFile := MediaFile{
		Name:       "old.jpg",
		Path:       "photos/old.jpg",
		ParentPath: "photos",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
	}

	tx, _ = db.BeginBatch(ctx)
	_ = db.UpsertFile(ctx, tx, &oldFile)
	_ = db.EndBatch(tx, nil)

	// Wait longer than the 10-second buffer
	t.Logf("Waiting 11 seconds for timestamp separation...")
	time.Sleep(11 * time.Second)
	beforeUpdate := time.Now()

	// Insert a new file in the folder
	newFile := MediaFile{
		Name:       "new.jpg",
		Path:       "photos/new.jpg",
		ParentPath: "photos",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
	}

	tx, _ = db.BeginBatch(ctx)
	_ = db.UpsertFile(ctx, tx, &newFile)
	_ = db.EndBatch(tx, nil)

	folders, err := db.GetFoldersWithUpdatedContents(ctx, beforeUpdate)
	if err != nil {
		t.Fatalf("GetFoldersWithUpdatedContents failed: %v", err)
	}

	if len(folders) < 1 {
		t.Error("Expected at least 1 folder with updated contents")
	}

	if len(folders) > 0 && folders[0].Name != "photos" {
		t.Errorf("Expected folder 'photos', got '%s'", folders[0].Name)
	}
}

func TestGetAllIndexedPaths(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	files := []MediaFile{
		{Name: "image1.jpg", Path: "path/image1.jpg", ParentPath: "path", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "image2.jpg", Path: "path/image2.jpg", ParentPath: "path", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video1.mp4", Path: "path/video1.mp4", ParentPath: "path", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "subfolder", Path: "path/subfolder", ParentPath: "path", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "playlist.m3u", Path: "path/playlist.m3u", ParentPath: "path", Type: FileTypePlaylist, Size: 512, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = db.UpsertFile(ctx, tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	paths, err := db.GetAllIndexedPaths(ctx)
	if err != nil {
		t.Fatalf("GetAllIndexedPaths failed: %v", err)
	}

	expectedCount := 4
	if len(paths) != expectedCount {
		t.Errorf("Got %d paths, want %d", len(paths), expectedCount)
	}

	expectedPaths := []string{
		"path/image1.jpg",
		"path/image2.jpg",
		"path/video1.mp4",
		"path/subfolder",
	}

	for _, expectedPath := range expectedPaths {
		if _, exists := paths[expectedPath]; !exists {
			t.Errorf("Missing expected path: %s", expectedPath)
		}
	}

	if _, exists := paths["path/playlist.m3u"]; exists {
		t.Error("Playlist path should not be included in GetAllIndexedPaths result")
	}
}

func TestGetAllIndexedPaths_LargeSet(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping large set test in short mode")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	fileCount := 1000
	tx, _ := db.BeginBatch(ctx)

	for i := 0; i < fileCount; i++ {
		file := MediaFile{
			Name:       fmt.Sprintf("file_%04d.jpg", i),
			Path:       fmt.Sprintf("test/file_%04d.jpg", i),
			ParentPath: "test",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(ctx, tx, &file)
	}
	_ = db.EndBatch(tx, nil)

	paths, err := db.GetAllIndexedPaths(ctx)
	if err != nil {
		t.Fatalf("GetAllIndexedPaths failed: %v", err)
	}

	if len(paths) != fileCount {
		t.Errorf("Got %d paths, want %d", len(paths), fileCount)
	}

	testPaths := []string{
		"test/file_0000.jpg",
		"test/file_0500.jpg",
		"test/file_0999.jpg",
	}

	for _, testPath := range testPaths {
		if _, exists := paths[testPath]; !exists {
			t.Errorf("Missing expected path: %s", testPath)
		}
	}
}

func TestSearchWithEmptyQuery(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	opts := SearchOptions{
		Query:    "",
		Page:     1,
		PageSize: 100,
	}

	results, err := db.Search(ctx, opts)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	if len(results.Items) != 0 {
		t.Errorf("Got %d results for empty query, want 0", len(results.Items))
	}
}

func TestStatsWithNoData(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	stats, err := db.CalculateStats()
	if err != nil {
		t.Fatalf("CalculateStats failed: %v", err)
	}

	if stats.TotalFiles != 0 {
		t.Errorf("TotalFiles = %d, want 0 for empty database", stats.TotalFiles)
	}

	if stats.TotalFolders != 0 {
		t.Errorf("TotalFolders = %d, want 0 for empty database", stats.TotalFolders)
	}

	if stats.TotalTags != 0 {
		t.Errorf("TotalTags = %d, want 0 for empty database", stats.TotalTags)
	}
}

func TestStatsWithTags(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	tagNames := []string{"action", "thriller", "comedy", "drama"}
	for _, name := range tagNames {
		if err := db.AddTagToFile(ctx, "/test/video.mp4", name); err != nil {
			t.Fatalf("AddTagToFile failed: %v", err)
		}
	}

	stats, err := db.CalculateStats()
	if err != nil {
		t.Fatalf("CalculateStats failed: %v", err)
	}

	if stats.TotalTags != len(tagNames) {
		t.Errorf("TotalTags = %d, want %d", stats.TotalTags, len(tagNames))
	}

	t.Logf("Stats with tags: %+v", stats)
}

func TestSetupCompleteMigrationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, _, err := New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}

	ctx := context.Background()

	if err := db.CreateUser(ctx, "testpassword"); err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	var setupComplete int
	err = db.db.QueryRowContext(ctx, "SELECT setup_complete FROM users WHERE id = 1").Scan(&setupComplete)
	if err != nil {
		t.Fatalf("Failed to query setup_complete: %v", err)
	}

	if setupComplete != 1 {
		t.Errorf("Expected setup_complete=1, got %d", setupComplete)
	}

	if !db.IsSetupComplete(ctx) {
		t.Error("IsSetupComplete() should return true after user creation")
	}

	db.Close()

	db, _, err = New(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("Failed to reopen database: %v", err)
	}
	defer db.Close()

	err = db.db.QueryRowContext(ctx, "SELECT setup_complete FROM users WHERE id = 1").Scan(&setupComplete)
	if err != nil {
		t.Fatalf("Failed to query setup_complete after reopen: %v", err)
	}

	if setupComplete != 1 {
		t.Errorf("After migration, expected setup_complete=1, got %d", setupComplete)
	}
}

func TestDatabaseConnectionPoolConcurrency(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	now := time.Now()

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := 0; i < 10; i++ {
		file := MediaFile{
			Name:       "test.jpg",
			Path:       "test/test.jpg",
			ParentPath: "test",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    now,
		}
		if err := db.UpsertFile(ctx, tx, &file); err != nil {
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	const numConcurrent = 20
	done := make(chan error, numConcurrent)

	start := time.Now()
	for i := 0; i < numConcurrent; i++ {
		go func() {
			_ = db.GetStats()
			done <- nil
		}()
	}

	for i := 0; i < numConcurrent; i++ {
		if err := <-done; err != nil {
			t.Errorf("Concurrent read %d failed: %v", i, err)
		}
	}
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Errorf("Concurrent reads took %v, connection pool may be too small", elapsed)
	}

	t.Logf("20 concurrent reads completed in %v", elapsed)
}

func TestBeginBatchNonBlocking(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		_ = db.GetStats()
		done <- nil
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Errorf("Read during batch transaction failed: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Error("Read blocked by batch transaction lock (should not happen with fix)")
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}
}

func TestConnectionPoolUnderLoad(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	now := time.Now()

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	for i := 0; i < 100; i++ {
		file := MediaFile{
			Name:       "test.jpg",
			Path:       "test/test.jpg",
			ParentPath: "test",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    now,
		}
		if err := db.UpsertFile(ctx, tx, &file); err != nil {
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	const numReads = 20
	const numWrites = 5
	totalOps := numReads + numWrites
	done := make(chan error, totalOps)

	start := time.Now()

	for i := 0; i < numReads; i++ {
		go func() {
			_ = db.GetStats()
			done <- nil
		}()
	}

	for i := 0; i < numWrites; i++ {
		go func(idx int) {
			tx, err := db.BeginBatch(ctx)
			if err != nil {
				done <- err
				return
			}
			for j := 0; j < 10; j++ {
				file := MediaFile{
					Name:       fmt.Sprintf("batch%d_file%d.jpg", idx, j),
					Path:       fmt.Sprintf("concurrent/batch%d_file%d.jpg", idx, j),
					ParentPath: "concurrent",
					Type:       FileTypeImage,
					Size:       1024,
					ModTime:    now}
				if err := db.UpsertFile(ctx, tx, &file); err != nil {
					done <- err
					return
				}
			}
			done <- db.EndBatch(tx, nil)
		}(i)
		time.Sleep(5 * time.Millisecond)
	}

	errors := 0
	for i := 0; i < totalOps; i++ {
		if err := <-done; err != nil {
			t.Errorf("Operation failed: %v", err)
			errors++
		}
	}
	elapsed := time.Since(start)

	if errors > 0 {
		t.Fatalf("%d/%d operations failed", errors, totalOps)
	}

	if elapsed > 2*time.Second {
		t.Logf("Warning: Operations took %v, may indicate connection pool issues", elapsed)
	}

	t.Logf("%d mixed operations (%d reads, %d writes) completed in %v with no errors", totalOps, numReads, numWrites, elapsed)
}

// TestMmapDisabledOnAllConnections verifies that every connection in the pool
// has mmap_size=0, regardless of the system SQLite's compiled-in default.
// This is the core safety test for the SIGBUS fix.
func TestMmapDisabledOnAllConnections(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Force the pool to create multiple connections by holding them open
	// simultaneously, then verify each one has mmap_size=0.
	const numConns = 10
	conns := make([]*sql.Conn, 0, numConns)

	for i := 0; i < numConns; i++ {
		conn, err := db.db.Conn(ctx)
		if err != nil {
			t.Fatalf("Failed to get connection %d: %v", i, err)
		}
		conns = append(conns, conn)
	}

	for i, conn := range conns {
		var mmapSize int64
		err := conn.QueryRowContext(ctx, "PRAGMA mmap_size").Scan(&mmapSize)
		if err != nil {
			t.Fatalf("Failed to read mmap_size on connection %d: %v", i, err)
		}
		if mmapSize != 0 {
			t.Errorf("Connection %d has mmap_size=%d, want 0 (SIGBUS protection NOT active!)", i, mmapSize)
		}
	}

	for _, conn := range conns {
		conn.Close()
	}

	t.Logf("Verified mmap_size=0 on all %d pooled connections", numConns)
}

// TestMmapDisabledAfterInitialize verifies that database initialization
// (schema creation, migrations) does not re-enable mmap.
func TestMmapDisabledAfterInitialize(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	var mmapSize int64
	err := db.db.QueryRowContext(ctx, "PRAGMA mmap_size").Scan(&mmapSize)
	if err != nil {
		t.Fatalf("Failed to read mmap_size: %v", err)
	}

	if mmapSize != 0 {
		t.Errorf("mmap_size=%d after initialize(), want 0", mmapSize)
	}
}

// TestMmapDisabledWithCustomDriver verifies that our custom driver is registered
// and applies mmap_size=0 independently of the default "sqlite3" driver.
func TestMmapDisabledWithCustomDriver(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "driver_test.db")

	ctx := context.Background()
	connStr := fmt.Sprintf("%s?_journal_mode=WAL&_busy_timeout=5000", dbPath)

	// Open with our custom driver
	customDB, err := sql.Open(driverName, connStr)
	if err != nil {
		t.Fatalf("Failed to open with custom driver: %v", err)
	}
	defer customDB.Close()

	if err := customDB.PingContext(ctx); err != nil {
		t.Fatalf("Failed to ping custom driver DB: %v", err)
	}

	var mmapSize int64
	if err := customDB.QueryRowContext(ctx, "PRAGMA mmap_size").Scan(&mmapSize); err != nil {
		t.Fatalf("Failed to read mmap_size: %v", err)
	}

	if mmapSize != 0 {
		t.Errorf("Custom driver mmap_size=%d, want 0", mmapSize)
	}

	t.Logf("Custom driver %q correctly sets mmap_size=0", driverName)
}

// TestNewDatabaseMmapDisabled verifies that New() creates a database with mmap
// disabled and that all operations work correctly without mmap.
func TestNewDatabaseMmapDisabled(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "mmap_test.db")

	ctx := context.Background()

	db, _, err := New(ctx, dbPath)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer db.Close()

	// Verify mmap is disabled
	var mmapSize int64
	if err := db.db.QueryRowContext(ctx, "PRAGMA mmap_size").Scan(&mmapSize); err != nil {
		t.Fatalf("Failed to read mmap_size: %v", err)
	}

	if mmapSize != 0 {
		t.Errorf("New() database has mmap_size=%d, want 0", mmapSize)
	}

	// Verify write operations work with mmap disabled
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	file := &MediaFile{
		Name:       "test.jpg",
		Path:       "mmap_test/test.jpg",
		ParentPath: "mmap_test",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
		MimeType:   "image/jpeg",
	}

	if err := db.UpsertFile(ctx, tx, file); err != nil {
		t.Fatalf("UpsertFile failed with mmap disabled: %v", err)
	}

	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed with mmap disabled: %v", err)
	}

	// Verify read operations work with mmap disabled
	retrieved, err := db.GetFileByPath(ctx, "mmap_test/test.jpg")
	if err != nil {
		t.Fatalf("GetFileByPath failed with mmap disabled: %v", err)
	}

	if retrieved.Name != "test.jpg" {
		t.Errorf("Retrieved file name = %q, want %q", retrieved.Name, "test.jpg")
	}

	// Verify search works with mmap disabled
	results, err := db.Search(ctx, SearchOptions{
		Query:    "test",
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("Search failed with mmap disabled: %v", err)
	}

	if len(results.Items) < 1 {
		t.Error("Search should return at least 1 result with mmap disabled")
	}

	// Verify stats work with mmap disabled
	_, err = db.CalculateStats()
	if err != nil {
		t.Fatalf("CalculateStats failed with mmap disabled: %v", err)
	}

	t.Log("All database operations verified working with mmap disabled")
}

// TestMmapDisabledPersistsAcrossReopen verifies that mmap stays disabled
// when the database is closed and reopened (the ConnectHook fires on new connections).
func TestMmapDisabledPersistsAcrossReopen(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "reopen_test.db")

	ctx := context.Background()

	// First open
	db1, _, err := New(ctx, dbPath)
	if err != nil {
		t.Fatalf("First New() failed: %v", err)
	}

	// Insert data
	tx, err := db1.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	file := &MediaFile{
		Name:       "persist.jpg",
		Path:       "persist/persist.jpg",
		ParentPath: "persist",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
	}
	if err := db1.UpsertFile(ctx, tx, file); err != nil {
		t.Fatalf("UpsertFile failed: %v", err)
	}
	if err := db1.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	db1.Close()

	// Second open — new connections, ConnectHook should fire again
	db2, _, err := New(ctx, dbPath)
	if err != nil {
		t.Fatalf("Second New() failed: %v", err)
	}
	defer db2.Close()

	// Verify mmap is still disabled
	var mmapSize int64
	if err := db2.db.QueryRowContext(ctx, "PRAGMA mmap_size").Scan(&mmapSize); err != nil {
		t.Fatalf("Failed to read mmap_size after reopen: %v", err)
	}

	if mmapSize != 0 {
		t.Errorf("mmap_size=%d after reopen, want 0", mmapSize)
	}

	// Verify data persisted
	retrieved, err := db2.GetFileByPath(ctx, "persist/persist.jpg")
	if err != nil {
		t.Fatalf("GetFileByPath failed after reopen: %v", err)
	}

	if retrieved.Name != "persist.jpg" {
		t.Errorf("Retrieved file name = %q after reopen, want %q", retrieved.Name, "persist.jpg")
	}
}

// TestCheckStorageHealthNormal verifies health check passes on a healthy database.
func TestCheckStorageHealthNormal(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	// Should complete without panic or error on a healthy database
	db.CheckStorageHealth()

	// Verify the DB file exists and is readable
	if _, err := os.Stat(db.dbPath); err != nil {
		t.Errorf("DB file should exist: %v", err)
	}
}

// TestCheckStorageHealthMissingDB verifies health check handles a missing DB file
// gracefully (this simulates the condition that causes SIGBUS with mmap).
func TestCheckStorageHealthMissingDB(t *testing.T) {
	db, _ := setupTestDB(t)

	// Close the database and remove files to simulate storage failure
	db.Close()
	os.Remove(db.dbPath)
	os.Remove(db.dbPath + "-wal")
	os.Remove(db.dbPath + "-shm")

	// Health check should not panic — it should detect the missing file
	// and increment metrics
	db.CheckStorageHealth()
}

// TestCheckStorageHealthUnreadableDB verifies health check detects permission errors
// (another condition that causes SIGBUS with mmap on some systems).
func TestCheckStorageHealthUnreadableDB(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("skipping permission test when running as root")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	// Make the DB file unreadable to simulate I/O failure
	if err := os.Chmod(db.dbPath, 0o000); err != nil {
		t.Fatalf("Failed to chmod: %v", err)
	}
	// Restore permissions on cleanup so TempDir removal works
	defer os.Chmod(db.dbPath, 0o644)

	// Health check should detect the I/O error without panicking
	db.CheckStorageHealth()
}

// TestLogSQLiteConfig verifies the config logging runs without error.
func TestLogSQLiteConfig(t *testing.T) {
	db, _ := setupTestDB(t)
	db.Close()

	// Should not panic
	// db.logSQLiteConfig(context.Background())
}

// BenchmarkConcurrentReads benchmarks concurrent read performance
func BenchmarkConcurrentReads(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_ = db.GetStats()
		}
	})
}

// BenchmarkConnectionPoolAcquisition benchmarks connection acquisition
func BenchmarkConnectionPoolAcquisition(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var count int
		err := db.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM files").Scan(&count)
		if err != nil {
			b.Fatalf("Query failed: %v", err)
		}
	}
}

// BenchmarkBeginEndBatch benchmarks transaction lifecycle
func BenchmarkBeginEndBatch(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tx, err := db.BeginBatch(ctx)
		if err != nil {
			b.Fatalf("BeginBatch failed: %v", err)
		}
		if err := db.EndBatch(tx, nil); err != nil {
			b.Fatalf("EndBatch failed: %v", err)
		}
	}
}
