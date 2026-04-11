package autotagger

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestJoinKeywordField(t *testing.T) {
	tests := []struct {
		name string
		raw  interface{}
		want string
	}{
		// string input — single keyword
		{
			name: "plain string",
			raw:  "travel",
			want: "travel",
		},
		{
			name: "string with surrounding whitespace",
			raw:  "  travel  ",
			want: "travel",
		},
		{
			name: "empty string",
			raw:  "",
			want: "",
		},
		{
			name: "whitespace-only string",
			raw:  "   ",
			want: "",
		},
		// []interface{} input — multiple keywords (exiftool -j array format)
		{
			name: "slice with two values",
			raw:  []interface{}{"travel", "mountains"},
			want: "travel, mountains",
		},
		{
			name: "slice with three values",
			raw:  []interface{}{"travel", "mountains", "landscape"},
			want: "travel, mountains, landscape",
		},
		{
			name: "slice with whitespace-padded values",
			raw:  []interface{}{"  travel  ", " mountains "},
			want: "travel, mountains",
		},
		{
			name: "slice with empty string entries filtered out",
			raw:  []interface{}{"travel", "", "landscape"},
			want: "travel, landscape",
		},
		{
			name: "slice with whitespace-only entries filtered out",
			raw:  []interface{}{"travel", "   ", "landscape"},
			want: "travel, landscape",
		},
		{
			name: "empty slice",
			raw:  []interface{}{},
			want: "",
		},
		{
			name: "slice with all empty entries",
			raw:  []interface{}{"", "   "},
			want: "",
		},
		// unsupported types — should return empty string
		{
			name: "integer value",
			raw:  42,
			want: "",
		},
		{
			name: "nil value",
			raw:  nil,
			want: "",
		},
		{
			name: "map value",
			raw:  map[string]string{"key": "value"},
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := joinKeywordField(tt.raw)
			if got != tt.want {
				t.Errorf("joinKeywordField(%#v) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}

func TestShouldRetryMetadataToolError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		stderr   string
		timedOut bool
		want     bool
	}{
		{
			name:     "retries context deadline exceeded",
			err:      context.DeadlineExceeded,
			timedOut: true,
			want:     true,
		},
		{
			name:   "retries stale file handle stderr",
			err:    errors.New("ffprobe failed"),
			stderr: "sample.webp: Stale file handle",
			want:   true,
		},
		{
			name:   "retries io error stderr",
			err:    errors.New("exiftool failed"),
			stderr: "Error: Input/output error",
			want:   true,
		},
		{
			name:   "does not retry regular metadata miss",
			err:    errors.New("ffprobe failed"),
			stderr: "No such metadata tag",
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldRetryMetadataToolError(tt.err, tt.stderr, tt.timedOut)
			if got != tt.want {
				t.Fatalf("shouldRetryMetadataToolError(%v, %q, %v) = %v, want %v", tt.err, tt.stderr, tt.timedOut, got, tt.want)
			}
		})
	}
}

func TestExtractDescriptionFieldPrefersExiftoolForImages(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script PATH test is Unix-specific")
	}

	tempDir := t.TempDir()
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("MkdirAll binDir: %v", err)
	}

	exifCount := filepath.Join(tempDir, "exiftool.count")
	ffprobeCount := filepath.Join(tempDir, "ffprobe.count")

	writeTestScript(t, filepath.Join(binDir, "exiftool"), `#!/bin/sh
set -eu
printf x >> "$EXIFTOOL_COUNT_FILE"
printf '%s
' '[{"Description":"tags:alpha;"}]'
`)
	writeTestScript(t, filepath.Join(binDir, "ffprobe"), `#!/bin/sh
set -eu
printf x >> "$FFPROBE_COUNT_FILE"
printf '%s
' '{"format":{"tags":{"description":"tags:beta;"}}}'
`)

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("EXIFTOOL_COUNT_FILE", exifCount)
	t.Setenv("FFPROBE_COUNT_FILE", ffprobeCount)

	mediaFile := filepath.Join(tempDir, "image.webp")
	if err := os.WriteFile(mediaFile, []byte("stub"), 0o644); err != nil {
		t.Fatalf("WriteFile mediaFile: %v", err)
	}

	desc, err := extractDescriptionField(context.Background(), mediaFile)
	if err != nil {
		t.Fatalf("extractDescriptionField: %v", err)
	}
	if desc != "tags:alpha;" {
		t.Fatalf("extractDescriptionField() = %q, want %q", desc, "tags:alpha;")
	}
	assertCounterFileLen(t, exifCount, 1)
	assertCounterFileLen(t, ffprobeCount, 0)
}

func TestExtractDescriptionFieldFallsBackToFFprobeAfterEmptyExiftool(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script PATH test is Unix-specific")
	}

	tempDir := t.TempDir()
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("MkdirAll binDir: %v", err)
	}

	exifCount := filepath.Join(tempDir, "exiftool.count")
	ffprobeCount := filepath.Join(tempDir, "ffprobe.count")

	writeTestScript(t, filepath.Join(binDir, "exiftool"), `#!/bin/sh
set -eu
printf x >> "$EXIFTOOL_COUNT_FILE"
printf '%s
' '[{}]'
`)
	writeTestScript(t, filepath.Join(binDir, "ffprobe"), `#!/bin/sh
set -eu
printf x >> "$FFPROBE_COUNT_FILE"
printf '%s
' '{"format":{"tags":{"description":"tags:beta;"}}}'
`)

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("EXIFTOOL_COUNT_FILE", exifCount)
	t.Setenv("FFPROBE_COUNT_FILE", ffprobeCount)

	mediaFile := filepath.Join(tempDir, "image.webp")
	if err := os.WriteFile(mediaFile, []byte("stub"), 0o644); err != nil {
		t.Fatalf("WriteFile mediaFile: %v", err)
	}

	desc, err := extractDescriptionField(context.Background(), mediaFile)
	if err != nil {
		t.Fatalf("extractDescriptionField: %v", err)
	}
	if desc != "tags:beta;" {
		t.Fatalf("extractDescriptionField() = %q, want %q", desc, "tags:beta;")
	}
	assertCounterFileLen(t, exifCount, 1)
	assertCounterFileLen(t, ffprobeCount, 1)
}

func writeTestScript(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("WriteFile script %s: %v", path, err)
	}
}

func assertCounterFileLen(t *testing.T, path string, want int) {
	t.Helper()
	data, err := os.ReadFile(path)
	if want == 0 {
		if errors.Is(err, os.ErrNotExist) {
			return
		}
	}
	if err != nil {
		t.Fatalf("ReadFile counter %s: %v", path, err)
	}
	if len(data) != want {
		t.Fatalf("counter file %s length = %d, want %d", path, len(data), want)
	}
}
