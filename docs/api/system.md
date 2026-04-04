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
