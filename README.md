# Media Viewer

A lightweight, containerized web application for browsing and viewing images and videos from a mounted directory.

## Features

- Browse folders and files with thumbnail previews
- View images and videos in a lightbox with swipe/keyboard navigation
- Play Windows Media Player playlists (.wpl)
- Automatic video transcoding for browser compatibility
- Full-text fuzzy search with tag support
- Tag files for organization
- Pin favorites to the home page
- Single-user authentication
- Prometheus metrics endpoint for monitoring

## Quick Start with Docker

### Using Docker Compose (Recommended)

1. Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  media-viewer:
    image: ghcr.io/djryanj/media-viewer:latest
    ports:
      - "8080:8080"
      - "9090:9090"  # Metrics port (optional)
    volumes:
      - /path/to/your/media:/media:ro
      - media-cache:/cache
      - media-database:/database
    environment:
      - MEDIA_DIR=/media
      - CACHE_DIR=/cache
      - DATABASE_DIR=/database
      - PORT=8080
      - METRICS_PORT=9090
      - METRICS_ENABLED=true
      - INDEX_INTERVAL=30m
    restart: unless-stopped

volumes:
  media-cache:
  media-database:
```

2. Update `/path/to/your/media` to point to your media directory.

3. Build and run:

```bash
docker-compose up -d
```

4. Open http://localhost:8080 in your browser.

5. On first run, you'll be prompted to create a user account.

### Using Docker CLI

```bash
# Run the container
docker run -d \
  --name media-viewer \
  -p 8080:8080 \
  -p 9090:9090 \
  -v /path/to/your/media:/media:ro \
  -v media-cache:/cache \
  -v media-database:/database \
  ghcr.io/djryanj/media-viewer:latest
```

Or, PowerShell, from your media directory:

```powershell
docker run -d `
  --name media-viewer `
  -p 8080:8080 `
  -p 9090:9090 `
  -v "${PWD}:/media:ro" `
  -v media-cache:/cache `
  -v media-database:/database `
  ghcr.io/djryanj/media-viewer:latest
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MEDIA_DIR` | `/media` | Path to media directory inside container |
| `CACHE_DIR` | `/cache` | Path to cache directory (thumbnails, transcodes) |
| `DATABASE_DIR` | `/database` | Path to database directory |
| `PORT` | `8080` | HTTP server port |
| `METRICS_PORT` | `9090` | Prometheus metrics server port |
| `METRICS_ENABLED` | `true` | Enable or disable the metrics server |
| `INDEX_INTERVAL` | `30m` | How often to re-scan the media directory |
| `THUMBNAIL_INTERVAL` | `6h` | How often the thumbnail generator regenerates all thumbnails |
| `LOG_LEVEL` | `info` | Server log level (`debug`, `info`, `warn`, `error`) |
| `LOG_STATIC_FILES` | `false` | Log static file requests |
| `LOG_HEALTH_CHECKS` | `true` | Log health check endpoint requests |

### Boolean Environment Variables

Boolean environment variables accept the following values:
- True: `true`, `1`, `t`, `T`, `TRUE`
- False: `false`, `0`, `f`, `F`, `FALSE`

### Duration Values

`INDEX_INTERVAL` and `THUMBNAIL_INTERVAL` use Go's duration format:

| Unit | Suffix | Example |
|------|--------|---------|
| Nanoseconds | `ns` | `500ns` |
| Microseconds | `us` | `100us` |
| Milliseconds | `ms` | `500ms` |
| Seconds | `s` | `30s` |
| Minutes | `m` | `30m` |
| Hours | `h` | `6h` |

Examples:
```bash
THUMBNAIL_INTERVAL=30m      # Every 30 minutes
THUMBNAIL_INTERVAL=6h       # Every 6 hours (default)
THUMBNAIL_INTERVAL=1h30m    # Every 1 hour and 30 minutes
THUMBNAIL_INTERVAL=1.5h     # Every 1.5 hours (90 minutes)
```

Invalid formats:
```bash
THUMBNAIL_INTERVAL=6        # Missing unit
THUMBNAIL_INTERVAL=1d       # Days not supported
```

#### Recommended Values

| Use Case | Value |
|----------|-------|
| Development/Testing | `30m` or `1h` |
| Small library (< 1000 files) | `6h` |
| Medium library (1000-10000 files) | `12h` |
| Large library (> 10000 files) | `24h` |

## Monitoring

Media Viewer exposes Prometheus metrics on a separate port (default: 9090) for monitoring application health and performance.

### Endpoints

| Endpoint | Port | Description |
|----------|------|-------------|
| `/metrics` | 9090 | Prometheus metrics |
| `/health` | 9090 | Health check for metrics server |
| `/health` | 8080 | Application health check |
| `/healthz` | 8080 | Kubernetes liveness probe |
| `/readyz` | 8080 | Kubernetes readiness probe |
| `/livez` | 8080 | Kubernetes liveness probe (alias) |

### Available Metrics

The following metric categories are exposed:

| Category | Prefix | Description |
|----------|--------|-------------|
| HTTP | `media_viewer_http_*` | Request counts, latency, in-flight requests |
| Database | `media_viewer_db_*` | Query counts, latency, connection pool |
| Indexer | `media_viewer_indexer_*` | Run counts, duration, files processed |
| Thumbnails | `media_viewer_thumbnail_*` | Generation counts, cache hits/misses, cache size |
| Scanner | `media_viewer_scanner_*` | File system operations, watcher events |
| Transcoder | `media_viewer_transcoder_*` | Job counts, duration |
| Authentication | `media_viewer_auth_*` | Login attempts, active sessions |
| Media Library | `media_viewer_media_*` | File counts by type, folders, favorites, tags |

### Prometheus Configuration

Add the following to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'media-viewer'
    static_configs:
      - targets: ['media-viewer:9090']
    scrape_interval: 15s
```

### Example Queries

```promql
# Request rate by endpoint
sum(rate(media_viewer_http_requests_total[5m])) by (path)

# P95 response time
histogram_quantile(0.95, sum(rate(media_viewer_http_request_duration_seconds_bucket[5m])) by (le))

# HTTP error rate
sum(rate(media_viewer_http_requests_total{status=~"5.."}[5m])) / sum(rate(media_viewer_http_requests_total[5m]))

# Thumbnail cache hit rate
media_viewer_thumbnail_cache_hits_total / (media_viewer_thumbnail_cache_hits_total + media_viewer_thumbnail_cache_misses_total)

# Database query latency by operation
histogram_quantile(0.95, sum(rate(media_viewer_db_query_duration_seconds_bucket[5m])) by (le, operation))
```

### Alerting

Example alerting rules for Prometheus Alertmanager:

```yaml
groups:
  - name: media-viewer
    rules:
      - alert: MediaViewerHighErrorRate
        expr: |
          sum(rate(media_viewer_http_requests_total{status=~"5.."}[5m])) 
          / sum(rate(media_viewer_http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High HTTP error rate"

      - alert: MediaViewerHighLatency
        expr: |
          histogram_quantile(0.95, sum(rate(media_viewer_http_request_duration_seconds_bucket[5m])) by (le)) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High request latency"

      - alert: MediaViewerDown
        expr: up{job="media-viewer"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Media Viewer is down"
```

## API Endpoints

### Public Endpoints (No Authentication)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/healthz` | Kubernetes health check |
| GET | `/livez` | Kubernetes liveness probe |
| GET | `/readyz` | Kubernetes readiness probe |
| GET | `/version` | Application version information |

### Authentication Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/setup-required` | Check if initial setup is needed |
| POST | `/api/auth/setup` | Create initial user account |
| POST | `/api/auth/login` | Authenticate user |
| POST | `/api/auth/logout` | End user session |
| GET | `/api/auth/check` | Verify authentication status |

### Protected API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files` | List directory contents |
| GET | `/api/media` | Get media files in directory |
| GET | `/api/file/{path}` | Get file content |
| GET | `/api/thumbnail/{path}` | Get file thumbnail |
| GET | `/api/search` | Search media library |
| GET | `/api/search/suggestions` | Get search autocomplete suggestions |
| GET | `/api/stats` | Get library statistics |
| POST | `/api/reindex` | Trigger media re-indexing |

### Favorites

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/favorites` | List all favorites |
| POST | `/api/favorites` | Add favorite |
| DELETE | `/api/favorites` | Remove favorite |
| GET | `/api/favorites/check` | Check if path is favorited |

### Tags

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tags` | List all tags |
| GET | `/api/tags/file` | Get tags for a file |
| POST | `/api/tags/file` | Add tag to file |
| DELETE | `/api/tags/file` | Remove tag from file |
| POST | `/api/tags/file/set` | Set all tags for a file |
| POST | `/api/tags/batch` | Get tags for multiple files |
| GET | `/api/tags/{tag}` | Get files with tag |
| DELETE | `/api/tags/{tag}` | Delete tag |
| PUT | `/api/tags/{tag}` | Rename tag |

### Thumbnails

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/thumbnail/{path}` | Get thumbnail |
| DELETE | `/api/thumbnail/{path}` | Invalidate thumbnail |
| POST | `/api/thumbnails/invalidate` | Invalidate all thumbnails |
| POST | `/api/thumbnails/rebuild` | Rebuild all thumbnails |
| GET | `/api/thumbnails/status` | Get thumbnail generator status |

### Playlists

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/playlists` | List all playlists |
| GET | `/api/playlist/{name}` | Get playlist contents |

### Video Streaming

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stream/{path}` | Stream video (with transcoding if needed) |
| GET | `/api/stream-info/{path}` | Get stream information |

## Development Setup

### Prerequisites

- Go 1.21 or later
- FFmpeg
- GCC (for SQLite CGO compilation)

### Running Locally

1. Clone the repository:

```bash
git clone https://github.com/djryanj/media-viewer.git
cd media-viewer
```

2. Install dependencies:

```bash
go mod download
```

3. Create a sample media directory:

```bash
mkdir -p sample-media
```

4. Run the application:

```bash
# Must include fts5 build tag for SQLite full-text search
go run -tags 'fts5' .
```

5. Or use Air for hot reload:

```bash
# Install Air
go install github.com/air-verse/air@latest

# Run with hot reload
air
```

The `.air.toml` configuration should include the fts5 build tag:

```toml
[build]
  cmd = "go build -tags 'fts5' -o ./tmp/main ."
```

### Using the Dev Container

If using VS Code with the Dev Containers extension:

1. Open the project in VS Code.
2. Click "Reopen in Container" when prompted.
3. The container includes Go, FFmpeg, and SQLite.
4. Run with `go run -tags 'fts5' .` or `air`.

### Building

#### Docker

Build locally:
```bash
docker build -t media-viewer:local .
```

Build with cross-compilation optimization (faster multi-arch builds):
```bash
docker build -f Dockerfile.cross -t media-viewer:local .
```

#### Binary

```bash
# Build the main application
go build -tags 'fts5' -o media-viewer .

# Build the password reset utility
go build -o resetpw ./cmd/resetpw
```

#### Multi-architecture

The GitHub Actions workflow automatically builds for both amd64 and arm64:
- PRs: Only amd64 (for speed)
- Main branch: Both architectures
- Tags: Both architectures + SBOM generation

## Password Reset

### Using the resetpw Utility

The `resetpw` utility is included in the Docker image and can be built for local use.

Reset a password:

```bash
# Inside Docker container
docker exec -it media-viewer ./resetpw reset

# With docker-compose
docker-compose exec media-viewer ./resetpw reset

# Locally (set DATABASE_DIR if not using default)
DATABASE_DIR=/path/to/database ./resetpw reset
```

You will be prompted for the username and new password.

Create a new user:

```bash
docker exec -it media-viewer ./resetpw create
```

### Emergency Password Reset via SQLite

If you cannot use the resetpw utility, you can reset the password directly in SQLite.

1. Generate a bcrypt hash for your new password:

```bash
# Using htpasswd (if available)
htpasswd -nbBC 10 "" "yournewpassword" | tr -d ':\n' | sed 's/$2y/$2a/'

# Or using Python
python3 -c "import bcrypt; print(bcrypt.hashpw(b'yournewpassword', bcrypt.gensalt()).decode())"
```

2. Update the database:

```bash
# Find your database volume location
docker volume inspect media-database

# Or exec into the container
docker exec -it media-viewer sh

# Update the password hash
sqlite3 /database/media.db "UPDATE users SET password_hash='YOUR_BCRYPT_HASH' WHERE username='yourusername';"
```

3. Invalidate all existing sessions (forces re-login):

```bash
sqlite3 /database/media.db "DELETE FROM sessions;"
```

## Supported Formats

### Images
jpg, jpeg, png, gif, bmp, webp, svg, ico, tiff, heic, heif, avif, jxl, raw, cr2, nef, arw, dng

### Videos
mp4, mkv, avi, mov, wmv, flv, webm, m4v, mpeg, mpg, 3gp, ts

Videos not natively supported by browsers (such as mkv) are automatically transcoded to mp4 for playback.

### Playlists
Windows Media Player playlists (.wpl)

## Installation

### Docker (Recommended)

Pull the latest image from GitHub Container Registry:

```bash
docker pull ghcr.io/djryanj/media-viewer:latest
```

Or use a specific version:

```bash
docker pull ghcr.io/djryanj/media-viewer:v1.0.0
```

Run with docker-compose (recommended):

```bash
docker-compose up -d
```

### From Source

```bash
git clone https://github.com/djryanj/media-viewer.git
cd media-viewer
go build -tags 'fts5' -o media-viewer .
./media-viewer
```

## Releases

### Creating a Release

To create a new release:

1. Update version information (if needed)
2. Create and push a tag:
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```
3. GitHub Actions will automatically:
   - Build multi-platform Docker images (amd64, arm64)
   - Push images to `ghcr.io/djryanj/media-viewer`
   - Tag with version number and `latest`

### Available Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest stable release from main branch |
| `v1.0.0` | Specific version tag |
| `v1.0` | Latest patch version of 1.0.x |
| `v1` | Latest minor version of 1.x.x |
| `sha-abc1234` | Specific commit build |

### Version Information

The application includes build information accessible via:
- API endpoint: `GET /version`
- Startup logs

Build information includes:
- Version (from git tag or "dev")
- Git commit hash
- Build timestamp
- Go version
- OS and architecture

## License

MIT License
