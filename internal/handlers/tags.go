package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

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

// RelatedTagSuggestionsRequest represents a request for co-occurring tags.
type RelatedTagSuggestionsRequest struct {
	Tags    []string `json:"tags"`
	Exclude []string `json:"exclude,omitempty"`
	Limit   int      `json:"limit,omitempty"`
}

// BulkTagRequest represents a request to add/remove tags from multiple files.
// Supports both single-tag (Tag) and multi-tag (Tags) for backward compatibility.
type BulkTagRequest struct {
	Paths []string `json:"paths"`
	Tag   string   `json:"tag,omitempty"`
	Tags  []string `json:"tags,omitempty"`
}

// FileTagMutationResponse represents the response from a single-file tag mutation.
type FileTagMutationResponse struct {
	Status string   `json:"status"`
	Path   string   `json:"path"`
	Tags   []string `json:"tags"`
}

// BulkTagResponse represents the response from a bulk tag operation
type BulkTagResponse struct {
	Success    int                 `json:"success"`
	Failed     int                 `json:"failed"`
	Errors     []string            `json:"errors,omitempty"`
	TagsByPath map[string][]string `json:"tagsByPath,omitempty"`
}

func (h *Handlers) getFileTagsOrEmpty(ctx context.Context, path string) ([]string, error) {
	tags, err := h.db.GetFileTags(ctx, path)
	if err != nil {
		return nil, err
	}
	if tags == nil {
		return []string{}, nil
	}
	return tags, nil
}

func (h *Handlers) getBatchFileTagsOrEmpty(ctx context.Context, paths []string) (map[string][]string, error) {
	tagsByPath, err := h.db.GetBatchFileTags(ctx, paths)
	if err != nil {
		return nil, err
	}

	result := make(map[string][]string, len(paths))
	for _, path := range paths {
		if tags, ok := tagsByPath[path]; ok && tags != nil {
			result[path] = tags
			continue
		}
		result[path] = []string{}
	}

	return result, nil
}

func buildBulkTagResponse(successCount int, errs []error, tagsByPath map[string][]string) BulkTagResponse {
	response := BulkTagResponse{
		Success:    successCount,
		Failed:     len(errs),
		TagsByPath: tagsByPath,
	}

	if len(errs) > 0 {
		errStrings := make([]string, 0, min(len(errs), 10))
		for i, e := range errs {
			if i >= 10 {
				break
			}
			errStrings = append(errStrings, e.Error())
		}
		response.Errors = errStrings
	}

	return response
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

// GetBatchFileTags returns tags for multiple files at once.
// Uses a single query instead of N individual GetFileTags calls.
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

	maxPaths := 10000
	if len(req.Paths) > maxPaths {
		http.Error(w, fmt.Sprintf("Too many paths (max %d)", maxPaths), http.StatusBadRequest)
		return
	}

	result, err := h.db.GetBatchFileTags(ctx, req.Paths)
	if err != nil {
		http.Error(w, "Failed to get batch tags", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, result)
}

// GetRelatedTagSuggestions returns tags that frequently co-occur with the provided tags.
func (h *Handlers) GetRelatedTagSuggestions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req RelatedTagSuggestionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Limit < 0 {
		http.Error(w, "Limit must be positive", http.StatusBadRequest)
		return
	}

	suggestions, err := h.db.GetRelatedTagSuggestions(ctx, req.Tags, req.Exclude, req.Limit)
	if err != nil {
		http.Error(w, "Failed to get related tag suggestions", http.StatusInternalServerError)
		return
	}

	if suggestions == nil {
		suggestions = []database.RelatedTagSuggestion{}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, suggestions)
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

	tags, err := h.getFileTagsOrEmpty(ctx, req.Path)
	if err != nil {
		http.Error(w, "Failed to load updated tags", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, FileTagMutationResponse{Status: "ok", Path: req.Path, Tags: tags})
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

	tags, err := h.getFileTagsOrEmpty(ctx, req.Path)
	if err != nil {
		http.Error(w, "Failed to load updated tags", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, FileTagMutationResponse{Status: "ok", Path: req.Path, Tags: tags})
}

// BulkAddTag adds one or more tags to multiple files in a single transaction.
// Accepts either {"tag": "name"} or {"tags": ["a", "b"]} or both.
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

	tags := req.resolveTags()
	if len(tags) == 0 {
		http.Error(w, "At least one tag is required (via 'tag' or 'tags')", http.StatusBadRequest)
		return
	}

	maxPaths := 10000
	if len(req.Paths) > maxPaths {
		http.Error(w, fmt.Sprintf("Too many paths (max %d)", maxPaths), http.StatusBadRequest)
		return
	}

	maxTags := 100
	if len(tags) > maxTags {
		http.Error(w, fmt.Sprintf("Too many tags (max %d)", maxTags), http.StatusBadRequest)
		return
	}

	successCount, errs, err := h.db.BulkAddTagsToFiles(ctx, req.Paths, tags)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to add tags: %v", err), http.StatusInternalServerError)
		return
	}

	tagsByPath, err := h.getBatchFileTagsOrEmpty(ctx, req.Paths)
	if err != nil {
		http.Error(w, "Failed to load updated tags", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, buildBulkTagResponse(successCount, errs, tagsByPath))
}

// BulkRemoveTag removes one or more tags from multiple files in a single transaction.
// Accepts either {"tag": "name"} or {"tags": ["a", "b"]} or both.
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

	tags := req.resolveTags()
	if len(tags) == 0 {
		http.Error(w, "At least one tag is required (via 'tag' or 'tags')", http.StatusBadRequest)
		return
	}

	maxPaths := 10000
	if len(req.Paths) > maxPaths {
		req.Paths = req.Paths[:maxPaths]
	}

	successCount, errs, err := h.db.BulkRemoveTagsFromFiles(ctx, req.Paths, tags)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to remove tags: %v", err), http.StatusInternalServerError)
		return
	}

	tagsByPath, err := h.getBatchFileTagsOrEmpty(ctx, req.Paths)
	if err != nil {
		http.Error(w, "Failed to load updated tags", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, buildBulkTagResponse(successCount, errs, tagsByPath))
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

	tags, err := h.getFileTagsOrEmpty(ctx, req.Path)
	if err != nil {
		http.Error(w, "Failed to load updated tags", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, FileTagMutationResponse{Status: "ok", Path: req.Path, Tags: tags})
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

// GetAllTagsWithCounts returns all tags with their usage counts
func (h *Handlers) GetAllTagsWithCounts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tags, err := h.db.GetAllTagsWithCounts(ctx)
	if err != nil {
		http.Error(w, "Failed to get tags with counts", http.StatusInternalServerError)
		return
	}

	if tags == nil {
		tags = []database.TagWithCount{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tags) //nolint:errcheck
}

// GetUnusedTags returns tags that have no file associations
func (h *Handlers) GetUnusedTags(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tags, err := h.db.GetUnusedTags(ctx)
	if err != nil {
		http.Error(w, "Failed to get unused tags", http.StatusInternalServerError)
		return
	}

	if tags == nil {
		tags = []string{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tags) //nolint:errcheck
}

// RenameTagEverywhere renames a tag and updates all file associations
func (h *Handlers) RenameTagEverywhere(w http.ResponseWriter, r *http.Request) {
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

	count, err := h.db.RenameTagEverywhere(ctx, tagName, req.NewName)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to rename tag: %v", err), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"status":        "ok",
		"affectedFiles": count,
		"oldName":       tagName,
		"newName":       req.NewName,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response) //nolint:errcheck
}

// DeleteTagEverywhere deletes a tag from all file associations
func (h *Handlers) DeleteTagEverywhere(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	tagName := vars["tag"]

	if tagName == "" {
		http.Error(w, "Tag name is required", http.StatusBadRequest)
		return
	}

	count, err := h.db.DeleteTagEverywhere(ctx, tagName)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to delete tag: %v", err), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"status":        "ok",
		"affectedFiles": count,
		"tagName":       tagName,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response) //nolint:errcheck
}

// resolveTags returns the deduplicated list of tags from the request,
// supporting both the single "tag" field and the "tags" array.
func (r *BulkTagRequest) resolveTags() []string {
	seen := make(map[string]struct{})
	var result []string

	// Single tag field (backward compat)
	if r.Tag != "" {
		t := strings.TrimSpace(r.Tag)
		if t != "" {
			seen[strings.ToLower(t)] = struct{}{}
			result = append(result, t)
		}
	}

	// Multi-tag field
	for _, tag := range r.Tags {
		t := strings.TrimSpace(tag)
		if t == "" {
			continue
		}
		lower := strings.ToLower(t)
		if _, exists := seen[lower]; !exists {
			seen[lower] = struct{}{}
			result = append(result, t)
		}
	}

	return result
}
