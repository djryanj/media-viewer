# Media Viewer

<div style="text-align:center"><img src="static/icons/icon-192x192.png" /></div>

A lightweight, containerized, single-user web application for browsing and viewing images and videos from a mounted directory.

## Features

- Browse folders and files with thumbnail previews
- View images and videos in a lightbox with swipe/keyboard navigation
- Play Windows Media Player playlists (.wpl)
- Automatic video transcoding for browser compatibility
- Full-text fuzzy search with tag support
- Tag files for organization
- Pin favorites to the home page
- **Passkey (WebAuthn) authentication** - Sign in with biometrics or security keys
- Single-user authentication with password support
- Prometheus metrics endpoint for monitoring
- Progressive Web App (PWA) for native app-like feel

## AI Disclosure

See: [AI.md](AI.md).

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

| Environment Variable | Default        | Description                                                                                                                            |
| -------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_DIR`          | `/media`       | Path to media directory inside container                                                                                               |
| `CACHE_DIR`          | `/cache`       | Path to cache directory (thumbnails, transcodes)                                                                                       |
| `DATABASE_DIR`       | `/database`    | Path to database directory                                                                                                             |
| `PORT`               | `8080`         | HTTP server port                                                                                                                       |
| `METRICS_PORT`       | `9090`         | Prometheus metrics server port                                                                                                         |
| `METRICS_ENABLED`    | `true`         | Enable or disable the metrics server                                                                                                   |
| `INDEX_INTERVAL`     | `30m`          | How often to perform a full re-index of the media directory                                                                            |
| `POLL_INTERVAL`      | `30s`          | How often to check for filesystem changes (lightweight scan for new/modified/deleted files)                                            |
| `THUMBNAIL_INTERVAL` | `6h`           | How often the thumbnail generator performs a full scan (incremental updates happen automatically after indexing)                       |
| `SESSION_DURATION`   | `24h`          | How long user sessions remain valid (sliding expiration extends on activity)                                                           |
| `SESSION_CLEANUP`    | `1h`           | How often to clean up expired sessions from the database                                                                               |
| `WEBAUTHN_ENABLED`   | `false`        | Enable passkey (WebAuthn) authentication                                                                                               |
| `WEBAUTHN_RP_ID`     | (none)         | WebAuthn Relying Party ID (domain name, e.g., `example.com`)                                                                           |
| `WEBAUTHN_RP_NAME`   | `Media Viewer` | Display name for WebAuthn prompts                                                                                                      |
| `WEBAUTHN_ORIGINS`   | (none)         | Comma-separated list of allowed origins (e.g., `https://example.com,https://media.example.com`)                                        |
| `LOG_LEVEL`          | `info`         | Server log level (`debug`, `info`, `warn`, `error`)                                                                                    |
| `LOG_STATIC_FILES`   | `false`        | Log static file requests                                                                                                               |
| `LOG_HEALTH_CHECKS`  | `true`         | Log health check endpoint requests                                                                                                     |
| `MEMORY_LIMIT`       | (none)         | Container memory limit in bytes. Set via Kubernetes Downward API to enable automatic GOMEMLIMIT configuration.                         |
| `MEMORY_RATIO`       | `0.85`         | Percentage of `MEMORY_LIMIT` to allocate to Go heap (0.0-1.0). The remainder is reserved for FFmpeg, image processing, and OS buffers. |
| `GOMEMLIMIT`         | (none)         | Direct override for Go's memory limit. If set, takes precedence over `MEMORY_LIMIT`. Accepts values like `400MiB` or `1GiB`.           |

> **Note:** Setting `SESSION_DURATION` below 5 minutes is not recommended as it may cause sessions to expire between keepalive intervals.

### Boolean Environment Variables

Boolean environment variables accept the following values:

- True: `true`, `1`, `t`, `T`, `TRUE`
- False: `false`, `0`, `f`, `F`, `FALSE`

### Duration Values

`INDEX_INTERVAL`, `POLL_INTERVAL`, and `THUMBNAIL_INTERVAL` use Go's duration format:

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
POLL_INTERVAL=30s           # Every 30 seconds (default)
POLL_INTERVAL=1m            # Every minute
INDEX_INTERVAL=30m          # Every 30 minutes (default)
THUMBNAIL_INTERVAL=6h       # Every 6 hours (default)
THUMBNAIL_INTERVAL=1h30m    # Every 1 hour and 30 minutes
```

Invalid formats:

```bash
POLL_INTERVAL=30            # Missing unit
THUMBNAIL_INTERVAL=1d       # Days not supported
```

#### Recommended Values

##### Poll Interval

| Use Case                    | Value       |
| --------------------------- | ----------- |
| Frequently changing library | `10s`-`30s` |
| Stable library              | `1m`-`5m`   |
| Minimal resource usage      | `5m`-`15m`  |

##### Index Interval

| Use Case             | Value      |
| -------------------- | ---------- |
| Development/Testing  | `5m`-`15m` |
| Production           | `30m`-`1h` |
| Large/stable library | `1h`-`6h`  |

##### Thumbnail Interval

| Use Case                          | Value         |
| --------------------------------- | ------------- |
| Development/Testing               | `30m` or `1h` |
| Small library (< 1000 files)      | `6h`          |
| Medium library (1000-10000 files) | `12h`         |
| Large library (> 10000 files)     | `24h`         |

> **Note:** Thumbnail generation now runs incrementally after each index completion. The `THUMBNAIL_INTERVAL` controls periodic full scans as a fallback to catch any missed changes.

### Memory Configuration

When running in Kubernetes or other container environments, the application can be configured to respect memory limits and avoid OOM (Out of Memory) kills.

#### Recommended Values

Use approximately a 4:1 ratio of CPU:Memory, e.g.:

During testing on a system with 4 cores (8 threads) and a library of ~40,000 items, a minimum 2Gb memory limit was required to prevent OOMKills.

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

## Progressive Web App (PWA)

Media Viewer can be installed as a PWA on mobile devices for a native app-like experience:

- **No browser UI** when launched from home screen
- **Home screen icon** with custom app icon
- **Offline support** for cached app shell
- **Screen wake lock** keeps display on during media viewing

#### Installing the PWA

**Android (Chrome, Edge, Firefox, Samsung Internet):**

1. Open the app in your browser
2. Tap the three-dot menu (⋮)
3. Tap "Add to Home Screen" or "Install App"
4. Launch from the home screen icon

**iOS (Safari):**

1. Open the app in Safari
2. Tap the Share button (square with arrow)
3. Tap "Add to Home Screen"
4. Launch from the home screen icon

#### PWA Browser Support

| Browser          | Add to Home Screen | Standalone Mode | Wake Lock |
| ---------------- | ------------------ | --------------- | --------- |
| Chrome Android   | ✅                 | ✅              | ✅        |
| Safari iOS       | ✅                 | ✅              | ❌        |
| Firefox Android  | ✅                 | ⚠️ minimal-ui   | ✅        |
| Samsung Internet | ✅                 | ✅              | ✅        |
| Edge Android     | ✅                 | ✅              | ✅        |

Firefox Android does not support true standalone mode but will use `minimal-ui` (reduced browser chrome) as a fallback.

**_NOTE_**: PWA has only been tested on Firefox Android but the above table should be accurate. If you want to provide test results from other mobile browsers those are welcome!

## WebAuthn (Passkey) Authentication

Media Viewer supports passwordless authentication using passkeys (WebAuthn/FIDO2). Users can sign in with:

- **Biometrics**: Face ID, Touch ID, Windows Hello
- **Security keys**: YubiKey, Titan, etc.
- **Platform authenticators**: Built-in device authenticators

### Features

- **Passwordless login**: No need to remember or type passwords
- **Multi-device**: Register passkeys on multiple devices
- **Auto-prompt**: Automatically offers passkey login when available
- **Conditional UI**: Passkeys appear in password field autofill (supported browsers)
- **Fallback**: Password authentication still available

### Browser Support

| Browser      | Platform Auth | Security Keys | Conditional UI |
| ------------ | ------------- | ------------- | -------------- |
| Chrome 108+  | ✅            | ✅            | ✅             |
| Edge 108+    | ✅            | ✅            | ✅             |
| Safari 16+   | ✅            | ✅            | ✅             |
| Firefox 119+ | ✅            | ✅            | ❌             |

### Configuration

WebAuthn requires HTTPS (secure context) in production. Configure the following environment variables:

```yaml
environment:
    - WEBAUTHN_ENABLED=true
    - WEBAUTHN_RP_ID=example.com # Your domain
    - WEBAUTHN_RP_NAME=Media Viewer # Display name
    - WEBAUTHN_ORIGINS=https://example.com # Allowed origins
```

**Important**: The `WEBAUTHN_RP_ID` must match your domain. For example:

- If accessing via `https://media.example.com`, set `WEBAUTHN_RP_ID=example.com`
- For `https://example.com`, set `WEBAUTHN_RP_ID=example.com`
- The RP ID must be a valid domain suffix of the origin

Multiple origins can be specified:

```yaml
WEBAUTHN_ORIGINS=https://example.com,https://media.example.com
```

### Secure Context Requirement

WebAuthn **requires a secure context**:

- ✅ `https://` URLs (production)
- ✅ `http://localhost` (development only - browser exception)
- ❌ `http://` with IP addresses (e.g., `http://192.168.1.50:8080`)

### Adding Passkeys

After setting up WebAuthn:

1. Log in with your password
2. Open **Settings** → **Passkeys** tab
3. Click **Add Passkey**
4. Name your passkey (e.g., "MacBook Pro", "iPhone")
5. Complete the biometric prompt or security key tap
6. Next login, use your passkey instead of password

### Development with WebAuthn

See [Testing WebAuthn During Development](#testing-webauthn-during-development) for setup instructions.

## Monitoring

Media Viewer exposes Prometheus metrics on a separate port (default: 9090) for monitoring application health and performance. The port can be configured with the `METRICS_PORT` environment variable.

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
| `WEBAUTHN_ENABLED`   | `true`            | Enable passkey authentication   |

Example:

```bash
export MEDIA_DIR=./sample-media
export CACHE_DIR=./cache
export DATABASE_DIR=./database
export LOG_LEVEL=debug
make dev
```

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
WEBAUTHN_ENABLED=true
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME="Media Viewer Dev"
WEBAUTHN_ORIGINS=http://localhost:8080
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

### Testing PWA Features

PWA features (service worker, installation prompts, standalone mode) require a **secure context**:

- ✅ `https://` URLs
- ✅ `http://localhost` (special browser exception)
- ❌ `http://` with IP addresses (e.g., `http://192.168.1.50:8080`)

**To test on mobile devices**, you need HTTPS. Options include:

#### Testing PWA and WebAuthN on Mobile Devices

PWA and WebAuthN features require HTTPS (except `localhost`). To test on mobile devices during development:

**Option 1: ngrok (Recommended)**

```bash
# Terminal 1: Start the development server
make dev

# Terminal 2: Start ngrok tunnel
ngrok http 8080
```

ngrok will display a URL like `https://abc123.ngrok-free.app`. Configure WebAuthn:

```bash
export WEBAUTHN_ENABLED=true
export WEBAUTHN_RP_ID=abc123.ngrok-free.app
export WEBAUTHN_RP_NAME="Media Viewer Dev"
export WEBAUTHN_ORIGINS=https://abc123.ngrok-free.app
make dev
```

**Benefits**:

- ✅ Real HTTPS with valid certificate
- ✅ Test on mobile devices
- ✅ Test with real-world conditions
- ✅ Free tier available

**Limitations**:

- URL changes on each restart (paid plans offer stable URLs)
- Requires internet connection

#### Option 3: Cloudflare Tunnel

Similar to ngrok but from Cloudflare:

```bash
# Install cloudflared
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Terminal 1: Start dev server
make dev

# Terminal 2: Start tunnel
cloudflared tunnel --url http://localhost:8080
```

Configure WebAuthn with the provided URL:

```bash
export WEBAUTHN_ENABLED=true
export WEBAUTHN_RP_ID=<tunnel-url>.trycloudflare.com
export WEBAUTHN_ORIGINS=https://<tunnel-url>.trycloudflare.com
make dev
```

#### Option 4: Local HTTPS with mkcert (Advanced)

Generate trusted local certificates:

```bash
# Install mkcert
# macOS: brew install mkcert
# Linux: https://github.com/FiloSottile/mkcert#installation

# Install local CA
mkcert -install

# Generate certificates
mkdir -p certs
mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem \
  localhost 127.0.0.1 192.168.1.50  # Add your local IP

# Configure WebAuthn
export WEBAUTHN_ENABLED=true
export WEBAUTHN_RP_ID=localhost
export WEBAUTHN_ORIGINS=http://localhost:8080
```

Update your code to use `http.ListenAndServeTLS()` or run behind an HTTPS proxy.

**Benefits**:

- ✅ Works offline
- ✅ Stable URLs
- ✅ Test on local network devices

**Limitations**:

- Requires code changes to serve HTTPS
- More complex setup

#### Recommended Development Workflow

**For solo development on one machine**:

```bash
# Use localhost (simplest)
export WEBAUTHN_ENABLED=true
export WEBAUTHN_RP_ID=localhost
export WEBAUTHN_ORIGINS=http://localhost:8080
make dev
```

**Option 4: Chrome Android flags (development only)**

- Open `chrome://flags`
- Search for "unsafely-treat-insecure-origin-as-secure"
- Add your origin (e.g., `http://192.168.1.50:8080`)

### Developer Troubleshooting

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
