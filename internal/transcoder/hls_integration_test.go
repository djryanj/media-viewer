package transcoder

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// =============================================================================
// Integration test helpers
// =============================================================================

// writeMockFFProbeForHLS puts a mock ffprobe script in binDir that returns
// HEVC/1080p video info so GetVideoInfo marks the file as needing transcode.
func writeMockFFProbeForHLS(t *testing.T, binDir string) {
	t.Helper()

	script := "#!/bin/sh\n" +
		`printf '{"streams":[{"codec_name":"hevc","width":1920,"height":1080}],"format":{"duration":"10.0"}}\n'` + "\n"

	p := filepath.Join(binDir, "ffprobe")
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		t.Fatalf("write mock ffprobe: %v", err)
	}
}

// writeMockFFMpegForHLS puts a mock ffmpeg script in binDir that writes a
// minimal valid HLS playlist and one segment into the session directory.
func writeMockFFMpegForHLS(t *testing.T, binDir string) {
	t.Helper()

	script := `#!/bin/sh
# Find the playlist output path (ends with .m3u8).
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

// patchPATH prepends binDir to PATH and restores the original on cleanup.
func patchPATH(t *testing.T, binDir string) {
	t.Helper()

	old := os.Getenv("PATH")
	if err := os.Setenv("PATH", binDir+":"+old); err != nil {
		t.Fatalf("setenv PATH: %v", err)
	}
	t.Cleanup(func() { _ = os.Setenv("PATH", old) })
}

// =============================================================================
// GetOrCreateHLSSession integration tests
// =============================================================================

// TestGetOrCreateHLSSession_CreatesSessionDirIntegration verifies that calling
// GetOrCreateHLSSession on a real source file creates the session directory
// and registers the session in the transcoder's map.
func TestGetOrCreateHLSSession_CreatesSessionDirIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	binDir := t.TempDir()

	writeMockFFProbeForHLS(t, binDir)
	writeMockFFMpegForHLS(t, binDir)
	patchPATH(t, binDir)

	// Create a source file.
	srcPath := filepath.Join(tmpDir, "media", "video.mkv")
	if err := os.MkdirAll(filepath.Dir(srcPath), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(srcPath, []byte("fake video"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	cacheDir := filepath.Join(tmpDir, "cache")
	trans := New(cacheDir, "", true, "none")

	info, err := trans.GetVideoInfo(context.Background(), srcPath)
	if err != nil {
		t.Fatalf("GetVideoInfo: %v", err)
	}

	session, err := trans.GetOrCreateHLSSession(context.Background(), srcPath, 0, info)
	if err != nil {
		t.Fatalf("GetOrCreateHLSSession: %v", err)
	}

	if session.ID == "" {
		t.Error("expected non-empty session ID")
	}
	if _, statErr := os.Stat(session.SessionDir); statErr != nil {
		t.Errorf("session directory not created: %v", statErr)
	}

	// The session must be retrievable by ID.
	found := trans.GetHLSSession(session.ID)
	if found != session {
		t.Error("GetHLSSession did not return the created session")
	}
}

// TestGetOrCreateHLSSession_ReturnsExistingSessionIntegration verifies that
// calling GetOrCreateHLSSession twice for the same file returns the same session
// without re-launching ffmpeg.
func TestGetOrCreateHLSSession_ReturnsExistingSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	binDir := t.TempDir()

	writeMockFFProbeForHLS(t, binDir)
	writeMockFFMpegForHLS(t, binDir)
	patchPATH(t, binDir)

	srcPath := filepath.Join(tmpDir, "video.mkv")
	if err := os.WriteFile(srcPath, []byte("fake data"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	trans := New(filepath.Join(tmpDir, "cache"), "", true, "none")

	info, err := trans.GetVideoInfo(context.Background(), srcPath)
	if err != nil {
		t.Fatalf("GetVideoInfo: %v", err)
	}

	s1, err := trans.GetOrCreateHLSSession(context.Background(), srcPath, 0, info)
	if err != nil {
		t.Fatalf("first GetOrCreateHLSSession: %v", err)
	}
	s2, err := trans.GetOrCreateHLSSession(context.Background(), srcPath, 0, info)
	if err != nil {
		t.Fatalf("second GetOrCreateHLSSession: %v", err)
	}

	if s1 != s2 {
		t.Error("expected the same session to be returned on the second call")
	}
}

// TestGetOrCreateHLSSession_InvalidatesStaleSessionIntegration verifies that a
// session is invalidated when the source file's mtime advances.
func TestGetOrCreateHLSSession_InvalidatesStaleSessionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	binDir := t.TempDir()

	writeMockFFProbeForHLS(t, binDir)
	writeMockFFMpegForHLS(t, binDir)
	patchPATH(t, binDir)

	srcPath := filepath.Join(tmpDir, "video.mkv")
	if err := os.WriteFile(srcPath, []byte("v1 data"), 0o644); err != nil {
		t.Fatalf("write source v1: %v", err)
	}

	trans := New(filepath.Join(tmpDir, "cache"), "", true, "none")

	info, err := trans.GetVideoInfo(context.Background(), srcPath)
	if err != nil {
		t.Fatalf("GetVideoInfo: %v", err)
	}

	s1, err := trans.GetOrCreateHLSSession(context.Background(), srcPath, 0, info)
	if err != nil {
		t.Fatalf("first GetOrCreateHLSSession: %v", err)
	}

	// Advance the source file mtime so the session becomes stale.
	time.Sleep(10 * time.Millisecond) // ensure mtime differs
	if err := os.WriteFile(srcPath, []byte("v2 data"), 0o644); err != nil {
		t.Fatalf("write source v2: %v", err)
	}

	s2, err := trans.GetOrCreateHLSSession(context.Background(), srcPath, 0, info)
	if err != nil {
		t.Fatalf("second GetOrCreateHLSSession: %v", err)
	}

	if s1 == s2 {
		t.Error("expected a new session after source mtime advanced")
	}
	if s1.ID != s2.ID {
		// Session ID is deterministic for path+width; the new session shares the ID
		// but is a different *HLSSession pointer.
		t.Logf("note: session IDs are the same (%s) as expected for same path+width", s1.ID)
	}
}

// =============================================================================
// WaitForPlaylist integration: mock ffmpeg writes files in time
// =============================================================================

// TestWaitForPlaylist_AfterMockFFmpegIntegration verifies that WaitForPlaylist
// succeeds once the mock ffmpeg has written the playlist file.
func TestWaitForPlaylist_AfterMockFFmpegIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	binDir := t.TempDir()

	writeMockFFProbeForHLS(t, binDir)
	writeMockFFMpegForHLS(t, binDir)
	patchPATH(t, binDir)

	srcPath := filepath.Join(tmpDir, "video.mkv")
	if err := os.WriteFile(srcPath, []byte("fake video"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	trans := New(filepath.Join(tmpDir, "cache"), "", true, "none")

	info, err := trans.GetVideoInfo(context.Background(), srcPath)
	if err != nil {
		t.Fatalf("GetVideoInfo: %v", err)
	}

	session, err := trans.GetOrCreateHLSSession(context.Background(), srcPath, 0, info)
	if err != nil {
		t.Fatalf("GetOrCreateHLSSession: %v", err)
	}

	// WaitForPlaylist polls until the mock ffmpeg writes the playlist (or timeout).
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := session.WaitForPlaylist(ctx, 1, 15*time.Second); err != nil {
		t.Errorf("WaitForPlaylist: %v", err)
	}
}

// TestWaitForSegment_AfterMockFFmpegIntegration verifies that WaitForSegment
// returns the segment path once the mock ffmpeg has written seg0.ts.
func TestWaitForSegment_AfterMockFFmpegIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	tmpDir := t.TempDir()
	binDir := t.TempDir()

	writeMockFFProbeForHLS(t, binDir)
	writeMockFFMpegForHLS(t, binDir)
	patchPATH(t, binDir)

	srcPath := filepath.Join(tmpDir, "video.mkv")
	if err := os.WriteFile(srcPath, []byte("fake video"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	trans := New(filepath.Join(tmpDir, "cache"), "", true, "none")

	info, err := trans.GetVideoInfo(context.Background(), srcPath)
	if err != nil {
		t.Fatalf("GetVideoInfo: %v", err)
	}

	session, err := trans.GetOrCreateHLSSession(context.Background(), srcPath, 0, info)
	if err != nil {
		t.Fatalf("GetOrCreateHLSSession: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	segPath, err := session.WaitForSegment(ctx, 0, 15*time.Second)
	if err != nil {
		t.Fatalf("WaitForSegment: %v", err)
	}

	if _, statErr := os.Stat(segPath); statErr != nil {
		t.Errorf("segment file does not exist at %q: %v", segPath, statErr)
	}
}
