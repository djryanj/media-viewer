# Media Viewer

A lightweight, containerized web application for browsing and viewing images and videos from a mounted directory.

## Features

- Browse folders and files with thumbnail previews
- View images and videos in a lightbox with swipe/keyboard navigation
- Play Windows Media Player playlists (.wpl)
- Automatic video transcoding for browser compatibility
- Full-text fuzzy search
- Pin favorites to the home page
- Single-user authentication

## Quick Start with Docker

### Using Docker Compose (Recommended)

1. Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  media-viewer:
    image: media-viewer:latest
    build: .
    ports:
      - "8080:8080"
    volumes:
      - /path/to/your/media:/media:ro
      - media-cache:/cache # optional
      - media-database:/database
    environment:
      - MEDIA_DIR=/media
      - CACHE_DIR=/cache
      - DATABASE_DIR=/database
      - PORT=8080
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
# Build the image
docker build -t media-viewer .

# Run the container
docker run -d \
  --name media-viewer \
  -p 8080:8080 \
  -v /path/to/your/media:/media:ro \
  -v media-database:/database \
  media-viewer
```

Or, PowerShell, from your media directory:

```powershell
docker run -d `
  --name media-viewer `
  -p 8080:8080 `
  -v "${PWD}:/media:ro" `
  -v media-database:/database `
  media-viewer
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MEDIA_DIR` | `/media` | Path to media directory inside container |
| `CACHE_DIR` | `/cache` | Path to cache directory (thumbnails, transcodes) |
| `DATABASE_DIR` | `/database` | Path to database directory |
| `PORT` | `8080` | HTTP server port |
| `INDEX_INTERVAL` | `30m` | How often to re-scan the media directory |
| `LOG_STATIC_FILES` | `false` | Set to `true` to log static file requests |
| `LOG_LEVEL` | `info` | Server log level. Valid values are `info`, `warn`, `warning`, `error`, `debug`. |
| `LOG_HEALTH_CHECKS` | `true` | Whether or not to log http requests on the `/healthz`, `/health`, `/livez`, `/readyz` endpoints. |

## Development Setup

### Prerequisites

- Go 1.25 or later (built with 1.25, might work with earlier versions)
- FFmpeg
- GCC (for SQLite CGO compilation)

### Running Locally

1. Clone the repository.

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

### Docker

Build locally:
```bash
docker build -t media-viewer:local .
```

Build with cross-compilation optimization (faster multi-arch builds):
```bash
docker build -f Dockerfile.cross -t media-viewer:local .
```

### Multi-architecture

The GitHub Actions workflow automatically builds for both amd64 and arm64:
- PRs: Only amd64 (for speed)
- Main branch: Both architectures
- Tags: Both architectures + SBOM generation

```bash
# Build the main application
go build -tags 'fts5' -o media-viewer .

# Build the password reset utility
go build -o resetpw ./cmd/resetpw
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
DATABASE_DIR=/path/to/cache ./resetpw reset
```

You'll be prompted for the username and new password.

Create a new user:

```bash
docker exec -it media-viewer ./resetpw create
```

### Emergency Password Reset via SQLite

If you cannot use the resetpw utility, you can reset the password directly in SQLite.

1. Generate a bcrypt hash for your new password. You can use an online bcrypt generator or this command:

```bash
# Using htpasswd (if available)
htpasswd -nbBC 10 "" "yournewpassword" | tr -d ':\n' | sed 's/$2y/$2a/'

# Or using Python
python3 -c "import bcrypt; print(bcrypt.hashpw(b'yournewpassword', bcrypt.gensalt()).decode())"
```

2. Update the database:

```bash
# Find your cache volume location
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

### Complete Password Reset Example

```bash
# Enter the container
docker exec -it media-viewer sh

# Inside the container, reset password to "newpassword123"
# First, generate hash using the resetpw tool, or manually:
sqlite3 /database/media.db "UPDATE users SET password_hash='\$2a\$10\$N9qo8uLOickgx2ZMRZoMy.MqrqBuBi.zu1r/s7OLQX1iDnXo6S0my' WHERE username='admin';"

# Clear sessions
sqlite3 /database/media.db "DELETE FROM sessions;"

# Exit container
exit
```

Note: The example hash above is for "newpassword123". Generate your own hash for security.

## Supported Formats

### Images
jpg, jpeg, png, gif, bmp, webp, svg, ico, tiff, heic

### Videos
mp4, mkv, avi, mov, wmv, flv, webm, m4v, mpeg, mpg, 3gp, ts

Videos not natively supported by browsers (like mkv) are automatically transcoded to mp4 for playback.

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
go build -tags 'fts5' -o media-viewer ./cmd/server
./media-viewer
```

## Releases

### Creating a Release

To create a new release:

1. **Update version information** (if needed)
2. **Create and push a tag**:
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```
3. **GitHub Actions will automatically**:
   - Build multi-platform Docker images (amd64, arm64)
   - Push images to `ghcr.io/djryanj/media-viewer`
   - Tag with version number and `latest`

### Available Tags

- `latest` - Latest stable release from main branch
- `v1.0.0` - Specific version tag
- `v1.0` - Latest patch version of 1.0
- `v1` - Latest minor version of 1.x
- `sha-abc1234` - Specific commit build

### Version Information

The application includes build information accessible via:
- API endpoint: `GET /api/version`
- Logs on startup

Build information includes:
- Version (from git tag or "dev")
- Commit hash
- Build timestamp
- Go version

## License

MIT License