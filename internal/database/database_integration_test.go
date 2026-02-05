package database

import (
	"context"
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

	db, err := New(context.Background(), dbPath)
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

	db, err := New(context.Background(), dbPath)
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
	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	err = db.UpsertFile(tx, &file)
	if err != nil {
		t.Fatalf("UpsertFile failed on insert: %v", err)
	}

	err = db.EndBatch(tx, nil)
	if err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Update existing file
	file.Size = 2048
	tx, err = db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	err = db.UpsertFile(tx, &file)
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

	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := db.UpsertFile(tx, &files[i]); err != nil {
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
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert test files
	files := []MediaFile{
		{Name: "sunset.jpg", Path: "photos/sunset.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "sunrise.jpg", Path: "photos/sunrise.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "beach.mp4", Path: "videos/beach.mp4", ParentPath: "videos", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := db.UpsertFile(tx, &files[i]); err != nil {
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

	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	err = db.UpsertFile(tx, &file)
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

	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	if err := db.UpsertFile(tx, &oldFile); err != nil {
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

	tx, err = db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	if err := db.UpsertFile(tx, &newFile); err != nil {
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

	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range folders {
		if err := db.UpsertFile(tx, &folders[i]); err != nil {
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
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create files in folder
	files := []MediaFile{
		{Name: "image1.jpg", Path: "folder/image1.jpg", ParentPath: "folder", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "image2.jpg", Path: "folder/image2.jpg", ParentPath: "folder", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video1.mp4", Path: "folder/video1.mp4", ParentPath: "folder", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := db.UpsertFile(tx, &files[i]); err != nil {
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
	db, _ := setupTestDB(t)
	defer db.Close()

	// Insert some files
	files := []MediaFile{
		{Name: "image.jpg", Path: "image.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video.mp4", Path: "video.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	tx, err := db.BeginBatch()
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := db.UpsertFile(tx, &files[i]); err != nil {
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

func TestDatabaseConcurrency(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	const numGoroutines = 10
	done := make(chan error, numGoroutines)

	// Concurrent inserts
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			file := MediaFile{
				Name:       filepath.Base(filepath.Join("concurrent", string(rune('a'+id))+".jpg")),
				Path:       filepath.Join("concurrent", string(rune('a'+id))+".jpg"),
				ParentPath: "concurrent",
				Type:       FileTypeImage,
				Size:       int64(id * 1024),
				ModTime:    time.Now(),
			}

			tx, err := db.BeginBatch()
			if err != nil {
				done <- err
				return
			}

			if err := db.UpsertFile(tx, &file); err != nil {
				done <- err
				return
			}

			done <- db.EndBatch(tx, nil)
		}(i)
	}

	// Collect results
	for i := 0; i < numGoroutines; i++ {
		if err := <-done; err != nil {
			t.Errorf("Concurrent insert %d failed: %v", i, err)
		}
	}

	// Verify all files were inserted
	opts := ListOptions{
		Path:     "concurrent",
		Page:     1,
		PageSize: 100,
	}

	listing, err := db.ListDirectory(ctx, opts)
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}

	if len(listing.Items) != numGoroutines {
		t.Errorf("Got %d files, want %d", len(listing.Items), numGoroutines)
	}
}

func BenchmarkUpsertFile(b *testing.B) {
	db, _ := setupTestDB(&testing.T{})
	defer db.Close()

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

		tx, _ := db.BeginBatch()
		_ = db.UpsertFile(tx, &file)
		_ = db.EndBatch(tx, nil)
	}
}

func BenchmarkListDirectory(b *testing.B) {
	db, _ := setupTestDB(&testing.T{})
	defer db.Close()

	ctx := context.Background()

	// Insert some files
	tx, _ := db.BeginBatch()
	for i := 0; i < 100; i++ {
		file := MediaFile{
			Name:       filepath.Base(filepath.Join("bench", string(rune('a'+i%26))+".jpg")),
			Path:       filepath.Join("bench", string(rune('a'+i%26))+".jpg"),
			ParentPath: "bench",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(tx, &file)
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

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
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
	tx, _ := db.BeginBatch()
	for i := 0; i < 25; i++ {
		file := MediaFile{
			Name:       filepath.Base(filepath.Join("page", "file"+string(rune('a'+i%26))+".jpg")),
			Path:       filepath.Join("page", "file"+string(rune('a'+i%26))+".jpg"),
			ParentPath: "page",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(tx, &file)
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

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
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

	tx, _ := db.BeginBatch()
	_ = db.UpsertFile(tx, &playlist)
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

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
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

func TestGetAllMediaFiles(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	// Insert various files
	files := []MediaFile{
		{Name: "image.jpg", Path: "image.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video.mp4", Path: "video.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	allFiles, err := db.GetAllMediaFiles()
	if err != nil {
		t.Fatalf("GetAllMediaFiles failed: %v", err)
	}

	// Should include all media files (images, videos, folders)
	if len(allFiles) != 3 {
		t.Errorf("Got %d files, want 3", len(allFiles))
	}
}

func TestGetAllMediaFilesForThumbnails(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	// Insert various files
	files := []MediaFile{
		{Name: "image.jpg", Path: "image.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video.mp4", Path: "video.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	thumbnailFiles, err := db.GetAllMediaFilesForThumbnails()
	if err != nil {
		t.Fatalf("GetAllMediaFilesForThumbnails failed: %v", err)
	}

	// Should include images, videos, and folders
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

	tx, _ := db.BeginBatch()
	_ = db.UpsertFile(tx, &folder)
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

	tx, _ = db.BeginBatch()
	_ = db.UpsertFile(tx, &oldFile)
	_ = db.EndBatch(tx, nil)

	// Wait longer than the 10-second buffer
	t.Logf("Waiting 11 seconds for timestamp separation...")
	time.Sleep(11 * time.Second)
	beforeUpdate := time.Now()

	// Insert a new file in the folder (this updates the folder's contents)
	newFile := MediaFile{
		Name:       "new.jpg",
		Path:       "photos/new.jpg",
		ParentPath: "photos",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
	}

	tx, _ = db.BeginBatch()
	_ = db.UpsertFile(tx, &newFile)
	_ = db.EndBatch(tx, nil)

	// Query for folders with updated contents
	folders, err := db.GetFoldersWithUpdatedContents(ctx, beforeUpdate)
	if err != nil {
		t.Fatalf("GetFoldersWithUpdatedContents failed: %v", err)
	}

	// Should find the photos folder (because new.jpg was added after 'beforeUpdate')
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

	// Insert files
	files := []MediaFile{
		{Name: "image1.jpg", Path: "path/image1.jpg", ParentPath: "path", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "image2.jpg", Path: "path/image2.jpg", ParentPath: "path", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch()
	for i := range files {
		_ = db.UpsertFile(tx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	paths, err := db.GetAllIndexedPaths(ctx)
	if err != nil {
		t.Fatalf("GetAllIndexedPaths failed: %v", err)
	}

	if len(paths) != 2 {
		t.Errorf("Got %d paths, want 2", len(paths))
	}

	if !paths["path/image1.jpg"] || !paths["path/image2.jpg"] {
		t.Error("Missing expected paths in result")
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

	// Empty query should return no results
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
}
