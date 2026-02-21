package filesystem

// Observer records filesystem operation metrics. Implementations are provided
// by the metrics package to break the import cycle between filesystem and metrics.
type Observer interface {
	// ObserveOperation records duration and error status for a filesystem operation.
	// volume is the resolved mount point label (e.g., "media", "cache", "database").
	// operation is the fs operation type: "stat", "read", "write", "readdir".
	ObserveOperation(volume, operation string, durationSeconds float64, err error)

	// ObserveRetry records retry-specific metrics for NFS resilience.
	// retryOp is the retry operation: "stat", "open", "readdir", "write".
	ObserveRetryAttempt(retryOp, volume string)
	ObserveRetrySuccess(retryOp, volume string)
	ObserveRetryFailure(retryOp, volume string)
	ObserveRetryDuration(retryOp, volume string, durationSeconds float64)
	ObserveStaleError(retryOp, volume string)
}

// defaultObserver is the package-level observer set at startup.
// If nil, metric recording is silently skipped (safe for tests).
var defaultObserver Observer

// SetObserver sets the package-level metrics observer.
// Call this once at startup after creating the observer implementation.
func SetObserver(o Observer) {
	defaultObserver = o
}

// observe is a nil-safe helper for the package-level observer.
func observe() Observer {
	return defaultObserver
}
