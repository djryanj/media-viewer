# System API

System health, statistics, and administrative endpoints.

## System Status

```http
GET /api/system/status
```

Returns the aggregate admin status payload used by the footer and Settings -> Cache.
It combines library statistics, cache usage, and background worker state for
the indexer, thumbnail generator, and auto-tagger.

This endpoint replaces these older status endpoints:

- `GET /api/stats`
- `GET /api/thumbnails/status`
- `GET /api/autotagger/status`

### Response

```json
{
    "updatedAt": "2026-05-13T15:04:05Z",
    "library": {
        "totalFiles": 1200,
        "totalFolders": 85,
        "totalImages": 980,
        "totalVideos": 180,
        "totalPlaylists": 40,
        "totalFavorites": 25,
        "totalTags": 64,
        "thumbnailCacheBytes": 104857600,
        "thumbnailCacheFiles": 420,
        "transcodeCacheBytes": 524288000,
        "transcodeCacheFiles": 18,
        "lastIndexed": "2026-05-13T14:58:41Z",
        "indexDuration": "1.2s"
    },
    "indexer": {
        "summary": {
            "enabled": true,
            "running": false,
            "state": "idle"
        },
        "health": {
            "ready": true,
            "indexing": false,
            "startTime": "2026-05-13T14:00:00Z",
            "uptime": "1h4m",
            "lastIndexed": "2026-05-13T14:58:41Z",
            "filesIndexed": 1200,
            "foldersIndexed": 85
        },
        "metrics": {
            "processedItems": 1285
        }
    },
    "thumbnails": {
        "summary": {
            "enabled": true,
            "running": false,
            "state": "idle"
        },
        "status": {
            "enabled": true,
            "cacheDir": "/cache/thumbs",
            "cacheCount": 420,
            "cacheSize": 104857600,
            "cacheSizeHuman": "100 MB"
        },
        "metrics": {
            "processedItems": 0
        }
    },
    "autotagger": {
        "summary": {
            "enabled": true,
            "running": true,
            "state": "running"
        },
        "status": {
            "run": {
                "inProgress": true,
                "startedAt": "2026-05-13T15:00:10Z",
                "currentFile": "folder/example.jpg",
                "isIncremental": false,
                "totalFiles": 412,
                "processed": 124,
                "tagged": 37,
                "skipped": 85,
                "failed": 2
            }
        },
        "metrics": {
            "processedItems": 124,
            "totalItems": 412,
            "remainingItems": 288,
            "progressPercent": 30.1,
            "itemsPerSecond": 4.5,
            "estimatedSecondsRemaining": 64.0,
            "estimatedCompletion": "2026-05-13T15:05:14Z"
        }
    }
}
```

Field notes:

- `library` contains the old library statistics payload plus thumbnail and transcode cache totals.
- Each worker has a `summary` block for quick UI state and a more detailed `status`/`health` block for diagnostics.
- `metrics.itemsPerSecond`, `estimatedSecondsRemaining`, and `estimatedCompletion` are only populated while a worker is actively running.

## Trigger Reindex

```http
POST /api/reindex
```

Starts a background reindex.

### Response

Started:

```json
{
    "status": "started",
    "message": "Re-indexing started"
}
```

Already running:

```json
{
    "status": "already_running",
    "message": "Indexing is already in progress"
}
```

## Trigger Auto-Tagger

```http
POST /api/autotagger/run
```

Starts an on-demand full EXIF auto-tagging pass in the background.

### Response

```json
{
    "success": true,
    "message": "Auto-tagger run started"
}
```

## Clear Transcode Cache

```http
POST /api/transcode/clear
```

### Response

```json
{
    "success": true,
    "freedBytes": 524288000
}
```

## Health and Readiness

```http
GET /health
GET /healthz
GET /livez
GET /readyz
GET /version
```

- `/health` and `/healthz` return service health and support `GET` and `HEAD`.
- `/livez` is a lightweight liveness endpoint and supports `GET` and `HEAD`.
- `/readyz` reports readiness and may return `503 Service Unavailable`.
- `/version` returns build metadata.

### Example Version Response

```json
{
    "version": "0.16.0",
    "commit": "abcdef1",
    "buildTime": "2026-04-03T18:25:19Z",
    "goVersion": "go1.24.1"
}
```

## Metrics

`/metrics` exposes Prometheus metrics from the metrics server.

For exact schemas and monitoring-related details, see the [OpenAPI specification](openapi.md) and the administration docs.
