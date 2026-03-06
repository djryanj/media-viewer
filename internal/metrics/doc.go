// Package metrics provides Prometheus instrumentation for the media-viewer application.
//
// This package defines and exposes various metrics that can be scraped by Prometheus
// to monitor the health, performance, and behavior of the application. All metrics
// are prefixed with "media_viewer_" to avoid naming collisions with other applications.
//
// # Metric Categories
//
// The metrics are organized into the following categories:
//
// ## HTTP Metrics
//
// Track HTTP request performance and error rates:
//   - HTTPRequestsTotal: Counter of total requests by method, path, and status
//   - HTTPRequestDuration: Histogram of request duration by method and path
//   - HTTPRequestsInFlight: Gauge of currently processing requests
//
// ## Database Metrics
//
// Monitor database query performance and storage:
//   - DBQueryTotal: Counter of queries by operation and status
//   - DBQueryDuration: Histogram of query duration by operation
//   - DBConnectionsOpen: Gauge of open database connections
//   - DBSizeBytes: Gauge of database file sizes (main, WAL, SHM)
//
// ## WAL Checkpoint Metrics
//
// Monitor SQLite WAL checkpoint behavior.  Unexpected spikes in these metrics
// are early warning signs of checkpoint-related write stalls.
//
//   - DBWALCheckpointTotal: CounterVec by mode ("passive"/"truncate").
//     A non-zero rate for mode="truncate" outside of a planned restart
//     indicates the blocking checkpoint is being called on a hot path.
//   - DBWALCheckpointDuration: HistogramVec by mode.  PASSIVE observations
//     above ~100 ms indicate I/O pressure; TRUNCATE observations above a few
//     seconds indicate long-lived reader transactions stalling truncation.
//   - DBWALPages: GaugeVec — log (total WAL frames), checkpointed (frames
//     written to main db), busy (frames left behind due to active readers).
//   - DBWALCheckpointBlockedTotal: Counter incremented when busy > 0 after
//     any checkpoint.  A sustained non-zero rate means WAL frames are
//     accumulating because active readers are holding WAL snapshots.
//   - DBWriterWaitTotal: Gauge mirroring the cumulative sql.DBStats.WaitCount
//     for the writer connection pool.  Because the writer pool is capped at
//     one connection (MaxOpenConns=1), any call that arrives while a write is
//     in progress increments this counter.  Use rate() to detect contention.
//   - DBWriterWaitSeconds: Gauge mirroring the cumulative WaitDuration for the
//     writer pool.  Divide by DBWriterWaitTotal rate to get mean wait latency.
//
// ## Indexer Metrics
//
// Track media library indexing operations:
//   - IndexerRunsTotal: Counter of indexer runs
//   - IndexerLastRunTimestamp: Gauge of last run time
//   - IndexerLastRunDuration: Gauge of last run duration
//   - IndexerFilesProcessed: Counter of files processed
//   - IndexerFoldersProcessed: Counter of folders processed
//   - IndexerErrors: Counter of indexer errors
//   - IndexerIsRunning: Gauge indicating if indexer is active
//   - IndexerPollChecksTotal: Counter of polling checks for file changes
//   - IndexerPollChangesDetected: Counter of times polling detected changes
//   - IndexerPollDuration: Histogram of polling scan duration
//
// ## Thumbnail Metrics
//
// Monitor thumbnail generation and caching:
//   - ThumbnailGenerationsTotal: Counter by type (image/video/folder) and status
//   - ThumbnailGenerationDuration: Histogram of generation time by type
//   - ThumbnailCacheHits: Counter of cache hits
//   - ThumbnailCacheMisses: Counter of cache misses
//   - ThumbnailCacheSize: Gauge of cache size in bytes
//   - ThumbnailCacheCount: Gauge of cached thumbnail count
//   - ThumbnailGeneratorRunning: Gauge indicating if background generation is active
//   - ThumbnailGenerationBatchComplete: Counter of completed generation batches by type
//   - ThumbnailGenerationLastDuration: Gauge of last generation run duration
//   - ThumbnailGenerationLastTimestamp: Gauge of last generation completion time
//   - ThumbnailGenerationFilesTotal: Gauge of files by status (generated/skipped/failed)
//
// ## Media Library Metrics
//
// Track media library contents:
//   - MediaFilesTotal: Gauge of files by type (image/video/playlist)
//   - MediaFoldersTotal: Gauge of total folders
//   - MediaTagsTotal: Gauge of total tags
//
// ## Transcoder Metrics
//
// Monitor video transcoding operations:
//   - TranscoderJobsTotal: Counter by status
//   - TranscoderJobDuration: Histogram of job duration
//   - TranscoderJobsInProgress: Gauge of active jobs
//   - TranscoderCacheSizeBytes: Gauge of cache directory size in bytes
//
// ## Authentication Metrics
//
// Track authentication activity:
//   - AuthAttemptsTotal: Counter by status (success/failure)
//   - ActiveSessions: Gauge of active user sessions
//
// ## Memory Metrics
//
// Monitor Go runtime memory and pressure:
//   - GoMemLimit: Gauge of configured GOMEMLIMIT
//   - GoMemAllocBytes: Gauge of current heap allocation
//   - GoMemSysBytes: Gauge of total memory from OS
//   - MemoryUsageRatio: Gauge of memory usage as ratio of limit (0.0-1.0)
//   - MemoryPaused: Gauge indicating if processing is paused due to memory pressure
//   - MemoryGCPauses: Counter of times processing was paused for memory
//
// ## Application Info
//
// Expose build information:
//   - AppInfo: Gauge with version, commit, and Go version labels
//
// # Usage
//
// Metrics are automatically registered with the default Prometheus registry
// using promauto. To expose them, mount the promhttp.Handler() on your
// metrics endpoint:
//
//	import "github.com/prometheus/client_golang/prometheus/promhttp"
//
//	mux.Handle("/metrics", promhttp.Handler())
//
// # Recording Metrics
//
// To record metrics from other packages, import this package and use the
// exported metric variables:
//
//	import "media-viewer/internal/metrics"
//
//	// Increment a counter
//	metrics.HTTPRequestsTotal.WithLabelValues("GET", "/api/files", "200").Inc()
//
//	// Observe a histogram value
//	metrics.HTTPRequestDuration.WithLabelValues("GET", "/api/files").Observe(0.123)
//
//	// Set a gauge value
//	metrics.DBConnectionsOpen.Set(5)
//
// # Collector
//
// The package provides a [Collector] type that periodically gathers
// statistics from a [StatsProvider] and updates the corresponding gauges.
// This is useful for metrics that need to be calculated from external
// sources like the database:
//
//	collector := metrics.NewCollector(statsProvider, dbPath, 1*time.Minute)
//	collector.Start()
//	defer collector.Stop()
//
// The collector automatically updates:
//   - Media library statistics (files, folders, tags)
//   - Database file sizes
//   - Go runtime memory statistics
//
// # Prometheus Queries
//
// Example PromQL queries for common use cases:
//
// Request rate by endpoint:
//
//	sum(rate(media_viewer_http_requests_total[5m])) by (path)
//
// P95 response time:
//
//	histogram_quantile(0.95, sum(rate(media_viewer_http_request_duration_seconds_bucket[5m])) by (le))
//
// Error rate:
//
//	sum(rate(media_viewer_http_requests_total{status=~"5.."}[5m])) / sum(rate(media_viewer_http_requests_total[5m]))
//
// Thumbnail cache hit rate:
//
//	rate(media_viewer_thumbnail_cache_hits_total[5m]) /
//	(rate(media_viewer_thumbnail_cache_hits_total[5m]) + rate(media_viewer_thumbnail_cache_misses_total[5m]))
//
// Database query latency by operation:
//
//	histogram_quantile(0.95, sum(rate(media_viewer_db_query_duration_seconds_bucket[5m])) by (le, operation))
//
// Memory pressure events:
//
//	rate(media_viewer_memory_gc_pauses_total[1h])
//
// Indexer polling efficiency (changes detected per poll):
//
//	rate(media_viewer_indexer_poll_changes_detected_total[1h]) /
//	rate(media_viewer_indexer_poll_checks_total[1h])
//
// Thumbnail generation success rate:
//
//	media_viewer_thumbnail_generation_files{status="generated"} /
//	(media_viewer_thumbnail_generation_files{status="generated"} +
//	 media_viewer_thumbnail_generation_files{status="failed"})
//
// WAL checkpoint blocking rate (non-zero rate = WAL frames left behind by
// active readers; sustained rate means the WAL file is growing):
//
//	rate(media_viewer_db_wal_checkpoint_blocked_total[5m])
//
// Writer connection wait rate (spike during bulk index = writer was held
// by a blocking checkpoint):
//
//	rate(media_viewer_db_writer_wait_total[1m])
//
// Mean writer wait latency per contention event:
//
//	rate(media_viewer_db_writer_wait_seconds_total[1m]) /
//	rate(media_viewer_db_writer_wait_total[1m])
//
// TRUNCATE checkpoint durations — alert if > 5 s during normal operation:
//
//	histogram_quantile(0.99, rate(media_viewer_db_wal_checkpoint_duration_seconds_bucket{mode="truncate"}[10m]))
package metrics
