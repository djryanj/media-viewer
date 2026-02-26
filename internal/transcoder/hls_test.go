package transcoder

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// =============================================================================
// hlsSessionKey
// =============================================================================

func TestHLSSessionKey_Deterministic(t *testing.T) {
	t.Parallel()

	key1 := hlsSessionKey("/media/video.mkv", 0)
	key2 := hlsSessionKey("/media/video.mkv", 0)
	if key1 != key2 {
		t.Errorf("expected same key for same input, got %q and %q", key1, key2)
	}
}

func TestHLSSessionKey_DifferentPaths(t *testing.T) {
	t.Parallel()

	a := hlsSessionKey("/media/a.mkv", 0)
	b := hlsSessionKey("/media/b.mkv", 0)
	if a == b {
		t.Errorf("expected different keys for different paths, got %q for both", a)
	}
}

func TestHLSSessionKey_DifferentWidths(t *testing.T) {
	t.Parallel()

	a := hlsSessionKey("/media/video.mkv", 0)
	b := hlsSessionKey("/media/video.mkv", 1280)
	if a == b {
		t.Errorf("expected different keys for different widths, got %q for both", a)
	}
}

func TestHLSSessionKey_Format(t *testing.T) {
	t.Parallel()

	key := hlsSessionKey("/media/video.mkv", 0)
	if len(key) != 16 {
		t.Errorf("expected 16 hex chars, got %d chars: %q", len(key), key)
	}
	for _, c := range key {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			t.Errorf("key %q contains non-hex character %c", key, c)
		}
	}
}

// =============================================================================
// HLSSession.PlaylistPath and SegmentPath
// =============================================================================

func TestHLSSession_PlaylistPath(t *testing.T) {
	t.Parallel()

	s := &HLSSession{SessionDir: "/tmp/hls/abcd1234"}
	expected := "/tmp/hls/abcd1234/playlist.m3u8"
	if got := s.PlaylistPath(); got != expected {
		t.Errorf("want %q, got %q", expected, got)
	}
}

func TestHLSSession_SegmentPath(t *testing.T) {
	t.Parallel()

	s := &HLSSession{SessionDir: "/tmp/hls/abcd1234"}
	cases := []struct {
		index int
		want  string
	}{
		{0, "/tmp/hls/abcd1234/seg0.ts"},
		{5, "/tmp/hls/abcd1234/seg5.ts"},
		{100, "/tmp/hls/abcd1234/seg100.ts"},
	}
	for _, tc := range cases {
		got := s.SegmentPath(tc.index)
		if got != tc.want {
			t.Errorf("SegmentPath(%d): want %q, got %q", tc.index, tc.want, got)
		}
	}
}

// =============================================================================
// HLSSession.IsDone
// =============================================================================

func TestHLSSession_IsDone_NotYet(t *testing.T) {
	t.Parallel()

	s := &HLSSession{done: make(chan struct{})}
	if s.IsDone() {
		t.Error("expected IsDone()=false before channel close")
	}
}

func TestHLSSession_IsDone_AfterClose(t *testing.T) {
	t.Parallel()

	done := make(chan struct{})
	s := &HLSSession{done: done}
	close(done)
	if !s.IsDone() {
		t.Error("expected IsDone()=true after channel close")
	}
}

// =============================================================================
// HLSSession.Touch
// =============================================================================

func TestHLSSession_Touch_UpdatesLastAccess(t *testing.T) {
	t.Parallel()

	s := &HLSSession{done: make(chan struct{})}
	before := time.Now()
	s.Touch()

	s.mu.Lock()
	la := s.lastAccess
	s.mu.Unlock()

	if la.Before(before) {
		t.Error("Touch did not update lastAccess to a recent time")
	}
}

// =============================================================================
// HLSSession.kill — nil cmd must not panic
// =============================================================================

func TestHLSSession_Kill_NilCmd(t *testing.T) {
	t.Parallel()

	s := &HLSSession{done: make(chan struct{})}
	// Must not panic.
	s.kill()
}

// =============================================================================
// WaitForPlaylist
// =============================================================================

func TestWaitForPlaylist_ReturnsImmediately(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	done := make(chan struct{})
	close(done)

	// Write a playlist with one EXTINF tag.
	playlist := "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n" +
		"#EXTINF:6.000000,\nseg0.ts\n#EXT-X-ENDLIST\n"
	if err := os.WriteFile(filepath.Join(tmpDir, "playlist.m3u8"), []byte(playlist), 0o644); err != nil {
		t.Fatalf("write playlist: %v", err)
	}

	s := &HLSSession{SessionDir: tmpDir, done: done}
	if err := s.WaitForPlaylist(context.Background(), 1, 5*time.Second); err != nil {
		t.Errorf("WaitForPlaylist: %v", err)
	}
}

func TestWaitForPlaylist_TimesOut(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()       // no playlist file
	done := make(chan struct{}) // NOT closed — ffmpeg still "running"

	s := &HLSSession{SessionDir: tmpDir, done: done}
	err := s.WaitForPlaylist(context.Background(), 1, 150*time.Millisecond)
	if err == nil {
		t.Error("expected timeout error")
	}
}

func TestWaitForPlaylist_Contextcanceled(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	done := make(chan struct{})

	s := &HLSSession{SessionDir: tmpDir, done: done}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before calling

	err := s.WaitForPlaylist(ctx, 1, 5*time.Second)
	if err == nil {
		t.Error("expected error on canceled context")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

func TestWaitForPlaylist_FFmpegFailed(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	done := make(chan struct{})
	close(done)

	s := &HLSSession{
		SessionDir: tmpDir,
		done:       done,
		err:        fmt.Errorf("ffmpeg: codec not found"),
	}
	err := s.WaitForPlaylist(context.Background(), 1, 5*time.Second)
	if err == nil {
		t.Error("expected error from ffmpeg failure")
	}
}

func TestWaitForPlaylist_FFmpegDoneNoSegments(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	done := make(chan struct{})
	close(done)

	// Write an empty playlist (no EXTINF).
	if err := os.WriteFile(filepath.Join(tmpDir, "playlist.m3u8"), []byte("#EXTM3U\n"), 0o644); err != nil {
		t.Fatalf("write empty playlist: %v", err)
	}

	s := &HLSSession{SessionDir: tmpDir, done: done}
	err := s.WaitForPlaylist(context.Background(), 1, 5*time.Second)
	if err == nil {
		t.Error("expected 'no segments produced' error")
	}
}

// =============================================================================
// WaitForSegment
// =============================================================================

func TestWaitForSegment_ReturnsPath(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	segPath := filepath.Join(tmpDir, "seg0.ts")
	if err := os.WriteFile(segPath, []byte("FAKE TS DATA"), 0o644); err != nil {
		t.Fatalf("write segment: %v", err)
	}

	done := make(chan struct{})
	close(done)

	s := &HLSSession{SessionDir: tmpDir, done: done}
	got, err := s.WaitForSegment(context.Background(), 0, 5*time.Second)
	if err != nil {
		t.Fatalf("WaitForSegment: %v", err)
	}
	if got != segPath {
		t.Errorf("want path %q, got %q", segPath, got)
	}
}

func TestWaitForSegment_TimesOut(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()       // no segment file
	done := make(chan struct{}) // NOT closed

	s := &HLSSession{SessionDir: tmpDir, done: done}
	_, err := s.WaitForSegment(context.Background(), 0, 150*time.Millisecond)
	if err == nil {
		t.Error("expected timeout error")
	}
}

func TestWaitForSegment_Contextcanceled(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	done := make(chan struct{})

	s := &HLSSession{SessionDir: tmpDir, done: done}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := s.WaitForSegment(ctx, 0, 5*time.Second)
	if err == nil {
		t.Error("expected error on canceled context")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

func TestWaitForSegment_FFmpegDoneNoSegment(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir() // no seg0.ts
	done := make(chan struct{})
	close(done)

	s := &HLSSession{SessionDir: tmpDir, done: done}
	_, err := s.WaitForSegment(context.Background(), 0, 5*time.Second)
	if err == nil {
		t.Error("expected error: ffmpeg finished without writing segment")
	}
}

func TestWaitForSegment_FFmpegDoneWithError(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	done := make(chan struct{})
	close(done)

	s := &HLSSession{
		SessionDir: tmpDir,
		done:       done,
		err:        fmt.Errorf("ffmpeg died"),
	}
	_, err := s.WaitForSegment(context.Background(), 0, 5*time.Second)
	if err == nil {
		t.Error("expected error from ffmpeg failure")
	}
}

// =============================================================================
// GetOrCreateHLSSession
// =============================================================================

func TestGetOrCreateHLSSession_DisabledReturnsError(t *testing.T) {
	t.Parallel()

	trans := New(t.TempDir(), "", false /* disabled */, "none")

	_, err := trans.GetOrCreateHLSSession(
		context.Background(), "/fake/video.mkv", 0, &VideoInfo{},
	)
	if err == nil {
		t.Error("expected error when transcoder is disabled")
	}
}

func TestGetOrCreateHLSSession_NonexistentSourceError(t *testing.T) {
	t.Parallel()

	trans := New(t.TempDir(), "", true, "none")

	_, err := trans.GetOrCreateHLSSession(
		context.Background(),
		"/nonexistent/video.mkv",
		0,
		&VideoInfo{Codec: "hevc", Width: 1920, Height: 1080},
	)
	if err == nil {
		t.Error("expected error for nonexistent source path")
	}
}

// =============================================================================
// GetHLSSession
// =============================================================================

func TestGetHLSSession_ReturnsNilForUnknownID(t *testing.T) {
	t.Parallel()

	trans := New(t.TempDir(), "", false, "none")
	if s := trans.GetHLSSession("doesnotexist0000"); s != nil {
		t.Error("expected nil for unknown session ID")
	}
}

func TestGetHLSSession_ReturnsInjectedSession(t *testing.T) {
	t.Parallel()

	trans := New(t.TempDir(), "", false, "none")
	session := &HLSSession{
		ID:         "abcd1234abcd1234",
		SourcePath: "/fake/video.mkv",
		done:       make(chan struct{}),
	}

	trans.hlsSessionsMu.Lock()
	trans.hlsSessions["abcd1234abcd1234"] = session
	trans.hlsSessionsMu.Unlock()

	got := trans.GetHLSSession("abcd1234abcd1234")
	if got != session {
		t.Error("expected the injected session to be returned")
	}
}

// =============================================================================
// cleanIdleHLSSessions
// =============================================================================

func TestCleanIdleHLSSessions_KillsIdleSession(t *testing.T) {
	t.Parallel()

	trans := New(t.TempDir(), "", false, "none")

	// lastAccess is zero → idle for decades → will be killed.
	session := &HLSSession{
		ID:   "idle0000idle0000",
		done: make(chan struct{}),
	}

	trans.hlsSessionsMu.Lock()
	trans.hlsSessions["idle0000idle0000"] = session
	trans.hlsSessionsMu.Unlock()

	trans.cleanIdleHLSSessions() // should not panic (nil cmd → kill is a no-op)

	// cleanIdleHLSSessions kills but does NOT remove from the map.
	trans.hlsSessionsMu.Lock()
	_, found := trans.hlsSessions["idle0000idle0000"]
	trans.hlsSessionsMu.Unlock()

	if !found {
		t.Error("cleanIdleHLSSessions must not remove sessions from the map, only kill them")
	}
}

func TestCleanIdleHLSSessions_SkipsDoneSessions(t *testing.T) {
	t.Parallel()

	trans := New(t.TempDir(), "", false, "none")

	done := make(chan struct{})
	close(done)
	session := &HLSSession{
		ID:   "done0000done0000",
		done: done,
		// lastAccess zero — would be killed if it weren't done.
	}

	trans.hlsSessionsMu.Lock()
	trans.hlsSessions["done0000done0000"] = session
	trans.hlsSessionsMu.Unlock()

	// Must not panic or attempt to kill the already-done session.
	trans.cleanIdleHLSSessions()
}

// =============================================================================
// cleanupAllHLSSessions
// =============================================================================

func TestCleanupAllHLSSessions_DoesNotPanic(t *testing.T) {
	t.Parallel()

	trans := New(t.TempDir(), "", false, "none")

	for _, id := range []string{"aaaa0000aaaa0000", "bbbb0000bbbb0000"} {
		trans.hlsSessionsMu.Lock()
		trans.hlsSessions[id] = &HLSSession{ID: id, done: make(chan struct{})}
		trans.hlsSessionsMu.Unlock()
	}

	trans.cleanupAllHLSSessions() // nil cmd → no-op, must not panic
}

// =============================================================================
// ClearCache removes HLS sessions from the in-memory map
// =============================================================================

func TestClearCache_RemovesHLSSessions(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	trans := New(tmpDir, "", false, "none")

	session := &HLSSession{
		ID:         "cccc0000cccc0000",
		SourcePath: "/fake/video.mkv",
		done:       make(chan struct{}),
	}
	trans.hlsSessionsMu.Lock()
	trans.hlsSessions["cccc0000cccc0000"] = session
	trans.hlsSessionsMu.Unlock()

	if _, err := trans.ClearCache(); err != nil {
		t.Fatalf("ClearCache: %v", err)
	}

	trans.hlsSessionsMu.Lock()
	remaining := len(trans.hlsSessions)
	trans.hlsSessionsMu.Unlock()

	if remaining != 0 {
		t.Errorf("ClearCache: expected 0 remaining HLS sessions, got %d", remaining)
	}
}

// =============================================================================
// buildHLSFFmpegArgs — special character filenames
// =============================================================================

// TestBuildHLSFFmpegArgs_SpecialCharacterFilenames verifies that
// buildHLSFFmpegArgs accepts input paths whose filenames contain shell
// metacharacters (& $ | ; > <).  Because exec.Command bypasses the shell,
// these characters are safe in filenames and must not be rejected.
func TestBuildHLSFFmpegArgs_SpecialCharacterFilenames(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	sessionDir := filepath.Join(tmpDir, "hls_session")
	if err := os.MkdirAll(sessionDir, 0o750); err != nil {
		t.Fatalf("failed to create session dir: %v", err)
	}

	cases := []struct {
		name     string
		filename string
	}{
		{"ampersand", "S&E.avi"},
		{"dollar", "$100 Concert.mkv"},
		{"pipe", "A|B.mkv"},
		{"semicolon", "cmd;name.avi"},
		{"greater-than", "out>file.mkv"},
		{"less-than", "in<file.mkv"},
		{"combined", "S&E $1 | test.avi"},
		{"unicode", "可愛い動画.mkv"},
	}

	trans := New(tmpDir, "", true, "none")
	info := &VideoInfo{Codec: "hevc", Width: 1920, Height: 1080}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// buildHLSFFmpegArgs → sanitizeFilePath requires the file to exist.
			srcPath := filepath.Join(tmpDir, tc.filename)
			if err := os.WriteFile(srcPath, []byte("data"), 0o644); err != nil {
				t.Fatalf("failed to create test file %q: %v", tc.filename, err)
			}

			args, err := trans.buildHLSFFmpegArgs(srcPath, sessionDir, 0, info, true, false)
			if err != nil {
				t.Fatalf("buildHLSFFmpegArgs(%q) unexpected error: %v", tc.filename, err)
			}

			// The resolved input path must appear immediately after "-i".
			found := false
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-i" {
					if filepath.Base(args[i+1]) == tc.filename {
						found = true
					}
					break
				}
			}
			if !found {
				t.Errorf("expected -i <path ending in %q> in args; got: %v", tc.filename, args)
			}
		})
	}
}
