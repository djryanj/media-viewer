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
            - '8080:8080'
            - '9090:9090' # Metrics port (optional)
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

| Environment Variable | Default     | Description                                                                                                                            |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_DIR`          | `/media`    | Path to media directory inside container                                                                                               |
| `CACHE_DIR`          | `/cache`    | Path to cache directory (thumbnails, transcodes)                                                                                       |
| `DATABASE_DIR`       | `/database` | Path to database directory                                                                                                             |
| `PORT`               | `8080`      | HTTP server port                                                                                                                       |
| `METRICS_PORT`       | `9090`      | Prometheus metrics server port                                                                                                         |
| `METRICS_ENABLED`    | `true`      | Enable or disable the metrics server                                                                                                   |
| `INDEX_INTERVAL`     | `30m`       | How often to re-scan the media directory                                                                                               |
| `THUMBNAIL_INTERVAL` | `6h`        | How often the thumbnail generator regenerates all thumbnails                                                                           |
| `LOG_LEVEL`          | `info`      | Server log level (`debug`, `info`, `warn`, `error`)                                                                                    |
| `LOG_STATIC_FILES`   | `false`     | Log static file requests                                                                                                               |
| `LOG_HEALTH_CHECKS`  | `true`      | Log health check endpoint requests                                                                                                     |
| `MEMORY_LIMIT`       | (none)      | Container memory limit in bytes. Set via Kubernetes Downward API to enable automatic GOMEMLIMIT configuration.                         |
| `MEMORY_RATIO`       | `0.85`      | Percentage of `MEMORY_LIMIT` to allocate to Go heap (0.0-1.0). The remainder is reserved for FFmpeg, image processing, and OS buffers. |
| `GOMEMLIMIT`         | (none)      | Direct override for Go's memory limit. If set, takes precedence over `MEMORY_LIMIT`. Accepts values like `400MiB` or `1GiB`.           |

### Boolean Environment Variables

Boolean environment variables accept the following values:

- True: `true`, `1`, `t`, `T`, `TRUE`
- False: `false`, `0`, `f`, `F`, `FALSE`

### Duration Values

`INDEX_INTERVAL` and `THUMBNAIL_INTERVAL` use Go's duration format:

| Unit         | Suffix | Example |
| ------------ | ------ | ------- |
| Nanoseconds  | `ns`   | `500ns` |
| Microseconds | `us`   | `100us` |
| Milliseconds | `ms`   | `500ms` |
| Seconds      | `s`    | `30s`   |
| Minutes      | `m`    | `30m`   |
| Hours        | `h`    | `6h`    |

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

| Use Case                          | Value         |
| --------------------------------- | ------------- |
| Development/Testing               | `30m` or `1h` |
| Small library (< 1000 files)      | `6h`          |
| Medium library (1000-10000 files) | `12h`         |
| Large library (> 10000 files)     | `24h`         |

### Memory Configuration

When running in Kubernetes or other container environments, the application can be configured to respect memory limits and avoid OOM (Out of Memory) kills.

#### Kubernetes Configuration

To enable memory-aware operation in Kubernetes, pass the container's memory limit using the Downward API:

```yaml
spec:
    containers:
        - name: media-viewer
          image: ghcr.io/djryanj/media-viewer:latest
          resources:
              limits:
                  memory: '512Mi'
              requests:
                  memory: '256Mi'
          env:
              # Pass memory limit to application via Downward API
              - name: MEMORY_LIMIT
                valueFrom:
                    resourceFieldRef:
                        resource: limits.memory
              # Optional: customize the ratio (default is 0.85)
              - name: MEMORY_RATIO
                value: '0.75'
```

#### Memory Ratio Guidelines

The `MEMORY_RATIO` determines how much of the container's memory is allocated to Go's heap. The remaining memory is reserved for:

- FFmpeg child processes (video transcoding and thumbnail extraction)
- Image processing operations
- SQLite memory-mapped files
- Goroutine stacks
- OS buffers and caches

| Use Case                              | Recommended Ratio | Description                                    |
| ------------------------------------- | ----------------- | ---------------------------------------------- |
| Small library, few videos             | `0.85`            | Default, suitable for most deployments         |
| Large library, active transcoding     | `0.75`            | More headroom for FFmpeg operations            |
| Heavy concurrent thumbnail generation | `0.70`            | Multiple FFmpeg processes for video thumbnails |

#### How It Works

When `MEMORY_LIMIT` is set, the application calculates and sets Go's `GOMEMLIMIT`:

```
GOMEMLIMIT = MEMORY_LIMIT × MEMORY_RATIO
```

For example, with a 512Mi container limit and 0.75 ratio:

- Container limit: 512 MiB
- GOMEMLIMIT: 384 MiB (75%)
- Reserved: 128 MiB (25%) for FFmpeg, etc.

When Go's heap approaches `GOMEMLIMIT`, the garbage collector runs more aggressively to stay under the limit, reducing the risk of OOM kills.

#### Monitoring Memory Usage

Memory metrics are exposed via the Prometheus endpoint:

| Metric                           | Description                         |
| -------------------------------- | ----------------------------------- |
| `media_viewer_go_memlimit_bytes` | Configured GOMEMLIMIT               |
| `media_viewer_go_memalloc_bytes` | Current Go heap allocation          |
| `media_viewer_go_memsys_bytes`   | Total memory obtained from OS       |
| `media_viewer_go_gc_runs_total`  | Number of garbage collection cycles |

Example Prometheus query to check memory pressure:

```promql
media_viewer_go_memalloc_bytes / media_viewer_go_memlimit_bytes
```

Values approaching 1.0 indicate the application is under memory pressure.

````

**5. Update the docker-compose example in README.md:**

Find the existing docker-compose example and add the memory configuration:

```yaml
version: '3.8'

services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        ports:
            - '8080:8080'
            - '9090:9090'
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
        # Memory limits (optional but recommended)
        deploy:
            resources:
                limits:
                    memory: 512M
        # Note: For docker-compose, set GOMEMLIMIT directly
        # since Downward API is not available
        # environment:
        #     - GOMEMLIMIT=400MiB
        restart: unless-stopped

volumes:
    media-cache:
    media-database:
````

### Expected Startup Output

When the application starts with memory configuration, you'll see:

```
------------------------------------------------------------
MEMORY CONFIGURATION
------------------------------------------------------------
  Source:              MEMORY_LIMIT (Kubernetes Downward API)
  Container Limit:     512.0 MiB
  Memory Ratio:        75.0%
  GOMEMLIMIT:          384.0 MiB
  Reserved for OS/FFmpeg: 128.0 MiB
```

Or if using `GOMEMLIMIT` directly:

```
------------------------------------------------------------
MEMORY CONFIGURATION
------------------------------------------------------------
  Source:              GOMEMLIMIT environment variable
  GOMEMLIMIT:          400.0 MiB
```

Or if not configured:

```
------------------------------------------------------------
MEMORY CONFIGURATION
------------------------------------------------------------
  GOMEMLIMIT:          not configured
  (Set MEMORY_LIMIT or GOMEMLIMIT to enable memory limits)
```

## Monitoring

Media Viewer exposes Prometheus metrics on a separate port (default: 9090) for monitoring application health and performance.

### Endpoints

| Endpoint   | Port | Description                       |
| ---------- | ---- | --------------------------------- |
| `/metrics` | 9090 | Prometheus metrics                |
| `/health`  | 9090 | Health check for metrics server   |
| `/health`  | 8080 | Application health check          |
| `/healthz` | 8080 | Kubernetes liveness probe         |
| `/readyz`  | 8080 | Kubernetes readiness probe        |
| `/livez`   | 8080 | Kubernetes liveness probe (alias) |

### Available Metrics

The following metric categories are exposed:

| Category       | Prefix                      | Description                                      |
| -------------- | --------------------------- | ------------------------------------------------ |
| HTTP           | `media_viewer_http_*`       | Request counts, latency, in-flight requests      |
| Database       | `media_viewer_db_*`         | Query counts, latency, connection pool           |
| Indexer        | `media_viewer_indexer_*`    | Run counts, duration, files processed            |
| Thumbnails     | `media_viewer_thumbnail_*`  | Generation counts, cache hits/misses, cache size |
| Scanner        | `media_viewer_scanner_*`    | File system operations, watcher events           |
| Transcoder     | `media_viewer_transcoder_*` | Job counts, duration                             |
| Authentication | `media_viewer_auth_*`       | Login attempts, active sessions                  |
| Media Library  | `media_viewer_media_*`      | File counts by type, folders, favorites, tags    |

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
                summary: 'High HTTP error rate'

          - alert: MediaViewerHighLatency
            expr: |
                histogram_quantile(0.95, sum(rate(media_viewer_http_request_duration_seconds_bucket[5m])) by (le)) > 2
            for: 5m
            labels:
                severity: warning
            annotations:
                summary: 'High request latency'

          - alert: MediaViewerDown
            expr: up{job="media-viewer"} == 0
            for: 1m
            labels:
                severity: critical
            annotations:
                summary: 'Media Viewer is down'
```

## API Endpoints

### Public Endpoints (No Authentication)

| Method | Path       | Description                     |
| ------ | ---------- | ------------------------------- |
| GET    | `/health`  | Health check                    |
| GET    | `/healthz` | Kubernetes health check         |
| GET    | `/livez`   | Kubernetes liveness probe       |
| GET    | `/readyz`  | Kubernetes readiness probe      |
| GET    | `/version` | Application version information |

### Authentication Endpoints

| Method | Path                       | Description                      |
| ------ | -------------------------- | -------------------------------- |
| GET    | `/api/auth/setup-required` | Check if initial setup is needed |
| POST   | `/api/auth/setup`          | Create initial user account      |
| POST   | `/api/auth/login`          | Authenticate user                |
| POST   | `/api/auth/logout`         | End user session                 |
| GET    | `/api/auth/check`          | Verify authentication status     |

### Protected API Endpoints

| Method | Path                      | Description                         |
| ------ | ------------------------- | ----------------------------------- |
| GET    | `/api/files`              | List directory contents             |
| GET    | `/api/media`              | Get media files in directory        |
| GET    | `/api/file/{path}`        | Get file content                    |
| GET    | `/api/thumbnail/{path}`   | Get file thumbnail                  |
| GET    | `/api/search`             | Search media library                |
| GET    | `/api/search/suggestions` | Get search autocomplete suggestions |
| GET    | `/api/stats`              | Get library statistics              |
| POST   | `/api/reindex`            | Trigger media re-indexing           |

### Favorites

| Method | Path                   | Description                |
| ------ | ---------------------- | -------------------------- |
| GET    | `/api/favorites`       | List all favorites         |
| POST   | `/api/favorites`       | Add favorite               |
| DELETE | `/api/favorites`       | Remove favorite            |
| GET    | `/api/favorites/check` | Check if path is favorited |

### Tags

| Method | Path                 | Description                 |
| ------ | -------------------- | --------------------------- |
| GET    | `/api/tags`          | List all tags               |
| GET    | `/api/tags/file`     | Get tags for a file         |
| POST   | `/api/tags/file`     | Add tag to file             |
| DELETE | `/api/tags/file`     | Remove tag from file        |
| POST   | `/api/tags/file/set` | Set all tags for a file     |
| POST   | `/api/tags/batch`    | Get tags for multiple files |
| GET    | `/api/tags/{tag}`    | Get files with tag          |
| DELETE | `/api/tags/{tag}`    | Delete tag                  |
| PUT    | `/api/tags/{tag}`    | Rename tag                  |

### Thumbnails

| Method | Path                         | Description                    |
| ------ | ---------------------------- | ------------------------------ |
| GET    | `/api/thumbnail/{path}`      | Get thumbnail                  |
| DELETE | `/api/thumbnail/{path}`      | Invalidate thumbnail           |
| POST   | `/api/thumbnails/invalidate` | Invalidate all thumbnails      |
| POST   | `/api/thumbnails/rebuild`    | Rebuild all thumbnails         |
| GET    | `/api/thumbnails/status`     | Get thumbnail generator status |

### Playlists

| Method | Path                   | Description           |
| ------ | ---------------------- | --------------------- |
| GET    | `/api/playlists`       | List all playlists    |
| GET    | `/api/playlist/{name}` | Get playlist contents |

### Video Streaming

| Method | Path                      | Description                               |
| ------ | ------------------------- | ----------------------------------------- |
| GET    | `/api/stream/{path}`      | Stream video (with transcoding if needed) |
| GET    | `/api/stream-info/{path}` | Get stream information                    |

## Development Setup

### Prerequisites

- Go 1.21 or later
- Node.js 18 or later (for frontend tooling)
- FFmpeg
- GCC (for SQLite CGO compilation)

### Initial Setup

1. Clone the repository:

```bash
git clone https://github.com/djryanj/media-viewer.git
cd media-viewer
```

2. Install all development dependencies:

```bash
make setup
```

This installs:

- Frontend dependencies (npm packages)
- Go tools (air for hot reload, golangci-lint for linting)

### Running the Development Server

#### Full Development Environment (Recommended)

Run both the Go backend with hot reload and the frontend with live reload:

```bash
make dev-full
```

This starts:

- Go server with hot reload on port 8080 (via air)
- Browser-sync proxy on port 3000 with live reload for CSS/JS/HTML changes

Open http://localhost:3000 in your browser. Press Ctrl+C to stop both servers.

#### Backend Only

Run just the Go server with hot reload:

```bash
make dev
```

#### Frontend Only

If the Go server is already running, start just the frontend live reload:

```bash
make dev-frontend
```

#### Simple Run (No Hot Reload)

```bash
make run
```

### Available Make Targets

Run `make help` to see all available targets:

| Category            | Target                  | Description                                  |
| ------------------- | ----------------------- | -------------------------------------------- |
| **Build**           | `build`                 | Build the main application                   |
|                     | `build-all`             | Build main application and resetpw tool      |
|                     | `resetpw`               | Build the password reset tool                |
|                     | `release-build`         | Build with release optimizations             |
| **Development**     | `run`                   | Run the application                          |
|                     | `dev`                   | Run with hot reload (air)                    |
|                     | `dev-frontend`          | Run frontend with live reload (browser-sync) |
|                     | `dev-full`              | Run both Go and frontend dev servers         |
| **Test**            | `test`                  | Run all tests                                |
|                     | `test-coverage`         | Run tests with coverage report               |
| **Lint (Go)**       | `lint`                  | Lint Go code                                 |
|                     | `lint-fix`              | Fix Go lint issues                           |
| **Lint (Frontend)** | `frontend-lint`         | Lint JS and CSS                              |
|                     | `frontend-lint-fix`     | Fix JS and CSS lint issues                   |
|                     | `frontend-format`       | Format frontend code with Prettier           |
|                     | `frontend-format-check` | Check frontend formatting                    |
|                     | `frontend-check`        | Run all frontend checks                      |
| **Combined**        | `lint-all`              | Lint Go and frontend code                    |
|                     | `lint-fix-all`          | Fix all lint issues                          |
|                     | `check-all`             | Run all checks                               |
| **Clean**           | `clean`                 | Remove build artifacts                       |
|                     | `clean-all`             | Remove all artifacts including node_modules  |
| **Docker**          | `docker-build`          | Build Docker image                           |
|                     | `docker-run`            | Run Docker container                         |
| **Setup**           | `setup`                 | Install all development dependencies         |

### Code Quality

Before committing, run all checks:

```bash
make check-all
```

To automatically fix issues:

```bash
make lint-fix-all
```

### Frontend Development

The frontend uses vanilla JavaScript and CSS with the following tooling:

| Tool         | Purpose                        |
| ------------ | ------------------------------ |
| ESLint       | JavaScript linting             |
| Stylelint    | CSS linting                    |
| Prettier     | Code formatting                |
| Browser-sync | Live reload during development |

Frontend-specific commands:

```bash
# Install dependencies
make frontend-install

# Lint JavaScript and CSS
make frontend-lint

# Fix lint issues
make frontend-lint-fix

# Format code
make frontend-format

# Check formatting without changes
make frontend-format-check

# Run all frontend checks
make frontend-check
```

### Using the Dev Container

If using VS Code with the Dev Containers extension:

1. Open the project in VS Code.
2. Click "Reopen in Container" when prompted.
3. The container includes Go, Node.js, FFmpeg, and SQLite.
4. Run `make setup` to install dependencies.
5. Run `make dev-full` to start the development environment.

### Building

#### Docker

Build locally:

```bash
make docker-build
```

Run the container:

```bash
make docker-run
```

### Testing

Run all tests:

```bash
make test
```

Run tests with coverage report:

```bash
make test-coverage
```

This generates `coverage.html` which can be opened in a browser.

### Project Structure

```
media-viewer/
├── cmd/
│   └── resetpw/          # Password reset utility
├── internal/
│   ├── database/         # Database operations
│   ├── handlers/         # HTTP handlers
│   ├── indexer/          # Media indexing
│   ├── logging/          # Logging utilities
│   ├── media/            # Thumbnail generation, scanning
│   ├── metrics/          # Prometheus metrics
│   ├── middleware/       # HTTP middleware
│   ├── startup/          # Configuration and startup
│   └── transcoder/       # Video transcoding
├── static/
│   ├── css/              # Stylesheets
│   ├── js/               # JavaScript modules
│   ├── index.html        # Main HTML file
│   ├── package.json      # Frontend dependencies
│   ├── eslint.config.js  # ESLint configuration
│   └── .prettierrc       # Prettier configuration
├── main.go               # Application entry point
├── Makefile              # Build and development tasks
└── README.md
```

````markdown
### Environment Variables for Development

When running locally, you may want to set these environment variables:

| Variable             | Development Value | Description                     |
| -------------------- | ----------------- | ------------------------------- |
| `MEDIA_DIR`          | `./sample-media`  | Path to test media files        |
| `CACHE_DIR`          | `./cache`         | Local cache directory           |
| `DATABASE_DIR`       | `./database`      | Local database directory        |
| `LOG_LEVEL`          | `debug`           | Verbose logging                 |
| `LOG_STATIC_FILES`   | `true`            | Log static file requests        |
| `LOG_HEALTH_CHECKS`  | `false`           | Reduce noise from health checks |
| `METRICS_ENABLED`    | `true`            | Enable metrics endpoint         |
| `METRICS_PORT`       | `9090`            | Metrics server port             |
| `INDEX_INTERVAL`     | `5m`              | Faster re-indexing for testing  |
| `THUMBNAIL_INTERVAL` | `30m`             | Faster thumbnail regeneration   |

Example:

```bash
export MEDIA_DIR=./sample-media
export CACHE_DIR=./cache
export DATABASE_DIR=./database
export LOG_LEVEL=debug
make dev
```
````

Or create a `.env` file (not committed to git):

```bash
MEDIA_DIR=./sample-media
CACHE_DIR=./cache
DATABASE_DIR=./database
LOG_LEVEL=debug
LOG_STATIC_FILES=true
LOG_HEALTH_CHECKS=false
INDEX_INTERVAL=5m
THUMBNAIL_INTERVAL=30m
```

### Debugging

#### Go Debugging with VS Code

The dev container includes Go debugging support. Create or update `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Launch Media Viewer",
            "type": "go",
            "request": "launch",
            "mode": "auto",
            "program": "${workspaceFolder}",
            "buildFlags": "-tags=fts5",
            "env": {
                "MEDIA_DIR": "./sample-media",
                "CACHE_DIR": "./cache",
                "DATABASE_DIR": "./database",
                "LOG_LEVEL": "debug"
            }
        }
    ]
}
```

#### Viewing Metrics Locally

With the development server running:

```bash
# View all metrics
curl http://localhost:9090/metrics

# Filter for specific metrics
curl -s http://localhost:9090/metrics | grep media_viewer_http

# Check metrics server health
curl http://localhost:9090/health
```

#### Database Inspection

The SQLite database can be inspected directly:

```bash
# Open database shell
sqlite3 ./database/media.db

# Useful queries
.tables                              # List all tables
SELECT COUNT(*) FROM files;          # Count indexed files
SELECT * FROM users;                 # View users (passwords are hashed)
SELECT * FROM tags;                  # View all tags
SELECT * FROM favorites;             # View favorites
.schema files                        # View table schema
```

#### Log Levels

Set `LOG_LEVEL` to control verbosity:

| Level   | Description                                |
| ------- | ------------------------------------------ |
| `debug` | All messages including detailed debugging  |
| `info`  | Informational messages and above (default) |
| `warn`  | Warnings and errors only                   |
| `error` | Errors only                                |

### Troubleshooting

#### Build Fails with CGO Errors

Ensure GCC is installed:

```bash
# Ubuntu/Debian
sudo apt-get install build-essential

# macOS
xcode-select --install

# Alpine (in Docker)
apk add gcc musl-dev
```

#### FTS5 Search Not Working

Ensure you're building with the `fts5` tag:

```bash
# Correct
go build -tags 'fts5' .
make build

# Incorrect (missing tag)
go build .
```

#### Air Hot Reload Not Working

Check that `.air.toml` exists and includes the fts5 tag:

```toml
[build]
  cmd = "go build -tags 'fts5' -o ./tmp/main ."
```

#### Frontend Changes Not Reflecting

1. Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)
2. Ensure browser-sync is running (`make dev-frontend`)
3. Check browser-sync is proxying to the correct port

#### Port Already in Use

```bash
# Find process using port 8080
lsof -i :8080

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=8081 make dev
```

#### Permission Denied on Media Directory

Ensure the media directory is readable:

```bash
# Check permissions
ls -la /path/to/media

# Fix permissions if needed
chmod -R 755 /path/to/media
```

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

### Available Tags

| Tag           | Description                            |
| ------------- | -------------------------------------- |
| `latest`      | Latest stable release from main branch |
| `v1.0.0`      | Specific version tag                   |
| `v1.0`        | Latest patch version of 1.0.x          |
| `v1`          | Latest minor version of 1.x.x          |
| `sha-abc1234` | Specific commit build                  |

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
