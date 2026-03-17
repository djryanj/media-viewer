package mediatypes

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIsGIFHeader(t *testing.T) {
	tests := []struct {
		name string
		buf  []byte
		want bool
	}{
		{
			name: "GIF89a magic",
			buf:  []byte{'G', 'I', 'F', '8', '9', 'a', 0, 0},
			want: true,
		},
		{
			name: "GIF87a magic",
			buf:  []byte{'G', 'I', 'F', '8', '7', 'a', 0, 0},
			want: true,
		},
		{
			name: "JPEG magic",
			buf:  []byte{0xFF, 0xD8, 0xFF, 0xE0, 0, 0},
			want: false,
		},
		{
			name: "PNG magic",
			buf:  []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A},
			want: false,
		},
		{
			name: "MP4 magic (ftyp box)",
			buf:  []byte{0, 0, 0, 0x18, 'f', 't'},
			want: false,
		},
		{
			name: "empty buffer",
			buf:  []byte{},
			want: false,
		},
		{
			name: "buffer shorter than 6 bytes",
			buf:  []byte{'G', 'I', 'F'},
			want: false,
		},
		{
			name: "all zeroes",
			buf:  []byte{0, 0, 0, 0, 0, 0},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isGIFHeader(tt.buf)
			if got != tt.want {
				t.Errorf("isGIFHeader(%v) = %v, want %v", tt.buf, got, tt.want)
			}
		})
	}
}

func TestSniffFileType(t *testing.T) {
	dir := t.TempDir()

	writeFile := func(name string, content []byte) string {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, content, 0o600); err != nil {
			t.Fatalf("writeFile %s: %v", name, err)
		}
		return path
	}

	gif89Header := []byte("GIF89a\x00\x00\x00\x00\x00\x00") // minimal GIF89a header
	gif87Header := []byte("GIF87a\x00\x00\x00\x00\x00\x00") // minimal GIF87a header
	jpegHeader := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F'}
	tooShort := []byte{0x47, 0x49} // only 2 bytes

	tests := []struct {
		name         string
		path         string
		wantType     FileType
		wantMime     string
		wantOverride bool
	}{
		{
			name:         "GIF89a content with .jpg extension",
			path:         writeFile("reddit.jpg", gif89Header),
			wantType:     FileTypeVideo,
			wantMime:     "video/mp4",
			wantOverride: true,
		},
		{
			name:         "GIF87a content",
			path:         writeFile("anim.gif", gif87Header),
			wantType:     FileTypeVideo,
			wantMime:     "video/mp4",
			wantOverride: true,
		},
		{
			name:         "genuine JPEG file",
			path:         writeFile("photo.jpg", jpegHeader),
			wantType:     FileTypeOther,
			wantMime:     "",
			wantOverride: false,
		},
		{
			name:         "file too short to sniff",
			path:         writeFile("tiny.jpg", tooShort),
			wantType:     FileTypeOther,
			wantMime:     "",
			wantOverride: false,
		},
		{
			name:         "non-existent file",
			path:         filepath.Join(dir, "missing.jpg"),
			wantType:     FileTypeOther,
			wantMime:     "",
			wantOverride: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotType, gotMime, gotOverride := SniffFileType(tt.path)
			if gotOverride != tt.wantOverride {
				t.Errorf("SniffFileType(%q) override = %v, want %v", tt.path, gotOverride, tt.wantOverride)
			}
			if gotOverride {
				if gotType != tt.wantType {
					t.Errorf("SniffFileType(%q) type = %q, want %q", tt.path, gotType, tt.wantType)
				}
				if gotMime != tt.wantMime {
					t.Errorf("SniffFileType(%q) mime = %q, want %q", tt.path, gotMime, tt.wantMime)
				}
			}
		})
	}
}
