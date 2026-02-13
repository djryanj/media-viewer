# Configuration

Media Viewer is configured through environment variables. This page documents all available options.

## Core Settings

### MEDIA_DIR

Path to your media directory inside the container. Defaults to `/media`.

```bash
MEDIA_DIR=/media
```

### CACHE_DIR

Path where thumbnails and transcoded videos are stored. Defaults to `/cache`.

```bash
CACHE_DIR=/cache
```

### DATABASE_DIR

Path where the SQLite database is stored. Defaults to `/database`.

```bash
DATABASE_DIR=/database
```

### TRANSCODER_LOG_DIR

Path where transcoder logs are saved (optional). No default value.

```bash
TRANSCODER_LOG_DIR=/logs/transcoder
```

When configured, FFmpeg output logs for each transcode operation are saved to this directory with timestamped filenames. Useful for debugging video transcoding issues.

If not set, transcoder logs are not saved to disk.

### PORT

Port the application listens on. Defaults to `8080`.

```bash
PORT=8080
```

## Session Settings

### SESSION_DURATION

Duration of user sessions. Uses Go duration format (e.g., `1h`, `30m`, `24h`).

Default: `24h`

```bash
SESSION_DURATION=24h
```

Common values:

| Duration | Value  |
| -------- | ------ |
| 30 min   | `30m`  |
| 1 hour   | `1h`   |
| 4 hours  | `4h`   |
| 24 hours | `24h`  |
| 7 days   | `168h` |

!!! warning "Minimum Duration"
Setting `SESSION_DURATION` below `5m` is not recommended as it may cause sessions to expire between keepalive intervals.

### SESSION_CLEANUP

How often to clean up expired sessions from the database. Defaults to `1h`.

```bash
SESSION_CLEANUP=1h
```

## Indexing Settings

### INDEX_INTERVAL

How often to perform a full re-index of the media directory. Defaults to `30m`.

```bash
INDEX_INTERVAL=30m
```

### POLL_INTERVAL

How often to check for filesystem changes (lightweight scan). Defaults to `30s`.

```bash
POLL_INTERVAL=30s
```

### THUMBNAIL_INTERVAL

How often the thumbnail generator performs a full scan. Defaults to `6h`.

```bash
THUMBNAIL_INTERVAL=6h
```

### INDEX_WORKERS

Number of parallel workers for directory indexing. Defaults to 3 for NFS safety.

```bash
INDEX_WORKERS=3
```

**When to set this:**

- **NFS-mounted media**: Set to `3` or lower to prevent overwhelming the NFS server
- **Local storage**: Can increase to `8`-`16` for faster indexing
- **High-performance storage**: Increase to `8`-`16` for optimal performance

!!! warning "NFS Performance"
If you see "stale file handle" errors in the logs, your NFS server is being overwhelmed. Reduce `INDEX_WORKERS` to `1` or `2`.

**Recommended values:**

| Storage Type             | Recommended Value |
| ------------------------ | ----------------- |
| NFS mount (default)      | `3`               |
| NFS mount (conservative) | `1`               |
| Local HDD/SSD            | `8`               |
| High-performance local   | `8`-`16`          |

## Metrics Settings

### METRICS_ENABLED

Enable or disable the Prometheus metrics server. Defaults to `true`.

```bash
METRICS_ENABLED=true
```

### METRICS_PORT

Port for the Prometheus metrics endpoint. Defaults to `9090`.

```bash
METRICS_PORT=9090
```

## Logging Settings

### LOG_LEVEL

Server log level. Defaults to `info`.

Options: `debug`, `info`, `warn`, `error`

```bash
LOG_LEVEL=info
```

### LOG_STATIC_FILES

Log static file requests. Defaults to `false`.

```bash
LOG_STATIC_FILES=false
```

### LOG_HEALTH_CHECKS

Log health check endpoint requests. Defaults to `true`.

```bash
LOG_HEALTH_CHECKS=true
```

## WebAuthn Settings

See [WebAuthn Setup](../admin/webauthn.md) for detailed configuration.

### WEBAUTHN_ENABLED

Enable passkey (WebAuthn) authentication. Defaults to `false`.

```bash
WEBAUTHN_ENABLED=true
```

### WEBAUTHN_RP_ID

WebAuthn Relying Party ID (your domain).

```bash
WEBAUTHN_RP_ID=example.com
```

### WEBAUTHN_RP_NAME

Display name shown in authenticator prompts. Defaults to `Media Viewer`.

```bash
WEBAUTHN_RP_NAME="My Media Library"
```

### WEBAUTHN_ORIGINS

Comma-separated list of allowed origins.

```bash
WEBAUTHN_ORIGINS=https://example.com,https://media.example.com
```

## Memory Settings

### MEMORY_RATIO (Recommended)

Percentage of container memory to allocate to Go heap (0.0-1.0). **Recommended for production.**

```bash
MEMORY_RATIO=0.75  # Recommended value for production
```

**Why use MEMORY_RATIO:**

- ✅ Container-aware: Respects memory limits
- ✅ Adaptive: GC scales with workload
- ✅ Lower overhead: 0.16% CPU during heavy load
- ✅ Memory-safe: Prevents OOM conditions

**Benchmark results** (3,106 thumbnail test):

- `0.85` (default): 0.18% overhead, 7 GC/s under load
- `0.75` (recommended): 0.16% overhead, 6 GC/s under load ✅
- `0.70`: 0.20% overhead, 8 GC/s under load

### GOGC (Alternative)

Go garbage collection target percentage. Use for non-containerized deployments.

```bash
GOGC=150
```

**When to use GOGC:**

- Running on bare metal or VMs (not containerized)
- No memory limits set
- Want simple, fixed configuration

**Performance:** 0.15% CPU overhead, 4.5 GC/s (constant rate)

**Note:** MEMORY_RATIO=0.75 is preferred for Docker/Kubernetes deployments.

### MEMORY_LIMIT

Container memory limit in bytes (typically set via Kubernetes Downward API).

```bash
MEMORY_LIMIT=536870912  # 512MB
```

### GOMEMLIMIT

Direct override for Go's memory limit. Accepts values like `400MiB` or `1GiB`.

```bash
GOMEMLIMIT=400MiB
```

Note: If using Kubernetes, it is recommended to set this using the Downward API, e.g. in the container spec:

```yaml
env:
    - name: MEMORY_LIMIT
        valueFrom:
        resourceFieldRef:
            resource: limits.memory
```

## Volume Mounts

### Media Directory

Mount your media library as read-only for security:

```bash
-v /path/to/media:/media:ro
```

### Cache Directory

Persist thumbnails and transcoded videos:

```bash
-v media-cache:/cache
```

### Database Directory

Persist application database (user, sessions, tags, favorites):

```bash
-v media-database:/database
```

## Example Configurations

### Minimal Configuration

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        ports:
            - '8080:8080'
        volumes:
            - /photos:/media:ro
            - cache:/cache
            - database:/database

volumes:
    cache:
    database:
```

### Production Configuration

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        ports:
            - '8080:8080'
            - '9090:9090'
        volumes:
            - /mnt/storage/media:/media:ro
            - /var/lib/media-viewer/cache:/cache
            - /var/lib/media-viewer/database:/database
        environment:
            - MEDIA_DIR=/media
            - SESSION_DURATION=12h
            - INDEX_INTERVAL=1h
            - THUMBNAIL_INTERVAL=12h
            - INDEX_WORKERS=3 # Recommended for NFS mounts
            - METRICS_ENABLED=true
            - LOG_LEVEL=info
            - LOG_STATIC_FILES=false
        restart: unless-stopped
        healthcheck:
            test:
                ['CMD', 'wget', '--quiet', '--tries=1', '--spider', 'http://localhost:8080/health']
            interval: 30s
            timeout: 10s
            retries: 3
            start_period: 10s
```

### Development Configuration

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        ports:
            - '8080:8080'
            - '9090:9090'
        volumes:
            - ./sample-media:/media:ro
            - dev-cache:/cache
            - dev-database:/database
        environment:
            - LOG_LEVEL=debug
            - LOG_STATIC_FILES=true
            - INDEX_INTERVAL=5m
            - THUMBNAIL_INTERVAL=30m

volumes:
    dev-cache:
    dev-database:
```

## Reverse Proxy Setup

When running behind a reverse proxy (nginx, Traefik, Caddy), configure it to properly forward requests.

### Nginx Example

```nginx
server {
    listen 443 ssl http2;
    server_name media.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Increase timeouts for large file uploads/streaming
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### Traefik Example (Docker Labels)

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        labels:
            - 'traefik.enable=true'
            - 'traefik.http.routers.media-viewer.rule=Host(`media.example.com`)'
            - 'traefik.http.routers.media-viewer.entrypoints=websecure'
            - 'traefik.http.routers.media-viewer.tls.certresolver=letsencrypt'
            - 'traefik.http.services.media-viewer.loadbalancer.server.port=8080'
```

### Caddy Example

```
media.example.com {
    reverse_proxy localhost:8080
}
```

## Duration Format Reference

Many settings use Go's duration format:

| Unit         | Suffix | Example |
| ------------ | ------ | ------- |
| Nanoseconds  | `ns`   | `500ns` |
| Microseconds | `us`   | `100us` |
| Milliseconds | `ms`   | `500ms` |
| Seconds      | `s`    | `30s`   |
| Minutes      | `m`    | `30m`   |
| Hours        | `h`    | `6h`    |

You can combine units: `1h30m` (1 hour 30 minutes)

!!! info "No Day Unit"
Go's duration format doesn't support a "day" unit. Use hours instead (e.g., `24h` for one day, `168h` for one week).
