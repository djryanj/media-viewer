package autotagger

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"media-viewer/internal/filesystem"
	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

const metadataToolTimeout = 45 * time.Second

var errExiftoolUnavailable = errors.New("exiftool not available")

// ffprobeFormat mirrors the "format" section of ffprobe JSON output.
type ffprobeFormat struct {
	Tags map[string]string `json:"tags"`
}

// ffprobeOutput mirrors the top-level structure of ffprobe JSON output.
type ffprobeOutput struct {
	Format ffprobeFormat `json:"format"`
}

// isImagePath reports whether absPath has a still-image file extension.
// ffprobe's image2 / mjpeg demuxer does not reliably surface EXIF/XMP
// description fields for all real-world JPEG/TIFF/HEIC files; for those
// formats we fall back to exiftool when ffprobe returns nothing.
func isImagePath(absPath string) bool {
	switch strings.ToLower(filepath.Ext(absPath)) {
	case ".jpg", ".jpeg", ".tif", ".tiff", ".heic", ".heif", ".avif", ".webp", ".png":
		return true
	}
	return false
}

// extractDescriptionField runs ffprobe on absPath and returns the raw value of
// the description or comment field from the format-level tags map.  Returns an
// empty string when no such field is present.  The lookup is case-insensitive
// so that containers that capitalise the field name (e.g. "Description") are
// handled correctly alongside the lowercase convention used by most encoders.
//
// GIFs store metadata as XMP Application Extensions; ffprobe surfaces these
// under the same format.tags map, so no special-casing is required.
//
// For still-image formats (JPEG, TIFF, HEIC, …) ffprobe's image2 demuxer does
// not reliably surface XMP/EXIF description fields written by standard photo
// tools such as Lightroom or Digikam.  When ffprobe returns no description,
// the function falls back to exiftool for these formats.
func extractDescriptionField(ctx context.Context, absPath string) (string, error) {
	if err := validateAbsPath(absPath); err != nil {
		return "", err
	}

	logging.Debug("AutoTagger: extracting metadata from %s", absPath)

	retryConfig := filesystem.DefaultRetryConfig()
	if _, err := filesystem.StatWithRetry(absPath, retryConfig); err != nil {
		return "", fmt.Errorf("file not accessible: %w", err)
	}

	desc, ffprobeErr := extractDescriptionViaFFprobe(ctx, absPath)
	if ffprobeErr == nil {
		if desc != "" {
			logging.Debug("AutoTagger: ffprobe returned metadata for %s", filepath.Base(absPath))
			return desc, nil
		}
		if !isImagePath(absPath) {
			logging.Debug("AutoTagger: ffprobe found no description/comment for %s", filepath.Base(absPath))
			return "", nil
		}
		logging.Debug("AutoTagger: ffprobe found no description/comment for %s; trying exiftool fallback", filepath.Base(absPath))
	} else if !isImagePath(absPath) {
		return "", ffprobeErr
	} else {
		logging.Debug("AutoTagger: ffprobe failed for still image %s; trying exiftool fallback: %v", filepath.Base(absPath), ffprobeErr)
	}

	fallbackDesc, fallbackErr := extractDescriptionViaExiftool(ctx, absPath)
	if fallbackErr == nil {
		if fallbackDesc == "" {
			logging.Debug("AutoTagger: exiftool found no usable metadata for %s", filepath.Base(absPath))
		} else {
			logging.Debug("AutoTagger: exiftool returned metadata for %s", filepath.Base(absPath))
		}
		return fallbackDesc, nil
	}

	if errors.Is(fallbackErr, errExiftoolUnavailable) {
		logging.Debug("AutoTagger: exiftool unavailable; no image fallback for %s", filepath.Base(absPath))
		if ffprobeErr != nil {
			return "", ffprobeErr
		}
		return "", nil
	}

	if ffprobeErr != nil {
		return "", fmt.Errorf(
			"metadata extraction failed: %w",
			errors.Join(
				fmt.Errorf("ffprobe failed: %w", ffprobeErr),
				fmt.Errorf("exiftool fallback failed: %w", fallbackErr),
			),
		)
	}

	return "", fallbackErr
}

func extractDescriptionViaFFprobe(ctx context.Context, absPath string) (string, error) {
	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		return "", fmt.Errorf("ffprobe not found: %w", err)
	}

	stdout, err := runMetadataTool(ctx, absPath, ffprobePath, metadataToolTimeout,
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		absPath,
	)
	if err != nil {
		logging.Debug("ffprobe failed for %s: %v", filepath.Base(absPath), err)
		return "", err
	}

	var out ffprobeOutput
	if err := json.Unmarshal([]byte(stdout), &out); err != nil {
		return "", fmt.Errorf("ffprobe JSON parse error: %w", err)
	}

	// Check for description and comment fields, preferring description.
	for _, key := range []string{"description", "comment"} {
		for k, v := range out.Format.Tags {
			if strings.EqualFold(k, key) {
				logging.Debug("AutoTagger: ffprobe found %s tag for %s", key, filepath.Base(absPath))
				return v, nil
			}
		}
	}

	logging.Debug("AutoTagger: ffprobe found no description/comment tag for %s", filepath.Base(absPath))

	return "", nil
}

// extractDescriptionViaExiftool reads description/keyword fields from an image
// file using exiftool.  It checks (in priority order):
//   - XMP Description
//   - EXIF ImageDescription
//   - IPTC Caption-Abstract
//   - IPTC Keywords / XMP Subject (joined as a comma-separated list)
//
// Returns ("", errExiftoolUnavailable) when exiftool is not installed. Returns
// ("", nil) when exiftool runs but finds nothing.
func extractDescriptionViaExiftool(ctx context.Context, absPath string) (string, error) {
	exiftoolPath, err := exec.LookPath("exiftool")
	if err != nil {
		return "", errExiftoolUnavailable
	}

	stdout, err := runMetadataTool(ctx, absPath, exiftoolPath, metadataToolTimeout,
		"-j",
		"-Description",
		"-ImageDescription",
		"-Caption-Abstract",
		"-Keywords",
		"-Subject",
		absPath,
	)
	if err != nil {
		logging.Debug("exiftool failed for %s: %v", filepath.Base(absPath), err)
		return "", err
	}

	// exiftool -j returns a JSON array; we only ever pass one file.
	var results []map[string]interface{}
	if err := json.Unmarshal([]byte(stdout), &results); err != nil {
		return "", fmt.Errorf("exiftool JSON parse error: %w", err)
	}
	if len(results) == 0 {
		return "", nil
	}

	fields := results[0]

	// Priority 1–3: free-text description fields.
	for _, key := range []string{"Description", "ImageDescription", "Caption-Abstract"} {
		if raw, ok := fields[key]; ok {
			if v, ok := raw.(string); ok && strings.TrimSpace(v) != "" {
				logging.Debug("AutoTagger: exiftool found %s field for %s", key, filepath.Base(absPath))
				return strings.TrimSpace(v), nil
			}
		}
	}

	// Priority 4: IPTC Keywords / XMP Subject.  These may be a single string
	// (one keyword) or a JSON array (multiple keywords); join them with ", "
	// so that parseTagsFromDescription's extended path can detect them.
	for _, key := range []string{"Keywords", "Subject"} {
		if raw, ok := fields[key]; ok {
			if joined := joinKeywordField(raw); joined != "" {
				logging.Debug("AutoTagger: exiftool found %s keywords for %s", key, filepath.Base(absPath))
				return joined, nil
			}
		}
	}

	logging.Debug("AutoTagger: exiftool found no supported description or keyword fields for %s", filepath.Base(absPath))

	return "", nil
}

func runMetadataTool(ctx context.Context, absPath, toolPath string, timeout time.Duration, args ...string) (string, error) {
	retryConfig := filesystem.DefaultRetryConfig()
	backoff := retryConfig.InitialBackoff
	var lastErr error
	var lastStderr string

	for attempt := 0; attempt <= retryConfig.MaxRetries; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, timeout)
		logging.Debug(
			"AutoTagger: running %s for %s (attempt %d/%d, timeout=%v)",
			filepath.Base(toolPath),
			filepath.Base(absPath),
			attempt+1,
			retryConfig.MaxRetries+1,
			timeout,
		)

		// #nosec G204 -- absPath is from the indexed media library, validated above
		cmd := exec.CommandContext(attemptCtx, toolPath, args...)
		var stdoutBuf bytes.Buffer
		var stderrBuf bytes.Buffer
		cmd.Stdout = &stdoutBuf
		cmd.Stderr = &stderrBuf

		start := time.Now()
		err := cmd.Run()
		timedOut := errors.Is(attemptCtx.Err(), context.DeadlineExceeded)
		cancel()

		if filepath.Base(toolPath) == "ffprobe" {
			metrics.ExifTagFFprobeDuration.Observe(time.Since(start).Seconds())
		}

		stdoutText := stdoutBuf.String()
		stderrText := stderrBuf.String()
		duration := time.Since(start)

		if err == nil {
			logging.Debug("AutoTagger: %s succeeded for %s in %v", filepath.Base(toolPath), filepath.Base(absPath), duration.Round(time.Millisecond))
			return stdoutText, nil
		}

		lastErr = wrapMetadataToolError(toolPath, err, stderrText, timedOut)
		lastStderr = stderrText

		if attempt == retryConfig.MaxRetries || !shouldRetryMetadataToolError(lastErr, lastStderr, timedOut) {
			break
		}

		logging.Debug(
			"AutoTagger: retrying %s for %s in %v (attempt %d/%d): %v",
			filepath.Base(toolPath),
			filepath.Base(absPath),
			backoff,
			attempt+1,
			retryConfig.MaxRetries,
			lastErr,
		)

		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return "", ctx.Err()
		}

		backoff *= 2
		if backoff > retryConfig.MaxBackoff {
			backoff = retryConfig.MaxBackoff
		}
	}

	return "", lastErr
}

func wrapMetadataToolError(toolPath string, err error, stderr string, timedOut bool) error {
	if timedOut {
		return fmt.Errorf("%s timed out: %w", filepath.Base(toolPath), context.DeadlineExceeded)
	}

	trimmedStderr := strings.TrimSpace(stderr)
	if trimmedStderr == "" {
		return fmt.Errorf("%s failed: %w", filepath.Base(toolPath), err)
	}

	return fmt.Errorf("%s failed: %w, stderr: %s", filepath.Base(toolPath), err, trimmedStderr)
}

func shouldRetryMetadataToolError(err error, stderr string, timedOut bool) bool {
	if err == nil {
		return false
	}
	if timedOut || errors.Is(err, context.DeadlineExceeded) {
		return true
	}

	lower := strings.ToLower(stderr + " " + err.Error())
	for _, fragment := range []string{"stale file handle", "input/output error", "resource temporarily unavailable"} {
		if strings.Contains(lower, fragment) {
			return true
		}
	}

	return false
}

// joinKeywordField coerces the raw JSON value of a keyword/subject field into
// a comma-separated string.  The field may arrive as a plain string (single
// value) or as a []interface{} slice (multiple values).
func joinKeywordField(raw interface{}) string {
	switch v := raw.(type) {
	case string:
		return strings.TrimSpace(v)
	case []interface{}:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				if s = strings.TrimSpace(s); s != "" {
					parts = append(parts, s)
				}
			}
		}
		return strings.Join(parts, ", ")
	}
	return ""
}

// extractTagsFromFile reads EXIF/XMP metadata from the file at absPath and
// returns any auto-tag names encoded in a "tags:…;" substring of the
// description or comment field.  Returns nil (not an error) when no tags are
// found or when the description field is absent.
func extractTagsFromFile(ctx context.Context, absPath string) ([]string, error) {
	desc, err := extractDescriptionField(ctx, absPath)
	if err != nil {
		return nil, err
	}
	if desc == "" {
		return nil, nil
	}
	return parseTagsFromDescription(desc), nil
}

// validateAbsPath rejects paths that are unsafe to pass to external processes.
// It mirrors the validation used by the thumbnail generator for ffmpeg calls.
func validateAbsPath(absPath string) error {
	if absPath == "" {
		return fmt.Errorf("empty file path")
	}
	for _, r := range absPath {
		if r == '\x00' || r == '\n' || r == '\r' || (r < 32 && r != '\t') {
			return fmt.Errorf("file path contains unsafe characters")
		}
	}
	return nil
}
