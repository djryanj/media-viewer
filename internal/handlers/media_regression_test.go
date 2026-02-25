package handlers

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"media-viewer/internal/database"

	"github.com/gorilla/mux"
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
		{"HTML content", []byte("<html>not an image</html>")},
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

// =============================================================================
// Regression Tests: URL-Encoded Path Decoding
//
// The database stores filenames without URL encoding (e.g. "My Photos/image (1).jpg").
// The frontend sends URL-encoded paths (e.g. "My%20Photos/image%20%281%29.jpg").
// All handlers that extract a path from mux vars must decode it before using it
// for filesystem access or database lookups.
//
// These tests verify that the decodePath helper and all affected handlers
// correctly handle URL-encoded paths.
// =============================================================================

// TestDecodePath_PlainPath verifies that paths without encoding pass through unchanged.
func TestDecodePath_PlainPath(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/file/simple.jpg", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "simple.jpg"})
	w := httptest.NewRecorder()

	decoded, ok := decodePath(w, req)
	if !ok {
		t.Fatal("decodePath returned false for a plain path")
	}
	if decoded != "simple.jpg" {
		t.Errorf("expected %q, got %q", "simple.jpg", decoded)
	}
}

// TestDecodePath_URLEncodedSpaces verifies that decodePath passes through
// the mux var unchanged. In production, mux already decoded %20 to spaces
// before populating the var.
func TestDecodePath_URLEncodedSpaces(t *testing.T) {
	t.Parallel()

	// Mux already decoded "My%20Photos/vacation%20pic.jpg" → "My Photos/vacation pic.jpg"
	req := httptest.NewRequest(http.MethodGet, "/api/file/test", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "My Photos/vacation pic.jpg"})
	w := httptest.NewRecorder()

	decoded, ok := decodePath(w, req)
	if !ok {
		t.Fatal("decodePath returned false")
	}

	expected := "My Photos/vacation pic.jpg"
	if decoded != expected {
		t.Errorf("expected %q, got %q", expected, decoded)
	}
}

// TestDecodePath_URLEncodedSpecialCharacters verifies that decodePath passes
// through the mux var unchanged. In production, gorilla/mux decodes the
// request URI before populating vars, so by the time decodePath sees the
// value, all percent-encoding from the URL has already been resolved.
// Any remaining percent sequences are literal characters in the filename.
func TestDecodePath_URLEncodedSpecialCharacters(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		// muxVar is what gorilla/mux provides after its single decode.
		// This matches the actual filename on disk and in the database.
		muxVar string
	}{
		{
			name:   "parentheses",
			muxVar: "image (1).jpg",
		},
		{
			name:   "plus sign",
			muxVar: "file+name.jpg",
		},
		{
			name:   "hash",
			muxVar: "photo#tag.jpg",
		},
		{
			name:   "ampersand",
			muxVar: "Tom & Jerry.jpg",
		},
		{
			name:   "nested folder with spaces",
			muxVar: "My Folder/Sub Folder/file name.jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/api/file/test", http.NoBody)
			req = mux.SetURLVars(req, map[string]string{"path": tt.muxVar})
			w := httptest.NewRecorder()

			decoded, ok := decodePath(w, req)
			if !ok {
				t.Fatalf("decodePath returned false for %q", tt.muxVar)
			}
			if decoded != tt.muxVar {
				t.Errorf("decodePath should pass through unchanged.\n"+
					"  input:  %q\n"+
					"  output: %q", tt.muxVar, decoded)
			}
		})
	}
}

// TestDecodePath_EncodedTraversalStillCaught verifies that URL-encoded path
// traversal attempts are decoded and then caught by downstream validation.
// decodePath itself decodes successfully — the traversal is caught by
// filepath.IsAbs / isSubPath checks in the handler.
func TestDecodePath_EncodedTraversalDecodes(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/file/../../etc/passwd", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "../../etc/passwd"})
	w := httptest.NewRecorder()

	decoded, ok := decodePath(w, req)
	if !ok {
		t.Fatal("decodePath returned false — it should decode successfully; traversal is caught downstream")
	}

	expected := "../../etc/passwd"
	if decoded != expected {
		t.Errorf("expected %q, got %q", expected, decoded)
	}
}

// TestDecodePath_DoubleEncodedPath verifies that decodePath passes through
// the mux var unchanged. In production, if the frontend double-encodes a path
// (e.g. %2520), gorilla/mux decodes it once to %20 before populating the var.
// decodePath must not decode again, because %20 may be a literal part of the
// filename on disk.
func TestDecodePath_DoubleEncodedPath(t *testing.T) {
	t.Parallel()

	// Mux already decoded %2520 → %20 before we see it.
	// The file on disk is literally named "file%20name.jpg".
	// decodePath must preserve this.
	req := httptest.NewRequest(http.MethodGet, "/api/file/test", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "file%20name.jpg"})
	w := httptest.NewRecorder()

	decoded, ok := decodePath(w, req)
	if !ok {
		t.Fatal("decodePath returned false for path with literal percent")
	}

	expected := "file%20name.jpg"
	if decoded != expected {
		t.Errorf("REGRESSION: decodePath modified the path.\n"+
			"  expected: %q\n  got:      %q\n"+
			"  decodePath must not decode — mux already decoded once", expected, decoded)
	}
}

// TestDecodePath_EmptyPath verifies that an empty path decodes to empty string.
func TestDecodePath_EmptyPath(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/file/", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": ""})
	w := httptest.NewRecorder()

	decoded, ok := decodePath(w, req)
	if !ok {
		t.Fatal("decodePath returned false for empty path")
	}
	if decoded != "" {
		t.Errorf("expected empty string, got %q", decoded)
	}
}

// =============================================================================
// End-to-end regression: GetFile with URL-encoded paths
// =============================================================================

// TestGetFile_URLEncodedPath_RegressionIntegration is a regression test that
// verifies files with spaces in their names can be served when the frontend
// sends a URL-encoded path. In production, gorilla/mux decodes the request
// URI once before populating path vars, so the handler receives the decoded
// form. We simulate that here.
func TestGetFile_URLEncodedPath_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Create a file with spaces in the name
	testContent := "photo with spaces content"
	addTestMediaFile(t, h, "my photo.jpg", database.FileTypeImage, testContent)

	// The frontend sends an encoded URL, but gorilla/mux decodes it once
	// before we see it. So the mux var contains the decoded filename.
	encodedPath := url.PathEscape("my photo.jpg") // "my%20photo.jpg"

	req := httptest.NewRequest(http.MethodGet, "/api/file/"+encodedPath, http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "my photo.jpg"}) // mux already decoded
	w := httptest.NewRecorder()

	h.GetFile(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("REGRESSION: GetFile returned status %d for file with spaces — "+
			"mux should have decoded the path before the handler sees it",
			w.Code)
	}

	body := w.Body.String()
	if body != testContent {
		t.Errorf("expected content %q, got %q", testContent, body)
	}
}

// TestGetFile_URLEncodedSubdirectory_RegressionIntegration tests URL-encoded
// paths that include subdirectories with spaces.
func TestGetFile_URLEncodedSubdirectory_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	testContent := "nested photo content"
	addTestMediaFile(t, h, "My Photos/vacation pic.jpg", database.FileTypeImage, testContent)

	// URL must be properly encoded for httptest.NewRequest, but the mux var
	// contains the decoded form (what gorilla/mux provides after its decode).
	req := httptest.NewRequest(http.MethodGet, "/api/file/"+url.PathEscape("My Photos")+"/"+url.PathEscape("vacation pic.jpg"), http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "My Photos/vacation pic.jpg"})
	w := httptest.NewRecorder()

	h.GetFile(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("REGRESSION: GetFile returned status %d for URL-encoded subdirectory path",
			w.Code)
	}

	body := w.Body.String()
	if body != testContent {
		t.Errorf("expected content %q, got %q", testContent, body)
	}
}

// TestGetFile_URLEncodedDownload_RegressionIntegration verifies that the
// Content-Disposition header uses the decoded filename, not the encoded one.
func TestGetFile_URLEncodedDownload_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	testContent := "download content"
	addTestMediaFile(t, h, "my photo.jpg", database.FileTypeImage, testContent)

	req := httptest.NewRequest(http.MethodGet, "/api/file/my%20photo.jpg?download=true", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "my photo.jpg"}) // mux already decoded
	w := httptest.NewRecorder()

	h.GetFile(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	contentDisposition := w.Header().Get("Content-Disposition")
	expectedDisposition := `attachment; filename="my photo.jpg"`
	if contentDisposition != expectedDisposition {
		t.Errorf("REGRESSION: Content-Disposition has encoded filename.\n"+
			"  expected: %s\n  got:      %s", expectedDisposition, contentDisposition)
	}
}

// =============================================================================
// End-to-end regression: StreamVideo with URL-encoded paths
// =============================================================================

// TestStreamVideo_URLEncodedPath_RegressionIntegration verifies that StreamVideo
// works with paths that mux has already decoded.
func TestStreamVideo_URLEncodedPath_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Mux decodes the URL — the var contains the decoded path.
	// File doesn't exist, so we expect 404 (not 400 from bad path).
	req := httptest.NewRequest(http.MethodGet, "/api/stream/"+url.PathEscape("My Videos")+"/"+url.PathEscape("clip (1).mp4"), http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "My Videos/clip (1).mp4"})
	w := httptest.NewRecorder()

	h.StreamVideo(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 (file not found), got %d", w.Code)
	}
}

// =============================================================================
// End-to-end regression: InvalidateThumbnail with URL-encoded paths
// =============================================================================

// TestInvalidateThumbnail_URLEncodedPath_RegressionIntegration verifies that
// InvalidateThumbnail works with mux-decoded paths.
func TestInvalidateThumbnail_URLEncodedPath_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Mux decodes the URL — the var contains the decoded path.
	// Thumbnails are disabled, so we expect 503 (not 400 from bad path).
	req := httptest.NewRequest(http.MethodDelete, "/api/thumbnail/"+url.PathEscape("My Photos")+"/"+url.PathEscape("image (1).jpg"), http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "My Photos/image (1).jpg"})
	w := httptest.NewRecorder()

	h.InvalidateThumbnail(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503 (thumbnails disabled), got %d", w.Code)
	}
}

// =============================================================================
// End-to-end regression: GetThumbnail with URL-encoded paths
// =============================================================================

// TestGetThumbnail_URLEncodedPath_RegressionIntegration verifies that
// GetThumbnail works with mux-decoded paths.
func TestGetThumbnail_URLEncodedPath_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Mux decodes the URL — the var contains the decoded path.
	// Thumbnails are disabled, so we expect 503 (not 400).
	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/"+url.PathEscape("photo album")+"/"+url.PathEscape("sunset (2).jpg"), http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "photo album/sunset (2).jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503 (thumbnails disabled), got %d", w.Code)
	}
}

// =============================================================================
// End-to-end regression: GetStreamInfo with URL-encoded paths
// =============================================================================

// TestGetStreamInfo_URLEncodedPath_RegressionIntegration verifies that
// GetStreamInfo works with mux-decoded paths.
func TestGetStreamInfo_URLEncodedPath_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Mux decodes the URL — the var contains the decoded path.
	// File doesn't exist, so ffprobe fails → 500 (not 400).
	req := httptest.NewRequest(http.MethodGet, "/api/stream-info/"+url.PathEscape("My Videos")+"/"+url.PathEscape("clip.mp4"), http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "My Videos/clip.mp4"})
	w := httptest.NewRecorder()

	h.GetStreamInfo(w, req)

	if w.Code == http.StatusBadRequest {
		t.Errorf("REGRESSION: GetStreamInfo returned 400 — path validation failed on decoded path")
	}

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500 (ffprobe failure), got %d", w.Code)
	}
}

// TestDecodePath_PreservesPercentEncoding is a regression test verifying that
// decodePath does NOT double-decode paths. Filenames on disk (and in the DB)
// may contain literal percent-encoded sequences like %21. Mux already decodes
// the request URI once, producing the form that matches disk and DB. A second
// decode would corrupt the path.
// TestDecodePath_PreservesPercentEncoding is a regression test verifying that
// decodePath does NOT double-decode paths. The database and filesystem store
// filenames with literal percent-encoded characters (e.g. "file%21.jpg").
// Mux already decodes the request URI once, producing the DB/filesystem form.
// A second decode would break lookups.
func TestDecodePath_PreservesPercentEncoding(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		muxVar   string
		expected string
	}{
		{
			name:     "percent-encoded exclamation mark preserved",
			muxVar:   "yummy_cake%21.jpg",
			expected: "yummy_cake%21.jpg",
		},
		{
			name:     "percent-encoded space preserved",
			muxVar:   "My%20Photos/image.jpg",
			expected: "My%20Photos/image.jpg",
		},
		{
			name:     "already decoded spaces preserved",
			muxVar:   "My Photos/image.jpg",
			expected: "My Photos/image.jpg",
		},
		{
			name:     "mixed encoded and plain characters",
			muxVar:   "folder/file%23name%20(1).jpg",
			expected: "folder/file%23name%20(1).jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/api/file/test", http.NoBody)
			req = mux.SetURLVars(req, map[string]string{"path": tt.muxVar})
			w := httptest.NewRecorder()

			decoded, ok := decodePath(w, req)
			if !ok {
				t.Fatalf("decodePath returned false for %q", tt.muxVar)
			}
			if decoded != tt.expected {
				t.Errorf("REGRESSION: decodePath altered the path.\n"+
					"  input:    %q\n"+
					"  expected: %q\n"+
					"  got:      %q", tt.muxVar, tt.expected, decoded)
			}
		})
	}
}

// TestGetThumbnail_LiteralPercentPlusDBLookup_RegressionIntegration verifies
// that GetThumbnail's DB lookup fallback works for filenames with literal %2B
// on disk, where mux decoded %2B to +. This was the specific production bug:
// url.PathEscape considers + safe, so the old reEncodePath didn't re-encode it.
func TestGetThumbnail_LiteralPercentPlusDBLookup_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	literalName := "207803-Beached%2BWhales.jpg"
	fullPath := filepath.Join(h.mediaDir, literalName)
	if err := os.WriteFile(fullPath, []byte("image data"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}
	addExistingFileToDatabase(t, h, literalName, database.FileTypeImage)

	// Mux decoded %2B → +
	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/test", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "207803-Beached+Whales.jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// 503 = thumbnails disabled = path + DB lookup both succeeded
	// 404 = REGRESSION: DB lookup failed because + was not re-encoded to %2B
	if w.Code == http.StatusNotFound {
		t.Errorf("REGRESSION: GetThumbnail returned 404 — DB lookup failed for file with "+
			"literal %%2B in name. encodePathSegment should encode + to %%2B so the "+
			"re-encoded path %q matches the database.", literalName)
	}

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503 (thumbnails disabled), got %d", w.Code)
	}
}

// TestGetThumbnail_LiteralPercentApostropheDBLookup_RegressionIntegration verifies
// that GetThumbnail's DB lookup fallback works for filenames with literal %27
// on disk, where mux decoded %27 to '.
func TestGetThumbnail_LiteralPercentApostropheDBLookup_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	literalName := "Big_N%27_Tall_1.jpg"
	fullPath := filepath.Join(h.mediaDir, literalName)
	if err := os.WriteFile(fullPath, []byte("image data"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}
	addExistingFileToDatabase(t, h, literalName, database.FileTypeImage)

	// Mux decoded %27 → '
	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/test", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "Big_N'_Tall_1.jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	if w.Code == http.StatusNotFound {
		t.Errorf("REGRESSION: GetThumbnail returned 404 — DB lookup failed for file with "+
			"literal %%27 in name. encodePathSegment should encode ' to %%27 so the "+
			"re-encoded path %q matches the database.", literalName)
	}

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503 (thumbnails disabled), got %d", w.Code)
	}
}
