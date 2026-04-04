package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/mux"

	"media-viewer/internal/database"
)

// CollectionRequest is used for creating or renaming a collection.
type CollectionRequest struct {
	Name       string   `json:"name"`
	Paths      []string `json:"paths"`
	CoverPath  string   `json:"coverPath"`
	FolderPath *string  `json:"folderPath,omitempty"`
}

// CollectionItemsRequest carries a set of file paths for add/remove operations.
type CollectionItemsRequest struct {
	Paths []string `json:"paths"`
}

// CollectionReorderRequest carries the desired item order for a collection.
type CollectionReorderRequest struct {
	Paths []string `json:"paths"`
}

// CollectionMembershipsRequest is used for the batch membership lookup endpoint.
type CollectionMembershipsRequest struct {
	Paths []string `json:"paths"`
}

// CollectionDetailResponse wraps a Collection together with its ordered items.
type CollectionDetailResponse struct {
	*database.Collection
	Items []database.MediaFile `json:"items"`
}

func normalizeRequiredCollectionName(name string) (string, bool) {
	trimmed := strings.TrimSpace(name)
	return trimmed, trimmed != ""
}

// GetCollections returns all collections.
func (h *Handlers) GetCollections(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	collections, err := h.db.GetCollections(ctx)
	if err != nil {
		http.Error(w, "Failed to get collections", http.StatusInternalServerError)
		return
	}
	if collections == nil {
		collections = []database.Collection{}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, collections)
}

// CreateCollection creates a new collection, optionally with initial items.
func (h *Handlers) CreateCollection(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req CollectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	name, ok := normalizeRequiredCollectionName(req.Name)
	if !ok {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	req.Name = name

	const maxItems = 500
	if len(req.Paths) > maxItems {
		req.Paths = req.Paths[:maxItems]
	}

	collection, err := h.db.CreateCollection(ctx, req.Name, req.Paths, req.FolderPath)
	if err != nil {
		switch {
		case errors.Is(err, database.ErrCollectionNameInUse):
			writeJSONError(w, "Collection name is already in use. Choose a different name.", http.StatusConflict)
		case errors.Is(err, database.ErrCollectionFolderConflict):
			writeJSONError(w, "Collections can't span multiple folders.", http.StatusConflict)
		default:
			http.Error(w, "Failed to create collection", http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, collection)
}

// GetCollection returns a collection with its ordered items.
func (h *Handlers) GetCollection(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	vars := mux.Vars(r)
	id, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "Invalid collection ID", http.StatusBadRequest)
		return
	}

	collection, err := h.db.GetCollection(ctx, id)
	if err != nil {
		http.Error(w, "Collection not found", http.StatusNotFound)
		return
	}

	items, err := h.db.GetCollectionItems(ctx, id)
	if err != nil {
		http.Error(w, "Failed to get collection items", http.StatusInternalServerError)
		return
	}
	if items == nil {
		items = []database.MediaFile{}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, CollectionDetailResponse{Collection: collection, Items: items})
}

// UpdateCollection renames a collection and/or changes its cover image.
func (h *Handlers) UpdateCollection(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	vars := mux.Vars(r)
	id, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "Invalid collection ID", http.StatusBadRequest)
		return
	}

	var req CollectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	name, ok := normalizeRequiredCollectionName(req.Name)
	if !ok {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	req.Name = name

	if err := h.db.UpdateCollection(ctx, id, req.Name, req.CoverPath); err != nil {
		if errors.Is(err, database.ErrCollectionNameInUse) {
			writeJSONError(w, "Collection name is already in use. Choose a different name.", http.StatusConflict)
			return
		}
		http.Error(w, "Failed to update collection", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// DeleteCollection deletes a collection and all its membership records.
func (h *Handlers) DeleteCollection(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	vars := mux.Vars(r)
	id, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "Invalid collection ID", http.StatusBadRequest)
		return
	}

	if err := h.db.DeleteCollection(ctx, id); err != nil {
		http.Error(w, "Failed to delete collection", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// AddCollectionItems appends items to a collection.
func (h *Handlers) AddCollectionItems(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	vars := mux.Vars(r)
	id, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "Invalid collection ID", http.StatusBadRequest)
		return
	}

	var req CollectionItemsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Paths) == 0 {
		http.Error(w, "Paths are required", http.StatusBadRequest)
		return
	}

	const maxItems = 500
	if len(req.Paths) > maxItems {
		req.Paths = req.Paths[:maxItems]
	}

	if err := h.db.AddItemsToCollection(ctx, id, req.Paths); err != nil {
		if errors.Is(err, database.ErrCollectionFolderConflict) {
			writeJSONError(w, "Collections can't span multiple folders.", http.StatusConflict)
			return
		}
		http.Error(w, "Failed to add items to collection", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// RemoveCollectionItems removes one or more items from a collection.
func (h *Handlers) RemoveCollectionItems(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	vars := mux.Vars(r)
	id, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "Invalid collection ID", http.StatusBadRequest)
		return
	}

	var req CollectionItemsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Paths) == 0 {
		http.Error(w, "Paths are required", http.StatusBadRequest)
		return
	}

	if err := h.db.RemoveItemsFromCollection(ctx, id, req.Paths); err != nil {
		http.Error(w, "Failed to remove item from collection", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// ReorderCollectionItems updates the display order of items in a collection.
func (h *Handlers) ReorderCollectionItems(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	vars := mux.Vars(r)
	id, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "Invalid collection ID", http.StatusBadRequest)
		return
	}

	var req CollectionReorderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Paths) == 0 {
		http.Error(w, "Paths are required", http.StatusBadRequest)
		return
	}

	if err := h.db.ReorderCollectionItems(ctx, id, req.Paths); err != nil {
		http.Error(w, "Failed to reorder collection items", http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, "ok")
}

// GetCollectionMemberships returns a map of filePath → []collectionID for the
// given batch of paths. Used by the frontend to apply collection indicators.
func (h *Handlers) GetCollectionMemberships(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req CollectionMembershipsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	const maxPaths = 1000
	if len(req.Paths) > maxPaths {
		req.Paths = req.Paths[:maxPaths]
	}

	memberships, err := h.db.GetBatchCollectionMemberships(ctx, req.Paths)
	if err != nil {
		http.Error(w, "Failed to get memberships", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, memberships)
}
