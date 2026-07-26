package database

import (
	"context"
	"testing"
	"time"
)

func TestGetSniffCache(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	modTime := time.Now().Truncate(time.Second)

	files := []MediaFile{
		{Name: "photo.jpg", Path: "path/photo.jpg", ParentPath: "path", Type: FileTypeImage,
			Size: 1024, ModTime: modTime, MimeType: "image/jpeg"},
		{Name: "clip.jpg", Path: "path/clip.jpg", ParentPath: "path", Type: FileTypeVideo,
			Size: 2048, ModTime: modTime, MimeType: "video/mp4"},
		{Name: "subfolder", Path: "path/subfolder", ParentPath: "path", Type: FileTypeFolder,
			Size: 0, ModTime: modTime},
		{Name: "playlist.wpl", Path: "path/playlist.wpl", ParentPath: "path", Type: FileTypePlaylist,
			Size: 512, ModTime: modTime},
	}

	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}
	for i := range files {
		if err := tx.UpsertFile(ctx, &files[i]); err != nil {
			t.Fatalf("UpsertFile failed: %v", err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}

	cache, err := db.GetSniffCache(ctx)
	if err != nil {
		t.Fatalf("GetSniffCache failed: %v", err)
	}

	// Only images and videos can be the result of a content sniff; folders and
	// playlists are never sniffed and would only bloat the map.
	if len(cache) != 2 {
		t.Errorf("cache holds %d entries, want 2 (images and videos only)", len(cache))
	}
	if _, ok := cache["path/subfolder"]; ok {
		t.Error("folders must not appear in the sniff cache")
	}
	if _, ok := cache["path/playlist.wpl"]; ok {
		t.Error("playlists must not appear in the sniff cache")
	}

	got, ok := cache["path/clip.jpg"]
	if !ok {
		t.Fatal("missing entry for path/clip.jpg")
	}
	if got.Size != 2048 {
		t.Errorf("Size = %d, want 2048", got.Size)
	}
	if !got.ModTime.Equal(modTime) {
		t.Errorf("ModTime = %v, want %v", got.ModTime, modTime)
	}
	if got.Type != FileTypeVideo {
		t.Errorf("Type = %s, want %s — the stored sniff override must round-trip", got.Type, FileTypeVideo)
	}
	if got.MimeType != "video/mp4" {
		t.Errorf("MimeType = %s, want video/mp4", got.MimeType)
	}
}

func TestGetSniffCacheEmptyDatabase(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	cache, err := db.GetSniffCache(context.Background())
	if err != nil {
		t.Fatalf("GetSniffCache failed: %v", err)
	}
	if len(cache) != 0 {
		t.Errorf("cache holds %d entries, want 0", len(cache))
	}
}
