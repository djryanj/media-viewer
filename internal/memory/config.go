package memory

import (
	"math"
	"os"
	"runtime/debug"
	"strconv"

	"media-viewer/internal/logging"
)

const (
	// DefaultMemoryRatio is the percentage of container memory to use for Go heap
	// Reserve the rest for FFmpeg, image processing, goroutine stacks, etc.
	DefaultMemoryRatio = 0.85
)

// ConfigResult holds the result of memory configuration
type ConfigResult struct {
	// Configured indicates whether GOMEMLIMIT was set
	Configured bool

	// Source indicates where the configuration came from
	Source string // "GOMEMLIMIT", "MEMORY_LIMIT", or "none"

	// ContainerLimit is the container memory limit in bytes (0 if not set)
	ContainerLimit int64

	// GoMemLimit is the configured GOMEMLIMIT in bytes (0 if not set)
	GoMemLimit int64

	// Ratio is the memory ratio used (0 if not applicable)
	Ratio float64
}

// ConfigureFromEnv sets GOMEMLIMIT based on Kubernetes memory limit
// Call this early in main() before significant allocations
//
// Environment variables:
//   - GOMEMLIMIT: If set, this takes precedence (standard Go env var)
//   - MEMORY_LIMIT: Container memory limit in bytes (from Kubernetes Downward API)
//   - MEMORY_RATIO: Optional ratio of memory to use for Go heap (default: 0.85)
func ConfigureFromEnv() ConfigResult {
	result := ConfigResult{}

	// Check if GOMEMLIMIT is already set explicitly
	if goMemLimitEnv := os.Getenv("GOMEMLIMIT"); goMemLimitEnv != "" {
		// Parse the value to report it
		if limit := debug.SetMemoryLimit(-1); limit > 0 && limit < math.MaxInt64 {
			result.Configured = true
			result.Source = "GOMEMLIMIT"
			result.GoMemLimit = limit
		}
		logging.Info("GOMEMLIMIT set via environment: %s", goMemLimitEnv)
		return result
	}

	// Check for Kubernetes memory limit passed via Downward API
	memLimitStr := os.Getenv("MEMORY_LIMIT")
	if memLimitStr == "" {
		logging.Debug("MEMORY_LIMIT not set, GOMEMLIMIT will not be configured automatically")
		result.Source = "none"
		return result
	}

	memLimit, err := strconv.ParseInt(memLimitStr, 10, 64)
	if err != nil {
		logging.Warn("Failed to parse MEMORY_LIMIT %q: %v", memLimitStr, err)
		result.Source = "none"
		return result
	}

	result.ContainerLimit = memLimit

	// Allow customizing the ratio via environment variable
	ratio := DefaultMemoryRatio
	if ratioStr := os.Getenv("MEMORY_RATIO"); ratioStr != "" {
		if parsedRatio, err := strconv.ParseFloat(ratioStr, 64); err == nil {
			if parsedRatio > 0 && parsedRatio <= 1.0 {
				ratio = parsedRatio
			} else {
				logging.Warn("MEMORY_RATIO %q out of range (0.0-1.0), using default %.2f", ratioStr, DefaultMemoryRatio)
			}
		} else {
			logging.Warn("Failed to parse MEMORY_RATIO %q: %v, using default %.2f", ratioStr, err, DefaultMemoryRatio)
		}
	}

	result.Ratio = ratio

	// Calculate Go memory limit
	goMemLimit := int64(float64(memLimit) * ratio)

	// Set the limit
	debug.SetMemoryLimit(goMemLimit)

	result.Configured = true
	result.Source = "MEMORY_LIMIT"
	result.GoMemLimit = goMemLimit

	logging.Info("Configured GOMEMLIMIT: %s (%.1f%% of %s container limit)",
		formatBytes(goMemLimit),
		ratio*100,
		formatBytes(memLimit),
	)

	return result
}

// formatBytes formats bytes into human-readable string
func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return strconv.FormatInt(b, 10) + " B"
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return strconv.FormatFloat(float64(b)/float64(div), 'f', 1, 64) + " " + string("KMGTPE"[exp]) + "iB"
}
