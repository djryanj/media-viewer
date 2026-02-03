# Environment Variables

Complete reference for all environment variables supported by Media Viewer.

## Paths

### MEDIA_DIR

Path to the media directory inside the container.

```bash
MEDIA_DIR=/media
```

- Default: `/media`
- Should match your volume mount
- Mounted as read-only recommended

### CACHE_DIR

Path to the cache directory for thumbnails and transcoded videos.

```bash
CACHE_DIR=/cache
```

- Default: `/cache`
- Must be writable
- Should be persisted between container restarts

### DATABASE_DIR

Path to the database directory.

```bash
DATABASE_DIR=/database
```

- Default: `/database`
- Must be writable
- Should be persisted between container restarts

## Network

### PORT

Port the HTTP server listens on.

```bash
PORT=8080
```

- Default: `8080`
- Change if running multiple instances or if port conflicts exist

### METRICS_PORT

Port for the Prometheus metrics endpoint.

```bash
METRICS_PORT=9090
```

- Default: `9090`
- Exposes `/metrics` endpoint for Prometheus scraping

### METRICS_ENABLED

Enable or disable the metrics server.

```bash
METRICS_ENABLED=true
```

- Default: `true`
- Set to `false` to disable metrics collection

## Indexing & Scanning

### INDEX_INTERVAL

How often to perform a full re-index of the media directory.

```bash
INDEX_INTERVAL=30m
```

- Default: `30m` (30 minutes)
- Accepts Go duration format: `s`, `m`, `h`
- Examples: `15m`, `1h`, `2h30m`

### POLL_INTERVAL

How often to check for filesystem changes (lightweight scan).

```bash
POLL_INTERVAL=30s
```

- Default: `30s` (30 seconds)
- Detects new/modified/deleted files without full index
- Accepts Go duration format: `s`, `m`, `h`

**Recommended values:**

- Frequently changing library: `10s`-`30s`
- Stable library: `1m`-`5m`
- Minimal resource usage: `5m`-`15m`

### THUMBNAIL_INTERVAL

How often the thumbnail generator performs a full scan.

```bash
THUMBNAIL_INTERVAL=6h
```

- Default: `6h` (6 hours)
- Incremental updates happen automatically after indexing
- This is a fallback for missed changes
- Accepts Go duration format: `s`, `m`, `h`

**Recommended values:**

- Small library (< 1000 files): `6h`
- Medium library (1000-10000 files): `12h`
- Large library (> 10000 files): `24h`

## Authentication & Sessions

### SESSION_DURATION

How long user sessions remain valid.

```bash
SESSION_DURATION=24h
```

- Default: `24h` (24 hours)
- Uses sliding expiration (extends on activity)
- Accepts Go duration format: `s`, `m`, `h`
- Minimum recommended: `5m` (below this may cause issues)
- Examples: `30m`, `12h`, `7d`

### SESSION_CLEANUP

How often to clean up expired sessions from the database.

```bash
SESSION_CLEANUP=1h
```

- Default: `1h` (1 hour)
- Removes expired sessions periodically
- Accepts Go duration format: `s`, `m`, `h`

## WebAuthn (Passkey Authentication)

### WEBAUTHN_ENABLED

Enable passkey (WebAuthn) authentication.

```bash
WEBAUTHN_ENABLED=true
```

- Default: `false`
- Requires HTTPS (except localhost)
- Requires `WEBAUTHN_RP_ID` to be set

### WEBAUTHN_RP_ID

WebAuthn Relying Party ID (domain name).

```bash
WEBAUTHN_RP_ID=example.com
```

- Default: none (required if WebAuthn enabled)
- Must match your domain
- For `https://media.example.com`, use `example.com`
- Must be a valid domain suffix of the origin

### WEBAUTHN_RP_NAME

Display name shown in WebAuthn prompts.

```bash
WEBAUTHN_RP_NAME="My Media Viewer"
```

- Default: `Media Viewer`
- Shown to users during passkey registration

### WEBAUTHN_ORIGINS

Comma-separated list of allowed origins.

```bash
WEBAUTHN_ORIGINS=https://example.com,https://media.example.com
```

- Default: none (required if WebAuthn enabled)
- Must include all origins where app is accessed
- Must use `https://` (except `http://localhost`)

## Memory Management

### MEMORY_LIMIT

Container memory limit in bytes (Kubernetes Downward API).

```bash
MEMORY_LIMIT=536870912
```

- Default: none
- Usually set via Kubernetes Downward API
- Enables automatic GOMEMLIMIT configuration
- Example: `536870912` (512 MiB)

### MEMORY_RATIO

Percentage of `MEMORY_LIMIT` to allocate to Go heap.

```bash
MEMORY_RATIO=0.85
```

- Default: `0.85` (85%)
- Range: `0.0` to `1.0`
- Remainder reserved for FFmpeg, OS buffers, etc.

**Recommended values:**

- Small library, few videos: `0.85` (default)
- Large library, active transcoding: `0.75`
- Heavy concurrent thumbnail generation: `0.70`

### GOMEMLIMIT

Direct override for Go's memory limit.

```bash
GOMEMLIMIT=400MiB
```

- Default: none
- Takes precedence over `MEMORY_LIMIT`
- Accepts values like `400MiB`, `1GiB`, `512MB`
- Use for manual memory tuning

## Logging

### LOG_LEVEL

Server log verbosity level.

```bash
LOG_LEVEL=info
```

- Default: `info`
- Values: `debug`, `info`, `warn`, `error`
- `debug` provides detailed debugging information

### LOG_STATIC_FILES

Log static file requests.

```bash
LOG_STATIC_FILES=false
```

- Default: `false`
- Set to `true` to log CSS, JS, image requests
- Can be noisy in production

### LOG_HEALTH_CHECKS

Log health check endpoint requests.

```bash
LOG_HEALTH_CHECKS=true
```

- Default: `true`
- Set to `false` to reduce log noise from monitoring

## Duration Format

Duration values (`INDEX_INTERVAL`, `POLL_INTERVAL`, `THUMBNAIL_INTERVAL`, `SESSION_DURATION`, `SESSION_CLEANUP`) use Go's duration format:

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
POLL_INTERVAL=30s           # 30 seconds
INDEX_INTERVAL=1h30m        # 1 hour 30 minutes
SESSION_DURATION=24h        # 24 hours
THUMBNAIL_INTERVAL=6h       # 6 hours
```

**Invalid formats:**

```bash
POLL_INTERVAL=30            # Missing unit
THUMBNAIL_INTERVAL=1d       # Days not supported (use 24h)
```

## Boolean Format

Boolean environment variables accept:

- **True**: `true`, `1`, `t`, `T`, `TRUE`
- **False**: `false`, `0`, `f`, `F`, `FALSE`

## Example Configurations

### Docker Compose - Basic

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        environment:
            - MEDIA_DIR=/media
            - CACHE_DIR=/cache
            - DATABASE_DIR=/database
            - PORT=8080
            - SESSION_DURATION=24h
        volumes:
            - /path/to/media:/media:ro
            - media-cache:/cache
            - media-database:/database

volumes:
    media-cache:
    media-database:
```

### Docker Compose - Full Configuration

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        environment:
            # Paths
            - MEDIA_DIR=/media
            - CACHE_DIR=/cache
            - DATABASE_DIR=/database

            # Network
            - PORT=8080
            - METRICS_PORT=9090
            - METRICS_ENABLED=true

            # Indexing
            - INDEX_INTERVAL=30m
            - POLL_INTERVAL=30s
            - THUMBNAIL_INTERVAL=6h

            # Sessions
            - SESSION_DURATION=24h
            - SESSION_CLEANUP=1h

            # WebAuthn
            - WEBAUTHN_ENABLED=true
            - WEBAUTHN_RP_ID=example.com
            - WEBAUTHN_RP_NAME=Media Viewer
            - WEBAUTHN_ORIGINS=https://example.com,https://media.example.com

            # Logging
            - LOG_LEVEL=info
            - LOG_STATIC_FILES=false
            - LOG_HEALTH_CHECKS=true
        volumes:
            - /path/to/media:/media:ro
            - media-cache:/cache
            - media-database:/database
        ports:
            - '8080:8080'
            - '9090:9090'

volumes:
    media-cache:
    media-database:
```

### Kubernetes with Memory Management

```yaml
apiVersion: v1
kind: Pod
metadata:
    name: media-viewer
spec:
    containers:
        - name: media-viewer
          image: ghcr.io/djryanj/media-viewer:latest
          env:
              - name: MEDIA_DIR
                value: '/media'
              - name: CACHE_DIR
                value: '/cache'
              - name: DATABASE_DIR
                value: '/database'
              - name: MEMORY_LIMIT
                valueFrom:
                    resourceFieldRef:
                        resource: limits.memory
              - name: MEMORY_RATIO
                value: '0.85'
          resources:
              limits:
                  memory: '2Gi'
                  cpu: '2'
              requests:
                  memory: '1Gi'
                  cpu: '1'
```

### Environment File

Using `.env` file with Docker Compose:

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        env_file:
            - .env
```

`.env`:

```bash
# Paths
MEDIA_DIR=/media
CACHE_DIR=/cache
DATABASE_DIR=/database

# Network
PORT=8080
METRICS_PORT=9090
METRICS_ENABLED=true

# Indexing
INDEX_INTERVAL=30m
POLL_INTERVAL=30s
THUMBNAIL_INTERVAL=6h

# Sessions
SESSION_DURATION=24h
SESSION_CLEANUP=1h

# Logging
LOG_LEVEL=info
LOG_STATIC_FILES=false
LOG_HEALTH_CHECKS=true
```

## See Also

- [Server Configuration](server-config.md) - Deployment and performance tuning
- [Metrics & Monitoring](metrics.md) - Prometheus metrics reference
- [WebAuthn Setup](webauthn.md) - Passkey authentication configuration
