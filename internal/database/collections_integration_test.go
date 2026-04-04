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
