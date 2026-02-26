package transcoder

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"media-viewer/internal/logging"
)

// HLS tuning constants.
const (
	hlsSegmentDuration     = 6 // target segment length in seconds
	hlsSegmentWaitTimeout  = 60 * time.Second
	hlsPlaylistWaitTimeout = 30 * time.Second
	hlsSegmentPollInterval = 200 * time.Millisecond
	hlsIdleKillTimeout     = 10 * time.Minute
)

// HLSSession holds the state for one HLS transcoding session.
// A session is keyed by a stable hash of (sourcePath, targetWidth) so the same
// source file always maps to the same directory on disk.
type HLSSession struct {
	// Immutable after creation
	ID          string
	SourcePath  string
	TargetWidth int
	SessionDir  string
	srcModTime  time.Time // mtime of source when session was created

	mu         sync.Mutex
	cmd        *exec.Cmd
	started    bool
	done       chan struct{} // closed by the ffmpeg-waiter goroutine
	err        error         // ffmpeg exit error; set before done is closed
	lastAccess time.Time
}

// PlaylistPath returns the path to the HLS playlist file for this session.
func (s *HLSSession) PlaylistPath() string {
	return filepath.Join(s.SessionDir, "playlist.m3u8")
}

// SegmentPath returns the on-disk path for segment number index.
func (s *HLSSession) SegmentPath(index int) string {
	return filepath.Join(s.SessionDir, fmt.Sprintf("seg%d.ts", index))
}

// IsDone reports whether the ffmpeg process has exited.
func (s *HLSSession) IsDone() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

// Touch updates the last-access timestamp (called on every client request).
func (s *HLSSession) Touch() {
	s.mu.Lock()
	s.lastAccess = time.Now()
	s.mu.Unlock()
}

// kill terminates the ffmpeg process if it is still running.
func (s *HLSSession) kill() {
	s.mu.Lock()
	cmd := s.cmd
	s.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

// WaitForPlaylist blocks until the playlist file contains at least minSegments
// EXTINF entries, or until the context / timeout fires.
func (s *HLSSession) WaitForPlaylist(ctx context.Context, minSegments int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)

	for {
		if s.playlistSegmentCount() >= minSegments {
			return nil
		}

		// If ffmpeg finished, accept whatever we have (short video edge case).
		select {
		case <-s.done:
			s.mu.Lock()
			sessionErr := s.err
			s.mu.Unlock()
			if sessionErr != nil {
				return fmt.Errorf("HLS transcode failed: %w", sessionErr)
			}
			if s.playlistSegmentCount() >= 1 {
				return nil
			}
			return fmt.Errorf("no segments produced")
		default:
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("timeout waiting for HLS playlist")
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(hlsSegmentPollInterval):
		}
	}
}

// WaitForSegment blocks until seg{index}.ts exists on disk, or the context /
// timeout fires. Returns the segment path on success.
func (s *HLSSession) WaitForSegment(ctx context.Context, index int, timeout time.Duration) (string, error) {
	segPath := s.SegmentPath(index)
	deadline := time.Now().Add(timeout)

	for {
		if _, err := os.Stat(segPath); err == nil {
			return segPath, nil
		}

		// If ffmpeg has exited, the segment will never appear.
		select {
		case <-s.done:
			if _, err := os.Stat(segPath); err == nil {
				return segPath, nil
			}
			s.mu.Lock()
			sessionErr := s.err
			s.mu.Unlock()
			if sessionErr != nil {
				return "", fmt.Errorf("ffmpeg failed: %w", sessionErr)
			}
			return "", fmt.Errorf("segment %d not found (transcoding complete)", index)
		default:
		}

		if time.Now().After(deadline) {
			return "", fmt.Errorf("timeout waiting for segment %d", index)
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(hlsSegmentPollInterval):
		}
	}
}

// playlistSegmentCount counts EXTINF tags in the playlist to determine how
// many segments have been written.
func (s *HLSSession) playlistSegmentCount() int {
	data, err := os.ReadFile(s.PlaylistPath())
	if err != nil {
		return 0
	}
	return strings.Count(string(data), "#EXTINF:")
}

// ---------------------------------------------------------------------------
// Transcoder HLS API
// ---------------------------------------------------------------------------

// hlsSessionKey returns the 16-hex-char directory/session identifier for a
// given (sourcePath, targetWidth) pair.  The identifier contains only [0-9a-f]
// so it is safe to embed in URL paths matched by the regex {sessionId:[0-9a-f]+}.
func hlsSessionKey(sourcePath string, targetWidth int) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s_w%d", sourcePath, targetWidth)))
	return fmt.Sprintf("%x", h[:8]) // 16 hex characters
}

// GetOrCreateHLSSession returns an existing valid session for the given source
// file and target width, or creates (and starts) a new one.
//
// A session is considered stale if the source file's mtime has advanced since
// the session was created; stale sessions are discarded and recreated.
func (t *Transcoder) GetOrCreateHLSSession(_ context.Context, sourcePath string, targetWidth int, info *VideoInfo) (*HLSSession, error) {
	if !t.enabled {
		return nil, fmt.Errorf("transcoding required but disabled")
	}

	sessionID := hlsSessionKey(sourcePath, targetWidth)
	sessionDir := filepath.Join(t.cacheDir, "hls", sessionID)

	t.hlsSessionsMu.Lock()

	if existing, ok := t.hlsSessions[sessionID]; ok {
		// Validate freshness against source mtime.
		srcInfo, err := os.Stat(sourcePath)
		if err == nil && !srcInfo.ModTime().After(existing.srcModTime) {
			// Session is still valid.
			existing.Touch()
			t.hlsSessionsMu.Unlock()
			return existing, nil
		}
		// Source changed or stat failed — invalidate.
		logging.Info("HLS: invalidating stale session %s for %s", sessionID, sourcePath)
		existing.kill()
		delete(t.hlsSessions, sessionID)
		_ = os.RemoveAll(sessionDir)
	}

	// Create a fresh session.
	srcInfo, err := os.Stat(sourcePath)
	if err != nil {
		t.hlsSessionsMu.Unlock()
		return nil, fmt.Errorf("failed to stat source file: %w", err)
	}

	if err := os.MkdirAll(sessionDir, 0o750); err != nil {
		t.hlsSessionsMu.Unlock()
		return nil, fmt.Errorf("failed to create HLS session directory: %w", err)
	}

	session := &HLSSession{
		ID:          sessionID,
		SourcePath:  sourcePath,
		TargetWidth: targetWidth,
		SessionDir:  sessionDir,
		srcModTime:  srcInfo.ModTime(),
		done:        make(chan struct{}),
		lastAccess:  time.Now(),
	}

	t.hlsSessions[sessionID] = session
	t.hlsSessionsMu.Unlock()

	// Start ffmpeg (must happen outside the lock).
	//nolint:contextcheck // Background context is intentional: HLS encoding must outlive the HTTP request.
	if err := t.startHLSTranscode(session, info); err != nil {
		t.hlsSessionsMu.Lock()
		delete(t.hlsSessions, sessionID)
		t.hlsSessionsMu.Unlock()
		_ = os.RemoveAll(sessionDir)
		return nil, err
	}

	return session, nil
}

// GetHLSSession returns an existing session by its ID, or nil if not found.
func (t *Transcoder) GetHLSSession(sessionID string) *HLSSession {
	t.hlsSessionsMu.Lock()
	defer t.hlsSessionsMu.Unlock()
	return t.hlsSessions[sessionID]
}

// startHLSTranscode launches the ffmpeg process that writes HLS segments and
// the playlist into session.SessionDir.  It returns as soon as the process
// has started; a goroutine waits for it to finish.
func (t *Transcoder) startHLSTranscode(session *HLSSession, info *VideoInfo) error {
	needsScaling := session.TargetWidth > 0 && session.TargetWidth < info.Width
	needsReencode := !compatibleCodecs[info.Codec] || needsScaling

	args, err := t.buildHLSFFmpegArgs(session.SourcePath, session.SessionDir, session.TargetWidth, info, needsReencode, false)
	if err != nil {
		return err
	}

	// Sanitize args (belt-and-suspenders; paths are validated in buildHLSFFmpegArgs).
	for _, arg := range args {
		if strings.ContainsAny(arg, ";&|$><") {
			return fmt.Errorf("invalid ffmpeg argument: %s", arg)
		}
	}

	// Background context is intentional: HLS encoding must outlive the HTTP request.
	cmd := exec.CommandContext(context.Background(), "ffmpeg", args...) // #nosec G204 - no arguments are passed that are user-sourced

	var stderrBuf bytes.Buffer
	logFile := t.createTranscoderLog(session.SourcePath, session.TargetWidth)
	if logFile != nil {
		cmd.Stderr = io.MultiWriter(&stderrBuf, logFile)
	} else {
		cmd.Stderr = &stderrBuf
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg for HLS session %s: %w", session.ID, err)
	}

	session.mu.Lock()
	session.cmd = cmd
	session.started = true
	session.mu.Unlock()

	// Track process for Cleanup().
	processKey := session.SourcePath + ":hls:" + session.ID
	t.processMu.Lock()
	t.processes[processKey] = cmd
	t.processMu.Unlock()

	logging.Info("HLS: started session %s for %s (width=%d)", session.ID, session.SourcePath, session.TargetWidth)

	go t.waitHLSProcess(session, cmd, processKey, &stderrBuf, logFile, info, needsReencode)

	return nil
}

// waitHLSProcess waits for the ffmpeg process to exit, records the result, and
// triggers a CPU retry if a GPU error is detected.  It must be run in a goroutine.
func (t *Transcoder) waitHLSProcess(session *HLSSession, cmd *exec.Cmd, processKey string, stderrBuf *bytes.Buffer, logFile *os.File, info *VideoInfo, needsReencode bool) {
	defer func() {
		t.processMu.Lock()
		delete(t.processes, processKey)
		t.processMu.Unlock()
		if logFile != nil {
			_ = logFile.Close()
		}
	}()

	cmdErr := cmd.Wait()
	if cmdErr == nil {
		session.mu.Lock()
		session.err = nil
		session.mu.Unlock()
		logging.Info("HLS: session %s completed successfully", session.ID)
		close(session.done)
		return
	}

	stderrStr := stderrBuf.String()
	session.mu.Lock()
	session.err = fmt.Errorf("ffmpeg error: %w — %s", cmdErr, stderrStr)
	logging.Error("HLS: session %s failed: %v", session.ID, session.err)
	session.mu.Unlock()

	// GPU-then-CPU retry (mirrors the existing transcodeDirectToCache pattern).
	if t.gpuAvailable && t.isGPUError(stderrStr) && !t.shuttingDown.Load() {
		t.retryHLSWithCPU(session, processKey, info, needsReencode)
	}

	close(session.done)
}

// retryHLSWithCPU disables GPU acceleration and re-runs ffmpeg using software
// encoding.  The result is recorded on session.err.
func (t *Transcoder) retryHLSWithCPU(session *HLSSession, processKey string, info *VideoInfo, needsReencode bool) {
	logging.Warn("HLS: GPU encode failed for session %s, retrying with CPU", session.ID)

	t.gpuMu.Lock()
	t.gpuAvailable = false
	t.gpuMu.Unlock()

	retryArgs, err := t.buildHLSFFmpegArgs(session.SourcePath, session.SessionDir, session.TargetWidth, info, needsReencode, true)
	if err != nil {
		return
	}

	// Background context is intentional: retry must also outlive the HTTP request.
	retryCmd := exec.CommandContext(context.Background(), "ffmpeg", retryArgs...) // #nosec G204 - no arguments are passed that are user-sourced
	var retryStderr bytes.Buffer
	retryCmd.Stderr = &retryStderr

	if err := retryCmd.Start(); err != nil {
		return
	}

	t.processMu.Lock()
	t.processes[processKey+":cpu"] = retryCmd
	t.processMu.Unlock()

	retryWaitErr := retryCmd.Wait()

	t.processMu.Lock()
	delete(t.processes, processKey+":cpu")
	t.processMu.Unlock()

	session.mu.Lock()
	if retryWaitErr != nil {
		session.err = fmt.Errorf("ffmpeg CPU retry error: %w — %s", retryWaitErr, retryStderr.String())
		logging.Error("HLS: CPU retry for session %s also failed: %v", session.ID, session.err)
	} else {
		session.err = nil
		logging.Info("HLS: CPU retry succeeded for session %s", session.ID)
	}
	session.mu.Unlock()
}

// buildHLSFFmpegArgs constructs the ffmpeg argument list for HLS output.
// The output is a set of MPEG-TS segment files and a playlist in sessionDir.
func (t *Transcoder) buildHLSFFmpegArgs(inputPath, sessionDir string, targetWidth int, info *VideoInfo, needsReencode, forceCPU bool) ([]string, error) {
	cleanInput, err := sanitizeFilePath(inputPath)
	if err != nil {
		return nil, fmt.Errorf("invalid input file: %w", err)
	}

	var args []string

	// VA-API hardware initialisation.
	if !forceCPU && t.gpuAvailable && t.gpuEncoder != "" && t.gpuAccel == GPUAccelVAAPI {
		args = append(args, "-init_hw_device", "vaapi=vaapi0:/dev/dri/renderD128", "-filter_hw_device", "vaapi0")
	}

	args = append(args, "-i", cleanInput)

	needsScaling := targetWidth > 0 && targetWidth < info.Width

	switch {
	case !needsReencode && !needsScaling:
		// Stream-copy; segment boundaries may not be perfectly aligned when the
		// source has infrequent keyframes, but this is the fastest path.
		args = append(args, "-c:v", "copy")
	case !forceCPU && t.gpuAvailable && t.gpuEncoder != "":
		args = t.addGPUEncoderArgs(args, targetWidth, info, needsScaling)
	default:
		args = t.addCPUEncoderArgs(args, targetWidth, info, needsScaling)
	}

	// Audio.
	args = append(args, "-c:a", "aac", "-b:a", "128k")

	// Force keyframes at every segment boundary when re-encoding so that every
	// segment is independently decodable and seeking is frame-accurate.
	if needsReencode || needsScaling {
		args = append(args,
			"-force_key_frames", fmt.Sprintf("expr:gte(t,n_forced*%d)", hlsSegmentDuration),
		)
	}

	// HLS muxer.
	segmentPattern := filepath.Join(sessionDir, "seg%d.ts")
	playlistPath := filepath.Join(sessionDir, "playlist.m3u8")

	args = append(args,
		"-f", "hls",
		"-hls_time", fmt.Sprintf("%d", hlsSegmentDuration),
		"-hls_segment_type", "mpegts",
		"-hls_flags", "independent_segments",
		"-hls_list_size", "0",
		"-hls_segment_filename", segmentPattern,
		playlistPath,
	)

	return args, nil
}

// ---------------------------------------------------------------------------
// Background cleanup
// ---------------------------------------------------------------------------

// startHLSSessionCleaner launches a goroutine that periodically kills ffmpeg
// processes for sessions that clients have stopped touching.
func (t *Transcoder) startHLSSessionCleaner() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			if t.shuttingDown.Load() {
				return
			}
			t.cleanIdleHLSSessions()
		}
	}()
}

// cleanIdleHLSSessions kills ffmpeg for any session whose ffmpeg is still
// running but hasn't been accessed for hlsIdleKillTimeout.  Completed sessions
// (ffmpeg already exited) are not removed — their segment files remain as a
// disk cache for future requests.
func (t *Transcoder) cleanIdleHLSSessions() {
	t.hlsSessionsMu.Lock()
	defer t.hlsSessionsMu.Unlock()

	for id, session := range t.hlsSessions {
		if session.IsDone() {
			continue
		}
		session.mu.Lock()
		idle := time.Since(session.lastAccess)
		session.mu.Unlock()

		if idle > hlsIdleKillTimeout {
			logging.Info("HLS: killing idle session %s (idle for %v)", id, idle.Round(time.Second))
			session.kill()
		}
	}
}

// cleanupAllHLSSessions kills all active HLS ffmpeg processes.  Called from Cleanup().
func (t *Transcoder) cleanupAllHLSSessions() {
	t.hlsSessionsMu.Lock()
	defer t.hlsSessionsMu.Unlock()

	for _, session := range t.hlsSessions {
		session.kill()
	}
}
