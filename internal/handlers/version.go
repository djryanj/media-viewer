package handlers

import (
	"net/http"

	"media-viewer/internal/startup"
)

// GetVersion returns the application version and build information
func (h *Handlers) GetVersion(w http.ResponseWriter, _ *http.Request) {
	buildInfo := startup.GetBuildInfo()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, buildInfo)
}
