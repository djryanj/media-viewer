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

	TranscoderCacheSizeBytes = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_transcoder_cache_size_bytes",
			Help: "Total size of the transcoder cache directory in bytes",
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

// Filesystem I/O metrics
var (
	FilesystemOperationDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "media_viewer_filesystem_operation_duration_seconds",
			Help:    "Duration of filesystem operations by directory and operation type",
			Buckets: []float64{0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5},
		},
		[]string{"directory", "operation"}, // directory: media/cache/database, operation: read/write/stat/readdir
	)

	FilesystemOperationErrors = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "media_viewer_filesystem_operation_errors_total",
			Help: "Total number of filesystem operation errors by directory and operation",
		},
		[]string{"directory", "operation"},
	)
)

// Enhanced indexer metrics
var (
	IndexerRunDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "media_viewer_indexer_run_duration_seconds",
			Help:    "Distribution of indexer run durations",
			Buckets: []float64{1, 5, 10, 30, 60, 120, 300, 600, 1200, 1800}, // 1s to 30min
		},
	)

	IndexerBatchProcessingDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "media_viewer_indexer_batch_duration_seconds",
			Help:    "Duration of indexer batch database operations",
			Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
		},
	)

	IndexerFilesPerSecond = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_indexer_files_per_second",
			Help: "Indexing throughput in files per second",
		},
	)

	IndexerParallelWorkers = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_indexer_parallel_workers",
			Help: "Number of parallel workers used in last index run",
		},
	)
)

// Enhanced thumbnail metrics
var (
	ThumbnailMemoryUsageBytes = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "media_viewer_thumbnail_memory_usage_bytes",
			Help: "Memory allocated during thumbnail generation by type",
			// Buckets from 1MB to 500MB
			Buckets: []float64{1e6, 5e6, 10e6, 25e6, 50e6, 100e6, 250e6, 500e6},
		},
		[]string{"type"}, // image/video/folder
	)

	ThumbnailGenerationDurationDetailed = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "media_viewer_thumbnail_generation_duration_detailed_seconds",
			Help: "Detailed distribution of thumbnail generation times by type and phase",
			// Buckets from 1ms to 60s
			Buckets: []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60},
		},
		[]string{"type", "phase"}, // phase: decode/resize/encode/cache
	)

	ThumbnailFFmpegDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "media_viewer_thumbnail_ffmpeg_duration_seconds",
			Help:    "Duration of FFmpeg operations for thumbnail generation",
			Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 20, 30},
		},
		[]string{"media_type"}, // image/video
	)

	ThumbnailImageDecodeByFormat = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "media_viewer_thumbnail_image_decode_duration_seconds",
			Help:    "Image decoding duration by format",
			Buckets: []float64{0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5},
		},
		[]string{"format"}, // jpeg/png/gif/webp
	)

	ThumbnailBatchProcessingRate = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "media_viewer_thumbnail_batch_processing_rate",
			Help: "Current thumbnail generation rate in files per second",
		},
	)
)

// Database performance metrics
var (
	DBTransactionDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "media_viewer_db_transaction_duration_seconds",
			Help:    "Database transaction duration by type",
			Buckets: []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10},
		},
		[]string{"type"}, // batch_insert/batch_update/cleanup
	)

	DBRowsAffected = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "media_viewer_db_rows_affected",
			Help:    "Number of rows affected by database operations",
			Buckets: []float64{1, 10, 50, 100, 500, 1000, 5000, 10000},
		},
		[]string{"operation"},
	)
)

// Cache performance metrics
var (
	ThumbnailCacheReadLatency = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "media_viewer_thumbnail_cache_read_latency_seconds",
			Help:    "Latency of thumbnail cache reads",
			Buckets: []float64{0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1},
		},
	)

	ThumbnailCacheWriteLatency = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "media_viewer_thumbnail_cache_write_latency_seconds",
			Help:    "Latency of thumbnail cache writes",
			Buckets: []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1},
		},
	)
)

// File processing metrics
var (
	FileHashComputeDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "media_viewer_file_hash_compute_duration_seconds",
			Help:    "Duration of file hash computation",
			Buckets: []float64{0.00001, 0.0001, 0.001, 0.01, 0.1, 1},
		},
	)

	DirectoryWalkDepth = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "media_viewer_directory_walk_depth",
			Help:    "Distribution of directory depth during walks",
			Buckets: []float64{1, 2, 3, 5, 10, 15, 20, 30},
		},
	)
)
