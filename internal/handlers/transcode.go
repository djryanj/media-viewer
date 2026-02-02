package handlers

import (
	"net/http"

	"media-viewer/internal/logging"
)

// ClearTranscodeCache handles clearing the video transcode cache.
// POST /api/transcode/clear
func (h *Handlers) ClearTranscodeCache(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	freedBytes, err := h.transcoder.ClearCache()
	if err != nil {
		logging.Error("Failed to clear transcode cache: %v", err)
		http.Error(w, "Failed to clear transcode cache", http.StatusInternalServerError)
		return
	}

	logging.Info("Transcode cache cleared, freed %d bytes", freedBytes)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"success":    true,
		"freedBytes": freedBytes,
	})
}
