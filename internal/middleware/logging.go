package middleware

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ResponseWriter wrapper to capture status code and bytes written
type responseWriter struct {
	http.ResponseWriter
	statusCode   int
	bytesWritten int64
	wroteHeader  bool
}

func newResponseWriter(w http.ResponseWriter) *responseWriter {
	return &responseWriter{
		ResponseWriter: w,
		statusCode:     http.StatusOK,
	}
}

func (rw *responseWriter) WriteHeader(code int) {
	if !rw.wroteHeader {
		rw.statusCode = code
		rw.wroteHeader = true
		rw.ResponseWriter.WriteHeader(code)
	}
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.wroteHeader {
		rw.wroteHeader = true
	}
	n, err := rw.ResponseWriter.Write(b)
	rw.bytesWritten += int64(n)
	return n, err
}

func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// LoggingConfig holds configuration for the logging middleware
type LoggingConfig struct {
	SkipPaths      []string
	SkipExtensions []string
	LogStaticFiles bool
}

// DefaultLoggingConfig returns a sensible default configuration
func DefaultLoggingConfig() LoggingConfig {
	return LoggingConfig{
		SkipPaths:      []string{},
		SkipExtensions: []string{".css", ".js", ".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2", ".ttf"},
		LogStaticFiles: false,
	}
}

// W3CLogger handles W3C Extended Log Format logging
type W3CLogger struct {
	config      LoggingConfig
	headerOnce  sync.Once
	serviceName string
}

// NewW3CLogger creates a new W3C format logger
func NewW3CLogger(config LoggingConfig, serviceName string) *W3CLogger {
	return &W3CLogger{
		config:      config,
		serviceName: serviceName,
	}
}

// writeHeader writes the W3C log file header directives
func (l *W3CLogger) writeHeader() {
	// W3C Extended Log File Format header
	fmt.Fprintf(os.Stdout, "#Version: 1.0\n")
	fmt.Fprintf(os.Stdout, "#Software: %s\n", l.serviceName)
	fmt.Fprintf(os.Stdout, "#Start-Date: %s\n", time.Now().UTC().Format("2006-01-02 15:04:05"))
	fmt.Fprintf(os.Stdout, "#Fields: date time c-ip cs-method cs-uri-stem cs-uri-query sc-status sc-bytes time-taken cs(User-Agent) cs(Referer)\n")
}

// Logger returns HTTP logging middleware using W3C Extended Log Format
func Logger(config LoggingConfig) func(http.Handler) http.Handler {
	logger := NewW3CLogger(config, "MediaViewer/1.0")

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if shouldSkip(r.URL.Path, config) {
				next.ServeHTTP(w, r)
				return
			}

			// Write header on first request
			logger.headerOnce.Do(logger.writeHeader)

			start := time.Now()
			wrapped := newResponseWriter(w)

			next.ServeHTTP(wrapped, r)

			duration := time.Since(start)
			logger.logRequest(r, wrapped, duration)
		})
	}
}

// logRequest logs a request in W3C Extended Log Format
func (l *W3CLogger) logRequest(r *http.Request, rw *responseWriter, duration time.Duration) {
	now := time.Now().UTC()

	// Extract fields
	clientIP := getClientIP(r)
	method := r.Method
	uriStem := r.URL.Path
	uriQuery := r.URL.RawQuery
	if uriQuery == "" {
		uriQuery = "-"
	}
	status := rw.statusCode
	bytesWritten := rw.bytesWritten
	timeTaken := duration.Milliseconds() // W3C uses milliseconds

	userAgent := r.Header.Get("User-Agent")
	if userAgent == "" {
		userAgent = "-"
	} else {
		// Escape quotes and replace spaces for W3C format
		userAgent = escapeW3CField(userAgent)
	}

	referer := r.Header.Get("Referer")
	if referer == "" {
		referer = "-"
	}

	// W3C Extended Log Format
	// date time c-ip cs-method cs-uri-stem cs-uri-query sc-status sc-bytes time-taken cs(User-Agent) cs(Referer)
	logLine := fmt.Sprintf("%s %s %s %s %s %s %d %d %d %s %s",
		now.Format("2006-01-02"),
		now.Format("15:04:05"),
		clientIP,
		method,
		uriStem,
		uriQuery,
		status,
		bytesWritten,
		timeTaken,
		userAgent,
		referer,
	)

	// Use standard log to include timestamp prefix if configured, or raw output
	log.Println(logLine)
}

func shouldSkip(path string, config LoggingConfig) bool {
	for _, skipPath := range config.SkipPaths {
		if strings.HasPrefix(path, skipPath) {
			return true
		}
	}

	if !config.LogStaticFiles {
		for _, ext := range config.SkipExtensions {
			if strings.HasSuffix(strings.ToLower(path), ext) {
				return true
			}
		}
	}

	return false
}

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if idx := strings.Index(xff, ","); idx != -1 {
			return strings.TrimSpace(xff[:idx])
		}
		return strings.TrimSpace(xff)
	}

	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	ip := r.RemoteAddr
	if idx := strings.LastIndex(ip, ":"); idx != -1 {
		ip = ip[:idx]
	}
	return ip
}

// escapeW3CField escapes a field value for W3C log format
// Replaces spaces with + and quotes with escaped quotes
func escapeW3CField(s string) string {
	// If contains space or special chars, quote it
	if strings.ContainsAny(s, " \t\"") {
		s = strings.ReplaceAll(s, "\"", "\"\"")
		return "\"" + s + "\""
	}
	return s
}
