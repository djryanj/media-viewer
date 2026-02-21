// Package filesystem provides utilities for filesystem operations with retry logic for NFS
package filesystem

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

// VolumeResolver maps file paths to known volume names for metric labeling.
// It uses longest-prefix matching on absolute paths.
type VolumeResolver struct {
	// mounts is sorted by path length descending for longest-prefix matching
	mounts []volumeMount
}

type volumeMount struct {
	path string // absolute path with trailing slash (e.g., "/media/")
	name string // volume label (e.g., "media")
}

// NewVolumeResolver creates a resolver from a map of volume name → absolute path.
// Example:
//
//	NewVolumeResolver(map[string]string{
//	    "media":    "/media",
//	    "cache":    "/cache",
//	    "database": "/database",
//	})
func NewVolumeResolver(volumes map[string]string) *VolumeResolver {
	mounts := make([]volumeMount, 0, len(volumes))
	for name, path := range volumes {
		// Normalize: ensure absolute path with trailing slash for prefix matching
		absPath, err := filepath.Abs(path)
		if err != nil {
			absPath = path
		}
		if !strings.HasSuffix(absPath, "/") {
			absPath += "/"
		}
		mounts = append(mounts, volumeMount{path: absPath, name: name})
	}

	// Sort by path length descending so longest (most specific) prefix matches first
	sort.Slice(mounts, func(i, j int) bool {
		return len(mounts[i].path) > len(mounts[j].path)
	})

	return &VolumeResolver{mounts: mounts}
}

// Resolve returns the volume name for a given file path.
// Returns "unknown" if the path doesn't match any configured volume.
func (vr *VolumeResolver) Resolve(path string) string {
	if vr == nil {
		return "unknown"
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return "unknown"
	}

	// Ensure trailing slash for directory-level comparison,
	// but also match the path itself (for exact directory matches)
	for _, mount := range vr.mounts {
		if strings.HasPrefix(absPath+"/", mount.path) || strings.HasPrefix(absPath, mount.path) {
			return mount.name
		}
	}

	return "unknown"
}

// defaultResolver is the package-level resolver set at startup
var defaultResolver *VolumeResolver

// SetDefaultVolumeResolver sets the package-level volume resolver.
// Call this once at startup after loading configuration.
func SetDefaultVolumeResolver(vr *VolumeResolver) {
	defaultResolver = vr
}

// RetryConfig configures retry behavior for filesystem operations
type RetryConfig struct {
	MaxRetries     int
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
	// VolumeResolver overrides the package-level resolver for this operation.
	// If nil, the package-level default is used.
	VolumeResolver *VolumeResolver
}

// DefaultRetryConfig returns sensible defaults for NFS retry behavior
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 50 * time.Millisecond,
		MaxBackoff:     500 * time.Millisecond,
	}
}

// resolveVolume returns the volume label for a path using the config's resolver
// or the package-level default.
func (c *RetryConfig) resolveVolume(path string) string {
	if c.VolumeResolver != nil {
		return c.VolumeResolver.Resolve(path)
	}
	return defaultResolver.Resolve(path)
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
	volume := config.resolveVolume(path)
	var lastErr error
	backoff := config.InitialBackoff

	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		info, err := os.Stat(path)
		if err == nil {
			if attempt > 0 {
				logging.Info("NFS Stat succeeded on retry %d for %s", attempt, path)
				metrics.FilesystemRetrySuccess.WithLabelValues("stat", volume).Inc()
			}
			metrics.FilesystemRetryDuration.WithLabelValues("stat", volume).Observe(time.Since(start).Seconds())
			return info, nil
		}

		lastErr = err

		// Only retry on NFS stale file handle errors
		if !isNFSStaleError(err) {
			metrics.FilesystemRetryDuration.WithLabelValues("stat", volume).Observe(time.Since(start).Seconds())
			return nil, err
		}

		// Record ESTALE error occurrence
		metrics.FilesystemStaleErrors.WithLabelValues("stat", volume).Inc()

		// Don't sleep after the last attempt
		if attempt < config.MaxRetries {
			metrics.FilesystemRetryAttempts.WithLabelValues("stat", volume).Inc()
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
	metrics.FilesystemRetryFailures.WithLabelValues("stat", volume).Inc()
	metrics.FilesystemRetryDuration.WithLabelValues("stat", volume).Observe(time.Since(start).Seconds())
	return nil, lastErr
}

// OpenWithRetry performs os.Open with retry logic for NFS stale file handle errors
func OpenWithRetry(path string, config RetryConfig) (*os.File, error) {
	start := time.Now()
	volume := config.resolveVolume(path)
	var lastErr error
	backoff := config.InitialBackoff

	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		file, err := os.Open(path)
		if err == nil {
			if attempt > 0 {
				logging.Info("NFS Open succeeded on retry %d for %s", attempt, path)
				metrics.FilesystemRetrySuccess.WithLabelValues("open", volume).Inc()
			}
			metrics.FilesystemRetryDuration.WithLabelValues("open", volume).Observe(time.Since(start).Seconds())
			return file, nil
		}

		lastErr = err

		// Only retry on NFS stale file handle errors
		if !isNFSStaleError(err) {
			metrics.FilesystemRetryDuration.WithLabelValues("open", volume).Observe(time.Since(start).Seconds())
			return nil, err
		}

		// Record ESTALE error occurrence
		metrics.FilesystemStaleErrors.WithLabelValues("open", volume).Inc()

		// Don't sleep after the last attempt
		if attempt < config.MaxRetries {
			metrics.FilesystemRetryAttempts.WithLabelValues("open", volume).Inc()
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
	metrics.FilesystemRetryFailures.WithLabelValues("open", volume).Inc()
	metrics.FilesystemRetryDuration.WithLabelValues("open", volume).Observe(time.Since(start).Seconds())
	return nil, lastErr
}
