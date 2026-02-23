package database

import (
	"context"
	"fmt"
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

	tx, _ := db.BeginBatch(ctx)
	for _, f := range files {
		file := &MediaFile{
			Name:       f.path[len("/movies/"):],
			Path:       f.path,
			ParentPath: "/movies",
			Type:       FileTypeVideo,
			Size:       1024,
			ModTime:    time.Now(),
		}
		_ = db.UpsertFile(ctx, tx, file)
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
	tx, _ := db.BeginBatch(ctx)
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
		_ = db.UpsertFile(ctx, tx, file)
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

func TestGetAllTagsWithCountsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Add tags to files
	_ = db.AddTagToFile(ctx, "/test/file1.mp4", "action")
	_ = db.AddTagToFile(ctx, "/test/file2.mp4", "action")
	_ = db.AddTagToFile(ctx, "/test/file3.mp4", "comedy")
	_ = db.AddTagToFile(ctx, "/test/file1.mp4", "thriller")

	// Get all tags with counts
	tags, err := db.GetAllTagsWithCounts(ctx)
	if err != nil {
		t.Fatalf("GetAllTagsWithCounts failed: %v", err)
	}

	if len(tags) != 3 {
		t.Fatalf("Expected 3 tags, got %d", len(tags))
	}

	// Verify sorting (by count desc, then name)
	// action: 2, comedy: 1, thriller: 1
	if tags[0].Name != "action" || tags[0].Count != 2 {
		t.Errorf("Expected first tag to be 'action' with count 2, got '%s' with count %d", tags[0].Name, tags[0].Count)
	}

	// Check that all tags have correct structure
	for _, tag := range tags {
		if tag.Name == "" {
			t.Error("Tag name should not be empty")
		}
		if tag.Count < 0 {
			t.Errorf("Tag count should not be negative, got %d", tag.Count)
		}
	}
}

func TestGetUnusedTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Create tags with and without file associations
	_ = db.AddTagToFile(ctx, "/test/file1.mp4", "used")
	tag, _ := db.GetOrCreateTag(ctx, "unused1")
	if tag == nil {
		t.Fatal("Failed to create unused1 tag")
	}
	tag2, _ := db.GetOrCreateTag(ctx, "unused2")
	if tag2 == nil {
		t.Fatal("Failed to create unused2 tag")
	}

	// Get unused tags
	unusedTags, err := db.GetUnusedTags(ctx)
	if err != nil {
		t.Fatalf("GetUnusedTags failed: %v", err)
	}

	// Should have 2 unused tags
	if len(unusedTags) != 2 {
		t.Fatalf("Expected 2 unused tags, got %d", len(unusedTags))
	}

	// Verify unused tags are in the list
	hasUnused1 := false
	hasUnused2 := false
	hasUsed := false

	for _, tagName := range unusedTags {
		if tagName == "unused1" {
			hasUnused1 = true
		}
		if tagName == "unused2" {
			hasUnused2 = true
		}
		if tagName == "used" {
			hasUsed = true
		}
	}

	if !hasUnused1 || !hasUnused2 {
		t.Error("Expected both unused1 and unused2 in unused tags list")
	}

	if hasUsed {
		t.Error("Used tag should not be in unused tags list")
	}
}

func TestRenameTagEverywhereIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Test case 1: Simple rename
	t.Run("Simple rename", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/rename1.mp4", "oldtag")
		_ = db.AddTagToFile(ctx, "/test/rename2.mp4", "oldtag")

		count, err := db.RenameTagEverywhere(ctx, "oldtag", "newtag")
		if err != nil {
			t.Fatalf("RenameTagEverywhere failed: %v", err)
		}

		if count != 2 {
			t.Errorf("Expected 2 affected files, got %d", count)
		}

		// Verify old tag is gone
		tags, _ := db.GetFileTags(ctx, "/test/rename1.mp4")
		if len(tags) != 1 || tags[0] != "newtag" {
			t.Errorf("Expected file to have tag 'newtag', got %v", tags)
		}

		// Verify all files have new tag
		allTags, _ := db.GetAllTagsWithCounts(ctx)
		foundNew := false
		foundOld := false
		for _, tag := range allTags {
			if tag.Name == "newtag" {
				foundNew = true
			}
			if tag.Name == "oldtag" {
				foundOld = true
			}
		}

		if !foundNew {
			t.Error("New tag name should exist")
		}
		if foundOld {
			t.Error("Old tag name should not exist")
		}
	})

	// Test case 2: Case-only change
	t.Run("Case-only change", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/case1.mp4", "animal")

		count, err := db.RenameTagEverywhere(ctx, "animal", "Animal")
		if err != nil {
			t.Fatalf("RenameTagEverywhere case change failed: %v", err)
		}

		if count != 1 {
			t.Errorf("Expected 1 affected file, got %d", count)
		}

		// Verify case has changed
		tags, _ := db.GetFileTags(ctx, "/test/case1.mp4")
		if len(tags) != 1 || tags[0] != "Animal" {
			t.Errorf("Expected file to have tag 'Animal', got %v", tags)
		}
	})

	// Test case 3: Merge tags
	t.Run("Merge tags", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/merge1.mp4", "tag1")
		_ = db.AddTagToFile(ctx, "/test/merge2.mp4", "tag2")

		// Rename tag1 to tag2 (should merge)
		count, err := db.RenameTagEverywhere(ctx, "tag1", "tag2")
		if err != nil {
			t.Fatalf("RenameTagEverywhere merge failed: %v", err)
		}

		if count != 2 {
			t.Errorf("Expected 2 affected files after merge, got %d", count)
		}

		// Verify both files have tag2
		tags1, _ := db.GetFileTags(ctx, "/test/merge1.mp4")
		tags2, _ := db.GetFileTags(ctx, "/test/merge2.mp4")

		if len(tags1) != 1 || tags1[0] != "tag2" {
			t.Errorf("Expected merge1 to have tag 'tag2', got %v", tags1)
		}
		if len(tags2) != 1 || tags2[0] != "tag2" {
			t.Errorf("Expected merge2 to have tag 'tag2', got %v", tags2)
		}

		// Verify tag1 no longer exists
		allTags, _ := db.GetAllTagsWithCounts(ctx)
		for _, tag := range allTags {
			if tag.Name == "tag1" {
				t.Error("tag1 should have been deleted after merge")
			}
		}
	})

	// Test case 4: Same name (no-op)
	t.Run("Same name no-op", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/same.mp4", "sametag")

		count, err := db.RenameTagEverywhere(ctx, "sametag", "sametag")
		if err != nil {
			t.Fatalf("RenameTagEverywhere same name failed: %v", err)
		}

		if count != 0 {
			t.Errorf("Expected 0 affected files for same name, got %d", count)
		}
	})

	// Test case 5: Empty names
	t.Run("Empty names validation", func(t *testing.T) {
		_, err := db.RenameTagEverywhere(ctx, "", "newname")
		if err == nil {
			t.Error("Expected error for empty old name")
		}

		_, err = db.RenameTagEverywhere(ctx, "oldname", "")
		if err == nil {
			t.Error("Expected error for empty new name")
		}
	})
}

func TestDeleteTagEverywhereIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Test case 1: Delete tag with file associations
	t.Run("Delete tag with files", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/del1.mp4", "deleteme")
		_ = db.AddTagToFile(ctx, "/test/del2.mp4", "deleteme")
		_ = db.AddTagToFile(ctx, "/test/del3.mp4", "deleteme")

		count, err := db.DeleteTagEverywhere(ctx, "deleteme")
		if err != nil {
			t.Fatalf("DeleteTagEverywhere failed: %v", err)
		}

		if count != 3 {
			t.Errorf("Expected 3 affected files, got %d", count)
		}

		// Verify tag is deleted
		tags, _ := db.GetFileTags(ctx, "/test/del1.mp4")
		if len(tags) != 0 {
			t.Errorf("Expected file to have no tags, got %v", tags)
		}

		// Verify tag doesn't exist in database
		allTags, _ := db.GetAllTagsWithCounts(ctx)
		for _, tag := range allTags {
			if tag.Name == "deleteme" {
				t.Error("Deleted tag should not exist in database")
			}
		}
	})

	// Test case 2: Delete unused tag
	t.Run("Delete unused tag", func(t *testing.T) {
		tag, _ := db.GetOrCreateTag(ctx, "unuseddelete")
		if tag == nil {
			t.Fatal("Failed to create tag")
		}

		count, err := db.DeleteTagEverywhere(ctx, "unuseddelete")
		if err != nil {
			t.Fatalf("DeleteTagEverywhere unused failed: %v", err)
		}

		if count != 0 {
			t.Errorf("Expected 0 affected files for unused tag, got %d", count)
		}

		// Verify tag is deleted
		allTags, _ := db.GetAllTagsWithCounts(ctx)
		for _, tag := range allTags {
			if tag.Name == "unuseddelete" {
				t.Error("Unused tag should be deleted")
			}
		}
	})

	// Test case 3: Delete non-existent tag
	t.Run("Delete non-existent tag", func(t *testing.T) {
		_, err := db.DeleteTagEverywhere(ctx, "nonexistent")
		if err == nil {
			t.Error("Expected error when deleting non-existent tag")
		}
	})

	// Test case 4: Empty tag name
	t.Run("Empty tag name validation", func(t *testing.T) {
		_, err := db.DeleteTagEverywhere(ctx, "")
		if err == nil {
			t.Error("Expected error for empty tag name")
		}
	})

	// Test case 5: Case-insensitive deletion
	t.Run("Case-insensitive deletion", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/delcase.mp4", "MixedCase")

		count, err := db.DeleteTagEverywhere(ctx, "mixedcase")
		if err != nil {
			t.Fatalf("DeleteTagEverywhere case-insensitive failed: %v", err)
		}

		if count != 1 {
			t.Errorf("Expected 1 affected file, got %d", count)
		}

		// Verify tag is deleted
		tags, _ := db.GetFileTags(ctx, "/test/delcase.mp4")
		if len(tags) != 0 {
			t.Errorf("Expected file to have no tags after deletion, got %v", tags)
		}
	})
}

// Add to tags_integration_test.go

func TestBuildPlaceholders(t *testing.T) {
	tests := []struct {
		name           string
		values         []string
		expectedClause string
		expectedArgs   int
	}{
		{
			name:           "Multiple values",
			values:         []string{"/path/a", "/path/b", "/path/c"},
			expectedClause: "?,?,?",
			expectedArgs:   3,
		},
		{
			name:           "Single value",
			values:         []string{"/path/a"},
			expectedClause: "?",
			expectedArgs:   1,
		},
		{
			name:           "Empty slice",
			values:         []string{},
			expectedClause: "",
			expectedArgs:   0,
		},
		{
			name:           "Nil slice",
			values:         nil,
			expectedClause: "",
			expectedArgs:   0,
		},
		{
			name:           "Skips empty strings",
			values:         []string{"/path/a", "", "/path/b", ""},
			expectedClause: "?,?",
			expectedArgs:   2,
		},
		{
			name:           "All empty strings",
			values:         []string{"", "", ""},
			expectedClause: "",
			expectedArgs:   0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clause, args := buildPlaceholders(tt.values)
			if clause != tt.expectedClause {
				t.Errorf("Expected clause %q, got %q", tt.expectedClause, clause)
			}
			if len(args) != tt.expectedArgs {
				t.Errorf("Expected %d args, got %d", tt.expectedArgs, len(args))
			}
		})
	}
}

func TestBulkAddTagsToFilesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	t.Run("Add multiple tags to multiple files", func(t *testing.T) {
		paths := []string{"/test/bulk1.mp4", "/test/bulk2.mp4", "/test/bulk3.mp4"}
		tagNames := []string{"action", "thriller"}

		count, errs, err := db.BulkAddTagsToFiles(ctx, paths, tagNames)
		if err != nil {
			t.Fatalf("BulkAddTagsToFiles failed: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no per-file errors, got %v", errs)
		}
		if count != 3 {
			t.Errorf("Expected 3 successful files, got %d", count)
		}

		// Verify each file has both tags
		for _, path := range paths {
			tags, err := db.GetFileTags(ctx, path)
			if err != nil {
				t.Fatalf("GetFileTags failed for %s: %v", path, err)
			}
			if len(tags) != 2 {
				t.Errorf("Expected 2 tags for %s, got %d: %v", path, len(tags), tags)
			}
		}
	})

	t.Run("Empty tag names", func(t *testing.T) {
		count, errs, err := db.BulkAddTagsToFiles(ctx, []string{"/test/empty.mp4"}, []string{})
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no errors, got %v", errs)
		}
		if count != 0 {
			t.Errorf("Expected 0 successful files, got %d", count)
		}
	})

	t.Run("Empty file paths", func(t *testing.T) {
		count, errs, err := db.BulkAddTagsToFiles(ctx, []string{}, []string{"tag1"})
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no errors, got %v", errs)
		}
		if count != 0 {
			t.Errorf("Expected 0 successful files, got %d", count)
		}
	})

	t.Run("Skips blank tag names and file paths", func(t *testing.T) {
		paths := []string{"/test/skipblank.mp4", "", "/test/skipblank2.mp4"}
		tagNames := []string{"valid", "", "  ", "alsovalid"}

		count, errs, err := db.BulkAddTagsToFiles(ctx, paths, tagNames)
		if err != nil {
			t.Fatalf("BulkAddTagsToFiles failed: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no per-file errors, got %v", errs)
		}
		if count != 2 {
			t.Errorf("Expected 2 successful files (blank path skipped), got %d", count)
		}

		tags, _ := db.GetFileTags(ctx, "/test/skipblank.mp4")
		if len(tags) != 2 {
			t.Errorf("Expected 2 tags (blank/whitespace skipped), got %d: %v", len(tags), tags)
		}
	})

	t.Run("Idempotent - duplicate adds do not error", func(t *testing.T) {
		paths := []string{"/test/idempotent.mp4"}
		tagNames := []string{"repeat"}

		_, _, err := db.BulkAddTagsToFiles(ctx, paths, tagNames)
		if err != nil {
			t.Fatalf("First BulkAddTagsToFiles failed: %v", err)
		}

		// Add the same tag again
		count, errs, err := db.BulkAddTagsToFiles(ctx, paths, tagNames)
		if err != nil {
			t.Fatalf("Second BulkAddTagsToFiles failed: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no errors on duplicate add, got %v", errs)
		}
		if count != 1 {
			t.Errorf("Expected 1 successful file, got %d", count)
		}

		// Should still have only one instance of the tag
		tags, _ := db.GetFileTags(ctx, "/test/idempotent.mp4")
		if len(tags) != 1 {
			t.Errorf("Expected 1 tag after duplicate add, got %d", len(tags))
		}
	})

	t.Run("Creates tags that do not yet exist", func(t *testing.T) {
		paths := []string{"/test/newtag.mp4"}
		tagNames := []string{"brandnewtag"}

		_, _, err := db.BulkAddTagsToFiles(ctx, paths, tagNames)
		if err != nil {
			t.Fatalf("BulkAddTagsToFiles failed: %v", err)
		}

		// Verify tag was created
		allTags, _ := db.GetAllTagsWithCounts(ctx)
		found := false
		for _, tag := range allTags {
			if tag.Name == "brandnewtag" {
				found = true
				if tag.Count != 1 {
					t.Errorf("Expected count 1 for new tag, got %d", tag.Count)
				}
			}
		}
		if !found {
			t.Error("Expected 'brandnewtag' to exist in all tags")
		}
	})
}

func TestBulkRemoveTagsFromFilesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	t.Run("Remove multiple tags from multiple files", func(t *testing.T) {
		// Setup: add tags to files
		paths := []string{"/test/bulkrm1.mp4", "/test/bulkrm2.mp4"}
		_ = db.AddTagToFile(ctx, paths[0], "rmtag1")
		_ = db.AddTagToFile(ctx, paths[0], "rmtag2")
		_ = db.AddTagToFile(ctx, paths[0], "keeptag")
		_ = db.AddTagToFile(ctx, paths[1], "rmtag1")
		_ = db.AddTagToFile(ctx, paths[1], "rmtag2")

		count, errs, err := db.BulkRemoveTagsFromFiles(ctx, paths, []string{"rmtag1", "rmtag2"})
		if err != nil {
			t.Fatalf("BulkRemoveTagsFromFiles failed: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no per-file errors, got %v", errs)
		}
		if count != 2 {
			t.Errorf("Expected 2 files with removals, got %d", count)
		}

		// Verify rmtag1 and rmtag2 are gone, keeptag remains
		tags, _ := db.GetFileTags(ctx, paths[0])
		if len(tags) != 1 || tags[0] != "keeptag" {
			t.Errorf("Expected only 'keeptag' to remain, got %v", tags)
		}

		tags, _ = db.GetFileTags(ctx, paths[1])
		if len(tags) != 0 {
			t.Errorf("Expected no tags remaining, got %v", tags)
		}
	})

	t.Run("Empty tag names", func(t *testing.T) {
		count, errs, err := db.BulkRemoveTagsFromFiles(ctx, []string{"/test/x.mp4"}, []string{})
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no errors, got %v", errs)
		}
		if count != 0 {
			t.Errorf("Expected 0, got %d", count)
		}
	})

	t.Run("Non-existent tags are silently skipped", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/skipnonexist.mp4", "exists")

		count, errs, err := db.BulkRemoveTagsFromFiles(
			ctx,
			[]string{"/test/skipnonexist.mp4"},
			[]string{"doesnotexist", "alsomissing"},
		)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no errors, got %v", errs)
		}
		if count != 0 {
			t.Errorf("Expected 0 removals (tags don't exist), got %d", count)
		}

		// Original tag should still be there
		tags, _ := db.GetFileTags(ctx, "/test/skipnonexist.mp4")
		if len(tags) != 1 || tags[0] != "exists" {
			t.Errorf("Expected 'exists' tag to remain, got %v", tags)
		}
	})

	t.Run("Remove from file that does not have the tag", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/notag.mp4", "othertag")

		count, errs, err := db.BulkRemoveTagsFromFiles(
			ctx,
			[]string{"/test/notag.mp4"},
			[]string{"othertag"},
		)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no errors, got %v", errs)
		}
		if count != 1 {
			t.Errorf("Expected 1 file with removal, got %d", count)
		}
	})

	t.Run("Skips blank paths and tag names", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/blankskip.mp4", "blanktag")

		count, errs, err := db.BulkRemoveTagsFromFiles(
			ctx,
			[]string{"/test/blankskip.mp4", ""},
			[]string{"blanktag", "", "  "},
		)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if len(errs) != 0 {
			t.Errorf("Expected no errors, got %v", errs)
		}
		if count != 1 {
			t.Errorf("Expected 1 file with removal, got %d", count)
		}

		tags, _ := db.GetFileTags(ctx, "/test/blankskip.mp4")
		if len(tags) != 0 {
			t.Errorf("Expected no tags after removal, got %v", tags)
		}
	})
}

func TestGetBatchFileTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	t.Run("Multiple files with various tags", func(t *testing.T) {
		// Setup
		_ = db.AddTagToFile(ctx, "/test/batch1.mp4", "action")
		_ = db.AddTagToFile(ctx, "/test/batch1.mp4", "thriller")
		_ = db.AddTagToFile(ctx, "/test/batch2.mp4", "comedy")
		_ = db.AddTagToFile(ctx, "/test/batch3.mp4", "action")
		// batch4 has no tags

		paths := []string{"/test/batch1.mp4", "/test/batch2.mp4", "/test/batch3.mp4", "/test/batch4.mp4"}
		result, err := db.GetBatchFileTags(ctx, paths)
		if err != nil {
			t.Fatalf("GetBatchFileTags failed: %v", err)
		}

		// All requested paths should be present in the result
		if len(result) != 4 {
			t.Errorf("Expected 4 entries in result, got %d", len(result))
		}

		// batch1 should have 2 tags
		if len(result["/test/batch1.mp4"]) != 2 {
			t.Errorf("Expected 2 tags for batch1, got %d: %v",
				len(result["/test/batch1.mp4"]), result["/test/batch1.mp4"])
		}

		// batch2 should have 1 tag
		if len(result["/test/batch2.mp4"]) != 1 || result["/test/batch2.mp4"][0] != "comedy" {
			t.Errorf("Expected ['comedy'] for batch2, got %v", result["/test/batch2.mp4"])
		}

		// batch3 should have 1 tag
		if len(result["/test/batch3.mp4"]) != 1 || result["/test/batch3.mp4"][0] != "action" {
			t.Errorf("Expected ['action'] for batch3, got %v", result["/test/batch3.mp4"])
		}

		// batch4 should have empty slice (not nil)
		tags4 := result["/test/batch4.mp4"]
		if tags4 == nil {
			t.Error("Expected empty slice for batch4, got nil")
		}
		if len(tags4) != 0 {
			t.Errorf("Expected 0 tags for batch4, got %d: %v", len(tags4), tags4)
		}
	})

	t.Run("Empty file paths", func(t *testing.T) {
		result, err := db.GetBatchFileTags(ctx, []string{})
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if len(result) != 0 {
			t.Errorf("Expected empty result, got %d entries", len(result))
		}
	})

	t.Run("Nil file paths", func(t *testing.T) {
		result, err := db.GetBatchFileTags(ctx, nil)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if len(result) != 0 {
			t.Errorf("Expected empty result, got %d entries", len(result))
		}
	})

	t.Run("Skips blank paths", func(t *testing.T) {
		_ = db.AddTagToFile(ctx, "/test/batchblank.mp4", "sometag")

		result, err := db.GetBatchFileTags(ctx, []string{"/test/batchblank.mp4", "", ""})
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		// Should only have the non-blank path
		if len(result) != 1 {
			t.Errorf("Expected 1 entry (blanks skipped), got %d", len(result))
		}
		if len(result["/test/batchblank.mp4"]) != 1 {
			t.Errorf("Expected 1 tag, got %v", result["/test/batchblank.mp4"])
		}
	})

	t.Run("Consistent with GetFileTags", func(t *testing.T) {
		// Verify batch results match individual lookups
		_ = db.AddTagToFile(ctx, "/test/consistent1.mp4", "alpha")
		_ = db.AddTagToFile(ctx, "/test/consistent1.mp4", "beta")
		_ = db.AddTagToFile(ctx, "/test/consistent2.mp4", "gamma")

		paths := []string{"/test/consistent1.mp4", "/test/consistent2.mp4"}

		batchResult, err := db.GetBatchFileTags(ctx, paths)
		if err != nil {
			t.Fatalf("GetBatchFileTags failed: %v", err)
		}

		for _, path := range paths {
			individual, err := db.GetFileTags(ctx, path)
			if err != nil {
				t.Fatalf("GetFileTags failed for %s: %v", path, err)
			}

			batchTags := batchResult[path]
			if len(batchTags) != len(individual) {
				t.Errorf("Mismatch for %s: batch=%v, individual=%v", path, batchTags, individual)
				continue
			}
			for i, tag := range individual {
				if batchTags[i] != tag {
					t.Errorf("Tag mismatch for %s at index %d: batch=%s, individual=%s",
						path, i, batchTags[i], tag)
				}
			}
		}
	})

	t.Run("Large batch", func(t *testing.T) {
		// Test with a larger number of files to exercise the IN clause
		paths := make([]string, 50)
		for i := 0; i < 50; i++ {
			path := fmt.Sprintf("/test/largebatch_%03d.mp4", i)
			paths[i] = path
			if i%3 == 0 {
				_ = db.AddTagToFile(ctx, path, "batchlabel")
			}
		}

		result, err := db.GetBatchFileTags(ctx, paths)
		if err != nil {
			t.Fatalf("GetBatchFileTags failed for large batch: %v", err)
		}

		if len(result) != 50 {
			t.Errorf("Expected 50 entries, got %d", len(result))
		}

		// Verify files at index 0, 3, 6, ... have the tag
		taggedCount := 0
		for _, path := range paths {
			if len(result[path]) > 0 {
				taggedCount++
			}
		}

		// Indices 0,3,6,...,48 → 17 files
		expectedTagged := 17
		if taggedCount != expectedTagged {
			t.Errorf("Expected %d tagged files, got %d", expectedTagged, taggedCount)
		}
	})
}

func TestBulkOperationsInteractionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	t.Run("Bulk add then bulk remove", func(t *testing.T) {
		paths := []string{"/test/interact1.mp4", "/test/interact2.mp4"}

		// Bulk add
		_, _, err := db.BulkAddTagsToFiles(ctx, paths, []string{"x", "y", "z"})
		if err != nil {
			t.Fatalf("BulkAddTagsToFiles failed: %v", err)
		}

		// Verify via batch get
		result, err := db.GetBatchFileTags(ctx, paths)
		if err != nil {
			t.Fatalf("GetBatchFileTags failed: %v", err)
		}
		for _, path := range paths {
			if len(result[path]) != 3 {
				t.Errorf("Expected 3 tags for %s, got %d", path, len(result[path]))
			}
		}

		// Bulk remove only "x" and "z"
		count, _, err := db.BulkRemoveTagsFromFiles(ctx, paths, []string{"x", "z"})
		if err != nil {
			t.Fatalf("BulkRemoveTagsFromFiles failed: %v", err)
		}
		if count != 2 {
			t.Errorf("Expected 2 files with removals, got %d", count)
		}

		// Verify only "y" remains
		result, _ = db.GetBatchFileTags(ctx, paths)
		for _, path := range paths {
			if len(result[path]) != 1 || result[path][0] != "y" {
				t.Errorf("Expected only ['y'] for %s, got %v", path, result[path])
			}
		}
	})

	t.Run("Bulk add interacts with single-file operations", func(t *testing.T) {
		// Add a tag via single-file API
		_ = db.AddTagToFile(ctx, "/test/mixed.mp4", "single")

		// Add more tags via bulk API
		_, _, err := db.BulkAddTagsToFiles(ctx, []string{"/test/mixed.mp4"}, []string{"bulk1", "bulk2"})
		if err != nil {
			t.Fatalf("BulkAddTagsToFiles failed: %v", err)
		}

		tags, _ := db.GetFileTags(ctx, "/test/mixed.mp4")
		if len(tags) != 3 {
			t.Errorf("Expected 3 tags, got %d: %v", len(tags), tags)
		}

		// Remove one via single-file API
		_ = db.RemoveTagFromFile(ctx, "/test/mixed.mp4", "single")

		tags, _ = db.GetFileTags(ctx, "/test/mixed.mp4")
		if len(tags) != 2 {
			t.Errorf("Expected 2 tags after single remove, got %d: %v", len(tags), tags)
		}
	})
}
