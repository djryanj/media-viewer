# Installation

Media Viewer can be deployed using Docker (recommended) or built from source with Go.

## Docker Installation

Docker is the recommended installation method as it handles all dependencies automatically.

### Using Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        container_name: media-viewer
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
            - SESSION_DURATION=24h
        restart: unless-stopped

volumes:
    media-cache:
    media-database:
```

Start the application:

```bash
docker-compose up -d
```

### Using Docker Run

```bash
docker run -d \
  --name media-viewer \
  -p 8080:8080 \
  -p 9090:9090 \
  -v /path/to/your/media:/media:ro \
  -v media-cache:/cache \
  -v media-database:/database \
  ghcr.io/djryanj/media-viewer:latest
```

## GPU-Accelerated Transcoding (Optional)

For significantly faster video transcoding, you can enable GPU acceleration:

### NVIDIA GPU

Add GPU support to docker-compose.yml:

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        runtime: nvidia # Use NVIDIA runtime
        environment:
            - GPU_ACCEL=nvidia
        # ... rest of configuration
```

Or with docker run:

```bash
docker run -d \
  --gpus all \
  -e GPU_ACCEL=nvidia \
  ... \
  ghcr.io/djryanj/media-viewer:latest
```

**Requirements:** NVIDIA GPU with NVENC support, NVIDIA container toolkit installed

### Intel/AMD GPU (VA-API)

Add device mapping to docker-compose.yml:

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        devices:
            - /dev/dri:/dev/dri
        environment:
            - GPU_ACCEL=vaapi
        # ... rest of configuration
```

Or with docker run:

```bash
docker run -d \
  --device /dev/dri:/dev/dri \
  -e GPU_ACCEL=vaapi \
  ... \
  ghcr.io/djryanj/media-viewer:latest
```

**Requirements:** Intel or AMD GPU with VA-API support, `/dev/dri` device available

### Performance

GPU transcoding provides 2-5x faster video processing with lower CPU usage, especially beneficial for:

- 4K/8K video transcoding
- Multiple concurrent transcode operations
- Systems with limited CPU capacity

If GPU is unavailable or fails, the system automatically falls back to CPU transcoding.

## Building from Source

For development or custom deployments:

### Prerequisites

- Go 1.21 or later
- FFmpeg
- GCC (for SQLite CGO compilation)
- Node.js 18+ (for frontend development tools only)

### Steps

1. Clone the repository:

    ```bash
    git clone https://github.com/djryanj/media-viewer.git
    cd media-viewer
    ```

2. Build the application:

    ```bash
    go build -tags 'fts5' -o media-viewer ./cmd/media-viewer
    ```

3. (Optional) Build the password reset utility:

    ```bash
    go build -tags 'fts5' -o resetpw ./cmd/resetpw
    ```

4. Configure environment variables (see [Configuration](configuration.md))

5. Start the server:

    ```bash
    ./media-viewer
    ```

## Initial Setup

On first run, Media Viewer will prompt you to create a password:

1. Access the application at `http://localhost:8080`
2. You'll be redirected to the setup page
3. Create a secure password (minimum 6 characters)
4. Click **Create Password**
5. You'll be automatically logged in

## Verifying Installation

Once running, access Media Viewer at `http://localhost:8080` (or your configured port). You should see either:

- The **setup page** (first time) - create your password
- The **login page** (subsequent runs) - enter your password

## Next Steps

- [Configure your installation](configuration.md)
- [Follow the Quick Start guide](quick-start.md)
