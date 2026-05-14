package handlers

import (
	"net/http"
	"time"

	"media-viewer/internal/autotagger"
	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
)

// ProgressMetrics describes elapsed time, throughput, and ETA information for a worker run.
type ProgressMetrics struct {
	ElapsedSeconds            *float64   `json:"elapsedSeconds,omitempty"`
	ProcessedItems            int64      `json:"processedItems"`
	TotalItems                *int64     `json:"totalItems,omitempty"`
	RemainingItems            *int64     `json:"remainingItems,omitempty"`
	ProgressPercent           *float64   `json:"progressPercent,omitempty"`
	ItemsPerSecond            *float64   `json:"itemsPerSecond,omitempty"`
	EstimatedSecondsRemaining *float64   `json:"estimatedSecondsRemaining,omitempty"`
	EstimatedCompletion       *time.Time `json:"estimatedCompletion,omitempty"`
}

// WorkerSummary describes whether a background worker is enabled and actively running.
type WorkerSummary struct {
	Enabled bool   `json:"enabled"`
	Running bool   `json:"running"`
	State   string `json:"state"`
}

// IndexerSystemStatus contains the current indexer summary, health snapshot, and progress metrics.
type IndexerSystemStatus struct {
	Summary WorkerSummary        `json:"summary"`
	Health  indexer.HealthStatus `json:"health"`
	Metrics ProgressMetrics      `json:"metrics"`
}

// ThumbnailSystemStatus contains thumbnail worker state, generator status, and progress metrics.
type ThumbnailSystemStatus struct {
	Summary WorkerSummary         `json:"summary"`
	Status  media.ThumbnailStatus `json:"status"`
	Metrics ProgressMetrics       `json:"metrics"`
}

// AutoTaggerSystemStatus contains autotagger state, latest run status, and progress metrics.
type AutoTaggerSystemStatus struct {
	Summary WorkerSummary     `json:"summary"`
	Status  autotagger.Status `json:"status"`
	Metrics ProgressMetrics   `json:"metrics"`
}

// SystemStatusResponse is the aggregate admin status payload returned by GetSystemStatus.
type SystemStatusResponse struct {
	UpdatedAt  time.Time              `json:"updatedAt"`
	Library    database.IndexStats    `json:"library"`
	Indexer    IndexerSystemStatus    `json:"indexer"`
	Thumbnails ThumbnailSystemStatus  `json:"thumbnails"`
	AutoTagger AutoTaggerSystemStatus `json:"autotagger"`
}

// GetSystemStatus returns aggregate worker and cache status for the admin UI.
func (h *Handlers) GetSystemStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response := SystemStatusResponse{
		UpdatedAt:  time.Now().UTC(),
		Library:    h.buildLibrarySystemStatus(r),
		Indexer:    h.buildIndexerSystemStatus(),
		Thumbnails: h.buildThumbnailSystemStatus(),
		AutoTagger: h.buildAutoTaggerSystemStatus(),
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, response)
}

func (h *Handlers) buildLibrarySystemStatus(r *http.Request) database.IndexStats {
	if h.db == nil {
		return database.IndexStats{}
	}

	stats := h.db.GetStats()
	if r != nil {
		ctx := r.Context()
		stats.TotalFavorites = h.db.GetFavoriteCount(ctx)
		stats.TotalTags = h.db.GetTagCount(ctx)
	}

	if h.thumbGen != nil {
		if thumbnailSize, thumbnailCount, err := h.thumbGen.GetCacheSize(); err == nil {
			stats.ThumbnailCacheBytes = thumbnailSize
			stats.ThumbnailCacheFiles = thumbnailCount
		}
	}

	if h.transcoder != nil {
		if transcodeSize, transcodeCount, err := h.transcoder.GetCacheSize(); err == nil {
			stats.TranscodeCacheBytes = transcodeSize
			stats.TranscodeCacheFiles = transcodeCount
		}
	}

	return stats
}

func (h *Handlers) buildIndexerSystemStatus() IndexerSystemStatus {
	if h.indexer == nil {
		return IndexerSystemStatus{Summary: workerSummary(false, false)}
	}

	health := h.indexer.GetHealthStatus()
	processed := health.FilesIndexed + health.FoldersIndexed
	metrics := ProgressMetrics{ProcessedItems: processed}
	if health.IndexProgress != nil {
		metrics = deriveProgressMetrics(health.IndexProgress.StartedAt, processed, nil, health.Indexing)
	}

	return IndexerSystemStatus{
		Summary: workerSummary(true, health.Indexing),
		Health:  health,
		Metrics: metrics,
	}
}

func (h *Handlers) buildThumbnailSystemStatus() ThumbnailSystemStatus {
	if h.thumbGen == nil {
		return ThumbnailSystemStatus{Summary: workerSummary(false, false)}
	}

	status := h.thumbGen.GetStatus()
	running := status.Generation != nil && status.Generation.InProgress
	metrics := ProgressMetrics{}
	if status.Generation != nil {
		total := int64(status.Generation.TotalFiles)
		processed := int64(status.Generation.Processed)
		metrics = deriveProgressMetrics(status.Generation.StartedAt, processed, &total, running)
	}

	return ThumbnailSystemStatus{
		Summary: workerSummary(status.Enabled, running),
		Status:  status,
		Metrics: metrics,
	}
}

func (h *Handlers) buildAutoTaggerSystemStatus() AutoTaggerSystemStatus {
	if h.autoTagger == nil {
		return AutoTaggerSystemStatus{Summary: workerSummary(false, false)}
	}

	status := h.autoTagger.Status()
	total := int64(status.Run.TotalFiles)
	metrics := deriveProgressMetrics(status.Run.StartedAt, int64(status.Run.Processed), &total, status.Run.InProgress)

	return AutoTaggerSystemStatus{
		Summary: workerSummary(h.autoTagger.Enabled(), status.Run.InProgress),
		Status:  status,
		Metrics: metrics,
	}
}

func workerSummary(enabled, running bool) WorkerSummary {
	state := "idle"
	if !enabled {
		state = "disabled"
	} else if running {
		state = "running"
	}

	return WorkerSummary{
		Enabled: enabled,
		Running: running,
		State:   state,
	}
}

func deriveProgressMetrics(startedAt time.Time, processed int64, total *int64, running bool) ProgressMetrics {
	metrics := ProgressMetrics{ProcessedItems: processed}
	if total != nil && *total > 0 {
		totalItems := *total
		metrics.TotalItems = &totalItems
		remaining := totalItems - processed
		if remaining < 0 {
			remaining = 0
		}
		metrics.RemainingItems = &remaining
		progressPercent := float64(processed) / float64(totalItems) * 100
		metrics.ProgressPercent = &progressPercent
	}

	if !running {
		return metrics
	}

	if startedAt.IsZero() {
		return metrics
	}

	elapsed := time.Since(startedAt).Seconds()
	if elapsed <= 0 {
		return metrics
	}

	metrics.ElapsedSeconds = &elapsed
	if processed <= 0 {
		return metrics
	}

	rate := float64(processed) / elapsed
	metrics.ItemsPerSecond = &rate

	if total == nil || *total <= 0 || processed >= *total {
		return metrics
	}

	remaining := float64(*total - processed)
	etaSeconds := remaining / rate
	metrics.EstimatedSecondsRemaining = &etaSeconds
	eta := time.Now().Add(time.Duration(etaSeconds * float64(time.Second))).UTC()
	metrics.EstimatedCompletion = &eta

	return metrics
}
