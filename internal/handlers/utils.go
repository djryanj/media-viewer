package handlers

import (
	"encoding/json"
	"net/http"

	"media-viewer/internal/logging"
)

// writeJSON encodes v as JSON and writes it to the response writer.
// Any encoding or write errors are logged since we typically cannot
// recover from them in an HTTP handler context.
func writeJSON(w http.ResponseWriter, v interface{}) {
	if err := json.NewEncoder(w).Encode(v); err != nil {
		logging.Error("failed to encode JSON response: %v", err)
	}
}

// writeJSONError writes an error response as JSON with the given status code.
// nolint:unused // kept for future use in error response handlers
func writeJSONError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	writeJSON(w, map[string]string{"error": message})
}

// writeJSONStatus writes a simple status response as JSON.
func writeJSONStatus(w http.ResponseWriter, status string) {
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"status": status})
}
