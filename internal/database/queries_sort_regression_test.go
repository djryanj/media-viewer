package database

// Regression tests for sort-order correctness in ListDirectory and
// GetMediaInDirectoryPaged.
//
// Historical bug: fetchDirectoryItems used
//
//	ORDER BY f.type ASC, <sort_expr>
//
// Because 'image' < 'video' lexicographically, all images were placed before
// all videos in the result set regardless of the user-selected sort field.
// Videos were therefore never interleaved with images in the gallery when the
// "All" filter was active.
//
// The fix changed the primary sort key to
//
//	CASE WHEN f.type = 'folder' THEN 0 ELSE 1 END ASC
//
// which keeps folders first but allows images and videos to be interleaved by
// the secondary, user-selected sort expression.
//
// These tests:
//  1. Assert that images and videos are interleaved (not grouped by type) in
//     ListDirectory for every sort field and direction.
//  2. Assert that the relative order of non-folder items returned by
//     ListDirectory is identical to the order returned by
//     GetMediaInDirectoryPaged for every sort field and direction.
//     This cross-endpoint consistency check is the key regression gate: if the
//     two queries ever diverge again, the tests will fail before it becomes a
//     user-visible bug.
//  3. Assert that folders always appear before any media file regardless of
//     sort field, even when the folder name would sort after the media names.

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// sortRegressionFixtures returns a reproducible set of mixed-type files
// designed so that correct sort order requires images and videos to
// interleave.  The expected order under each sort key is:
//
//	name ASC :  a_img(image) b_vid(video) c_img(image) d_vid(video)
//	name DESC:  d_vid        c_img        b_vid        a_img
//	date ASC :  b_vid(t-4h)  a_img(t-3h)  d_vid(t-2h)  c_img(t-1h)
//	date DESC:  c_img        d_vid        a_img        b_vid
//	size ASC :  d_vid(100)   c_img(200)   b_vid(300)   a_img(400)
//	size DESC:  a_img        b_vid        c_img        d_vid
//
// Under the old (buggy) ORDER BY f.type ASC, each case would have produced
// [image, image, video, video] or [video, video, image, image] instead.
func sortRegressionFixtures(parentPath string, now time.Time) []MediaFile {
	return []MediaFile{
		// name alphabetical order: a < b < c < d
		// date order (oldest first): b < a < d < c  (b is oldest)
		// size order (smallest first): d < c < b < a
		{
			Name: "a_img.jpg", Path: parentPath + "/a_img.jpg",
			ParentPath: parentPath, Type: FileTypeImage,
			Size: 400, ModTime: now.Add(-3 * time.Hour),
		},
		{
			Name: "b_vid.mp4", Path: parentPath + "/b_vid.mp4",
			ParentPath: parentPath, Type: FileTypeVideo,
			Size: 300, ModTime: now.Add(-4 * time.Hour),
		},
		{
			Name: "c_img.jpg", Path: parentPath + "/c_img.jpg",
			ParentPath: parentPath, Type: FileTypeImage,
			Size: 200, ModTime: now.Add(-1 * time.Hour),
		},
		{
			Name: "d_vid.mp4", Path: parentPath + "/d_vid.mp4",
			ParentPath: parentPath, Type: FileTypeVideo,
			Size: 100, ModTime: now.Add(-2 * time.Hour),
		},
	}
}

// seedFiles transactionally inserts files into db and fails the test on error.
func seedFiles(ctx context.Context, t *testing.T, db *Database, files []MediaFile) {
	t.Helper()
	tx, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch: %v", err)
	}
	for i := range files {
		if err := tx.UpsertFile(ctx, &files[i]); err != nil {
			t.Fatalf("UpsertFile %s: %v", files[i].Path, err)
		}
	}
	if err := db.EndBatch(tx, nil); err != nil {
		t.Fatalf("EndBatch: %v", err)
	}
}

// pathsOf extracts the Path field from a slice of MediaFile.
func pathsOf(items []MediaFile) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.Path
	}
	return out
}

// nonFolderPaths returns paths from items that are not folders.
func nonFolderPaths(items []MediaFile) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		if it.Type != FileTypeFolder {
			out = append(out, it.Path)
		}
	}
	return out
}

// typesOf returns the Type field sequence from a slice of MediaFile,
// useful for diagnosing ordering failures.
func typesOf(items []MediaFile) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = string(it.Type)
	}
	return out
}

// TestListDirectoryInterleavesMixedMediaIntegration verifies that ListDirectory
// returns images and videos interleaved by the user-selected sort field rather
// than grouped by file type.
//
// Regression: before the fix, ORDER BY f.type ASC caused all images to appear
// before all videos (or vice versa) in every sort configuration.
func TestListDirectoryInterleavesMixedMediaIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	now := time.Now()
	const parent = "interleave"

	seedFiles(ctx, t, db, sortRegressionFixtures(parent, now))

	tests := []struct {
		sortField    SortField
		sortOrder    SortOrder
		wantPaths    []string    // expected path order for all 4 items
		wantNoBugSeq [][2]string // pairs that must NOT be adjacent with types [image,image] or [video,video] where they should be interleaved
	}{
		{
			// name ASC: a_img(I), b_vid(V), c_img(I), d_vid(V)
			sortField: SortByName,
			sortOrder: SortAsc,
			wantPaths: []string{
				parent + "/a_img.jpg",
				parent + "/b_vid.mp4",
				parent + "/c_img.jpg",
				parent + "/d_vid.mp4",
			},
		},
		{
			// name DESC: d_vid(V), c_img(I), b_vid(V), a_img(I)
			sortField: SortByName,
			sortOrder: SortDesc,
			wantPaths: []string{
				parent + "/d_vid.mp4",
				parent + "/c_img.jpg",
				parent + "/b_vid.mp4",
				parent + "/a_img.jpg",
			},
		},
		{
			// date ASC (oldest first): b_vid(t-4h), a_img(t-3h), d_vid(t-2h), c_img(t-1h)
			sortField: SortByDate,
			sortOrder: SortAsc,
			wantPaths: []string{
				parent + "/b_vid.mp4",
				parent + "/a_img.jpg",
				parent + "/d_vid.mp4",
				parent + "/c_img.jpg",
			},
		},
		{
			// date DESC (newest first): c_img(t-1h), d_vid(t-2h), a_img(t-3h), b_vid(t-4h)
			sortField: SortByDate,
			sortOrder: SortDesc,
			wantPaths: []string{
				parent + "/c_img.jpg",
				parent + "/d_vid.mp4",
				parent + "/a_img.jpg",
				parent + "/b_vid.mp4",
			},
		},
		{
			// size ASC (smallest first): d_vid(100), c_img(200), b_vid(300), a_img(400)
			sortField: SortBySize,
			sortOrder: SortAsc,
			wantPaths: []string{
				parent + "/d_vid.mp4",
				parent + "/c_img.jpg",
				parent + "/b_vid.mp4",
				parent + "/a_img.jpg",
			},
		},
		{
			// size DESC (largest first): a_img(400), b_vid(300), c_img(200), d_vid(100)
			sortField: SortBySize,
			sortOrder: SortDesc,
			wantPaths: []string{
				parent + "/a_img.jpg",
				parent + "/b_vid.mp4",
				parent + "/c_img.jpg",
				parent + "/d_vid.mp4",
			},
		},
	}

	for _, tt := range tests {
		name := fmt.Sprintf("%s_%s", tt.sortField, tt.sortOrder)
		t.Run(name, func(t *testing.T) {
			listing, err := db.ListDirectory(ctx, ListOptions{
				Path:      parent,
				Page:      1,
				PageSize:  20,
				SortField: tt.sortField,
				SortOrder: tt.sortOrder,
			})
			if err != nil {
				t.Fatalf("ListDirectory: %v", err)
			}

			got := nonFolderPaths(listing.Items)

			if len(got) != len(tt.wantPaths) {
				t.Fatalf("got %d items, want %d; paths=%v", len(got), len(tt.wantPaths), got)
			}

			for i, want := range tt.wantPaths {
				if got[i] != want {
					t.Errorf("position %d: got %q want %q\n  full order: %v\n  types:      %v",
						i, got[i], want, got, typesOf(listing.Items))
				}
			}

			// Sanity: first and last items should have different types (the
			// fixture is designed so that the correct order always alternates).
			if len(listing.Items) >= 2 {
				first := listing.Items[0]
				last := listing.Items[len(listing.Items)-1]
				if first.Type == last.Type {
					t.Errorf("first and last items have the same type %q — "+
						"items appear grouped by type rather than interleaved\n  order: %v\n  types: %v",
						first.Type, pathsOf(listing.Items), typesOf(listing.Items))
				}
			}
		})
	}
}

// TestListDirectoryFoldersAlwaysFirstIntegration verifies that folders precede
// all media files in ListDirectory output regardless of sort field, even when
// folder names would sort after media file names.
func TestListDirectoryFoldersAlwaysFirstIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	now := time.Now()
	const parent = "folderfirst"

	files := []MediaFile{
		// Media files with names that alphabetically precede "z_folder"
		{Name: "a_image.jpg", Path: parent + "/a_image.jpg", ParentPath: parent, Type: FileTypeImage, Size: 100, ModTime: now.Add(-2 * time.Hour)},
		{Name: "b_video.mp4", Path: parent + "/b_video.mp4", ParentPath: parent, Type: FileTypeVideo, Size: 200, ModTime: now.Add(-1 * time.Hour)},
		// Folder whose name sorts AFTER both media files alphabetically.
		// This would appear last in a naive f.type-independent sort, but must
		// appear first because it is a folder.
		{Name: "z_folder", Path: parent + "/z_folder", ParentPath: parent, Type: FileTypeFolder, Size: 0, ModTime: now},
	}
	seedFiles(ctx, t, db, files)

	sortFields := []SortField{SortByName, SortByDate, SortBySize}
	for _, sf := range sortFields {
		for _, so := range []SortOrder{SortAsc, SortDesc} {
			t.Run(fmt.Sprintf("%s_%s", sf, so), func(t *testing.T) {
				listing, err := db.ListDirectory(ctx, ListOptions{
					Path:      parent,
					Page:      1,
					PageSize:  20,
					SortField: sf,
					SortOrder: so,
				})
				if err != nil {
					t.Fatalf("ListDirectory: %v", err)
				}

				if len(listing.Items) == 0 {
					t.Fatal("no items returned")
				}

				if listing.Items[0].Type != FileTypeFolder {
					t.Errorf("first item is %q (%s), expected a folder\n  order: %v\n  types: %v",
						listing.Items[0].Name, listing.Items[0].Type,
						pathsOf(listing.Items), typesOf(listing.Items))
				}
			})
		}
	}
}

// TestListDirectoryAndMediaEndpointSortConsistencyIntegration verifies that
// the relative ordering of media items (images + videos) returned by
// ListDirectory matches the ordering returned by GetMediaInDirectoryPaged for
// every sort field and direction.
//
// This is the key cross-endpoint regression gate: it would have caught the
// original bug (ListDirectory grouping by type while GetMediaInDirectoryPaged
// interleaved correctly) before it became a user-visible issue.
func TestListDirectoryAndMediaEndpointSortConsistencyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	now := time.Now()
	const parent = "consistency"

	// Include a folder so ListDirectory has something to filter out.
	fixtures := sortRegressionFixtures(parent, now)
	fixtures = append(fixtures, MediaFile{
		Name: "sub", Path: parent + "/sub", ParentPath: parent,
		Type: FileTypeFolder, Size: 0, ModTime: now,
	})
	seedFiles(ctx, t, db, fixtures)

	sortCases := []struct {
		field SortField
		order SortOrder
	}{
		{SortByName, SortAsc},
		{SortByName, SortDesc},
		{SortByDate, SortAsc},
		{SortByDate, SortDesc},
		{SortBySize, SortAsc},
		{SortBySize, SortDesc},
	}

	for _, sc := range sortCases {
		t.Run(fmt.Sprintf("%s_%s", sc.field, sc.order), func(t *testing.T) {
			// Order from the gallery endpoint (ListDirectory, folders excluded).
			listing, err := db.ListDirectory(ctx, ListOptions{
				Path:      parent,
				Page:      1,
				PageSize:  20,
				SortField: sc.field,
				SortOrder: sc.order,
			})
			if err != nil {
				t.Fatalf("ListDirectory: %v", err)
			}
			galleryOrder := nonFolderPaths(listing.Items)

			// Order from the lightbox endpoint (GetMediaInDirectoryPaged).
			mediaItems, _, err := db.GetMediaInDirectoryPaged(ctx, parent, sc.field, sc.order, 0, 0)
			if err != nil {
				t.Fatalf("GetMediaInDirectoryPaged: %v", err)
			}
			lightboxOrder := pathsOf(mediaItems)

			if len(galleryOrder) != len(lightboxOrder) {
				t.Fatalf("item count mismatch: gallery=%d lightbox=%d", len(galleryOrder), len(lightboxOrder))
			}

			for i := range galleryOrder {
				if galleryOrder[i] != lightboxOrder[i] {
					t.Errorf("position %d differs:\n  gallery  = %v\n  lightbox = %v",
						i, galleryOrder, lightboxOrder)
					break
				}
			}
		})
	}
}
