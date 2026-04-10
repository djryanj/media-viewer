package autotagger

import (
	"context"
	"errors"
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
