package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

// CompressionConfig holds configuration for the compression middleware
type CompressionConfig struct {
	// MinSize is the minimum response size in bytes before compression is applied
	MinSize int
	// Level is the gzip compression level (gzip.BestSpeed to gzip.BestCompression)
	Level int
	// CompressibleTypes is a list of content types that should be compressed
	CompressibleTypes []string
}

// DefaultCompressionConfig returns sensible defaults for compression
func DefaultCompressionConfig() CompressionConfig {
	return CompressionConfig{
		MinSize: 1024, // 1KB minimum
		Level:   gzip.DefaultCompression,
		CompressibleTypes: []string{
			"text/html",
			"text/css",
			"text/plain",
			"text/javascript",
			"text/xml",
			"application/json",
			"application/javascript",
			"application/xml",
			"application/xhtml+xml",
			"application/rss+xml",
			"application/atom+xml",
			"image/svg+xml",
		},
	}
}

// gzipWriterPool reduces allocations by reusing gzip writers
var gzipWriterPool = sync.Pool{
	New: func() interface{} {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.DefaultCompression)
		return w
	},
}

// gzipResponseWriter wraps http.ResponseWriter to provide gzip compression
type gzipResponseWriter struct {
	http.ResponseWriter
	gzipWriter     *gzip.Writer
	config         CompressionConfig
	buffer         []byte
	statusCode     int
	headerWritten  bool
	shouldCompress bool
	wroteBody      bool
}

// newGzipResponseWriter creates a new gzip response writer
func newGzipResponseWriter(w http.ResponseWriter, config CompressionConfig) *gzipResponseWriter {
	return &gzipResponseWriter{
		ResponseWriter: w,
		config:         config,
		statusCode:     http.StatusOK,
		buffer:         make([]byte, 0, config.MinSize+1),
	}
}

// WriteHeader captures the status code
func (g *gzipResponseWriter) WriteHeader(statusCode int) {
	if g.headerWritten {
		return
	}
	g.statusCode = statusCode
}

// Write buffers data until we know if we should compress
func (g *gzipResponseWriter) Write(data []byte) (int, error) {
	if g.wroteBody && g.headerWritten {
		// Already decided and writing
		if g.shouldCompress && g.gzipWriter != nil {
			return g.gzipWriter.Write(data)
		}
		return g.ResponseWriter.Write(data)
	}

	// Buffer the data
	g.buffer = append(g.buffer, data...)

	// Check if we have enough data to decide
	if len(g.buffer) > g.config.MinSize {
		g.finalize()
	}

	return len(data), nil
}

// shouldCompressContentType checks if the content type should be compressed
func (g *gzipResponseWriter) shouldCompressContentType() bool {
	contentType := g.Header().Get("Content-Type")
	if contentType == "" {
		return false
	}

	// Extract the media type (ignore charset and other parameters)
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))

	for _, compressible := range g.config.CompressibleTypes {
		if mediaType == compressible {
			return true
		}
	}

	return false
}

// finalize decides whether to compress and writes the buffered data
func (g *gzipResponseWriter) finalize() {
	if g.headerWritten {
		return
	}

	g.headerWritten = true
	g.wroteBody = true

	// Decide if we should compress
	g.shouldCompress = len(g.buffer) >= g.config.MinSize && g.shouldCompressContentType()

	if g.shouldCompress {
		// Remove Content-Length as it will change
		g.Header().Del("Content-Length")
		// Set compression headers
		g.Header().Set("Content-Encoding", "gzip")
		g.Header().Add("Vary", "Accept-Encoding")

		// Get a gzip writer from the pool
		g.gzipWriter = gzipWriterPool.Get().(*gzip.Writer)
		g.gzipWriter.Reset(g.ResponseWriter)

		// Write the status code
		g.ResponseWriter.WriteHeader(g.statusCode)

		// Write buffered data
		g.gzipWriter.Write(g.buffer)
	} else {
		// Write without compression
		g.ResponseWriter.WriteHeader(g.statusCode)
		g.ResponseWriter.Write(g.buffer)
	}

	// Clear buffer to free memory
	g.buffer = nil
}

// Close finalizes the response and returns the gzip writer to the pool
func (g *gzipResponseWriter) Close() error {
	// If we haven't written yet, finalize now
	if !g.headerWritten {
		g.finalize()
	}

	// Close the gzip writer and return it to the pool
	if g.gzipWriter != nil {
		err := g.gzipWriter.Close()
		gzipWriterPool.Put(g.gzipWriter)
		g.gzipWriter = nil
		return err
	}

	return nil
}

// Flush implements http.Flusher
func (g *gzipResponseWriter) Flush() {
	// Finalize if we haven't yet
	if !g.headerWritten {
		g.finalize()
	}

	// Flush the gzip writer
	if g.gzipWriter != nil {
		g.gzipWriter.Flush()
	}

	// Flush the underlying response writer if it supports it
	if flusher, ok := g.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Push implements http.Pusher for HTTP/2 support
func (g *gzipResponseWriter) Push(target string, opts *http.PushOptions) error {
	if pusher, ok := g.ResponseWriter.(http.Pusher); ok {
		return pusher.Push(target, opts)
	}
	return http.ErrNotSupported
}

// Compression returns a middleware that compresses responses using gzip
func Compression(config CompressionConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check if client accepts gzip encoding
			if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
				next.ServeHTTP(w, r)
				return
			}

			// Skip compression for WebSocket upgrades
			if r.Header.Get("Upgrade") != "" {
				next.ServeHTTP(w, r)
				return
			}

			// Skip compression for Server-Sent Events
			if r.Header.Get("Accept") == "text/event-stream" {
				next.ServeHTTP(w, r)
				return
			}

			// Create gzip response writer
			gzw := newGzipResponseWriter(w, config)
			defer gzw.Close()

			// Call the next handler
			next.ServeHTTP(gzw, r)
		})
	}
}
