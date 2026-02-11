// Package filesystem provides utilities for filesystem operations with retry logic for NFS
package filesystem

import (
	"errors"
	"os"
	"syscall"
	"time"

	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

// RetryConfig configures retry behavior for filesystem operations
type RetryConfig struct {
	MaxRetries     int
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
}

// DefaultRetryConfig returns sensible defaults for NFS retry behavior
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 50 * time.Millisecond,
		MaxBackoff:     500 * time.Millisecond,
	}
}

// isNFSStaleError checks if an error is an NFS stale file handle error
func isNFSStaleError(err error) bool {
	if err == nil {
		return false
	}

	// Check for ESTALE (stale file handle) - errno 116 on Linux
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return errno == syscall.ESTALE
	}

	return false
}

// StatWithRetry performs os.Stat with retry logic for NFS stale file handle errors
func StatWithRetry(path string, config RetryConfig) (os.FileInfo, error) {
	start := time.Now()
	var lastErr error
	backoff := config.InitialBackoff

	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		info, err := os.Stat(path)
		if err == nil {
			if attempt > 0 {
				logging.Info("NFS Stat succeeded on retry %d for %s", attempt, path)
				metrics.FilesystemRetrySuccess.WithLabelValues("stat").Inc()
			}
			metrics.FilesystemRetryDuration.WithLabelValues("stat").Observe(time.Since(start).Seconds())
			return info, nil
		}

		lastErr = err

		// Only retry on NFS stale file handle errors
		if !isNFSStaleError(err) {
			metrics.FilesystemRetryDuration.WithLabelValues("stat").Observe(time.Since(start).Seconds())
			return nil, err
		}

		// Record ESTALE error occurrence
		metrics.FilesystemStaleErrors.WithLabelValues("stat").Inc()

		// Don't sleep after the last attempt
		if attempt < config.MaxRetries {
			metrics.FilesystemRetryAttempts.WithLabelValues("stat").Inc()
			logging.Debug("NFS Stat stale file handle for %s, retrying in %v (attempt %d/%d)",
				path, backoff, attempt+1, config.MaxRetries)
			time.Sleep(backoff)

			// Exponential backoff with cap
			backoff *= 2
			if backoff > config.MaxBackoff {
				backoff = config.MaxBackoff
			}
		}
	}

	logging.Warn("NFS Stat failed after %d retries for %s: %v", config.MaxRetries, path, lastErr)
	metrics.FilesystemRetryFailures.WithLabelValues("stat").Inc()
	metrics.FilesystemRetryDuration.WithLabelValues("stat").Observe(time.Since(start).Seconds())
	return nil, lastErr
}

// OpenWithRetry performs os.Open with retry logic for NFS stale file handle errors
func OpenWithRetry(path string, config RetryConfig) (*os.File, error) {
	start := time.Now()
	var lastErr error
	backoff := config.InitialBackoff

	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		file, err := os.Open(path)
		if err == nil {
			if attempt > 0 {
				logging.Info("NFS Open succeeded on retry %d for %s", attempt, path)
				metrics.FilesystemRetrySuccess.WithLabelValues("open").Inc()
			}
			metrics.FilesystemRetryDuration.WithLabelValues("open").Observe(time.Since(start).Seconds())
			return file, nil
		}

		lastErr = err

		// Only retry on NFS stale file handle errors
		if !isNFSStaleError(err) {
			metrics.FilesystemRetryDuration.WithLabelValues("open").Observe(time.Since(start).Seconds())
			return nil, err
		}

		// Record ESTALE error occurrence
		metrics.FilesystemStaleErrors.WithLabelValues("open").Inc()

		// Don't sleep after the last attempt
		if attempt < config.MaxRetries {
			metrics.FilesystemRetryAttempts.WithLabelValues("open").Inc()
			logging.Debug("NFS Open stale file handle for %s, retrying in %v (attempt %d/%d)",
				path, backoff, attempt+1, config.MaxRetries)
			time.Sleep(backoff)

			// Exponential backoff with cap
			backoff *= 2
			if backoff > config.MaxBackoff {
				backoff = config.MaxBackoff
			}
		}
	}

	logging.Warn("NFS Open failed after %d retries for %s: %v", config.MaxRetries, path, lastErr)
	metrics.FilesystemRetryFailures.WithLabelValues("open").Inc()
	metrics.FilesystemRetryDuration.WithLabelValues("open").Observe(time.Since(start).Seconds())
	return nil, lastErr
}
