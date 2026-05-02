package autotagger

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
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
	exifFetchPageSize  = 500
	runTypeFull        = "full"
	runTypeIncremental = "incremental"
)

var errAutoTaggerStopped = errors.New("autotagger stopped")

// RunStatus tracks autotagger progress for the active or most recent run.
type RunStatus struct {
	InProgress    bool      `json:"inProgress"`
	StartedAt     time.Time `json:"startedAt,omitempty"`
	LastCompleted time.Time `json:"lastCompleted,omitempty"`
	CurrentFile   string    `json:"currentFile,omitempty"`
	IsIncremental bool      `json:"isIncremental"`
	TotalFiles    int       `json:"totalFiles"`
	Processed     int       `json:"processed"`
	Tagged        int       `json:"tagged"`
	Skipped       int       `json:"skipped"`
	Failed        int       `json:"failed"`
	LastError     string    `json:"lastError,omitempty"`
}

// Status exposes the current or most recent autotagger run state.
type Status struct {
	Run RunStatus `json:"run"`
}

type runStats = RunStatus

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
	runMu           sync.RWMutex
	runStats        runStats
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
		return
	}
	logging.Debug("AutoTagger: enabled for media dir %s", a.mediaDir)
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

// Status returns a snapshot of the current or most recent run state.
func (a *AutoTagger) Status() Status {
	a.runMu.RLock()
	stats := a.runStats
	a.runMu.RUnlock()

	return Status{Run: stats}
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
	logging.Debug("AutoTagger: run requested (incremental=%t)", incremental)

	// Guard against concurrent passes.
	if !a.isRunning.CompareAndSwap(false, true) {
		logging.Info("AutoTagger: pass already in progress, skipping new request")
		return
	}
	defer a.isRunning.Store(false)

	metrics.ExifTagRunning.Set(1)
	defer metrics.ExifTagRunning.Set(0)

	ctx := context.Background()
	start := time.Now()
	actualIncremental := incremental

	if incremental {
		lastRun, err := a.db.GetLastExifTagRun(ctx)
		switch {
		case err != nil:
			logging.Warn("AutoTagger: failed to read last run time, falling back to full pass: %v", err)
			metrics.ExifTagErrorsTotal.Inc()
			actualIncremental = false
		case lastRun.IsZero():
			logging.Info("AutoTagger: no previous run recorded, performing full pass")
			actualIncremental = false
		default:
			a.beginRun(start, true)
			heartbeatDone := a.startHeartbeat(start, true)
			completedAt, runErr := a.runIncrementalPass(ctx, lastRun)
			close(heartbeatDone)
			a.finishRun(start, true, completedAt, runErr)
			return
		}
	}

	a.beginRun(start, actualIncremental)
	heartbeatDone := a.startHeartbeat(start, actualIncremental)
	completedAt, runErr := a.runFullPass(ctx)
	close(heartbeatDone)
	a.finishRun(start, false, completedAt, runErr)
}

// runIncrementalPass fetches only files changed since lastRun and processes them.
func (a *AutoTagger) runIncrementalPass(ctx context.Context, lastRun time.Time) (time.Time, error) {
	logging.Info("AutoTagger: starting incremental pass (changes since %v)", lastRun.Format(time.RFC3339))

	files, err := a.db.GetFilesUpdatedSince(ctx, lastRun)
	if err != nil {
		metrics.ExifTagErrorsTotal.Inc()
		return time.Time{}, err
	}

	files = filterTaggableFiles(files)
	a.setTotalFiles(len(files))
	logging.Info("AutoTagger: incremental pass discovered %d eligible files", len(files))

	if len(files) == 0 {
		completedAt := time.Now()
		if err := a.db.SetLastExifTagRun(ctx, completedAt); err != nil {
			logging.Warn("AutoTagger: failed to record run time: %v", err)
		}
		return completedAt, nil
	}

	if _, _, err := a.processFiles(ctx, files); err != nil {
		return time.Time{}, err
	}

	completedAt := time.Now()
	if err := a.db.SetLastExifTagRun(ctx, completedAt); err != nil {
		logging.Warn("AutoTagger: failed to record run time: %v", err)
	}

	return completedAt, nil
}

// runFullPass pages through all media files and processes them.
func (a *AutoTagger) runFullPass(ctx context.Context) (time.Time, error) {
	totalFiles, err := a.db.CountMediaFilesForAutoTagging(ctx)
	if err != nil {
		logging.Warn("AutoTagger: failed to count eligible files, continuing without total: %v", err)
		metrics.ExifTagErrorsTotal.Inc()
	} else {
		a.setTotalFiles(totalFiles)
	}

	if totalFiles > 0 {
		logging.Info("AutoTagger: starting full pass across %d eligible files (page size %d)", totalFiles, exifFetchPageSize)
	} else {
		logging.Info("AutoTagger: starting full pass (page size %d)", exifFetchPageSize)
	}

	offset := 0
	for {
		select {
		case <-a.stopChan:
			return time.Time{}, errAutoTaggerStopped
		default:
		}

		logging.Debug("AutoTagger: loading full-pass page offset=%d limit=%d", offset, exifFetchPageSize)
		page, err := a.db.GetMediaFilesForAutoTaggingPaged(ctx, offset, exifFetchPageSize)
		if err != nil {
			metrics.ExifTagErrorsTotal.Inc()
			return time.Time{}, err
		}
		logging.Debug("AutoTagger: full-pass page offset=%d returned %d files", offset, len(page))
		if len(page) == 0 {
			break
		}

		if _, _, err := a.processFiles(ctx, page); err != nil {
			return time.Time{}, err
		}
		offset += len(page)

		if len(page) < exifFetchPageSize {
			break
		}
	}

	completedAt := time.Now()
	if err := a.db.SetLastExifTagRun(ctx, completedAt); err != nil {
		logging.Warn("AutoTagger: failed to record run time: %v", err)
	}
	return completedAt, nil
}

func (a *AutoTagger) beginRun(startTime time.Time, incremental bool) {
	a.runMu.Lock()
	a.runStats = runStats{
		InProgress:    true,
		StartedAt:     startTime,
		IsIncremental: incremental,
	}
	stats := a.runStats
	a.runMu.Unlock()
	a.updateCurrentRunMetrics(stats)
}

func (a *AutoTagger) startHeartbeat(startTime time.Time, incremental bool) chan struct{} {
	done := make(chan struct{})

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				a.logStillRunning(startTime, incremental)
			case <-done:
				return
			case <-a.stopChan:
				return
			}
		}
	}()

	return done
}

func (a *AutoTagger) finishRun(startTime time.Time, incremental bool, completedAt time.Time, runErr error) {
	duration := time.Since(startTime)
	runType := runTypeFull
	if incremental {
		runType = runTypeIncremental
	}

	a.runMu.Lock()
	a.runStats.InProgress = false
	a.runStats.CurrentFile = ""
	a.runStats.LastError = ""
	if runErr != nil {
		a.runStats.LastError = runErr.Error()
	}
	if !completedAt.IsZero() {
		a.runStats.LastCompleted = completedAt
	}
	stats := a.runStats
	a.runMu.Unlock()

	a.resetCurrentRunMetrics()
	a.updateLastRunMetrics(stats)

	if runErr == nil {
		metrics.ExifTagRunsTotal.WithLabelValues(runType).Inc()
		metrics.ExifTagRunDuration.WithLabelValues(runType).Observe(duration.Seconds())
		metrics.ExifTagLastRunDuration.Set(duration.Seconds())
		metrics.ExifTagLastTimestamp.Set(float64(completedAt.Unix()))
		logging.Info("AutoTagger: %s pass complete in %v: processed %d/%d files, tagged %d, skipped %d, failed %d",
			runType,
			duration.Round(time.Millisecond),
			stats.Processed,
			stats.TotalFiles,
			stats.Tagged,
			stats.Skipped,
			stats.Failed)
		return
	}

	if errors.Is(runErr, errAutoTaggerStopped) {
		logging.Info("AutoTagger: %s pass stopped after %v: processed %d/%d files, tagged %d, skipped %d, failed %d",
			runType,
			duration.Round(time.Millisecond),
			stats.Processed,
			stats.TotalFiles,
			stats.Tagged,
			stats.Skipped,
			stats.Failed)
		return
	}

	logging.Error("AutoTagger: %s pass failed after %v: processed %d/%d files, tagged %d, skipped %d, failed %d: %v",
		runType,
		duration.Round(time.Millisecond),
		stats.Processed,
		stats.TotalFiles,
		stats.Tagged,
		stats.Skipped,
		stats.Failed,
		runErr)
}

// processFiles iterates over files, extracts EXIF tags, and merges them into
// the database. Folders are silently skipped.
func (a *AutoTagger) processFiles(ctx context.Context, files []database.MediaFile) (tagged, failed int, err error) {
	for _, f := range files {
		// Only images and videos carry EXIF/XMP metadata.
		if f.Type != database.FileTypeImage && f.Type != database.FileTypeVideo {
			continue
		}

		select {
		case <-a.stopChan:
			return tagged, failed, errAutoTaggerStopped
		default:
		}

		a.setCurrentFile(f.Path)
		logging.Debug("AutoTagger: processing %s (type: %s)", f.Path, f.Type)
		absPath := filepath.Join(a.mediaDir, f.Path)
		tags, err := extractTagsFromFile(ctx, absPath)
		if err != nil {
			logging.Warn("AutoTagger: metadata extraction failed for %s: %v", f.Path, err)
			metrics.ExifTagFilesTotal.WithLabelValues("failed").Inc()
			metrics.ExifTagErrorsTotal.Inc()
			a.recordOutcome("failed")
			failed++
			continue
		}
		if len(tags) == 0 {
			logging.Debug("AutoTagger: no embedded tags found for %s", f.Path)
			metrics.ExifTagFilesTotal.WithLabelValues("skipped").Inc()
			a.recordOutcome("skipped")
			continue
		}

		logging.Debug("AutoTagger: extracted tags %v from %s", tags, f.Path)

		if err := a.db.MergeExifTagsForFile(ctx, f.Path, tags); err != nil {
			logging.Error("AutoTagger: failed to merge tags for %s: %v", f.Path, err)
			metrics.ExifTagFilesTotal.WithLabelValues("failed").Inc()
			metrics.ExifTagErrorsTotal.Inc()
			a.recordOutcome("failed")
			failed++
			continue
		}

		logging.Debug("AutoTagger: applied tags %v to %s", tags, f.Path)
		metrics.ExifTagFilesTotal.WithLabelValues("tagged").Inc()
		a.recordOutcome("tagged")
		tagged++
	}
	return tagged, failed, nil
}

func filterTaggableFiles(files []database.MediaFile) []database.MediaFile {
	filtered := make([]database.MediaFile, 0, len(files))
	for _, file := range files {
		if file.Type == database.FileTypeImage || file.Type == database.FileTypeVideo {
			filtered = append(filtered, file)
		}
	}
	return filtered
}

const (
	autoTagStatusTotal     = "total"
	autoTagStatusProcessed = "processed"
	autoTagStatusTagged    = "tagged"
	autoTagStatusSkipped   = "skipped"
	autoTagStatusFailed    = "failed"
)

func (a *AutoTagger) setTotalFiles(total int) {
	a.runMu.Lock()
	a.runStats.TotalFiles = total
	stats := a.runStats
	a.runMu.Unlock()
	a.updateCurrentRunMetrics(stats)
}

func (a *AutoTagger) setCurrentFile(path string) {
	a.runMu.Lock()
	a.runStats.CurrentFile = path
	a.runMu.Unlock()
}

func (a *AutoTagger) recordOutcome(outcome string) {
	a.runMu.Lock()
	a.runStats.Processed++
	switch outcome {
	case autoTagStatusTagged:
		a.runStats.Tagged++
	case autoTagStatusSkipped:
		a.runStats.Skipped++
	case autoTagStatusFailed:
		a.runStats.Failed++
	}
	stats := a.runStats
	a.runMu.Unlock()
	a.updateCurrentRunMetrics(stats)
}

func (a *AutoTagger) logStillRunning(startTime time.Time, incremental bool) {
	a.runMu.RLock()
	stats := a.runStats
	a.runMu.RUnlock()

	runType := runTypeFull
	if incremental {
		runType = runTypeIncremental
	}

	elapsed := time.Since(startTime).Round(time.Second)
	if stats.TotalFiles > 0 {
		logging.Info("AutoTagger still running (%s), elapsed time: %v, processed %d/%d files (tagged %d, skipped %d, failed %d)",
			runType,
			elapsed,
			stats.Processed,
			stats.TotalFiles,
			stats.Tagged,
			stats.Skipped,
			stats.Failed)
		return
	}

	logging.Info("AutoTagger still running (%s), elapsed time: %v, processed %d files (tagged %d, skipped %d, failed %d)",
		runType,
		elapsed,
		stats.Processed,
		stats.Tagged,
		stats.Skipped,
		stats.Failed)
}

func (a *AutoTagger) updateCurrentRunMetrics(stats runStats) {
	metrics.ExifTagCurrentRunFiles.WithLabelValues(autoTagStatusTotal).Set(float64(stats.TotalFiles))
	metrics.ExifTagCurrentRunFiles.WithLabelValues(autoTagStatusProcessed).Set(float64(stats.Processed))
	metrics.ExifTagCurrentRunFiles.WithLabelValues(autoTagStatusTagged).Set(float64(stats.Tagged))
	metrics.ExifTagCurrentRunFiles.WithLabelValues(autoTagStatusSkipped).Set(float64(stats.Skipped))
	metrics.ExifTagCurrentRunFiles.WithLabelValues(autoTagStatusFailed).Set(float64(stats.Failed))
}

func (a *AutoTagger) resetCurrentRunMetrics() {
	for _, status := range []string{autoTagStatusTotal, autoTagStatusProcessed, autoTagStatusTagged, autoTagStatusSkipped, autoTagStatusFailed} {
		metrics.ExifTagCurrentRunFiles.WithLabelValues(status).Set(0)
	}
}

func (a *AutoTagger) updateLastRunMetrics(stats runStats) {
	metrics.ExifTagLastRunFiles.WithLabelValues(autoTagStatusTotal).Set(float64(stats.TotalFiles))
	metrics.ExifTagLastRunFiles.WithLabelValues(autoTagStatusProcessed).Set(float64(stats.Processed))
	metrics.ExifTagLastRunFiles.WithLabelValues(autoTagStatusTagged).Set(float64(stats.Tagged))
	metrics.ExifTagLastRunFiles.WithLabelValues(autoTagStatusSkipped).Set(float64(stats.Skipped))
	metrics.ExifTagLastRunFiles.WithLabelValues(autoTagStatusFailed).Set(float64(stats.Failed))
}
