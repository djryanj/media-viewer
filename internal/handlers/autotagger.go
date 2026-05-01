package handlers

import (
	"net/http"

	"media-viewer/internal/logging"
)

// RunAutoTagger handles triggering an on-demand full auto-tagging pass.
// POST /api/autotagger/run
func (h *Handlers) RunAutoTagger(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if h.autoTagger == nil {
		http.Error(w, "Auto-tagger not configured", http.StatusServiceUnavailable)
		return
	}

	h.autoTagger.TriggerRun()
	logging.Info("On-demand auto-tagger run triggered via API")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]interface{}{
		"success": true,
		"message": "Auto-tagger run started",
	})
}

// GetAutoTaggerStatus returns the current or most recent auto-tagger run status.
// GET /api/autotagger/status
func (h *Handlers) GetAutoTaggerStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if h.autoTagger == nil {
		http.Error(w, "Auto-tagger not configured", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, h.autoTagger.Status())
}
