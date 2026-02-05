package database

import (
	"context"
	"testing"
	"time"
)

func TestGetOrCreateTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create a new tag
	tag, err := db.GetOrCreateTag(ctx, "Action")
	if err != nil {
		t.Fatalf("GetOrCreateTag failed: %v", err)
	}

	if tag.Name != "Action" {
		t.Errorf("Expected tag name 'Action', got %s", tag.Name)
	}

	if tag.ID == 0 {
		t.Error("Expected non-zero tag ID")
	}

	// Get the same tag again (should return existing)
	tag2, err := db.GetOrCreateTag(ctx, "Action")
	if err != nil {
		t.Fatalf("GetOrCreateTag failed on second call: %v", err)
	}

	if tag2.ID != tag.ID {
		t.Errorf("Expected same tag ID %d, got %d", tag.ID, tag2.ID)
	}
}

func TestAddTagToFileIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add tag to file
	err := db.AddTagToFile(ctx, "/test/video.mp4", "action")
	if err != nil {
		t.Fatalf("AddTagToFile failed: %v", err)
	}

	// Get tags for file
	tags, err := db.GetFileTags(ctx, "/test/video.mp4")
	if err != nil {
		t.Fatalf("GetFileTags failed: %v", err)
	}

	if len(tags) != 1 {
		t.Fatalf("Expected 1 tag, got %d", len(tags))
	}

	if tags[0] != "action" {
		t.Errorf("Expected tag 'action', got %s", tags[0])
	}

	// Add same tag again (should not error or duplicate)
	err = db.AddTagToFile(ctx, "/test/video.mp4", "action")
	if err != nil {
		t.Errorf("Adding duplicate tag failed: %v", err)
	}

	tags, _ = db.GetFileTags(ctx, "/test/video.mp4")
	if len(tags) != 1 {
		t.Errorf("Expected 1 tag after duplicate add, got %d", len(tags))
	}
}

func TestRemoveTagFromFileIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add tags
	_ = db.AddTagToFile(ctx, "/test/video.mp4", "action")
	_ = db.AddTagToFile(ctx, "/test/video.mp4", "thriller")

	// Remove one tag
	err := db.RemoveTagFromFile(ctx, "/test/video.mp4", "action")
	if err != nil {
		t.Fatalf("RemoveTagFromFile failed: %v", err)
	}

	// Verify only thriller remains
	tags, err := db.GetFileTags(ctx, "/test/video.mp4")
	if err != nil {
		t.Fatalf("GetFileTags failed: %v", err)
	}

	if len(tags) != 1 {
		t.Fatalf("Expected 1 tag, got %d", len(tags))
	}

	if tags[0] != "thriller" {
		t.Errorf("Expected tag 'thriller', got %s", tags[0])
	}

	// Remove non-existent tag (should not error)
	err = db.RemoveTagFromFile(ctx, "/test/video.mp4", "nonexistent")
	if err != nil {
		t.Errorf("Removing non-existent tag failed: %v", err)
	}
}

func TestGetFileTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// File with no tags
	tags, err := db.GetFileTags(ctx, "/test/notags.mp4")
	if err != nil {
		t.Fatalf("GetFileTags failed: %v", err)
	}

	if len(tags) != 0 {
		t.Errorf("Expected 0 tags, got %d", len(tags))
	}

	// Add multiple tags
	_ = db.AddTagToFile(ctx, "/test/movie.mp4", "action")
	_ = db.AddTagToFile(ctx, "/test/movie.mp4", "thriller")
	_ = db.AddTagToFile(ctx, "/test/movie.mp4", "2024")

	tags, err = db.GetFileTags(ctx, "/test/movie.mp4")
	if err != nil {
		t.Fatalf("GetFileTags failed: %v", err)
	}

	if len(tags) != 3 {
		t.Errorf("Expected 3 tags, got %d", len(tags))
	}
}

func TestSetFileTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add initial tags
	_ = db.AddTagToFile(ctx, "/test/video.mp4", "old1")
	_ = db.AddTagToFile(ctx, "/test/video.mp4", "old2")

	// Set new tags (should replace all existing)
	newTags := []string{"new1", "new2", "new3"}
	err := db.SetFileTags(ctx, "/test/video.mp4", newTags)
	if err != nil {
		t.Fatalf("SetFileTags failed: %v", err)
	}

	// Verify tags were replaced
	tags, err := db.GetFileTags(ctx, "/test/video.mp4")
	if err != nil {
		t.Fatalf("GetFileTags failed: %v", err)
	}

	if len(tags) != 3 {
		t.Errorf("Expected 3 tags, got %d", len(tags))
	}

	// Verify old tags are gone
	for _, tag := range tags {
		if tag == "old1" || tag == "old2" {
			t.Errorf("Old tag %s should have been removed", tag)
		}
	}

	// Set empty tags (should remove all)
	err = db.SetFileTags(ctx, "/test/video.mp4", []string{})
	if err != nil {
		t.Fatalf("SetFileTags with empty array failed: %v", err)
	}

	tags, _ = db.GetFileTags(ctx, "/test/video.mp4")
	if len(tags) != 0 {
		t.Errorf("Expected 0 tags after clearing, got %d", len(tags))
	}
}

func TestGetAllTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Initially empty
	tags, err := db.GetAllTags(ctx)
	if err != nil {
		t.Fatalf("GetAllTags failed: %v", err)
	}

	if len(tags) != 0 {
		t.Errorf("Expected 0 tags initially, got %d", len(tags))
	}

	// Add tags to files
	_ = db.AddTagToFile(ctx, "/test/file1.mp4", "action")
	_ = db.AddTagToFile(ctx, "/test/file2.mp4", "action")
	_ = db.AddTagToFile(ctx, "/test/file3.mp4", "comedy")
	_ = db.AddTagToFile(ctx, "/test/file4.mp4", "drama")

	tags, err = db.GetAllTags(ctx)
	if err != nil {
		t.Fatalf("GetAllTags failed: %v", err)
	}

	if len(tags) != 3 {
		t.Errorf("Expected 3 unique tags, got %d", len(tags))
	}

	// Verify action tag has count of 2
	for _, tag := range tags {
		if tag.Name == "action" && tag.ItemCount != 2 {
			t.Errorf("Expected action tag to have ItemCount=2, got %d", tag.ItemCount)
		}
		if tag.Name == "comedy" && tag.ItemCount != 1 {
			t.Errorf("Expected comedy tag to have ItemCount=1, got %d", tag.ItemCount)
		}
	}
}

func TestGetFilesByTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert files first
	files := []struct {
		path string
		tag  string
	}{
		{"/movies/action1.mp4", "action"},
		{"/movies/action2.mp4", "action"},
		{"/movies/comedy.mp4", "comedy"},
	}

	tx, _ := db.BeginBatch()
	for _, f := range files {
		file := &MediaFile{
			Name:       f.path[len("/movies/"):],
			Path:       f.path,
			ParentPath: "/movies",
			Type:       FileTypeVideo,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(tx, file)
	}
	_ = db.EndBatch(tx, nil)

	// Add tags to files
	for _, f := range files {
		_ = db.AddTagToFile(ctx, f.path, f.tag)
	}

	// Get files by tag
	result, err := db.GetFilesByTag(ctx, "action", 1, 10)
	if err != nil {
		t.Fatalf("GetFilesByTag failed: %v", err)
	}

	if result.TotalItems != 2 {
		t.Errorf("Expected 2 files with 'action' tag, got %d", result.TotalItems)
	}

	if len(result.Items) != 2 {
		t.Errorf("Expected 2 results, got %d", len(result.Items))
	}

	// Get files by non-existent tag
	result, err = db.GetFilesByTag(ctx, "nonexistent", 1, 10)
	if err != nil {
		t.Fatalf("GetFilesByTag failed for non-existent tag: %v", err)
	}

	if result.TotalItems != 0 {
		t.Errorf("Expected 0 files with 'nonexistent' tag, got %d", result.TotalItems)
	}
}

func TestGetFilesByTagPaginationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Insert 15 files first
	tx, _ := db.BeginBatch()
	for i := 1; i <= 15; i++ {
		path := "/test/file" + string(rune('0'+i)) + ".mp4"
		file := &MediaFile{
			Name:       "file" + string(rune('0'+i)) + ".mp4",
			Path:       path,
			ParentPath: "/test",
			Type:       FileTypeVideo,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(tx, file)
	}
	_ = db.EndBatch(tx, nil)

	// Add tags to all files
	for i := 1; i <= 15; i++ {
		path := "/test/file" + string(rune('0'+i)) + ".mp4"
		_ = db.AddTagToFile(ctx, path, "popular")
	}

	// Page 1 (10 items)
	result, err := db.GetFilesByTag(ctx, "popular", 1, 10)
	if err != nil {
		t.Fatalf("GetFilesByTag page 1 failed: %v", err)
	}

	if result.TotalItems != 15 {
		t.Errorf("Expected total=15, got %d", result.TotalItems)
	}

	if len(result.Items) != 10 {
		t.Errorf("Expected 10 results on page 1, got %d", len(result.Items))
	}

	if result.Page != 1 {
		t.Errorf("Expected page=1, got %d", result.Page)
	}

	// Page 2 (5 items)
	result, err = db.GetFilesByTag(ctx, "popular", 2, 10)
	if err != nil {
		t.Fatalf("GetFilesByTag page 2 failed: %v", err)
	}

	if len(result.Items) != 5 {
		t.Errorf("Expected 5 results on page 2, got %d", len(result.Items))
	}

	if result.Page != 2 {
		t.Errorf("Expected page=2, got %d", result.Page)
	}
}

func TestDeleteTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add tag to multiple files
	_ = db.AddTagToFile(ctx, "/test/file1.mp4", "todelete")
	_ = db.AddTagToFile(ctx, "/test/file2.mp4", "todelete")

	// Verify tag exists
	tags, _ := db.GetAllTags(ctx)
	if len(tags) != 1 || tags[0].Name != "todelete" {
		t.Fatal("Tag was not created properly")
	}

	// Delete the tag
	err := db.DeleteTag(ctx, "todelete")
	if err != nil {
		t.Fatalf("DeleteTag failed: %v", err)
	}

	// Verify tag is gone
	tags, _ = db.GetAllTags(ctx)
	if len(tags) != 0 {
		t.Errorf("Expected 0 tags after deletion, got %d", len(tags))
	}

	// Verify files have no tags
	fileTags, _ := db.GetFileTags(ctx, "/test/file1.mp4")
	if len(fileTags) != 0 {
		t.Errorf("Expected file to have 0 tags after tag deletion, got %d", len(fileTags))
	}

	// Delete non-existent tag (should not error)
	err = db.DeleteTag(ctx, "nonexistent")
	if err != nil {
		t.Errorf("Deleting non-existent tag failed: %v", err)
	}
}

func TestRenameTagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add tag to files
	_ = db.AddTagToFile(ctx, "/test/file1.mp4", "oldname")
	_ = db.AddTagToFile(ctx, "/test/file2.mp4", "oldname")

	// Rename the tag
	err := db.RenameTag(ctx, "oldname", "newname")
	if err != nil {
		t.Fatalf("RenameTag failed: %v", err)
	}

	// Verify old name is gone
	tags, _ := db.GetAllTags(ctx)
	for _, tag := range tags {
		if tag.Name == "oldname" {
			t.Error("Old tag name should not exist")
		}
		if tag.Name == "newname" && tag.ItemCount != 2 {
			t.Errorf("Expected newname tag to have ItemCount=2, got %d", tag.ItemCount)
		}
	}

	// Verify files have new tag name
	fileTags, _ := db.GetFileTags(ctx, "/test/file1.mp4")
	if len(fileTags) != 1 || fileTags[0] != "newname" {
		t.Errorf("Expected file to have tag 'newname', got %v", fileTags)
	}
}

func TestTagsConcurrencyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add/remove tags concurrently
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() { done <- true }()

			path := "/test/concurrent" + string(rune('0'+id)) + ".mp4"
			tagName := "tag" + string(rune('0'+id))

			err := db.AddTagToFile(ctx, path, tagName)
			if err != nil {
				return
			}

			_, _ = db.GetFileTags(ctx, path)

			err = db.RemoveTagFromFile(ctx, path, tagName)
			if err != nil {
				return
			}
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// All tag associations should be removed (tags may still exist but with ItemCount=0)
	tags, _ := db.GetAllTags(ctx)
	for _, tag := range tags {
		if tag.ItemCount != 0 {
			t.Errorf("Expected tag %s to have ItemCount=0, got %d", tag.Name, tag.ItemCount)
		}
	}
}
