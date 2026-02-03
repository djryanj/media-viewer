# System API

System health, statistics, and administrative endpoints.

## API Reference

See the [OpenAPI Specification](openapi.md) for interactive documentation:

**Health & Info:**

- `GET /health` - Basic health check
- `GET /healthz` - Health check alias
- `GET /livez` - Liveness probe
- `GET /readyz` - Readiness probe
- `GET /version` - Version information
- `GET /metrics` - Prometheus metrics (port 9090)

**Statistics:**

- `GET /api/stats` - Library statistics

**Cache Management:**

- `POST /api/thumbnails/invalidate` - Clear all thumbnails
- `POST /api/thumbnails/rebuild` - Rebuild all thumbnails
- `GET /api/thumbnails/status` - Thumbnail generation status
- `DELETE /api/thumbnail/{path}` - Invalidate single thumbnail
- `POST /api/transcode/clear` - Clear transcode cache

**Indexing:**

- `POST /api/reindex` - Trigger media reindex

Refer to the OpenAPI documentation for detailed request/response schemas and examples.
