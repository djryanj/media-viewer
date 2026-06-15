package database

import (
	"context"
	"errors"
	"testing"
	"time"
)

func seedCollectionTestFiles(t *testing.T, db *Database, files []MediaFile) {
	t.Helper()

	ctx := context.Background()
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch failed: %v", err)
	}

	var upsertErr error
	for i := range files {
		if err := batch.UpsertFile(ctx, &files[i]); err != nil {
			upsertErr = err
			break
		}
	}

	if err := db.EndBatch(batch, upsertErr); err != nil {
		t.Fatalf("EndBatch failed: %v", err)
	}
}

func TestCollectionsAreFolderScoped(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	seedCollectionTestFiles(t, db, []MediaFile{
		{
			Name:       "a1.jpg",
			Path:       "folder-a/a1.jpg",
			ParentPath: "folder-a",
			Type:       FileTypeImage,
			ModTime:    time.Now(),
		},
		{
			Name:       "a2.jpg",
			Path:       "folder-a/a2.jpg",
			ParentPath: "folder-a",
			Type:       FileTypeImage,
			ModTime:    time.Now(),
		},
		{
			Name:       "b1.jpg",
			Path:       "folder-b/b1.jpg",
			ParentPath: "folder-b",
			Type:       FileTypeImage,
			ModTime:    time.Now(),
		},
	})

	ctx := context.Background()

	trip, err := db.CreateCollection(ctx, "Trip", []string{"folder-a/a1.jpg"}, stringPtr("folder-a"))
	if err != nil {
		t.Fatalf("CreateCollection failed: %v", err)
	}
	if trip.FolderPath == nil || *trip.FolderPath != "folder-a" {
		t.Fatalf("expected folder-a scope, got %#v", trip.FolderPath)
	}

	_, err = db.CreateCollection(ctx, "Trip", []string{"folder-b/b1.jpg"}, stringPtr("folder-b"))
	if !errors.Is(err, ErrCollectionNameInUse) {
		t.Fatalf("expected ErrCollectionNameInUse, got %v", err)
	}

	err = db.AddItemsToCollection(ctx, trip.ID, []string{"folder-b/b1.jpg"})
	if !errors.Is(err, ErrCollectionFolderConflict) {
		t.Fatalf("expected ErrCollectionFolderConflict, got %v", err)
	}

	err = db.AddItemsToCollection(ctx, trip.ID, []string{"folder-a/a2.jpg"})
	if err != nil {
		t.Fatalf("AddItemsToCollection same-folder failed: %v", err)
	}

	items, err := db.GetCollectionItems(ctx, trip.ID)
	if err != nil {
		t.Fatalf("GetCollectionItems failed: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items after same-folder add, got %d", len(items))
	}

	collections, err := db.GetCollections(ctx)
	if err != nil {
		t.Fatalf("GetCollections failed: %v", err)
	}
	if len(collections) != 1 {
		t.Fatalf("expected 1 collection, got %d", len(collections))
	}
	if collections[0].FolderPath == nil || *collections[0].FolderPath != "folder-a" {
		t.Fatalf("expected folder-a from GetCollections, got %#v", collections[0].FolderPath)
	}
}

func TestEmptyCollectionsKeepTheirCreationFolderScope(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	seedCollectionTestFiles(t, db, []MediaFile{
		{
			Name:       "a1.jpg",
			Path:       "folder-a/a1.jpg",
			ParentPath: "folder-a",
			Type:       FileTypeImage,
			ModTime:    time.Now(),
		},
		{
			Name:       "b1.jpg",
			Path:       "folder-b/b1.jpg",
			ParentPath: "folder-b",
			Type:       FileTypeImage,
			ModTime:    time.Now(),
		},
	})

	ctx := context.Background()
	folderPath := "folder-a"
	empty, err := db.CreateCollection(ctx, "Inbox", nil, &folderPath)
	if err != nil {
		t.Fatalf("CreateCollection empty failed: %v", err)
	}

	err = db.AddItemsToCollection(ctx, empty.ID, []string{"folder-b/b1.jpg"})
	if !errors.Is(err, ErrCollectionFolderConflict) {
		t.Fatalf("expected ErrCollectionFolderConflict for cross-folder add, got %v", err)
	}

	err = db.AddItemsToCollection(ctx, empty.ID, []string{"folder-a/a1.jpg"})
	if err != nil {
		t.Fatalf("AddItemsToCollection same-folder on empty collection failed: %v", err)
	}
}

func TestCreateCollectionNormalizesDuplicatePaths(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	seedCollectionTestFiles(t, db, []MediaFile{
		{
			Name:       "a1.jpg",
			Path:       "folder-a/a1.jpg",
			ParentPath: "folder-a",
			Type:       FileTypeImage,
			ModTime:    time.Now(),
		},
	})

	ctx := context.Background()
	collection, err := db.CreateCollection(ctx, "Trip", []string{"folder-a/a1.jpg", "", "folder-a/a1.jpg"}, stringPtr("folder-a"))
	if err != nil {
		t.Fatalf("CreateCollection failed: %v", err)
	}

	if collection.ItemCount != 1 {
		t.Fatalf("expected normalized item count of 1, got %d", collection.ItemCount)
	}
	if collection.CoverPath != "folder-a/a1.jpg" {
		t.Fatalf("expected cover path folder-a/a1.jpg, got %q", collection.CoverPath)
	}

	items, err := db.GetCollectionItems(ctx, collection.ID)
	if err != nil {
		t.Fatalf("GetCollectionItems failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 persisted item, got %d", len(items))
	}
}

func TestRemoveItemsFromCollectionUpdatesCover(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	seedCollectionTestFiles(t, db, []MediaFile{
		{
			Name:       "a1.jpg",
			Path:       "folder-a/a1.jpg",
			ParentPath: "folder-a",
			Type:       FileTypeImage,
			ModTime:    time.Now(),
		},
		{
			Name:       "a2.jpg",
			Path:       "folder-a/a2.jpg",
			ParentPath: "folder-a",
			Type:       FileTypeImage,
			ModTime:    time.Now(),
		},
		{
			Name:       "a3.jpg",
			Path:       "folder-a/a3.jpg",
			ParentPath: "folder-a",
			Type:       FileTypeImage,
			ModTime:    time.Now(),
		},
	})

	ctx := context.Background()
	collection, err := db.CreateCollection(ctx, "Trip", []string{"folder-a/a1.jpg", "folder-a/a2.jpg", "folder-a/a3.jpg"}, stringPtr("folder-a"))
	if err != nil {
		t.Fatalf("CreateCollection failed: %v", err)
	}

	err = db.RemoveItemsFromCollection(ctx, collection.ID, []string{"folder-a/a1.jpg", "folder-a/a2.jpg", "folder-a/a1.jpg"})
	if err != nil {
		t.Fatalf("RemoveItemsFromCollection failed: %v", err)
	}

	updated, err := db.GetCollection(ctx, collection.ID)
	if err != nil {
		t.Fatalf("GetCollection failed: %v", err)
	}
	if updated.CoverPath != "folder-a/a3.jpg" {
		t.Fatalf("expected cover to advance to folder-a/a3.jpg, got %q", updated.CoverPath)
	}
	if updated.ItemCount != 1 {
		t.Fatalf("expected item count 1 after removal, got %d", updated.ItemCount)
	}

	items, err := db.GetCollectionItems(ctx, collection.ID)
	if err != nil {
		t.Fatalf("GetCollectionItems failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 remaining item, got %d", len(items))
	}
	if items[0].Path != "folder-a/a3.jpg" {
		t.Fatalf("expected remaining path folder-a/a3.jpg, got %q", items[0].Path)
	}
}

// TestOneCollectionPerItem verifies that adding an item to a collection
// automatically removes it from any other collection it was previously in.
func TestOneCollectionPerItem(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	seedCollectionTestFiles(t, db, []MediaFile{
		{Name: "img1.jpg", Path: "photos/img1.jpg", ParentPath: "photos", Type: FileTypeImage, ModTime: time.Now()},
		{Name: "img2.jpg", Path: "photos/img2.jpg", ParentPath: "photos", Type: FileTypeImage, ModTime: time.Now()},
		{Name: "img3.jpg", Path: "photos/img3.jpg", ParentPath: "photos", Type: FileTypeImage, ModTime: time.Now()},
	})

	ctx := context.Background()

	// Create two collections in the same folder.
	colA, err := db.CreateCollection(ctx, "Alpha", []string{"photos/img1.jpg", "photos/img2.jpg"}, stringPtr("photos"))
	if err != nil {
		t.Fatalf("CreateCollection A failed: %v", err)
	}
	colB, err := db.CreateCollection(ctx, "Beta", []string{"photos/img3.jpg"}, stringPtr("photos"))
	if err != nil {
		t.Fatalf("CreateCollection B failed: %v", err)
	}

	// Move img1.jpg and img2.jpg from A into B.
	if err = db.AddItemsToCollection(ctx, colB.ID, []string{"photos/img1.jpg", "photos/img2.jpg"}); err != nil {
		t.Fatalf("AddItemsToCollection to B failed: %v", err)
	}

	// Collection A should now be empty.
	itemsA, err := db.GetCollectionItems(ctx, colA.ID)
	if err != nil {
		t.Fatalf("GetCollectionItems A failed: %v", err)
	}
	if len(itemsA) != 0 {
		t.Errorf("expected collection A to be empty after move, got %d item(s)", len(itemsA))
	}

	// Collection B should have all three items.
	itemsB, err := db.GetCollectionItems(ctx, colB.ID)
	if err != nil {
		t.Fatalf("GetCollectionItems B failed: %v", err)
	}
	if len(itemsB) != 3 {
		t.Errorf("expected 3 items in collection B, got %d", len(itemsB))
	}

	// Membership query should show each item belongs only to B.
	memberships, err := db.GetBatchCollectionMemberships(ctx, []string{"photos/img1.jpg", "photos/img2.jpg", "photos/img3.jpg"})
	if err != nil {
		t.Fatalf("GetBatchCollectionMemberships failed: %v", err)
	}
	for _, path := range []string{"photos/img1.jpg", "photos/img2.jpg", "photos/img3.jpg"} {
		ids := memberships[path]
		if len(ids) != 1 {
			t.Errorf("expected %q to be in exactly 1 collection, got %d: %v", path, len(ids), ids)
		} else if ids[0] != colB.ID {
			t.Errorf("expected %q to be in collection B (%d), got collection %d", path, colB.ID, ids[0])
		}
	}
}

// TestOneCollectionPerItemSingleFile verifies the single-file cross-collection
// constraint, and that no error is returned when re-adding to the same collection.
func TestOneCollectionPerItemSingleFile(t *testing.T) {
	db, _ := setupTestDB(t)
	defer db.Close()

	seedCollectionTestFiles(t, db, []MediaFile{
		{Name: "sole.jpg", Path: "shots/sole.jpg", ParentPath: "shots", Type: FileTypeImage, ModTime: time.Now()},
	})

	ctx := context.Background()
	col1, _ := db.CreateCollection(ctx, "One", []string{"shots/sole.jpg"}, stringPtr("shots"))
	col2, _ := db.CreateCollection(ctx, "Two", nil, stringPtr("shots"))

	// Move the item into col2.
	if err := db.AddItemsToCollection(ctx, col2.ID, []string{"shots/sole.jpg"}); err != nil {
		t.Fatalf("AddItemsToCollection failed: %v", err)
	}

	items1, _ := db.GetCollectionItems(ctx, col1.ID)
	if len(items1) != 0 {
		t.Errorf("expected col1 to be empty, got %d item(s)", len(items1))
	}

	items2, _ := db.GetCollectionItems(ctx, col2.ID)
	if len(items2) != 1 || items2[0].Path != "shots/sole.jpg" {
		t.Errorf("expected col2 to contain sole.jpg, got %v", items2)
	}

	// Re-adding to col2 should be idempotent.
	if err := db.AddItemsToCollection(ctx, col2.ID, []string{"shots/sole.jpg"}); err != nil {
		t.Errorf("re-adding to same collection should not error: %v", err)
	}
}
