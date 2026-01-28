package handlers

import (
	"encoding/json"
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
	json.NewEncoder(w).Encode(listing)
}

func (h *Handlers) GetMediaFiles(w http.ResponseWriter, r *http.Request) {
	parentPath := r.URL.Query().Get("path")

	// Get sort parameters from query string
	sortField := database.SortField(r.URL.Query().Get("sort"))
	sortOrder := database.SortOrder(r.URL.Query().Get("order"))

	// Apply defaults if not specified
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
	json.NewEncoder(w).Encode(files)
}

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
		logging.Warn("Thumbnail: path is a directory: %s", fullPath)
		http.Error(w, "Cannot generate thumbnail for directory", http.StatusBadRequest)
		return
	}

	if !h.thumbGen.IsEnabled() {
		logging.Warn("Thumbnail: thumbnails disabled, returning 503")
		http.Error(w, "Thumbnails disabled", http.StatusServiceUnavailable)
		return
	}

	fileType := h.thumbGen.GetFileType(fullPath)
	if fileType == database.FileTypeOther {
		logging.Warn("Thumbnail: unsupported file type for %s", filePath)
		http.Error(w, "Unsupported file type", http.StatusBadRequest)
		return
	}

	logging.Debug("Thumbnail: generating for %s (type: %s)", filePath, fileType)

	thumb, err := h.thumbGen.GetThumbnail(fullPath, fileType)
	if err != nil {
		logging.Error("Thumbnail: generation failed for %s: %v", filePath, err)
		http.Error(w, fmt.Sprintf("Failed to generate thumbnail: %v", err), http.StatusInternalServerError)
		return
	}

	logging.Debug("Thumbnail: success for %s (%d bytes)", filePath, len(thumb))

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(thumb)
}

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

	info, err := h.transcoder.GetVideoInfo(fullPath)
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

	h.transcoder.StreamVideo(r.Context(), fullPath, w, targetWidth)
}

func (h *Handlers) GetStreamInfo(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filePath := vars["path"]

	fullPath := filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	info, err := h.transcoder.GetVideoInfo(fullPath)
	if err != nil {
		http.Error(w, "Failed to get video info", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

func (h *Handlers) GetStats(w http.ResponseWriter, r *http.Request) {
	stats := h.db.GetStats()
	stats.TotalFavorites = h.db.GetFavoriteCount()
	stats.TotalTags = h.db.GetTagCount()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (h *Handlers) TriggerReindex(w http.ResponseWriter, r *http.Request) {
	if h.indexer.IsIndexing() {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "already_running",
			"message": "Indexing is already in progress",
		})
		return
	}

	h.indexer.TriggerIndex()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "started",
		"message": "Re-indexing started",
	})
}

func isSubPath(parent, child string) bool {
	parent, _ = filepath.Abs(parent)
	child, _ = filepath.Abs(child)
	return len(child) >= len(parent) && child[:len(parent)] == parent
}
