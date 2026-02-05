package handlers

import (
	"encoding/json"
	"fmt"
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

// BulkTagRequest represents a request to add/remove a tag from multiple files
type BulkTagRequest struct {
	Paths []string `json:"paths"`
	Tag   string   `json:"tag"`
}

// BulkTagResponse represents the response from a bulk tag operation
type BulkTagResponse struct {
	Success int      `json:"success"`
	Failed  int      `json:"failed"`
	Errors  []string `json:"errors,omitempty"`
}

// GetAllTags returns all tags
func (h *Handlers) GetAllTags(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tags, err := h.db.GetAllTags(ctx)
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
	ctx := r.Context()
	path := r.URL.Query().Get("path")

	if path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	tags, err := h.db.GetFileTags(ctx, path)
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
	ctx := r.Context()

	var req BatchTagsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Paths) == 0 {
		http.Error(w, "Paths array is required", http.StatusBadRequest)
		return
	}

	// Allow large batch requests for bulk operations
	maxPaths := 10000
	if len(req.Paths) > maxPaths {
		http.Error(w, fmt.Sprintf("Too many paths (max %d)", maxPaths), http.StatusBadRequest)
		return
	}

	// Build result map
	result := make(map[string][]string)

	for _, path := range req.Paths {
		if path == "" {
			continue
		}

		tags, err := h.db.GetFileTags(ctx, path)
		if err != nil {
			// Log error but continue with other paths
			continue
		}

		// Include all paths, even those without tags (empty array)
		// This lets the frontend know the request was processed
		if tags == nil {
			tags = []string{}
		}
		result[path] = tags
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, result)
}

// AddTagToFile adds a tag to a file
func (h *Handlers) AddTagToFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req TagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" || req.Tag == "" {
		http.Error(w, "Path and tag are required", http.StatusBadRequest)
		return
	}

	if err := h.db.AddTagToFile(ctx, req.Path, req.Tag); err != nil {
		http.Error(w, "Failed to add tag", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// RemoveTagFromFile removes a tag from a file
func (h *Handlers) RemoveTagFromFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req TagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" || req.Tag == "" {
		http.Error(w, "Path and tag are required", http.StatusBadRequest)
		return
	}

	if err := h.db.RemoveTagFromFile(ctx, req.Path, req.Tag); err != nil {
		http.Error(w, "Failed to remove tag", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// BulkAddTag adds a tag to multiple files at once
func (h *Handlers) BulkAddTag(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req BulkTagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Paths) == 0 {
		http.Error(w, "Paths array is required", http.StatusBadRequest)
		return
	}

	if req.Tag == "" {
		http.Error(w, "Tag is required", http.StatusBadRequest)
		return
	}

	maxPaths := 10000
	if len(req.Paths) > maxPaths {
		http.Error(w, fmt.Sprintf("Too many paths (max %d)", maxPaths), http.StatusBadRequest)
		return
	}

	response := BulkTagResponse{
		Success: 0,
		Failed:  0,
		Errors:  []string{},
	}

	for _, path := range req.Paths {
		if path == "" {
			continue
		}

		if err := h.db.AddTagToFile(ctx, path, req.Tag); err != nil {
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

// BulkRemoveTag removes a tag from multiple files at once
func (h *Handlers) BulkRemoveTag(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req BulkTagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Paths) == 0 {
		http.Error(w, "Paths array is required", http.StatusBadRequest)
		return
	}

	if req.Tag == "" {
		http.Error(w, "Tag is required", http.StatusBadRequest)
		return
	}

	// Limit the number of paths to prevent abuse
	maxPaths := 10000
	if len(req.Paths) > maxPaths {
		req.Paths = req.Paths[:maxPaths]
	}

	response := BulkTagResponse{
		Success: 0,
		Failed:  0,
		Errors:  []string{},
	}

	for _, path := range req.Paths {
		if path == "" {
			continue
		}

		if err := h.db.RemoveTagFromFile(ctx, path, req.Tag); err != nil {
			response.Failed++
			// Optionally collect error details (limit to prevent response bloat)
			if len(response.Errors) < 10 {
				response.Errors = append(response.Errors, path+": "+err.Error())
			}
		} else {
			response.Success++
		}
	}

	// Clear errors if empty to keep response clean
	if len(response.Errors) == 0 {
		response.Errors = nil
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, response)
}

// SetFileTags replaces all tags for a file
func (h *Handlers) SetFileTags(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req TagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	if err := h.db.SetFileTags(ctx, req.Path, req.Tags); err != nil {
		http.Error(w, "Failed to set tags", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// GetFilesByTag returns files with a specific tag
func (h *Handlers) GetFilesByTag(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	tagName := vars["tag"]

	if tagName == "" {
		http.Error(w, "Tag name is required", http.StatusBadRequest)
		return
	}

	page := 1
	pageSize := 50
	// Parse pagination from query params if needed

	result, err := h.db.GetFilesByTag(ctx, tagName, page, pageSize)
	if err != nil {
		http.Error(w, "Failed to get files", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, result)
}

// DeleteTag removes a tag entirely
func (h *Handlers) DeleteTag(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	tagName := vars["tag"]

	if tagName == "" {
		http.Error(w, "Tag name is required", http.StatusBadRequest)
		return
	}

	if err := h.db.DeleteTag(ctx, tagName); err != nil {
		http.Error(w, "Failed to delete tag", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// RenameTag renames a tag
func (h *Handlers) RenameTag(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
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

	if err := h.db.RenameTag(ctx, tagName, req.NewName); err != nil {
		http.Error(w, "Failed to rename tag", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}
