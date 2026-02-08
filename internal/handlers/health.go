package handlers

import (
	"net/http"
	"runtime"

	"media-viewer/internal/startup"
)

const (
	statusHealthy  = "healthy"
	statusStarting = "starting"
	statusDegraded = "degraded"
)

// HealthResponse contains the health check response
type HealthResponse struct {
	Status            string `json:"status"`
	Ready             bool   `json:"ready"`
	Version           string `json:"version"`
	Uptime            string `json:"uptime"`
	Indexing          bool   `json:"indexing"`
	LastIndexed       string `json:"lastIndexed,omitempty"`
	InitialIndexError string `json:"initialIndexError,omitempty"`

	// Progress info
	FilesIndexed   int64 `json:"filesIndexed"`
	FoldersIndexed int64 `json:"foldersIndexed"`

	// System info
	GoVersion    string `json:"goVersion"`
	NumCPU       int    `json:"numCpu"`
	NumGoroutine int    `json:"numGoroutine"`

	// Stats summary
	TotalFiles   int `json:"totalFiles,omitempty"`
	TotalFolders int `json:"totalFolders,omitempty"`
}

// HealthCheck returns the health status of the service
func (h *Handlers) HealthCheck(w http.ResponseWriter, _ *http.Request) {
	healthStatus := h.indexer.GetHealthStatus()
	stats := h.db.GetStats()

	response := HealthResponse{
		Ready:          healthStatus.Ready,
		Version:        startup.Version,
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
	} else {
		w.WriteHeader(http.StatusOK)
	}

	writeJSON(w, response)
}

// LivenessCheck is a simple liveness probe (always returns 200 if server is running)
func (h *Handlers) LivenessCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	// For HEAD requests, only send headers (no body)
	if r.Method != http.MethodHead {
		writeJSON(w, map[string]string{
			"status": "alive",
		})
	}
}

// ReadinessCheck returns 200 only when the service is ready to accept traffic
func (h *Handlers) ReadinessCheck(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if h.indexer.IsReady() {
		w.WriteHeader(http.StatusOK)
		writeJSON(w, map[string]string{
			"status": "ready",
		})
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]string{
			"status": "not_ready",
		})
	}
}
