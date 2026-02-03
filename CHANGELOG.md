# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

# Changelog

## [0.7.0] - February 3, 2026

### Added

- **Comprehensive Prometheus Metrics** - Added 50+ metrics across 8 categories for deep observability
    - **Filesystem I/O Metrics**: Track latency by operation type (stat, readdir) and directory path
        - `media_viewer_filesystem_operation_duration_seconds{operation, directory}` - Histogram of filesystem operation latencies
        - `media_viewer_filesystem_operations_total{operation, directory}` - Counter of filesystem operations
    - **Thumbnail Generation Metrics**: Detailed performance tracking across all phases
        - `media_viewer_thumbnail_cache_read_latency_seconds` - Cache lookup performance
        - `media_viewer_thumbnail_memory_usage_bytes{type}` - Memory consumption during generation
        - `media_viewer_thumbnail_generation_duration_detailed_seconds{type, phase}` - Per-phase timing (decode, resize, encode, cache)
        - `media_viewer_thumbnail_ffmpeg_duration_seconds` - Video frame extraction time
        - `media_viewer_thumbnail_cache_hits_total` / `media_viewer_thumbnail_cache_misses_total` - Cache effectiveness
    - **Indexer Performance Metrics**: Track media library scanning efficiency
        - `media_viewer_indexer_run_duration_seconds` - Full index run time
        - `media_viewer_indexer_files_per_second` - Indexing throughput
        - `media_viewer_indexer_batch_processing_duration_seconds` - Database batch operation timing
        - `media_viewer_indexer_files_processed_total` / `media_viewer_indexer_files_added_total` / `media_viewer_indexer_files_updated_total` - File operation counters
    - **Database Transaction Metrics**: Monitor database performance
        - `media_viewer_db_transaction_duration_seconds{type}` - Transaction latency (commit, rollback)
        - `media_viewer_db_rows_affected{operation}` - Rows modified by operation (upsert_file, delete_files)
        - `media_viewer_db_size_bytes{file}` - Database file sizes (main, wal, shm)
    - **Memory Pressure Gauge**: Single indicator for Go memory health
        - `media_viewer_memory_pressure_ratio` - Ratio of allocated memory to GOMEMLIMIT (0.0-1.0)
    - **HTTP Request Metrics**: Fixed high-cardinality issue with path normalization
        - Paths like `/api/file/*`, `/api/thumbnail/*`, `/api/stream/*` now normalized to prevent metric explosion

- **Complete Metrics Documentation**
    - New [docs/admin/metrics.md](docs/admin/metrics.md) with comprehensive reference
    - All 50+ metrics documented with types, labels, descriptions, and units
    - PromQL query examples for common monitoring scenarios
    - Example alerting rules for production deployments
    - Performance tuning guidance for metric collection
    - Grafana dashboard structure with 7 organized sections

- **Admin Documentation Section**
    - New [docs/admin/overview.md](docs/admin/overview.md) as landing page for admin guides
    - Updated navigation in mkdocs.yml with dedicated Admin section
    - Cross-referenced metrics documentation from configuration guides

- GitHub action definition to automatically build and publish documentation changes to documentation site

### Changed

- **Database Schema - Separated Record Touch from Content Change** - Critical fix for indexer cleanup and thumbnail regeneration
    - Added `content_updated_at` field to track when file content actually changes
    - `updated_at` now always updated when indexer touches a file (for "last seen" cleanup logic)
    - `content_updated_at` only updated when file size, mod_time, type, or hash changes (for thumbnail invalidation)
    - Fixes catastrophic bug where indexer's cleanup deleted all files as "missing" because `updated_at` was preserved
    - Fixes thumbnail cache being invalidated on every index run even when no files changed
    - **Migration**: Schema automatically migrates on first startup; existing files get `content_updated_at` set from `updated_at`

- **Environment Variables Documentation** - Corrected [docs/admin/environment-variables.md](docs/admin/environment-variables.md)
    - Fixed variable names: `MEDIA_DIR` (not MEDIA_PATH), `CACHE_DIR` and `DATABASE_DIR` (separate, not DATA_PATH)
    - Corrected duration format examples: Go duration syntax (`24h`, `30m`, `10s`) instead of milliseconds
    - Added missing variables: `METRICS_PORT`, `METRICS_ENABLED`, `INDEX_INTERVAL`, `POLL_INTERVAL`, `THUMBNAIL_INTERVAL`
    - Added complete WebAuthn configuration section
    - Added memory management section: `MEMORY_LIMIT`, `MEMORY_RATIO`, `GOMEMLIMIT`
    - Added logging and debugging section: `LOG_LEVEL`, `LOG_STATIC_FILES`, `LOG_HEALTH_CHECKS`
    - Added Docker Compose and Kubernetes configuration examples

- **Documentation Cross-References** - Updated multiple documentation files
    - [docs/admin/server-config.md](docs/admin/server-config.md) - Added metrics configuration section
    - [docs/admin/thumbnails.md](docs/admin/thumbnails.md) - Added metrics monitoring section
    - [docs/troubleshooting.md](docs/troubleshooting.md) - Added metrics-based diagnostics
    - [docs/index.md](docs/index.md) - Added link to metrics documentation

- Updated reference Grafana dashboard [hack/grafana/dashboard.json](hack/grafana/dashboard.json) with above metrics
- Updated README.md to point to documentation for most things ([#110](https://github.com/djryanj/media-viewer/issues/110))

### Fixed

- **Critical: Indexer Deleted All Files on Every Run** - Fixed catastrophic regression
    - **Root cause**: Indexer cleanup logic deletes files WHERE `updated_at < index_start_time`
    - **Problem**: Previous fix preserved `updated_at` for unchanged files, causing them to be deleted as "missing"
    - **Solution**: Separated `updated_at` (always touched) from `content_updated_at` (only on changes)
    - **Impact**: Database is now properly maintained; files no longer disappear on every index run

- **Unnecessary Thumbnail Regeneration** - Files with unchanged modification times no longer trigger regeneration ([#117](https://github.com/djryanj/media-viewer/issues/117))
    - **Root cause**: `content_updated_at` was being set even when content hadn't changed
    - **Fix**: Use COALESCE to handle NULL values properly, only update timestamp when size/modtime/type/hash actually changes
    - **Benefit**: Thumbnails only regenerate when files actually change, not on every index run

- **Gosec Security Warning** - Fixed potential integer overflow in thumbnail memory tracking
    - Changed `int64(memAfter.Alloc - memBefore.Alloc)` to direct `float64()` conversion
    - Prevents gosec G115 warning about potential integer overflow

- **Database Permission Diagnostics** - Added comprehensive permission checking for SQLite WAL mode
    - Checks and logs database directory, main DB file, WAL file, and SHM file permissions
    - Automatically attempts to fix read-only WAL/SHM files from previous container runs
    - Helps diagnose "disk I/O error: read-only file system" errors in Kubernetes deployments
    - Critical for containers using `readOnlyRootFilesystem: true` with persistent volume mounts

- **Lightbox Hotzone Positioning** - Fixed mobile navigation hotzones to work correctly regardless of image size
    - Changed hotzones from `position: absolute` to `position: fixed` so they extend to screen edges even when images are narrower than viewport
    - Added vertical spacing (`top: 60px`, `bottom: 80px`) to prevent blocking close button and info bar
    - Hide hotzones on desktop (≥900px) where dedicated prev/next buttons are used
    - Added gradient masks for smooth fade-out at top and bottom edges of all hotzones
    - Enhanced video mode hotzones with additional vertical gradient masks for polished appearance near video controls

- WebAuthN cleanup doesn't try to happen if it's not enabled ([#120](https://github.com/djryanj/media-viewer/issues/120))
- Entering selection mode on mobile performance enhancements ([#79](https://github.com/djryanj/media-viewer/issues/79))

### Performance

- **Optimized Thumbnail Memory Usage with libvips** - Integrated libvips for true decode-time downsampling
    - **Root cause**: Standard image libraries load full original into memory before resizing
    - **Solution**: libvips provides decode-time shrinking - never loads full-size image into memory
    - **Implementation**:
        - Added govips library with conservative memory settings (50MB cache, single concurrent operation)
        - JPEG files now use vips decode-time shrinking when available
        - Fallback to two-stage resize if vips unavailable (Box filter → Lanczos)
        - Fallback to standard imaging library for non-JPEG or if vips fails
    - **Memory Impact**: For 6000x4000 JPEG (96MB full decode):
        - Standard method: Loads 96MB, resizes to 10MB = 106MB peak
        - libvips: Decodes directly to 10MB = 10MB peak (~90% reduction)
    - **Quality**: Maintains excellent quality using Lanczos resampling in vips
    - **Compatibility**: Gracefully degrades if libvips not available (dev environments)
    - **Benefit**: Dramatic memory reduction for large JPEGs, enables higher concurrency, reduces GC pressure

- **Instrumented Code Paths** - All major operations now emit detailed metrics
    - `internal/database/database.go` - Transaction duration, rows affected, storage size
    - `internal/indexer/indexer.go` - Run duration, throughput, batch timing, filesystem operations
    - `internal/media/thumbnail.go` - Cache latency, memory usage, phase-by-phase timing, FFmpeg duration
    - `internal/metrics/metrics.go` - Centralized metric definitions with optimized histogram buckets

- **Reduced Metrics Cardinality** - Fixed high-cardinality path metrics
    - File paths in `/api/file/*`, `/api/thumbnail/*`, `/api/stream/*` now normalized
    - Prevents Prometheus memory bloat from thousands of unique metric labels
    - Maintains useful metrics without per-file granularity

### Developer Notes

#### Monitoring Setup

The new metrics enable comprehensive observability. Key areas to monitor:

1. **Filesystem Performance** - Critical for NFS deployments

    ```promql
    histogram_quantile(0.95, rate(media_viewer_filesystem_operation_duration_seconds_bucket[5m]))
    ```

2. **Thumbnail Efficiency** - Cache hit rate and generation times

    ```promql
    rate(media_viewer_thumbnail_cache_hits_total[5m]) /
    (rate(media_viewer_thumbnail_cache_hits_total[5m]) + rate(media_viewer_thumbnail_cache_misses_total[5m]))
    ```

3. **Indexer Throughput** - Files processed per second

    ```promql
    media_viewer_indexer_files_per_second
    ```

4. **Memory Pressure** - Early warning for memory limits
    ```promql
    media_viewer_memory_pressure_ratio > 0.9
    ```

See [docs/admin/metrics.md](docs/admin/metrics.md) for complete monitoring guide with Grafana dashboard structure, alerting rules, and performance tuning recommendations.

## [v0.6.0] - February 2, 2026

### Added

- **Passkey (WebAuthn) Authentication**
    - Passwordless authentication using biometrics (Face ID, Touch ID, Windows Hello) or security keys (YubiKey, Titan)
    - Support for platform authenticators (built-in device biometrics) and roaming authenticators (USB keys)
    - Conditional UI support for passkey autofill in password fields (Chrome 108+, Edge 108+, Safari 16+)
    - Auto-prompt for passkey login on supported browsers when passkeys are registered
    - Multi-passkey support: register passkeys on multiple devices
    - Named passkeys for easy device identification (e.g., "MacBook Pro", "iPhone")
    - Passkeys management UI in Settings → Passkeys tab:
        - List all registered passkeys with creation and last used dates
        - Add new passkeys with custom naming via modal dialog
        - Delete passkeys with confirmation
    - Custom passkey naming modal with better UX than browser's default prompt
    - Fallback to password authentication always available
    - **Secure Context Requirement**: WebAuthn requires HTTPS (or `http://localhost` for development)

- **New Environment Variables for WebAuthn**
    - `WEBAUTHN_ENABLED` - Enable/disable passkey authentication (default: `false`)
    - `WEBAUTHN_RP_ID` - Relying Party ID (your domain, e.g., `example.com`)
    - `WEBAUTHN_RP_NAME` - Display name shown in authenticator prompts (default: `Media Viewer`)
    - `WEBAUTHN_ORIGINS` - Comma-separated list of allowed origins (e.g., `https://example.com,https://media.example.com`)

- **New API Endpoints**
    - `GET /api/auth/webauthn/available` - Check if passkey login is available (WebAuthn enabled + credentials registered)
    - `POST /api/auth/webauthn/register/begin` - Start passkey registration ceremony
    - `POST /api/auth/webauthn/register/finish` - Complete passkey registration
    - `POST /api/auth/webauthn/login/begin` - Start passkey authentication ceremony
    - `POST /api/auth/webauthn/login/finish` - Complete passkey authentication and create session
    - `GET /api/auth/webauthn/passkeys` - List all registered passkeys
    - `DELETE /api/auth/webauthn/passkeys` - Delete a passkey by ID

- **New Database Tables**
    - `webauthn_credentials` - Stores registered passkey credentials with metadata (name, sign count, transports, timestamps)
    - `webauthn_sessions` - Stores WebAuthn ceremony challenge data (5-minute TTL)

- **Development Testing Support**
    - Comprehensive documentation for testing WebAuthn with ngrok, Cloudflare Tunnel, or mkcert
    - ngrok recommended for easiest mobile device testing with real HTTPS
    - Instructions for secure context requirements and browser-specific behavior
    - Developer troubleshooting guide for common WebAuthn issues

### Changed

- **Login Page Enhancements**
    - Passkey section dynamically appears when passkeys are registered
    - Auto-prompts for passkey authentication on page load (browsers without Conditional UI)
    - Conditional UI integration shows passkeys in password field autofill (supported browsers)
    - "Sign in with Passkey" button with fingerprint icon
    - Improved error handling with user-friendly messages for cancellation, timeout, and missing passkeys
    - Passkey login aborts when user focuses password field (intentional password entry)
    - Loading states and disabled buttons during authentication

- **Settings Modal**
    - Added "Passkeys" tab for managing registered passkeys
    - Passkey list shows device names, creation dates, last used dates, and sign counts
    - Browser compatibility detection hides passkey section if WebAuthn not supported
    - Loading states while fetching passkey data
    - Empty state message when no passkeys registered

- **Frontend Architecture**
    - New `webauthn.js` module with `WebAuthnManager` class for all WebAuthn operations
    - Base64url encoding/decoding utilities for credential transport
    - Credential serialization for registration and authentication
    - Conditional UI support with automatic fallback to modal flow
    - Platform authenticator availability detection

### Fixed

- **Login Flow**
    - Passkey section only appears when passkeys are actually registered (not just WebAuthn enabled)
    - Prevents auto-prompt spam when no passkeys exist
    - Proper cleanup of Conditional UI when user cancels or fails authentication
- Added a time skew to allow for NFS clock differences to prevent thumbnail generator running every time ([#117](https://github.com/djryanj/media-viewer/issues/117))

### Security

- **WebAuthn Implementation**
    - User verification required for all passkeys (enforces biometric/PIN)
    - Resident keys preferred for discoverable credentials
    - Platform authenticators preferred over roaming for better UX
    - Attestation preference set to `none` (privacy-focused)
    - Exclusion lists prevent duplicate credential registration
    - Sign count tracking for credential cloning detection
    - Challenge data stored with 5-minute expiration
    - One-time use of challenge data (deleted after verification)

### Browser Support

| Browser      | Platform Auth | Security Keys | Conditional UI |
| ------------ | ------------- | ------------- | -------------- |
| Chrome 108+  | ✅            | ✅            | ✅             |
| Edge 108+    | ✅            | ✅            | ✅             |
| Safari 16+   | ✅            | ✅            | ✅             |
| Firefox 119+ | ✅            | ✅            | ❌             |

### Developer Notes

#### Testing WebAuthn in Development

WebAuthn requires a secure context. For development:

**Local Testing (Simplest):**

```bash
export WEBAUTHN_ENABLED=true
export WEBAUTHN_RP_ID=localhost
export WEBAUTHN_ORIGINS=http://localhost:8080
make dev
```

**Mobile Testing with ngrok (Recommended):**

```bash
# Terminal 1: Start dev server
make dev

# Terminal 2: Start ngrok
ngrok http 8080

# Configure WebAuthn with ngrok URL
export WEBAUTHN_ENABLED=true
export WEBAUTHN_RP_ID=abc123.ngrok-free.app
export WEBAUTHN_ORIGINS=https://abc123.ngrok-free.app
make dev
```

See README.md for complete testing guide including Cloudflare Tunnel and mkcert options.

#### Database Schema Changes

The WebAuthn feature adds two new tables. Database migrations are automatic on first startup when `WEBAUTHN_ENABLED=true`.

#### Go Dependencies

- `github.com/go-webauthn/webauthn` v0.11.2 - WebAuthn library for credential management and verification

## [0.5.0] - February 1, 2026

### Added

- Infinite scroll with paginated fallback in both main gallery and search views
- Session keepalive system to maintain active sessions during user activity
- Shorter server sessions by default (configurable with `SESSION_DURATION` environment variable) which ensures that media stays private without complex PWA and frontend changes ([#73](https://github.com/djryanj/media-viewer/issues/73), [#82](https://github.com/djryanj/media-viewer/issues/82))
- Escape key logs out from the main screen ([#73](https://github.com/djryanj/media-viewer/issues/73))
- Navigation improvements (back button)
- Tag copy/paste system for selection mode with clipboard support
    - Copy tags from single selected item (`Ctrl+C`)
    - Paste tags to selected items (`Ctrl+V`) with confirmation modal
    - Merge tags across multiple selected items (`Ctrl+M`)
- Smart paste destination handling excludes source item from targets

### Changed

- Colorblind accessibility improvements including a subtle change to the icon design (#100)
- Sort order button now uses distinct icons (`arrow-up-narrow-wide` / `arrow-down-wide-narrow`) for clearer visual feedback
- Gallery tag chips now use "X | tag" layout with remove button on left (desktop)
- Paste confirmation modal displays tags as selectable chips with Select All/None

### Fixed

- Sort order changes no longer pollute browser history ([#97](https://github.com/djryanj/media-viewer/issues/97))
- Sort order icon now correctly reflects current state ([#97](https://github.com/djryanj/media-viewer/issues/97))
- Prevented duplicate app initialization that caused redundant network requests
- Lightbox now correctly displays tag indicator by sourcing tags from gallery and preloading for adjacent items ([#106](https://github.com/djryanj/media-viewer/issues/106))
- Escape key now closes tag modal when input field is focused
- Tag overflow tooltip no longer triggers search when clicking +N indicator
- Fixed null reference error when refreshing tooltip after tag removal
- Fixed tag chip hover expansion caused by `transition: all`

### Deprecated

- Manual pagination (hidden, kept for fallback)

### Performance

- Intersection Observer vs scroll events
- Batched selection updates (single paint cycle)
- Priority loading for visible items on cache restore
- O(1) selection lookups via Set
- Eliminated duplicate initialization improving app responsiveness
- Lightbox preloads tags for adjacent items using batch endpoint

## [0.4.2] - January 31, 2026

- **NOTE**: Due to a significant performance degredation in 0.4.1 on NFS-mounted filesystems, do not use 0.4.2.

### Fixed

- Filesystem performance issues on NFS

## [0.4.1] - January 31, 2026

### Added

- **Media Loop Control** - Toggle looping for videos and animated images (GIF, WebP, APNG) in the lightbox viewer
    - Loop button appears automatically for supported media types
    - Keyboard shortcut: `L` to toggle loop
    - Preference saved and persists across sessions
    - Videos use native HTML5 loop attribute
    - Animated images use canvas-based detection to force continuous playback
- Polling-based change detection for media library updates (replaces fsnotify)
- Incremental thumbnail generation that only processes changed files
- Orphan thumbnail cleanup removes thumbnails for deleted files
- Meta file tracking (`.meta` sidecar files) for thumbnail source path lookup
- Legacy thumbnail cleanup for thumbnails without meta files
- Video frame support in folder thumbnail generation
- Indexer notifies thumbnail generator on completion for immediate processing

### Changed

- **Login Page UX Improvements**
    - Added show/hide password toggle (eye icon) for all password fields
    - Password text is now selected on login failure, allowing easy correction
    - Added shake animation on invalid password for visual feedback
    - Error messages auto-clear when user starts typing
    - Improved accessibility with proper ARIA labels
    - Better focus management after password visibility toggle
- Consolidated duplicate media type definitions into new `mediatypes` package
- Folder thumbnails now include video frames, not just images
- Thumbnail generator waits for initial index completion instead of fixed 30-second delay
- Replaced fsnotify-based file watching with polling-based change detection (better for containers)
- Change detection now polls every 30 seconds (configurable via `POLL_INTERVAL` environment variable)
- More reliable in Docker/container environments with mounted volumes

### Removed

- Removed fsnotify-based file watching (unreliable in containerized environments)
- Removed unused `media/scanner.go` (superseded by database-backed indexer)
- Removed unused `media/types.go` (consolidated into `mediatypes` package)
- Removed duplicate extension maps and file type detection from `indexer` package
- Removed scanner-related Prometheus metrics

### Fixed

- **Playlist View Hotzones** - previously, these were blocking the video controls in the playlist. ([#56](https://github.com/djryanj/media-viewer/issues/56))
- Folder thumbnails now update when contents change
- Orphaned thumbnails are properly cleaned up when source files are deleted
- Thumbnail generator now receives index completion events immediately on startup

## [v0.4.0] - January 31, 2026

### Added

- **We have an icon now!**

- **Progressive Web App (PWA) Support**
    - Web App Manifest (`manifest.json`) enabling "Add to Home Screen" functionality
    - Service Worker (`sw.js`) for PWA installability and offline caching of app shell
    - Standalone display mode removes browser UI when installed
    - `display_override` with `minimal-ui` fallback for Firefox Android
    - iOS Safari PWA meta tags for full-screen experience
    - Android adaptive icon support with maskable icons

- **Screen Wake Lock**
    - Screen stays awake during media viewing in lightbox
    - Screen stays awake during video playback in player
    - Automatically re-acquires lock when app regains focus
    - New `wake-lock.js` module for wake lock management

- **Safe Area Support**
    - CSS updates for devices with notches (iPhone X+, Android phones with cutouts)
    - Proper padding for status bars and home indicators
    - Improved landscape mode handling for fullscreen media viewing

- **App Icons**
    - New lock-themed icon representing private/secure media
    - Icons generated in all required sizes for PWA (16px to 512px)
    - Maskable icons for Android adaptive icon support
    - Simplified favicon optimized for small sizes
    - Developer tooling for icon generation (`static/generate-icons.js`)

### Changed

- Updated `index.html` with PWA meta tags, manifest link, and iOS-specific tags
- Updated `app.js` to register service worker and check PWA status
- Updated `lightbox.js` to acquire/release wake lock during media viewing
- Updated `player.js` to acquire/release wake lock during video playback
- Updated `style.css` with safe area insets, overscroll behavior, and PWA-specific styles

### Fixed

- Proper Content-Type headers for PWA assets (`application/manifest+json`, `application/javascript`)

### Developer Notes

#### Icon Generation

Icons are pre-generated and committed to the repository. Regeneration is only needed when modifying the icon design.

```bash
make icons
```

See README.md for detailed icon generation instructions.

## Version 0.3.1 - 2026-01-30

### New Features

#### Memory Management for Kubernetes

- **Automatic GOMEMLIMIT Configuration**: Added support for configuring Go's memory limit from Kubernetes container limits via the Downward API
    - Set `MEMORY_LIMIT` environment variable using `resourceFieldRef` to pass container memory limits
    - `MEMORY_RATIO` environment variable controls what percentage of container memory is allocated to Go heap (default: 85%)
    - Remaining memory is reserved for FFmpeg subprocesses, image processing, and OS buffers
    - Direct `GOMEMLIMIT` override supported for non-Kubernetes deployments

- **Memory Metrics**: Added Prometheus metrics for monitoring memory usage
    - `media_viewer_go_memlimit_bytes` - Configured GOMEMLIMIT value
    - `media_viewer_go_memalloc_bytes` - Current Go heap allocation
    - `media_viewer_go_memsys_bytes` - Total memory obtained from OS
    - `media_viewer_go_gc_runs_total` - Garbage collection cycle count

- **Startup Memory Reporting**: Memory configuration is now logged at startup, showing container limit, ratio, calculated GOMEMLIMIT, and memory reserved for external processes

#### New Environment Variables

| Variable       | Default | Description                                                    |
| -------------- | ------- | -------------------------------------------------------------- |
| `MEMORY_LIMIT` | (none)  | Container memory limit in bytes (from Kubernetes Downward API) |
| `MEMORY_RATIO` | `0.85`  | Percentage of container memory for Go heap (0.0-1.0)           |
| `GOMEMLIMIT`   | (none)  | Direct Go memory limit override (e.g., `400MiB`)               |

## Version 0.3.0 - 2026-01-30

### New Features

#### Enhanced Tag Management

- Tags are now clickable throughout the application to search for items with that tag
- Added tag overflow tooltip: clicking the "+n" indicator on items with many tags displays a popup showing all tags
- Tags can now be removed directly from gallery items on desktop by hovering and clicking the X button
- Added tag display in lightbox view with gradient overlay at the bottom of images
- Lightbox tags support both search (click tag) and removal (click X button) actions

#### Improved Navigation and State Management

- Search results now preserve previous state: closing search returns to the lightbox at the same position if one was open
- Gallery scroll position is now preserved when returning from search results
- Browser back button properly navigates through search, lightbox, and gallery states

#### Selection Mode Improvements

- "Select All" button now toggles between selecting all and deselecting all items
- Button text updates to indicate current action ("All" or "None")

#### New Metrics

- **Database Size Metrics**: Added Prometheus metrics to track SQLite database file sizes
    - `media_viewer_db_size_bytes{file="main"}` - Main database file size
    - `media_viewer_db_size_bytes{file="wal"}` - Write-ahead log file size
    - `media_viewer_db_size_bytes{file="shm"}` - Shared memory file size
- **Grafana Dashboard Updates**: Added new "Database Storage" section with:
    - Total database size stat panel with threshold alerts (yellow >100MB, red >500MB)
    - Individual panels for main DB and WAL file sizes
    - Storage distribution pie chart
    - Database size over time graph
    - Database growth rate trend analysis

### User Interface Improvements

#### Layout Consistency

- Header, breadcrumb, favorites, and footer sections now respect the same maximum width as the gallery content
- User control buttons (password, cache, logout) moved to the right side of the header on all screen sizes
- Consistent padding and spacing across all breakpoints

#### Mobile Improvements

- Tags in gallery items are now properly tappable for search on mobile devices
- Tag removal buttons hidden on mobile to prevent accidental taps; tags can still be managed via the tag modal
- Improved touch targets for tag interactions

#### Favorites Section

- Fixed favorites display on desktop to show compact thumbnails instead of full card layout
- Star icons now render correctly in favorites section

### Performance Improvements

#### Concurrency and Parallelism

- **Parallel Directory Indexing**: Added parallel directory walker with configurable worker pool for significantly faster initial indexing of large media libraries (2-4x improvement)
- **Parallel Thumbnail Generation**: Background thumbnail generation now uses a worker pool instead of sequential processing, dramatically improving throughput
- **Per-File Thumbnail Locking**: Replaced global thumbnail mutex with per-file locking, allowing parallel generation of thumbnails for different files
- **Container-Aware Worker Pools**: Worker counts automatically scale based on available CPU resources, respecting Kubernetes/container CPU limits via GOMAXPROCS
- **New `workers` Utility Package**: Centralized worker count calculation with task-specific helpers (`ForCPU`, `ForIO`, `ForMixed`) and environment variable override support

#### Streaming Improvements

- **Timeout-Protected Video Streaming**: Added chunked streaming with per-write timeouts to prevent slow/disconnected clients from holding server resources indefinitely
- **Idle Connection Detection**: Streams are automatically terminated if no data flows for a configurable period
- **Client Disconnect Handling**: Proper detection and cleanup when clients disconnect during video streaming

#### Metrics Improvements

- **Reduced Metrics Cardinality**: Fixed high-cardinality issue where individual file paths under `/api/file/`, `/api/thumbnail/`, `/api/stream/`, and `/api/stream-info/` were creating separate metric labels
    - Paths are now normalized to `/api/file/{path}`, `/api/thumbnail/{path}`, etc.
    - Prevents Prometheus memory bloat from thousands of unique metric labels

#### Other Performance Improvements

- Replaced universal CSS selector (`*`) with explicit element reset for improved rendering performance
- Optimized image preloading in lightbox with priority-based loading (adjacent images load with higher priority)

### Code Quality Improvements

#### Context Propagation

- Added proper `context.Context` propagation throughout the codebase for improved request cancellation and timeout handling
- All HTTP handlers now pass request context to database operations
- Database operations respect context cancellation, allowing long-running queries to be terminated when clients disconnect
- Background operations (indexing, thumbnail generation) use appropriate contexts that survive request completion

#### New Packages

- **`internal/streaming`**: Timeout-protected HTTP streaming utilities with configurable write timeouts, idle detection, and progress callbacks
- **`internal/workers`**: CPU-aware worker pool sizing utilities that respect container resource limits

#### Linting and Code Standards

- Fixed all `contextcheck` linter errors by properly propagating context through call chains
- Fixed `nilerr` warnings with appropriate error handling or explicit nolint directives
- Fixed `ifElseChain` warnings by converting to switch statements
- Fixed unused parameter warnings
- Fixed redefinition of built-in function warnings (renamed `max` parameter to `limit`)
- Added proper documentation comments to all exported variables and types
- Added `//nolint` directives with explanations for intentional patterns (e.g., MD5 for cache keys, background operations not using request context)

### Bug Fixes

- Fixed Escape key not closing search results when viewing full search gallery
- Fixed tag click events propagating to gallery item handlers, causing both search and lightbox to trigger
- Fixed inconsistent card heights in gallery when some items have tags and others do not
- Fixed mobile filename overlay being too prominent
- Resolved various linting errors related to undefined globals and unused variables

## [Unreleased] - 2026-01-30

### Changed

#### Authentication System

- **Simplified to password-only authentication**: Removed username requirement for single-user application
    - Login now requires only a password
    - Initial setup creates a password without username
    - Session management remains token-based with 7-day expiration

#### Database Schema

- Removed `username` column from `users` table
- Updated all authentication queries to work with single-user model
- **Breaking Change**: Existing databases must be deleted and recreated

#### API Changes

- `POST /api/auth/login` - Now accepts `{ "password": "..." }` instead of `{ "username": "...", "password": "..." }`
- `POST /api/auth/setup` - Now accepts `{ "password": "..." }` instead of `{ "username": "...", "password": "..." }`
- `GET /api/auth/check` - Response `username` field now returns empty string
- `PUT /api/auth/password` - **New endpoint** for changing password (requires current password verification)

#### User Interface

##### Header

- Removed username display from header
- Added password change button (🔑) alongside existing cache clear and logout buttons
- Added password change modal with current password verification

##### Mobile Gallery (Breaking Visual Change)

- Redesigned gallery layout for mobile devices:
    - Compact 3-column grid with 2px gaps (was larger cards with more spacing)
    - Square aspect ratio thumbnails using `object-fit: cover`
    - Filename and tags now appear in gradient overlay at bottom of thumbnail
    - File size hidden on mobile (visible on desktop only)
    - 4 columns at 480px+, 5 columns at 600px+
- Desktop (900px+) retains card-style layout with info below thumbnail

##### Search Suggestions

- Added thumbnail previews to search dropdown suggestions
- Thumbnails load lazily with fallback to icons on error
- Responsive thumbnail sizes: 40px mobile, 48px tablet, 56px desktop

#### Frontend Architecture

- Renamed global `App` object to `MediaApp` to avoid conflict with built-in globals
- Updated all JavaScript files to reference `MediaApp` instead of `App`
- Added proper ESLint global declarations

#### CLI Tool (`usermgmt`)

- Simplified to two commands:
    - `reset` - Reset the password
    - `status` - Check if password is configured
- Removed `create`, `list`, `delete` commands (not needed for single-user)

### Fixed

- Fixed redirect loop on login caused by missing HTML element IDs
- Fixed element ID mismatches between HTML and JavaScript:
    - `search-close` → `search-results-close`
    - `ctx-favorite` → `ctx-add-favorite`
    - `ctx-unfavorite` → `ctx-remove-favorite`
    - `tag-modal-file` → `tag-modal-path`
    - `tag-add-btn` → `add-tag-btn`
    - `player-title` → `playlist-title`
    - `player-video` → `playlist-video`
    - `player-prev` → `prev-video`
    - `player-next` → `next-video`
- Added missing `history.js` script include

### Removed

- Username field from login and setup forms
- Username display in application header
- `GetUserByUsername()` database function
- `DeleteUser()` database function
- `DeleteUserSessions()` database function (replaced with `DeleteAllSessions()`)
- `ValidateUser()` database function (replaced with `ValidatePassword()`)

### Security

- Password changes require verification of current password
- All sessions invalidated when password is changed
- Maintained secure session token hashing (SHA-256)
- Maintained bcrypt password hashing

---

## Migration Guide

### For Existing Installations

1. **Backup any important data** (favorites, tags) if needed

2. **Delete the existing database**:

    ```bash
    rm /database/media.db
    ```

3. **Update all application files** (Go backend, JavaScript frontend, HTML, CSS)

4. **Rebuild the Go application**:

    ```bash
    go build -o media-viewer .
    go build -o resetpw ./cmd/resetpw
    ```

5. **Restart the application**

6. **Complete initial setup** by creating a new password when prompted

### API Migration

If you have external integrations calling the authentication API:

**Before:**

```json
POST /api/auth/login
{
  "username": "admin",
  "password": "secret123"
}
```

**After:**

```json
POST /api/auth/login
{
  "password": "secret123"
}
```

### Password Management

To reset a forgotten password using the CLI tool:

```bash
./resetpw reset
```

To check if a password is configured:

```bash
./resetpw status
```

## [Unreleased]

### Added

- Initial media browsing with folder navigation
- Thumbnail generation for images and videos
- Video transcoding for browser compatibility
- Full-text search with FTS5
- Tag management system
- Favorites system
- User authentication with sessions
- Docker container support
- Automatic media library indexing
- Real-time file system watching
- Playlist support (WPL format)
- Responsive web interface

### Security

- Secure password hashing with bcrypt
- Session-based authentication
- Path validation to prevent directory traversal

## How to Release

1. Update this CHANGELOG with the new version and date
2. Create a git tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
3. Push the tag: `git push origin v1.0.0`
4. GitHub Actions will automatically build and publish Docker images

[Unreleased]: https://github.com/djryanj/media-viewer/compare/v1.0.0...HEAD
