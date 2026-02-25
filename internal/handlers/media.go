package handlers

import (
	"crypto/md5" //nolint:gosec // MD5 used for cache key generation, not security
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"media-viewer/internal/database"
	"media-viewer/internal/logging"

	"github.com/gorilla/mux"
)

// decodePath extracts the "path" variable from the request's mux vars.
//
// gorilla/mux automatically URL-decodes path variables. This single decode
// is sufficient for most filenames. For filenames containing literal percent
// characters on disk (e.g. "file%21.jpg"), the frontend should double-encode
// the path so that mux's decode produces the literal form.
//
// This function detects potential encoding issues and logs warnings to help
// track frontend encoding consistency.
func decodePath(_ http.ResponseWriter, r *http.Request) (string, bool) {
	path := mux.Vars(r)["path"]

	logging.Debug("decodePath: path=%q (request URI: %s)", path, r.URL.RequestURI())

	// Detect if the mux var still contains percent-encoding sequences.
	// This indicates the frontend double-encoded the path (correct behavior
	// for filenames with literal percent characters). Log at debug level
	// since this is the expected path for such files.
	if strings.Contains(path, "%") {
		logging.Debug("decodePath: path contains percent-encoding after mux decode — "+
			"filename likely contains literal '%%' characters: path=%q (request: %s)",
			path, r.URL.RequestURI())
	}

	return path, true
}

// pathForFS attempts to find the correct filesystem path when filenames may
// contain literal percent-encoded characters (e.g. "file%21.jpg" on disk).
//
// gorilla/mux decodes path vars, so a file literally named "file%21.jpg"
// arrives as "file!.jpg" after mux's decode. This function tries the
// mux-decoded path first, and if it doesn't exist, re-encodes special
// characters and tries again.
//
// Returns the path that exists on disk (joined with mediaDir), or the
// original mux-decoded path if neither form exists (letting the caller
// handle the 404).
func pathForFS(mediaDir, muxPath string) string {
	// Try the mux-decoded path first (handles normal filenames)
	fullPath := filepath.Join(mediaDir, muxPath)
	//nolint:gosec // G304 — callers validate the returned path via isSubPath before use
	if _, err := os.Stat(fullPath); err == nil {
		return fullPath
	}

	// Try URL-encoding the path back (handles filenames with literal %XX on disk)
	// We encode each path segment individually to preserve directory separators.
	encodedPath := reEncodePath(muxPath)

	if encodedPath != muxPath {
		encodedFullPath := filepath.Join(mediaDir, encodedPath)
		//nolint:gosec // G304 — callers validate the returned path via isSubPath before use
		if _, err := os.Stat(encodedFullPath); err == nil {
			logging.Warn("pathForFS: file found using re-encoded path — the frontend may be "+
				"single-encoding a filename that contains literal percent characters. "+
				"mux-decoded=%q re-encoded=%q (filesystem match: %q). "+
				"The frontend should double-encode these paths so mux decoding produces the literal form.",
				muxPath, encodedPath, encodedFullPath)
			return encodedFullPath
		}
	}

	// Neither found — return original, let caller handle the error
	return fullPath
}

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

	// Generate ETag based on directory state for HTTP caching
	// Include: path, sort, filter, page, pageSize, count, and latest modification time
	lastModTime := int64(0)
	for i := range listing.Items {
		if listing.Items[i].ModTime.Unix() > lastModTime {
			lastModTime = listing.Items[i].ModTime.Unix()
		}
	}

	// Include tag state in ETag so tag changes invalidate the cache.
	// Build a lightweight tag fingerprint from the items in this page.
	var tagFingerprint strings.Builder
	for i := range listing.Items {
		if len(listing.Items[i].Tags) > 0 {
			tagFingerprint.WriteString(listing.Items[i].Path + ":" + strings.Join(listing.Items[i].Tags, ",") + ";")
		}
	}

	etagData := fmt.Sprintf("%s_%s_%s_%s_%d_%d_%d_%d_%d_%s",
		opts.Path, opts.SortField, opts.SortOrder, opts.FilterType,
		opts.Page, opts.PageSize, listing.TotalItems, len(listing.Items), lastModTime,
		tagFingerprint.String())
	etag := fmt.Sprintf(`"%x"`, md5.Sum([]byte(etagData))) //nolint:gosec // MD5 used for cache key generation, not security
	// Set cache headers
	// Use "private" since response may include user-specific data
	// no-cache ensures the client always revalidates the cache
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", etag)

	// Check If-None-Match header for conditional request
	clientETag := r.Header.Get("If-None-Match")
	if clientETag != "" && clientETag == etag {
		logging.Debug("ListFiles: 304 Not Modified for %s (ETag match: %s)", opts.Path, etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	// Return full response
	logging.Debug("ListFiles: serving %s (%d items, ETag: %s)", opts.Path, len(listing.Items), etag)
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

	// Generate ETag based on directory state for HTTP caching
	// Include: path, sort params, file count, and latest modification time
	// This ensures the ETag changes when directory contents change
	lastModTime := int64(0)
	for i := range files {
		if files[i].ModTime.Unix() > lastModTime {
			lastModTime = files[i].ModTime.Unix()
		}
	}

	var tagFingerprint strings.Builder
	for i := range files {
		if len(files[i].Tags) > 0 {
			tagFingerprint.WriteString(files[i].Path + ":" + strings.Join(files[i].Tags, ",") + ";")
		}
	}

	etagData := fmt.Sprintf("%s_%s_%s_%d_%d_%s",
		parentPath, sortField, sortOrder, len(files), lastModTime,
		tagFingerprint.String())
	etag := fmt.Sprintf(`"%x"`, md5.Sum([]byte(etagData))) //nolint:gosec // MD5 used for cache key generation, not security
	// Set cache headers
	// Use "private" since response includes user-specific data (favorites)
	// no-cache ensures the client always revalidates the cache
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", etag)

	// Check If-None-Match header for conditional request
	clientETag := r.Header.Get("If-None-Match")
	if clientETag != "" && clientETag == etag {
		logging.Debug("GetMediaFiles: 304 Not Modified for %s (ETag match: %s)", parentPath, etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	// Return full response
	logging.Debug("GetMediaFiles: serving %s (%d files, ETag: %s)", parentPath, len(files), etag)
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, files)
}

// GetFile serves a file from the media directory
func (h *Handlers) GetFile(w http.ResponseWriter, r *http.Request) {
	filePath, ok := decodePath(w, r)
	if !ok {
		return
	}

	// Reject absolute paths before joining
	if filepath.IsAbs(filePath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Resolve the filesystem path, handling filenames with literal percent-encoding
	fullPath := pathForFS(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Check if download=true query parameter is present
	if r.URL.Query().Get("download") == "true" {
		// Set Content-Disposition header to force download
		filename := filepath.Base(fullPath)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	}

	// Check if client has disconnected before opening file
	select {
	case <-r.Context().Done():
		logging.Debug("Client disconnected before file open: %s", filePath)
		return
	default:
	}

	http.ServeFile(w, r, fullPath)
}

// validateThumbnailPath validates and resolves the thumbnail file path from the request.
// Returns the relative filePath and absolute fullPath, or writes an HTTP error and returns empty strings.
func (h *Handlers) validateThumbnailPath(w http.ResponseWriter, r *http.Request) (filePath, fullPath string, ok bool) {
	filePath, ok = decodePath(w, r)
	if !ok {
		return "", "", false
	}

	if filePath == "" {
		logging.Error("Thumbnail: empty path")
		http.Error(w, "Path is required", http.StatusBadRequest)
		return "", "", false
	}

	if filepath.IsAbs(filePath) {
		logging.Error("Thumbnail: absolute path not allowed: %s", filePath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return "", "", false
	}

	fullPath = filepath.Join(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		logging.Error("Thumbnail: failed to resolve path %s: %v", filePath, err)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return "", "", false
	}

	absMediaDir, _ := filepath.Abs(h.mediaDir)
	if !strings.HasPrefix(absPath, absMediaDir) {
		logging.Error("Thumbnail: path outside media dir: %s", filePath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return "", "", false
	}

	return filePath, fullPath, true
}

// validateThumbnailFileOnDisk checks that a non-folder file exists on disk and is not a directory.
// Returns true if valid, or writes an HTTP error and returns false.
func (h *Handlers) validateThumbnailFileOnDisk(w http.ResponseWriter, _, fullPath string) bool {
	retryConfig := DefaultNFSRetryConfig()
	fileInfo, err := StatWithRetry(fullPath, retryConfig)
	if err != nil {
		if os.IsNotExist(err) {
			logging.Warn("Thumbnail: file not found: %s", fullPath)
			http.Error(w, "File not found", http.StatusNotFound)
		} else {
			logging.Error("Thumbnail: failed to stat file %s: %v", fullPath, err)
			http.Error(w, "Failed to access file", http.StatusInternalServerError)
		}
		return false
	}

	if fileInfo.IsDir() {
		logging.Warn("Thumbnail: path is a directory but not marked as folder in DB: %s", fullPath)
		http.Error(w, "Invalid file type", http.StatusBadRequest)
		return false
	}

	return true
}

// isThumbnailSupported checks whether the given file type supports thumbnail generation.
// Returns true if supported, or writes an HTTP error and returns false.
func isThumbnailSupported(w http.ResponseWriter, filePath string, fileType database.FileType) bool {
	switch fileType {
	case database.FileTypeImage, database.FileTypeVideo, database.FileTypeFolder:
		return true
	default:
		logging.Warn("Thumbnail: unsupported file type %s for %s", fileType, filePath)
		http.Error(w, "Unsupported file type", http.StatusBadRequest)
		return false
	}
}

// writeThumbnailResponse sets caching headers, handles conditional requests, validates
// the thumbnail data, and writes it to the response.
func writeThumbnailResponse(w http.ResponseWriter, r *http.Request, filePath string, fileType database.FileType, thumb []byte) {
	etag := fmt.Sprintf(`"%x"`, md5.Sum(thumb)) //nolint:gosec // MD5 used for cache key generation, not security

	// Set content type based on file type
	if fileType == database.FileTypeFolder {
		w.Header().Set("Content-Type", "image/png")
	} else {
		w.Header().Set("Content-Type", "image/jpeg")
	}

	// Prevent browsers from MIME-sniffing the response into an executable type (XSS mitigation)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'")

	// Cache headers - shorter cache for folders since they can change
	if fileType == database.FileTypeFolder {
		w.Header().Set("Cache-Control", "public, max-age=300, must-revalidate")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}

	w.Header().Set("ETag", etag)

	// Check If-None-Match header for 304 Not Modified
	if clientETag := r.Header.Get("If-None-Match"); clientETag != "" {
		if clientETag == etag {
			logging.Debug("Thumbnail: 304 Not Modified for %s (ETag match: %s)", filePath, etag)
			w.WriteHeader(http.StatusNotModified)
			return
		}
		logging.Debug("Thumbnail: ETag mismatch for %s (client: %s, server: %s)", filePath, clientETag, etag)
	} else {
		logging.Debug("Thumbnail: serving %s (%d bytes, ETag: %s, no If-None-Match from client)", filePath, len(thumb), etag)
	}

	// Validate thumbnail data
	if len(thumb) == 0 {
		logging.Error("Thumbnail: empty thumbnail, not writing response")
		return
	}

	if !isValidImageHeader(thumb) {
		logging.Error("Thumbnail: invalid image format, not writing response")
		return
	}

	//nolint:gosec // G705: thumb is validated above — isValidImageHeader confirms JPEG/PNG magic bytes,
	// Content-Type is explicitly set to image/jpeg or image/png, and X-Content-Type-Options: nosniff
	// prevents browser MIME-sniffing. This is safe binary image data, not user-controlled text.
	if _, err := w.Write(thumb); err != nil {
		logging.Error("failed to write thumbnail response: %v", err)
	}
}

// isValidImageHeader checks if the byte slice starts with a known image format header (JPEG or PNG).
func isValidImageHeader(data []byte) bool {
	// PNG: 8-byte header
	if len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n" {
		return true
	}
	// JPEG: starts with FF D8
	if len(data) >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
		return true
	}
	return false
}

// reEncodePath reconstructs the percent-encoded form of a path that was
// decoded by gorilla/mux. This is used to match filenames that contain
// literal percent-encoded characters on disk (e.g., "file%2BWhales.jpg"
// where %2B is part of the actual filename, not a URL-encoded plus sign).
//
// It encodes each path segment using url.PathEscape, plus additional
// characters that PathEscape considers safe but encodeURIComponent
// (used by the frontend) would encode. This ensures we can reconstruct
// the original filename as stored in the database and filesystem.
func reEncodePath(path string) string {
	parts := strings.Split(path, "/")
	for i, part := range parts {
		parts[i] = encodePathSegment(part)
	}
	return strings.Join(parts, "/")
}

// encodePathSegment percent-encodes a path segment to match the behavior
// of JavaScript's encodeURIComponent. url.PathEscape does not encode
// characters like +, ', !, (, ), * which are valid in URL paths but may
// appear as literal percent-encoded sequences in filenames.
func encodePathSegment(s string) string {
	// Start with Go's PathEscape which handles most characters
	encoded := url.PathEscape(s)

	// Additionally encode characters that url.PathEscape leaves alone
	// but JavaScript's encodeURIComponent would encode.
	// These characters are valid in URL paths but when they appear in
	// a filename, they may have been the result of mux decoding a
	// percent-encoded sequence (e.g., %2B decoded to +).
	replacer := strings.NewReplacer(
		"+", "%2B",
		"'", "%27",
		"!", "%21",
		"(", "%28",
		")", "%29",
		"*", "%2A",
		"@", "%40",
		"#", "%23",
	)
	return replacer.Replace(encoded)
}

// GetThumbnail returns a thumbnail image for a media file
func (h *Handlers) GetThumbnail(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	filePath, fullPath, ok := h.validateThumbnailPath(w, r)
	if !ok {
		return
	}

	logging.Debug("Thumbnail requested: %s", filePath)

	if !h.thumbGen.IsEnabled() {
		logging.Warn("Thumbnail: thumbnails disabled, returning 503")
		http.Error(w, "Thumbnails disabled", http.StatusServiceUnavailable)
		return
	}

	// Get file info from database to determine type.
	// Try the mux-decoded path first, then the re-encoded form for filenames
	// with literal percent-encoding on disk (e.g. "file%2BWhales.jpg").
	file, err := h.db.GetFileByPath(ctx, filePath)
	if err != nil {
		encodedPath := reEncodePath(filePath)
		if encodedPath != filePath {
			file, err = h.db.GetFileByPath(ctx, encodedPath)
			if err == nil {
				logging.Debug("Thumbnail: DB lookup succeeded using re-encoded path — "+
					"filename contains characters that were percent-decoded by mux. "+
					"mux-decoded=%q re-encoded=%q (request: %s)",
					filePath, encodedPath, r.URL.RequestURI())
				// Update filePath and fullPath to the re-encoded form so that
				// subsequent filesystem operations find the actual file on disk.
				filePath = encodedPath
				fullPath = filepath.Join(h.mediaDir, encodedPath)
			}
		}
		if err != nil {
			logging.Error("Thumbnail: file not found in database %s: %v", filePath, err)
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
	}

	// Validate file exists on disk (skip for folders as they're handled differently)
	if file.Type != database.FileTypeFolder {
		if !h.validateThumbnailFileOnDisk(w, filePath, fullPath) {
			return
		}
	}

	if !isThumbnailSupported(w, filePath, file.Type) {
		return
	}

	// Generate or retrieve cached thumbnail
	thumb, err := h.thumbGen.GetThumbnail(ctx, fullPath, file.Type)
	if err != nil {
		logging.Error("Thumbnail: generation failed for %s: %v", filePath, err)
		http.Error(w, fmt.Sprintf("Failed to generate thumbnail: %v", err), http.StatusInternalServerError)
		return
	}

	writeThumbnailResponse(w, r, filePath, file.Type, thumb)
}

// StreamVideo streams a video file, transcoding if necessary for browser compatibility
func (h *Handlers) StreamVideo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	filePath, ok := decodePath(w, r)
	if !ok {
		return
	}

	logging.Debug("StreamVideo request: path=%s, queryWidth=%s", filePath, r.URL.Query().Get("width"))

	// Reject absolute paths before joining
	if filepath.IsAbs(filePath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Resolve the filesystem path, handling filenames with literal percent-encoding
	fullPath := pathForFS(h.mediaDir, filePath)

	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		logging.Warn("StreamVideo: Invalid path attempted: %s", filePath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	retryConfig := DefaultNFSRetryConfig()
	if _, err := StatWithRetry(fullPath, retryConfig); err != nil {
		if os.IsNotExist(err) {
			logging.Warn("StreamVideo: File not found: %s", fullPath)
			http.Error(w, "File not found", http.StatusNotFound)
		} else {
			logging.Error("StreamVideo: Failed to access file %s: %v", fullPath, err)
			http.Error(w, "Failed to access file", http.StatusInternalServerError)
		}
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

	if !info.NeedsTranscode && (targetWidth == 0 || targetWidth >= info.Width) {
		logging.Debug("StreamVideo: Using ServeFile for %s (no transcode needed)", fullPath)
		http.ServeFile(w, r, fullPath)
		return
	}

	logging.Info("StreamVideo: Transcoding required for %s", fullPath)

	cachePath, err := h.transcoder.GetOrStartTranscodeAndWait(ctx, fullPath, targetWidth, info)
	if err != nil {
		logging.Error("Failed to prepare transcode %s: %v", filePath, err)
		http.Error(w, "Failed to prepare video", http.StatusInternalServerError)
		return
	}

	logging.Info("Serving cached video: %s", cachePath)
	http.ServeFile(w, r, cachePath)
}

// GetStreamInfo returns codec and dimension information about a video file
func (h *Handlers) GetStreamInfo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	filePath, ok := decodePath(w, r)
	if !ok {
		return
	}

	// Resolve the filesystem path, handling filenames with literal percent-encoding
	fullPath := pathForFS(h.mediaDir, filePath)

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

	// Include cache sizes and file counts
	if thumbnailSize, thumbnailCount, err := h.thumbGen.GetCacheSize(); err == nil {
		stats.ThumbnailCacheBytes = thumbnailSize
		stats.ThumbnailCacheFiles = thumbnailCount
	}
	if transcodeSize, transcodeCount, err := h.transcoder.GetCacheSize(); err == nil {
		stats.TranscodeCacheBytes = transcodeSize
		stats.TranscodeCacheFiles = transcodeCount
	}

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
	filePath, ok := decodePath(w, r)
	if !ok {
		return
	}

	if filePath == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	// Resolve the filesystem path, handling filenames with literal percent-encoding
	fullPath := pathForFS(h.mediaDir, filePath)

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
