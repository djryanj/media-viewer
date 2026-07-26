package indexer

import (
	"os"
	"path/filepath"
	"strings"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"
	"media-viewer/internal/mediatypes"
	"media-viewer/internal/metrics"
)

// sniffCache holds the previous index run's content-sniff results, keyed by path
// relative to the media directory.
//
// Content sniffing has to open the file and read its first bytes.  Doing that for
// every image on every run is the single most expensive thing the indexer does to
// the media volume, and for the overwhelming majority of files the answer has not
// changed since the last run.  When a file's size and modification time still
// match what was stored, the recorded classification is reused and the file is
// never opened.
//
// Note: because a hit short-circuits the sniff entirely, extending
// mediatypes.SniffFileType to recognize a new format only reclassifies files that
// have changed on disk since the last run.  Existing files need a rebuild of the
// index to pick up the new detection.
type sniffCache map[string]database.SniffedType

// lookup returns the stored classification for relPath when the file on disk is
// still the one that was sniffed: same size, same modification time.
func (c sniffCache) lookup(relPath string, info os.FileInfo) (fileType mediatypes.FileType, mimeType string, ok bool) {
	entry, found := c[relPath]
	if !found {
		return mediatypes.FileTypeOther, "", false
	}

	if entry.Size != info.Size() {
		return mediatypes.FileTypeOther, "", false
	}

	// mod_time is persisted as whole Unix seconds, so compare at that resolution
	// rather than against the nanoseconds the filesystem reports.
	if entry.ModTime.Unix() != info.ModTime().Unix() {
		return mediatypes.FileTypeOther, "", false
	}

	return entry.Type, entry.MimeType, true
}

// classifyFile derives the media type and MIME type for a non-directory file.
//
// Files whose extension already identifies them unambiguously are classified from
// the extension alone.  Images are the one ambiguous case — an animated GIF saved
// as .jpg has to be routed through the transcoder — so they are content-sniffed,
// but only when the sniff cache cannot answer from the previous run.
//
// The bool result is false for files that are not media at all.
func classifyFile(mediaDir, relPath string, info os.FileInfo, cache sniffCache) (fileType mediatypes.FileType, mimeType string, ok bool) {
	ext := strings.ToLower(filepath.Ext(info.Name()))
	fileType = mediatypes.GetFileType(ext)

	if fileType == mediatypes.FileTypeOther {
		return mediatypes.FileTypeOther, "", false
	}

	mimeType = mediatypes.GetMimeType(ext)

	if fileType != mediatypes.FileTypeImage {
		return fileType, mimeType, true
	}

	if cachedType, cachedMime, hit := cache.lookup(relPath, info); hit {
		metrics.IndexerSniffCacheHits.Inc()
		return cachedType, cachedMime, true
	}

	metrics.IndexerSniffOpens.Inc()
	if sniffedType, sniffedMime, overridden := mediatypes.SniffFileType(filepath.Join(mediaDir, relPath)); overridden {
		logging.Debug("classifyFile: content sniff overrides type for %s: %s → %s",
			relPath, fileType, sniffedType)
		return sniffedType, sniffedMime, true
	}

	return fileType, mimeType, true
}
