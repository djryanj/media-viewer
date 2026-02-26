package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"

	"github.com/gorilla/mux"
)

// =============================================================================
// Integration test helpers
// =============================================================================

// setupHLSIntegrationTest creates a *Handlers with the transcoder *enabled*.
// The caller is responsible for mocking ffprobe/ffmpeg in PATH as needed.
func setupHLSIntegrationTest(t *testing.T) (h *Handlers, mediaDir, cacheDir string) {
	t.Helper()

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")
	mediaDir = filepath.Join(tempDir, "media")
	cacheDir = filepath.Join(tempDir, "cache")

	for _, d := range []string{mediaDir, cacheDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", d, err)
		}
	}

	db, _, err := database.New(context.Background(), dbPath, &database.Options{})
	if err != nil {
		t.Fatalf("database.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	idx := indexer.New(db, mediaDir, 0)
	trans := transcoder.New(cacheDir, "", true /* enabled */, "none")
	thumbGen := media.NewThumbnailGenerator(cacheDir, mediaDir, false, db, 0, nil)
	cfg := &startup.Config{MediaDir: mediaDir, CacheDir: cacheDir}

	return New(db, idx, trans, thumbGen, cfg), mediaDir, cacheDir
}

// writeMockFFProbe writes a mock ffprobe script that returns a HEVC/1080p
// video response so GetVideoInfo marks the file as needing transcoding.
func writeMockFFProbe(t *testing.T, binDir string) {
	t.Helper()

	script := "#!/bin/sh\n" +
		`printf '{"streams":[{"codec_name":"hevc","width":1920,"height":1080}],"format":{"duration":"10.0"}}\n'` + "\n"

	p := filepath.Join(binDir, "ffprobe")
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		t.Fatalf("write mock ffprobe: %v", err)
	}
}

// writeMockFFMpegHLS writes a mock ffmpeg script that writes a minimal valid
// HLS playlist and one segment into the session directory.
// The session directory is deduced from the playlist.m3u8 argument.
func writeMockFFMpegHLS(t *testing.T, binDir string) {
	t.Helper()

	script := `#!/bin/sh
# Find the playlist output path (last .m3u8 argument).
PLAYLIST=""
for arg in "$@"; do
    case "$arg" in
        *.m3u8) PLAYLIST="$arg" ;;
    esac
done

if [ -n "$PLAYLIST" ]; then
    SEGDIR=$(dirname "$PLAYLIST")
    mkdir -p "$SEGDIR"
    printf 'FAKE TS DATA\n' > "${SEGDIR}/seg0.ts"
    printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.000000,\nseg0.ts\n#EXT-X-ENDLIST\n' > "$PLAYLIST"
fi
`
	p := filepath.Join(binDir, "ffmpeg")
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		t.Fatalf("write mock ffmpeg: %v", err)
	}
}

// =============================================================================
// CreateHLSSession integration tests
// =============================================================================

// TestCreateHLSSessionIntegration posts a valid request with a real file on
// disk and mock ffprobe/ffmpeg in PATH.  Expects 200 with sessionId in JSON.
func TestCreateHLSSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	h, mediaDir, _ := setupHLSIntegrationTest(t)

	// Create a dummy video file.
	videoPath := filepath.Join(mediaDir, "test.mkv")
	if err := os.WriteFile(videoPath, []byte("fake video data"), 0o644); err != nil {
		t.Fatalf("create video file: %v", err)
	}

	// Install mock binaries.
	binDir := t.TempDir()
	writeMockFFProbe(t, binDir)
	writeMockFFMpegHLS(t, binDir)

	oldPath := os.Getenv("PATH")
	defer func() { _ = os.Setenv("PATH", oldPath) }()
	_ = os.Setenv("PATH", binDir+":"+oldPath)

	body, _ := json.Marshal(map[string]interface{}{"path": "test.mkv", "width": 0})
	req := httptest.NewRequest(http.MethodPost, "/api/hls/session", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.CreateHLSSession(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp["sessionId"] == "" {
		t.Error("response missing sessionId")
	}
	if !strings.HasPrefix(resp["playlistUrl"], "/api/hls/") {
		t.Errorf("unexpected playlistUrl: %q", resp["playlistUrl"])
	}
}

// TestCreateHLSSession_DisabledTranscoderIntegration verifies that a file that
// exists on disk but has a disabled transcoder returns 500.
func TestCreateHLSSession_DisabledTranscoderIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	// Use the disabled-transcoder setup.
	h, mediaDir := setupHLSHandlerTest(t)

	videoPath := filepath.Join(mediaDir, "test.mkv")
	if err := os.WriteFile(videoPath, []byte("fake video data"), 0o644); err != nil {
		t.Fatalf("create video file: %v", err)
	}

	binDir := t.TempDir()
	writeMockFFProbe(t, binDir)

	oldPath := os.Getenv("PATH")
	defer func() { _ = os.Setenv("PATH", oldPath) }()
	_ = os.Setenv("PATH", binDir+":"+oldPath)

	body, _ := json.Marshal(map[string]interface{}{"path": "test.mkv", "width": 0})
	req := httptest.NewRequest(http.MethodPost, "/api/hls/session", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.CreateHLSSession(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("disabled transcoder: want 500, got %d", w.Code)
	}
}

// =============================================================================
// GetHLSPlaylist integration tests
// =============================================================================

// TestGetHLSPlaylist_ReadySessionIntegration creates a real session, waits for
// the mock ffmpeg to write the playlist, then requests the playlist and expects
// a 200 response with the correct Content-Type.
func TestGetHLSPlaylist_ReadySessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	h, mediaDir, _ := setupHLSIntegrationTest(t)

	videoPath := filepath.Join(mediaDir, "test.mkv")
	if err := os.WriteFile(videoPath, []byte("fake video data"), 0o644); err != nil {
		t.Fatalf("create video file: %v", err)
	}

	binDir := t.TempDir()
	writeMockFFProbe(t, binDir)
	writeMockFFMpegHLS(t, binDir)

	oldPath := os.Getenv("PATH")
	defer func() { _ = os.Setenv("PATH", oldPath) }()
	_ = os.Setenv("PATH", binDir+":"+oldPath)

	// Create the HLS session.
	createBody, _ := json.Marshal(map[string]interface{}{"path": "test.mkv", "width": 0})
	createReq := httptest.NewRequest(http.MethodPost, "/api/hls/session", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createW := httptest.NewRecorder()
	h.CreateHLSSession(createW, createReq)

	if createW.Code != http.StatusOK {
		t.Fatalf("CreateHLSSession failed: %d — %s", createW.Code, createW.Body.String())
	}

	var createResp map[string]string
	if err := json.Unmarshal(createW.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	sessionID := createResp["sessionId"]

	// Request the playlist – WaitForPlaylist polls until the mock ffmpeg writes it.
	playlistURL := "/api/hls/" + sessionID + "/playlist.m3u8"
	playlistReq := httptest.NewRequest(http.MethodGet, playlistURL, http.NoBody)
	playlistReq = mux.SetURLVars(playlistReq, map[string]string{"sessionId": sessionID})
	playlistW := httptest.NewRecorder()

	h.GetHLSPlaylist(playlistW, playlistReq)

	if playlistW.Code != http.StatusOK {
		t.Errorf("GetHLSPlaylist: want 200, got %d — %s", playlistW.Code, playlistW.Body.String())
	}

	ct := playlistW.Header().Get("Content-Type")
	if !strings.Contains(ct, "mpegurl") {
		t.Errorf("GetHLSPlaylist: want mpegurl Content-Type, got %q", ct)
	}
}

// =============================================================================
// GetHLSSegment integration tests
// =============================================================================

// TestGetHLSSegment_ReadySegmentIntegration creates a real session and requests
// segment 0.  The mock ffmpeg writes seg0.ts so WaitForSegment succeeds.
func TestGetHLSSegment_ReadySegmentIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	h, mediaDir, _ := setupHLSIntegrationTest(t)

	videoPath := filepath.Join(mediaDir, "test.mkv")
	if err := os.WriteFile(videoPath, []byte("fake video data"), 0o644); err != nil {
		t.Fatalf("create video file: %v", err)
	}

	binDir := t.TempDir()
	writeMockFFProbe(t, binDir)
	writeMockFFMpegHLS(t, binDir)

	oldPath := os.Getenv("PATH")
	defer func() { _ = os.Setenv("PATH", oldPath) }()
	_ = os.Setenv("PATH", binDir+":"+oldPath)

	// Create the session.
	createBody, _ := json.Marshal(map[string]interface{}{"path": "test.mkv", "width": 0})
	createReq := httptest.NewRequest(http.MethodPost, "/api/hls/session", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createW := httptest.NewRecorder()
	h.CreateHLSSession(createW, createReq)

	if createW.Code != http.StatusOK {
		t.Fatalf("CreateHLSSession failed: %d — %s", createW.Code, createW.Body.String())
	}

	var createResp map[string]string
	if err := json.Unmarshal(createW.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	sessionID := createResp["sessionId"]

	// Request segment 0 – WaitForSegment polls until mock ffmpeg writes seg0.ts.
	segURL := "/api/hls/" + sessionID + "/seg0.ts"
	segReq := httptest.NewRequest(http.MethodGet, segURL, http.NoBody)
	segReq = mux.SetURLVars(segReq, map[string]string{
		"sessionId": sessionID,
		"index":     "0",
	})
	segW := httptest.NewRecorder()

	h.GetHLSSegment(segW, segReq)

	if segW.Code != http.StatusOK {
		t.Errorf("GetHLSSegment: want 200, got %d — %s", segW.Code, segW.Body.String())
	}

	ct := segW.Header().Get("Content-Type")
	if !strings.Contains(ct, "mp2t") {
		t.Errorf("GetHLSSegment: want mp2t Content-Type, got %q", ct)
	}
}
