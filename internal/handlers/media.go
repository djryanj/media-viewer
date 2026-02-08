package handlers

import (
	"crypto/md5" //nolint:gosec // MD5 used for cache key generation, not security
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
	ctx := r.Context()
	logging.Debug("ListFiles called: %s", r.URL.String())

	opts := database.ListOptions{
		Path:       r.URL.Query().Get("path"),
		SortField:  database.SortField(r.URL.Query().Get("sort")),
		SortOrder:  database.SortOrder(r.URL.Query().Get("order")),
		FilterType: r.URL.Query().Get("type"),
		Page:       1,
		PageSize:   50, // Match frontend infinite scroll batch size
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

	listing, err := h.db.ListDirectory(ctx, opts)
	if err != nil {
		logging.Error("ListFiles database error: %v", err)
		http.Error(w, "Failed to list directory", http.StatusInternalServerError)
		return
	}

	// Ensure Items is an empty array, not null in JSON
	if listing.Items == nil {
		listing.Items = []database.MediaFile{}
	}

	logging.Debug("ListFiles completed, found %d items", len(listing.Items))

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, listing)
}

// GetMediaFiles returns all media files (images and videos) in a directory for lightbox viewing
func (h *Handlers) GetMediaFiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
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

	files, err := h.db.GetMediaInDirectory(ctx, parentPath, sortField, sortOrder)
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

	// Reject absolute paths before joining
	if filepath.IsAbs(filePath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Check if download=true query parameter is present
	if r.URL.Query().Get("download") == "true" {
		// Set Content-Disposition header to force download
		filename := filepath.Base(filePath)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	}

	http.ServeFile(w, r, fullPath)
}

// GetThumbnail returns a thumbnail image for a media file
func (h *Handlers) GetThumbnail(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	filePath := vars["path"]

	logging.Debug("Thumbnail requested: %s", filePath)

	if filePath == "" {
		logging.Error("Thumbnail: empty path")
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	// Reject absolute paths before joining
	if filepath.IsAbs(filePath) {
		logging.Error("Thumbnail: absolute path not allowed: %s", filePath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
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
	file, err := h.db.GetFileByPath(ctx, filePath)
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

	// Generate or retrieve cached thumbnail
	thumb, err := h.thumbGen.GetThumbnail(ctx, fullPath, file.Type)
	if err != nil {
		logging.Error("Thumbnail: generation failed for %s: %v", filePath, err)
		http.Error(w, fmt.Sprintf("Failed to generate thumbnail: %v", err), http.StatusInternalServerError)
		return
	}

	// Calculate ETag first (needed for conditional request check)
	etag := fmt.Sprintf(`"%x"`, md5.Sum(thumb)) //nolint:gosec // MD5 used for cache key generation, not security

	// Set headers that apply to both 200 and 304 responses
	// These must be set before writing status code

	// Content type
	if file.Type == database.FileTypeFolder {
		w.Header().Set("Content-Type", "image/png")
	} else {
		w.Header().Set("Content-Type", "image/jpeg")
	}

	// Cache headers - shorter cache for folders since they can change
	if file.Type == database.FileTypeFolder {
		// Folders: cache for 5 minutes, must revalidate
		w.Header().Set("Cache-Control", "public, max-age=300, must-revalidate")
	} else {
		// Files: cache for 24 hours
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}

	// ETag for conditional requests
	w.Header().Set("ETag", etag)

	// Check If-None-Match header for 304 Not Modified
	clientETag := r.Header.Get("If-None-Match")
	if clientETag != "" {
		if clientETag == etag {
			logging.Debug("Thumbnail: 304 Not Modified for %s (ETag match: %s)", filePath, etag)
			w.WriteHeader(http.StatusNotModified)
			return
		}
		logging.Debug("Thumbnail: ETag mismatch for %s (client: %s, server: %s)", filePath, clientETag, etag)
	} else {
		logging.Debug("Thumbnail: serving %s (%d bytes, ETag: %s, no If-None-Match from client)", filePath, len(thumb), etag)
	}

	if _, err := w.Write(thumb); err != nil {
		logging.Error("failed to write thumbnail response: %v", err)
	}
}

// StreamVideo streams a video file, transcoding if necessary for browser compatibility
func (h *Handlers) StreamVideo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	filePath := vars["path"]

	logging.Debug("StreamVideo request: path=%s, queryWidth=%s", filePath, r.URL.Query().Get("width"))

	// Reject absolute paths before joining
	if filepath.IsAbs(filePath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		logging.Warn("StreamVideo: Invalid path attempted: %s", filePath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		logging.Warn("StreamVideo: File not found: %s", fullPath)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	targetWidth := 0
	if widthStr := r.URL.Query().Get("width"); widthStr != "" {
		targetWidth, _ = strconv.Atoi(widthStr)
	}

	info, err := h.transcoder.GetVideoInfo(ctx, fullPath)
	if err != nil {
		logging.Error("StreamVideo: Failed to get video info for %s: %v", fullPath, err)
		http.Error(w, "Failed to get video info", http.StatusInternalServerError)
		return
	}

	// For direct file serving (no transcoding needed), use standard ServeFile
	// which handles range requests properly
	if !info.NeedsTranscode && (targetWidth == 0 || targetWidth >= info.Width) {
		logging.Debug("StreamVideo: Using ServeFile for %s (no transcode needed)", fullPath)
		http.ServeFile(w, r, fullPath)
		return
	}

	// For transcoding, check if already cached for fast serving
	logging.Info("StreamVideo: Transcoding required for %s", fullPath)

	cachePath, err := h.transcoder.GetOrStartTranscodeAndWait(ctx, fullPath, targetWidth, info)
	if err != nil {
		logging.Error("Failed to prepare transcode %s: %v", filePath, err)
		http.Error(w, "Failed to prepare video", http.StatusInternalServerError)
		return
	}

	// Serve the cache file (complete or being written to)
	// ServeFile handles Range requests and works fine with growing files
	logging.Info("Serving cached video: %s", cachePath)
	http.ServeFile(w, r, cachePath)
}

// GetStreamInfo returns codec and dimension information about a video file
func (h *Handlers) GetStreamInfo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	filePath := vars["path"]

	fullPath := filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	info, err := h.transcoder.GetVideoInfo(ctx, fullPath)
	if err != nil {
		http.Error(w, "Failed to get video info", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, info)
}

// GetStats returns current library statistics
func (h *Handlers) GetStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	stats := h.db.GetStats()
	stats.TotalFavorites = h.db.GetFavoriteCount(ctx)
	stats.TotalTags = h.db.GetTagCount(ctx)

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

	// TriggerIndex starts a background goroutine that manages its own context
	// The indexing operation should continue even if the HTTP request completes
	//nolint:contextcheck // Intentionally not passing request context - indexing runs in background
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

	// Ensure paths end with separator for accurate comparison
	if !strings.HasSuffix(parent, string(filepath.Separator)) {
		parent += string(filepath.Separator)
	}

	return strings.HasPrefix(child+string(filepath.Separator), parent)
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

	// RebuildAll starts a background goroutine that manages its own context
	// The rebuild operation should continue even if the HTTP request completes
	//nolint:contextcheck // Intentionally not passing request context - rebuild runs in background
	h.thumbGen.RebuildAll()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
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

// ListFilePaths returns lightweight path/name/type data for all files in a directory
// Used for bulk selection operations where full file data isn't needed
func (h *Handlers) ListFilePaths(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logging.Debug("ListFilePaths called: %s", r.URL.String())

	opts := database.ListOptions{
		Path:       r.URL.Query().Get("path"),
		SortField:  database.SortField(r.URL.Query().Get("sort")),
		SortOrder:  database.SortOrder(r.URL.Query().Get("order")),
		FilterType: r.URL.Query().Get("type"),
		Page:       1,
		PageSize:   100000, // Effectively unlimited - get all items
	}

	if opts.SortField == "" {
		opts.SortField = database.SortByName
	}
	if opts.SortOrder == "" {
		opts.SortOrder = database.SortAsc
	}

	logging.Debug("ListFilePaths options: path=%q, sort=%s, order=%s, filter=%s",
		opts.Path, opts.SortField, opts.SortOrder, opts.FilterType)

	listing, err := h.db.ListDirectory(ctx, opts)
	if err != nil {
		logging.Error("ListFilePaths database error: %v", err)
		http.Error(w, "Failed to list directory", http.StatusInternalServerError)
		return
	}

	// Build lightweight response with only path, name, type
	type FilePathInfo struct {
		Path string `json:"path"`
		Name string `json:"name"`
		Type string `json:"type"`
	}

	items := make([]FilePathInfo, 0, len(listing.Items))
	for _, item := range listing.Items {
		items = append(items, FilePathInfo{
			Path: item.Path,
			Name: item.Name,
			Type: string(item.Type),
		})
	}

	response := struct {
		Items      []FilePathInfo `json:"items"`
		TotalItems int            `json:"totalItems"`
	}{
		Items:      items,
		TotalItems: listing.TotalItems,
	}

	logging.Debug("ListFilePaths completed, found %d items", len(items))

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, response)
}
