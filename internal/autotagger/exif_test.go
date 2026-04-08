package autotagger

import (
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
