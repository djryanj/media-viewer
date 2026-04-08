package autotagger

import (
	"context"
	"path/filepath"
	"sync/atomic"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

const (
	defaultInterval = 24 * time.Hour

	// exifFetchPageSize controls how many DB rows are loaded per round-trip
	// during a full pass.
	exifFetchPageSize = 500
)

// AutoTagger applies tags derived from EXIF/XMP metadata to indexed media files.
//
// It mirrors the ThumbnailGenerator scheduling model: it waits for the first
// index completion signal, runs a pass, then re-runs on every subsequent index
// completion and on a configurable periodic timer.
type AutoTagger struct {
	db              *database.Database
	mediaDir        string
	interval        time.Duration
	enabled         bool
	stopChan        chan struct{}
	onIndexComplete chan struct{}
	isRunning       atomic.Bool
}

// New creates a new AutoTagger.  When enabled is false [AutoTagger.Start] is a
// no-op and no background goroutines are launched.
func New(db *database.Database, mediaDir string, interval time.Duration, enabled bool) *AutoTagger {
	if interval <= 0 {
		interval = defaultInterval
	}
	return &AutoTagger{
		db:              db,
		mediaDir:        mediaDir,
		interval:        interval,
		enabled:         enabled,
		stopChan:        make(chan struct{}),
		onIndexComplete: make(chan struct{}, 1),
	}
}

// NotifyIndexComplete signals that an index run has just finished.  The call is
// non-blocking: if the channel already holds a pending notification a second
// notification is dropped.
func (a *AutoTagger) NotifyIndexComplete() {
	select {
	case a.onIndexComplete <- struct{}{}:
		logging.Debug("AutoTagger notified of index completion")
	default:
		// Already has a pending notification; the next pass will still run.
	}
}

// Start launches the background auto-tagging loop.  It is a no-op when the
// tagger is disabled.
func (a *AutoTagger) Start() {
	if !a.enabled {
		logging.Info("EXIF auto-tagging disabled")
		return
	}
	logging.Info("EXIF auto-tagger started (interval: %v)", a.interval)
	go a.loop()
}

// TriggerRun launches an on-demand full (non-incremental) pass in the
// background.  The call returns immediately without waiting for the pass to
// complete.  If a pass is already in progress the new request is silently
// ignored by the concurrency guard inside runPass.
func (a *AutoTagger) TriggerRun() {
	go a.runPass(false)
}

// Stop shuts down the background loop.
func (a *AutoTagger) Stop() {
	close(a.stopChan)
}

// loop waits for the first index completion then runs incremental passes on
// every subsequent completion and on the periodic timer.
func (a *AutoTagger) loop() {
	// Block until the initial index has finished.
	select {
	case <-a.onIndexComplete:
		logging.Info("AutoTagger: initial index complete, starting first pass")
		a.runPass(false)
	case <-a.stopChan:
		return
	}

	ticker := time.NewTicker(a.interval)
	defer ticker.Stop()

	for {
		select {
		case <-a.onIndexComplete:
			logging.Info("AutoTagger: index complete, running incremental pass")
			a.runPass(true)

		case <-ticker.C:
			logging.Info("AutoTagger: periodic pass triggered")
			a.runPass(true)

		case <-a.stopChan:
			logging.Info("AutoTagger stopped")
			return
		}
	}
}

// runPass processes media files looking for embedded tag instructions.  When
// incremental is true only files changed since the last recorded run are
// processed; when false the entire library is scanned in pages.
func (a *AutoTagger) runPass(incremental bool) {
	// Guard against concurrent passes.
	if !a.isRunning.CompareAndSwap(false, true) {
		logging.Info("AutoTagger: pass already in progress, skipping")
		return
	}
	defer a.isRunning.Store(false)

	metrics.ExifTagRunning.Set(1)
	defer metrics.ExifTagRunning.Set(0)

	ctx := context.Background()
	start := time.Now()

	if incremental {
		lastRun, err := a.db.GetLastExifTagRun(ctx)
		switch {
		case err != nil:
			logging.Warn("AutoTagger: failed to read last run time, falling back to full pass: %v", err)
			metrics.ExifTagErrorsTotal.Inc()
		case lastRun.IsZero():
			logging.Info("AutoTagger: no previous run recorded, performing full pass")
		default:
			a.runIncrementalPass(ctx, lastRun, start)
			return
		}
	}

	a.runFullPass(ctx, start)
}

// runIncrementalPass fetches only files changed since lastRun and processes them.
func (a *AutoTagger) runIncrementalPass(ctx context.Context, lastRun, start time.Time) {
	logging.Info("AutoTagger: incremental pass (changes since %v)", lastRun.Format(time.RFC3339))

	files, err := a.db.GetFilesUpdatedSince(ctx, lastRun)
	if err != nil {
		logging.Error("AutoTagger: failed to fetch updated files: %v", err)
		metrics.ExifTagErrorsTotal.Inc()
		return
	}

	tagged, failed := a.processFiles(ctx, files)
	duration := time.Since(start)

	if err := a.db.SetLastExifTagRun(ctx, time.Now()); err != nil {
		logging.Warn("AutoTagger: failed to record run time: %v", err)
	}

	metrics.ExifTagRunsTotal.WithLabelValues("incremental").Inc()
	metrics.ExifTagRunDuration.WithLabelValues("incremental").Observe(duration.Seconds())
	metrics.ExifTagLastRunDuration.Set(duration.Seconds())
	metrics.ExifTagLastTimestamp.Set(float64(time.Now().Unix()))

	logging.Info("AutoTagger: incremental pass complete in %v — tagged %d files, %d errors",
		duration.Round(time.Millisecond), tagged, failed)
}

// runFullPass pages through all media files and processes them.
func (a *AutoTagger) runFullPass(ctx context.Context, start time.Time) {
	logging.Info("AutoTagger: full pass (page size %d)", exifFetchPageSize)

	tagged, failed, total := 0, 0, 0
	offset := 0

	for {
		select {
		case <-a.stopChan:
			logging.Info("AutoTagger: stopped mid-full-pass after %d files", total)
			return
		default:
		}

		page, err := a.db.GetMediaFilesForThumbnailsPaged(ctx, offset, exifFetchPageSize)
		if err != nil {
			logging.Error("AutoTagger: failed to fetch files at offset %d: %v", offset, err)
			metrics.ExifTagErrorsTotal.Inc()
			break
		}
		if len(page) == 0 {
			break
		}

		t, f := a.processFiles(ctx, page)
		tagged += t
		failed += f
		total += len(page)
		offset += len(page)

		if len(page) < exifFetchPageSize {
			break
		}
	}

	duration := time.Since(start)

	if err := a.db.SetLastExifTagRun(ctx, time.Now()); err != nil {
		logging.Warn("AutoTagger: failed to record run time: %v", err)
	}

	metrics.ExifTagRunsTotal.WithLabelValues("full").Inc()
	metrics.ExifTagRunDuration.WithLabelValues("full").Observe(duration.Seconds())
	metrics.ExifTagLastRunDuration.Set(duration.Seconds())
	metrics.ExifTagLastTimestamp.Set(float64(time.Now().Unix()))

	logging.Info("AutoTagger: full pass complete in %v — scanned %d files, tagged %d, %d errors",
		duration.Round(time.Millisecond), total, tagged, failed)
}

// processFiles iterates over files, extracts EXIF tags, and merges them into
// the database.  It returns the number of files that had tags applied and the
// number that encountered errors.  Folders are silently skipped.
func (a *AutoTagger) processFiles(ctx context.Context, files []database.MediaFile) (tagged, failed int) {
	for _, f := range files {
		// Only images and videos carry EXIF/XMP metadata.
		if f.Type != database.FileTypeImage && f.Type != database.FileTypeVideo {
			continue
		}

		select {
		case <-a.stopChan:
			return
		default:
		}

		absPath := filepath.Join(a.mediaDir, f.Path)
		tags, err := extractTagsFromFile(ctx, absPath)
		if err != nil {
			logging.Debug("AutoTagger: skipping %s (ffprobe error): %v", f.Path, err)
			metrics.ExifTagFilesTotal.WithLabelValues("failed").Inc()
			failed++
			continue
		}
		if len(tags) == 0 {
			metrics.ExifTagFilesTotal.WithLabelValues("skipped").Inc()
			continue
		}

		if err := a.db.MergeExifTagsForFile(ctx, f.Path, tags); err != nil {
			logging.Error("AutoTagger: failed to merge tags for %s: %v", f.Path, err)
			metrics.ExifTagFilesTotal.WithLabelValues("failed").Inc()
			metrics.ExifTagErrorsTotal.Inc()
			failed++
			continue
		}

		logging.Debug("AutoTagger: applied tags %v to %s", tags, f.Path)
		metrics.ExifTagFilesTotal.WithLabelValues("tagged").Inc()
		tagged++
	}
	return
}
