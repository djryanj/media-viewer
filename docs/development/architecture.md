# Architecture

This document describes the technical architecture of Media Viewer.

## Overview

Media Viewer is a client-server application with:

- **Frontend**: Single-page application (SPA) using vanilla JavaScript, HTML, and CSS
- **Backend**: Go HTTP server with Gorilla Mux router
- **Database**: SQLite with FTS5 for full-text search
- **Storage**: File system for media files, thumbnails, and transcoded videos
- **Media Processing**: FFmpeg for video transcoding and thumbnail generation

## Technology Stack

### Backend

- **Language**: Go 1.21+
- **HTTP Router**: Gorilla Mux
- **Database**: SQLite with CGO (FTS5 extension)
- **Authentication**: WebAuthn (go-webauthn/webauthn) + bcrypt password hashing
- **Media Processing**: FFmpeg (via exec)
- **Metrics**: Prometheus client library

### Frontend

- **JavaScript**: Vanilla ES6+ (no frameworks)
- **CSS**: Custom CSS with CSS Grid and Flexbox
- **Icons**: Lucide Icons (SVG)
- **PWA**: Service Worker, Web App Manifest
- **APIs**: WebAuthn, Wake Lock, Intersection Observer

## Backend Architecture

### Project Structure

```
media-viewer/
├── cmd/
│   └── resetpw/          # Password reset utility
├── internal/
│   ├── database/         # SQLite operations
│   ├── filesystem/       # Resilient filesystem operations
│   ├── handlers/         # HTTP request handlers
│   ├── indexer/          # Media library indexer
│   ├── logging/          # Structured logging
│   ├── media/            # Thumbnail generation
│   ├── memory/           # Memory monitoring
│   ├── metrics/          # Prometheus metrics
│   ├── middleware/       # HTTP middleware
│   ├── mediatypes/       # File type detection
│   ├── startup/          # Application initialization
│   ├── streaming/        # Video streaming utilities
│   ├── transcoder/       # Video transcoding
│   └── workers/          # Worker pool utilities
├── static/               # Frontend assets
│   ├── css/
│   ├── js/
│   ├── icons/
│   └── *.html
└── main.go              # Application entry point
```

### Core Components

#### HTTP Server

- **Router**: Gorilla Mux for flexible routing
- **Middleware**: Logging, compression, metrics, authentication
- **Timeouts**: Configurable read/write timeouts
- **Graceful Shutdown**: Cleanup on SIGINT/SIGTERM

#### Database Layer (`internal/database`)

- **Connection**: Single SQLite connection with mutex-based locking
- **Migrations**: Automatic schema initialization
- **Indexes**: Optimized for file path and tag queries
- **FTS5**: Full-text search on file names
- **Transactions**: Proper transaction handling for data integrity

#### Filesystem Layer (`internal/filesystem`)

Provides resilient filesystem operations with automatic retry logic for NFS stability:

- **Retry Logic**: Automatic retry with exponential backoff for ESTALE errors
- **StatWithRetry**: Wraps `os.Stat` with up to 3 retry attempts
- **OpenWithRetry**: Wraps `os.Open` with up to 3 retry attempts
- **Exponential Backoff**: 50ms → 100ms → 200ms between retries
- **Minimal Overhead**: ~100ns additional latency on successful operations
- **Smart Detection**: Only retries NFS stale file handle errors (ESTALE errno 116)
- **Logging**: Successful retries logged for monitoring and debugging

This layer prevents crashes and improves stability when serving media from NFS mounts, where stale file handles can occur due to network issues or server-side changes.

#### Indexer (`internal/indexer`)

- **Parallel Walker**: Multi-threaded directory scanning
- **Change Detection**: Polling-based file system monitoring
- **Incremental Updates**: Only processes new/modified/deleted files
- **Notifications**: Triggers thumbnail generation after index completion

#### Thumbnail Generator (`internal/media`)

- **On-Demand**: Generates thumbnails when requested
- **Background Worker**: Batch generation for new files
- **FFmpeg Integration**: Extracts video frames
- **Image Processing**: Resizes and optimizes images
- **Per-File Locking**: Prevents duplicate generation

#### Transcoder (`internal/transcoder`)

- **Streaming**: Chunks video on-the-fly
- **Caching**: Stores transcoded files for reuse
- **Format Detection**: Determines if transcoding is needed
- **FFmpeg Pipeline**: H.264 encoding for browser compatibility

#### WebAuthn Handler (`internal/handlers/webauthn.go`)

- **Registration**: Passkey enrollment with challenge-response
- **Authentication**: Passwordless login with signature verification
- **Session Management**: Temporary challenge storage (5-minute TTL)
- **Credential Storage**: Encrypted credential storage in database

### API Design

RESTful API with JSON responses:

- `GET` - Resource retrieval
- `POST` - Resource creation, actions
- `PUT` - Resource updates
- `DELETE` - Resource deletion

Authentication via HTTP-only session cookies (SHA-256 hashed tokens).

### Concurrency Model

#### Goroutines

- **HTTP Server**: One goroutine per request
- **Indexer**: Background goroutine with ticker
- **Thumbnail Generator**: Worker pool with configurable size
- **Session Cleanup**: Periodic cleanup goroutine
- **Metrics Collector**: Background stats collection

#### Worker Pools

Sized based on available CPU cores (respects container limits):

- **CPU-bound tasks**: `runtime.GOMAXPROCS(0)` workers
- **I/O-bound tasks**: `2 * GOMAXPROCS(0)` workers
- **Mixed workload**: `1.5 * GOMAXPROCS(0)` workers

#### Synchronization

- **Database**: Read-write mutex (`sync.RWMutex`)
- **Thumbnail Generation**: Per-file locks (map of mutexes)
- **Context Propagation**: Cancellation and timeouts

### Memory Management

- **GOMEMLIMIT**: Configurable via environment or Kubernetes Downward API
- **Memory Ratio**: Reserves memory for FFmpeg and OS buffers
- **GC Tuning**: Aggressive collection when approaching limit
- **Monitoring**: Prometheus metrics for heap, sys, and GC stats

## Frontend Architecture

### Module Structure

The frontend is organized into independent modules:

| Module               | File                        | Purpose                            |
| -------------------- | --------------------------- | ---------------------------------- |
| MediaApp             | `app.js`                    | Main application controller        |
| Gallery              | `gallery.js`                | Gallery rendering and interactions |
| Lightbox             | `lightbox.js`               | Full-screen media viewer           |
| Search               | `search.js`                 | Search functionality               |
| Tags                 | `tags.js`                   | Tag management                     |
| Favorites            | `favorites.js`              | Favorites management               |
| ItemSelection        | `selection.js`              | Multi-select mode                  |
| TagClipboard         | `tag-clipboard.js`          | Tag copy/paste                     |
| Player               | `playlist.js`               | Playlist player                    |
| HistoryManager       | `history.js`                | Browser history management         |
| InfiniteScroll       | `infinite-scroll.js`        | Gallery pagination                 |
| InfiniteScrollSearch | `infinite-scroll-search.js` | Search pagination                  |
| WebAuthnManager      | `webauthn.js`               | Passkey authentication             |
| SettingsManager      | `settings.js`               | Settings modal and management      |
| SessionManager       | `session.js`                | Session keepalive                  |
| WakeLockManager      | `wake-lock.js`              | Screen wake lock                   |
| TagTooltip           | `tag-tooltip.js`            | Tag overflow tooltip               |
| PreferencesManager   | `preferences.js`            | User preferences storage           |

### State Management

Application state is managed in `MediaApp.state`:

```javascript
{
  currentPath: '',      // Current directory path
  listing: null,        // Current directory listing
  mediaFiles: [],       // Files for lightbox navigation
  currentSort: { field: 'name', order: 'asc' },
  currentFilter: 'all',
  currentPage: 1,
  hasMore: false,
  isSearchMode: false,
  searchQuery: ''
}
```

### Event Flow

1. User interaction triggers event handler
2. Handler updates state and/or calls API
3. API response updates state via `setState()`
4. UI components re-render based on new state

### History Management

Browser history is managed for:

- Directory navigation (pushState)
- Lightbox overlay (replaceState)
- Search results (pushState)

The `HistoryManager` module handles back/forward navigation and state restoration.

### WebAuthn Integration

- **Registration**: Custom naming modal before browser prompt
- **Authentication**: Conditional UI (autofill) + manual button + auto-prompt
- **Credential Management**: List, add, delete passkeys
- **Fallback**: Always maintains password auth option

## Database Schema

### Core Tables

#### `files`

Indexed media files:

```sql
CREATE TABLE files (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_at INTEGER NOT NULL
);
```

#### `tags`

Tag definitions:

```sql
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);
```

#### `file_tags`

File-tag associations:

```sql
CREATE TABLE file_tags (
    file_path TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (file_path, tag_id)
);
```

#### `favorites`

Favorited items:

```sql
CREATE TABLE favorites (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
```

#### `users`

Single user account:

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

#### `sessions`

Active user sessions:

```sql
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### WebAuthn Tables

#### `webauthn_credentials`

Registered passkeys:

```sql
CREATE TABLE webauthn_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_id BLOB NOT NULL UNIQUE,
    public_key BLOB NOT NULL,
    attestation_type TEXT NOT NULL,
    aaguid BLOB,
    sign_count INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT 'Passkey',
    transports TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### `webauthn_sessions`

WebAuthn challenge data:

```sql
CREATE TABLE webauthn_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    session_data BLOB NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
```

### Full-Text Search

FTS5 virtual table for file search:

```sql
CREATE VIRTUAL TABLE files_fts USING fts5(
    path,
    name,
    content=files,
    content_rowid=rowid
);
```

## Performance Considerations

### Backend

- **Parallel Indexing**: Multi-threaded directory walker (2-4x faster)
- **Parallel Thumbnails**: Worker pool for thumbnail generation
- **Per-File Locks**: Prevents duplicate thumbnail generation
- **SQLite Indexes**: Optimized queries on path, tags, favorites
- **Streaming**: Chunked video delivery with timeout protection
- **Context Cancellation**: Stops work when clients disconnect

### Frontend

- **Infinite Scroll**: Reduces initial load time
- **Intersection Observer**: Efficient scroll detection
- **Lazy Loading**: Thumbnails loaded as needed
- **Batched Updates**: Single DOM paint for selection changes
- **Service Worker**: Caches static assets
- **Debouncing**: Search input and scroll events

### Caching Strategy

| Resource         | Cache Location | Duration | Strategy           |
| ---------------- | -------------- | -------- | ------------------ |
| Static assets    | Service Worker | 7 days   | Cache first        |
| Thumbnails       | Disk + Browser | 1 year   | Cache with revalid |
| Transcoded video | Disk           | Varies   | On-demand          |
| API responses    | None           | N/A      | Always fresh       |

## Security Model

### Authentication

- **Password**: bcrypt hashing (cost 10)
- **Sessions**: SHA-256 hashed tokens, HTTP-only cookies
- **WebAuthn**: FIDO2 with user verification required
- **Expiration**: Sliding window (default 24h)

### Authorization

Single-user model:

- All authenticated users have full access
- No role-based access control
- Path traversal prevention in file handlers

### Data Protection

- **Passwords**: Never logged or transmitted in plain text
- **Sessions**: Secure, HTTP-only, SameSite=Strict cookies
- **WebAuthn**: Private keys never leave user's device
- **HTTPS**: Required for WebAuthn in production

## Monitoring & Observability

### Prometheus Metrics

Exposed on separate port (default 9090):

- **HTTP**: Request count, duration, status codes
- **Database**: Query count, duration, errors
- **Memory**: Heap, sys, GC stats
- **Thumbnails**: Generation count, duration, cache hits
- **Indexer**: Files indexed, scan duration

### Logging

Structured logging with levels:

- `debug` - Detailed operation logs
- `info` - Normal operational messages
- `warn` - Concerning but non-critical events
- `error` - Error conditions requiring attention

### Health Checks

Multiple endpoints:

- `/health` - Basic health check
- `/livez` - Liveness probe (is process running?)
- `/readyz` - Readiness probe (can it serve traffic?)

## Deployment Architecture

### Container

- **Base Image**: Alpine Linux (small size)
- **Runtime**: Go binary + FFmpeg
- **Volumes**: Media (read-only), cache, database
- **Ports**: 8080 (HTTP), 9090 (metrics)

### Resource Limits

Recommended for typical deployment:

- **CPU**: 1-2 cores
- **Memory**: 512MB-2GB (depends on library size)
- **Storage**: Depends on thumbnail cache size

### Scalability

Current limitations (single-user design):

- Single SQLite database (not distributed)
- Single server instance (no horizontal scaling)
- Suitable for personal/family use (not multi-tenant)

Future considerations:

- PostgreSQL support for multi-user scenarios
- Distributed caching for multiple instances
- Read replicas for database queries

## NFS Resilience & Performance

Media Viewer is designed to work reliably with NFS-mounted media directories, which can experience transient failures not seen with local filesystems.

### Common NFS Issues

**Stale File Handle (ESTALE)**
: NFS returns this error when a file handle becomes invalid due to:

- File deletion or modification on the server
- NFS server restart or failover
- Network interruptions
- Cache coherency issues

**High Metadata Latency**
: NFS metadata operations (stat, readdir) are slower than local filesystems due to network round trips.

**Connection Instability**
: Network issues can cause temporary connection loss or timeouts.

### Automatic Retry Mechanism

The `internal/filesystem` package provides resilient wrappers for filesystem operations:

```go
// Stat with automatic retry for ESTALE errors
info, err := filesystem.StatWithRetry(path, filesystem.DefaultRetryConfig())

// Open with automatic retry for ESTALE errors
file, err := filesystem.OpenWithRetry(path, filesystem.DefaultRetryConfig())
```

**Retry Configuration:**

- **MaxRetries**: 3 attempts (default)
- **InitialBackoff**: 50ms
- **MaxBackoff**: 500ms (exponential backoff: 50ms → 100ms → 200ms)
- **Error Detection**: Only ESTALE (errno 116) triggers retries

**Performance Impact:**

- Successful operations: ~100-150ns overhead
- Failed operations: Add backoff delay (default: 50ms + 100ms + 200ms = 350ms)
- Transparent to callers: Drop-in replacement for `os.Stat` and `os.Open`

### Worker Tuning for NFS

The `INDEX_WORKERS` environment variable controls indexer parallelism:

**Default Behavior:**

```bash
# Defaults to 3 workers (NFS-safe)
# No environment variable needed
```

**For Tuning:**

```bash
# Conservative (for problematic NFS)
INDEX_WORKERS=1

# Aggressive (for fast NFS or local storage)
INDEX_WORKERS=16
```

**Why It Matters:**

- Too many workers → NFS server overwhelmed → ESTALE errors
- Too few workers → Slow indexing performance
- Default (3 workers) balances stability and performance

### Integration Points

The retry mechanism is integrated throughout the application:

| Component             | Usage                   | Purpose                                      |
| --------------------- | ----------------------- | -------------------------------------------- |
| `handlers/media.go`   | File serving, streaming | Prevent 404 errors on transient failures     |
| `media/thumbnail.go`  | Thumbnail generation    | Prevent generation failures on ESTALE        |
| `handlers/files.go`   | Directory listing       | Prevent empty listings on transient failures |
| `indexer/parallel.go` | Directory scanning      | Resilient indexing with configurable workers |

### Monitoring NFS Health

**Retry-Specific Metrics:**

- `media_viewer_filesystem_retry_attempts_total{operation="stat|open"}` - Count of retry attempts
- `media_viewer_filesystem_retry_success_total{operation="stat|open"}` - Successful recoveries from ESTALE
- `media_viewer_filesystem_retry_failures_total{operation="stat|open"}` - Failed retries after exhausting attempts
- `media_viewer_filesystem_estale_errors_total{operation="stat|open"}` - Total ESTALE errors encountered
- `media_viewer_filesystem_retry_duration_seconds{operation="stat|open"}` - Duration including retry delays

**General Filesystem Metrics:**

- `media_viewer_filesystem_operation_duration_seconds{directory,operation}` - Operation latency by directory
- `media_viewer_filesystem_operation_errors_total{directory,operation}` - Operation error counts
- `media_viewer_indexer_files_per_second` - Indexing throughput

**Log Messages:**

- INFO: `"NFS Stat succeeded on retry N for <path>"` - Recoverable error
- ERROR: `"NFS Stat failed after N retries for <path>"` - Persistent issue requiring investigation

**Example Alerts:**

```yaml
# Alert when retry failure rate is high
- alert: HighNFSRetryFailureRate
  expr: rate(media_viewer_filesystem_retry_failures_total[5m]) > 0.1
  annotations:
      summary: 'High rate of NFS retry failures'

# Alert when ESTALE errors are frequent
- alert: FrequentNFSStaleErrors
  expr: rate(media_viewer_filesystem_estale_errors_total[5m]) > 1
  annotations:
      summary: 'Frequent ESTALE errors indicating NFS issues'
```

### Best Practices

1. **Mount Options**: Use `hard,intr,async` for better performance and reliability
2. **Worker Tuning**: Start with default (3), adjust based on metrics
3. **Monitor Logs**: Watch for retry patterns indicating NFS issues
4. **NFS Server**: Ensure adequate resources (CPU, memory, network) on NFS server
5. **Network**: Use dedicated network for NFS traffic if possible

See also: [INDEX_WORKERS Environment Variable](../admin/environment-variables.md#index_workers) and [NFS Troubleshooting](../troubleshooting.md#nfs-stale-file-handle-errors)
