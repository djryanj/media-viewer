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
// Monitor database query performance:
//   - DBQueryTotal: Counter of queries by operation and status
//   - DBQueryDuration: Histogram of query duration by operation
//   - DBConnectionsOpen: Gauge of open database connections
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
//   - ThumbnailGenerationBatchComplete: Counter of completed generation batches
//   - ThumbnailGenerationLastDuration: Gauge of last generation run duration
//   - ThumbnailGenerationLastTimestamp: Gauge of last generation completion time
//
// ## Media Library Metrics
//
// Track media library contents:
//   - MediaFilesTotal: Gauge of files by type (image/video/playlist)
//   - MediaFoldersTotal: Gauge of total folders
//   - MediaFavoritesTotal: Gauge of favorited items
//   - MediaTagsTotal: Gauge of total tags
//
// ## Transcoder Metrics
//
// Monitor video transcoding operations:
//   - TranscoderJobsTotal: Counter by status
//   - TranscoderJobDuration: Histogram of job duration
//   - TranscoderJobsInProgress: Gauge of active jobs
//
// ## Authentication Metrics
//
// Track authentication activity:
//   - AuthAttemptsTotal: Counter by status (success/failure)
//   - ActiveSessions: Gauge of active user sessions
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
// The package also provides a Collector type that periodically gathers
// statistics from a StatsProvider and updates the corresponding gauges.
// This is useful for metrics that need to be calculated from external
// sources like the database:
//
//	collector := metrics.NewCollector(statsProvider, 1*time.Minute)
//	collector.Start()
//	defer collector.Stop()
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
// Cache hit rate:
//
//	media_viewer_thumbnail_cache_hits_total / (media_viewer_thumbnail_cache_hits_total + media_viewer_thumbnail_cache_misses_total)
//
// Database query latency by operation:
//
//	histogram_quantile(0.95, sum(rate(media_viewer_db_query_duration_seconds_bucket[5m])) by (le, operation))
package metrics
