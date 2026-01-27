package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"media-viewer/internal/database"
)

func (h *Handlers) Search(w http.ResponseWriter, r *http.Request) {
	opts := database.SearchOptions{
		Query:      r.URL.Query().Get("q"),
		FilterType: r.URL.Query().Get("type"),
		Page:       1,
		PageSize:   50,
	}

	if page, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && page > 0 {
		opts.Page = page
	}
	if pageSize, err := strconv.Atoi(r.URL.Query().Get("pageSize")); err == nil && pageSize > 0 {
		opts.PageSize = pageSize
	}

	if opts.Query == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(database.SearchResult{
			Items:      []database.MediaFile{},
			Query:      "",
			TotalItems: 0,
			Page:       1,
			PageSize:   opts.PageSize,
			TotalPages: 0,
		})
		return
	}

	result, err := h.db.Search(opts)
	if err != nil {
		http.Error(w, "Search failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handlers) SearchSuggestions(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	limit := 10
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = l
	}

	suggestions, err := h.db.SearchSuggestions(query, limit)
	if err != nil {
		http.Error(w, "Search suggestions failed", http.StatusInternalServerError)
		return
	}

	if suggestions == nil {
		suggestions = []database.SearchSuggestion{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(suggestions)
}
