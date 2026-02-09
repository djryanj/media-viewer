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
