package autotagger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

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
	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		return "", fmt.Errorf("ffprobe not found: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	if err := validateAbsPath(absPath); err != nil {
		return "", err
	}

	// #nosec G204 -- absPath is from the indexed media library, validated above
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		absPath,
	)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	probeStart := time.Now()
	if err := cmd.Run(); err != nil {
		logging.Debug("ffprobe failed for %s: %v", filepath.Base(absPath), err)
		return "", fmt.Errorf("ffprobe failed: %w", err)
	}
	metrics.ExifTagFFprobeDuration.Observe(time.Since(probeStart).Seconds())

	var out ffprobeOutput
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return "", fmt.Errorf("ffprobe JSON parse error: %w", err)
	}

	// Check for description and comment fields, preferring description.
	for _, key := range []string{"description", "comment"} {
		for k, v := range out.Format.Tags {
			if strings.EqualFold(k, key) {
				return v, nil
			}
		}
	}

	// ffprobe found no description-like tag.  For still-image formats
	// (JPEG, TIFF, HEIC, …) the image2 demuxer frequently misses XMP/EXIF
	// metadata written by standard photo editors.  Try exiftool as a fallback.
	if isImagePath(absPath) {
		return extractDescriptionViaExiftool(ctx, absPath), nil
	}

	return "", nil
}

// extractDescriptionViaExiftool reads description/keyword fields from an image
// file using exiftool.  It checks (in priority order):
//   - XMP Description
//   - EXIF ImageDescription
//   - IPTC Caption-Abstract
//   - IPTC Keywords / XMP Subject (joined as a comma-separated list)
//
// Returns ("", nil) when exiftool is not installed or finds nothing — this is
// always a non-fatal outcome.
func extractDescriptionViaExiftool(ctx context.Context, absPath string) string {
	exiftoolPath, err := exec.LookPath("exiftool")
	if err != nil {
		return "" // exiftool not installed; skip silently
	}

	// #nosec G204 -- absPath is validated by the caller (validateAbsPath)
	cmd := exec.CommandContext(ctx, exiftoolPath,
		"-j",
		"-Description",
		"-ImageDescription",
		"-Caption-Abstract",
		"-Keywords",
		"-Subject",
		absPath,
	)

	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		logging.Debug("exiftool failed for %s: %v", filepath.Base(absPath), err)
		return "" // non-fatal
	}

	// exiftool -j returns a JSON array; we only ever pass one file.
	var results []map[string]interface{}
	if err := json.Unmarshal(stdout.Bytes(), &results); err != nil || len(results) == 0 {
		return ""
	}

	fields := results[0]

	// Priority 1–3: free-text description fields.
	for _, key := range []string{"Description", "ImageDescription", "Caption-Abstract"} {
		if raw, ok := fields[key]; ok {
			if v, ok := raw.(string); ok && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		}
	}

	// Priority 4: IPTC Keywords / XMP Subject.  These may be a single string
	// (one keyword) or a JSON array (multiple keywords); join them with ", "
	// so that parseTagsFromDescription's extended path can detect them.
	for _, key := range []string{"Keywords", "Subject"} {
		if raw, ok := fields[key]; ok {
			if joined := joinKeywordField(raw); joined != "" {
				return joined
			}
		}
	}

	return ""
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
