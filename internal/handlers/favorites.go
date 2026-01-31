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

// BulkFavoriteItem represents a single item in a bulk favorite request
type BulkFavoriteItem struct {
	Path string            `json:"path"`
	Name string            `json:"name"`
	Type database.FileType `json:"type"`
}

// BulkFavoriteRequest represents a request to add/remove multiple favorites
type BulkFavoriteRequest struct {
	Items []BulkFavoriteItem `json:"items"`
	Paths []string           `json:"paths"` // For remove operations (only paths needed)
}

// BulkFavoriteResponse represents the response from a bulk favorite operation
type BulkFavoriteResponse struct {
	Success int      `json:"success"`
	Failed  int      `json:"failed"`
	Errors  []string `json:"errors,omitempty"`
}

// GetFavorites returns all favorite media files
func (h *Handlers) GetFavorites(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	favorites, err := h.db.GetFavorites(ctx)
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
	ctx := r.Context()

	var req FavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	if err := h.db.AddFavorite(ctx, req.Path, req.Name, req.Type); err != nil {
		http.Error(w, "Failed to add favorite", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// RemoveFavorite removes a media file from favorites
func (h *Handlers) RemoveFavorite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req FavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	if err := h.db.RemoveFavorite(ctx, req.Path); err != nil {
		http.Error(w, "Failed to remove favorite", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// BulkAddFavorites adds multiple items to favorites at once
func (h *Handlers) BulkAddFavorites(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req BulkFavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Items) == 0 {
		http.Error(w, "Items array is required", http.StatusBadRequest)
		return
	}

	// Limit the number of items to prevent abuse
	maxItems := 100
	if len(req.Items) > maxItems {
		req.Items = req.Items[:maxItems]
	}

	response := BulkFavoriteResponse{
		Success: 0,
		Failed:  0,
		Errors:  []string{},
	}

	for _, item := range req.Items {
		if item.Path == "" {
			continue
		}

		if err := h.db.AddFavorite(ctx, item.Path, item.Name, item.Type); err != nil {
			response.Failed++
			if len(response.Errors) < 10 {
				response.Errors = append(response.Errors, item.Path+": "+err.Error())
			}
		} else {
			response.Success++
		}
	}

	if len(response.Errors) == 0 {
		response.Errors = nil
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, response)
}

// BulkRemoveFavorites removes multiple items from favorites at once
func (h *Handlers) BulkRemoveFavorites(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req BulkFavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Paths) == 0 {
		http.Error(w, "Paths array is required", http.StatusBadRequest)
		return
	}

	// Limit the number of paths to prevent abuse
	maxPaths := 100
	if len(req.Paths) > maxPaths {
		req.Paths = req.Paths[:maxPaths]
	}

	response := BulkFavoriteResponse{
		Success: 0,
		Failed:  0,
		Errors:  []string{},
	}

	for _, path := range req.Paths {
		if path == "" {
			continue
		}

		if err := h.db.RemoveFavorite(ctx, path); err != nil {
			response.Failed++
			if len(response.Errors) < 10 {
				response.Errors = append(response.Errors, path+": "+err.Error())
			}
		} else {
			response.Success++
		}
	}

	if len(response.Errors) == 0 {
		response.Errors = nil
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, response)
}

// CheckFavorite checks if a media file is in favorites
func (h *Handlers) CheckFavorite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	isFavorite := h.db.IsFavorite(ctx, path)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]bool{"isFavorite": isFavorite})
}
