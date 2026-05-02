package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"media-viewer/internal/logging"

	"github.com/gorilla/mux"
)

// CreateHLSSession creates (or returns an existing) HLS transcoding session
// for the requested video file.
//
// POST /api/hls/session
// Request body (JSON): {"path": "folder/video.mkv", "width": 0}
// Response body (JSON): {"sessionId": "abcdef0123456789", "playlistUrl": "/api/hls/abcdef0123456789/playlist.m3u8"}
//
// The session ID is a stable 16-hex-character hash of (sourcePath, targetWidth).
// Clients should supply the returned playlistUrl directly to hls.js.
func (h *Handlers) CreateHLSSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		Path  string `json:"path"`
		Width int    `json:"width"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.Path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}

	// Resolve and validate source path.
	fullPath := pathForFS(h.mediaDir, req.Path)
	absPath, err := filepath.Abs(fullPath)
	if err != nil || !isSubPath(h.mediaDir, absPath) {
		logging.Warn("CreateHLSSession: invalid path %s", req.Path)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	retryConfig := DefaultNFSRetryConfig()
	if _, err := StatWithRetry(fullPath, retryConfig); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "File not found", http.StatusNotFound)
		} else {
			http.Error(w, "Failed to access file", http.StatusInternalServerError)
		}
		return
	}

	info, err := h.transcoder.GetVideoInfo(ctx, fullPath)
	if err != nil {
		logging.Error("CreateHLSSession: GetVideoInfo failed for %s: %v", fullPath, err)
		http.Error(w, "Failed to get video info", http.StatusInternalServerError)
		return
	}

	session, err := h.transcoder.GetOrCreateHLSSession(ctx, fullPath, req.Width, info)
	if err != nil {
		logging.Error("CreateHLSSession: %v", err)
		http.Error(w, "Failed to create HLS session", http.StatusInternalServerError)
		return
	}

	logging.Debug("CreateHLSSession: session %s for %s (width=%d)", session.ID, req.Path, req.Width)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{
		responseKeySessionID: session.ID,
		"playlistUrl":        "/api/hls/" + session.ID + "/playlist.m3u8",
	})
}

// GetHLSPlaylist serves the HLS master playlist for an active session.
//
// GET /api/hls/{sessionId:[0-9a-f]+}/playlist.m3u8
//
// The handler waits up to 30 s for the first segment to be written before
// returning the playlist so that hls.js can begin buffering immediately.
// Subsequent polls by hls.js are served directly from disk (Content-Type:
// application/vnd.apple.mpegurl, Cache-Control: no-cache).
func (h *Handlers) GetHLSPlaylist(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := mux.Vars(r)["sessionId"]

	session := h.transcoder.GetHLSSession(sessionID)
	if session == nil {
		http.Error(w, "HLS session not found", http.StatusNotFound)
		return
	}
	session.Touch()

	// Wait for at least 2 segments so the player starts with a buffer and does
	// not stall while the encoder catches up to real-time playback speed.
	if err := session.WaitForPlaylist(ctx, 2, 30*time.Second); err != nil {
		logging.Error("GetHLSPlaylist: session %s not ready: %v", sessionID, err)
		http.Error(w, "Playlist not ready", http.StatusServiceUnavailable)
		return
	}

	// Prevent caching of the playlist — it grows as ffmpeg appends segments.
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	http.ServeFile(w, r, session.PlaylistPath())
}

// GetHLSSegment serves a single MPEG-TS segment for an active session.
//
// GET /api/hls/{sessionId:[0-9a-f]+}/seg{index:[0-9]+}.ts
//
// Segments that have not been written yet are waited on (up to 60 s) so that
// clients advancing through the video do not get spurious 404s.
// Once written, a segment is immutable; it is served with a long-lived
// Cache-Control header.
func (h *Handlers) GetHLSSegment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	sessionID := vars["sessionId"]
	indexStr := vars["index"]

	index, err := strconv.Atoi(indexStr)
	if err != nil || index < 0 {
		http.Error(w, "Invalid segment index", http.StatusBadRequest)
		return
	}

	session := h.transcoder.GetHLSSession(sessionID)
	if session == nil {
		http.Error(w, "HLS session not found", http.StatusNotFound)
		return
	}
	session.Touch()

	segPath, err := session.WaitForSegment(ctx, index, 60*time.Second)
	if err != nil {
		if errors.Is(err, ctx.Err()) {
			// Client disconnected or server shutting down — no response needed.
			return
		}
		logging.Warn("GetHLSSegment: segment %d not available for session %s: %v", index, sessionID, err)
		http.Error(w, "Segment not found", http.StatusNotFound)
		return
	}

	// Segments are immutable once written; allow aggressive caching.
	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Cache-Control", "max-age=31536000, immutable")
	http.ServeFile(w, r, segPath)
}
