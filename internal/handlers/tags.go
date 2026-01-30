package handlers

import (
	"encoding/json"
	"net/http"

	"media-viewer/internal/database"

	"github.com/gorilla/mux"
)

// TagRequest represents a request to manage tags for a file
type TagRequest struct {
	Path    string   `json:"path"`
	Tag     string   `json:"tag,omitempty"`
	Tags    []string `json:"tags,omitempty"`
	NewName string   `json:"newName,omitempty"`
	Color   string   `json:"color,omitempty"`
}

// BatchTagsRequest represents a request to get tags for multiple files
type BatchTagsRequest struct {
	Paths []string `json:"paths"`
}

// GetAllTags returns all tags
func (h *Handlers) GetAllTags(w http.ResponseWriter, _ *http.Request) {
	tags, err := h.db.GetAllTags()
	if err != nil {
		http.Error(w, "Failed to get tags", http.StatusInternalServerError)
		return
	}

	if tags == nil {
		tags = []database.Tag{}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, tags)
}

// GetFileTags returns tags for a specific file
func (h *Handlers) GetFileTags(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	tags, err := h.db.GetFileTags(path)
	if err != nil {
		http.Error(w, "Failed to get tags", http.StatusInternalServerError)
		return
	}

	if tags == nil {
		tags = []string{}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, tags)
}

// GetBatchFileTags returns tags for multiple files at once
func (h *Handlers) GetBatchFileTags(w http.ResponseWriter, r *http.Request) {
	var req BatchTagsRequest
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

	// Build result map
	result := make(map[string][]string)

	for _, path := range req.Paths {
		if path == "" {
			continue
		}

		tags, err := h.db.GetFileTags(path)
		if err != nil {
			// Log error but continue with other paths
			continue
		}

		// Only include paths that have tags
		if len(tags) > 0 {
			result[path] = tags
		}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, result)
}

// AddTagToFile adds a tag to a file
func (h *Handlers) AddTagToFile(w http.ResponseWriter, r *http.Request) {
	var req TagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" || req.Tag == "" {
		http.Error(w, "Path and tag are required", http.StatusBadRequest)
		return
	}

	if err := h.db.AddTagToFile(req.Path, req.Tag); err != nil {
		http.Error(w, "Failed to add tag", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// RemoveTagFromFile removes a tag from a file
func (h *Handlers) RemoveTagFromFile(w http.ResponseWriter, r *http.Request) {
	var req TagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" || req.Tag == "" {
		http.Error(w, "Path and tag are required", http.StatusBadRequest)
		return
	}

	if err := h.db.RemoveTagFromFile(req.Path, req.Tag); err != nil {
		http.Error(w, "Failed to remove tag", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// SetFileTags replaces all tags for a file
func (h *Handlers) SetFileTags(w http.ResponseWriter, r *http.Request) {
	var req TagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	if err := h.db.SetFileTags(req.Path, req.Tags); err != nil {
		http.Error(w, "Failed to set tags", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// GetFilesByTag returns files with a specific tag
func (h *Handlers) GetFilesByTag(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	tagName := vars["tag"]

	if tagName == "" {
		http.Error(w, "Tag name is required", http.StatusBadRequest)
		return
	}

	page := 1
	pageSize := 50
	// Parse pagination from query params if needed

	result, err := h.db.GetFilesByTag(tagName, page, pageSize)
	if err != nil {
		http.Error(w, "Failed to get files", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, result)
}

// DeleteTag removes a tag entirely
func (h *Handlers) DeleteTag(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	tagName := vars["tag"]

	if tagName == "" {
		http.Error(w, "Tag name is required", http.StatusBadRequest)
		return
	}

	if err := h.db.DeleteTag(tagName); err != nil {
		http.Error(w, "Failed to delete tag", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// RenameTag renames a tag
func (h *Handlers) RenameTag(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	tagName := vars["tag"]

	var req TagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if tagName == "" || req.NewName == "" {
		http.Error(w, "Tag name and new name are required", http.StatusBadRequest)
		return
	}

	if err := h.db.RenameTag(tagName, req.NewName); err != nil {
		http.Error(w, "Failed to rename tag", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}
