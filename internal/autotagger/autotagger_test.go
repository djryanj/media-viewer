package autotagger

import (
	"testing"

	"media-viewer/internal/database"
)

func TestRunStatsInitialState(t *testing.T) {
	stats := runStats{}

	if stats.InProgress {
		t.Error("initial InProgress should be false")
	}
	if stats.TotalFiles != 0 {
		t.Errorf("initial TotalFiles = %d, want 0", stats.TotalFiles)
	}
	if stats.Processed != 0 {
		t.Errorf("initial Processed = %d, want 0", stats.Processed)
	}
}

func TestFilterTaggableFiles(t *testing.T) {
	files := []database.MediaFile{
		{Path: "folder", Type: database.FileTypeFolder},
		{Path: "photo.jpg", Type: database.FileTypeImage},
		{Path: "video.mp4", Type: database.FileTypeVideo},
	}

	filtered := filterTaggableFiles(files)
	if len(filtered) != 2 {
		t.Fatalf("len(filtered) = %d, want 2", len(filtered))
	}
	if filtered[0].Path != "photo.jpg" {
		t.Fatalf("filtered[0].Path = %q, want photo.jpg", filtered[0].Path)
	}
	if filtered[1].Path != "video.mp4" {
		t.Fatalf("filtered[1].Path = %q, want video.mp4", filtered[1].Path)
	}
}
