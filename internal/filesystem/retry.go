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
		absPath, err := filepath.Abs(path)
		if err != nil {
			absPath = path
		}
		if !strings.HasSuffix(absPath, "/") {
			absPath += "/"
		}
		mounts = append(mounts, volumeMount{path: absPath, name: name})
	}

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

	for _, mount := range vr.mounts {
		if strings.HasPrefix(absPath+"/", mount.path) || strings.HasPrefix(absPath, mount.path) {
			return mount.name
		}
	}

	return "unknown"
}

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

	var errno syscall.Errno
	if errors.As(err, &errno) {
		return errno == syscall.ESTALE
	}

	return false
}

// recordMetrics is a nil-safe helper that records both the general filesystem
// operation metrics and the retry-specific duration metric.
func recordMetrics(volume, fsOp, retryOp string, duration time.Duration, err error) {
	if o := observe(); o != nil {
		o.ObserveOperation(volume, fsOp, duration.Seconds(), err)
		o.ObserveRetryDuration(retryOp, volume, duration.Seconds())
	}
}

func retryOperation[T any](retryOp, fsOp, path string, config RetryConfig, op func() (T, error)) (T, error) {
	start := time.Now()
	volume := config.resolveVolume(path)
	var lastErr error
	var zero T
	backoff := config.InitialBackoff

	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		result, err := op()
		if err == nil {
			if attempt > 0 {
				logging.Info("NFS %s succeeded on retry %d for %s", retryOp, attempt, path)
				if o := observe(); o != nil {
					o.ObserveRetrySuccess(retryOp, volume)
				}
			}
			recordMetrics(volume, fsOp, retryOp, time.Since(start), nil)
			return result, nil
		}

		lastErr = err

		if !isNFSStaleError(err) {
			recordMetrics(volume, fsOp, retryOp, time.Since(start), err)
			return zero, err
		}

		if o := observe(); o != nil {
			o.ObserveStaleError(retryOp, volume)
		}

		if attempt < config.MaxRetries {
			if o := observe(); o != nil {
				o.ObserveRetryAttempt(retryOp, volume)
			}
			logging.Debug("NFS %s stale file handle for %s, retrying in %v (attempt %d/%d)",
				retryOp, path, backoff, attempt+1, config.MaxRetries)
			time.Sleep(backoff)

			backoff *= 2
			if backoff > config.MaxBackoff {
				backoff = config.MaxBackoff
			}
		}
	}

	logging.Warn("NFS %s failed after %d retries for %s: %v", retryOp, config.MaxRetries, path, lastErr)
	if o := observe(); o != nil {
		o.ObserveRetryFailure(retryOp, volume)
	}
	recordMetrics(volume, fsOp, retryOp, time.Since(start), lastErr)
	return zero, lastErr
}

// StatWithRetry performs os.Stat with retry logic for NFS stale file handle errors
func StatWithRetry(path string, config RetryConfig) (os.FileInfo, error) {
	return retryOperation[os.FileInfo]("stat", "stat", path, config, func() (os.FileInfo, error) {
		return os.Stat(path)
	})
}

// OpenWithRetry performs os.Open with retry logic for NFS stale file handle errors
func OpenWithRetry(path string, config RetryConfig) (*os.File, error) {
	return retryOperation[*os.File]("open", "read", path, config, func() (*os.File, error) {
		return os.Open(path)
	})
}

// ReadDirWithRetry performs os.ReadDir with retry logic for NFS stale file handle errors.
// Directory listing on NFS is equally susceptible to ESTALE errors.
func ReadDirWithRetry(path string, config RetryConfig) ([]os.DirEntry, error) {
	return retryOperation[[]os.DirEntry]("readdir", "readdir", path, config, func() ([]os.DirEntry, error) {
		return os.ReadDir(path)
	})
}

// WriteFileWithRetry performs os.WriteFile with retry logic for NFS stale file handle errors.
func WriteFileWithRetry(path string, data []byte, perm os.FileMode, config RetryConfig) error {
	// Wrap to match the generic signature — value is unused for writes
	_, err := retryOperation[struct{}]("write", "write", path, config, func() (struct{}, error) {
		return struct{}{}, os.WriteFile(path, data, perm)
	})
	return err
}
