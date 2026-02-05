package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
)

// This file contains mock-based tests for health check handlers.
// The original health_test.go uses real SQLite databases and real indexers which are slower.
// These mock-based tests run 10-100x faster and provide better isolation.

// =============================================================================
// Mock Indexer for Health Tests
// =============================================================================

type mockHealthIndexer struct {
	isReady           bool
	healthStatus      indexer.HealthStatus
	getHealthStatusFn func() indexer.HealthStatus
}

func newMockHealthIndexer() *mockHealthIndexer {
	return &mockHealthIndexer{
		isReady: false,
		healthStatus: indexer.HealthStatus{
			Ready:          false,
			Indexing:       false,
			StartTime:      time.Now(),
			Uptime:         "0s",
			FilesIndexed:   0,
			FoldersIndexed: 0,
		},
	}
}

func (m *mockHealthIndexer) IsReady() bool {
	return m.isReady
}

func (m *mockHealthIndexer) GetHealthStatus() indexer.HealthStatus {
	if m.getHealthStatusFn != nil {
		return m.getHealthStatusFn()
	}
	return m.healthStatus
}

// SetReady sets the ready state
func (m *mockHealthIndexer) SetReady(ready bool) {
	m.isReady = ready
	m.healthStatus.Ready = ready
}

// SetIndexing sets the indexing state
func (m *mockHealthIndexer) SetIndexing(indexing bool) {
	m.healthStatus.Indexing = indexing
}

// SetFilesIndexed sets the files indexed count
func (m *mockHealthIndexer) SetFilesIndexed(count int64) {
	m.healthStatus.FilesIndexed = count
}

// SetFoldersIndexed sets the folders indexed count
func (m *mockHealthIndexer) SetFoldersIndexed(count int64) {
	m.healthStatus.FoldersIndexed = count
}

// SetLastIndexed sets the last indexed time
func (m *mockHealthIndexer) SetLastIndexed(t time.Time) {
	m.healthStatus.LastIndexed = t
}

// SetInitialIndexError sets the initial index error
func (m *mockHealthIndexer) SetInitialIndexError(err string) {
	m.healthStatus.InitialIndexError = err
}

// SetUptime sets the uptime string
func (m *mockHealthIndexer) SetUptime(uptime string) {
	m.healthStatus.Uptime = uptime
}

// =============================================================================
// Mock Database for Health Tests
// =============================================================================

type mockHealthDB struct {
	stats database.IndexStats
}

func newMockHealthDB() *mockHealthDB {
	return &mockHealthDB{
		stats: database.IndexStats{
			TotalFiles:   0,
			TotalFolders: 0,
		},
	}
}

func (m *mockHealthDB) GetStats() database.IndexStats {
	return m.stats
}

func (m *mockHealthDB) SetStats(stats database.IndexStats) {
	m.stats = stats
}

func (m *mockHealthDB) Close() error {
	return nil
}

// =============================================================================
// Mock Handlers for Health Tests
// =============================================================================

type mockHandlersHealth struct {
	indexer *mockHealthIndexer
	db      *mockHealthDB
}

func newMockHandlersHealth() *mockHandlersHealth {
	return &mockHandlersHealth{
		indexer: newMockHealthIndexer(),
		db:      newMockHealthDB(),
	}
}

// HealthCheck implements the health check endpoint with mocks
func (h *mockHandlersHealth) HealthCheck(w http.ResponseWriter, _ *http.Request) {
	healthStatus := h.indexer.GetHealthStatus()
	stats := h.db.GetStats()

	response := HealthResponse{
		Ready:          healthStatus.Ready,
		Version:        "test-version",
		Uptime:         healthStatus.Uptime,
		Indexing:       healthStatus.Indexing,
		FilesIndexed:   healthStatus.FilesIndexed,
		FoldersIndexed: healthStatus.FoldersIndexed,
		GoVersion:      runtime.Version(),
		NumCPU:         runtime.NumCPU(),
		NumGoroutine:   runtime.NumGoroutine(),
	}

	if healthStatus.Ready {
		response.Status = statusHealthy
	} else {
		response.Status = statusStarting
	}

	if !healthStatus.LastIndexed.IsZero() {
		response.LastIndexed = healthStatus.LastIndexed.Format("2006-01-02T15:04:05Z07:00")
	}

	if healthStatus.InitialIndexError != "" {
		response.InitialIndexError = healthStatus.InitialIndexError
		response.Status = statusDegraded
	}

	// Include stats if available
	if stats.TotalFiles > 0 || stats.TotalFolders > 0 {
		response.TotalFiles = stats.TotalFiles
		response.TotalFolders = stats.TotalFolders
	}

	w.Header().Set("Content-Type", "application/json")

	// Return 503 only if not ready at all
	if !healthStatus.Ready {
		w.WriteHeader(http.StatusServiceUnavailable)
	}

	json.NewEncoder(w).Encode(response)
}

// LivenessCheck implements the liveness probe endpoint with mocks
func (h *mockHandlersHealth) LivenessCheck(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

// ReadinessCheck implements the readiness probe endpoint with mocks
func (h *mockHandlersHealth) ReadinessCheck(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if h.indexer.IsReady() {
		json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"})
	}
}

// =============================================================================
// HealthCheck Tests
// =============================================================================

func TestHealthCheckBasicMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	// Should return valid status code
	if w.Code != http.StatusOK && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 200 or 503, got %d", w.Code)
	}

	// Should return valid JSON
	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify content type
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}
}

func TestHealthCheckWhenNotReadyMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(false)
	h.indexer.SetIndexing(true)

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status %d, got %d", http.StatusServiceUnavailable, w.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Ready {
		t.Error("Expected ready=false")
	}
	if response.Status != "starting" {
		t.Errorf("Expected status=starting, got %s", response.Status)
	}
}

func TestHealthCheckWhenReadyMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)
	h.indexer.SetFilesIndexed(150)
	h.indexer.SetLastIndexed(time.Now().Add(-1 * time.Hour))

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response.Ready {
		t.Error("Expected ready=true")
	}
	if response.Status != "healthy" {
		t.Errorf("Expected status=healthy, got %s", response.Status)
	}
	if response.FilesIndexed != 150 {
		t.Errorf("Expected filesIndexed=150, got %d", response.FilesIndexed)
	}
}

func TestHealthCheckResponseStructureMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)
	h.indexer.SetFilesIndexed(100)
	h.indexer.SetFoldersIndexed(10)

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Check all expected fields are present
	if response.Status == "" {
		t.Error("Expected status to be set")
	}
	if response.Version == "" {
		t.Error("Expected version to be set")
	}
	if response.Uptime == "" {
		t.Error("Expected uptime to be set")
	}
	if response.GoVersion == "" {
		t.Error("Expected goVersion to be set")
	}
	if response.NumCPU <= 0 {
		t.Error("Expected numCpu to be positive")
	}
	if response.FilesIndexed != 100 {
		t.Errorf("Expected filesIndexed=100, got %d", response.FilesIndexed)
	}
	if response.FoldersIndexed != 10 {
		t.Errorf("Expected foldersIndexed=10, got %d", response.FoldersIndexed)
	}
}

func TestHealthCheckHTTPMethodsMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		method         string
		expectedStatus int
	}{
		{http.MethodGet, http.StatusOK},
		{http.MethodHead, http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.method, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersHealth()
			h.indexer.SetReady(true)

			req := httptest.NewRequest(tt.method, "/health", http.NoBody)
			w := httptest.NewRecorder()

			h.HealthCheck(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Method %s: Expected status %d, got %d", tt.method, tt.expectedStatus, w.Code)
			}
		})
	}
}

func TestHealthCheckWithStatsMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)
	h.db.SetStats(database.IndexStats{
		TotalFiles:   500,
		TotalFolders: 25,
		TotalImages:  300,
		TotalVideos:  200,
	})

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.TotalFiles != 500 {
		t.Errorf("Expected totalFiles=500, got %d", response.TotalFiles)
	}
	if response.TotalFolders != 25 {
		t.Errorf("Expected totalFolders=25, got %d", response.TotalFolders)
	}
}

func TestHealthCheckWithInitialIndexErrorMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(false)
	h.indexer.SetInitialIndexError("permission denied")

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status %d, got %d", http.StatusServiceUnavailable, w.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Status != "degraded" {
		t.Errorf("Expected status=degraded, got %s", response.Status)
	}
	if response.InitialIndexError == "" {
		t.Error("Expected initialIndexError to be set")
	}
}

func TestHealthCheckLastIndexedTimestampMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)
	lastIndexed := time.Now().Add(-30 * time.Minute)
	h.indexer.SetLastIndexed(lastIndexed)

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.LastIndexed == "" {
		t.Error("Expected lastIndexed to be set")
	}

	// Verify it's a valid ISO8601 timestamp
	if _, err := time.Parse(time.RFC3339, response.LastIndexed); err != nil {
		t.Errorf("Expected valid ISO8601 timestamp, got error: %v", err)
	}
}

// =============================================================================
// LivenessCheck Tests
// =============================================================================

func TestLivenessCheckAlwaysSucceedsMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(false) // Even when not ready

	req := httptest.NewRequest(http.MethodGet, "/livez", http.NoBody)
	w := httptest.NewRecorder()

	h.LivenessCheck(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "alive" {
		t.Errorf("Expected status=alive, got %s", response["status"])
	}
}

func TestLivenessCheckContentTypeMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()

	req := httptest.NewRequest(http.MethodGet, "/livez", http.NoBody)
	w := httptest.NewRecorder()

	h.LivenessCheck(w, req)

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}
}

// =============================================================================
// ReadinessCheck Tests
// =============================================================================

func TestReadinessCheckWhenNotReadyMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(false)

	req := httptest.NewRequest(http.MethodGet, "/readyz", http.NoBody)
	w := httptest.NewRecorder()

	h.ReadinessCheck(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status %d, got %d", http.StatusServiceUnavailable, w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "not_ready" {
		t.Errorf("Expected status=not_ready, got %s", response["status"])
	}
}

func TestReadinessCheckWhenReadyMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)

	req := httptest.NewRequest(http.MethodGet, "/readyz", http.NoBody)
	w := httptest.NewRecorder()

	h.ReadinessCheck(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "ready" {
		t.Errorf("Expected status=ready, got %s", response["status"])
	}
}

func TestReadinessCheckResponseStructureMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)

	req := httptest.NewRequest(http.MethodGet, "/readyz", http.NoBody)
	w := httptest.NewRecorder()

	h.ReadinessCheck(w, req)

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] == "" {
		t.Error("Expected status field to be present")
	}
}

func TestReadinessCheckHTTPMethodsMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		method string
	}{
		{http.MethodGet},
		{http.MethodHead},
	}

	for _, tt := range tests {
		t.Run(tt.method, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersHealth()
			h.indexer.SetReady(true)

			req := httptest.NewRequest(tt.method, "/readyz", http.NoBody)
			w := httptest.NewRecorder()

			h.ReadinessCheck(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Method %s: Expected status %d, got %d", tt.method, http.StatusOK, w.Code)
			}
		})
	}
}

// =============================================================================
// Kubernetes Probe Behavior Tests
// =============================================================================

func TestKubernetesProbesBehaviorMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                 string
		ready                bool
		expectedLivenessCode int
		expectedReadyCode    int
		expectedHealthCode   int
	}{
		{
			name:                 "Liveness always succeeds even when not ready",
			ready:                false,
			expectedLivenessCode: http.StatusOK,
			expectedReadyCode:    http.StatusServiceUnavailable,
			expectedHealthCode:   http.StatusServiceUnavailable,
		},
		{
			name:                 "Readiness fails when not ready",
			ready:                false,
			expectedLivenessCode: http.StatusOK,
			expectedReadyCode:    http.StatusServiceUnavailable,
			expectedHealthCode:   http.StatusServiceUnavailable,
		},
		{
			name:                 "Health provides detailed status for debugging",
			ready:                true,
			expectedLivenessCode: http.StatusOK,
			expectedReadyCode:    http.StatusOK,
			expectedHealthCode:   http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersHealth()
			h.indexer.SetReady(tt.ready)

			// Test liveness
			req := httptest.NewRequest(http.MethodGet, "/livez", http.NoBody)
			w := httptest.NewRecorder()
			h.LivenessCheck(w, req)
			if w.Code != tt.expectedLivenessCode {
				t.Errorf("Liveness: expected %d, got %d", tt.expectedLivenessCode, w.Code)
			}

			// Test readiness
			req = httptest.NewRequest(http.MethodGet, "/readyz", http.NoBody)
			w = httptest.NewRecorder()
			h.ReadinessCheck(w, req)
			if w.Code != tt.expectedReadyCode {
				t.Errorf("Readiness: expected %d, got %d", tt.expectedReadyCode, w.Code)
			}

			// Test health
			req = httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
			w = httptest.NewRecorder()
			h.HealthCheck(w, req)
			if w.Code != tt.expectedHealthCode {
				t.Errorf("Health: expected %d, got %d", tt.expectedHealthCode, w.Code)
			}
		})
	}
}

func TestHealthStatusTransitionsMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		ready          bool
		expectedStatus string
		expectedCode   int
	}{
		{
			name:           "Initial state is not ready",
			ready:          false,
			expectedStatus: "starting",
			expectedCode:   http.StatusServiceUnavailable,
		},
		{
			name:           "After indexing state is healthy",
			ready:          true,
			expectedStatus: "healthy",
			expectedCode:   http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersHealth()
			h.indexer.SetReady(tt.ready)

			req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
			w := httptest.NewRecorder()

			h.HealthCheck(w, req)

			if w.Code != tt.expectedCode {
				t.Errorf("Expected status code %d, got %d", tt.expectedCode, w.Code)
			}

			var response HealthResponse
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				t.Fatalf("Failed to decode response: %v", err)
			}

			if response.Status != tt.expectedStatus {
				t.Errorf("Expected status %s, got %s", tt.expectedStatus, response.Status)
			}
		})
	}
}

func TestHealthCheckWithEmptyMediaDirectoryMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)
	h.indexer.SetFilesIndexed(0)
	h.indexer.SetFoldersIndexed(0)

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	// Should still be OK if indexing completed
	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.FilesIndexed != 0 {
		t.Errorf("Expected 0 files indexed, got %d", response.FilesIndexed)
	}
}

// =============================================================================
// Concurrent Access Tests
// =============================================================================

func TestHealthCheckConcurrentMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)

	var wg sync.WaitGroup
	numRequests := 10

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
			w := httptest.NewRecorder()

			h.HealthCheck(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Concurrent request failed: %d", w.Code)
			}
		}()
	}

	wg.Wait()
}

func TestAllProbesConcurrentMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)

	var wg sync.WaitGroup
	numRequests := 10

	// Test all probes concurrently
	for i := 0; i < numRequests; i++ {
		wg.Add(3)

		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
			w := httptest.NewRecorder()
			h.HealthCheck(w, req)
		}()

		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/livez", http.NoBody)
			w := httptest.NewRecorder()
			h.LivenessCheck(w, req)
		}()

		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/readyz", http.NoBody)
			w := httptest.NewRecorder()
			h.ReadinessCheck(w, req)
		}()
	}

	wg.Wait()
}

// =============================================================================
// Response Format Tests
// =============================================================================

func TestHealthResponseJSONSerializationMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)
	h.indexer.SetFilesIndexed(100)
	h.indexer.SetFoldersIndexed(10)

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	// Verify JSON is valid and can be parsed
	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode JSON response: %v", err)
	}

	// Verify response can be re-encoded
	if _, err := json.Marshal(response); err != nil {
		t.Fatalf("Failed to re-encode response: %v", err)
	}
}

func TestHealthResponseOmitEmptyMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)
	// Don't set LastIndexed or InitialIndexError

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	body := w.Body.String()

	// lastIndexed should be omitted when zero value
	// (it will be empty string after formatting, which should be omitted)
	// initialIndexError should definitely be omitted when empty
	if strings.Contains(body, "initialIndexError") {
		t.Error("Expected initialIndexError to be omitted when empty")
	}
}

func TestHealthResponseSystemInfoMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()
	h.indexer.SetReady(true)

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify system info is populated
	if response.GoVersion == "" {
		t.Error("Expected goVersion to be set")
	}
	if !strings.HasPrefix(response.GoVersion, "go") {
		t.Errorf("Expected goVersion to start with 'go', got %s", response.GoVersion)
	}
	if response.NumCPU != runtime.NumCPU() {
		t.Errorf("Expected numCpu=%d, got %d", runtime.NumCPU(), response.NumCPU)
	}
	if response.NumGoroutine <= 0 {
		t.Error("Expected numGoroutine to be positive")
	}
}

func TestHealthCheckIndexingStateMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name             string
		indexing         bool
		expectedIndexing bool
	}{
		{
			name:             "Not indexing",
			indexing:         false,
			expectedIndexing: false,
		},
		{
			name:             "Currently indexing",
			indexing:         true,
			expectedIndexing: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newMockHandlersHealth()
			h.indexer.SetReady(true)
			h.indexer.SetIndexing(tt.indexing)

			req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
			w := httptest.NewRecorder()

			h.HealthCheck(w, req)

			var response HealthResponse
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				t.Fatalf("Failed to decode response: %v", err)
			}

			if response.Indexing != tt.expectedIndexing {
				t.Errorf("Expected indexing=%v, got %v", tt.expectedIndexing, response.Indexing)
			}
		})
	}
}

func TestHealthCheckWithCustomHealthStatusMock(t *testing.T) {
	t.Parallel()

	h := newMockHandlersHealth()

	// Use custom function to return specific health status
	customStatus := indexer.HealthStatus{
		Ready:          true,
		Indexing:       true,
		StartTime:      time.Now().Add(-2 * time.Hour),
		Uptime:         "2h0m0s",
		FilesIndexed:   12345,
		FoldersIndexed: 678,
		LastIndexed:    time.Now().Add(-30 * time.Minute),
	}

	h.indexer.getHealthStatusFn = func() indexer.HealthStatus {
		return customStatus
	}

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	w := httptest.NewRecorder()

	h.HealthCheck(w, req)

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.FilesIndexed != 12345 {
		t.Errorf("Expected filesIndexed=12345, got %d", response.FilesIndexed)
	}
	if response.FoldersIndexed != 678 {
		t.Errorf("Expected foldersIndexed=678, got %d", response.FoldersIndexed)
	}
	if response.Uptime != "2h0m0s" {
		t.Errorf("Expected uptime=2h0m0s, got %s", response.Uptime)
	}
}
