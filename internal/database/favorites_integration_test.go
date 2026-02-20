package database

import (
	"context"
	"testing"
	"time"
)

func TestAddFavoriteIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	err := db.AddFavorite(ctx, "/test/video.mp4", "video.mp4", FileTypeVideo)
	if err != nil {
		t.Fatalf("AddFavorite failed: %v", err)
	}

	// Verify it's a favorite
	if !db.IsFavorite(ctx, "/test/video.mp4") {
		t.Error("File should be marked as favorite")
	}

	// Adding same favorite again should not error
	err = db.AddFavorite(ctx, "/test/video.mp4", "video.mp4", FileTypeVideo)
	if err != nil {
		t.Errorf("Adding duplicate favorite failed: %v", err)
	}
}

func TestRemoveFavoriteIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add a favorite
	err := db.AddFavorite(ctx, "/test/image.jpg", "image.jpg", FileTypeImage)
	if err != nil {
		t.Fatalf("AddFavorite failed: %v", err)
	}

	// Remove it
	err = db.RemoveFavorite(ctx, "/test/image.jpg")
	if err != nil {
		t.Fatalf("RemoveFavorite failed: %v", err)
	}

	// Verify it's not a favorite
	if db.IsFavorite(ctx, "/test/image.jpg") {
		t.Error("File should not be marked as favorite")
	}

	// Removing non-existent favorite should not error
	err = db.RemoveFavorite(ctx, "/test/nonexistent.jpg")
	if err != nil {
		t.Errorf("Removing non-existent favorite failed: %v", err)
	}
}

func TestIsFavoriteIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Non-existent file should not be favorite
	if db.IsFavorite(ctx, "/test/nonexistent.jpg") {
		t.Error("Non-existent file should not be favorite")
	}

	// Add favorite
	err := db.AddFavorite(ctx, "/test/doc.pdf", "doc.pdf", FileTypeVideo)
	if err != nil {
		t.Fatalf("AddFavorite failed: %v", err)
	}

	// Should be favorite now
	if !db.IsFavorite(ctx, "/test/doc.pdf") {
		t.Error("File should be marked as favorite")
	}
}

func TestGetFavoritesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Define favorites
	favorites := []struct {
		path     string
		name     string
		fileType FileType
	}{
		{"/movies/action.mp4", "action.mp4", FileTypeVideo},
		{"/photos/sunset.jpg", "sunset.jpg", FileTypeImage},
		{"/docs/report.pdf", "report.pdf", FileTypeVideo},
	}

	// Insert files first
	tx, _ := db.BeginBatch(ctx)
	for _, fav := range favorites {
		file := &MediaFile{
			Name:       fav.name,
			Path:       fav.path,
			ParentPath: fav.path[:len(fav.path)-len(fav.name)-1],
			Type:       fav.fileType,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(ctx, tx, file)
	}
	_ = db.EndBatch(tx, nil)

	// Add favorites
	for _, fav := range favorites {
		err := db.AddFavorite(ctx, fav.path, fav.name, fav.fileType)
		if err != nil {
			t.Fatalf("AddFavorite failed for %s: %v", fav.path, err)
		}
	}

	// Get all favorites
	favs, err := db.GetFavorites(ctx)
	if err != nil {
		t.Fatalf("GetFavorites failed: %v", err)
	}

	if len(favs) != 3 {
		t.Errorf("Expected 3 favorites, got %d", len(favs))
	}

	// Verify paths
	paths := make(map[string]bool)
	for _, f := range favs {
		paths[f.Path] = true
	}

	for _, fav := range favorites {
		if !paths[fav.path] {
			t.Errorf("Expected favorite %s not found", fav.path)
		}
	}
}

func TestGetFavoritesEmptyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	favs, err := db.GetFavorites(ctx)
	if err != nil {
		t.Fatalf("GetFavorites failed: %v", err)
	}

	if len(favs) != 0 {
		t.Errorf("Expected 0 favorites, got %d", len(favs))
	}
}

func TestGetFavoriteCountIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Initially should be 0
	count := db.GetFavoriteCount(ctx)
	if count != 0 {
		t.Errorf("Expected 0 favorites, got %d", count)
	}

	// Add some favorites
	for i := 1; i <= 5; i++ {
		path := "/test/file" + string(rune('0'+i)) + ".jpg"
		err := db.AddFavorite(ctx, path, "file.jpg", FileTypeImage)
		if err != nil {
			t.Fatalf("AddFavorite failed: %v", err)
		}
	}

	// Should be 5 now
	count = db.GetFavoriteCount(ctx)
	if count != 5 {
		t.Errorf("Expected 5 favorites, got %d", count)
	}

	// Remove one
	err := db.RemoveFavorite(ctx, "/test/file1.jpg")
	if err != nil {
		t.Fatalf("RemoveFavorite failed: %v", err)
	}

	// Should be 4 now
	count = db.GetFavoriteCount(ctx)
	if count != 4 {
		t.Errorf("Expected 4 favorites, got %d", count)
	}
}

func TestFavoritesConcurrencyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add/remove favorites concurrently
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(id int) {
			path := "/test/concurrent" + string(rune('0'+id)) + ".jpg"
			_ = db.AddFavorite(ctx, path, "file.jpg", FileTypeImage)
			_ = db.IsFavorite(ctx, path)
			_ = db.RemoveFavorite(ctx, path)
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// All should be removed
	count := db.GetFavoriteCount(ctx)
	if count != 0 {
		t.Errorf("Expected 0 favorites after concurrent operations, got %d", count)
	}
}
