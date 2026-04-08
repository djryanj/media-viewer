package autotagger

import (
	"testing"
)

func TestParseTagsFromDescription(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "simple",
			input: "tags:landscape, nature, 2024 Photos;",
			want:  []string{"landscape", "nature", "2024 Photos"},
		},
		{
			name:  "mixed case prefix",
			input: "TAGS:foo,bar;",
			want:  []string{"foo", "bar"},
		},
		{
			name:  "title case prefix",
			input: "Tags:foo,bar;",
			want:  []string{"foo", "bar"},
		},
		{
			name:  "text before and after",
			input: "Summer trip. tags: foo, bar; Shot with Canon R5",
			want:  []string{"foo", "bar"},
		},
		{
			name:  "no semicolon terminator reads to end",
			input: "tags:alpha, beta",
			want:  []string{"alpha", "beta"},
		},
		{
			name:  "empty tokens skipped",
			input: "tags:a,,b,  ,c;",
			want:  []string{"a", "b", "c"},
		},
		{
			name:  "no tags prefix",
			input: "just a description",
			want:  nil,
		},
		{
			name:  "empty string",
			input: "",
			want:  nil,
		},
		{
			name:  "tags prefix only no values",
			input: "tags:;",
			want:  nil,
		},
		{
			name:  "single tag",
			input: "tags:vacation;",
			want:  []string{"vacation"},
		},
		{
			name:  "whitespace trimming",
			input: "tags:  hello world  ,  another tag  ;",
			want:  []string{"hello world", "another tag"},
		},
		{
			name:  "multi-word tags",
			input: "tags:New York, Black & White, Street Photography;",
			want:  []string{"New York", "Black & White", "Street Photography"},
		},
		{
			name:  "first tags occurrence wins",
			input: "tags:first;  tags:second;",
			want:  []string{"first"},
		},
		{
			name:  "no semicolon with multi-word tags",
			input: "tags:first tag,second,this is still a tag",
			want:  []string{"first tag", "second", "this is still a tag"},
		},
		{
			name:  "no semicolon single multi-word tag",
			input: "tags:black and white",
			want:  []string{"black and white"},
		},
		{
			name: "no semicolon trailing text after final comma not a tag",
			// No semicolon — the whole remainder is split on commas; the last
			// "entry" may have trailing whitespace which gets trimmed.
			input: "Photo of the beach. tags:landscape, ocean view, sunset ",
			want:  []string{"landscape", "ocean view", "sunset"},
		},
		{
			name:  "tags with spaces, text before prefix, no semicolon",
			input: "Taken in summer. tags:warm afternoon, golden hour",
			want:  []string{"warm afternoon", "golden hour"},
		},
		{
			name:  "semicolon terminates before text that looks like extra tags",
			input: "tags:alpha, beta; ignore this tag:gamma",
			want:  []string{"alpha", "beta"},
		},
		// --- extended path: plain comma-separated keyword list (IPTC/XMP) ---
		{
			name:  "plain keyword list — two values",
			input: "nature, landscape",
			want:  []string{"nature", "landscape"},
		},
		{
			name:  "plain keyword list — three values with mixed case",
			input: "Portrait, Indoor, Street Photography",
			want:  []string{"Portrait", "Indoor", "Street Photography"},
		},
		{
			name:  "plain keyword list — extra whitespace",
			input: "  black and white ,  architecture  , urban",
			want:  []string{"black and white", "architecture", "urban"},
		},
		{
			name:  "plain keyword list — multi-word tokens",
			input: "New York, Black & White, Golden Hour",
			want:  []string{"New York", "Black & White", "Golden Hour"},
		},
		{
			name:  "extended path blocked by period",
			input: "A beautiful photo. Taken in 2024.",
			want:  nil,
		},
		{
			name:  "extended path blocked by exclamation mark",
			input: "Wow! Great shot, fantastic light",
			want:  nil,
		},
		{
			name:  "extended path blocked by question mark",
			input: "Is this Paris?, London",
			want:  nil,
		},
		{
			name:  "extended path blocked — no comma (single plain value)",
			input: "Summer vacation",
			want:  nil,
		},
		{
			name:  "extended path blocked — token exceeds 50 runes",
			input: "nature, this is a very long keyword that is definitely too long to be a real keyword tag value",
			want:  nil,
		},
		{
			name:  "tags: prefix wins over extended path",
			input: "tags:alpha, beta",
			want:  []string{"alpha", "beta"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseTagsFromDescription(tt.input)
			if len(got) != len(tt.want) {
				t.Fatalf("parseTagsFromDescription(%q) = %v (len %d), want %v (len %d)",
					tt.input, got, len(got), tt.want, len(tt.want))
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("parseTagsFromDescription(%q)[%d] = %q, want %q",
						tt.input, i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestIsImagePath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		// image extensions — must return true
		{"/media/photo.jpg", true},
		{"/media/photo.jpeg", true},
		{"/media/photo.JPG", true},  // case-insensitive
		{"/media/photo.JPEG", true}, // case-insensitive
		{"/media/photo.tif", true},
		{"/media/photo.tiff", true},
		{"/media/photo.heic", true},
		{"/media/photo.heif", true},
		{"/media/photo.avif", true},
		{"/media/photo.webp", true},
		{"/media/photo.png", true},
		// non-image extensions — must return false (no exiftool fallback)
		{"/media/video.mp4", false},
		{"/media/video.mov", false},
		{"/media/video.avi", false},
		{"/media/audio.mp3", false},
		{"/media/document.pdf", false},
		{"/media/playlist.wpl", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := isImagePath(tt.path); got != tt.want {
				t.Errorf("isImagePath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestLooksLikeKeywordList(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		// should be detected as keyword lists
		{"nature, landscape", true},
		{"Portrait, Indoor", true},
		{"New York, Black & White, Street Photography", true},
		{"  alpha ,   beta  ", true},
		{"a, b, c", true},
		// should NOT be detected
		{"", false},                // empty
		{"Summer vacation", false}, // no comma
		{"nature", false},          // single value, no comma
		{"A beautiful photo. Taken in 2024.", false},       // period
		{"Great shot! Amazing light, vivid colors", false}, // exclamation mark
		{"Is this Paris?, London", false},                  // question mark
		{"tags:nature, landscape", false},                  // has tags: prefix (primary path handles it)
		{"TAGS:nature, landscape", false},                  // uppercase TAGS: also blocked
		{"Tags:foo, bar", false},                           // title-case Tags: also blocked
		// token > 50 runes blocks extended path
		{"nature, this is a very long keyword that is definitely more than fifty characters long", false},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := looksLikeKeywordList(tt.input); got != tt.want {
				t.Errorf("looksLikeKeywordList(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}
