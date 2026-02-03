// Package main provides the entry point for the Media Viewer application.
//
// Media Viewer is a high-performance, self-hosted web application for browsing,
// organizing, and streaming media files. It provides thumbnail generation, full-text
// search, tagging, favorites, and video transcoding capabilities.
//
// # Application Lifecycle
//
// The application follows a structured initialization sequence:
//
//  1. Memory Configuration: Sets GOMEMLIMIT from environment or cgroup limits
//  2. Configuration Loading: Reads environment variables and validates directories
//  3. Database Initialization: Opens SQLite database with FTS5 full-text search
//  4. Component Initialization:
//     - Memory Monitor: Tracks system memory usage
//     - Transcoder: Sets up FFmpeg-based video transcoding (if enabled)
//     - Thumbnail Generator: Initializes libvips for memory-efficient image processing
//     - Indexer: Walks media directory and maintains file metadata
//     - Metrics Collector: Gathers Prometheus metrics
//     - WebAuthn: Configures passkey authentication (if enabled)
//  5. HTTP Server Setup: Configures routes, middleware, and starts server
//  6. Graceful Shutdown: Handles SIGINT/SIGTERM, stops all components cleanly
//
// # Background Services
//
// Several goroutines run throughout the application lifecycle:
//
//   - Indexer: Periodically scans media directory for changes
//   - Thumbnail Generator: Creates thumbnails for new/changed media files
//   - Metrics Collector: Updates Prometheus metrics every minute
//   - Session Cleanup: Removes expired authentication sessions
//   - WebAuthn Session Cleanup: Removes expired passkey sessions
//
// # Memory Management
//
// The application implements multi-tier memory management:
//
//   - Container-aware GOMEMLIMIT configuration (80% of cgroup limit)
//   - Memory monitor that tracks system memory pressure
//   - libvips integration for decode-time image shrinking
//   - Explicit GC calls after processing large images
//   - Worker count reduction under memory pressure
//
// # HTTP Server
//
// The application runs two HTTP servers:
//
//  1. Main Server (default port 8080):
//     - Static file serving
//     - API endpoints for media browsing, search, tags, favorites
//     - Authentication and session management
//     - WebAuthn/passkey endpoints
//     - Video streaming with transcoding
//     - Thumbnail serving with caching
//
//  2. Metrics Server (default port 9090, optional):
//     - Prometheus metrics endpoint (/metrics)
//     - Health check endpoint (/health)
//
// # Environment Variables
//
// Configuration is primarily through environment variables:
//
//   - MEDIA_DIR: Root directory containing media files (required)
//   - CACHE_DIR: Directory for thumbnails and transcoded videos
//   - DATABASE_DIR: Directory for SQLite database
//   - PORT: Main HTTP server port (default: 8080)
//   - METRICS_PORT: Metrics server port (default: 9090)
//   - METRICS_ENABLED: Enable metrics server (default: true)
//   - INDEX_INTERVAL: Media directory scan interval (default: 30m)
//   - THUMBNAIL_INTERVAL: Thumbnail generation interval (default: 6h)
//   - SESSION_DURATION: Authentication session duration (default: 5m)
//   - LOG_LEVEL: Logging level (debug/info/warn/error)
//   - WEBAUTHN_RP_ID: WebAuthn Relying Party ID (domain name)
//   - WEBAUTHN_RP_DISPLAY_NAME: Display name for passkeys
//   - WEBAUTHN_RP_ORIGINS: Allowed origins for WebAuthn
//   - GOMEMLIMIT: Memory limit (auto-detected from cgroups if not set)
//
// # Graceful Shutdown
//
// The application handles SIGINT and SIGTERM signals gracefully:
//
//  1. Stop accepting new HTTP requests
//  2. Stop metrics collector
//  3. Stop thumbnail generator (in-progress work completes)
//  4. Stop indexer (current batch commits)
//  5. Clean up transcoder cache
//  6. Stop memory monitor
//  7. Shutdown metrics server (if running)
//  8. Clean up WebAuthn sessions
//  9. Shutdown main HTTP server (30s timeout)
//  10. Close database connections
//
// All shutdown steps have timeouts to prevent hanging.
//
// # Build Requirements
//
// The application requires CGO for SQLite and libvips:
//
//   - SQLite: FTS5 full-text search support
//   - libvips: Memory-efficient image processing
//   - FFmpeg: Video thumbnail extraction and transcoding
//
// Build tags:
//
//	go build -tags 'fts5' -o media-viewer ./cmd/media-viewer
//
// # Docker Deployment
//
// Docker is the recommended deployment method as it includes all dependencies:
//
//   - Alpine Linux base with libvips, FFmpeg, SQLite
//   - Multi-architecture support (amd64, arm64)
//   - Unprivileged user (nobody:nobody)
//   - Health checks via /readyz endpoint
//   - Volume mounts for media, cache, and database
//
// # Performance Characteristics
//
// The application is designed for high performance:
//
//   - Parallel directory walking during indexing
//   - Concurrent thumbnail generation with worker pools
//   - Memory-efficient image processing with libvips
//   - HTTP caching with ETag support
//   - Progressive Web App with offline support
//   - Connection pooling for database access
//   - Prometheus metrics for observability
//
// # Related Packages
//
//   - [media-viewer/internal/database]: SQLite database with FTS5 search
//   - [media-viewer/internal/handlers]: HTTP request handlers
//   - [media-viewer/internal/indexer]: Media directory scanning
//   - [media-viewer/internal/media]: Thumbnail generation and libvips integration
//   - [media-viewer/internal/middleware]: HTTP middleware (auth, logging, metrics)
//   - [media-viewer/internal/startup]: Configuration and initialization
//   - [media-viewer/internal/transcoder]: FFmpeg video transcoding
//
// For more information, see https://github.com/djryanj/media-viewer
package main
