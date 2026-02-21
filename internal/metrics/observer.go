package metrics

import "media-viewer/internal/filesystem"

// filesystemObserver implements filesystem.Observer using the Prometheus
// metrics declared in this package.
type filesystemObserver struct{}

// NewFilesystemObserver creates an observer that records filesystem metrics
// into the Prometheus counters and histograms declared in metrics.go.
func NewFilesystemObserver() filesystem.Observer {
	return &filesystemObserver{}
}

func (o *filesystemObserver) ObserveOperation(volume, operation string, durationSeconds float64, err error) {
	FilesystemOperationDuration.WithLabelValues(volume, operation).Observe(durationSeconds)
	if err != nil {
		FilesystemOperationErrors.WithLabelValues(volume, operation).Inc()
	}
}

func (o *filesystemObserver) ObserveRetryAttempt(retryOp, volume string) {
	FilesystemRetryAttempts.WithLabelValues(retryOp, volume).Inc()
}

func (o *filesystemObserver) ObserveRetrySuccess(retryOp, volume string) {
	FilesystemRetrySuccess.WithLabelValues(retryOp, volume).Inc()
}

func (o *filesystemObserver) ObserveRetryFailure(retryOp, volume string) {
	FilesystemRetryFailures.WithLabelValues(retryOp, volume).Inc()
}

func (o *filesystemObserver) ObserveRetryDuration(retryOp, volume string, durationSeconds float64) {
	FilesystemRetryDuration.WithLabelValues(retryOp, volume).Observe(durationSeconds)
}

func (o *filesystemObserver) ObserveStaleError(retryOp, volume string) {
	FilesystemStaleErrors.WithLabelValues(retryOp, volume).Inc()
}
