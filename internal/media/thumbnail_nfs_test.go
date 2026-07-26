package media

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"time"

	"media-viewer/internal/database"
)

// jpegBytes is a byte slice that passes the JPEG magic-number check callers
// apply to thumbnail data. The contents beyond the header are irrelevant here.
func jpegBytes() []byte {
	return append([]byte{0xFF, 0xD8}, []byte("cached thumbnail")...)
}

// seedCachedThumbnail writes data into the generator's cache directory under the
// key it would use for sourcePath.
func seedCachedThumbnail(t *testing.T, gen *ThumbnailGenerator, sourcePath string, fileType database.FileType, data []byte) {
	t.Helper()

	cacheKey := gen.getCacheKey(sourcePath, fileType)
	if err := os.WriteFile(filepath.Join(gen.cacheDir, cacheKey), data, 0o644); err != nil {
		t.Fatalf("failed to seed cached thumbnail: %v", err)
	}
}

// TestGetThumbnailServesCacheWithoutStattingSource pins the ordering that keeps
// a cached thumbnail from costing a network round-trip: the cache is read before
// the source file is touched. The source deliberately does not exist, so any
// stat of it fails — serving the request anyway proves the cache came first.
func TestGetThumbnailServesCacheWithoutStattingSource(t *testing.T) {
	cacheDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(cacheDir, mediaDir, true, nil, time.Hour, nil)

	sourcePath := filepath.Join(mediaDir, "gone.jpg")
	want := jpegBytes()
	seedCachedThumbnail(t, gen, sourcePath, database.FileTypeImage, want)

	got, err := gen.GetThumbnail(context.Background(), sourcePath, database.FileTypeImage)
	if err != nil {
		t.Fatalf("a cached thumbnail must be served without stat-ing the source: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("got %q, want the cached bytes %q", got, want)
	}
}

// TestGetThumbnailCacheMissReportsNotExist locks in the error the HTTP layer
// relies on to answer 404 now that it no longer pre-stats the source itself.
func TestGetThumbnailCacheMissReportsNotExist(t *testing.T) {
	cacheDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(cacheDir, mediaDir, true, nil, time.Hour, nil)

	_, err := gen.GetThumbnail(context.Background(), filepath.Join(mediaDir, "gone.jpg"), database.FileTypeImage)
	if err == nil {
		t.Fatal("expected an error for a missing source with no cached thumbnail")
	}
	if !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("error %v does not match fs.ErrNotExist, so callers cannot distinguish 404 from 500", err)
	}
}

// TestGetThumbnailRejectsDirectoryMisclassifiedAsFile keeps the guard that used
// to live in the HTTP handler's own stat call.
func TestGetThumbnailRejectsDirectoryMisclassifiedAsFile(t *testing.T) {
	cacheDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(cacheDir, mediaDir, true, nil, time.Hour, nil)

	dirPath := filepath.Join(mediaDir, "an-album")
	if err := os.Mkdir(dirPath, 0o755); err != nil {
		t.Fatalf("failed to create directory: %v", err)
	}

	_, err := gen.GetThumbnail(context.Background(), dirPath, database.FileTypeImage)
	if err == nil {
		t.Fatal("expected an error when the path is a directory but the type says image")
	}
	if errors.Is(err, fs.ErrNotExist) {
		t.Error("a directory is not a missing file — this must not be reported as fs.ErrNotExist")
	}
}

// TestGetThumbnailFolderSkipsSourceStat covers the folder case, where there is
// no single source file to stat at all.
func TestGetThumbnailFolderSkipsSourceStat(t *testing.T) {
	cacheDir := t.TempDir()
	mediaDir := t.TempDir()
	gen := NewThumbnailGenerator(cacheDir, mediaDir, true, nil, time.Hour, nil)

	folderPath := filepath.Join(mediaDir, "album")
	want := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cached folder thumb")...)
	seedCachedThumbnail(t, gen, folderPath, database.FileTypeFolder, want)

	got, err := gen.GetThumbnail(context.Background(), folderPath, database.FileTypeFolder)
	if err != nil {
		t.Fatalf("cached folder thumbnail should be served: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("got %q, want the cached bytes %q", got, want)
	}
}
