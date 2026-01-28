package handlers

import (
	"encoding/json"
	"net/http"

	"media-viewer/internal/startup"
)

// GetVersion returns the application version and build information
func (h *Handlers) GetVersion(w http.ResponseWriter, r *http.Request) {
	buildInfo := startup.GetBuildInfo()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(buildInfo)
}
