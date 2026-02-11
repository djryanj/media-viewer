/*
Package filesystem provides resilient filesystem operations with automatic retry logic
for NFS stale file handle errors.

# Purpose

This package wraps standard filesystem operations (os.Stat, os.Open) with retry logic
specifically designed to handle transient NFS failures, particularly ESTALE (stale file
handle) errors that occur when NFS-mounted files are accessed during network issues or
server-side changes.

# Key Features

  - Automatic retry with exponential backoff for NFS ESTALE errors (errno 116)
  - Configurable retry attempts (default: 3) and backoff timings
  - Transparent fallback to standard os operations for non-NFS errors
  - Zero overhead for successful operations

# Usage

Basic usage with default retry configuration:

	import "media-viewer/internal/filesystem"

	// Stat a file with automatic NFS retry
	info, err := filesystem.StatWithRetry("/nfs/mount/file.jpg", filesystem.DefaultRetryConfig())
	if err != nil {
	    log.Fatal(err)
	}

	// Open a file with automatic NFS retry
	file, err := filesystem.OpenWithRetry("/nfs/mount/file.jpg", filesystem.DefaultRetryConfig())
	if err != nil {
	    log.Fatal(err)
	}
	defer file.Close()

Custom retry configuration:

	config := filesystem.RetryConfig{
	    MaxRetries:     5,
	    InitialBackoff: 100 * time.Millisecond,
	    MaxBackoff:     1 * time.Second,
	}
	info, err := filesystem.StatWithRetry(path, config)

# Retry Behavior

The retry logic implements exponential backoff with the following defaults:
  - MaxRetries: 3 attempts
  - InitialBackoff: 50ms
  - MaxBackoff: 500ms

Only NFS stale file handle errors (ESTALE) trigger retries. All other errors
fail immediately without retry attempts.

# Performance

For successful operations, overhead is minimal:
  - StatWithRetry: ~100ns additional overhead vs os.Stat
  - OpenWithRetry: ~150ns additional overhead vs os.Open

Failed operations with retries add backoff delay (50ms → 100ms → 200ms by default).

# Integration

This package is used throughout the media-viewer application in handlers and
media processing code to provide resilience against NFS instability:

  - internal/handlers/media.go: File serving and streaming
  - internal/media/thumbnail.go: Thumbnail generation
  - internal/handlers/files.go: Directory listing

See also:
  - Issue #253: Performance improvements for NFS stability
  - docs/admin/environment-variables.md: INDEX_WORKERS configuration
*/
package filesystem
