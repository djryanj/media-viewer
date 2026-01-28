package handlers

import (
	"net/http"
	"path/filepath"
	"strings"

	"media-viewer/internal/playlist"

	"github.com/gorilla/mux"
)

// ListPlaylists returns all available playlists
func (h *Handlers) ListPlaylists(w http.ResponseWriter, _ *http.Request) {
	playlists, err := h.db.GetAllPlaylists()
	if err != nil {
		http.Error(w, "Failed to get playlists", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, playlists)
}

// GetPlaylist returns the contents of a specific playlist
func (h *Handlers) GetPlaylist(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	name := vars["name"]

	// Find the playlist file
	playlists, err := h.db.GetAllPlaylists()
	if err != nil {
		http.Error(w, "Failed to get playlists", http.StatusInternalServerError)
		return
	}

	var playlistPath string
	for _, p := range playlists {
		baseName := strings.TrimSuffix(p.Name, filepath.Ext(p.Name))
		if baseName == name || p.Name == name {
			playlistPath = filepath.Join(h.mediaDir, p.Path)
			break
		}
	}

	if playlistPath == "" {
		http.Error(w, "Playlist not found", http.StatusNotFound)
		return
	}

	pl, err := playlist.ParseWPL(playlistPath, h.mediaDir)
	if err != nil {
		http.Error(w, "Failed to parse playlist", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, pl)
}
