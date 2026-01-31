package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"media-viewer/internal/metrics"
)

// responseWriter wraps http.ResponseWriter to capture status code
type metricsResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func newMetricsResponseWriter(w http.ResponseWriter) *metricsResponseWriter {
	return &metricsResponseWriter{w, http.StatusOK}
}

func (rw *metricsResponseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
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

			// Wrap response writer to capture status code
			wrapped := newMetricsResponseWriter(w)

			// Record start time
			start := time.Now()

			// Process request
			next.ServeHTTP(wrapped, r)

			// Record metrics
			duration := time.Since(start).Seconds()
			path := normalizePath(r.URL.Path)
			status := strconv.Itoa(wrapped.statusCode)

			metrics.HTTPRequestsTotal.WithLabelValues(r.Method, path, status).Inc()
			metrics.HTTPRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
		})
	}
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
