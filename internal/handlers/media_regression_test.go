package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"media-viewer/internal/database"
)

// =============================================================================
// Regression Test: Thumbnail Validation Must Accept Both JPEG and PNG
// =============================================================================

// TestWriteThumbnailResponse_RegressionJPEGNotRejected is a regression test for a bug
// where thumbnail validation only checked for PNG headers. Since non-folder thumbnails
// are served as image/jpeg, valid JPEG thumbnails were silently dropped, resulting in
// empty responses. This test ensures both formats are accepted in the full response path.
func TestWriteThumbnailResponse_RegressionJPEGNotRejected(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		fileType database.FileType
		thumb    []byte
		format   string
	}{
		{
			name:     "Image file produces JPEG thumbnail - must not be rejected",
			fileType: database.FileTypeImage,
			thumb:    validJPEG(),
			format:   "image/jpeg",
		},
		{
			name:     "Video file produces JPEG thumbnail - must not be rejected",
			fileType: database.FileTypeVideo,
			thumb:    validJPEG(),
			format:   "image/jpeg",
		},
		{
			name:     "Folder produces PNG thumbnail - must not be rejected",
			fileType: database.FileTypeFolder,
			thumb:    validPNG(),
			format:   "image/png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/test", http.NoBody)
			w := httptest.NewRecorder()

			writeThumbnailResponse(w, req, "test", tt.fileType, tt.thumb)

			// The critical assertion: valid thumbnails MUST produce a non-empty response.
			// The original bug caused this to be 0 for JPEG thumbnails.
			if w.Body.Len() == 0 {
				t.Errorf("REGRESSION: valid %s thumbnail was rejected — response body is empty. "+
					"The validation likely only checks for PNG headers and rejects JPEG.", tt.format)
			}

			if w.Body.Len() != len(tt.thumb) {
				t.Errorf("expected %d bytes written, got %d", len(tt.thumb), w.Body.Len())
			}

			contentType := w.Header().Get("Content-Type")
			if contentType != tt.format {
				t.Errorf("expected Content-Type %q, got %q", tt.format, contentType)
			}
		})
	}
}

// TestWriteThumbnailResponse_RegressionInvalidFormatStillRejected verifies that the fix
// for accepting JPEG thumbnails did not accidentally weaken validation — non-image data
// must still be rejected.
func TestWriteThumbnailResponse_RegressionInvalidFormatStillRejected(t *testing.T) {
	t.Parallel()

	invalidPayloads := []struct {
		name string
		data []byte
	}{
		{"random bytes", []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09}},
		{"GIF header", []byte{0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00}},
		{"text content", []byte("this is not an image")},
		{"HTML content", []byte("<html><body>not an image</body></html>")},
		{"almost JPEG - wrong second byte", []byte{0xFF, 0xD9, 0xFF, 0xE0, 0x00, 0x10}},
		{"almost PNG - wrong first byte", []byte{0x88, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00}},
	}

	for _, tt := range invalidPayloads {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/test", http.NoBody)
			w := httptest.NewRecorder()

			writeThumbnailResponse(w, req, "test", database.FileTypeImage, tt.data)

			if w.Body.Len() != 0 {
				t.Errorf("invalid payload %q should have been rejected but %d bytes were written",
					tt.name, w.Body.Len())
			}
		})
	}
}
