# Environment Variables

Complete reference for all environment variables supported by Media Viewer.

## Quick Reference

| Variable                      | Default        | Description                                            |
| ----------------------------- | -------------- | ------------------------------------------------------ |
| **Paths**                     |                |                                                        |
| `MEDIA_DIR`                   | `/media`       | Media directory path                                   |
| `CACHE_DIR`                   | `/cache`       | Cache directory for thumbnails and transcoded videos   |
| `DATABASE_DIR`                | `/database`    | Database directory path                                |
| **Database**                  |                |                                                        |
| `DB_MMAP_DISABLED`            | `false`        | Disable SQLite mmap (avoid SIGBUS on network storage)  |
| `TRANSCODER_LOG_DIR`          | _(none)_       | Transcoder log directory (optional)                    |
| **Video Transcoding**         |                |                                                        |
| `GPU_ACCEL`                   | `auto`         | GPU acceleration (auto/nvidia/vaapi/videotoolbox/none) |
| **Network**                   |                |                                                        |
| `PORT`                        | `8080`         | HTTP server port                                       |
| `METRICS_PORT`                | `9090`         | Prometheus metrics port                                |
| `METRICS_ENABLED`             | `true`         | Enable/disable metrics server                          |
| **Indexing & Scanning**       |                |                                                        |
| `INDEX_INTERVAL`              | `30m`          | Full media re-index interval                           |
| `POLL_INTERVAL`               | `30s`          | Filesystem change detection interval                   |
| `THUMBNAIL_INTERVAL`          | `6h`           | Thumbnail generation scan interval                     |
| `INDEX_WORKERS`               | `3`            | Parallel indexer workers (tune for NFS/local)          |
| `THUMBNAIL_WORKERS`           | _(auto)_       | Thumbnail generation workers (tune for performance)    |
| **Authentication & Sessions** |                |                                                        |
| `SESSION_DURATION`            | `24h`          | User session lifetime                                  |
| `SESSION_CLEANUP`             | `1h`           | Expired session cleanup interval                       |
| **WebAuthn**                  |                |                                                        |
| `WEBAUTHN_ENABLED`            | `false`        | Enable passkey authentication                          |
| `WEBAUTHN_RP_ID`              | _(none)_       | Relying Party ID (required if enabled)                 |
| `WEBAUTHN_RP_NAME`            | `Media Viewer` | Display name for WebAuthn prompts                      |
| `WEBAUTHN_ORIGINS`            | _(none)_       | Allowed origins (required if enabled)                  |
| **Memory Management**         |                |                                                        |
| `MEMORY_LIMIT`                | _(none)_       | Container memory limit in bytes                        |
| `MEMORY_RATIO`                | `0.85`         | Go heap allocation ratio (0.75 recommended)            |
| `GOGC`                        | `150`          | Go GC target percentage (Go default: 100)              |
| `GOMEMLIMIT`                  | _(none)_       | Direct Go memory limit override                        |
| **Logging**                   |                |                                                        |
| `LOG_LEVEL`                   | `info`         | Log verbosity (debug/info/warn/error)                  |
| `LOG_STATIC_FILES`            | `false`        | Log static file requests                               |
| `LOG_HEALTH_CHECKS`           | `true`         | Log health check requests                              |
| `SLOW_QUERY_THRESHOLD_MS`     | `100`          | Threshold (ms) for logging slow database queries       |

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

### DB_MMAP_DISABLED

Disable SQLite memory-mapped I/O to avoid SIGBUS errors when the database file
is stored on unreliable or network-backed storage (for example Longhorn or NFS).

```bash
DB_MMAP_DISABLED=true
```

- Default: `false`
- When set to `true`, the application disables SQLite mmap usage. This can
  prevent SIGBUS crashes when the database file is stored on network filesystems
  that do not fully support memory-mapped I/O. There may be a small performance
  impact when disabling mmap, but it is recommended for Longhorn/NFS-style
  storage to improve stability.

### TRANSCODER_LOG_DIR

Path to the transcoder log directory (optional).

```bash
TRANSCODER_LOG_DIR=/logs/transcoder
```

- Default: (not configured)
- Optional: If not set, transcoder logs are not saved
- When configured, FFmpeg logs for each transcode operation are saved to this directory
- Log files are named: `YYYYMMDD-HHMMSS-videoname-wWIDTH.log`
- Useful for debugging transcode issues

### GPU_ACCEL

Enables GPU-accelerated video transcoding for better performance.

```bash
GPU_ACCEL=auto
```

- Default: `auto` (automatically detect available GPU)
- Options:
    - `auto` - Auto-detect GPU (tries NVIDIA → VA-API → VideoToolbox)
    - `nvidia` - Force NVIDIA NVENC (requires NVIDIA GPU and drivers)
    - `vaapi` - Force VA-API (Intel/AMD GPUs on Linux)
    - `videotoolbox` - Force VideoToolbox (macOS/Apple Silicon)
    - `none` - Disable GPU acceleration (CPU-only)

**GPU Requirements:**

- **NVIDIA**: Requires NVIDIA GPU with NVENC support and CUDA drivers
    - Docker: Use `--gpus all` flag or `--runtime=nvidia`
    - Docker Compose: Add `runtime: nvidia` or use `deploy.resources.reservations.devices`
- **Intel/AMD (VA-API)**: Requires `/dev/dri` device access
    - Docker: Add `--device /dev/dri:/dev/dri`
    - Docker Compose: Add device mapping under `devices:`
- **macOS (VideoToolbox)**: Native support, no additional configuration needed

**Performance Impact:**

GPU transcoding can be 2-5x faster than CPU transcoding while using less CPU resources. Particularly beneficial for:

- High-resolution videos (4K, 8K)
- Multiple concurrent transcoding operations
- Systems with limited CPU capacity

**Example Docker Run with GPU:**

```bash
# NVIDIA GPU
docker run --gpus all -e GPU_ACCEL=nvidia ...

# Intel/AMD GPU (VA-API)
docker run --device /dev/dri:/dev/dri -e GPU_ACCEL=vaapi ...
```

**Example Docker Compose with GPU:**

```yaml
services:
  media-viewer:
    # NVIDIA
    runtime: nvidia
    environment:
      - GPU_ACCEL=nvidia

    # OR for Intel/AMD
    devices:
      - /dev/dri:/dev/dri
    environment:
      - GPU_ACCEL=vaapi
```

If a GPU is not available or initialization fails, the system automatically falls back to CPU transcoding.

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

### INDEX_WORKERS

Number of parallel workers for directory indexing. Critical for NFS stability and performance.

```bash
INDEX_WORKERS=3
```

- Default: `3` (NFS-safe default)
- **For NFS mounts**: Set to `3` or lower
- **For local filesystems**: Can increase to `8`-`16` for better performance
- Must be a positive integer

**Why this matters:**

NFS servers can be overwhelmed by concurrent metadata operations during indexing. Too many parallel workers reading directory structures simultaneously can cause:

- Stale file handle errors (ESTALE)
- Slow indexing performance
- NFS server load spikes
- Server crashes or hangs during rapid browsing

**NFS Resilience Features:**

Media Viewer includes automatic retry logic for NFS operations:

- Stale file handle errors (ESTALE) trigger automatic retry with exponential backoff
- Up to 3 retry attempts (50ms → 100ms → 200ms backoff)
- Applies to file stat and open operations
- Zero overhead for successful operations (~100ns)
- Successful retries logged for monitoring

This retry logic works best when combined with appropriate worker tuning via `INDEX_WORKERS`.

**Recommended values:**

- **NFS mount**: `1`-`3` workers (start with 3)
- **Local SSD/HDD**: `4`-`8` workers
- **High-performance local storage**: `8`-`16` workers

**Example configurations:**

```yaml
# For NFS-mounted media (conservative)
environment:
    - INDEX_WORKERS=3

# For NFS-mounted media (aggressive, if NFS is fast)
environment:
    - INDEX_WORKERS=5

# For local SSD (use default)
environment:
    # INDEX_WORKERS not set - uses default of 3

# For high-performance local storage
environment:
    - INDEX_WORKERS=16
```

**When to adjust:**

- Seeing "stale file handle" errors in logs → reduce to 1-2
- Indexing is slow on fast local storage → increase to 8-16
- NFS server CPU high during indexing → reduce to 1-2

### THUMBNAIL_WORKERS

Number of parallel workers for thumbnail generation. Auto-calculated based on CPU cores but can be overridden.

```bash
THUMBNAIL_WORKERS=6
```

- Default: Auto-calculated (1.5× CPU cores, max 6)
- **For most systems**: Use default (no override needed
  )
- **For resource-constrained**: Set to `2`-`4` to limit resource usage
- **For high-performance**: Set to `8`-`12` for faster thumbnail generation
- Must be a positive integer

**Why this matters:**

Thumbnail generation uses both CPU (for image decoding/encoding) and I/O (reading media files). The default auto-calculation provides good balance:

- Uses libvips for efficient image processing
- Respects container CPU limits (via GOMAXPROCS)
- Capped at 6 workers to prevent overwhelming NFS mounts
- Automatically reduced under memory pressure

**Recommended values:**

- **Default (no override)**: Let the system auto-calculate (recommended for most users)
- **Resource-constrained**: `2`-`4` to limit CPU/memory usage
- **High-performance local storage**: `8`-`12` workers

**Example configurations:**

```yaml
# Use default auto-calculated workers (recommended)
environment:
    # THUMBNAIL_WORKERS not set - auto-calculated

# Limit resources on constrained system
environment:
    - THUMBNAIL_WORKERS=2

# High-performance system with fast storage
environment:
    - THUMBNAIL_WORKERS=10
```

**When to adjust:**

- System running out of memory during thumbnail generation → reduce to 2-4
- Thumbnails generating too slowly on powerful system → increase to 8-12
- High CPU usage during thumbnail scans → reduce to 2-4

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
- Large library, active transcoding: `0.75` **(recommended for production)**
- Heavy concurrent thumbnail generation: `0.70`

**Benchmark Results:**

Testing with 3,106 thumbnail generation workload:

| MEMORY_RATIO           | GC CPU %  | Idle GC Rate | Load GC Rate | Memory Usage |
| ---------------------- | --------- | ------------ | ------------ | ------------ |
| 0.85 (default)         | 0.18%     | 0.3/s        | 7/s          | 520 MB       |
| **0.75 (recommended)** | **0.16%** | **0.2/s**    | **6/s**      | **534 MB**   |
| 0.70                   | 0.20%     | 0.4/s        | 8/s          | 480 MB       |

**Why 0.75 is optimal:**

- ✅ Lowest GC overhead (0.16%)
- ✅ Adaptive: scales with workload
- ✅ More cache space (+6% vs default)
- ✅ Container-aware (respects memory limits)

For detailed tuning guidance, see [Memory and GC Tuning](memory-tuning.md).

### GOGC

Go garbage collection target percentage. Controls how much the heap can grow before triggering GC.

```bash
GOGC=150
```

- **Default**: `100` (Go runtime default)
- **Alternative to MEMORY_RATIO**: Use `150` for non-containerized deployments
- **Effect**: Higher values = less frequent GC, more memory usage
- **Note**: MEMORY_RATIO approach is preferred for production containerized deployments

**Comparison:**

| Approach              | Idle Overhead | Load Overhead | Memory Behavior |
| --------------------- | ------------- | ------------- | --------------- |
| **MEMORY_RATIO=0.75** | **0.009%**    | **0.16%**     | **Adaptive** ✅ |
| GOGC=150              | 0.15%         | 0.15%         | Fixed 📊        |

**How GOGC works:**

- `GOGC=100`: GC triggers at 2x live heap (e.g., 10MB → 20MB)
- `GOGC=150`: GC triggers at 2.5x live heap (e.g., 10MB → 25MB)
- `GOGC=200`: GC triggers at 3x live heap (e.g., 10MB → 30MB)

**When to use GOGC:**

- **Use GOGC=150** when:
    - Not using containers (bare metal, VMs)
    - Memory is unlimited
    - Want simple, predictable configuration

- **Use MEMORY_RATIO=0.75** when:
    - Running in Docker/Kubernetes
    - Have memory limits set
    - Want adaptive behavior
    - Need optimal performance (recommended)

For comprehensive tuning guidance, benchmarks, and troubleshooting, see [Memory and GC Tuning](memory-tuning.md).

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

### SLOW_QUERY_THRESHOLD_MS

Threshold in milliseconds for logging slow database queries.

```bash
SLOW_QUERY_THRESHOLD_MS=100
```

- Default: `100` (100 milliseconds)
- Queries exceeding this threshold will be logged as warnings
- Useful for identifying performance bottlenecks in production
- Set to a higher value (e.g., `500`) if you want to only log very slow queries
- Set to `0` to log all queries (not recommended for production)
- Example log output: `Slow query detected: operation=list_directory duration=0.235s status=success`

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
            - INDEX_WORKERS=3 # Set to 3 for NFS mounts, 8-16 for fast local storage

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
INDEX_WORKERS=3  # For NFS mounts; 8-16 for fast local storage

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
