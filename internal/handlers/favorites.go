package handlers

import (
	"encoding/json"
	"net/http"

	"media-viewer/internal/database"
)

// FavoriteRequest represents a request to manage favorites
type FavoriteRequest struct {
	Path string            `json:"path"`
	Name string            `json:"name"`
	Type database.FileType `json:"type"`
}

// GetFavorites returns all favorite media files
func (h *Handlers) GetFavorites(w http.ResponseWriter, _ *http.Request) {
	favorites, err := h.db.GetFavorites()
	if err != nil {
		http.Error(w, "Failed to get favorites", http.StatusInternalServerError)
		return
	}

	if favorites == nil {
		favorites = []database.MediaFile{}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, favorites)
}

// AddFavorite adds a media file to favorites
func (h *Handlers) AddFavorite(w http.ResponseWriter, r *http.Request) {
	var req FavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	if err := h.db.AddFavorite(req.Path, req.Name, req.Type); err != nil {
		http.Error(w, "Failed to add favorite", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// RemoveFavorite removes a media file from favorites
func (h *Handlers) RemoveFavorite(w http.ResponseWriter, r *http.Request) {
	var req FavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	if err := h.db.RemoveFavorite(req.Path); err != nil {
		http.Error(w, "Failed to remove favorite", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// CheckFavorite checks if a media file is in favorites
func (h *Handlers) CheckFavorite(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	isFavorite := h.db.IsFavorite(path)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]bool{"isFavorite": isFavorite})
}
