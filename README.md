# Media Viewer

<div style="text-align:center"><img src="static/icons/icon-192x192.png" /></div>

A lightweight, containerized, single-user web application for browsing and viewing images and videos from a mounted directory.

## Features

- Browse folders and files with thumbnail previews
- Lightbox viewer with swipe/keyboard navigation
- Windows Media Player playlist support (.wpl)
- Automatic video transcoding for browser compatibility
- Full-text fuzzy search with tag support
- Tag files for organization
- Pin favorites to the home page
- Passkey (WebAuthn) authentication with biometric support
- Progressive Web App (PWA) for mobile
- Prometheus metrics for monitoring

## Documentation

**📖 Full documentation is available at: [https://djryanj.github.io/media-viewer/](https://djryanj.github.io/media-viewer/)**

- [Quick Start Guide](https://djryanj.github.io/media-viewer/getting-started/quick-start/)
- [Installation](https://djryanj.github.io/media-viewer/getting-started/installation/)
- [Configuration](https://djryanj.github.io/media-viewer/getting-started/configuration/)
- [User Guide](https://djryanj.github.io/media-viewer/user-guide/overview/)
- [API Documentation](https://djryanj.github.io/media-viewer/api/overview/)
- [Development Guide](https://djryanj.github.io/media-viewer/development/contributing/)

## AI Disclosure

See: [AI.md](AI.md).

## Quick Start

### Docker Compose (Recommended)

Create a `docker-compose.yml` file:

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
        restart: unless-stopped

volumes:
    media-cache:
    media-database:
```

Update `/path/to/your/media` to point to your media directory, then start:

```bash
docker-compose up -d
```

Open http://localhost:8080 in your browser. On first run, you'll be prompted to create a user account.

### Docker CLI

```bash
docker run -d \
  --name media-viewer \
  -p 8080:8080 \
  -v /path/to/your/media:/media:ro \
  -v media-cache:/cache \
  -v media-database:/database \
  ghcr.io/djryanj/media-viewer:latest
```

## Supported Formats

**Images:** jpg, jpeg, png, gif, bmp, webp, svg, ico, tiff, heic, heif, avif, jxl, raw, cr2, nef, arw, dng

**Videos:** mp4, mkv, avi, mov, wmv, flv, webm, m4v, mpeg, mpg, 3gp, ts (automatic transcoding for browser compatibility)

**Playlists:** Windows Media Player (.wpl)

## Installation

Pull from GitHub Container Registry:

```bash
docker pull ghcr.io/djryanj/media-viewer:latest
```

### Available Tags

| Tag           | Description                            |
| ------------- | -------------------------------------- |
| `latest`      | Latest stable release from main branch |
| `v1.0.0`      | Specific version tag                   |
| `v1.0`        | Latest patch version of 1.0.x          |
| `sha-abc1234` | Specific commit build                  |

### Build from Source

```bash
git clone https://github.com/djryanj/media-viewer.git
cd media-viewer
make setup
make build
./media-viewer
```

See the [Development Guide](https://djryanj.github.io/media-viewer/development/contributing/) for details.

## License

[MIT License](LICENSE)
