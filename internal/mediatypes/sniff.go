package mediatypes

import (
	"io"
	"os"
)

// gifMagic holds the two valid GIF header signatures (GIF87a and GIF89a).
var gifMagic = [2][6]byte{
	{'G', 'I', 'F', '8', '7', 'a'},
	{'G', 'I', 'F', '8', '9', 'a'},
}

// isGIFHeader returns true when buf begins with a GIF87a or GIF89a magic sequence.
func isGIFHeader(buf []byte) bool {
	if len(buf) < 6 {
		return false
	}
	for _, magic := range gifMagic {
		if buf[0] == magic[0] && buf[1] == magic[1] && buf[2] == magic[2] &&
			buf[3] == magic[3] && buf[4] == magic[4] && buf[5] == magic[5] {
			return true
		}
	}
	return false
}

// SniffFileType probes the first bytes of the file at path and returns an
// overriding (FileType, mimeType) when the content-detected type differs from
// what the file extension would imply. The boolean return value is true only
// when an override should be applied.
//
// Currently detects:
//   - GIF87a / GIF89a → FileTypeVideo / "video/mp4"
//     GIFs are animated and are transcoded on-the-fly to MP4 so the browser
//     can use native video controls (play/pause, scrubbing, seeking).
//
// Any I/O error or unrecognized file content returns (FileTypeOther, "", false),
// telling the caller to keep the extension-derived classification.
func SniffFileType(path string) (FileType, string, bool) {
	f, err := os.Open(path) //nolint:gosec // path is validated by the caller before indexing
	if err != nil {
		return FileTypeOther, "", false
	}
	defer func() { _ = f.Close() }()

	var buf [6]byte
	n, err := io.ReadAtLeast(f, buf[:], 6)
	if err != nil || n < 6 {
		return FileTypeOther, "", false
	}

	if isGIFHeader(buf[:]) {
		return FileTypeVideo, "video/mp4", true
	}

	return FileTypeOther, "", false
}
