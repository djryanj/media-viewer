package workers

import (
	"os"
	"runtime"
	"strconv"
)

// Count returns the optimal number of workers for a given task type.
// It respects container CPU limits via GOMAXPROCS (Go 1.19+).
//
// The multiplier adjusts for task characteristics:
//   - 1.0 for CPU-bound tasks
//   - 2.0 for I/O-bound tasks
//   - 1.5 for mixed tasks
//
// The limit parameter caps the worker count to prevent resource exhaustion.
// Use 0 for no limit.
//
// Can be overridden with THUMBNAIL_WORKERS environment variable.
func Count(multiplier float64, limit int) int {
	// Check for manual override first
	if override := os.Getenv("THUMBNAIL_WORKERS"); override != "" {
		if count, err := strconv.Atoi(override); err == nil && count > 0 {
			if limit > 0 && count > limit {
				return limit
			}
			return count
		}
	}

	// GOMAXPROCS is automatically set to container CPU limit in Go 1.19+
	available := runtime.GOMAXPROCS(0)

	workers := int(float64(available) * multiplier)

	if workers < 1 {
		workers = 1
	}
	if limit > 0 && workers > limit {
		workers = limit
	}

	return workers
}

// ForCPU returns worker count for CPU-bound tasks (1 per CPU).
// The limit parameter caps the maximum number of workers.
func ForCPU(limit int) int {
	return Count(1.0, limit)
}

// ForIO returns worker count for I/O-bound tasks (2 per CPU).
// The limit parameter caps the maximum number of workers.
func ForIO(limit int) int {
	return Count(2.0, limit)
}

// ForMixed returns worker count for mixed tasks (1.5 per CPU).
// The limit parameter caps the maximum number of workers.
func ForMixed(limit int) int {
	return Count(1.5, limit)
}
