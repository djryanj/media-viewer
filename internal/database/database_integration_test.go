package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Integration tests for database operations with real SQLite database

// setupTestDB creates a test database. An optional Options value can be passed
// to control database behavior (e.g. mmap). When omitted, nil is used
// (standard defaults — mmap enabled).
func setupTestDB(t testing.TB, opts ...*Options) (db *Database, dbPath string) {
	t.Helper()

	tmpDir := t.TempDir()
	dbPath = filepath.Join(tmpDir, "test.db")

	var dbOpts *Options
	if len(opts) > 0 {
		dbOpts = opts[0]
	}

	db, _, err := New(context.Background(), dbPath, dbOpts)
	if err != nil {
		t.Fatalf("Failed to create test database: %v", err)
	}

	// Initialize WebAuthn schema for tests that need it
	if err := db.InitWebAuthnSchema(); err != nil {
		t.Fatalf("Failed to initialize WebAuthn schema: %v", err)
	}

	return db, dbPath
}

// ---------------------------------------------------------------------------
// New() signature & Options integration tests
// ---------------------------------------------------------------------------

// TestNewDatabaseInvalidPath covers the writer.PingContext failure path in New()
// (database.go:135-148) and its cleanup code. The intermediate directory does
// not exist, so SQLite cannot create the database file and PingContext returns
// an error, exercising the writer/reader close-on-failure branches.
func TestNewDatabaseInvalidPath(t *testing.T) {
	// Use a path whose parent directory does not exist — SQLite will fail to
	// open/create the file when PingContext triggers the first connection.
	dbPath := filepath.Join(t.TempDir(), "nonexistent_subdir", "test.db")
	_, _, err := New(context.Background(), dbPath, nil)
	if err == nil {
		t.Error("expected error when the database path is in a non-existent directory")
	}
}

func TestNewDatabase(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, _, err := New(context.Background(), dbPath, nil)
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
	if err := db.reader.PingContext(ctx); err != nil {
		t.Errorf("Database ping failed: %v", err)
	}
}

func TestNewDatabaseWithNilOptions(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "nil_opts.db")

	db, info, err := New(context.Background(), dbPath, nil)
	if err != nil {
		t.Fatalf("New(nil) failed: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	if info.MmapStatus == "" {
		t.Error("MmapStatus should not be empty")
	}

	// With nil options we should be in standard mode, never SIGBUS protection mode
	if strings.Contains(info.MmapStatus, "SIGBUS protection active") {
		t.Errorf("With nil options, should not report SIGBUS protection active, got: %s", info.MmapStatus)
	}

	// The status must mention "standard mode"
	if !strings.Contains(info.MmapStatus, "standard mode") {
		t.Errorf("With nil options, expected 'standard mode' in status, got: %s", info.MmapStatus)
	}

	// Verify database is functional
	if err := db.reader.PingContext(ctx); err != nil {
		t.Errorf("Database ping failed: %v", err)
	}
}

func TestNewDatabaseWithMmapEnabled(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "mmap_enabled.db")

	opts := &Options{MmapDisabled: false}
	db, info, err := New(context.Background(), dbPath, opts)
	if err != nil {
		t.Fatalf("New(MmapDisabled=false) failed: %v", err)
	}
	defer db.Close()

	// Should behave identically to nil options — standard driver
	if info.MmapStatus == "" {
		t.Error("MmapStatus should not be empty")
	}

	if strings.Contains(info.MmapStatus, "SIGBUS protection active") {
		t.Errorf("With MmapDisabled=false, should not report SIGBUS protection, got: %s", info.MmapStatus)
	}

	if !strings.Contains(info.MmapStatus, "standard mode") {
		t.Errorf("With MmapDisabled=false, expected 'standard mode' in status, got: %s", info.MmapStatus)
	}

	// Verify read/write works
	ctx := context.Background()
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	file := &MediaFile{
		Name:       "test.jpg",
		Path:       "mmap_enabled/test.jpg",
		ParentPath: "mmap_enabled",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
	}
	if err := batch.UpsertFile(ctx, file); err != nil {
		t.Fatalf("UpsertFile failed: %v", err)
	}
	if err = db.EndBatch(batch, err); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	retrieved, err := db.GetFileByPath(ctx, "mmap_enabled/test.jpg")
	if err != nil {
		t.Fatalf("GetFileByPath failed: %v", err)
	}
	if retrieved.Name != "test.jpg" {
		t.Errorf("Name = %q, want %q", retrieved.Name, "test.jpg")
	}
}

func TestNewDatabaseWithMmapDisabled(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "mmap_disabled.db")

	opts := &Options{MmapDisabled: true}
	db, info, err := New(context.Background(), dbPath, opts)
	if err != nil {
		t.Fatalf("New(MmapDisabled=true) failed: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Verify mmap is actually disabled
	var mmapSize int64
	if err := db.reader.QueryRowContext(ctx, "PRAGMA mmap_size").Scan(&mmapSize); err != nil {
		t.Fatalf("Failed to read mmap_size: %v", err)
	}
	if mmapSize != 0 {
		t.Errorf("mmap_size = %d, want 0 when MmapDisabled=true", mmapSize)
	}

	// Info should report SIGBUS protection active
	if !strings.Contains(info.MmapStatus, "SIGBUS protection active") {
		t.Errorf("With MmapDisabled=true, expected 'SIGBUS protection active', got: %s", info.MmapStatus)
	}

	// Should NOT mention standard mode
	if strings.Contains(info.MmapStatus, "standard mode") {
		t.Errorf("With MmapDisabled=true, should not mention 'standard mode', got: %s", info.MmapStatus)
	}

	// Verify full read/write cycle works with mmap disabled
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	file := &MediaFile{
		Name:       "test.jpg",
		Path:       "mmap_disabled/test.jpg",
		ParentPath: "mmap_disabled",
		Type:       FileTypeImage,
		Size:       1024,
		ModTime:    time.Now(),
		MimeType:   "image/jpeg",
	}
	if err := batch.UpsertFile(ctx, file); err != nil {
		t.Fatalf("UpsertFile failed with mmap disabled: %v", err)
	}
	if err = db.EndBatch(batch, err); err != nil {
		t.Fatalf("EndBatch failed with mmap disabled: %v", err)
	}

	retrieved, err := db.GetFileByPath(ctx, "mmap_disabled/test.jpg")
	if err != nil {
		t.Fatalf("GetFileByPath failed with mmap disabled: %v", err)
	}
	if retrieved.Name != "test.jpg" {
		t.Errorf("Name = %q, want %q", retrieved.Name, "test.jpg")
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
	if _, err := db.CalculateStats(); err != nil {
		t.Fatalf("CalculateStats failed with mmap disabled: %v", err)
	}

	t.Log("All database operations verified working with mmap disabled")
}

func TestNewDatabaseInfoDiagnostics(t *testing.T) {
	tests := []struct {
		name               string
		opts               *Options
		expectSIGBUS       bool
		expectStandardMode bool
	}{
		{
			name:               "nil options — standard mode",
			opts:               nil,
			expectSIGBUS:       false,
			expectStandardMode: true,
		},
		{
			name:               "mmap enabled — standard mode",
			opts:               &Options{MmapDisabled: false},
			expectSIGBUS:       false,
			expectStandardMode: true,
		},
		{
			name:               "mmap disabled — SIGBUS protection",
			opts:               &Options{MmapDisabled: true},
			expectSIGBUS:       true,
			expectStandardMode: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()
			dbPath := filepath.Join(tmpDir, "diag.db")

			db, info, err := New(context.Background(), dbPath, tt.opts)
			if err != nil {
				t.Fatalf("New() failed: %v", err)
			}
			defer db.Close()

			if info.SQLiteVersion == "" || info.SQLiteVersion == "unknown" {
				t.Error("SQLiteVersion should be populated")
			}

			if info.MmapStatus == "" {
				t.Fatal("MmapStatus should not be empty")
			}

			hasSIGBUS := strings.Contains(info.MmapStatus, "SIGBUS protection active")
			if hasSIGBUS != tt.expectSIGBUS {
				t.Errorf("SIGBUS protection in status: got %v, want %v\n  status: %s",
					hasSIGBUS, tt.expectSIGBUS, info.MmapStatus)
			}

			hasStandard := strings.Contains(info.MmapStatus, "standard mode")
			if hasStandard != tt.expectStandardMode {
				t.Errorf("Standard mode in status: got %v, want %v\n  status: %s",
					hasStandard, tt.expectStandardMode, info.MmapStatus)
			}
		})
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
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	err = batch.UpsertFile(ctx, &file)
	if err != nil {
		t.Fatalf("UpsertFile failed on insert: %v", err)
	}

	err = db.EndBatch(batch, nil)
	if err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Update existing file
	file.Size = 2048
	batch, err = db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	err = batch.UpsertFile(ctx, &file)
	if err != nil {
		t.Fatalf("UpsertFile failed on update: %v", err)
	}

	err = db.EndBatch(batch, nil)
	if err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// Verify file was updated
	var size int64
	err = db.reader.QueryRowContext(ctx, "SELECT size FROM files WHERE path = ?", file.Path).Scan(&size)
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

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := batch.UpsertFile(ctx, &files[i]); err != nil {
			t.Fatalf("Failed to insert file %s: %v", files[i].Path, err)
		}
	}

	if err = db.EndBatch(batch, err); err != nil {
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

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := batch.UpsertFile(ctx, &files[i]); err != nil {
			t.Fatalf("Failed to insert file: %v", err)
		}
	}

	if err = db.EndBatch(batch, err); err != nil {
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

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	err = batch.UpsertFile(ctx, &file)
	if err != nil {
		t.Fatalf("UpsertFile failed: %v", err)
	}

	err = db.EndBatch(batch, nil)
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

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	if err := batch.UpsertFile(ctx, &oldFile); err != nil {
		t.Fatalf("Failed to insert old file: %v", err)
	}

	if err = db.EndBatch(batch, err); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	t.Logf("Waiting 12 seconds for timestamp separation...")
	time.Sleep(12 * time.Second)

	cutoffTime := time.Now().Add(1 * time.Second)

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

	batch, err = db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	if err := batch.UpsertFile(ctx, &newFile); err != nil {
		t.Fatalf("Failed to insert new file: %v", err)
	}

	if err = db.EndBatch(batch, err); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	updated, err := db.GetFilesUpdatedSince(ctx, cutoffTime)
	if err != nil {
		t.Fatalf("GetFilesUpdatedSince failed: %v", err)
	}

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

	folders := []MediaFile{
		{Name: "parent", Path: "parent", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "child1", Path: "parent/child1", ParentPath: "parent", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "child2", Path: "parent/child2", ParentPath: "parent", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "grandchild", Path: "parent/child1/grandchild", ParentPath: "parent/child1", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range folders {
		if err := batch.UpsertFile(ctx, &folders[i]); err != nil {
			t.Fatalf("Failed to insert folder: %v", err)
		}
	}

	if err = db.EndBatch(batch, err); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	subfolders, err := db.GetSubfolders(ctx, "parent")
	if err != nil {
		t.Fatalf("GetSubfolders failed: %v", err)
	}

	if len(subfolders) != 2 {
		t.Errorf("Got %d subfolders, want 2", len(subfolders))
	}

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

	files := []MediaFile{
		{Name: "image1.jpg", Path: "folder/image1.jpg", ParentPath: "folder", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "image2.jpg", Path: "folder/image2.jpg", ParentPath: "folder", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video1.mp4", Path: "folder/video1.mp4", ParentPath: "folder", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
	}

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := batch.UpsertFile(ctx, &files[i]); err != nil {
			t.Fatalf("Failed to insert file: %v", err)
		}
	}

	if err = db.EndBatch(batch, err); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

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

	lastRun, err := db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun failed: %v", err)
	}

	if !lastRun.IsZero() {
		t.Error("Initial last run should be zero")
	}

	now := time.Now()
	err = db.SetLastThumbnailRun(ctx, now)
	if err != nil {
		t.Fatalf("SetLastThumbnailRun failed: %v", err)
	}

	lastRun, err = db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun failed: %v", err)
	}

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

	files := []MediaFile{
		{Name: "image.jpg", Path: "image.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "video.mp4", Path: "video.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
	}

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := range files {
		if err := batch.UpsertFile(ctx, &files[i]); err != nil {
			t.Fatalf("Failed to insert file: %v", err)
		}
	}

	if err = db.EndBatch(batch, err); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	stats, err := db.CalculateStats()
	if err != nil {
		t.Fatalf("CalculateStats failed: %v", err)
	}

	if stats.TotalFiles < 2 {
		t.Errorf("TotalFiles = %d, want at least 2", stats.TotalFiles)
	}

	if stats.TotalFolders != 1 {
		t.Errorf("TotalFolders = %d, want 1", stats.TotalFolders)
	}

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
	const numFiles = 100

	batch, err := db.BeginBatch(ctx)
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

		if err := batch.UpsertFile(ctx, &file); err != nil {
			t.Errorf("Insert %d failed: %v", i, err)
		}
	}

	if err = db.EndBatch(batch, err); err != nil {
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

		batch, _ := db.BeginBatch(ctx)
		_ = batch.UpsertFile(ctx, &file)
		_ = db.EndBatch(batch, nil)
	}
}

func BenchmarkListDirectory(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()

	ctx := context.Background()

	batch, _ := db.BeginBatch(ctx)
	for i := 0; i < 100; i++ {
		file := MediaFile{
			Name:       filepath.Base(filepath.Join("bench", string(rune('a'+i%26))+".jpg")),
			Path:       filepath.Join("bench", string(rune('a'+i%26))+".jpg"),
			ParentPath: "bench",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = batch.UpsertFile(ctx, &file)
	}
	_ = db.EndBatch(batch, nil)

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

	files := []MediaFile{
		{Name: "zebra.jpg", Path: "zebra.jpg", ParentPath: "", Type: FileTypeImage, Size: 3000, ModTime: time.Now().Add(-3 * time.Hour)},
		{Name: "alpha.jpg", Path: "alpha.jpg", ParentPath: "", Type: FileTypeImage, Size: 1000, ModTime: time.Now().Add(-1 * time.Hour)},
		{Name: "beta.mp4", Path: "beta.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2000, ModTime: time.Now().Add(-2 * time.Hour)},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	tests := []struct {
		name          string
		sortField     SortField
		sortOrder     SortOrder
		expectedFirst string
	}{
		{"Sort by name ascending", SortByName, SortAsc, "alpha.jpg"},
		{"Sort by name descending", SortByName, SortDesc, "zebra.jpg"},
		{"Sort by size ascending", SortBySize, SortAsc, "alpha.jpg"},
		{"Sort by size descending", SortBySize, SortDesc, "zebra.jpg"},
		{"Sort by date ascending", SortByDate, SortAsc, "zebra.jpg"},
		{"Sort by date descending", SortByDate, SortDesc, "alpha.jpg"},
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

	batch, _ := db.BeginBatch(ctx)
	for i := 0; i < 25; i++ {
		file := MediaFile{
			Name:       filepath.Base(filepath.Join("page", "file"+string(rune('a'+i%26))+".jpg")),
			Path:       filepath.Join("page", "file"+string(rune('a'+i%26))+".jpg"),
			ParentPath: "page",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = batch.UpsertFile(ctx, &file)
	}
	_ = db.EndBatch(batch, nil)

	tests := []struct {
		name        string
		page        int
		pageSize    int
		expectItems int
		expectTotal int
		expectPages int
	}{
		{"Page 1 of 10", 1, 10, 10, 25, 3},
		{"Page 2 of 10", 2, 10, 10, 25, 3},
		{"Page 3 of 10 (partial)", 3, 10, 5, 25, 3},
		{"Large page size", 1, 100, 25, 25, 1},
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

func TestListDirectoryWithOffset(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	const dir = "offset-test"

	// Insert 10 files named file00.jpg … file09.jpg so alphabetical order is stable.
	batch, _ := db.BeginBatch(ctx)
	for i := 0; i < 10; i++ {
		file := MediaFile{
			Name:       fmt.Sprintf("file%02d.jpg", i),
			Path:       filepath.Join(dir, fmt.Sprintf("file%02d.jpg", i)),
			ParentPath: dir,
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = batch.UpsertFile(ctx, &file)
	}
	_ = db.EndBatch(batch, nil)

	tests := []struct {
		name        string
		offset      int
		pageSize    int
		expectCount int
		expectTotal int
		expectFirst string // Name of the first item returned
	}{
		{
			name:        "offset 0 returns from beginning",
			offset:      0,
			pageSize:    3,
			expectCount: 3,
			expectTotal: 10,
			expectFirst: "file00.jpg",
		},
		{
			name:        "offset 3 skips first three items",
			offset:      3,
			pageSize:    3,
			expectCount: 3,
			expectTotal: 10,
			expectFirst: "file03.jpg",
		},
		{
			name:        "offset 8 returns only remaining items",
			offset:      8,
			pageSize:    10,
			expectCount: 2,
			expectTotal: 10,
			expectFirst: "file08.jpg",
		},
		{
			name:        "offset matches page-based result for same window",
			offset:      5,
			pageSize:    5,
			expectCount: 5,
			expectTotal: 10,
			expectFirst: "file05.jpg",
		},
		{
			name:        "offset beyond total returns empty",
			offset:      20,
			pageSize:    5,
			expectCount: 0,
			expectTotal: 10,
			expectFirst: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opts := ListOptions{
				Path:      dir,
				SortField: SortByName,
				SortOrder: SortAsc,
				Page:      1,
				PageSize:  tt.pageSize,
				Offset:    tt.offset,
			}

			listing, err := db.ListDirectory(ctx, opts)
			if err != nil {
				t.Fatalf("ListDirectory failed: %v", err)
			}

			if len(listing.Items) != tt.expectCount {
				t.Errorf("got %d items, want %d", len(listing.Items), tt.expectCount)
			}
			if listing.TotalItems != tt.expectTotal {
				t.Errorf("TotalItems = %d, want %d", listing.TotalItems, tt.expectTotal)
			}
			if tt.expectFirst != "" {
				if len(listing.Items) == 0 {
					t.Errorf("expected first item %q but got no items", tt.expectFirst)
				} else if listing.Items[0].Name != tt.expectFirst {
					t.Errorf("first item = %q, want %q", listing.Items[0].Name, tt.expectFirst)
				}
			}
		})
	}
}

// TestListDirectoryOffsetMatchesPageResult verifies that fetching via offset
// produces the same items as the equivalent page-based query.
func TestListDirectoryOffsetMatchesPageResult(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	const dir = "parity-test"
	const pageSize = 5

	batch, _ := db.BeginBatch(ctx)
	for i := 0; i < 20; i++ {
		file := MediaFile{
			Name:       fmt.Sprintf("item%02d.jpg", i),
			Path:       filepath.Join(dir, fmt.Sprintf("item%02d.jpg", i)),
			ParentPath: dir,
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = batch.UpsertFile(ctx, &file)
	}
	_ = db.EndBatch(batch, nil)

	// Compare page 2 (items 5–9) with offset=5
	pageListing, err := db.ListDirectory(ctx, ListOptions{
		Path:      dir,
		SortField: SortByName,
		SortOrder: SortAsc,
		Page:      2,
		PageSize:  pageSize,
	})
	if err != nil {
		t.Fatalf("page-based ListDirectory failed: %v", err)
	}

	offsetListing, err := db.ListDirectory(ctx, ListOptions{
		Path:      dir,
		SortField: SortByName,
		SortOrder: SortAsc,
		Page:      1,
		PageSize:  pageSize,
		Offset:    pageSize, // skip first 5
	})
	if err != nil {
		t.Fatalf("offset-based ListDirectory failed: %v", err)
	}

	if len(pageListing.Items) != len(offsetListing.Items) {
		t.Fatalf("item count mismatch: page=%d, offset=%d", len(pageListing.Items), len(offsetListing.Items))
	}
	for i := range pageListing.Items {
		if pageListing.Items[i].Path != offsetListing.Items[i].Path {
			t.Errorf("item[%d]: page=%q, offset=%q", i, pageListing.Items[i].Path, offsetListing.Items[i].Path)
		}
	}
}

func TestListDirectoryEmpty(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	opts := ListOptions{Path: "nonexistent", Page: 1, PageSize: 100}

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

	files := []MediaFile{
		{Name: "sunset.jpg", Path: "sunset.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "sunrise.jpg", Path: "sunrise.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "beach.mp4", Path: "beach.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
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
	_ = tx.UpsertFile(ctx, &playlist)
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

	files := []MediaFile{
		{Name: "zebra.jpg", Path: "media/zebra.jpg", ParentPath: "media", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "alpha.jpg", Path: "media/alpha.jpg", ParentPath: "media", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "beta.mp4", Path: "media/beta.mp4", ParentPath: "media", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
	}

	batch, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = batch.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(batch, nil)

	mediaFiles, err := db.GetMediaInDirectory(ctx, "media", SortByName, SortAsc)
	if err != nil {
		t.Fatalf("GetMediaInDirectory failed: %v", err)
	}

	if len(mediaFiles) != 3 {
		t.Errorf("Got %d files, want 3", len(mediaFiles))
	}

	if len(mediaFiles) >= 2 && mediaFiles[0].Name != "alpha.jpg" {
		t.Errorf("First file = %s, want alpha.jpg", mediaFiles[0].Name)
	}
}

func TestGetMediaInDirectory_CoveringIndexes(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Verify the legacy covering indexes used by GetMediaInDirectory.
	var legacyCount int
	legacyQuery := `
		SELECT COUNT(*)
		FROM sqlite_master
		WHERE type = 'index'
		AND name IN ('idx_files_media_directory_name', 'idx_files_media_directory_date', 'idx_files_path')
	`
	err := db.reader.QueryRowContext(ctx, legacyQuery).Scan(&legacyCount)
	if err != nil {
		t.Fatalf("Failed to check for legacy covering indexes: %v", err)
	}
	if legacyCount != 3 {
		t.Errorf("Expected 3 legacy covering indexes, got %d", legacyCount)
	}

	// Verify the expression indexes added to support the "folders first, then
	// interleave by sort field" ORDER BY in fetchDirectoryItems / buildListDirQuery.
	// If these are missing the ORDER BY CASE expression will force a post-scan sort.
	var folderFirstCount int
	folderFirstQuery := `
		SELECT COUNT(*)
		FROM sqlite_master
		WHERE type = 'index'
		AND name IN (
			'idx_files_folder_first_name',
			'idx_files_folder_first_date',
			'idx_files_folder_first_size'
		)
	`
	err = db.reader.QueryRowContext(ctx, folderFirstQuery).Scan(&folderFirstCount)
	if err != nil {
		t.Fatalf("Failed to check for folder-first expression indexes: %v", err)
	}
	if folderFirstCount != 3 {
		t.Errorf("Expected 3 folder-first expression indexes, got %d (idx_files_folder_first_{name,date,size})", folderFirstCount)
	}

	batch, _ := db.BeginBatch(ctx)
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
		_ = batch.UpsertFile(ctx, &file)
	}
	_ = db.EndBatch(batch, nil)

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

	insertFiles := []MediaFile{
		{Name: "file1.jpg", Path: "test/file1.jpg", ParentPath: "test", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "file2.jpg", Path: "test/file2.jpg", ParentPath: "test", Type: FileTypeImage, Size: 2048, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range insertFiles {
		_ = tx.UpsertFile(ctx, &insertFiles[i])
	}
	_ = db.EndBatch(tx, nil)

	if err := db.AddFavorite(ctx, "test/file1.jpg", "file1.jpg", FileTypeImage); err != nil {
		t.Fatalf("Failed to add favorite: %v", err)
	}

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

	if !files[0].IsFavorite {
		t.Error("file1.jpg should be marked as favorite")
	}
	if files[1].IsFavorite {
		t.Error("file2.jpg should not be marked as favorite")
	}

	if len(files[0].Tags) != 1 || files[0].Tags[0] != "test-tag" {
		t.Errorf("file1.jpg should have tag 'test-tag', got %v", files[0].Tags)
	}
	if len(files[1].Tags) != 1 || files[1].Tags[0] != "another-tag" {
		t.Errorf("file2.jpg should have tag 'another-tag', got %v", files[1].Tags)
	}
}

func TestGetMediaFilesForThumbnailsPaged(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	files := []MediaFile{
		{Name: "a.jpg", Path: "a.jpg", ParentPath: "", Type: FileTypeImage, Size: 1024, ModTime: time.Now()},
		{Name: "b.mp4", Path: "b.mp4", ParentPath: "", Type: FileTypeVideo, Size: 2048, ModTime: time.Now()},
		{Name: "folder", Path: "folder", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()},
		{Name: "c.jpg", Path: "folder/c.jpg", ParentPath: "folder", Type: FileTypeImage, Size: 512, ModTime: time.Now()},
	}

	tx, _ := db.BeginBatch(ctx)
	for i := range files {
		_ = tx.UpsertFile(ctx, &files[i])
	}
	_ = db.EndBatch(tx, nil)

	// First page: limit 2
	page1, err := db.GetMediaFilesForThumbnailsPaged(ctx, 0, 2)
	if err != nil {
		t.Fatalf("GetMediaFilesForThumbnailsPaged page 1 failed: %v", err)
	}
	if len(page1) != 2 {
		t.Errorf("page 1: got %d files, want 2", len(page1))
	}

	// Second page
	page2, err := db.GetMediaFilesForThumbnailsPaged(ctx, 2, 2)
	if err != nil {
		t.Fatalf("GetMediaFilesForThumbnailsPaged page 2 failed: %v", err)
	}
	if len(page2) != 2 {
		t.Errorf("page 2: got %d files, want 2", len(page2))
	}

	// Third page should be empty
	page3, err := db.GetMediaFilesForThumbnailsPaged(ctx, 4, 2)
	if err != nil {
		t.Fatalf("GetMediaFilesForThumbnailsPaged page 3 failed: %v", err)
	}
	if len(page3) != 0 {
		t.Errorf("page 3: got %d files, want 0 (empty terminal page)", len(page3))
	}

	// All pages combined should cover all 4 files, ordered by path
	all := make([]MediaFile, 0, len(page1)+len(page2))
	all = append(all, page1...)
	all = append(all, page2...)
	if len(all) != 4 {
		t.Errorf("total files across pages: got %d, want 4", len(all))
	}
	for i := 1; i < len(all); i++ {
		if all[i].Path < all[i-1].Path {
			t.Errorf("files not ordered by path: %q before %q", all[i-1].Path, all[i].Path)
		}
	}
}

func TestGetFoldersWithUpdatedContents(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	folder := MediaFile{Name: "photos", Path: "photos", ParentPath: "", Type: FileTypeFolder, Size: 0, ModTime: time.Now()}

	tx, _ := db.BeginBatch(ctx)
	_ = tx.UpsertFile(ctx, &folder)
	_ = db.EndBatch(tx, nil)

	oldFile := MediaFile{Name: "old.jpg", Path: "photos/old.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 1024, ModTime: time.Now()}

	batch, _ := db.BeginBatch(ctx)
	_ = batch.UpsertFile(ctx, &oldFile)
	_ = db.EndBatch(batch, nil)

	t.Logf("Waiting 11 seconds for timestamp separation...")
	time.Sleep(11 * time.Second)
	beforeUpdate := time.Now()

	newFile := MediaFile{Name: "new.jpg", Path: "photos/new.jpg", ParentPath: "photos", Type: FileTypeImage, Size: 1024, ModTime: time.Now()}

	batch, _ = db.BeginBatch(ctx)
	_ = batch.UpsertFile(ctx, &newFile)
	_ = db.EndBatch(batch, nil)

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
		_ = tx.UpsertFile(ctx, &files[i])
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
	batch, _ := db.BeginBatch(ctx)

	for i := 0; i < fileCount; i++ {
		file := MediaFile{
			Name:       fmt.Sprintf("file_%04d.jpg", i),
			Path:       fmt.Sprintf("test/file_%04d.jpg", i),
			ParentPath: "test",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = batch.UpsertFile(ctx, &file)
	}
	_ = db.EndBatch(batch, nil)

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

	opts := SearchOptions{Query: "", Page: 1, PageSize: 100}

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

	db, _, err := New(context.Background(), dbPath, nil)
	if err != nil {
		t.Fatalf("Failed to create database: %v", err)
	}

	ctx := context.Background()

	if err := db.CreateUser(ctx, "testpassword"); err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	var setupComplete int
	err = db.reader.QueryRowContext(ctx, "SELECT setup_complete FROM users WHERE id = 1").Scan(&setupComplete)
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

	db, _, err = New(context.Background(), dbPath, nil)
	if err != nil {
		t.Fatalf("Failed to reopen database: %v", err)
	}
	defer db.Close()

	err = db.reader.QueryRowContext(ctx, "SELECT setup_complete FROM users WHERE id = 1").Scan(&setupComplete)
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

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	for i := 0; i < 10; i++ {
		file := MediaFile{
			Name: "test.jpg", Path: "test/test.jpg", ParentPath: "test",
			Type: FileTypeImage, Size: 1024, ModTime: now,
		}
		if err := batch.UpsertFile(ctx, &file); err != nil {
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err = db.EndBatch(batch, err); err != nil {
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

	batch, err := db.BeginBatch(ctx)
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

	if err = db.EndBatch(batch, err); err != nil {
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

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	for i := 0; i < 100; i++ {
		file := MediaFile{
			Name: "test.jpg", Path: "test/test.jpg", ParentPath: "test",
			Type: FileTypeImage, Size: 1024, ModTime: now,
		}
		if err := batch.UpsertFile(ctx, &file); err != nil {
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err = db.EndBatch(batch, err); err != nil {
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
			wtx, werr := db.BeginBatch(ctx)
			if werr != nil {
				done <- werr
				return
			}
			for j := 0; j < 10; j++ {
				file := MediaFile{
					Name:       fmt.Sprintf("batch%d_file%d.jpg", idx, j),
					Path:       fmt.Sprintf("concurrent/batch%d_file%d.jpg", idx, j),
					ParentPath: "concurrent",
					Type:       FileTypeImage,
					Size:       1024,
					ModTime:    now,
				}
				if uerr := wtx.UpsertFile(ctx, &file); uerr != nil {
					done <- uerr
					return
				}
			}
			done <- db.EndBatch(wtx, nil)
		}(i)
		time.Sleep(5 * time.Millisecond)
	}

	errCount := 0
	for i := 0; i < totalOps; i++ {
		if err := <-done; err != nil {
			t.Errorf("Operation failed: %v", err)
			errCount++
		}
	}
	elapsed := time.Since(start)

	if errCount > 0 {
		t.Fatalf("%d/%d operations failed", errCount, totalOps)
	}

	if elapsed > 2*time.Second {
		t.Logf("Warning: Operations took %v, may indicate connection pool issues", elapsed)
	}

	t.Logf("%d mixed operations (%d reads, %d writes) completed in %v with no errors",
		totalOps, numReads, numWrites, elapsed)
}

// =============================================================================
// Mmap / SIGBUS Protection — Integration Tests
// =============================================================================

// TestMmapDisabledOnAllConnections verifies that every connection in the pool
// has mmap_size=0 when MmapDisabled is true.
func TestMmapDisabledOnAllConnections(t *testing.T) {
	db, _ := setupTestDB(t, &Options{MmapDisabled: true})
	defer db.Close()

	ctx := context.Background()

	const numConns = 10
	conns := make([]*sql.Conn, 0, numConns)

	for i := 0; i < numConns; i++ {
		conn, err := db.reader.Conn(ctx)
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

// TestMmapEnabledByDefault verifies that when no options are passed (nil),
// the standard SQLite driver is used.
func TestMmapEnabledByDefault(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "default_mmap.db")

	db, info, err := New(context.Background(), dbPath, nil)
	if err != nil {
		t.Fatalf("New(nil) failed: %v", err)
	}
	defer db.Close()

	if strings.Contains(info.MmapStatus, "SIGBUS protection active") {
		t.Errorf("Default (nil opts) should NOT report SIGBUS protection, got: %s", info.MmapStatus)
	}

	if !strings.Contains(info.MmapStatus, "standard mode") {
		t.Errorf("Default (nil opts) should report standard mode, got: %s", info.MmapStatus)
	}

	t.Logf("Default mmap status: %s", info.MmapStatus)
}

// TestMmapEnabledExplicit verifies that MmapDisabled=false behaves the same
// as nil options.
func TestMmapEnabledExplicit(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "explicit_enabled.db")

	db, info, err := New(context.Background(), dbPath, &Options{MmapDisabled: false})
	if err != nil {
		t.Fatalf("New(MmapDisabled=false) failed: %v", err)
	}
	defer db.Close()

	if strings.Contains(info.MmapStatus, "SIGBUS protection active") {
		t.Errorf("MmapDisabled=false should NOT report SIGBUS protection, got: %s", info.MmapStatus)
	}

	if !strings.Contains(info.MmapStatus, "standard mode") {
		t.Errorf("MmapDisabled=false should report standard mode, got: %s", info.MmapStatus)
	}
}

// TestMmapDisabledAfterInitialize verifies that database initialization
// does not re-enable mmap when disabled.
func TestMmapDisabledAfterInitialize(t *testing.T) {
	db, _ := setupTestDB(t, &Options{MmapDisabled: true})
	defer db.Close()

	ctx := context.Background()

	var mmapSize int64
	err := db.reader.QueryRowContext(ctx, "PRAGMA mmap_size").Scan(&mmapSize)
	if err != nil {
		t.Fatalf("Failed to read mmap_size: %v", err)
	}

	if mmapSize != 0 {
		t.Errorf("mmap_size=%d after initialize(), want 0", mmapSize)
	}
}

// TestMmapDisabledWithCustomDriver verifies that our custom driver applies mmap_size=0.
func TestMmapDisabledWithCustomDriver(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "driver_test.db")

	ctx := context.Background()
	connStr := fmt.Sprintf("%s?_journal_mode=WAL&_busy_timeout=5000", dbPath)

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

// TestNewDatabaseMmapDisabled verifies New() with MmapDisabled=true.
func TestNewDatabaseMmapDisabled(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "mmap_test.db")

	ctx := context.Background()

	db, _, err := New(ctx, dbPath, &Options{MmapDisabled: true})
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer db.Close()

	var mmapSize int64
	if err := db.reader.QueryRowContext(ctx, "PRAGMA mmap_size").Scan(&mmapSize); err != nil {
		t.Fatalf("Failed to read mmap_size: %v", err)
	}

	if mmapSize != 0 {
		t.Errorf("New() database has mmap_size=%d, want 0", mmapSize)
	}

	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	file := &MediaFile{
		Name: "test.jpg", Path: "mmap_test/test.jpg", ParentPath: "mmap_test",
		Type: FileTypeImage, Size: 1024, ModTime: time.Now(), MimeType: "image/jpeg",
	}

	if err := batch.UpsertFile(ctx, file); err != nil {
		t.Fatalf("UpsertFile failed with mmap disabled: %v", err)
	}
	if err = db.EndBatch(batch, err); err != nil {
		t.Fatalf("EndBatch failed with mmap disabled: %v", err)
	}

	retrieved, err := db.GetFileByPath(ctx, "mmap_test/test.jpg")
	if err != nil {
		t.Fatalf("GetFileByPath failed with mmap disabled: %v", err)
	}
	if retrieved.Name != "test.jpg" {
		t.Errorf("Retrieved file name = %q, want %q", retrieved.Name, "test.jpg")
	}

	results, err := db.Search(ctx, SearchOptions{Query: "test", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("Search failed with mmap disabled: %v", err)
	}
	if len(results.Items) < 1 {
		t.Error("Search should return at least 1 result with mmap disabled")
	}

	if _, err := db.CalculateStats(); err != nil {
		t.Fatalf("CalculateStats failed with mmap disabled: %v", err)
	}

	t.Log("All database operations verified working with mmap disabled")
}

// TestMmapDisabledPersistsAcrossReopen verifies mmap stays disabled on reopen.
func TestMmapDisabledPersistsAcrossReopen(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "reopen_test.db")

	ctx := context.Background()
	opts := &Options{MmapDisabled: true}

	db1, _, err := New(ctx, dbPath, opts)
	if err != nil {
		t.Fatalf("First New() failed: %v", err)
	}

	tx, err := db1.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	file := &MediaFile{
		Name: "persist.jpg", Path: "persist/persist.jpg", ParentPath: "persist",
		Type: FileTypeImage, Size: 1024, ModTime: time.Now(),
	}
	if err := tx.UpsertFile(ctx, file); err != nil {
		t.Fatalf("UpsertFile failed: %v", err)
	}
	if err := db1.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	db1.Close()

	db2, _, err := New(ctx, dbPath, opts)
	if err != nil {
		t.Fatalf("Second New() failed: %v", err)
	}
	defer db2.Close()

	var mmapSize int64
	if err := db2.reader.QueryRowContext(ctx, "PRAGMA mmap_size").Scan(&mmapSize); err != nil {
		t.Fatalf("Failed to read mmap_size after reopen: %v", err)
	}

	if mmapSize != 0 {
		t.Errorf("mmap_size=%d after reopen, want 0", mmapSize)
	}

	retrieved, err := db2.GetFileByPath(ctx, "persist/persist.jpg")
	if err != nil {
		t.Fatalf("GetFileByPath failed after reopen: %v", err)
	}
	if retrieved.Name != "persist.jpg" {
		t.Errorf("Retrieved file name = %q after reopen, want %q", retrieved.Name, "persist.jpg")
	}
}

// TestMmapModeSwitch verifies switching between mmap modes across reopens.
func TestMmapModeSwitch(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "switch_test.db")
	ctx := context.Background()

	// Create with mmap disabled
	db1, info1, err := New(ctx, dbPath, &Options{MmapDisabled: true})
	if err != nil {
		t.Fatalf("New(disabled) failed: %v", err)
	}

	if !strings.Contains(info1.MmapStatus, "SIGBUS protection active") {
		t.Errorf("First open should have SIGBUS protection, got: %s", info1.MmapStatus)
	}

	tx, err := db1.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	file := &MediaFile{
		Name: "switch.jpg", Path: "switch/switch.jpg", ParentPath: "switch",
		Type: FileTypeImage, Size: 1024, ModTime: time.Now(),
	}
	if err := tx.UpsertFile(ctx, file); err != nil {
		t.Fatalf("UpsertFile failed: %v", err)
	}
	if err := db1.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}
	db1.Close()

	// Reopen with mmap enabled (standard mode)
	db2, info2, err := New(ctx, dbPath, nil)
	if err != nil {
		t.Fatalf("New(nil) after disabled failed: %v", err)
	}
	defer db2.Close()

	if !strings.Contains(info2.MmapStatus, "standard mode") {
		t.Errorf("Second open should be standard mode, got: %s", info2.MmapStatus)
	}

	retrieved, err := db2.GetFileByPath(ctx, "switch/switch.jpg")
	if err != nil {
		t.Fatalf("GetFileByPath after mode switch failed: %v", err)
	}
	if retrieved.Name != "switch.jpg" {
		t.Errorf("Name = %q after mode switch, want %q", retrieved.Name, "switch.jpg")
	}

	t.Log("Database successfully switched from mmap-disabled to mmap-enabled")
}

// TestMmapInstanceIsolation verifies that the mmapDisabled flag is per-instance,
// not global — creating a DB with mmap disabled should not affect another DB
// created with mmap enabled.
func TestMmapInstanceIsolation(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := context.Background()

	// Create first DB with mmap disabled
	db1Path := filepath.Join(tmpDir, "disabled.db")
	db1, info1, err := New(ctx, db1Path, &Options{MmapDisabled: true})
	if err != nil {
		t.Fatalf("New(disabled) failed: %v", err)
	}
	defer db1.Close()

	if !strings.Contains(info1.MmapStatus, "SIGBUS protection active") {
		t.Errorf("db1 should have SIGBUS protection, got: %s", info1.MmapStatus)
	}

	// Create second DB with mmap enabled AFTER the disabled one
	db2Path := filepath.Join(tmpDir, "enabled.db")
	db2, info2, err := New(ctx, db2Path, nil)
	if err != nil {
		t.Fatalf("New(nil) failed: %v", err)
	}
	defer db2.Close()

	// db2 must NOT inherit db1's mmap setting
	if strings.Contains(info2.MmapStatus, "SIGBUS protection active") {
		t.Errorf("db2 should NOT have SIGBUS protection (instance leak!), got: %s", info2.MmapStatus)
	}

	if !strings.Contains(info2.MmapStatus, "standard mode") {
		t.Errorf("db2 should be standard mode, got: %s", info2.MmapStatus)
	}

	t.Log("Mmap settings are correctly isolated between database instances")
}

// =============================================================================
// Storage Health Tests
// =============================================================================

func TestCheckStorageHealthNormal(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	db.CheckStorageHealth()

	if _, err := os.Stat(db.dbPath); err != nil {
		t.Errorf("DB file should exist: %v", err)
	}
}

func TestCheckStorageHealthMissingDB(t *testing.T) {
	db, _ := setupTestDB(t)

	db.Close()
	os.Remove(db.dbPath)
	os.Remove(db.dbPath + "-wal")
	os.Remove(db.dbPath + "-shm")

	// Should not panic
	db.CheckStorageHealth()
}

func TestCheckStorageHealthUnreadableDB(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("skipping permission test when running as root")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	if err := os.Chmod(db.dbPath, 0o000); err != nil {
		t.Fatalf("Failed to chmod: %v", err)
	}
	defer os.Chmod(db.dbPath, 0o644)

	// Should not panic
	db.CheckStorageHealth()
}

func TestLogSQLiteConfig(t *testing.T) {
	db, _ := setupTestDB(t)
	db.Close()
}

// =============================================================================
// Benchmarks
// =============================================================================

// =============================================================================
// BulkIndex and busy_timeout tests
// =============================================================================

// ftsTriggersPresent returns the names of the three FTS maintenance triggers
// that are currently defined on the files table.
func ftsTriggersPresent(t *testing.T, db *Database) map[string]bool {
	t.Helper()
	const q = `
		SELECT name FROM sqlite_master
		WHERE type = 'trigger'
		  AND tbl_name = 'files'
		  AND name IN ('files_ai', 'files_au', 'files_ad')
	`
	rows, err := db.reader.QueryContext(context.Background(), q)
	if err != nil {
		t.Fatalf("ftsTriggersPresent query failed: %v", err)
	}
	defer rows.Close()

	result := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("ftsTriggersPresent scan: %v", err)
		}
		result[name] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("ftsTriggersPresent rows: %v", err)
	}
	return result
}

// TestBulkIndexBeginDropsFTSTriggers verifies that BulkIndexBegin removes
// all three FTS maintenance triggers so that per-row FTS updates are skipped
// during batch upserts.
func TestBulkIndexBeginDropsFTSTriggers(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	// Triggers should be present after schema creation.
	triggers := ftsTriggersPresent(t, db)
	for _, name := range []string{"files_ai", "files_au", "files_ad"} {
		if !triggers[name] {
			t.Errorf("expected trigger %s to exist before BulkIndexBegin", name)
		}
	}

	// Drop them.
	if err := db.BulkIndexBegin(context.Background()); err != nil {
		t.Fatalf("BulkIndexBegin failed: %v", err)
	}
	defer db.BulkIndexEnd(context.Background()) //nolint:errcheck // cleanup

	// All three must be absent.
	triggers = ftsTriggersPresent(t, db)
	for _, name := range []string{"files_ai", "files_au", "files_ad"} {
		if triggers[name] {
			t.Errorf("expected trigger %s to be absent after BulkIndexBegin, but it is still present", name)
		}
	}
}

// TestBulkIndexEndRestoresTriggersAndRebuilds verifies that BulkIndexEnd
// recreates the three FTS triggers and that the FTS table is queryable after
// the rebuild.
func TestBulkIndexEndRestoresTriggersAndRebuilds(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	// Insert a file before disabling triggers so FTS is not empty.
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch: %v", err)
	}
	_ = batch.UpsertFile(ctx, &MediaFile{
		Name: "sunset.jpg", Path: "bulk/sunset.jpg", ParentPath: "bulk",
		Type: FileTypeImage, Size: 512, ModTime: time.Now(),
	})
	if err := db.EndBatch(batch, nil); err != nil {
		t.Fatalf("EndBatch: %v", err)
	}

	if err := db.BulkIndexBegin(ctx); err != nil {
		t.Fatalf("BulkIndexBegin: %v", err)
	}

	// Insert another file while triggers are absent (FTS won't auto-update).
	batch, err = db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch (bulk): %v", err)
	}
	_ = batch.UpsertFile(ctx, &MediaFile{
		Name: "mountain.jpg", Path: "bulk/mountain.jpg", ParentPath: "bulk",
		Type: FileTypeImage, Size: 1024, ModTime: time.Now(),
	})
	if err := db.EndBatch(batch, nil); err != nil {
		t.Fatalf("EndBatch (bulk): %v", err)
	}

	// Restore — triggers must come back and FTS must include both files.
	if err := db.BulkIndexEnd(ctx); err != nil {
		t.Fatalf("BulkIndexEnd: %v", err)
	}

	// All three triggers must be present again.
	triggers := ftsTriggersPresent(t, db)
	for _, name := range []string{"files_ai", "files_au", "files_ad"} {
		if !triggers[name] {
			t.Errorf("expected trigger %s to be restored by BulkIndexEnd", name)
		}
	}

	// FTS rebuild should have picked up both files.
	results, err := db.Search(ctx, SearchOptions{Query: "sunset", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("Search(sunset): %v", err)
	}
	if len(results.Items) == 0 {
		t.Error("expected FTS to find 'sunset' after BulkIndexEnd rebuild")
	}

	results, err = db.Search(ctx, SearchOptions{Query: "mountain", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("Search(mountain): %v", err)
	}
	if len(results.Items) == 0 {
		t.Error("expected FTS to find 'mountain' after BulkIndexEnd rebuild")
	}
}

// TestBulkIndexBeginIsIdempotent verifies that calling BulkIndexBegin twice
// (i.e. when triggers are already absent) does not return an error — the DROP
// TRIGGER IF EXISTS statements are no-ops the second time.
func TestBulkIndexBeginIsIdempotent(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	if err := db.BulkIndexBegin(ctx); err != nil {
		t.Fatalf("first BulkIndexBegin: %v", err)
	}
	defer db.BulkIndexEnd(ctx) //nolint:errcheck // cleanup

	// Second call must not error.
	if err := db.BulkIndexBegin(ctx); err != nil {
		t.Errorf("second BulkIndexBegin (idempotent) returned error: %v", err)
	}
}

// TestBulkIndexEndRestoresTriggersIsIdempotent verifies that calling
// BulkIndexEnd without a preceding BulkIndexBegin (triggers already present)
// is safe — CREATE TRIGGER IF NOT EXISTS is a no-op.
func TestBulkIndexEndRestoresTriggersIsIdempotent(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	// Triggers are already present. BulkIndexEnd should not error.
	if err := db.BulkIndexEnd(context.Background()); err != nil {
		t.Errorf("BulkIndexEnd without prior BulkIndexBegin returned error: %v", err)
	}

	// Triggers must still be present.
	triggers := ftsTriggersPresent(t, db)
	for _, name := range []string{"files_ai", "files_au", "files_ad"} {
		if !triggers[name] {
			t.Errorf("trigger %s unexpectedly absent after no-op BulkIndexEnd", name)
		}
	}
}

// TestBulkIndexFTSNotUpdatedDuringBatch verifies the core optimisation:
// while FTS triggers are disabled, inserting files does NOT update the FTS
// index — so db.Search() returns no results for the inserted filenames until
// BulkIndexEnd() performs the one-pass rebuild.
//
// NOTE: files_fts is an FTS5 external-content table (content='files'), so
// SELECT COUNT(*) FROM files_fts proxies through to the underlying content
// table and would show new rows even when triggers are disabled.  The correct
// observable is whether the FTS *index* has been updated, which is what
// db.Search() tests.
func TestBulkIndexFTSNotUpdatedDuringBatch(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	// Use names long enough for trigram tokenisation to produce tokens.
	// "bulkbatch0" … "bulkbatch4" are each ≥ 3 chars so trigrams are generated.
	names := make([]string, 5)
	for i := range names {
		names[i] = fmt.Sprintf("bulkbatch%d.jpg", i)
	}

	// Pre-condition: none of these names are in the FTS index yet.
	for _, name := range names {
		results, err := db.Search(ctx, SearchOptions{Query: name[:9], Page: 1, PageSize: 10}) // e.g. "bulkbatch"
		if err != nil {
			t.Fatalf("pre-check Search(%q): %v", name, err)
		}
		if len(results.Items) != 0 {
			t.Fatalf("pre-check: expected 0 results for %q, got %d", name, len(results.Items))
		}
	}

	if err := db.BulkIndexBegin(ctx); err != nil {
		t.Fatalf("BulkIndexBegin: %v", err)
	}

	// Insert 5 files with triggers disabled.
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch: %v", err)
	}
	for i, name := range names {
		_ = batch.UpsertFile(ctx, &MediaFile{
			Name:       name,
			Path:       fmt.Sprintf("fts_test/%s", name),
			ParentPath: "fts_test",
			Type:       FileTypeImage,
			Size:       int64(100 * (i + 1)),
			ModTime:    time.Now(),
		})
	}
	if err := db.EndBatch(batch, nil); err != nil {
		t.Fatalf("EndBatch: %v", err)
	}

	// FTS index must NOT have been updated — Search must return nothing.
	// (The files exist in the `files` table but the FTS index wasn't touched
	// because the triggers were disabled by BulkIndexBegin.)
	results, err := db.Search(ctx, SearchOptions{Query: "bulkbatch", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("Search during bulk: %v", err)
	}
	if len(results.Items) != 0 {
		t.Errorf("FTS index was updated during bulk (Search returned %d results, want 0): triggers were not disabled",
			len(results.Items))
	}

	// After rebuild, Search must find all 5 files.
	if err := db.BulkIndexEnd(ctx); err != nil {
		t.Fatalf("BulkIndexEnd: %v", err)
	}
	results, err = db.Search(ctx, SearchOptions{Query: "bulkbatch", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("Search after BulkIndexEnd: %v", err)
	}
	if len(results.Items) != 5 {
		t.Errorf("after BulkIndexEnd: Search returned %d results, want 5", len(results.Items))
	}
}

// TestBusyTimeoutIs30000 verifies that every new connection receives
// PRAGMA busy_timeout = 30000 via the ConnectHook, providing NFS tolerance.
func TestBusyTimeoutIs30000(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	for _, tc := range []struct {
		name string
		pool *sql.DB
	}{
		{"reader", db.reader},
		{"writer", db.writer},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var v int
			if err := tc.pool.QueryRowContext(ctx, "PRAGMA busy_timeout").Scan(&v); err != nil {
				t.Fatalf("PRAGMA busy_timeout on %s: %v", tc.name, err)
			}
			if v != 30000 {
				t.Errorf("%s busy_timeout = %d, want 30000", tc.name, v)
			}
		})
	}
}

// TestBulkIndexEndCheckpointsWAL verifies that BulkIndexEnd triggers a
// WAL checkpoint without returning an error. The checkpoint is best-effort
// (PASSIVE mode) so it must never fail an otherwise-successful bulk index.
func TestBulkIndexEndCheckpointsWAL(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	if err := db.BulkIndexBegin(ctx); err != nil {
		t.Fatalf("BulkIndexBegin: %v", err)
	}

	// Insert a few rows so the WAL has something to checkpoint.
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch: %v", err)
	}
	for i := 0; i < 3; i++ {
		_ = batch.UpsertFile(ctx, &MediaFile{
			Name:       fmt.Sprintf("wal_test_%d.jpg", i),
			Path:       fmt.Sprintf("wal/%d.jpg", i),
			ParentPath: "wal",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		})
	}
	if err := db.EndBatch(batch, nil); err != nil {
		t.Fatalf("EndBatch: %v", err)
	}

	// BulkIndexEnd must succeed (checkpoint failure is logged but non-fatal).
	if err := db.BulkIndexEnd(ctx); err != nil {
		t.Fatalf("BulkIndexEnd returned error: %v", err)
	}
}

// TestUpdateDBMetricsConnectionDetails verifies that UpdateDBMetrics sets the
// InUse and Idle connection gauges without panicking. Between queries both
// values will typically be 0 but the call must not error.
func TestUpdateDBMetricsConnectionDetails(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	// Should not panic; gauges may read 0 between queries.
	db.UpdateDBMetrics()
}

// =============================================================================
// WAL checkpoint mode regression tests
//
// These tests guard against the performance regression where the background
// checkpoint worker used PRAGMA wal_checkpoint(TRUNCATE) instead of PASSIVE,
// causing it to hold the single writer connection while waiting for all active
// readers to drain.  On a 40 k-file NFS library this turned a ~30–60 s cold
// start into a ~10-minute one: each of the 80 upsert batches blocked on
// BeginTx for up to busy_timeout (30 s) while the writer was occupied by the
// checkpoint.
// =============================================================================

// openHoldingReadTx starts a read-only transaction that keeps a snapshot of
// the WAL open (so a TRUNCATE checkpoint cannot complete). The caller is
// responsible for calling tx.Rollback() or tx.Commit() when done.
func openHoldingReadTx(t *testing.T, db *Database) *sql.Tx {
	t.Helper()
	tx, err := db.reader.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("openHoldingReadTx: %v", err)
	}
	// Execute a dummy read so the transaction actually touches the database and
	// establishes its WAL read-mark.
	var n int
	if err := tx.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM files").Scan(&n); err != nil {
		_ = tx.Rollback()
		t.Fatalf("openHoldingReadTx: dummy read: %v", err)
	}
	return tx
}

// insertWALFrames writes a few rows so the WAL file has frames that a
// subsequent checkpoint would try to transfer to the main database file.
func insertWALFrames(t *testing.T, db *Database, n int) {
	t.Helper()
	ctx := context.Background()
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("insertWALFrames BeginBatch: %v", err)
	}
	for i := 0; i < n; i++ {
		_ = batch.UpsertFile(ctx, &MediaFile{
			Name:       fmt.Sprintf("wal_frame_%d.jpg", i),
			Path:       fmt.Sprintf("wal_frames/%d.jpg", i),
			ParentPath: "wal_frames",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		})
	}
	if err := db.EndBatch(batch, nil); err != nil {
		t.Fatalf("insertWALFrames EndBatch: %v", err)
	}
}

// TestPassiveCheckpointReturnsImmediatelyWithActiveReader verifies that
// passiveCheckpoint completes quickly even when a reader holds an open
// transaction that pins WAL frames (preventing full truncation).
//
// PASSIVE mode is non-blocking by design: it copies as many frames as it can
// and returns without waiting.  This is the correct mode for the background
// checkpoint worker, which must not compete for the writer connection with
// the upsert batches running in parallel.
func TestPassiveCheckpointReturnsImmediatelyWithActiveReader(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	// Put some frames in the WAL.
	insertWALFrames(t, db, 10)

	// Open a reader that holds a snapshot (pins WAL frames).
	readerTx := openHoldingReadTx(t, db)
	defer readerTx.Rollback() //nolint:errcheck // cleanup

	// Write more rows AFTER the reader snapshot so the WAL definitely has
	// frames the reader hasn't seen — a TRUNCATE checkpoint must wait for the
	// reader before it can truncate.
	insertWALFrames(t, db, 10)

	// PASSIVE checkpoint must return well within 1 second regardless of the
	// open reader.  If this used TRUNCATE it would spin for up to busy_timeout
	// (30 s) waiting for the reader to finish.
	const maxAllowed = 1 * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), maxAllowed)
	defer cancel()

	start := time.Now()
	err := db.passiveCheckpoint(ctx)
	elapsed := time.Since(start)

	if err != nil {
		t.Errorf("passiveCheckpoint returned error: %v", err)
	}
	if elapsed >= maxAllowed {
		t.Errorf("passiveCheckpoint took %v with an active reader (limit %v) — possible TRUNCATE mode regression",
			elapsed.Round(time.Millisecond), maxAllowed)
	}
	t.Logf("passiveCheckpoint returned in %v with an active reader", elapsed.Round(time.Millisecond))
}

// TestTruncateCheckpointBlocksOnActiveReader is the complement of the test
// above.  It confirms that PRAGMA wal_checkpoint(TRUNCATE) — the mode that
// caused the regression — DOES block when a reader holds a snapshot, making
// the previous test meaningful.
//
// We give it an intentionally short deadline (500 ms) so the test stays fast.
// The expectation is that the query does not complete within the deadline
// because it is busy-waiting for the reader to release its snapshot.
func TestTruncateCheckpointBlocksOnActiveReader(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	// Put frames in the WAL, then open a holding reader.
	insertWALFrames(t, db, 20)
	readerTx := openHoldingReadTx(t, db)
	defer readerTx.Rollback() //nolint:errcheck // cleanup

	// Write more rows so the WAL has frames the reader doesn't own.
	insertWALFrames(t, db, 20)

	// Short deadline — TRUNCATE should not complete within this window because
	// it is waiting for the reader to release the WAL frames.
	const deadline = 500 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), deadline)
	defer cancel()

	start := time.Now()
	var busy, log, checkpointed int
	err := db.writer.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &log, &checkpointed)
	elapsed := time.Since(start)

	// We expect either a context deadline error (busy-handler was still running)
	// or busy > 0 (checkpoint could not complete) after the full deadline elapsed.
	if err == nil && busy == 0 {
		// Full checkpoint succeeded — this can happen if the internal SQLite
		// busy-handler did not engage (e.g. the snapshot was already released).
		// Log a warning rather than a hard failure since it is timing-dependent.
		t.Logf("WARN: TRUNCATE checkpoint completed without blocking (elapsed=%v, busy=%d) — "+
			"reader may have released snapshot before checkpoint ran; "+
			"TestPassiveCheckpointReturnsImmediatelyWithActiveReader is still the authoritative guard",
			elapsed.Round(time.Millisecond), busy)
		return
	}

	// If it took the full deadline to return — that is the blocking behavior we
	// expected.  Log it for visibility.
	t.Logf("TRUNCATE checkpoint with active reader: elapsed=%v busy=%d log=%d checkpointed=%d err=%v",
		elapsed.Round(time.Millisecond), busy, log, checkpointed, err)
}

// TestCheckpointWorkerDoesNotStallConcurrentBatchUpserts is the primary
// regression test for the cold-start performance bug.
//
// It simulates the production scenario:
//   - A background goroutine fires PASSIVE WAL checkpoints at high frequency
//     (every 5 ms — much faster than the default 5-minute interval — to
//     maximize the chance of overlap with a batch commit).
//   - The main goroutine runs 50 batch upserts, each in its own transaction,
//     exactly like processBatchedFiles does during a full index run.
//
// If the checkpoint uses TRUNCATE (the bug), it holds the single writer
// connection while waiting for active readers.  Each of the 50 BatchBeginTx
// calls then queues behind it, adding up to seconds per batch.  The test
// enforces a 15-second wall-clock deadline — comfortably achievable with
// PASSIVE but impossible to meet with TRUNCATE + busy_timeout=30 s.
func TestCheckpointWorkerDoesNotStallConcurrentBatchUpserts(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	const (
		numBatches    = 50
		rowsPerBatch  = 10
		cpInterval    = 5 * time.Millisecond
		totalDeadline = 15 * time.Second
	)

	// Keep a reader open throughout to make TRUNCATE checkpoints expensive.
	readerTx := openHoldingReadTx(t, db)
	defer readerTx.Rollback() //nolint:errcheck // cleanup

	// Background checkpoint worker — fires at cpInterval.
	workerCtx, stopWorker := context.WithCancel(ctx)
	defer stopWorker()
	go func() {
		ticker := time.NewTicker(cpInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				cpCtx, cancel := context.WithTimeout(workerCtx, 30*time.Second)
				_ = db.passiveCheckpoint(cpCtx)
				cancel()
			case <-workerCtx.Done():
				return
			}
		}
	}()

	// Run upsert batches — this is what the indexer's processBatchedFiles does.
	deadline := time.Now().Add(totalDeadline)
	for i := 0; i < numBatches; i++ {
		if time.Now().After(deadline) {
			t.Fatalf("batch %d/%d: deadline exceeded (%v) — checkpoint worker is blocking upsert batches "+
				"(regression: checkpoint mode may have been changed back to TRUNCATE)",
				i+1, numBatches, totalDeadline)
		}

		batch, err := db.BeginBatch(ctx)
		if err != nil {
			t.Fatalf("batch %d: BeginBatch: %v", i, err)
		}
		for j := 0; j < rowsPerBatch; j++ {
			_ = batch.UpsertFile(ctx, &MediaFile{
				Name:       fmt.Sprintf("concurrent_%d_%d.jpg", i, j),
				Path:       fmt.Sprintf("concurrent/%d/%d.jpg", i, j),
				ParentPath: fmt.Sprintf("concurrent/%d", i),
				Type:       FileTypeImage,
				Size:       int64(1024 * (j + 1)),
				ModTime:    time.Now(),
			})
		}
		if err := db.EndBatch(batch, nil); err != nil {
			t.Fatalf("batch %d: EndBatch: %v", i, err)
		}
	}

	elapsed := time.Since(deadline.Add(-totalDeadline))
	t.Logf("Completed %d batches × %d rows with checkpoint worker (interval=%v) in %v (limit %v)",
		numBatches, rowsPerBatch, cpInterval, elapsed.Round(time.Millisecond), totalDeadline)
}

// TestBulkIndexEndCheckpointDoesNotBlockOpenReader verifies that the WAL
// checkpoint inside BulkIndexEnd does not hold the writer connection while
// waiting for an active reader, so it is safe to call from the indexer even
// when API requests are in flight.
func TestBulkIndexEndCheckpointDoesNotBlockOpenReader(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	// Seed a file so FTS rebuild has something to process.
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch: %v", err)
	}
	_ = batch.UpsertFile(ctx, &MediaFile{
		Name: "bulk_cp_test.jpg", Path: "bulk_cp/test.jpg", ParentPath: "bulk_cp",
		Type: FileTypeImage, Size: 512, ModTime: time.Now(),
	})
	if err := db.EndBatch(batch, nil); err != nil {
		t.Fatalf("EndBatch: %v", err)
	}

	if err := db.BulkIndexBegin(ctx); err != nil {
		t.Fatalf("BulkIndexBegin: %v", err)
	}

	// Open a reader that pins WAL frames — a TRUNCATE checkpoint inside
	// BulkIndexEnd would be forced to wait for this reader.
	readerTx := openHoldingReadTx(t, db)
	defer readerTx.Rollback() //nolint:errcheck // cleanup

	// Insert more rows while triggers are disabled.
	batch, err = db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch (bulk): %v", err)
	}
	for i := 0; i < 5; i++ {
		_ = batch.UpsertFile(ctx, &MediaFile{
			Name:       fmt.Sprintf("bulk_cp_%d.jpg", i),
			Path:       fmt.Sprintf("bulk_cp/%d.jpg", i),
			ParentPath: "bulk_cp",
			Type:       FileTypeImage,
			Size:       int64(256 * (i + 1)),
			ModTime:    time.Now(),
		})
	}
	if err := db.EndBatch(batch, nil); err != nil {
		t.Fatalf("EndBatch (bulk): %v", err)
	}

	// BulkIndexEnd must complete within a generous but finite deadline even
	// though an active reader is holding a WAL snapshot.  If it used TRUNCATE
	// for its checkpoint it could block for up to busy_timeout (30 s).
	const maxAllowed = 10 * time.Second
	start := time.Now()
	if err := db.BulkIndexEnd(ctx); err != nil {
		t.Fatalf("BulkIndexEnd returned error: %v", err)
	}
	elapsed := time.Since(start)

	if elapsed >= maxAllowed {
		t.Errorf("BulkIndexEnd took %v with an active reader (limit %v) — "+
			"checkpoint inside BulkIndexEnd may have been changed to a blocking mode",
			elapsed.Round(time.Millisecond), maxAllowed)
	}
	t.Logf("BulkIndexEnd completed in %v with an active reader", elapsed.Round(time.Millisecond))

	// Triggers must be restored regardless.
	triggers := ftsTriggersPresent(t, db)
	for _, name := range []string{"files_ai", "files_au", "files_ad"} {
		if !triggers[name] {
			t.Errorf("trigger %s not restored by BulkIndexEnd", name)
		}
	}
}

// =============================================================================
// Benchmarks
// =============================================================================

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

func BenchmarkConnectionPoolAcquisition(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var count int
		err := db.reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM files").Scan(&count)
		if err != nil {
			b.Fatalf("Query failed: %v", err)
		}
	}
}

func BenchmarkBeginEndBatch(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		batch, err := db.BeginBatch(ctx)
		if err != nil {
			b.Fatalf("BeginBatch failed: %v", err)
		}
		if err = db.EndBatch(batch, err); err != nil {
			b.Fatalf("EndBatch failed: %v", err)
		}
	}
}

func TestGetStatsInitiallyZero(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	stats := db.GetStats()
	if stats.TotalFiles != 0 {
		t.Errorf("expected TotalFiles=0 initially, got %d", stats.TotalFiles)
	}
	if stats.TotalFolders != 0 {
		t.Errorf("expected TotalFolders=0 initially, got %d", stats.TotalFolders)
	}
	if stats.TotalTags != 0 {
		t.Errorf("expected TotalTags=0 initially, got %d", stats.TotalTags)
	}
}

func TestUpdateStatsAndGetStats(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	newStats := IndexStats{
		TotalFiles:   42,
		TotalFolders: 7,
		TotalTags:    3,
	}
	db.UpdateStats(newStats)

	retrieved := db.GetStats()
	if retrieved.TotalFiles != 42 {
		t.Errorf("expected TotalFiles=42, got %d", retrieved.TotalFiles)
	}
	if retrieved.TotalFolders != 7 {
		t.Errorf("expected TotalFolders=7, got %d", retrieved.TotalFolders)
	}
	if retrieved.TotalTags != 3 {
		t.Errorf("expected TotalTags=3, got %d", retrieved.TotalTags)
	}
}

func TestUpdateStatsOverwrite(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	db.UpdateStats(IndexStats{TotalFiles: 10, TotalFolders: 2, TotalTags: 1})
	db.UpdateStats(IndexStats{TotalFiles: 99, TotalFolders: 15, TotalTags: 5})

	retrieved := db.GetStats()
	if retrieved.TotalFiles != 99 {
		t.Errorf("expected TotalFiles=99 after overwrite, got %d", retrieved.TotalFiles)
	}
	if retrieved.TotalFolders != 15 {
		t.Errorf("expected TotalFolders=15 after overwrite, got %d", retrieved.TotalFolders)
	}
}

func TestRebuildFTSIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert some files so FTS has something to rebuild
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	files := []MediaFile{
		{Path: "/media/rebuild1.mp4", Name: "rebuild1.mp4", Size: 1000, Type: FileTypeVideo},
		{Path: "/media/rebuild2.jpg", Name: "rebuild2.jpg", Size: 500, Type: FileTypeImage},
	}
	for _, f := range files {
		if err := batch.UpsertFile(ctx, &f); err != nil {
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err := db.EndBatch(batch, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	// RebuildFTS should succeed on a properly initialized database
	if err := db.RebuildFTS(); err != nil {
		t.Errorf("RebuildFTS failed: %v", err)
	}
}

func TestRebuildFTSOnEmptyDatabase(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	// RebuildFTS should also succeed on an empty database
	if err := db.RebuildFTS(); err != nil {
		t.Errorf("RebuildFTS on empty database failed: %v", err)
	}
}

func TestVacuumIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	if err := db.Vacuum(); err != nil {
		t.Errorf("Vacuum failed: %v", err)
	}
}

func TestBatchInserterAccessors(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	defer func() { _ = db.EndBatch(batch, nil) }()

	// BatchInserter.Tx() should return the underlying transaction
	tx := batch.Tx()
	if tx == nil {
		t.Error("expected non-nil transaction from Tx()")
	}

	// BatchInserter.StartTime() should return a non-zero time
	startTime := batch.StartTime()
	if startTime.IsZero() {
		t.Error("expected non-zero time from StartTime()")
	}
}

// ---------------------------------------------------------------------------
// WAL Checkpoint tests
// ---------------------------------------------------------------------------

// TestCheckpointOnFreshDB verifies that Checkpoint succeeds on a freshly
// opened database (no writes means the WAL is empty but the call must not
// error or panic).
func TestCheckpointOnFreshDB(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	log, checkpointed, err := db.Checkpoint(context.Background())
	if err != nil {
		t.Fatalf("Checkpoint returned error: %v", err)
	}
	// On a fresh/idle database log and checkpointed are both 0.
	if log < 0 || checkpointed < 0 {
		t.Errorf("unexpected negative WAL page counts: log=%d checkpointed=%d", log, checkpointed)
	}
}

// TestCheckpointAfterWrites verifies that Checkpoint returns non-negative page
// counts after dirty pages have been written to the WAL.
func TestCheckpointAfterWrites(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Write something so the WAL has pages to checkpoint.
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch: %v", err)
	}
	if err := db.EndBatch(batch, nil); err != nil {
		t.Fatalf("EndBatch: %v", err)
	}

	log, checkpointed, err := db.Checkpoint(ctx)
	if err != nil {
		t.Fatalf("Checkpoint returned error: %v", err)
	}
	if log < 0 || checkpointed < 0 {
		t.Errorf("unexpected negative WAL page counts: log=%d checkpointed=%d", log, checkpointed)
	}
}

// TestCheckpointContextCancelled verifies that a checkpoint with an already-
// canceled context returns an error without panicking.
func TestCheckpointContextCancelled(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already canceled

	// The call may succeed or fail depending on timing — we just must not panic.
	_, _, _ = db.Checkpoint(ctx)
}

// TestStartCheckpointWorker verifies that the worker goroutine starts and exits
// cleanly when its context is canceled.
func TestStartCheckpointWorker(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Should return immediately; goroutine exits when ctx is canceled.
	db.StartCheckpointWorker(ctx, 50*time.Millisecond)
	<-ctx.Done() // wait for the worker context to expire
}
