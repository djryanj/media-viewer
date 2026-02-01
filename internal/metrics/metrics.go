package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// HTTP metrics
var (
	HTTPRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "media_viewer_http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"method", "path", "status"},
	)

	HTTPRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "media_viewer_http_request_duration_seconds",
			Help:    "HTTP request duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "path"},
	)

	HTTPRequestsInFlight = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_http_requests_in_flight",
			Help: "Number of HTTP requests currently being processed",
		},
	)
)

// Database metrics
var (
	DBQueryTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "media_viewer_db_queries_total",
			Help: "Total number of database queries",
		},
		[]string{"operation", "status"},
	)

	DBQueryDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "media_viewer_db_query_duration_seconds",
			Help:    "Database query duration in seconds",
			Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
		},
		[]string{"operation"},
	)

	DBConnectionsOpen = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_db_connections_open",
			Help: "Number of open database connections",
		},
	)

	DBSizeBytes = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "media_viewer_db_size_bytes",
			Help: "Size of SQLite database files in bytes",
		},
		[]string{"file"}, // "main", "wal", "shm"
	)
)

// Indexer metrics
var (
	IndexerRunsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_indexer_runs_total",
			Help: "Total number of indexer runs",
		},
	)

	IndexerLastRunTimestamp = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_indexer_last_run_timestamp",
			Help: "Timestamp of the last indexer run",
		},
	)

	IndexerLastRunDuration = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_indexer_last_run_duration_seconds",
			Help: "Duration of the last indexer run in seconds",
		},
	)

	IndexerFilesProcessed = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_indexer_files_processed_total",
			Help: "Total number of files processed by the indexer",
		},
	)

	IndexerFoldersProcessed = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_indexer_folders_processed_total",
			Help: "Total number of folders processed by the indexer",
		},
	)

	IndexerErrors = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_indexer_errors_total",
			Help: "Total number of indexer errors",
		},
	)

	IndexerIsRunning = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_indexer_running",
			Help: "Whether the indexer is currently running (1 = running, 0 = idle)",
		},
	)
)

// Thumbnail metrics
var (
	ThumbnailGenerationsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "media_viewer_thumbnail_generations_total",
			Help: "Total number of thumbnail generations",
		},
		[]string{"type", "status"},
	)

	ThumbnailGenerationDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "media_viewer_thumbnail_generation_duration_seconds",
			Help:    "Thumbnail generation duration in seconds",
			Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
		},
		[]string{"type"},
	)

	ThumbnailCacheHits = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_thumbnail_cache_hits_total",
			Help: "Total number of thumbnail cache hits",
		},
	)

	ThumbnailCacheMisses = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_thumbnail_cache_misses_total",
			Help: "Total number of thumbnail cache misses",
		},
	)

	ThumbnailCacheSize = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_thumbnail_cache_size_bytes",
			Help: "Total size of the thumbnail cache in bytes",
		},
	)

	ThumbnailCacheCount = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_thumbnail_cache_count",
			Help: "Number of thumbnails in the cache",
		},
	)

	ThumbnailGeneratorRunning = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_thumbnail_generator_running",
			Help: "Whether the thumbnail generator is currently running (1 = running, 0 = idle)",
		},
	)

	ThumbnailGenerationBatchComplete = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "media_viewer_thumbnail_generation_batches_total",
			Help: "Total number of thumbnail generation batches completed",
		},
		[]string{"type"}, // "full" or "manual"
	)

	ThumbnailGenerationLastDuration = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_thumbnail_generation_last_duration_seconds",
			Help: "Duration of the last thumbnail generation run in seconds",
		},
	)

	ThumbnailGenerationLastTimestamp = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_thumbnail_generation_last_timestamp",
			Help: "Unix timestamp of the last thumbnail generation completion",
		},
	)

	ThumbnailGenerationFilesTotal = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "media_viewer_thumbnail_generation_files",
			Help: "Number of files in the last generation run by status",
		},
		[]string{"status"}, // "generated", "skipped", "failed"
	)
)

// Media library metrics
var (
	MediaFilesTotal = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "media_viewer_media_files_total",
			Help: "Total number of media files by type",
		},
		[]string{"type"},
	)

	MediaFoldersTotal = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_media_folders_total",
			Help: "Total number of folders",
		},
	)

	MediaFavoritesTotal = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_favorites_total",
			Help: "Total number of favorites",
		},
	)

	MediaTagsTotal = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_tags_total",
			Help: "Total number of tags",
		},
	)
)

// Transcoder metrics
var (
	TranscoderJobsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "media_viewer_transcoder_jobs_total",
			Help: "Total number of transcoding jobs",
		},
		[]string{"status"},
	)

	TranscoderJobDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "media_viewer_transcoder_job_duration_seconds",
			Help:    "Transcoding job duration in seconds",
			Buckets: []float64{1, 5, 10, 30, 60, 120, 300, 600},
		},
	)

	TranscoderJobsInProgress = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_transcoder_jobs_in_progress",
			Help: "Number of transcoding jobs currently in progress",
		},
	)
)

// Authentication metrics
var (
	AuthAttemptsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "media_viewer_auth_attempts_total",
			Help: "Total number of authentication attempts",
		},
		[]string{"status"},
	)

	ActiveSessions = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_active_sessions",
			Help: "Number of active user sessions",
		},
	)
)

// Application info metric
var (
	AppInfo = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "media_viewer_app_info",
			Help: "Application information",
		},
		[]string{"version", "commit", "go_version"},
	)
)

// SetAppInfo sets the application info metric
func SetAppInfo(version, commit, goVersion string) {
	AppInfo.WithLabelValues(version, commit, goVersion).Set(1)
}

// Memory metrics
var (
	MemoryUsageRatio = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_memory_usage_ratio",
			Help: "Memory usage as a ratio of the limit (0.0-1.0)",
		},
	)

	MemoryPaused = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_memory_paused",
			Help: "Whether processing is paused due to memory pressure (1 = paused, 0 = running)",
		},
	)

	MemoryGCPauses = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_memory_gc_pauses_total",
			Help: "Total number of times processing was paused due to memory pressure",
		},
	)
)

// Memory metrics
var (
	GoMemLimit = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_go_memlimit_bytes",
			Help: "Configured GOMEMLIMIT in bytes",
		},
	)

	GoMemAllocBytes = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_go_memalloc_bytes",
			Help: "Current Go heap allocation in bytes",
		},
	)

	GoMemSysBytes = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_go_memsys_bytes",
			Help: "Total memory obtained from the OS by Go runtime",
		},
	)

	GoGCRuns = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_go_gc_runs_total",
			Help: "Total number of completed GC cycles",
		},
	)
)

// Polling-based change detection metrics
var (
	IndexerPollChecksTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_indexer_poll_checks_total",
			Help: "Total number of polling checks for file changes",
		},
	)

	IndexerPollChangesDetected = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "media_viewer_indexer_poll_changes_detected_total",
			Help: "Total number of times polling detected changes",
		},
	)

	IndexerPollDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "media_viewer_indexer_poll_duration_seconds",
			Help:    "Duration of polling change detection scans",
			Buckets: []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10},
		},
	)
)
