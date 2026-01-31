# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

# Changelog

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
