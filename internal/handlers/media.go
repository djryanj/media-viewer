package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"

	"github.com/gorilla/mux"
)

// ListFiles lists files in a directory with sorting and pagination
func (h *Handlers) ListFiles(w http.ResponseWriter, r *http.Request) {
	logging.Debug("ListFiles called: %s", r.URL.String())

	opts := database.ListOptions{
		Path:       r.URL.Query().Get("path"),
		SortField:  database.SortField(r.URL.Query().Get("sort")),
		SortOrder:  database.SortOrder(r.URL.Query().Get("order")),
		FilterType: r.URL.Query().Get("type"),
		Page:       1,
		PageSize:   100,
	}

	if page, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && page > 0 {
		opts.Page = page
	}
	if pageSize, err := strconv.Atoi(r.URL.Query().Get("pageSize")); err == nil && pageSize > 0 {
		opts.PageSize = pageSize
	}

	if opts.SortField == "" {
		opts.SortField = database.SortByName
	}
	if opts.SortOrder == "" {
		opts.SortOrder = database.SortAsc
	}

	logging.Debug("ListFiles options: path=%q, sort=%s, order=%s, page=%d, pageSize=%d",
		opts.Path, opts.SortField, opts.SortOrder, opts.Page, opts.PageSize)

	listing, err := h.db.ListDirectory(opts)
	if err != nil {
		logging.Error("ListFiles database error: %v", err)
		http.Error(w, "Failed to list directory", http.StatusInternalServerError)
		return
	}

	logging.Debug("ListFiles completed, found %d items", len(listing.Items))

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, listing)
}

// GetMediaFiles returns all media files (images and videos) in a directory for lightbox viewing
func (h *Handlers) GetMediaFiles(w http.ResponseWriter, r *http.Request) {
	parentPath := r.URL.Query().Get("path")

	sortField := database.SortField(r.URL.Query().Get("sort"))
	sortOrder := database.SortOrder(r.URL.Query().Get("order"))

	if sortField == "" {
		sortField = database.SortByName
	}
	if sortOrder == "" {
		sortOrder = database.SortAsc
	}

	logging.Debug("GetMediaFiles: path=%s, sort=%s, order=%s", parentPath, sortField, sortOrder)

	files, err := h.db.GetMediaInDirectory(parentPath, sortField, sortOrder)
	if err != nil {
		logging.Error("GetMediaFiles error: %v", err)
		http.Error(w, "Failed to get media files", http.StatusInternalServerError)
		return
	}

	if files == nil {
		files = []database.MediaFile{}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, files)
}

// GetFile serves a file from the media directory
func (h *Handlers) GetFile(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filePath := vars["path"]

	fullPath := filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	http.ServeFile(w, r, fullPath)
}

// GetThumbnail returns a thumbnail image for a media file
func (h *Handlers) GetThumbnail(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filePath := vars["path"]

	logging.Debug("Thumbnail requested: %s", filePath)

	if filePath == "" {
		logging.Error("Thumbnail: empty path")
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		logging.Error("Thumbnail: failed to resolve path %s: %v", filePath, err)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	absMediaDir, _ := filepath.Abs(h.mediaDir)
	if !strings.HasPrefix(absPath, absMediaDir) {
		logging.Error("Thumbnail: path outside media dir: %s", filePath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if !h.thumbGen.IsEnabled() {
		logging.Warn("Thumbnail: thumbnails disabled, returning 503")
		http.Error(w, "Thumbnails disabled", http.StatusServiceUnavailable)
		return
	}

	// Get file info from database to determine type
	file, err := h.db.GetFileByPath(filePath)
	if err != nil {
		logging.Error("Thumbnail: file not found in database %s: %v", filePath, err)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Validate file/folder exists on disk (skip for folders as they're handled differently)
	if file.Type != database.FileTypeFolder {
		fileInfo, err := os.Stat(fullPath)
		if err != nil {
			if os.IsNotExist(err) {
				logging.Warn("Thumbnail: file not found: %s", fullPath)
				http.Error(w, "File not found", http.StatusNotFound)
			} else {
				logging.Error("Thumbnail: failed to stat file %s: %v", fullPath, err)
				http.Error(w, "Failed to access file", http.StatusInternalServerError)
			}
			return
		}

		if fileInfo.IsDir() {
			logging.Warn("Thumbnail: path is a directory but not marked as folder in DB: %s", fullPath)
			http.Error(w, "Invalid file type", http.StatusBadRequest)
			return
		}
	}

	// Check if this file type supports thumbnails
	switch file.Type {
	case database.FileTypeImage, database.FileTypeVideo, database.FileTypeFolder:
		// Supported
	case database.FileTypePlaylist, database.FileTypeOther:
		logging.Warn("Thumbnail: unsupported file type %s for %s", file.Type, filePath)
		http.Error(w, "Unsupported file type", http.StatusBadRequest)
		return
	}

	logging.Debug("Thumbnail: generating for %s (type: %s)", filePath, file.Type)

	thumb, err := h.thumbGen.GetThumbnail(fullPath, file.Type)
	if err != nil {
		logging.Error("Thumbnail: generation failed for %s: %v", filePath, err)
		http.Error(w, fmt.Sprintf("Failed to generate thumbnail: %v", err), http.StatusInternalServerError)
		return
	}

	logging.Debug("Thumbnail: success for %s (%d bytes)", filePath, len(thumb))

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	if _, err := w.Write(thumb); err != nil {
		logging.Error("failed to write thumbnail response: %v", err)
	}
}

// StreamVideo streams a video file, transcoding if necessary for browser compatibility
func (h *Handlers) StreamVideo(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filePath := vars["path"]

	fullPath := filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	targetWidth := 0
	if widthStr := r.URL.Query().Get("width"); widthStr != "" {
		targetWidth, _ = strconv.Atoi(widthStr)
	}

	info, err := h.transcoder.GetVideoInfo(r.Context(), fullPath)
	if err != nil {
		http.Error(w, "Failed to get video info", http.StatusInternalServerError)
		return
	}

	if !info.NeedsTranscode && (targetWidth == 0 || targetWidth >= info.Width) {
		http.ServeFile(w, r, fullPath)
		return
	}

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Transfer-Encoding", "chunked")

	if err := h.transcoder.StreamVideo(r.Context(), fullPath, w, targetWidth); err != nil {
		logging.Error("error streaming video %s: %v", filePath, err)
	}
}

// GetStreamInfo returns codec and dimension information about a video file
func (h *Handlers) GetStreamInfo(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filePath := vars["path"]

	fullPath := filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	info, err := h.transcoder.GetVideoInfo(r.Context(), fullPath)
	if err != nil {
		http.Error(w, "Failed to get video info", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, info)
}

// GetStats returns current library statistics
func (h *Handlers) GetStats(w http.ResponseWriter, _ *http.Request) {
	stats := h.db.GetStats()
	stats.TotalFavorites = h.db.GetFavoriteCount()
	stats.TotalTags = h.db.GetTagCount()

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, stats)
}

// TriggerReindex starts a new media library indexing operation
func (h *Handlers) TriggerReindex(w http.ResponseWriter, _ *http.Request) {
	if h.indexer.IsIndexing() {
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, map[string]string{
			"status":  "already_running",
			"message": "Indexing is already in progress",
		})
		return
	}

	h.indexer.TriggerIndex()

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{
		"status":  "started",
		"message": "Re-indexing started",
	})
}

func isSubPath(parent, child string) bool {
	parent, _ = filepath.Abs(parent)
	child, _ = filepath.Abs(child)
	return len(child) >= len(parent) && child[:len(parent)] == parent
}

// InvalidateThumbnail invalidates (deletes) the cached thumbnail for a specific file or folder
func (h *Handlers) InvalidateThumbnail(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filePath := vars["path"]

	if filePath == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if !h.thumbGen.IsEnabled() {
		http.Error(w, "Thumbnails disabled", http.StatusServiceUnavailable)
		return
	}

	if err := h.thumbGen.InvalidateThumbnail(fullPath); err != nil {
		logging.Error("Failed to invalidate thumbnail for %s: %v", filePath, err)
		http.Error(w, "Failed to invalidate thumbnail", http.StatusInternalServerError)
		return
	}

	logging.Info("Invalidated thumbnail for: %s", filePath)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{
		"status":  "ok",
		"message": fmt.Sprintf("Thumbnail invalidated for %s", filePath),
	})
}

// InvalidateAllThumbnails clears the entire thumbnail cache
func (h *Handlers) InvalidateAllThumbnails(w http.ResponseWriter, _ *http.Request) {
	if !h.thumbGen.IsEnabled() {
		http.Error(w, "Thumbnails disabled", http.StatusServiceUnavailable)
		return
	}

	count, err := h.thumbGen.InvalidateAll()
	if err != nil {
		logging.Error("Failed to invalidate all thumbnails: %v", err)
		http.Error(w, "Failed to invalidate thumbnails", http.StatusInternalServerError)
		return
	}

	logging.Info("Invalidated %d thumbnails", count)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]interface{}{
		"status":  "ok",
		"message": "All thumbnails invalidated",
		"count":   count,
	})
}

// RebuildAllThumbnails clears the cache and regenerates all thumbnails in the background
func (h *Handlers) RebuildAllThumbnails(w http.ResponseWriter, _ *http.Request) {
	if !h.thumbGen.IsEnabled() {
		http.Error(w, "Thumbnails disabled", http.StatusServiceUnavailable)
		return
	}

	// Check if generation is already in progress
	if h.thumbGen.IsGenerating() {
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, map[string]string{
			"status":  "already_running",
			"message": "Thumbnail generation is already in progress",
		})
		return
	}

	// Start rebuild (clears cache and triggers generation)
	h.thumbGen.RebuildAll()

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{
		"status":  "started",
		"message": "Thumbnail rebuild started in background",
	})
}

// GetThumbnailStatus returns the current status of thumbnail generation
func (h *Handlers) GetThumbnailStatus(w http.ResponseWriter, _ *http.Request) {
	if !h.thumbGen.IsEnabled() {
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, map[string]interface{}{
			"enabled": false,
		})
		return
	}

	status := h.thumbGen.GetStatus()

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, status)
}
