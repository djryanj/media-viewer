# System API

System health, statistics, and administrative endpoints.

## Library Statistics

```http
GET /api/stats
```

Returns aggregate library and cache statistics.

### Response

```json
{
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
    "lastIndexed": "2026-04-03T18:25:19Z",
    "indexDuration": "1.2s"
}
```

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

## Auto-Tagger Status

```http
GET /api/autotagger/status
```

Returns the current or most recent EXIF auto-tagging run state. This is useful
for admin tooling, automation, and smoke tests that need to wait for an
on-demand run to actually finish instead of polling tags blindly.

### Response

```json
{
    "run": {
        "inProgress": false,
        "startedAt": "2026-04-23T11:15:02Z",
        "lastCompleted": "2026-04-23T11:15:09Z",
        "currentFile": "",
        "isIncremental": false,
        "totalFiles": 412,
        "processed": 412,
        "tagged": 37,
        "skipped": 375,
        "failed": 0,
        "lastError": ""
    }
}
```

Field notes:

- `inProgress` is `true` while a pass is actively running.
- `lastCompleted` updates when the most recent successful or failed pass finishes.
- `currentFile` is populated only while a pass is active.
- `isIncremental` distinguishes background incremental passes from full on-demand runs.
- `tagged`, `skipped`, and `failed` describe the most recent run totals.

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
