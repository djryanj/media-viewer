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
		_ = tx.UpsertFile(ctx, file)
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

func TestGetFavoritesThumbnailURLIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	items := []struct {
		path     string
		name     string
		fileType FileType
	}{
		{"photos/sunset.jpg", "sunset.jpg", FileTypeImage},
		{"videos/clip.mp4", "clip.mp4", FileTypeVideo},
		{"albums/vacation", "vacation", FileTypeFolder},
		{"playlists/mix.m3u8", "mix.m3u8", FileTypePlaylist},
	}

	tx, _ := db.BeginBatch(ctx)
	for _, item := range items {
		file := &MediaFile{
			Name:       item.name,
			Path:       item.path,
			ParentPath: "",
			Type:       item.fileType,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = tx.UpsertFile(ctx, file)
	}
	_ = db.EndBatch(tx, nil)

	for _, item := range items {
		if err := db.AddFavorite(ctx, item.path, item.name, item.fileType); err != nil {
			t.Fatalf("AddFavorite failed for %s: %v", item.path, err)
		}
	}

	favs, err := db.GetFavorites(ctx)
	if err != nil {
		t.Fatalf("GetFavorites failed: %v", err)
	}

	byPath := make(map[string]MediaFile)
	for _, f := range favs {
		byPath[f.Path] = f
	}

	// Images and videos must have a thumbnail URL.
	if byPath["photos/sunset.jpg"].ThumbnailURL == "" {
		t.Error("expected ThumbnailURL for image favorite, got empty string")
	}
	if byPath["videos/clip.mp4"].ThumbnailURL == "" {
		t.Error("expected ThumbnailURL for video favorite, got empty string")
	}
	// Folders must now also have a thumbnail URL (for the favorites strip).
	if byPath["albums/vacation"].ThumbnailURL == "" {
		t.Error("expected ThumbnailURL for folder favorite, got empty string")
	}
	// Playlists should not have a thumbnail URL.
	if byPath["playlists/mix.m3u8"].ThumbnailURL != "" {
		t.Errorf("expected no ThumbnailURL for playlist favorite, got %q", byPath["playlists/mix.m3u8"].ThumbnailURL)
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

func TestAddFavoritePositionAutoIncrementIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add three favorites sequentially and verify ascending positions.
	paths := []string{"/a/first.jpg", "/b/second.jpg", "/c/third.jpg"}
	for i, p := range paths {
		if err := db.AddFavorite(ctx, p, "file.jpg", FileTypeImage); err != nil {
			t.Fatalf("AddFavorite[%d] failed: %v", i, err)
		}
	}

	var positions []int
	rows, err := db.writer.QueryContext(ctx, "SELECT position FROM favorites ORDER BY position ASC")
	if err != nil {
		t.Fatalf("query positions: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var pos int
		if err := rows.Scan(&pos); err != nil {
			t.Fatalf("scan: %v", err)
		}
		positions = append(positions, pos)
	}

	if len(positions) != 3 {
		t.Fatalf("expected 3 positions, got %d", len(positions))
	}
	for i, pos := range positions {
		if pos != i {
			t.Errorf("positions[%d] = %d, want %d", i, pos, i)
		}
	}
}

func TestReorderFavoritesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	files := []struct {
		path string
		name string
	}{
		{"/movies/alpha.mp4", "alpha.mp4"},
		{"/photos/beta.jpg", "beta.jpg"},
		{"/photos/gamma.jpg", "gamma.jpg"},
	}

	// Insert into files table (required for the INNER JOIN in getFavorites).
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch: %v", err)
	}
	for _, f := range files {
		_ = tx.UpsertFile(ctx, &MediaFile{
			Name: f.name, Path: f.path, ParentPath: "/",
			Type: FileTypeImage, Size: 100, ModTime: time.Now(),
		})
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch: %v", err)
	}

	// Add favorites in alpha, beta, gamma order.
	for _, f := range files {
		if err := db.AddFavorite(ctx, f.path, f.name, FileTypeImage); err != nil {
			t.Fatalf("AddFavorite %s: %v", f.path, err)
		}
	}

	// Reorder to gamma, alpha, beta.
	newOrder := []string{"/photos/gamma.jpg", "/movies/alpha.mp4", "/photos/beta.jpg"}
	if err := db.ReorderFavorites(ctx, newOrder); err != nil {
		t.Fatalf("ReorderFavorites: %v", err)
	}

	// GetFavorites must return them in the new order.
	favs, err := db.GetFavorites(ctx)
	if err != nil {
		t.Fatalf("GetFavorites: %v", err)
	}
	if len(favs) != 3 {
		t.Fatalf("expected 3 favorites, got %d", len(favs))
	}
	for i, want := range newOrder {
		if favs[i].Path != want {
			t.Errorf("favs[%d].Path = %q, want %q", i, favs[i].Path, want)
		}
	}
}

func TestReorderFavoritesEmptySliceIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// ReorderFavorites with an empty slice must be a no-op (no error).
	if err := db.ReorderFavorites(ctx, nil); err != nil {
		t.Errorf("ReorderFavorites(nil) should not error, got %v", err)
	}
	if err := db.ReorderFavorites(ctx, []string{}); err != nil {
		t.Errorf("ReorderFavorites([]) should not error, got %v", err)
	}
}

func TestReorderFavoritesPartialSliceIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add 3 favorites with positions 0,1,2.
	for i, p := range []string{"/a.jpg", "/b.jpg", "/c.jpg"} {
		if err := db.AddFavorite(ctx, p, p, FileTypeImage); err != nil {
			t.Fatalf("AddFavorite[%d]: %v", i, err)
		}
	}

	// Reorder only two of the three; the third retains its existing position.
	// Passing unknown paths must not return an error.
	if err := db.ReorderFavorites(ctx, []string{"/c.jpg", "/a.jpg"}); err != nil {
		t.Fatalf("ReorderFavorites: %v", err)
	}

	rows, err := db.writer.QueryContext(ctx, "SELECT path, position FROM favorites ORDER BY position ASC")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	posMap := map[string]int{}
	for rows.Next() {
		var path string
		var pos int
		_ = rows.Scan(&path, &pos)
		posMap[path] = pos
	}

	if posMap["/c.jpg"] != 0 {
		t.Errorf("/c.jpg position = %d, want 0", posMap["/c.jpg"])
	}
	if posMap["/a.jpg"] != 1 {
		t.Errorf("/a.jpg position = %d, want 1", posMap["/a.jpg"])
	}
}
