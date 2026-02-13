package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/media"
	"media-viewer/internal/transcoder"
)

// BenchmarkGetStatsEndpoint benchmarks the /api/stats endpoint performance
func BenchmarkGetStatsEndpoint(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	cacheDir := filepath.Join(tmpDir, "cache")
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, true, db, time.Hour, nil)
	trans := transcoder.New(cacheDir, "", true, "none")

	handlers := &Handlers{
		db:         db,
		mediaDir:   mediaDir,
		thumbGen:   thumbGen,
		transcoder: trans,
		indexer:    nil,
		cacheDir:   cacheDir,
	}

	// Create some test data
	tx, _ := db.BeginBatch()
	for i := 0; i < 100; i++ {
		file := database.MediaFile{
			Name:       "test.jpg",
			Path:       "test.jpg",
			ParentPath: "",
			Type:       database.FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		}
		db.UpsertFile(tx, &file)
	}
	db.EndBatch(tx, nil)

	// Update stats
	stats := database.IndexStats{
		TotalFiles:   100,
		TotalFolders: 10,
		TotalImages:  60,
		TotalVideos:  40,
	}
	db.UpdateStats(stats)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/stats", http.NoBody)
		w := httptest.NewRecorder()
		handlers.GetStats(w, req)

		if w.Code != http.StatusOK {
			b.Fatalf("Expected status 200, got %d", w.Code)
		}
	}
}

// BenchmarkListFilesEndpoint benchmarks the /api/files endpoint performance
func BenchmarkListFilesEndpoint(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	cacheDir := filepath.Join(tmpDir, "cache")
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, true, db, time.Hour, nil)
	trans := transcoder.New(cacheDir, "", true, "none")

	handlers := &Handlers{
		db:         db,
		mediaDir:   mediaDir,
		thumbGen:   thumbGen,
		transcoder: trans,
		indexer:    nil,
		cacheDir:   cacheDir,
	}

	// Create test directory structure with many folders
	tx, _ := db.BeginBatch()

	// Add 100 folders
	for i := 0; i < 100; i++ {
		folder := database.MediaFile{
			Name:       "folder",
			Path:       "folder",
			ParentPath: "",
			Type:       database.FileTypeFolder,
			Size:       0,
			ModTime:    time.Now(),
		}
		db.UpsertFile(tx, &folder)

		// Add files to each folder
		for j := 0; j < 50; j++ {
			file := database.MediaFile{
				Name:       "file.jpg",
				Path:       filepath.Join("folder", "file.jpg"),
				ParentPath: "folder",
				Type:       database.FileTypeImage,
				Size:       1024 * 1024,
				ModTime:    time.Now(),
				MimeType:   "image/jpeg",
			}
			db.UpsertFile(tx, &file)
		}
	}
	db.EndBatch(tx, nil)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/files", http.NoBody)
		w := httptest.NewRecorder()
		handlers.ListFiles(w, req)

		if w.Code != http.StatusOK {
			b.Fatalf("Expected status 200, got %d", w.Code)
		}
	}
}

// BenchmarkGetMediaFilesEndpoint benchmarks the /api/media endpoint performance
func BenchmarkGetMediaFilesEndpoint(b *testing.B) {
	tmpDir := b.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	cacheDir := filepath.Join(tmpDir, "cache")
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, true, db, time.Hour, nil)
	trans := transcoder.New(cacheDir, "", true, "none")

	handlers := &Handlers{
		db:         db,
		mediaDir:   mediaDir,
		thumbGen:   thumbGen,
		transcoder: trans,
		indexer:    nil,
		cacheDir:   cacheDir,
	}

	// Create test files with tags and favorites
	ctx := context.Background()
	tx, _ := db.BeginBatch()

	for i := 0; i < 1000; i++ {
		file := database.MediaFile{
			Name:       "photo.jpg",
			Path:       "photo.jpg",
			ParentPath: "",
			Type:       database.FileTypeImage,
			Size:       1024 * 1024 * 5,
			ModTime:    time.Now(),
			MimeType:   "image/jpeg",
		}
		db.UpsertFile(tx, &file)
	}
	db.EndBatch(tx, nil)

	// Add some tags and favorites
	tagName := "test"
	db.GetOrCreateTag(ctx, tagName)
	for i := 0; i < 200; i++ {
		db.AddTagToFile(ctx, "photo.jpg", tagName)
		if i%10 == 0 {
			db.AddFavorite(ctx, "photo.jpg", "photo.jpg", database.FileTypeImage)
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/media", http.NoBody)
		w := httptest.NewRecorder()
		handlers.GetMediaFiles(w, req)

		if w.Code != http.StatusOK {
			b.Fatalf("Expected status 200, got %d", w.Code)
		}
	}
}

// BenchmarkGetMediaFilesEndpoint_LargeDirectory benchmarks with a very large directory
func BenchmarkGetMediaFilesEndpoint_LargeDirectory(b *testing.B) {
	if testing.Short() {
		b.Skip("skipping large directory benchmark in short mode")
	}

	tmpDir := b.TempDir()
	mediaDir := filepath.Join(tmpDir, "media")
	cacheDir := filepath.Join(tmpDir, "cache")
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := database.New(context.Background(), dbPath)
	if err != nil {
		b.Fatalf("Failed to create database: %v", err)
	}
	defer db.Close()

	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, true, db, time.Hour, nil)
	trans := transcoder.New(cacheDir, "", true, "none")

	handlers := &Handlers{
		db:         db,
		mediaDir:   mediaDir,
		thumbGen:   thumbGen,
		transcoder: trans,
		indexer:    nil,
		cacheDir:   cacheDir,
	}

	// Create 14,000 files to simulate user's use case
	ctx := context.Background()
	tx, _ := db.BeginBatch()

	for i := 0; i < 14000; i++ {
		file := database.MediaFile{
			Name:       "photo.jpg",
			Path:       "photo.jpg",
			ParentPath: "",
			Type:       database.FileTypeImage,
			Size:       1024 * 1024 * 5,
			ModTime:    time.Now(),
			MimeType:   "image/jpeg",
		}
		db.UpsertFile(tx, &file)
	}
	db.EndBatch(tx, nil)

	// Add some tags and favorites (realistic ratio)
	tagName := "vacation"
	db.GetOrCreateTag(ctx, tagName)
	for i := 0; i < 1000; i++ {
		db.AddTagToFile(ctx, "photo.jpg", tagName)
		if i%20 == 0 {
			db.AddFavorite(ctx, "photo.jpg", "photo.jpg", database.FileTypeImage)
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/media", http.NoBody)
		w := httptest.NewRecorder()
		handlers.GetMediaFiles(w, req)

		if w.Code != http.StatusOK {
			b.Fatalf("Expected status 200, got %d", w.Code)
		}
	}
}
