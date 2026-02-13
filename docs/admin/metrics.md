# Prometheus Metrics

Media Viewer exposes comprehensive Prometheus metrics for monitoring performance, resource usage, and system health.

## Accessing Metrics

Metrics are exposed at the `/metrics` endpoint:

```
http://your-server:9090/metrics
```

Note that the port (`9090`) is configurable via the `METRICS_PORT` [environment variable](envrionment-variables.md#metrics-port).

This endpoint returns metrics in Prometheus text format, suitable for scraping by a Prometheus server.

## Metrics Categories

### HTTP Metrics

Monitor web server performance and request patterns.

| Metric                                       | Type      | Labels                     | Description                                          |
| -------------------------------------------- | --------- | -------------------------- | ---------------------------------------------------- |
| `media_viewer_http_requests_total`           | Counter   | `method`, `path`, `status` | Total HTTP requests by method, path, and status code |
| `media_viewer_http_request_duration_seconds` | Histogram | `method`, `path`           | HTTP request duration distribution                   |
| `media_viewer_http_requests_in_flight`       | Gauge     | -                          | Number of HTTP requests currently being processed    |

**Use cases:**

- Identify slow endpoints with request duration percentiles
- Monitor error rates by status code
- Track request throughput and patterns

### Database Metrics

Monitor SQLite database performance and health.

| Metric                                         | Type      | Labels                | Description                                             |
| ---------------------------------------------- | --------- | --------------------- | ------------------------------------------------------- |
| `media_viewer_db_queries_total`                | Counter   | `operation`, `status` | Total database queries by operation type and status     |
| `media_viewer_db_query_duration_seconds`       | Histogram | `operation`           | Database query duration distribution                    |
| `media_viewer_db_connections_open`             | Gauge     | -                     | Number of open database connections                     |
| `media_viewer_db_size_bytes`                   | Gauge     | `file`                | Size of SQLite files (main, WAL, SHM) in bytes          |
| `media_viewer_db_transaction_duration_seconds` | Histogram | `type`                | Transaction duration by type (commit/rollback)          |
| `media_viewer_db_rows_affected`                | Histogram | `operation`           | Rows affected by operations (upsert_file, delete_files) |

**Use cases:**

- Identify slow queries affecting performance
- Monitor database growth over time
- Track transaction performance during indexing
- Detect database lock contention

### Indexer Metrics

Monitor media library indexing performance.

| Metric                                           | Type      | Labels | Description                                    |
| ------------------------------------------------ | --------- | ------ | ---------------------------------------------- |
| `media_viewer_indexer_runs_total`                | Counter   | -      | Total number of indexer runs                   |
| `media_viewer_indexer_last_run_timestamp`        | Gauge     | -      | Unix timestamp of last indexer run             |
| `media_viewer_indexer_last_run_duration_seconds` | Gauge     | -      | Duration of last indexer run                   |
| `media_viewer_indexer_run_duration_seconds`      | Histogram | -      | Distribution of indexer run durations          |
| `media_viewer_indexer_files_processed_total`     | Counter   | -      | Total files processed by indexer               |
| `media_viewer_indexer_folders_processed_total`   | Counter   | -      | Total folders processed by indexer             |
| `media_viewer_indexer_files_per_second`          | Gauge     | -      | Indexing throughput (files per second)         |
| `media_viewer_indexer_errors_total`              | Counter   | -      | Total indexer errors                           |
| `media_viewer_indexer_running`                   | Gauge     | -      | Whether indexer is running (1=running, 0=idle) |
| `media_viewer_indexer_batch_duration_seconds`    | Histogram | -      | Duration of batch database operations          |
| `media_viewer_indexer_parallel_workers`          | Gauge     | -      | Number of parallel workers in last run         |

**Use cases:**

- Monitor indexing performance on NFS/network storage
- Identify indexing bottlenecks
- Track indexing throughput and efficiency
- Alert on indexer failures or long runs

#### Polling Metrics

Track change detection for automatic re-indexing.

| Metric                                             | Type      | Labels | Description                           |
| -------------------------------------------------- | --------- | ------ | ------------------------------------- |
| `media_viewer_indexer_poll_checks_total`           | Counter   | -      | Total polling checks for file changes |
| `media_viewer_indexer_poll_changes_detected_total` | Counter   | -      | Times polling detected changes        |
| `media_viewer_indexer_poll_duration_seconds`       | Histogram | -      | Duration of polling scans             |

### Thumbnail Metrics

Monitor thumbnail generation performance and cache efficiency.

| Metric                                                        | Type      | Labels           | Description                                           |
| ------------------------------------------------------------- | --------- | ---------------- | ----------------------------------------------------- |
| `media_viewer_thumbnail_generations_total`                    | Counter   | `type`, `status` | Total thumbnail generations by type and status        |
| `media_viewer_thumbnail_generation_duration_seconds`          | Histogram | `type`           | Overall thumbnail generation duration                 |
| `media_viewer_thumbnail_generation_duration_detailed_seconds` | Histogram | `type`, `phase`  | Detailed timing by phase (decode/resize/encode/cache) |
| `media_viewer_thumbnail_memory_usage_bytes`                   | Histogram | `type`           | Memory allocated during generation                    |
| `media_viewer_thumbnail_ffmpeg_duration_seconds`              | Histogram | `media_type`     | FFmpeg operation duration for images/videos           |
| `media_viewer_thumbnail_image_decode_duration_seconds`        | Histogram | `format`         | Image decoding duration by format (jpeg/png/gif/webp) |
| `media_viewer_thumbnail_cache_hits_total`                     | Counter   | -                | Total thumbnail cache hits                            |
| `media_viewer_thumbnail_cache_misses_total`                   | Counter   | -                | Total thumbnail cache misses                          |
| `media_viewer_thumbnail_cache_read_latency_seconds`           | Histogram | -                | Cache read latency distribution                       |
| `media_viewer_thumbnail_cache_write_latency_seconds`          | Histogram | -                | Cache write latency distribution                      |
| `media_viewer_thumbnail_cache_size_bytes`                     | Gauge     | -                | Total cache size in bytes                             |
| `media_viewer_thumbnail_cache_count`                          | Gauge     | -                | Number of thumbnails in cache                         |
| `media_viewer_thumbnail_generator_running`                    | Gauge     | -                | Whether generator is running (1=running, 0=idle)      |
| `media_viewer_thumbnail_batch_processing_rate`                | Gauge     | -                | Current generation rate (files per second)            |
| `media_viewer_thumbnail_generation_batches_total`             | Counter   | `type`           | Completed batches (full/manual)                       |
| `media_viewer_thumbnail_generation_last_duration_seconds`     | Gauge     | -                | Duration of last generation run                       |
| `media_viewer_thumbnail_generation_last_timestamp`            | Gauge     | -                | Unix timestamp of last completion                     |
| `media_viewer_thumbnail_generation_files`                     | Gauge     | `status`         | Files by status (generated/skipped/failed)            |

**Use cases:**

- Monitor cache hit rate to assess cache efficiency
- Identify expensive thumbnail operations (video vs image)
- Track memory usage during thumbnail generation
- Optimize thumbnail generation based on phase timing
- Alert on high cache miss rates

**Phase timing breakdown:**

- `decode`: FFmpeg decoding (videos) or image library decoding
- `resize`: Imaging library resize operation
- `encode`: PNG encoding for thumbnail output
- `cache`: Writing thumbnail to disk cache

### Filesystem Metrics

Monitor filesystem I/O performance, critical for NFS deployments.

| Metric                                               | Type      | Labels                   | Description                                         |
| ---------------------------------------------------- | --------- | ------------------------ | --------------------------------------------------- |
| `media_viewer_filesystem_operation_duration_seconds` | Histogram | `directory`, `operation` | Filesystem operation duration by directory and type |
| `media_viewer_filesystem_operation_errors_total`     | Counter   | `directory`, `operation` | Filesystem operation errors                         |

**Operations:** `stat`, `readdir`, `read`, `write`
**Directories:** Media path, cache path, database path

**Use cases:**

- Identify NFS latency issues during indexing
- Monitor cache directory performance
- Detect filesystem bottlenecks
- Compare performance across different storage paths

### Media Library Metrics

Track library size and content.

| Metric                             | Type  | Labels | Description                                |
| ---------------------------------- | ----- | ------ | ------------------------------------------ |
| `media_viewer_media_files_total`   | Gauge | `type` | Total files by type (image/video/playlist) |
| `media_viewer_media_folders_total` | Gauge | -      | Total folders in library                   |
| `media_viewer_favorites_total`     | Gauge | -      | Total favorites                            |
| `media_viewer_tags_total`          | Gauge | -      | Total tags                                 |

### Transcoder Metrics

Monitor video transcoding operations.

| Metric                                         | Type      | Labels   | Description                              |
| ---------------------------------------------- | --------- | -------- | ---------------------------------------- |
| `media_viewer_transcoder_jobs_total`           | Counter   | `status` | Total transcoding jobs by status         |
| `media_viewer_transcoder_job_duration_seconds` | Histogram | -        | Transcoding job duration distribution    |
| `media_viewer_transcoder_jobs_in_progress`     | Gauge     | -        | Transcoding jobs currently in progress   |
| `media_viewer_transcoder_cache_size_bytes`     | Gauge     | -        | Total size of transcoder cache directory |

**Use cases:**

- Monitor cache growth over time
- Track transcoding job success and failure rates
- Identify long-running transcoding operations
- Determine when cache cleanup is needed

### Authentication Metrics

Monitor authentication and session management.

| Metric                             | Type    | Labels   | Description                                         |
| ---------------------------------- | ------- | -------- | --------------------------------------------------- |
| `media_viewer_auth_attempts_total` | Counter | `status` | Authentication attempts by status (success/failure) |
| `media_viewer_active_sessions`     | Gauge   | -        | Number of active user sessions                      |

### Memory Metrics

Monitor memory usage and garbage collection.

| Metric                                   | Type    | Labels | Description                                         |
| ---------------------------------------- | ------- | ------ | --------------------------------------------------- |
| `media_viewer_memory_usage_ratio`        | Gauge   | -      | Memory usage as ratio of limit (0.0-1.0)            |
| `media_viewer_memory_paused`             | Gauge   | -      | Whether processing is paused due to memory pressure |
| `media_viewer_memory_gc_pauses_total`    | Counter | -      | Times processing was paused due to memory pressure  |
| `media_viewer_go_memlimit_bytes`         | Gauge   | -      | Configured GOMEMLIMIT in bytes                      |
| `media_viewer_go_memalloc_bytes`         | Gauge   | -      | Current Go heap allocation                          |
| `media_viewer_go_memsys_bytes`           | Gauge   | -      | Total memory obtained from OS                       |
| `media_viewer_go_gc_runs_total`          | Counter | -      | Completed garbage collection cycles                 |
| `media_viewer_go_gc_pause_total_seconds` | Counter | -      | Cumulative time spent in GC pauses                  |
| `media_viewer_go_gc_pause_last_seconds`  | Gauge   | -      | Duration of most recent GC pause                    |
| `media_viewer_go_gc_cpu_fraction`        | Gauge   | -      | Fraction of CPU time used by GC (0.0-1.0)           |

**Use cases:**

- Monitor memory pressure during indexing
- Tune GOMEMLIMIT and GOGC for your environment
- Detect memory leaks
- Measure GC CPU overhead and pause times
- Evaluate impact of GC configuration changes

### Application Info

| Metric                  | Type  | Labels                            | Description                   |
| ----------------------- | ----- | --------------------------------- | ----------------------------- |
| `media_viewer_app_info` | Gauge | `version`, `commit`, `go_version` | Application build information |

## Prometheus Configuration

Add Media Viewer to your Prometheus scrape configuration:

```yaml
scrape_configs:
    - job_name: 'media-viewer'
      static_configs:
          - targets: ['media-viewer:8080']
      metrics_path: '/metrics'
      scrape_interval: 30s
```

## Example Queries

### Indexing Performance

```promql
# Indexing throughput over time
rate(media_viewer_indexer_files_processed_total[5m])

# P95 indexer run duration
histogram_quantile(0.95, rate(media_viewer_indexer_run_duration_seconds_bucket[5m]))

# Indexing efficiency (files per second)
media_viewer_indexer_files_per_second
```

### Thumbnail Performance

```promql
# Cache hit rate
rate(media_viewer_thumbnail_cache_hits_total[5m])
  /
(rate(media_viewer_thumbnail_cache_hits_total[5m])
  + rate(media_viewer_thumbnail_cache_misses_total[5m]))

# P99 thumbnail generation time by type
histogram_quantile(0.99,
  rate(media_viewer_thumbnail_generation_duration_seconds_bucket[5m]))

# Memory usage per thumbnail by type
histogram_quantile(0.95,
  rate(media_viewer_thumbnail_memory_usage_bytes_bucket[5m]))

# Phase timing breakdown
histogram_quantile(0.95,
  rate(media_viewer_thumbnail_generation_duration_detailed_seconds_bucket[5m]))
```

### Filesystem Performance

```promql
# P95 filesystem operation latency by operation
histogram_quantile(0.95,
  rate(media_viewer_filesystem_operation_duration_seconds_bucket[5m]))

# Filesystem errors by directory
rate(media_viewer_filesystem_operation_errors_total[5m])
```

### Database Performance

```promql
# P95 query duration by operation
histogram_quantile(0.95,
  rate(media_viewer_db_query_duration_seconds_bucket[5m]))

# Transaction commit rate
rate(media_viewer_db_transaction_duration_seconds_count{type="commit"}[5m])

# Database size growth
rate(media_viewer_db_size_bytes{file="main"}[1h])
```

### Garbage Collection Performance

Monitor CPU overhead and pause times from garbage collection:

```promql
# GC frequency (collections per second)
rate(media_viewer_go_gc_runs_total[5m])

# Total GC pause time per second (in milliseconds)
rate(media_viewer_go_gc_pause_total_seconds[5m]) * 1000

# GC CPU overhead percentage
media_viewer_go_gc_cpu_fraction * 100

# Most recent GC pause duration (in milliseconds)
media_viewer_go_gc_pause_last_seconds * 1000

# Memory allocation rate (MB/s)
rate(media_viewer_go_memalloc_bytes[5m]) / 1024 / 1024

# Memory pressure (% of GOMEMLIMIT used)
media_viewer_go_memalloc_bytes / media_viewer_go_memlimit_bytes * 100

# GC efficiency: bytes allocated per GC cycle
rate(media_viewer_go_memalloc_bytes[5m]) / rate(media_viewer_go_gc_runs_total[5m])
```

**Interpreting GC metrics:**

- **GC CPU Fraction > 0.05 (5%)**: GC overhead is high, consider tuning
- **GC Frequency > 1/sec**: Very frequent collections, increase `GOGC` or `GOMEMLIMIT`
- **Pause Time > 10ms**: May cause latency spikes in request handling
- **Memory Pressure > 90%**: Runtime is aggressively GC'ing to stay under limit

**For detailed tuning guidance, see [Memory and GC Tuning](memory-tuning.md).**

````

### HTTP Performance

```promql
# Request rate by endpoint
rate(media_viewer_http_requests_total[5m])

# P95 request duration
histogram_quantile(0.95,
  rate(media_viewer_http_request_duration_seconds_bucket[5m]))

# Error rate (4xx + 5xx)
sum(rate(media_viewer_http_requests_total{status=~"4..|5.."}[5m]))
````

### Transcoder Performance

```promql
# Transcoder cache size
media_viewer_transcoder_cache_size_bytes

# Transcoding job rate by status
rate(media_viewer_transcoder_jobs_total[5m])

# P95 transcoding duration
histogram_quantile(0.95,
  rate(media_viewer_transcoder_job_duration_seconds_bucket[5m]))

# Active transcoding jobs
media_viewer_transcoder_jobs_in_progress
```

## Grafana Dashboard

A pre-built Grafana dashboard is available at:

```
hack/grafana/dashboard.json
```

Import this dashboard to visualize:

- Indexing performance and throughput
- Thumbnail generation metrics and cache efficiency
- Filesystem I/O latency (critical for NFS)
- Database performance
- Memory usage and GC activity
- HTTP request rates and latencies
- Transcoder job performance and cache growth

## Alerting Examples

### Indexer Alerts

```yaml
# Indexer taking too long
- alert: SlowIndexing
  expr: media_viewer_indexer_last_run_duration_seconds > 3600
  for: 5m
  annotations:
      summary: 'Indexer run took over 1 hour'

# Indexer stuck
- alert: IndexerStuck
  expr: time() - media_viewer_indexer_last_run_timestamp > 14400
  for: 10m
  annotations:
      summary: 'No indexer run in 4 hours'
```

### Thumbnail Alerts

```yaml
# Low cache hit rate
- alert: LowThumbnailCacheHitRate
  expr: |
      rate(media_viewer_thumbnail_cache_hits_total[15m])
      /
      (rate(media_viewer_thumbnail_cache_hits_total[15m])
        + rate(media_viewer_thumbnail_cache_misses_total[15m])) < 0.5
  for: 30m
  annotations:
      summary: 'Thumbnail cache hit rate below 50%'
```

### Filesystem Alerts

```yaml
# High filesystem latency (NFS issues)
- alert: HighFilesystemLatency
  expr: |
      histogram_quantile(0.95,
        rate(media_viewer_filesystem_operation_duration_seconds_bucket[5m])) > 1
  for: 10m
  annotations:
      summary: 'P95 filesystem operation latency over 1 second'
```

### Transcoder Alerts

```yaml
# Large transcoder cache
- alert: LargeTranscoderCache
  expr: media_viewer_transcoder_cache_size_bytes > 10737418240 # 10GB
  for: 30m
  annotations:
      summary: 'Transcoder cache size exceeds 10GB'
```

### Memory Alerts

```yaml
# Memory pressure
- alert: MemoryPressure
  expr: media_viewer_memory_usage_ratio > 0.9
  for: 5m
  annotations:
      summary: 'Memory usage over 90% of limit'
```

## Performance Tuning

Use metrics to guide performance optimization:

1. **NFS Latency**: Monitor `filesystem_operation_duration` to identify slow storage
2. **Indexing Speed**: Use `indexer_files_per_second` and `indexer_batch_duration` to tune batch sizes
3. **Thumbnail Generation**: Analyze phase timing to optimize FFmpeg vs resize vs encoding
4. **Memory Usage**: Track `thumbnail_memory_usage_bytes` to tune concurrent generation limits
5. **Cache Efficiency**: Monitor cache hit rates to adjust cache size and eviction policies
6. **Transcoder Cache**: Track `transcoder_cache_size_bytes` to determine when cache cleanup is needed

## See Also

- [Memory and GC Tuning](memory-tuning.md) - Optimize garbage collection and memory usage
- [Server Configuration](server-config.md) - Performance configuration options
- [Thumbnail Management](thumbnails.md) - Thumbnail generation and caching
- [Environment Variables](environment-variables.md) - Configuration reference
