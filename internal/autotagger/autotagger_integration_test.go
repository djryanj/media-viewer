package autotagger

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"media-viewer/internal/database"

	"github.com/prometheus/client_golang/prometheus"
)

// requireFFmpeg skips the test when ffmpeg, ffprobe, or exiftool is not
// available in the PATH.  ffmpeg creates MP4 fixtures, ffprobe extracts
// metadata, and exiftool writes EXIF/XMP metadata into JPEG fixtures.
func requireFFmpeg(t *testing.T) {
	t.Helper()
	for _, tool := range []string{"ffmpeg", "ffprobe", "exiftool"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("skipping: %s not available", tool)
		}
	}
}

// createMediaWithDescription creates a minimal 0.1-second black MP4 at dest
// and embeds the given string as the format-level description tag.
//
// ffmpeg natively supports writing description metadata into MP4 containers via
// the -metadata flag; ffprobe reliably surfaces this as "description" in
// format.tags regardless of platform or ffprobe version.  This is more
// portable than attempting to write JPEG EXIF/XMP metadata with external tools.
func createMediaWithDescription(t *testing.T, dest, description string) {
	t.Helper()
	// #nosec G204 -- test helper; dest and description are caller-controlled
	cmd := exec.Command("ffmpeg",
		"-y",
		"-f", "lavfi",
		"-i", "color=c=black:size=2x2",
		"-t", "0.1",
		"-metadata", "description="+description,
		dest,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg failed to create test media %q: %v\noutput: %s", dest, err, out)
	}
}

// createMediaNoMetadata creates a minimal 0.1-second black MP4 at dest with
// no extra metadata fields.
func createMediaNoMetadata(t *testing.T, dest string) {
	t.Helper()
	// #nosec G204 -- test helper; dest is caller-controlled
	cmd := exec.Command("ffmpeg",
		"-y",
		"-f", "lavfi",
		"-i", "color=c=black:size=2x2",
		"-t", "0.1",
		dest,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg failed to create bare media %q: %v\noutput: %s", dest, err, out)
	}
}

// createJPEGWithDescription creates a minimal 2x2 black JPEG at dest and
// embeds the given string as the EXIF ImageDescription tag via exiftool.
//
// ffprobe surfaces EXIF ImageDescription as "comment" in format.tags for JPEG
// files, which is one of the fields extractDescriptionField checks.  We use
// exiftool rather than ffmpeg because ffmpeg silently ignores -metadata for
// JPEG output (JPEG has no native container-level metadata segment).
func createJPEGWithDescription(t *testing.T, dest, description string) {
	t.Helper()
	// Step 1: create the bare JPEG with ffmpeg.
	// #nosec G204 -- test helper; dest is caller-controlled
	createCmd := exec.Command("ffmpeg",
		"-y",
		"-f", "lavfi",
		"-i", "color=c=black:size=2x2",
		"-vframes", "1",
		dest,
	)
	if out, err := createCmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg failed to create JPEG %q: %v\noutput: %s", dest, err, out)
	}
	// Step 2: embed description as EXIF ImageDescription via exiftool.
	// #nosec G204 -- test helper; description is caller-controlled test data
	tagCmd := exec.Command("exiftool",
		"-overwrite_original",
		"-EXIF:ImageDescription="+description,
		dest,
	)
	if out, err := tagCmd.CombinedOutput(); err != nil {
		t.Fatalf("exiftool failed to write JPEG metadata %q: %v\noutput: %s", dest, err, out)
	}
}

// createJPEGNoMetadata creates a minimal 2x2 black JPEG at dest with no
// description metadata.
func createJPEGNoMetadata(t *testing.T, dest string) {
	t.Helper()
	// #nosec G204 -- test helper; dest is caller-controlled
	cmd := exec.Command("ffmpeg",
		"-y",
		"-f", "lavfi",
		"-i", "color=c=black:size=2x2",
		"-vframes", "1",
		dest,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg failed to create bare JPEG %q: %v\noutput: %s", dest, err, out)
	}
}

// setupAutoTaggerDB creates a real SQLite database in a temp directory and
// populates it with the supplied file records via the batch inserter.  The
// database is closed via t.Cleanup.
func setupAutoTaggerDB(t *testing.T, files []database.MediaFile) *database.Database {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, _, err := database.New(context.Background(), dbPath, nil)
	if err != nil {
		t.Fatalf("database.New: %v", err)
	}
	t.Cleanup(func() {
		if cerr := db.Close(); cerr != nil {
			t.Logf("db.Close: %v", cerr)
		}
	})

	if len(files) == 0 {
		return db
	}

	ctx := context.Background()
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		t.Fatalf("BeginBatch: %v", err)
	}
	batch.SetRunTime(time.Now().Unix())

	for i := range files {
		if uErr := batch.UpsertFile(ctx, &files[i]); uErr != nil {
			if endErr := db.EndBatch(batch, uErr); endErr != nil {
				t.Logf("EndBatch after UpsertFile failure: %v", endErr)
			}
			t.Fatalf("UpsertFile %q: %v", files[i].Path, uErr)
		}
	}

	if endErr := db.EndBatch(batch, nil); endErr != nil {
		t.Fatalf("EndBatch: %v", endErr)
	}

	return db
}

func gaugeVecValue(t *testing.T, metricName string, labels map[string]string) float64 {
	t.Helper()
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Logf("gather error (non-fatal): %v", err)
	}

	for _, mf := range families {
		if mf.GetName() != metricName {
			continue
		}
		for _, metric := range mf.GetMetric() {
			matched := true
			for key, want := range labels {
				found := false
				for _, label := range metric.GetLabel() {
					if label.GetName() == key && label.GetValue() == want {
						found = true
						break
					}
				}
				if !found {
					matched = false
					break
				}
			}
			if !matched {
				continue
			}
			if gauge := metric.GetGauge(); gauge != nil {
				return gauge.GetValue()
			}
		}
	}

	return 0
}

// ---------------------------------------------------------------------------
// extractTagsFromFile integration tests
// ---------------------------------------------------------------------------

// TestExtractTagsFromFileWithTagsIntegration verifies that a media file with a
// description containing the "tags:…;" pattern returns the expected tags.
func TestExtractTagsFromFileWithTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "tagged.mp4")
	createMediaWithDescription(t, filePath, "tags:nature, landscape;")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d: %v", len(tags), tags)
	}

	tagSet := make(map[string]bool)
	for _, tag := range tags {
		tagSet[tag] = true
	}
	if !tagSet["nature"] || !tagSet["landscape"] {
		t.Errorf("expected tags 'nature' and 'landscape', got %v", tags)
	}
}

// TestExtractTagsFromFileDescriptionNoTagsIntegration verifies that a media
// file with a description that contains no "tags:…;" pattern returns nil.
func TestExtractTagsFromFileDescriptionNoTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "no-tags.mp4")
	createMediaWithDescription(t, filePath, "just a plain description without any tag markers")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) != 0 {
		t.Errorf("expected no tags for description without markers, got %v", tags)
	}
}

// TestExtractTagsFromFileNoMetadataIntegration verifies that a media file
// without any description metadata returns nil without error.
func TestExtractTagsFromFileNoMetadataIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "bare.mp4")
	createMediaNoMetadata(t, filePath)

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) != 0 {
		t.Errorf("expected no tags for bare JPEG, got %v", tags)
	}
}

// TestExtractTagsFromFileNoSemicolonIntegration verifies that a media file
// whose description uses the "tags:…" pattern WITHOUT a trailing semicolon
// still produces the correct tag list.  Tags may contain spaces.
func TestExtractTagsFromFileNoSemicolonIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "no-semi.mp4")
	// Spaces inside tag names, no semicolon.
	createMediaWithDescription(t, filePath, "tags:first tag,second,this is still a tag")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	want := []string{"first tag", "second", "this is still a tag"}
	if len(tags) != len(want) {
		t.Fatalf("expected %d tags, got %d: %v", len(want), len(tags), tags)
	}
	for i, w := range want {
		if tags[i] != w {
			t.Errorf("tags[%d] = %q, want %q", i, tags[i], w)
		}
	}
}

// TestExtractTagsFromFileNoSemicolonWithTextIntegration verifies that
// surrounding prose in the description is handled correctly when there is no
// semicolon to delimit the end of the tag list.
func TestExtractTagsFromFileNoSemicolonWithTextIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "no-semi-text.mp4")
	// Semicolon in the description DOES terminate the list; without one the
	// parser reads to end-of-string.  Here we embed text after a comma to
	// confirm the last "token" is still trimmed correctly.
	createMediaWithDescription(t, filePath, "tags:landscape, nature ")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d: %v", len(tags), tags)
	}
	if tags[0] != "landscape" || tags[1] != "nature" {
		t.Errorf("got %v, want [landscape nature]", tags)
	}
}

// TestExtractTagsFromFileMissingFileIntegration verifies that a non-existent
// path is reported as an error by ffprobe.
func TestExtractTagsFromFileMissingFileIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	nonExistent := filepath.Join(t.TempDir(), "does_not_exist.mp4")
	_, err := extractTagsFromFile(context.Background(), nonExistent)
	if err == nil {
		t.Error("expected error for non-existent file, got nil")
	}
}

// ---------------------------------------------------------------------------
// processFiles integration tests
// ---------------------------------------------------------------------------

// TestProcessFilesTagsAppliedIntegration creates a real media file with
// embedded tags and verifies the full processFiles pipeline writes them to the
// DB.
func TestProcessFilesTagsAppliedIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createMediaWithDescription(t, filepath.Join(mediaDir, "photo.mp4"), "tags:nature, landscape;")

	files := []database.MediaFile{
		{
			Name:       "photo.mp4",
			Path:       "photo.mp4",
			ParentPath: "",
			Type:       database.FileTypeVideo,
			Size:       1024,
			ModTime:    time.Now(),
			MimeType:   "video/mp4",
		},
	}

	db := setupAutoTaggerDB(t, files)
	tagger := New(db, mediaDir, 24*time.Hour, true)

	tagged, failed, err := tagger.processFiles(ctx, files)
	if err != nil {
		t.Fatalf("processFiles: %v", err)
	}
	if tagged != 1 {
		t.Errorf("expected 1 tagged file, got %d (failed=%d)", tagged, failed)
	}
	if failed != 0 {
		t.Errorf("expected 0 failed files, got %d", failed)
	}

	fileTags, err := db.GetFileTags(ctx, "photo.mp4")
	if err != nil {
		t.Fatalf("GetFileTags: %v", err)
	}
	if len(fileTags) != 2 {
		t.Fatalf("expected 2 tags in DB, got %d: %v", len(fileTags), fileTags)
	}
}

// TestProcessFilesPreservesExistingTagsIntegration verifies that user-created
// tags on a file are not removed when EXIF tags are merged.
func TestProcessFilesPreservesExistingTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createMediaWithDescription(t, filepath.Join(mediaDir, "photo.mp4"), "tags:nature;")

	files := []database.MediaFile{
		{
			Name:       "photo.mp4",
			Path:       "photo.mp4",
			ParentPath: "",
			Type:       database.FileTypeVideo,
			Size:       1024,
			ModTime:    time.Now(),
			MimeType:   "video/mp4",
		},
	}

	db := setupAutoTaggerDB(t, files)

	// Pre-add a user tag.
	if err := db.AddTagToFile(ctx, "photo.mp4", "UserTag"); err != nil {
		t.Fatalf("AddTagToFile: %v", err)
	}

	tagger := New(db, mediaDir, 24*time.Hour, true)
	if _, _, err := tagger.processFiles(ctx, files); err != nil {
		t.Fatalf("processFiles: %v", err)
	}

	fileTags, err := db.GetFileTags(ctx, "photo.mp4")
	if err != nil {
		t.Fatalf("GetFileTags: %v", err)
	}

	tagSet := make(map[string]bool)
	for _, tag := range fileTags {
		tagSet[tag] = true
	}
	if !tagSet["nature"] {
		t.Errorf("expected EXIF tag 'nature' to be present, got %v", fileTags)
	}
	if !tagSet["UserTag"] {
		t.Errorf("expected pre-existing 'UserTag' to be preserved, got %v", fileTags)
	}
}

// TestProcessFilesSkipsFolderEntriesIntegration ensures folder-type entries are
// silently skipped without attempting file I/O.
func TestProcessFilesSkipsFolderEntriesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	ctx := context.Background()
	mediaDir := t.TempDir()

	// Folder entry — no corresponding file on disk (ffprobe must not be called).
	files := []database.MediaFile{
		{
			Name:       "myfolder",
			Path:       "myfolder",
			ParentPath: "",
			Type:       database.FileTypeFolder,
			Size:       0,
			ModTime:    time.Now(),
		},
	}

	db := setupAutoTaggerDB(t, nil) // no file records needed
	tagger := New(db, mediaDir, 24*time.Hour, true)

	tagged, failed, err := tagger.processFiles(ctx, files)
	if err != nil {
		t.Fatalf("processFiles: %v", err)
	}
	if tagged != 0 || failed != 0 {
		t.Errorf("expected folders to be skipped (tagged=%d, failed=%d)", tagged, failed)
	}
}

// TestProcessFilesMultipleFilesIntegration exercises processFiles with a mixed
// batch: one file with tags, one without, and one that does not exist on disk.
func TestProcessFilesMultipleFilesIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createMediaWithDescription(t, filepath.Join(mediaDir, "tagged.mp4"), "tags:city;")
	createMediaNoMetadata(t, filepath.Join(mediaDir, "bare.mp4"))
	// "missing.mp4" intentionally absent from disk → ffprobe error → failed counter

	files := []database.MediaFile{
		{Name: "tagged.mp4", Path: "tagged.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
		{Name: "bare.mp4", Path: "bare.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
		{Name: "missing.mp4", Path: "missing.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
	}

	db := setupAutoTaggerDB(t, files)
	tagger := New(db, mediaDir, 24*time.Hour, true)

	tagged, failed, err := tagger.processFiles(ctx, files)
	if err != nil {
		t.Fatalf("processFiles: %v", err)
	}
	if tagged != 1 {
		t.Errorf("expected 1 tagged file, got %d", tagged)
	}
	if failed != 1 {
		t.Errorf("expected 1 failed file (missing on disk), got %d", failed)
	}

	tags, _ := db.GetFileTags(ctx, "tagged.mp4")
	if len(tags) != 1 || tags[0] != "city" {
		t.Errorf("expected ['city'] on tagged.mp4, got %v", tags)
	}

	bareTags, _ := db.GetFileTags(ctx, "bare.mp4")
	if len(bareTags) != 0 {
		t.Errorf("expected no tags on bare.mp4, got %v", bareTags)
	}
}

// TestProcessFilesCasePreservationIntegration verifies that when a tag already
// exists in the DB (e.g. "Nature"), providing the same tag in lowercase via
// description metadata does not create a duplicate and preserves the original
// spelling.
func TestProcessFilesCasePreservationIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	// Two files: the second's description provides lowercase variant of a tag.
	createMediaWithDescription(t, filepath.Join(mediaDir, "first.mp4"), "tags:Nature;")
	createMediaWithDescription(t, filepath.Join(mediaDir, "second.mp4"), "tags:nature;")

	files := []database.MediaFile{
		{Name: "first.mp4", Path: "first.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
		{Name: "second.mp4", Path: "second.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
	}

	db := setupAutoTaggerDB(t, files)
	tagger := New(db, mediaDir, 24*time.Hour, true)

	if _, _, err := tagger.processFiles(ctx, files); err != nil {
		t.Fatalf("processFiles: %v", err)
	}

	for _, path := range []string{"first.mp4", "second.mp4"} {
		tags, err := db.GetFileTags(ctx, path)
		if err != nil {
			t.Fatalf("GetFileTags(%q): %v", path, err)
		}
		if len(tags) != 1 {
			t.Errorf("%s: expected 1 tag, got %d: %v", path, len(tags), tags)
			continue
		}
		// Canonical spelling set by the first insertion should be preserved.
		if tags[0] != "Nature" {
			t.Errorf("%s: expected canonical spelling 'Nature', got %q", path, tags[0])
		}
	}
}

// TestProcessFilesIdempotentIntegration verifies that running processFiles
// twice on the same files does not duplicate tags.
func TestProcessFilesIdempotentIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createMediaWithDescription(t, filepath.Join(mediaDir, "photo.mp4"), "tags:landscape, nature;")

	files := []database.MediaFile{
		{Name: "photo.mp4", Path: "photo.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
	}

	db := setupAutoTaggerDB(t, files)
	tagger := New(db, mediaDir, 24*time.Hour, true)

	// Run twice to verify idempotency.
	if _, _, err := tagger.processFiles(ctx, files); err != nil {
		t.Fatalf("processFiles first run: %v", err)
	}
	if _, _, err := tagger.processFiles(ctx, files); err != nil {
		t.Fatalf("processFiles second run: %v", err)
	}

	tags, err := db.GetFileTags(ctx, "photo.mp4")
	if err != nil {
		t.Fatalf("GetFileTags: %v", err)
	}
	if len(tags) != 2 {
		t.Errorf("expected exactly 2 tags after idempotent double-run, got %d: %v", len(tags), tags)
	}
}

// TestProcessFilesNoTagsFileIntegration verifies that a file with a
// description but no tag-pattern results in zero tags added and zero failures.
func TestProcessFilesNoTagsFileIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createMediaWithDescription(t, filepath.Join(mediaDir, "photo.mp4"), "no pattern here")

	files := []database.MediaFile{
		{Name: "photo.mp4", Path: "photo.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
	}

	db := setupAutoTaggerDB(t, files)
	tagger := New(db, mediaDir, 24*time.Hour, true)

	tagged, failed, err := tagger.processFiles(ctx, files)
	if err != nil {
		t.Fatalf("processFiles: %v", err)
	}
	if tagged != 0 {
		t.Errorf("expected 0 tagged, got %d", tagged)
	}
	if failed != 0 {
		t.Errorf("expected 0 failed, got %d", failed)
	}

	tags, _ := db.GetFileTags(ctx, "photo.mp4")
	if len(tags) != 0 {
		t.Errorf("expected no tags on file with non-matching description, got %v", tags)
	}
}

func TestRunPassFullUpdatesStatusAndMetricsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createMediaWithDescription(t, filepath.Join(mediaDir, "tagged.mp4"), "tags:nature;")
	createMediaNoMetadata(t, filepath.Join(mediaDir, "bare.mp4"))

	files := []database.MediaFile{
		{Name: "tagged.mp4", Path: "tagged.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
		{Name: "bare.mp4", Path: "bare.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
	}

	db := setupAutoTaggerDB(t, files)
	tagger := New(db, mediaDir, 24*time.Hour, true)

	tagger.runPass(false)

	tagger.runMu.RLock()
	stats := tagger.runStats
	tagger.runMu.RUnlock()

	if stats.InProgress {
		t.Fatal("runStats.InProgress should be false after run completes")
	}
	if stats.IsIncremental {
		t.Fatal("runStats.IsIncremental should be false for full pass")
	}
	if stats.TotalFiles != 2 {
		t.Fatalf("runStats.TotalFiles = %d, want 2", stats.TotalFiles)
	}
	if stats.Processed != 2 {
		t.Fatalf("runStats.Processed = %d, want 2", stats.Processed)
	}
	if stats.Tagged != 1 {
		t.Fatalf("runStats.Tagged = %d, want 1", stats.Tagged)
	}
	if stats.Skipped != 1 {
		t.Fatalf("runStats.Skipped = %d, want 1", stats.Skipped)
	}
	if stats.Failed != 0 {
		t.Fatalf("runStats.Failed = %d, want 0", stats.Failed)
	}
	if stats.CurrentFile != "" {
		t.Fatalf("runStats.CurrentFile = %q, want empty after completion", stats.CurrentFile)
	}
	if stats.LastCompleted.IsZero() {
		t.Fatal("status.Run.LastCompleted should be populated after completion")
	}

	if got := gaugeVecValue(t, "media_viewer_exif_tag_last_run_files", map[string]string{"status": "total"}); got != 2 {
		t.Fatalf("last run total gauge = %v, want 2", got)
	}
	if got := gaugeVecValue(t, "media_viewer_exif_tag_last_run_files", map[string]string{"status": "processed"}); got != 2 {
		t.Fatalf("last run processed gauge = %v, want 2", got)
	}
	if got := gaugeVecValue(t, "media_viewer_exif_tag_last_run_files", map[string]string{"status": "tagged"}); got != 1 {
		t.Fatalf("last run tagged gauge = %v, want 1", got)
	}
	if got := gaugeVecValue(t, "media_viewer_exif_tag_last_run_files", map[string]string{"status": "skipped"}); got != 1 {
		t.Fatalf("last run skipped gauge = %v, want 1", got)
	}
	if got := gaugeVecValue(t, "media_viewer_exif_tag_current_run_files", map[string]string{"status": "processed"}); got != 0 {
		t.Fatalf("current run processed gauge = %v, want 0 after completion", got)
	}

	tags, err := db.GetFileTags(ctx, "tagged.mp4")
	if err != nil {
		t.Fatalf("GetFileTags: %v", err)
	}
	if len(tags) != 1 || tags[0] != "nature" {
		t.Fatalf("expected tagged.mp4 to have [nature], got %v", tags)
	}
}

func TestRunPassIncrementalUpdatesStatusIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createMediaWithDescription(t, filepath.Join(mediaDir, "tagged.mp4"), "tags:travel;")

	files := []database.MediaFile{
		{Name: "tagged.mp4", Path: "tagged.mp4", Type: database.FileTypeVideo, ModTime: time.Now(), MimeType: "video/mp4"},
	}

	db := setupAutoTaggerDB(t, files)
	lastRun := time.Now().Add(-1 * time.Hour)
	if err := db.SetLastExifTagRun(ctx, lastRun); err != nil {
		t.Fatalf("SetLastExifTagRun: %v", err)
	}

	tagger := New(db, mediaDir, 24*time.Hour, true)
	tagger.runPass(true)

	tagger.runMu.RLock()
	stats := tagger.runStats
	tagger.runMu.RUnlock()

	if stats.InProgress {
		t.Fatal("runStats.InProgress should be false after completion")
	}
	if !stats.IsIncremental {
		t.Fatal("runStats.IsIncremental should be true for incremental pass")
	}
	if stats.TotalFiles != 1 {
		t.Fatalf("runStats.TotalFiles = %d, want 1", stats.TotalFiles)
	}
	if stats.Processed != 1 {
		t.Fatalf("runStats.Processed = %d, want 1", stats.Processed)
	}
	if stats.Tagged != 1 {
		t.Fatalf("runStats.Tagged = %d, want 1", stats.Tagged)
	}
	if stats.LastCompleted.IsZero() {
		t.Fatal("runStats.LastCompleted should be populated after incremental completion")
	}
}

// TestAutoTaggerEnabledFlagIntegration verifies that creating an AutoTagger
// with enabled=false disables the tagger (Start is a no-op and no goroutine is
// launched — tested by checking isRunning never becomes true after Start).
func TestAutoTaggerEnabledFlagIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	db := setupAutoTaggerDB(t, nil)
	tagger := New(db, t.TempDir(), 24*time.Hour, false)

	tagger.Start()
	// Disabled tagger should not set isRunning.
	if tagger.isRunning.Load() {
		t.Error("expected disabled tagger to not set isRunning")
	}

	// Deliberately do not call Stop — no goroutine was launched.
}

// ---------------------------------------------------------------------------
// JPEG-specific integration tests
//
// These tests verify that the autotagger correctly reads EXIF metadata embedded
// in JPEG files via exiftool.  Verifying JPEG support matters because most
// consumer photo libraries consist predominantly of JPEGs and ffmpeg silently
// ignores -metadata for JPEG output — only exiftool reliably writes EXIF
// ImageDescription, which ffprobe surfaces as "comment" in format.tags.
// ---------------------------------------------------------------------------

// TestExtractTagsFromFileJPEGWithTagsIntegration verifies that a JPEG with an
// EXIF ImageDescription containing the "tags:…;" pattern returns the expected
// tags.
func TestExtractTagsFromFileJPEGWithTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "tagged.jpg")
	createJPEGWithDescription(t, filePath, "tags:nature, landscape;")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d: %v", len(tags), tags)
	}
	tagSet := make(map[string]bool)
	for _, tag := range tags {
		tagSet[tag] = true
	}
	if !tagSet["nature"] || !tagSet["landscape"] {
		t.Errorf("expected tags 'nature' and 'landscape', got %v", tags)
	}
}

// TestExtractTagsFromFileJPEGNoTagsIntegration verifies that a JPEG with a
// plain description (no "tags:…;" pattern) returns nil without error.
func TestExtractTagsFromFileJPEGNoTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "no-tags.jpg")
	createJPEGWithDescription(t, filePath, "just a plain description without any tag markers")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) != 0 {
		t.Errorf("expected no tags, got %v", tags)
	}
}

// TestExtractTagsFromFileJPEGNoMetadataIntegration verifies that a JPEG
// without any description metadata returns nil without error.
func TestExtractTagsFromFileJPEGNoMetadataIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "bare.jpg")
	createJPEGNoMetadata(t, filePath)

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) != 0 {
		t.Errorf("expected no tags for bare JPEG, got %v", tags)
	}
}

// TestProcessFilesJPEGTagsAppliedIntegration verifies the full processFiles
// pipeline correctly reads EXIF tags from a JPEG and writes them to the DB.
func TestProcessFilesJPEGTagsAppliedIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createJPEGWithDescription(t, filepath.Join(mediaDir, "photo.jpg"), "tags:nature, landscape;")

	files := []database.MediaFile{
		{
			Name:       "photo.jpg",
			Path:       "photo.jpg",
			ParentPath: "",
			Type:       database.FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
			MimeType:   "image/jpeg",
		},
	}

	db := setupAutoTaggerDB(t, files)
	tagger := New(db, mediaDir, 24*time.Hour, true)

	tagged, failed, err := tagger.processFiles(ctx, files)
	if err != nil {
		t.Fatalf("processFiles: %v", err)
	}
	if tagged != 1 {
		t.Errorf("expected 1 tagged file, got %d (failed=%d)", tagged, failed)
	}
	if failed != 0 {
		t.Errorf("expected 0 failed files, got %d", failed)
	}

	fileTags, err := db.GetFileTags(ctx, "photo.jpg")
	if err != nil {
		t.Fatalf("GetFileTags: %v", err)
	}
	if len(fileTags) != 2 {
		t.Fatalf("expected 2 tags in DB, got %d: %v", len(fileTags), fileTags)
	}
}

// TestProcessFilesJPEGPreservesExistingTagsIntegration verifies that
// user-created tags on a JPEG are not removed when EXIF tags are merged.
func TestProcessFilesJPEGPreservesExistingTagsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createJPEGWithDescription(t, filepath.Join(mediaDir, "photo.jpg"), "tags:nature;")

	files := []database.MediaFile{
		{
			Name:       "photo.jpg",
			Path:       "photo.jpg",
			ParentPath: "",
			Type:       database.FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
			MimeType:   "image/jpeg",
		},
	}

	db := setupAutoTaggerDB(t, files)

	if err := db.AddTagToFile(ctx, "photo.jpg", "UserTag"); err != nil {
		t.Fatalf("AddTagToFile: %v", err)
	}

	tagger := New(db, mediaDir, 24*time.Hour, true)
	if _, _, err := tagger.processFiles(ctx, files); err != nil {
		t.Fatalf("processFiles: %v", err)
	}

	fileTags, err := db.GetFileTags(ctx, "photo.jpg")
	if err != nil {
		t.Fatalf("GetFileTags: %v", err)
	}

	tagSet := make(map[string]bool)
	for _, tag := range fileTags {
		tagSet[tag] = true
	}
	if !tagSet["nature"] {
		t.Errorf("expected EXIF tag 'nature' to be present, got %v", fileTags)
	}
	if !tagSet["UserTag"] {
		t.Errorf("expected pre-existing 'UserTag' to be preserved, got %v", fileTags)
	}
}

// TestProcessFilesJPEGIdempotentIntegration verifies that running processFiles
// twice on the same JPEG does not duplicate tags.
func TestProcessFilesJPEGIdempotentIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	ctx := context.Background()
	mediaDir := t.TempDir()

	createJPEGWithDescription(t, filepath.Join(mediaDir, "photo.jpg"), "tags:landscape, nature;")

	files := []database.MediaFile{
		{Name: "photo.jpg", Path: "photo.jpg", Type: database.FileTypeImage, ModTime: time.Now(), MimeType: "image/jpeg"},
	}

	db := setupAutoTaggerDB(t, files)
	tagger := New(db, mediaDir, 24*time.Hour, true)

	if _, _, err := tagger.processFiles(ctx, files); err != nil {
		t.Fatalf("processFiles first run: %v", err)
	}
	if _, _, err := tagger.processFiles(ctx, files); err != nil {
		t.Fatalf("processFiles second run: %v", err)
	}

	tags, err := db.GetFileTags(ctx, "photo.jpg")
	if err != nil {
		t.Fatalf("GetFileTags: %v", err)
	}
	if len(tags) != 2 {
		t.Errorf("expected exactly 2 tags after idempotent double-run, got %d: %v", len(tags), tags)
	}
}

// ---------------------------------------------------------------------------
// exiftool image extraction tests
//
// extractDescriptionViaExiftool is the preferred extractor for still-image
// files. These tests exercise it directly rather than via the full fallback
// pipeline so they remain reliable regardless of which metadata embedding
// strategy ffprobe happens to surface.
// ---------------------------------------------------------------------------

// TestExtractDescriptionViaExiftoolIntegration verifies that
// extractDescriptionViaExiftool reads EXIF ImageDescription written by
// exiftool.
func TestExtractDescriptionViaExiftoolIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "et_fallback.jpg")
	createJPEGWithDescription(t, filePath, "tags:fallback, test;")

	desc, err := extractDescriptionViaExiftool(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractDescriptionViaExiftool: %v", err)
	}
	if desc == "" {
		t.Fatal("expected non-empty description via exiftool image extraction, got empty string")
	}
	tags := parseTagsFromDescription(desc)
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d: %v", len(tags), tags)
	}
	tagSet := make(map[string]bool)
	for _, tag := range tags {
		tagSet[tag] = true
	}
	if !tagSet["fallback"] || !tagSet["test"] {
		t.Errorf("expected tags 'fallback' and 'test', got %v", tags)
	}
}

// TestExtractDescriptionViaExiftoolNoMetadataIntegration verifies that
// extractDescriptionViaExiftool returns an empty string for a JPEG with no
// description metadata.
func TestExtractDescriptionViaExiftoolNoMetadataIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "bare_et.jpg")
	createJPEGNoMetadata(t, filePath)

	desc, err := extractDescriptionViaExiftool(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractDescriptionViaExiftool: %v", err)
	}
	if desc != "" {
		t.Errorf("expected empty description for bare JPEG, got %q", desc)
	}
}

// TestExtractTagsFromFileJPEGExiftoolPreferredIntegration verifies the code
// path where exiftool supplies JPEG metadata that ffprobe's image2 demuxer does
// not surface. IPTC Keywords are not surfaced by ffprobe's image2 demuxer (they
// arrive as format.tags["comment"] only when an EXIF/XMP field is written via
// exiftool), so a JPEG with only IPTC Keywords / XMP Subject is the canonical
// fixture for this scenario. The fixture is self-contained and does not depend
// on any files in sample-media/.
func TestExtractTagsFromFileJPEGExiftoolPreferredIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "fallback.jpg")
	// IPTC Keywords / XMP Subject are invisible to ffprobe, so exiftool should
	// be the first and successful extractor for this file.
	createJPEGWithIPTCKeywords(t, filePath, "nature", "landscape", "travel")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) == 0 {
		t.Fatal("expected tags via exiftool-preferred image extraction, got none")
	}
	tagSet := make(map[string]bool)
	for _, tag := range tags {
		tagSet[tag] = true
	}
	for _, want := range []string{"nature", "landscape", "travel"} {
		if !tagSet[want] {
			t.Errorf("expected tag %q in result %v", want, tags)
		}
	}
}

// ---------------------------------------------------------------------------
// Extended keyword detection integration tests
//
// These tests exercise the full extractTagsFromFile pipeline with real JPEG
// fixtures, verifying the extended IPTC/XMP keyword path end-to-end.
// ---------------------------------------------------------------------------

// createJPEGWithIPTCKeywords creates a minimal JPEG and writes keywords using
// the standard IPTC Keywords and XMP Subject fields (as digiKam, Apple Photos,
// and Lightroom do).  This exercises the extended detection path because the
// values arrive as a plain comma-separated "comment" with no "tags:" prefix.
func createJPEGWithIPTCKeywords(t *testing.T, dest string, keywords ...string) {
	t.Helper()
	// Step 1: create bare JPEG.
	createCmd := exec.Command("ffmpeg",
		"-y", "-f", "lavfi", "-i", "color=c=black:size=2x2", "-vframes", "1", dest,
	)
	if out, err := createCmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg failed to create JPEG %q: %v\noutput: %s", dest, err, out)
	}
	// Step 2: write IPTC Keywords and XMP Subject via exiftool.
	args := make([]string, 0, 1+2*len(keywords)+1)
	args = append(args, "-overwrite_original")
	for _, kw := range keywords {
		args = append(args, "-IPTC:Keywords+="+kw, "-XMP-dc:Subject+="+kw)
	}
	args = append(args, dest)
	// #nosec G204 -- test helper; args are caller-controlled test data
	tagCmd := exec.Command("exiftool", args...)
	if out, err := tagCmd.CombinedOutput(); err != nil {
		t.Fatalf("exiftool failed to write IPTC keywords to %q: %v\noutput: %s", dest, err, out)
	}
}

func createWebPWithXMPKeywords(t *testing.T, dest string, keywords ...string) {
	t.Helper()
	createCmd := exec.Command("ffmpeg",
		"-y", "-f", "lavfi", "-i", "color=c=black:size=2x2", "-frames:v", "1", dest,
	)
	if out, err := createCmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg failed to create WebP %q: %v\noutput: %s", dest, err, out)
	}

	args := make([]string, 0, 1+len(keywords)+1)
	args = append(args, "-overwrite_original")
	for _, kw := range keywords {
		args = append(args, "-XMP-dc:Subject+="+kw)
	}
	args = append(args, dest)
	// #nosec G204 -- test helper; args are caller-controlled test data
	tagCmd := exec.Command("exiftool", args...)
	if out, err := tagCmd.CombinedOutput(); err != nil {
		t.Fatalf("exiftool failed to write XMP keywords to %q: %v\noutput: %s", dest, err, out)
	}
}

// TestExtractTagsFromFileExtendedKeywordListIntegration verifies that a JPEG
// whose Description field contains a plain comma-separated keyword list (no
// "tags:" prefix) is correctly picked up by the extended detection path.
func TestExtractTagsFromFileExtendedKeywordListIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "plain_keywords.jpg")
	// Write a plain Description (XMP style, no tags: prefix).
	createJPEGWithDescription(t, filePath, "urban, city lights, night photography")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	want := []string{"urban", "city lights", "night photography"}
	if len(tags) != len(want) {
		t.Fatalf("expected %d tags, got %d: %v", len(want), len(tags), tags)
	}
	for i, w := range want {
		if tags[i] != w {
			t.Errorf("tags[%d] = %q, want %q", i, tags[i], w)
		}
	}
}

// TestExtractTagsFromFileExtendedProseBlockedIntegration verifies that a plain
// description containing sentence-ending punctuation is NOT converted to tags
// by the extended path.
func TestExtractTagsFromFileExtendedProseBlockedIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "prose.jpg")
	createJPEGWithDescription(t, filePath, "A walk through the city, late in the evening. Shot handheld.")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) != 0 {
		t.Errorf("expected no tags for prose description, got %v", tags)
	}
}

// TestExtractTagsFromFileIPTCKeywordsIntegration verifies the canonical
// Lightroom/digiKam/Apple Photos workflow: IPTC Keywords written via the
// standard subject field are surfaced as a plain comma-separated string by
// ffprobe/exiftool and picked up by the extended detection path.
func TestExtractTagsFromFileIPTCKeywordsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "iptc_keywords.jpg")
	createJPEGWithIPTCKeywords(t, filePath, "travel", "mountains", "landscape")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) == 0 {
		t.Fatal("expected tags from IPTC Keywords field, got none")
	}
	tagSet := make(map[string]bool)
	for _, tag := range tags {
		tagSet[tag] = true
	}
	for _, want := range []string{"travel", "mountains", "landscape"} {
		if !tagSet[want] {
			t.Errorf("expected tag %q in result %v", want, tags)
		}
	}
}

func TestExtractTagsFromFileWebPXMPKeywordsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	requireFFmpeg(t)

	mediaDir := t.TempDir()
	filePath := filepath.Join(mediaDir, "iptc_keywords.webp")
	createWebPWithXMPKeywords(t, filePath, "travel", "mountains", "landscape")

	tags, err := extractTagsFromFile(context.Background(), filePath)
	if err != nil {
		t.Fatalf("extractTagsFromFile: %v", err)
	}
	if len(tags) == 0 {
		t.Fatal("expected tags from WebP XMP Subject field, got none")
	}
	tagSet := make(map[string]bool)
	for _, tag := range tags {
		tagSet[tag] = true
	}
	for _, want := range []string{"travel", "mountains", "landscape"} {
		if !tagSet[want] {
			t.Errorf("expected tag %q in result %v", want, tags)
		}
	}
}
