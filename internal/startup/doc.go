// Package startup handles application initialization, configuration loading,
// and startup/shutdown logging.
//
// This package centralizes all application configuration and provides consistent
// logging throughout the application lifecycle.
//
// # Configuration
//
// All configuration is loaded from environment variables via [LoadConfig].
// The following environment variables are supported:
//
//   - MEDIA_DIR: Path to media directory (default: /media)
//   - CACHE_DIR: Path to cache directory for thumbnails and transcodes (default: /cache)
//   - DATABASE_DIR: Path to database directory (default: /database)
//   - PORT: HTTP server port (default: 8080)
//   - METRICS_PORT: Prometheus metrics server port (default: 9090)
//   - METRICS_ENABLED: Enable or disable metrics server (default: true)
//   - INDEX_INTERVAL: Full re-index interval as Go duration (default: 30m)
//   - POLL_INTERVAL: Filesystem change detection interval as Go duration (default: 30s)
//   - THUMBNAIL_INTERVAL: Periodic thumbnail generation interval as Go duration (default: 6h)
//   - LOG_LEVEL: Logging level - debug, info, warn, error (default: info)
//   - LOG_STATIC_FILES: Log static file requests (default: false)
//   - LOG_HEALTH_CHECKS: Log health check requests (default: true)
//   - MEMORY_LIMIT: Container memory limit for automatic GOMEMLIMIT configuration
//   - MEMORY_RATIO: Percentage of MEMORY_LIMIT for Go heap (default: 0.85)
//   - GOMEMLIMIT: Direct override for Go's memory limit
//
// # Directory Setup
//
// The package validates and creates required directories:
//   - Database directory: Required, must be writable
//   - Cache directory: Optional, enables thumbnails and transcoding if writable
//   - Media directory: Checked but not created (should be mounted)
//
// # Build Information
//
// Build-time variables are injected via ldflags and exposed via [GetBuildInfo]:
//   - Version: Application version
//   - Commit: Git commit hash
//   - BuildTime: Build timestamp
//   - GoVersion: Go compiler version
//
// # Lifecycle Logging
//
// The package provides structured logging functions for consistent output:
//   - [LogDatabaseInit]: Database initialization timing
//   - [LogTranscoderInit]: Transcoder setup and FFmpeg availability
//   - [LogThumbnailInit]: Thumbnail generator configuration
//   - [LogIndexerInit]: Indexer configuration and intervals
//   - [LogHTTPRoutes]: Registered HTTP routes (debug level)
//   - [LogServerStarted]: Server endpoints and startup duration
//   - [LogShutdownInitiated]: Graceful shutdown start
//   - [LogShutdownComplete]: Shutdown completion
//   - [LogMemoryConfig]: Memory limit configuration
//
// # Example Usage
//
//	config, err := startup.LoadConfig()
//	if err != nil {
//	    startup.LogFatal("Configuration error: %v", err)
//	}
//
//	// Initialize components...
//	startup.LogDatabaseInit(dbInitDuration)
//	startup.LogIndexerInit(config.IndexInterval, config.PollInterval)
//
//	// Start server...
//	startup.LogServerStarted(startup.ServerConfig{
//	    Port:            config.Port,
//	    MetricsPort:     config.MetricsPort,
//	    MetricsEnabled:  config.MetricsEnabled,
//	    StartupDuration: time.Since(startTime),
//	})
//
//	// On shutdown...
//	startup.LogShutdownInitiated("SIGTERM")
//	// ... cleanup ...
//	startup.LogShutdownComplete()
package startup
