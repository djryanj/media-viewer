package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"media-viewer/internal/metrics"
)

// responseWriter wraps http.ResponseWriter to capture status code and first byte timing
type metricsResponseWriter struct {
	http.ResponseWriter
	statusCode      int
	headerWritten   bool
	firstByteTime   time.Time
	startTime       time.Time
	isStreamingPath bool
}

func newMetricsResponseWriter(w http.ResponseWriter, startTime time.Time, isStreaming bool) *metricsResponseWriter {
	return &metricsResponseWriter{
		ResponseWriter:  w,
		statusCode:      http.StatusOK,
		headerWritten:   false,
		startTime:       startTime,
		isStreamingPath: isStreaming,
	}
}

func (rw *metricsResponseWriter) WriteHeader(code int) {
	if !rw.headerWritten {
		rw.statusCode = code
		rw.headerWritten = true
		// Record first byte time for streaming endpoints
		if rw.isStreamingPath {
			rw.firstByteTime = time.Now()
		}
	}
	rw.ResponseWriter.WriteHeader(code)
}

// Write captures the first byte timing for streaming endpoints
func (rw *metricsResponseWriter) Write(b []byte) (int, error) {
	if !rw.headerWritten {
		// WriteHeader wasn't called explicitly, so we need to track first byte here
		rw.headerWritten = true
		if rw.isStreamingPath {
			rw.firstByteTime = time.Now()
		}
	}
	return rw.ResponseWriter.Write(b)
}

// GetDuration returns the appropriate duration based on whether this is a streaming endpoint
func (rw *metricsResponseWriter) GetDuration() time.Duration {
	if rw.isStreamingPath && !rw.firstByteTime.IsZero() {
		// For streaming endpoints, return time to first byte
		return rw.firstByteTime.Sub(rw.startTime)
	}
	// For non-streaming endpoints, return total duration
	return time.Since(rw.startTime)
}

// MetricsConfig holds configuration for the metrics middleware
type MetricsConfig struct {
	// SkipPaths are paths that should not be recorded
	SkipPaths []string
}

// DefaultMetricsConfig returns the default metrics configuration
func DefaultMetricsConfig() MetricsConfig {
	return MetricsConfig{
		SkipPaths: []string{"/metrics", "/health", "/healthz", "/livez", "/readyz"},
	}
}

// Metrics returns a middleware that records Prometheus metrics
func Metrics(config MetricsConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip metrics for certain paths
			for _, path := range config.SkipPaths {
				if strings.HasPrefix(r.URL.Path, path) {
					next.ServeHTTP(w, r)
					return
				}
			}

			// Track in-flight requests
			metrics.HTTPRequestsInFlight.Inc()
			defer metrics.HTTPRequestsInFlight.Dec()

			// Record start time
			start := time.Now()

			// Check if this is a streaming endpoint
			isStreaming := isStreamingPath(r.URL.Path)

			// Wrap response writer to capture status code and timing
			wrapped := newMetricsResponseWriter(w, start, isStreaming)

			// Process request
			next.ServeHTTP(wrapped, r)

			// Record metrics using appropriate duration
			duration := wrapped.GetDuration().Seconds()
			path := normalizePath(r.URL.Path)
			status := strconv.Itoa(wrapped.statusCode)

			metrics.HTTPRequestsTotal.WithLabelValues(r.Method, path, status).Inc()
			metrics.HTTPRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
		})
	}
}

// isStreamingPath determines if a path is a streaming endpoint
// For these endpoints, we measure time to first byte instead of total duration
func isStreamingPath(path string) bool {
	streamingPrefixes := []string{
		"/api/stream/",
	}

	for _, prefix := range streamingPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}

	return false
}

// normalizePath normalizes the path for metrics to avoid high cardinality
func normalizePath(path string) string {
	// Define prefixes that have wildcard path parameters
	// These routes capture arbitrary file paths and should be collapsed
	wildcardPrefixes := []string{
		"/api/file/",
		"/api/thumbnail/",
		"/api/stream/",
		"/api/stream-info/",
	}

	// Check if this path matches a known wildcard route
	for _, prefix := range wildcardPrefixes {
		if strings.HasPrefix(path, prefix) {
			// Return just the prefix (without trailing slash) + placeholder
			return strings.TrimSuffix(prefix, "/") + "/{path}"
		}
	}

	// For other paths, keep reasonable granularity but still protect against
	// unexpected high cardinality (e.g., query params leaking into path)
	parts := strings.Split(path, "/")

	// If path has more than 5 segments, truncate to prevent cardinality issues
	// This handles any routes we might have missed
	if len(parts) > 5 {
		return strings.Join(parts[:5], "/") + "/{path}"
	}

	return path
}
