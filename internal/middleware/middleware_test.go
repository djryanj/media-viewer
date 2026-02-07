package middleware

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewResponseWriter(t *testing.T) {
	w := httptest.NewRecorder()
	rw := newResponseWriter(w)

	if rw == nil {
		t.Fatal("Expected responseWriter to be created")
	}

	if rw.statusCode != http.StatusOK {
		t.Errorf("Expected default status code 200, got %d", rw.statusCode)
	}

	if rw.bytesWritten != 0 {
		t.Errorf("Expected bytesWritten to be 0, got %d", rw.bytesWritten)
	}

	if rw.wroteHeader {
		t.Error("Expected wroteHeader to be false initially")
	}
}

func TestResponseWriterWriteHeader(t *testing.T) {
	w := httptest.NewRecorder()
	rw := newResponseWriter(w)

	rw.WriteHeader(http.StatusNotFound)

	if rw.statusCode != http.StatusNotFound {
		t.Errorf("Expected status code 404, got %d", rw.statusCode)
	}

	if !rw.wroteHeader {
		t.Error("Expected wroteHeader to be true after WriteHeader")
	}

	// Write header again - should be ignored
	rw.WriteHeader(http.StatusInternalServerError)

	if rw.statusCode != http.StatusNotFound {
		t.Error("Status code should not change after first WriteHeader")
	}
}

func TestResponseWriterWrite(t *testing.T) {
	w := httptest.NewRecorder()
	rw := newResponseWriter(w)

	data := []byte("test data")
	n, err := rw.Write(data)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if n != len(data) {
		t.Errorf("Expected to write %d bytes, wrote %d", len(data), n)
	}

	if rw.bytesWritten != int64(len(data)) {
		t.Errorf("Expected bytesWritten to be %d, got %d", len(data), rw.bytesWritten)
	}

	if !rw.wroteHeader {
		t.Error("Expected wroteHeader to be true after Write")
	}
}

func TestDefaultLoggingConfig(t *testing.T) {
	config := DefaultLoggingConfig()

	if len(config.SkipPaths) != 0 {
		t.Errorf("Expected empty SkipPaths, got %d items", len(config.SkipPaths))
	}

	if len(config.SkipExtensions) == 0 {
		t.Error("Expected SkipExtensions to have default values")
	}

	// Check for common extensions
	expectedExts := []string{".css", ".js", ".ico", ".png", ".jpg"}
	for _, ext := range expectedExts {
		found := false
		for _, skip := range config.SkipExtensions {
			if skip == ext {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected extension %s in SkipExtensions", ext)
		}
	}

	if config.LogStaticFiles {
		t.Error("Expected LogStaticFiles to be false by default")
	}

	if !config.LogHealthChecks {
		t.Error("Expected LogHealthChecks to be true by default")
	}
}

func TestLoggerMiddleware(t *testing.T) {
	tests := []struct {
		name          string
		path          string
		config        LoggingConfig
		expectLogging bool
	}{
		{
			name:          "Logs regular requests",
			path:          "/api/files",
			config:        DefaultLoggingConfig(),
			expectLogging: true,
		},
		{
			name:          "Skips static files when configured",
			path:          "/styles.css",
			config:        LoggingConfig{LogStaticFiles: false, SkipExtensions: []string{".css"}},
			expectLogging: false,
		},
		{
			name:          "Logs health checks when enabled",
			path:          "/health",
			config:        LoggingConfig{LogHealthChecks: true},
			expectLogging: true,
		},
		{
			name:          "Skips health checks when disabled",
			path:          "/health",
			config:        LoggingConfig{LogHealthChecks: false},
			expectLogging: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("ok"))
			})

			middleware := Logger(tt.config)
			wrappedHandler := middleware(handler)

			req := httptest.NewRequest("GET", tt.path, http.NoBody)
			w := httptest.NewRecorder()

			wrappedHandler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status 200, got %d", w.Code)
			}
		})
	}
}

func TestDefaultCompressionConfig(t *testing.T) {
	config := DefaultCompressionConfig()

	if config.MinSize != 1024 {
		t.Errorf("Expected MinSize to be 1024, got %d", config.MinSize)
	}

	if config.Level != gzip.DefaultCompression {
		t.Errorf("Expected Level to be DefaultCompression (%d), got %d", gzip.DefaultCompression, config.Level)
	}

	if len(config.CompressibleTypes) == 0 {
		t.Error("Expected CompressibleTypes to have default values")
	}

	// Check for common compressible types
	expectedTypes := []string{
		"text/html",
		"text/css",
		"text/javascript",
		"application/json",
	}

	for _, expected := range expectedTypes {
		found := false
		for _, ct := range config.CompressibleTypes {
			if ct == expected {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected %s in CompressibleTypes", expected)
		}
	}
}

func TestCompressionMiddleware(t *testing.T) {
	tests := []struct {
		name              string
		responseBody      string
		contentType       string
		acceptEncoding    string
		expectCompression bool
		minSize           int
	}{
		{
			name:              "Compresses large HTML",
			responseBody:      strings.Repeat("Hello, World! ", 200), // ~2.6KB
			contentType:       "text/html",
			acceptEncoding:    "gzip",
			expectCompression: true,
			minSize:           1024,
		},
		{
			name:              "Doesn't compress small responses",
			responseBody:      "Small",
			contentType:       "text/html",
			acceptEncoding:    "gzip",
			expectCompression: false,
			minSize:           1024,
		},
		{
			name:              "Doesn't compress images",
			responseBody:      strings.Repeat("data", 500),
			contentType:       "image/jpeg",
			acceptEncoding:    "gzip",
			expectCompression: false,
			minSize:           1024,
		},
		{
			name:              "Compresses JSON",
			responseBody:      strings.Repeat(`{"key":"value"}`, 200),
			contentType:       "application/json",
			acceptEncoding:    "gzip",
			expectCompression: true,
			minSize:           1024,
		},
		{
			name:              "Respects client without gzip support",
			responseBody:      strings.Repeat("data", 500),
			contentType:       "text/html",
			acceptEncoding:    "",
			expectCompression: false,
			minSize:           1024,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", tt.contentType)
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(tt.responseBody))
			})

			config := CompressionConfig{
				MinSize:           tt.minSize,
				Level:             gzip.DefaultCompression,
				CompressibleTypes: DefaultCompressionConfig().CompressibleTypes,
			}

			middleware := Compression(config)
			wrappedHandler := middleware(handler)

			req := httptest.NewRequest("GET", "/test", http.NoBody)
			if tt.acceptEncoding != "" {
				req.Header.Set("Accept-Encoding", tt.acceptEncoding)
			}
			w := httptest.NewRecorder()

			wrappedHandler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status 200, got %d", w.Code)
			}

			isCompressed := w.Header().Get("Content-Encoding") == "gzip"
			if isCompressed != tt.expectCompression {
				t.Errorf("Expected compression=%v, got compression=%v", tt.expectCompression, isCompressed)
			}

			if tt.expectCompression {
				// Verify we can decompress
				gr, err := gzip.NewReader(w.Body)
				if err != nil {
					t.Fatalf("Failed to create gzip reader: %v", err)
				}
				defer gr.Close()

				decompressed, err := io.ReadAll(gr)
				if err != nil {
					t.Fatalf("Failed to decompress: %v", err)
				}

				if string(decompressed) != tt.responseBody {
					t.Error("Decompressed content doesn't match original")
				}
			}
		})
	}
}

func TestGzipResponseWriterBuffering(t *testing.T) {
	w := httptest.NewRecorder()
	config := DefaultCompressionConfig()
	grw := newGzipResponseWriter(w, config)

	// Write small amount of data (less than MinSize)
	smallData := []byte("small")
	n, err := grw.Write(smallData)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if n != len(smallData) {
		t.Errorf("Expected to write %d bytes, wrote %d", len(smallData), n)
	}

	// Data should be buffered
	if len(grw.buffer) != len(smallData) {
		t.Errorf("Expected buffer length %d, got %d", len(smallData), len(grw.buffer))
	}

	if !bytes.Equal(grw.buffer, smallData) {
		t.Error("Buffer content doesn't match written data")
	}
}

func TestCompressionWithMultipleWrites(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)

		// Multiple small writes that together exceed MinSize
		for i := 0; i < 50; i++ {
			w.Write([]byte(strings.Repeat("Hello, World! ", 10)))
		}
	})

	config := DefaultCompressionConfig()
	middleware := Compression(config)
	wrappedHandler := middleware(handler)

	req := httptest.NewRequest("GET", "/test", http.NoBody)
	req.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()

	wrappedHandler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Should be compressed since total exceeds MinSize
	if w.Header().Get("Content-Encoding") != "gzip" {
		t.Error("Expected response to be compressed")
	}
}

func BenchmarkLoggingMiddleware(b *testing.B) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	config := DefaultLoggingConfig()
	middleware := Logger(config)
	wrappedHandler := middleware(handler)

	req := httptest.NewRequest("GET", "/api/test", http.NoBody)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		wrappedHandler.ServeHTTP(w, req)
	}
}

func BenchmarkCompressionMiddleware(b *testing.B) {
	responseBody := strings.Repeat("Hello, World! ", 200)

	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(responseBody))
	})

	config := DefaultCompressionConfig()
	middleware := Compression(config)
	wrappedHandler := middleware(handler)

	req := httptest.NewRequest("GET", "/test", http.NoBody)
	req.Header.Set("Accept-Encoding", "gzip")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		wrappedHandler.ServeHTTP(w, req)
	}
}

// =============================================================================
// Metrics Middleware Tests
// =============================================================================

func TestNewMetricsResponseWriter(t *testing.T) {
	w := httptest.NewRecorder()
	startTime := time.Now()
	mrw := newMetricsResponseWriter(w, startTime, false)

	if mrw == nil {
		t.Fatal("Expected metricsResponseWriter to be created")
	}

	if mrw.statusCode != http.StatusOK {
		t.Errorf("Expected default status code 200, got %d", mrw.statusCode)
	}

	if mrw.headerWritten {
		t.Error("Expected headerWritten to be false initially")
	}

	if mrw.isStreamingPath {
		t.Error("Expected isStreamingPath to be false for non-streaming")
	}

	// Test streaming version
	mrwStreaming := newMetricsResponseWriter(w, startTime, true)
	if !mrwStreaming.isStreamingPath {
		t.Error("Expected isStreamingPath to be true for streaming")
	}
}

func TestMetricsResponseWriterWriteHeader(t *testing.T) {
	t.Run("non-streaming", func(t *testing.T) {
		w := httptest.NewRecorder()
		startTime := time.Now()
		mrw := newMetricsResponseWriter(w, startTime, false)

		mrw.WriteHeader(http.StatusCreated)

		if mrw.statusCode != http.StatusCreated {
			t.Errorf("Expected status code 201, got %d", mrw.statusCode)
		}

		if !mrw.headerWritten {
			t.Error("Expected headerWritten to be true after WriteHeader")
		}

		if !mrw.firstByteTime.IsZero() {
			t.Error("Expected firstByteTime to be zero for non-streaming")
		}

		// Verify the underlying ResponseWriter also got the header
		if w.Code != http.StatusCreated {
			t.Errorf("Expected underlying writer to have status 201, got %d", w.Code)
		}
	})

	t.Run("streaming", func(t *testing.T) {
		w := httptest.NewRecorder()
		startTime := time.Now()
		time.Sleep(1 * time.Millisecond) // Small delay to ensure measurable time difference
		mrw := newMetricsResponseWriter(w, startTime, true)

		mrw.WriteHeader(http.StatusOK)

		if mrw.statusCode != http.StatusOK {
			t.Errorf("Expected status code 200, got %d", mrw.statusCode)
		}

		if !mrw.headerWritten {
			t.Error("Expected headerWritten to be true after WriteHeader")
		}

		if mrw.firstByteTime.IsZero() {
			t.Error("Expected firstByteTime to be set for streaming endpoint")
		}

		if mrw.firstByteTime.Before(startTime) {
			t.Error("firstByteTime should be after startTime")
		}

		// Verify the underlying ResponseWriter also got the header
		if w.Code != http.StatusOK {
			t.Errorf("Expected underlying writer to have status 200, got %d", w.Code)
		}
	})
}

func TestMetricsResponseWriterWrite(t *testing.T) {
	t.Run("non-streaming with implicit header", func(t *testing.T) {
		w := httptest.NewRecorder()
		startTime := time.Now()
		mrw := newMetricsResponseWriter(w, startTime, false)

		data := []byte("test data")
		n, err := mrw.Write(data)

		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		if n != len(data) {
			t.Errorf("Expected to write %d bytes, wrote %d", len(data), n)
		}

		if !mrw.headerWritten {
			t.Error("Expected headerWritten to be true after Write")
		}

		if !mrw.firstByteTime.IsZero() {
			t.Error("Expected firstByteTime to be zero for non-streaming")
		}
	})

	t.Run("streaming with implicit header", func(t *testing.T) {
		w := httptest.NewRecorder()
		startTime := time.Now()
		time.Sleep(1 * time.Millisecond)
		mrw := newMetricsResponseWriter(w, startTime, true)

		data := []byte("streaming data")
		n, err := mrw.Write(data)

		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		if n != len(data) {
			t.Errorf("Expected to write %d bytes, wrote %d", len(data), n)
		}

		if !mrw.headerWritten {
			t.Error("Expected headerWritten to be true after Write")
		}

		if mrw.firstByteTime.IsZero() {
			t.Error("Expected firstByteTime to be set for streaming endpoint")
		}

		if mrw.firstByteTime.Before(startTime) {
			t.Error("firstByteTime should be after startTime")
		}
	})

	t.Run("streaming with explicit header followed by write", func(t *testing.T) {
		w := httptest.NewRecorder()
		startTime := time.Now()
		time.Sleep(1 * time.Millisecond)
		mrw := newMetricsResponseWriter(w, startTime, true)

		mrw.WriteHeader(http.StatusOK)
		firstByteTimeFromHeader := mrw.firstByteTime

		time.Sleep(1 * time.Millisecond)

		data := []byte("streaming data")
		_, err := mrw.Write(data)

		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		// firstByteTime should not change after initial WriteHeader
		if mrw.firstByteTime != firstByteTimeFromHeader {
			t.Error("firstByteTime should not change after initial WriteHeader")
		}
	})
}

func TestMetricsResponseWriterGetDuration(t *testing.T) {
	t.Run("non-streaming returns total duration", func(t *testing.T) {
		w := httptest.NewRecorder()
		startTime := time.Now()
		mrw := newMetricsResponseWriter(w, startTime, false)

		time.Sleep(5 * time.Millisecond)
		mrw.WriteHeader(http.StatusOK)

		time.Sleep(5 * time.Millisecond)
		duration := mrw.GetDuration()

		// Total duration should be at least 10ms
		if duration < 10*time.Millisecond {
			t.Errorf("Expected duration >= 10ms, got %v", duration)
		}
	})

	t.Run("streaming returns time to first byte", func(t *testing.T) {
		w := httptest.NewRecorder()
		startTime := time.Now()
		mrw := newMetricsResponseWriter(w, startTime, true)

		time.Sleep(5 * time.Millisecond)
		mrw.WriteHeader(http.StatusOK)

		time.Sleep(5 * time.Millisecond)
		duration := mrw.GetDuration()

		// TTFB should be around 5ms, definitely less than 8ms
		if duration >= 8*time.Millisecond {
			t.Errorf("Expected TTFB < 8ms, got %v (should measure time to first byte, not total duration)", duration)
		}

		if duration < 3*time.Millisecond {
			t.Errorf("Expected TTFB >= 3ms, got %v", duration)
		}
	})

	t.Run("streaming with Write instead of WriteHeader", func(t *testing.T) {
		w := httptest.NewRecorder()
		startTime := time.Now()
		mrw := newMetricsResponseWriter(w, startTime, true)

		time.Sleep(5 * time.Millisecond)
		mrw.Write([]byte("data"))

		time.Sleep(5 * time.Millisecond)
		duration := mrw.GetDuration()

		// TTFB should be around 5ms, definitely less than 8ms
		if duration >= 8*time.Millisecond {
			t.Errorf("Expected TTFB < 8ms, got %v", duration)
		}

		if duration < 3*time.Millisecond {
			t.Errorf("Expected TTFB >= 3ms, got %v", duration)
		}
	})
}

func TestIsStreamingPath(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected bool
	}{
		{"Stream endpoint", "/api/stream/video.mp4", true},
		{"Stream with nested path", "/api/stream/folder/subfolder/video.mp4", true},
		{"Stream root", "/api/stream/", true},
		{"File endpoint", "/api/file/video.mp4", false},
		{"Thumbnail endpoint", "/api/thumbnail/image.jpg", false},
		{"API root", "/api/", false},
		{"Root path", "/", false},
		{"Stream-info endpoint", "/api/stream-info/video.mp4", false},
		{"Similar but not stream", "/api/streaming/test", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isStreamingPath(tt.path)
			if result != tt.expected {
				t.Errorf("isStreamingPath(%q) = %v, want %v", tt.path, result, tt.expected)
			}
		})
	}
}

func TestDefaultMetricsConfig(t *testing.T) {
	config := DefaultMetricsConfig()

	if len(config.SkipPaths) == 0 {
		t.Error("Expected SkipPaths to have default values")
	}

	// Check for common paths that should be skipped
	expectedPaths := []string{"/metrics", "/health", "/healthz", "/livez", "/readyz"}
	for _, path := range expectedPaths {
		found := false
		for _, skip := range config.SkipPaths {
			if skip == path {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected %q to be in default SkipPaths", path)
		}
	}
}

func TestMetricsMiddlewareSkipPaths(t *testing.T) {
	handlerCalled := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	config := MetricsConfig{
		SkipPaths: []string{"/metrics", "/health"},
	}
	middleware := Metrics(config)
	wrappedHandler := middleware(handler)

	tests := []struct {
		name         string
		path         string
		shouldRecord bool
	}{
		{
			name:         "Skip /metrics",
			path:         "/metrics",
			shouldRecord: false,
		},
		{
			name:         "Skip /health",
			path:         "/health",
			shouldRecord: false,
		},
		{
			name:         "Record /api/files",
			path:         "/api/files",
			shouldRecord: true,
		},
		{
			name:         "Record /",
			path:         "/",
			shouldRecord: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handlerCalled = false
			req := httptest.NewRequest(http.MethodGet, tt.path, http.NoBody)
			w := httptest.NewRecorder()

			wrappedHandler.ServeHTTP(w, req)

			if !handlerCalled {
				t.Error("Expected handler to be called")
			}
			// Note: We can't easily verify if metrics were recorded without mocking
			// the Prometheus metrics, but we verify the handler behavior
		})
	}
}

func TestNormalizePath(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected string
	}{
		{
			name:     "API file path",
			path:     "/api/file/photos/vacation/image.jpg",
			expected: "/api/file/{path}",
		},
		{
			name:     "API thumbnail path",
			path:     "/api/thumbnail/videos/movie.mp4",
			expected: "/api/thumbnail/{path}",
		},
		{
			name:     "API stream path",
			path:     "/api/stream/music/song.mp3",
			expected: "/api/stream/{path}",
		},
		{
			name:     "API stream-info path",
			path:     "/api/stream-info/videos/clip.webm",
			expected: "/api/stream-info/{path}",
		},
		{
			name:     "Regular API path",
			path:     "/api/favorites",
			expected: "/api/favorites",
		},
		{
			name:     "Root path",
			path:     "/",
			expected: "/",
		},
		{
			name:     "Auth login path",
			path:     "/api/auth/login",
			expected: "/api/auth/login",
		},
		{
			name:     "Health check path",
			path:     "/health",
			expected: "/health",
		},
		{
			name:     "Deep path - exceeds 5 segments",
			path:     "/a/b/c/d/e/f/g/h",
			expected: "/a/b/c/d/{path}",
		},
		{
			name:     "Path with 5 segments (including empty first)",
			path:     "/api/v1/users/123",
			expected: "/api/v1/users/123",
		},
		{
			name:     "Path with 6 segments - gets truncated",
			path:     "/api/v1/users/123/profile",
			expected: "/api/v1/users/123/{path}",
		},
		{
			name:     "Wildcard prefix without trailing content",
			path:     "/api/file/",
			expected: "/api/file/{path}",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizePath(tt.path)
			if result != tt.expected {
				t.Errorf("normalizePath(%q) = %q, want %q", tt.path, result, tt.expected)
			}
		})
	}
}

func TestMetricsMiddlewareStatusCode(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
	}{
		{"200 OK", http.StatusOK},
		{"201 Created", http.StatusCreated},
		{"400 Bad Request", http.StatusBadRequest},
		{"401 Unauthorized", http.StatusUnauthorized},
		{"404 Not Found", http.StatusNotFound},
		{"500 Internal Server Error", http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.statusCode)
			})

			config := MetricsConfig{SkipPaths: []string{}}
			middleware := Metrics(config)
			wrappedHandler := middleware(handler)

			req := httptest.NewRequest(http.MethodGet, "/api/test", http.NoBody)
			w := httptest.NewRecorder()

			wrappedHandler.ServeHTTP(w, req)

			if w.Code != tt.statusCode {
				t.Errorf("Expected status code %d, got %d", tt.statusCode, w.Code)
			}
		})
	}
}

func TestMetricsMiddlewareHTTPMethods(t *testing.T) {
	methods := []string{
		http.MethodGet,
		http.MethodPost,
		http.MethodPut,
		http.MethodDelete,
		http.MethodPatch,
		http.MethodHead,
		http.MethodOptions,
	}

	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			})

			config := MetricsConfig{SkipPaths: []string{}}
			middleware := Metrics(config)
			wrappedHandler := middleware(handler)

			req := httptest.NewRequest(method, "/api/test", http.NoBody)
			w := httptest.NewRecorder()

			wrappedHandler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status 200 for %s, got %d", method, w.Code)
			}
		})
	}
}

func TestNormalizePathCardinality(t *testing.T) {
	// Test that normalization prevents cardinality explosion
	// by verifying many different paths map to the same normalized path

	filePaths := []string{
		"/api/file/user1/photo1.jpg",
		"/api/file/user2/photo2.jpg",
		"/api/file/deep/nested/path/file.png",
	}

	for _, path := range filePaths {
		normalized := normalizePath(path)
		if normalized != "/api/file/{path}" {
			t.Errorf("Expected all file paths to normalize to /api/file/{path}, got %q for %q", normalized, path)
		}
	}

	// Verify deep paths are also normalized
	deepPaths := []string{
		"/a/b/c/d/e/f",
		"/x/y/z/1/2/3",
		"/very/deep/nested/path/structure/file",
	}

	for _, path := range deepPaths {
		normalized := normalizePath(path)
		segments := strings.Split(strings.Trim(normalized, "/"), "/")
		// After normalization, should have at most 4 real segments + {path} placeholder (5 total)
		if len(segments) > 5 {
			t.Errorf("Deep path %q normalized to %q with too many segments: %d", path, normalized, len(segments))
		}
	}
}

func TestMetricsMiddlewareStreamingVsNonStreaming(t *testing.T) {
	t.Run("non-streaming endpoint uses total duration", func(t *testing.T) {
		handlerDuration := 10 * time.Millisecond
		handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			time.Sleep(handlerDuration)
			w.Write([]byte("response"))
		})

		config := MetricsConfig{SkipPaths: []string{}}
		middleware := Metrics(config)
		wrappedHandler := middleware(handler)

		req := httptest.NewRequest(http.MethodGet, "/api/favorites", http.NoBody)
		w := httptest.NewRecorder()

		start := time.Now()
		wrappedHandler.ServeHTTP(w, req)
		totalDuration := time.Since(start)

		if w.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", w.Code)
		}

		// For non-streaming endpoints, metrics should track close to total duration
		if totalDuration < handlerDuration {
			t.Errorf("Total duration %v should be >= handler duration %v", totalDuration, handlerDuration)
		}
	})

	t.Run("streaming endpoint tracks time to first byte", func(t *testing.T) {
		firstByteDelay := 5 * time.Millisecond
		streamingDuration := 20 * time.Millisecond

		handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			// Simulate server preparing response
			time.Sleep(firstByteDelay)

			// Send headers (first byte)
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("first chunk"))

			// Simulate streaming more data
			time.Sleep(streamingDuration)
			w.Write([]byte("more data"))
		})

		config := MetricsConfig{SkipPaths: []string{}}
		middleware := Metrics(config)
		wrappedHandler := middleware(handler)

		req := httptest.NewRequest(http.MethodGet, "/api/stream/video.mp4", http.NoBody)
		w := httptest.NewRecorder()

		wrappedHandler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", w.Code)
		}

		// For streaming endpoints, metrics should track TTFB, not total streaming duration
		// The actual metric recording is internal, but we verify the handler completed
		// and the wrapper correctly tracked timing
	})

	t.Run("stream-info is not treated as streaming", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"duration": 120}`))
		})

		config := MetricsConfig{SkipPaths: []string{}}
		middleware := Metrics(config)
		wrappedHandler := middleware(handler)

		req := httptest.NewRequest(http.MethodGet, "/api/stream-info/video.mp4", http.NoBody)
		w := httptest.NewRecorder()

		wrappedHandler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", w.Code)
		}
	})
}

func BenchmarkMetricsMiddleware(b *testing.B) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	config := DefaultMetricsConfig()
	middleware := Metrics(config)
	wrappedHandler := middleware(handler)

	req := httptest.NewRequest(http.MethodGet, "/api/test", http.NoBody)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		wrappedHandler.ServeHTTP(w, req)
	}
}

func BenchmarkNormalizePath(b *testing.B) {
	paths := []string{
		"/api/file/deep/nested/path/to/file.jpg",
		"/api/thumbnail/image.png",
		"/api/favorites",
		"/",
		"/very/deep/path/with/many/segments/here",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, path := range paths {
			_ = normalizePath(path)
		}
	}
}
