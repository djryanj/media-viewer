package indexer

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/mediatypes"
)

// writeSniffFixture writes content to name inside dir and returns the relative
// path and stat info the walkers would carry for it.
func writeSniffFixture(t *testing.T, dir, name string, content []byte) (relPath string, info os.FileInfo) {
	t.Helper()

	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("failed to write fixture %s: %v", name, err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("failed to stat fixture %s: %v", name, err)
	}

	relPath, err = filepath.Rel(dir, path)
	if err != nil {
		t.Fatalf("failed to relativize fixture %s: %v", name, err)
	}

	return relPath, info
}

// gifInJPEG is GIF89a magic in a file the extension claims is a JPEG — the case
// the content sniff exists to catch.
func gifInJPEG() []byte {
	return append([]byte("GIF89a"), make([]byte, 10)...)
}

func TestSniffCacheLookupHitOnUnchangedFile(t *testing.T) {
	dir := t.TempDir()
	relPath, info := writeSniffFixture(t, dir, "clip.jpg", gifInJPEG())

	cache := sniffCache{relPath: database.SniffedType{
		Size:     info.Size(),
		ModTime:  info.ModTime(),
		Type:     database.FileTypeVideo,
		MimeType: mediatypes.MimeVideoMP4,
	}}

	fileType, mimeType, ok := cache.lookup(relPath, info)
	if !ok {
		t.Fatal("an unchanged file should hit the cache")
	}
	if fileType != database.FileTypeVideo {
		t.Errorf("cached type = %s, want %s", fileType, database.FileTypeVideo)
	}
	if mimeType != mediatypes.MimeVideoMP4 {
		t.Errorf("cached mime = %s, want %s", mimeType, mediatypes.MimeVideoMP4)
	}
}

func TestSniffCacheLookupMisses(t *testing.T) {
	dir := t.TempDir()
	relPath, info := writeSniffFixture(t, dir, "clip.jpg", gifInJPEG())

	entry := database.SniffedType{
		Size:     info.Size(),
		ModTime:  info.ModTime(),
		Type:     database.FileTypeVideo,
		MimeType: mediatypes.MimeVideoMP4,
	}

	resized := entry
	resized.Size = info.Size() + 1

	retouched := entry
	retouched.ModTime = info.ModTime().Add(2 * time.Second)

	tests := []struct {
		name  string
		cache sniffCache
	}{
		{"path absent", sniffCache{}},
		{"size changed", sniffCache{relPath: resized}},
		{"mod time changed", sniffCache{relPath: retouched}},
		{"nil cache", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, _, ok := tt.cache.lookup(relPath, info); ok {
				t.Error("expected a cache miss so the file gets re-sniffed")
			}
		})
	}
}

func TestSniffCacheLookupToleratesSubSecondModTime(t *testing.T) {
	dir := t.TempDir()
	relPath, info := writeSniffFixture(t, dir, "clip.jpg", gifInJPEG())

	// mod_time is persisted as whole Unix seconds, so a cached entry never
	// carries the nanoseconds the filesystem reports.
	cache := sniffCache{relPath: database.SniffedType{
		Size:     info.Size(),
		ModTime:  time.Unix(info.ModTime().Unix(), 0),
		Type:     database.FileTypeVideo,
		MimeType: mediatypes.MimeVideoMP4,
	}}

	if _, _, ok := cache.lookup(relPath, info); !ok {
		t.Error("second-granularity mod times must still hit the cache, or every run re-sniffs everything")
	}
}

func TestCreateMediaFileSniffsWhenNotCached(t *testing.T) {
	dir := t.TempDir()
	idx := New(&database.Database{}, dir, 5*time.Minute)
	relPath, info := writeSniffFixture(t, dir, "clip.jpg", gifInJPEG())

	file, ok := idx.createMediaFile(relPath, info)
	if !ok {
		t.Fatal("expected the file to be indexed")
	}
	if file.Type != database.FileTypeVideo {
		t.Errorf("type = %s, want %s — an uncached file must still be content-sniffed",
			file.Type, database.FileTypeVideo)
	}
}

func TestCreateMediaFileSkipsSniffWhenCached(t *testing.T) {
	dir := t.TempDir()
	idx := New(&database.Database{}, dir, 5*time.Minute)
	relPath, info := writeSniffFixture(t, dir, "clip.jpg", gifInJPEG())

	// The cache says this file was classified as a plain image last run. The
	// bytes on disk say otherwise, so an image result proves the file was never
	// opened — which is the whole point of the cache.
	idx.setSniffCache(sniffCache{relPath: database.SniffedType{
		Size:     info.Size(),
		ModTime:  info.ModTime(),
		Type:     database.FileTypeImage,
		MimeType: mediatypes.GetMimeType(".jpg"),
	}})

	file, ok := idx.createMediaFile(relPath, info)
	if !ok {
		t.Fatal("expected the file to be indexed")
	}
	if file.Type != database.FileTypeImage {
		t.Errorf("type = %s, want %s — a cached classification must be reused without re-opening the file",
			file.Type, database.FileTypeImage)
	}
}

func TestCreateMediaFileReusesCachedSniffOverride(t *testing.T) {
	dir := t.TempDir()
	idx := New(&database.Database{}, dir, 5*time.Minute)
	// Ordinary JPEG bytes: a fresh sniff would leave this as an image.
	relPath, info := writeSniffFixture(t, dir, "photo.jpg", []byte("\xff\xd8\xff\xe0plain jpeg"))

	idx.setSniffCache(sniffCache{relPath: database.SniffedType{
		Size:     info.Size(),
		ModTime:  info.ModTime(),
		Type:     database.FileTypeVideo,
		MimeType: mediatypes.MimeVideoMP4,
	}})

	file, ok := idx.createMediaFile(relPath, info)
	if !ok {
		t.Fatal("expected the file to be indexed")
	}
	if file.Type != database.FileTypeVideo {
		t.Errorf("type = %s, want %s — the previous run's override must survive", file.Type, database.FileTypeVideo)
	}
	if file.MimeType != mediatypes.MimeVideoMP4 {
		t.Errorf("mime = %s, want %s", file.MimeType, mediatypes.MimeVideoMP4)
	}
}

func TestCreateMediaFileReSniffsWhenFileChanged(t *testing.T) {
	dir := t.TempDir()
	idx := New(&database.Database{}, dir, 5*time.Minute)
	relPath, info := writeSniffFixture(t, dir, "clip.jpg", gifInJPEG())

	// Stale entry: the file has grown since it was last sniffed.
	idx.setSniffCache(sniffCache{relPath: database.SniffedType{
		Size:     info.Size() - 1,
		ModTime:  info.ModTime(),
		Type:     database.FileTypeImage,
		MimeType: mediatypes.GetMimeType(".jpg"),
	}})

	file, ok := idx.createMediaFile(relPath, info)
	if !ok {
		t.Fatal("expected the file to be indexed")
	}
	if file.Type != database.FileTypeVideo {
		t.Errorf("type = %s, want %s — a changed file must be re-sniffed", file.Type, database.FileTypeVideo)
	}
}

func TestCreateMediaFileIgnoresCacheForNonImageExtensions(t *testing.T) {
	dir := t.TempDir()
	idx := New(&database.Database{}, dir, 5*time.Minute)
	relPath, info := writeSniffFixture(t, dir, "movie.mp4", []byte("fake video"))

	// A bogus cached entry must not be able to reclassify a file whose extension
	// already identifies it unambiguously.
	idx.setSniffCache(sniffCache{relPath: database.SniffedType{
		Size:     info.Size(),
		ModTime:  info.ModTime(),
		Type:     database.FileTypeImage,
		MimeType: mediatypes.GetMimeType(".jpg"),
	}})

	file, ok := idx.createMediaFile(relPath, info)
	if !ok {
		t.Fatal("expected the file to be indexed")
	}
	if file.Type != database.FileTypeVideo {
		t.Errorf("type = %s, want %s — only image extensions are sniffed, so the cache must not apply",
			file.Type, database.FileTypeVideo)
	}
}

func TestParallelWalkerProcessFileSkipsSniffWhenCached(t *testing.T) {
	dir := t.TempDir()
	relPath, info := writeSniffFixture(t, dir, "clip.jpg", gifInJPEG())

	walker := NewParallelWalker(dir, DefaultParallelWalkerConfig())
	walker.SetSniffCache(sniffCache{relPath: database.SniffedType{
		Size:     info.Size(),
		ModTime:  info.ModTime(),
		Type:     database.FileTypeImage,
		MimeType: mediatypes.GetMimeType(".jpg"),
	}})

	result := walker.processFile(fileJob{
		path:    filepath.Join(dir, relPath),
		info:    info,
		relPath: relPath,
	})

	if result.file == nil {
		t.Fatal("expected the file to be indexed")
	}
	if result.file.Type != database.FileTypeImage {
		t.Errorf("type = %s, want %s — the parallel walker must honor the sniff cache too",
			result.file.Type, database.FileTypeImage)
	}
}

func TestParallelWalkerProcessFileSniffsWhenNotCached(t *testing.T) {
	dir := t.TempDir()
	relPath, info := writeSniffFixture(t, dir, "clip.jpg", gifInJPEG())

	walker := NewParallelWalker(dir, DefaultParallelWalkerConfig())

	result := walker.processFile(fileJob{
		path:    filepath.Join(dir, relPath),
		info:    info,
		relPath: relPath,
	})

	if result.file == nil {
		t.Fatal("expected the file to be indexed")
	}
	if result.file.Type != database.FileTypeVideo {
		t.Errorf("type = %s, want %s — an uncached file must still be content-sniffed",
			result.file.Type, database.FileTypeVideo)
	}
}
