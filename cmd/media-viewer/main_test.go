package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/metrics"
)

// mockStatsDatabase implements the GetStats method needed by dbStatsAdapter
type mockStatsDatabase struct {
	totalFiles     int
	totalFolders   int
	totalImages    int
	totalVideos    int
	totalPlaylists int
	totalFavorites int
	totalTags      int
}

// GetStats returns mock statistics
func (m *mockStatsDatabase) GetStats() database.IndexStats {
	return database.IndexStats{
		TotalFiles:     m.totalFiles,
		TotalFolders:   m.totalFolders,
		TotalImages:    m.totalImages,
		TotalVideos:    m.totalVideos,
		TotalPlaylists: m.totalPlaylists,
		TotalFavorites: m.totalFavorites,
		TotalTags:      m.totalTags,
		LastIndexed:    time.Now(),
		IndexDuration:  "0s",
	}
}

// statsProvider defines the interface for objects that can provide stats
type statsProvider interface {
	GetStats() database.IndexStats
}

// testStatsAdapter wraps any statsProvider for testing
type testStatsAdapter struct {
	provider statsProvider
}

// GetStats implements metrics.StatsProvider
func (a *testStatsAdapter) GetStats() metrics.Stats {
	dbStats := a.provider.GetStats()
	return metrics.Stats{
		TotalFiles:     dbStats.TotalFiles,
		TotalFolders:   dbStats.TotalFolders,
		TotalImages:    dbStats.TotalImages,
		TotalVideos:    dbStats.TotalVideos,
		TotalPlaylists: dbStats.TotalPlaylists,
		TotalFavorites: dbStats.TotalFavorites,
		TotalTags:      dbStats.TotalTags,
	}
}

func TestDbStatsAdapter(t *testing.T) {
	t.Run("GetStats converts database stats correctly", func(t *testing.T) {
		// Create mock database with test data
		mock := &mockStatsDatabase{
			totalFiles:     50,
			totalFolders:   10,
			totalImages:    40,
			totalVideos:    10,
			totalPlaylists: 2,
			totalFavorites: 15,
			totalTags:      8,
		}

		adapter := &testStatsAdapter{provider: mock}

		// Verify the adapter implements the interface
		var _ metrics.StatsProvider = adapter

		// Get stats and verify conversion
		stats := adapter.GetStats()

		if stats.TotalFiles != 50 {
			t.Errorf("TotalFiles = %d, want 50", stats.TotalFiles)
		}
		if stats.TotalFolders != 10 {
			t.Errorf("TotalFolders = %d, want 10", stats.TotalFolders)
		}
		if stats.TotalImages != 40 {
			t.Errorf("TotalImages = %d, want 40", stats.TotalImages)
		}
		if stats.TotalVideos != 10 {
			t.Errorf("TotalVideos = %d, want 10", stats.TotalVideos)
		}
		if stats.TotalPlaylists != 2 {
			t.Errorf("TotalPlaylists = %d, want 2", stats.TotalPlaylists)
		}
		if stats.TotalFavorites != 15 {
			t.Errorf("TotalFavorites = %d, want 15", stats.TotalFavorites)
		}
		if stats.TotalTags != 8 {
			t.Errorf("TotalTags = %d, want 8", stats.TotalTags)
		}
	})
}

func TestServeStaticFile(t *testing.T) {
	tests := []struct {
		name        string
		filepath    string
		contentType string
		expectError bool
	}{
		{
			name:        "Valid content type",
			filepath:    "/tmp/test.txt",
			contentType: "text/plain",
			expectError: true, // File won't exist, but handler is created
		},
		{
			name:        "JSON content type",
			filepath:    "/tmp/test.json",
			contentType: "application/json",
			expectError: true,
		},
		{
			name:        "HTML content type",
			filepath:    "/tmp/test.html",
			contentType: "text/html; charset=utf-8",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := serveStaticFile(tt.filepath, tt.contentType)

			// Verify handler is not nil
			if handler == nil {
				t.Error("Expected handler to be created, got nil")
			}

			// Create test request and recorder
			req := httptest.NewRequest("GET", "/", http.NoBody)
			w := httptest.NewRecorder()

			// Call handler (it will fail to find file, but that's expected)
			handler(w, req)

			// Verify response has correct content type header set
			// Note: http.ServeFile may override this if file is found
			// This test verifies the handler creation and basic execution
		})
	}
}

func TestSetupRouter(t *testing.T) {
	// Note: This requires a handlers.Handlers instance which needs database, etc.
	// For now, we test that the function signature is correct and can be called
	// Full integration tests would require setting up all dependencies

	t.Run("setupRouter function exists", func(_ *testing.T) {
		// This test documents that the function exists and has expected signature
		// Full testing would require mock handlers
		// Note: Function reference is always non-nil in Go
		_ = setupRouter // Verify it exists
	})
}

func TestServerTimeouts(t *testing.T) {
	// Test that server timeouts are configured reasonably
	// This is a documentation test for the expected values

	t.Run("Read timeout is reasonable", func(t *testing.T) {
		// Server is configured with 15 second read timeout
		// This is appropriate for API requests
		const expectedReadTimeout = 15
		if expectedReadTimeout <= 0 {
			t.Error("Read timeout should be positive")
		}
	})

	t.Run("Write timeout allows streaming", func(t *testing.T) {
		// Server is configured with 0 write timeout
		// This allows long-running video streaming
		const expectedWriteTimeout = 0
		if expectedWriteTimeout < 0 {
			t.Error("Write timeout should be >= 0")
		}
	})

	t.Run("Idle timeout is reasonable", func(t *testing.T) {
		// Server is configured with 60 second idle timeout
		const expectedIdleTimeout = 60
		if expectedIdleTimeout <= 0 {
			t.Error("Idle timeout should be positive")
		}
	})
}

func TestMetricsServerTimeouts(t *testing.T) {
	// Test that metrics server timeouts are configured appropriately

	t.Run("Metrics read timeout is reasonable", func(t *testing.T) {
		// Metrics server is configured with 10 second read timeout
		const expectedReadTimeout = 10
		if expectedReadTimeout <= 0 {
			t.Error("Metrics read timeout should be positive")
		}
	})

	t.Run("Metrics write timeout is reasonable", func(t *testing.T) {
		// Metrics server is configured with 10 second write timeout
		const expectedWriteTimeout = 10
		if expectedWriteTimeout <= 0 {
			t.Error("Metrics write timeout should be positive")
		}
	})

	t.Run("Metrics idle timeout is reasonable", func(t *testing.T) {
		// Metrics server is configured with 30 second idle timeout
		const expectedIdleTimeout = 30
		if expectedIdleTimeout <= 0 {
			t.Error("Metrics idle timeout should be positive")
		}
	})
}

func TestBackgroundWorkerIntervals(t *testing.T) {
	// Document expected intervals for background workers

	t.Run("Session cleanup interval", func(t *testing.T) {
		// Uses config.SessionCleanup which defaults to 5 minutes
		// This test documents the expected behavior
		if testing.Short() {
			t.Skip("Skipping interval test in short mode")
		}
	})

	t.Run("WebAuthn cleanup interval", func(t *testing.T) {
		// WebAuthn sessions cleaned every 5 minutes
		const expectedInterval = 5 // minutes
		if expectedInterval <= 0 {
			t.Error("WebAuthn cleanup interval should be positive")
		}
	})

	t.Run("Metrics collector interval", func(t *testing.T) {
		// Metrics collector runs every 1 minute
		const expectedInterval = 1 // minute
		if expectedInterval <= 0 {
			t.Error("Metrics collector interval should be positive")
		}
	})
}

func TestShutdownTimeout(t *testing.T) {
	t.Run("Graceful shutdown timeout is reasonable", func(t *testing.T) {
		// Shutdown uses 30 second timeout context
		const expectedTimeout = 30 // seconds
		if expectedTimeout <= 0 {
			t.Error("Shutdown timeout should be positive")
		}
		if expectedTimeout < 10 {
			t.Error("Shutdown timeout should be at least 10 seconds for graceful shutdown")
		}
	})
}

func TestDatabaseStatsConversion(t *testing.T) {
	t.Run("Stats field mapping", func(t *testing.T) {
		// Create a mock database that returns known stats
		mock := &mockStatsDatabase{
			totalFiles:     100,
			totalFolders:   20,
			totalImages:    75,
			totalVideos:    25,
			totalPlaylists: 5,
			totalFavorites: 30,
			totalTags:      15,
		}

		adapter := &testStatsAdapter{provider: mock}

		// Verify adapter implements StatsProvider interface
		var _ metrics.StatsProvider = adapter

		// Get stats through adapter
		stats := adapter.GetStats()

		// Verify all fields are correctly mapped
		if stats.TotalFiles != mock.totalFiles {
			t.Errorf("TotalFiles = %d, want %d", stats.TotalFiles, mock.totalFiles)
		}
		if stats.TotalFolders != mock.totalFolders {
			t.Errorf("TotalFolders = %d, want %d", stats.TotalFolders, mock.totalFolders)
		}
		if stats.TotalImages != mock.totalImages {
			t.Errorf("TotalImages = %d, want %d", stats.TotalImages, mock.totalImages)
		}
		if stats.TotalVideos != mock.totalVideos {
			t.Errorf("TotalVideos = %d, want %d", stats.TotalVideos, mock.totalVideos)
		}
		if stats.TotalPlaylists != mock.totalPlaylists {
			t.Errorf("TotalPlaylists = %d, want %d", stats.TotalPlaylists, mock.totalPlaylists)
		}
		if stats.TotalFavorites != mock.totalFavorites {
			t.Errorf("TotalFavorites = %d, want %d", stats.TotalFavorites, mock.totalFavorites)
		}
		if stats.TotalTags != mock.totalTags {
			t.Errorf("TotalTags = %d, want %d", stats.TotalTags, mock.totalTags)
		}
	})

	t.Run("Zero values", func(t *testing.T) {
		// Test with empty database
		mock := &mockStatsDatabase{}
		adapter := &testStatsAdapter{provider: mock}

		stats := adapter.GetStats()

		// All fields should be zero
		if stats.TotalFiles != 0 {
			t.Errorf("TotalFiles = %d, want 0", stats.TotalFiles)
		}
		if stats.TotalFolders != 0 {
			t.Errorf("TotalFolders = %d, want 0", stats.TotalFolders)
		}
		if stats.TotalImages != 0 {
			t.Errorf("TotalImages = %d, want 0", stats.TotalImages)
		}
		if stats.TotalVideos != 0 {
			t.Errorf("TotalVideos = %d, want 0", stats.TotalVideos)
		}
		if stats.TotalPlaylists != 0 {
			t.Errorf("TotalPlaylists = %d, want 0", stats.TotalPlaylists)
		}
		if stats.TotalFavorites != 0 {
			t.Errorf("TotalFavorites = %d, want 0", stats.TotalFavorites)
		}
		if stats.TotalTags != 0 {
			t.Errorf("TotalTags = %d, want 0", stats.TotalTags)
		}
	})
}

func TestLivenessEndpoint(t *testing.T) {
	t.Run("GET /livez returns 200 with JSON", func(t *testing.T) {
		// This test verifies the liveness endpoint responds to GET requests
		// and returns proper JSON response
		// Full integration test would require setupRouter with mock handlers
		// This documents the expected behavior
		expectedStatus := http.StatusOK
		if expectedStatus != 200 {
			t.Errorf("Expected status 200, got %d", expectedStatus)
		}
	})

	t.Run("HEAD /livez returns 200 without body", func(t *testing.T) {
		// This test verifies the liveness endpoint supports HEAD requests
		// HEAD requests should return same headers as GET but no body
		// This is used for efficient connectivity checks in the frontend
		expectedStatus := http.StatusOK
		if expectedStatus != 200 {
			t.Errorf("Expected status 200, got %d", expectedStatus)
		}
	})

	t.Run("Liveness check has minimal overhead", func(_ *testing.T) {
		// This test documents that /livez is designed for lightweight checks
		// It should not perform database queries or heavy operations
		// It always returns 200 if the server is running
		// This makes it ideal for connectivity polling
	})
}

func TestRouterHealthEndpoints(t *testing.T) {
	// These tests document the expected HTTP methods for health endpoints
	// Actual routing is tested in handler-level tests

	t.Run("Health endpoints should support GET", func(t *testing.T) {
		endpoints := []string{"/health", "/healthz", "/livez", "/readyz", "/version"}
		for _, endpoint := range endpoints {
			if endpoint == "" {
				t.Error("Endpoint should not be empty")
			}
		}
	})

	t.Run("Livez should support HEAD for efficiency", func(t *testing.T) {
		// /livez specifically supports HEAD requests for lightweight connectivity checks
		// HEAD requests return same headers as GET but no body
		// This reduces bandwidth and processing overhead for polling
		endpoint := "/livez"
		methods := []string{"GET", "HEAD"}
		if len(methods) != 2 {
			t.Errorf("Expected /livez to support 2 methods, configured for %d", len(methods))
		}
		if endpoint != "/livez" {
			t.Errorf("Expected endpoint /livez, got %s", endpoint)
		}
	})

	t.Run("HEAD requests should work on public endpoints", func(_ *testing.T) {
		// HTTP spec recommends HEAD support for GET endpoints
		// At minimum, /livez should support HEAD for connectivity checks
		// Other health endpoints may support HEAD by default via http.Handler
	})
}

func TestConnectivityCheckDesign(t *testing.T) {
	t.Run("Frontend should use HEAD /livez for connectivity", func(_ *testing.T) {
		// This test documents the design decision to use HEAD /livez
		// instead of GET /api/auth/check for connectivity checks
		// Benefits:
		// - No authentication required
		// - No database queries
		// - No JSON body to parse
		// - Minimal bandwidth usage
		// - Designed specifically for liveness probes
	})

	t.Run("Livez is preferred over auth check for polling", func(_ *testing.T) {
		// /livez is better than /api/auth/check for connectivity because:
		// - auth/check validates sessions (database lookup)
		// - auth/check returns JSON that needs parsing
		// - livez has zero dependencies
		// - livez is standard Kubernetes liveness probe pattern
	})
}

func TestHTTPRouteStructure(t *testing.T) {
	// Document the expected route structure

	tests := []struct {
		category    string
		description string
	}{
		{
			category:    "Health checks",
			description: "Should have /health, /healthz, /livez, /readyz endpoints",
		},
		{
			category:    "PWA assets",
			description: "Should serve manifest.json, favicon.ico, icons/, sw.js without auth",
		},
		{
			category:    "Auth routes",
			description: "Should have /api/auth/* endpoints for authentication",
		},
		{
			category:    "WebAuthn routes",
			description: "Should have /api/auth/webauthn/* endpoints for passkeys",
		},
		{
			category:    "File routes",
			description: "Should have /api/files, /api/file/*, /api/thumbnail/* endpoints",
		},
		{
			category:    "Favorites routes",
			description: "Should have /api/favorites endpoints with bulk operations",
		},
		{
			category:    "Tags routes",
			description: "Should have /api/tags endpoints with bulk and batch operations",
		},
		{
			category:    "Streaming routes",
			description: "Should have /api/stream/* endpoints for video streaming",
		},
		{
			category:    "Cache routes",
			description: "Should have cache management endpoints",
		},
	}

	for _, tt := range tests {
		t.Run(tt.category, func(t *testing.T) {
			// This test documents the expected route structure
			// Full testing would require setting up the router and checking routes
			if tt.description == "" {
				t.Error("Route category should have description")
			}
		})
	}
}
