package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"media-viewer/internal/database"

	"github.com/gorilla/mux"
)

func (h *Handlers) ListFiles(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	log.Printf("[DEBUG] ListFiles called: %s", r.URL.String())

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

	log.Printf("[DEBUG] ListFiles options: path=%q, sort=%s, order=%s, page=%d, pageSize=%d",
		opts.Path, opts.SortField, opts.SortOrder, opts.Page, opts.PageSize)

	listing, err := h.db.ListDirectory(opts)
	if err != nil {
		log.Printf("[ERROR] ListFiles database error: %v", err)
		http.Error(w, "Failed to list directory", http.StatusInternalServerError)
		return
	}

	log.Printf("[DEBUG] ListFiles completed in %v, found %d items", time.Since(start), len(listing.Items))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(listing)
}
func (h *Handlers) GetMediaFiles(w http.ResponseWriter, r *http.Request) {
	// Get media files in a specific directory (for lightbox navigation)
	parentPath := r.URL.Query().Get("path")

	files, err := h.db.GetMediaInDirectory(parentPath)
	if err != nil {
		http.Error(w, "Failed to get media files", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func (h *Handlers) GetFile(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filePath := vars["path"]

	fullPath := filepath.Join(h.mediaDir, filePath)

	// Security check
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

	log.Printf("[DEBUG] Thumbnail requested: %s", filePath)

	if filePath == "" {
		log.Printf("[ERROR] Thumbnail: empty path")
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(h.mediaDir, filePath)

	// Security check
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		log.Printf("[ERROR] Thumbnail: failed to resolve path %s: %v", filePath, err)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	absMediaDir, _ := filepath.Abs(h.mediaDir)
	if !strings.HasPrefix(absPath, absMediaDir) {
		log.Printf("[ERROR] Thumbnail: path outside media dir: %s", filePath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Check if file exists
	fileInfo, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("[WARN] Thumbnail: file not found: %s", fullPath)
			http.Error(w, "File not found", http.StatusNotFound)
		} else {
			log.Printf("[ERROR] Thumbnail: failed to stat file %s: %v", fullPath, err)
			http.Error(w, "Failed to access file", http.StatusInternalServerError)
		}
		return
	}

	if fileInfo.IsDir() {
		log.Printf("[WARN] Thumbnail: path is a directory: %s", fullPath)
		http.Error(w, "Cannot generate thumbnail for directory", http.StatusBadRequest)
		return
	}

	// Check if thumbnails are enabled
	if !h.thumbGen.IsEnabled() {
		log.Printf("[WARN] Thumbnail: thumbnails disabled, returning 503")
		http.Error(w, "Thumbnails disabled", http.StatusServiceUnavailable)
		return
	}

	fileType := h.thumbGen.GetFileType(fullPath)
	if fileType == database.FileTypeOther {
		log.Printf("[WARN] Thumbnail: unsupported file type for %s", filePath)
		http.Error(w, "Unsupported file type", http.StatusBadRequest)
		return
	}

	log.Printf("[DEBUG] Thumbnail: generating for %s (type: %s)", filePath, fileType)

	thumb, err := h.thumbGen.GetThumbnail(fullPath, fileType)
	if err != nil {
		log.Printf("[ERROR] Thumbnail: generation failed for %s: %v", filePath, err)
		http.Error(w, fmt.Sprintf("Failed to generate thumbnail: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[DEBUG] Thumbnail: success for %s (%d bytes)", filePath, len(thumb))

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(thumb)
}

func (h *Handlers) StreamVideo(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filePath := vars["path"]

	fullPath := filepath.Join(h.mediaDir, filePath)

	// Security check
	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Get target width from query param
	targetWidth := 0
	if widthStr := r.URL.Query().Get("width"); widthStr != "" {
		targetWidth, _ = strconv.Atoi(widthStr)
	}

	// Get video info
	info, err := h.transcoder.GetVideoInfo(fullPath)
	if err != nil {
		http.Error(w, "Failed to get video info", http.StatusInternalServerError)
		return
	}

	// If no transcoding needed, serve directly
	if !info.NeedsTranscode && (targetWidth == 0 || targetWidth >= info.Width) {
		http.ServeFile(w, r, fullPath)
		return
	}

	// Stream with transcoding
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Transfer-Encoding", "chunked")

	h.transcoder.StreamVideo(r.Context(), fullPath, w, targetWidth)
}

func (h *Handlers) GetStreamInfo(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filePath := vars["path"]

	fullPath := filepath.Join(h.mediaDir, filePath)

	// Security check
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
