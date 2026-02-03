# Server Configuration

This guide covers server-side configuration and deployment considerations for Media Viewer.

## Directory Structure

Media Viewer uses three primary directories:

### Media Directory

The read-only directory containing your media files.

- Default path: `/media`
- Configure with: `MEDIA_DIR` environment variable
- Mount as read-only for security: `-v /path/to/media:/media:ro`

Supported file types:

| Type      | Extensions                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images    | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`, `.ico`, `.tiff`, `.heic`, `.heif`, `.avif`, `.jxl`, `.raw`, `.cr2`, `.nef`, `.arw`, `.dng` |
| Videos    | `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, `.webm`, `.m4v`, `.mpeg`, `.mpg`, `.3gp`, `.ts`                                                      |
| Playlists | `.wpl` (Windows Media Player playlists)                                                                                                              |

### Cache Directory

Stores thumbnails and transcoded videos.

- Default path: `/cache`
- Configure with: `CACHE_DIR` environment variable
- Must be writable
- Should be persisted between container restarts

Contents:

- `thumbnails/` - Generated thumbnail cache
- `transcodes/` - Transcoded video files

### Database Directory

Stores the SQLite database.

- Default path: `/database`
- Configure with: `DATABASE_DIR` environment variable
- Must be writable
- Should be persisted between container restarts

Contents:

- `media.db` - SQLite database containing index, tags, favorites, user data, and sessions

## Database

Media Viewer uses SQLite for data storage. The database is automatically created on first run.

### Database Contents

- File index (paths, sizes, modification dates)
- Tags and tag assignments
- Favorites
- User account and sessions
- WebAuthn credentials (if enabled)

### Database Location

The database file is stored at `{DATABASE_DIR}/media.db`.

### Backup

To backup your data:

```bash
# Stop the container first for consistency
docker stop media-viewer

# Copy the database
docker cp media-viewer:/database/media.db ./backup/media.db

# Or if using volumes
docker run --rm -v media-database:/data -v $(pwd)/backup:/backup alpine cp /data/media.db /backup/

# Restart
docker start media-viewer
```

## Indexing

Media Viewer automatically indexes your media library on startup and periodically thereafter.

### Initial Index

On first run, the application scans your entire media directory. This may take several minutes for large libraries.

### Change Detection

The indexer uses polling-based change detection (default: every 30 seconds) to find new, modified, or deleted files.

### Full Reindex

Full reindexing happens automatically at the configured interval (default: every 30 minutes).

### Manual Reindex

To force a reindex:

1. Open **Settings** → **Cache** tab
2. Click **Reindex Now**

Or use the API:

```bash
curl -X POST http://localhost:8080/api/reindex \
  -H "Cookie: session=YOUR_SESSION_TOKEN"
```

## Resource Requirements

### Memory

- Base: ~100MB
- Add ~1MB per 10,000 indexed files
- Thumbnail generation temporarily increases memory usage
- FFmpeg processes for video transcoding require additional memory

### Storage

- Database: ~1KB per indexed file
- Thumbnails: ~10-50KB per image/video
- Transcoded videos: Varies based on source file size and quality

### CPU

- Thumbnail generation is CPU-intensive
- Video transcoding is very CPU-intensive
- Parallel workers scale based on available CPU cores

## Logging

Media Viewer logs to stdout, which Docker captures automatically.

### Viewing Logs

```bash
docker logs media-viewer
docker logs -f media-viewer  # Follow mode
docker logs --tail 100 media-viewer  # Last 100 lines
```

### Log Levels

Configure with `LOG_LEVEL` environment variable:

| Level   | Description                           |
| ------- | ------------------------------------- |
| `debug` | Detailed debugging information        |
| `info`  | Normal operational messages (default) |
| `warn`  | Warning messages                      |
| `error` | Error messages only                   |

### Log Filtering

Configure what gets logged:

- `LOG_STATIC_FILES` - Log static file requests (default: `false`)
- `LOG_HEALTH_CHECKS` - Log health check requests (default: `true`)

## Health Checks

The application provides multiple health endpoints for monitoring:

```
GET /health
```

Returns `200 OK` when the application is healthy.

### Docker Health Check

```yaml
healthcheck:
    test: ['CMD', 'curl', '-f', 'http://localhost:8080/health']
    interval: 30s
    timeout: 10s
    retries: 3
```

## Monitoring

Media Viewer exposes comprehensive Prometheus metrics for performance monitoring and alerting.

### Metrics Endpoint

Prometheus metrics are available at:

```
GET /metrics
```

See the [Metrics & Monitoring](metrics.md) guide for:

- Complete metrics reference
- Prometheus and Grafana configuration
- Example queries and dashboards
- Alerting rules
- Performance tuning guidance

Key metrics include:

- **Indexing Performance**: Run duration, throughput, batch processing times
- **Thumbnail Generation**: Cache hit rates, memory usage, phase timing
- **Filesystem I/O**: Critical for NFS deployments - operation latencies
- **Database Performance**: Transaction durations, query latencies
- **Memory Usage**: Heap allocation, GC activity, memory pressure
