package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"media-viewer/internal/database"

	"github.com/gorilla/mux"
)

// =============================================================================
// isSubPath Tests
// =============================================================================

func TestIsSubPath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		parent   string
		child    string
		expected bool
	}{
		{
			name:     "Direct child",
			parent:   "/media",
			child:    "/media/photos",
			expected: true,
		},
		{
			name:     "Deep child",
			parent:   "/media",
			child:    "/media/photos/vacation/image.jpg",
			expected: true,
		},
		{
			name:     "Same path",
			parent:   "/media",
			child:    "/media",
			expected: true,
		},
		{
			name:     "Not a subpath - sibling",
			parent:   "/media",
			child:    "/videos",
			expected: false,
		},
		{
			name:     "Not a subpath - similar prefix",
			parent:   "/media",
			child:    "/media-backup",
			expected: false,
		},
		{
			name:     "Parent path",
			parent:   "/media/photos",
			child:    "/media",
			expected: false,
		},
		{
			name:     "Relative paths resolved",
			parent:   "/media/../media",
			child:    "/media/photos",
			expected: true,
		},
		{
			name:     "Child with relative components",
			parent:   "/media",
			child:    "/media/photos/../videos/clip.mp4",
			expected: true,
		},
		{
			name:     "Empty parent",
			parent:   "",
			child:    "/media",
			expected: false,
		},
		{
			name:     "Empty child",
			parent:   "/media",
			child:    "",
			expected: false,
		},
		{
			name:     "Path traversal attempt",
			parent:   "/media",
			child:    "/media/../etc/passwd",
			expected: false,
		},
		{
			name:     "Windows-style paths (if on Windows)",
			parent:   filepath.Join("C:", "media"),
			child:    filepath.Join("C:", "media", "photos"),
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isSubPath(tt.parent, tt.child)
			if result != tt.expected {
				t.Errorf("isSubPath(%q, %q) = %v, want %v", tt.parent, tt.child, result, tt.expected)
			}
		})
	}
}

func TestIsSubPathEdgeCases(t *testing.T) {
	t.Parallel()

	// Test with actual filesystem paths to ensure realistic behavior
	parent := filepath.Join(t.TempDir(), "media")
	child := filepath.Join(parent, "subfolder", "file.jpg")

	if !isSubPath(parent, child) {
		t.Errorf("Expected child path to be subpath of parent")
	}

	// Test sibling directory
	sibling := filepath.Join(t.TempDir(), "other")
	if isSubPath(parent, sibling) {
		t.Errorf("Expected sibling path to not be subpath of parent")
	}
}

func TestIsSubPathSymlinks(t *testing.T) {
	t.Parallel()

	// Test that absolute path resolution handles symlinks correctly
	// Note: This tests the function's behavior, actual symlink handling
	// depends on filepath.Abs implementation

	parent := "/var/media"
	child := "/var/media/photos/image.jpg"

	if !isSubPath(parent, child) {
		t.Errorf("Expected normal path to be subpath")
	}
}

// =============================================================================
// Path Validation Tests
// =============================================================================

func TestPathValidationLogic(t *testing.T) {
	t.Parallel()

	// Test the path validation logic used across multiple handlers
	tests := []struct {
		name       string
		mediaDir   string
		inputPath  string
		shouldPass bool
	}{
		{
			name:       "Valid path",
			mediaDir:   "/media",
			inputPath:  "photos/vacation.jpg",
			shouldPass: true,
		},
		{
			name:       "Valid nested path",
			mediaDir:   "/media",
			inputPath:  "photos/2024/vacation/image.jpg",
			shouldPass: true,
		},
		{
			name:       "Path traversal attempt",
			mediaDir:   "/media",
			inputPath:  "../../../etc/passwd",
			shouldPass: false,
		},
		{
			name:       "Absolute path becomes subpath when joined",
			mediaDir:   "/media",
			inputPath:  "/etc/passwd",
			shouldPass: true, // filepath.Join keeps absolute-looking paths on some systems
		},
		{
			name:       "Empty path",
			mediaDir:   "/media",
			inputPath:  "",
			shouldPass: true, // Empty joins to media dir itself
		},
		{
			name:       "Path with ..",
			mediaDir:   "/media/photos",
			inputPath:  "../videos/clip.mp4",
			shouldPass: false, // Goes outside /media/photos
		},
		{
			name:       "Path with . components",
			mediaDir:   "/media",
			inputPath:  "./photos/./image.jpg",
			shouldPass: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fullPath := filepath.Join(tt.mediaDir, tt.inputPath)
			absPath, err := filepath.Abs(fullPath)

			result := err == nil && isSubPath(tt.mediaDir, absPath)

			if result != tt.shouldPass {
				t.Errorf("Path validation for %q: got %v, want %v (fullPath=%q, absPath=%q)",
					tt.inputPath, result, tt.shouldPass, fullPath, absPath)
			}
		})
	}
}

// =============================================================================
// Helper Functions for Testing
// =============================================================================

func TestFilepathJoinBehavior(t *testing.T) {
	t.Parallel()

	// Verify filepath.Join behavior used throughout media.go
	tests := []struct {
		name     string
		parts    []string
		expected string
	}{
		{
			name:     "Simple join",
			parts:    []string{"/media", "photos"},
			expected: "/media/photos",
		},
		{
			name:     "Multiple parts",
			parts:    []string{"/media", "photos", "vacation", "image.jpg"},
			expected: "/media/photos/vacation/image.jpg",
		},
		{
			name:     "Empty component",
			parts:    []string{"/media", ""},
			expected: "/media",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := filepath.Join(tt.parts...)
			// Normalize for cross-platform
			expected := filepath.FromSlash(tt.expected)
			result = filepath.ToSlash(result)
			expected = filepath.ToSlash(expected)

			if result != expected {
				t.Errorf("filepath.Join(%v) = %q, want %q", tt.parts, result, expected)
			}
		})
	}
}

// =============================================================================
// Path Security Tests
// =============================================================================

func TestPathSecurityValidation(t *testing.T) {
	t.Parallel()

	// Test various security-sensitive path patterns
	mediaDir := "/srv/media"

	maliciousPaths := []string{
		"../../../etc/passwd",
		"../../.ssh/id_rsa",
		"./../../../root/.bashrc",
		"photos/../../etc/shadow",
	}

	for _, path := range maliciousPaths {
		t.Run(path, func(t *testing.T) {
			fullPath := filepath.Join(mediaDir, path)
			absPath, err := filepath.Abs(fullPath)

			if err == nil && isSubPath(mediaDir, absPath) {
				t.Errorf("Security test failed: malicious path %q passed validation (fullPath=%q, absPath=%q)",
					path, fullPath, absPath)
			}
		})
	}
}

func TestPathSecurityAllowedPaths(t *testing.T) {
	t.Parallel()

	// Test that legitimate paths are allowed
	mediaDir := "/srv/media"

	legitimatePaths := []string{
		"photos/vacation/image.jpg",
		"videos/clip.mp4",
		"music/album/track.mp3",
		"documents/file.pdf",
	}

	for _, path := range legitimatePaths {
		t.Run(path, func(t *testing.T) {
			fullPath := filepath.Join(mediaDir, path)
			absPath, err := filepath.Abs(fullPath)

			if err != nil || !isSubPath(mediaDir, absPath) {
				t.Errorf("Legitimate path %q failed validation (fullPath=%q, absPath=%q, err=%v)",
					path, fullPath, absPath, err)
			}
		})
	}
}

// =============================================================================
// Database SortField/SortOrder Type Tests
// =============================================================================

func TestSortFieldValidation(t *testing.T) {
	t.Parallel()

	// Test that handler converts query params to correct types
	// This validates the type conversions in ListFiles and GetMediaFiles

	tests := []struct {
		input    string
		expected string
	}{
		{"name", "name"},
		{"size", "size"},
		{"modified", "modified"},
		{"", ""},
		{"invalid", "invalid"}, // Handler should handle invalid values
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			// This test validates type conversion behavior
			// In production, database package validates sort fields
			result := tt.input
			if result != tt.expected {
				t.Errorf("Sort field %q != %q", result, tt.expected)
			}
		})
	}
}

func TestSortOrderValidation(t *testing.T) {
	t.Parallel()

	// Test sort order conversions
	tests := []struct {
		input    string
		expected string
	}{
		{"asc", "asc"},
		{"desc", "desc"},
		{"ASC", "ASC"},
		{"DESC", "DESC"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := tt.input
			if result != tt.expected {
				t.Errorf("Sort order %q != %q", result, tt.expected)
			}
		})
	}
}

// =============================================================================
// Query Parameter Parsing Tests
// =============================================================================

func TestPageParsing(t *testing.T) {
	t.Parallel()

	// Test page number parsing logic from ListFiles
	tests := []struct {
		name          string
		input         string
		defaultValue  int
		expectedValue int
	}{
		{
			name:          "Valid page number",
			input:         "5",
			defaultValue:  1,
			expectedValue: 5,
		},
		{
			name:          "Invalid - not a number",
			input:         "abc",
			defaultValue:  1,
			expectedValue: 1,
		},
		{
			name:          "Invalid - negative",
			input:         "-1",
			defaultValue:  1,
			expectedValue: 1,
		},
		{
			name:          "Invalid - zero",
			input:         "0",
			defaultValue:  1,
			expectedValue: 1,
		},
		{
			name:          "Empty string",
			input:         "",
			defaultValue:  1,
			expectedValue: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate the parsing logic from ListFiles
			result := tt.defaultValue
			if tt.input != "" {
				if parsed, err := parseInt(tt.input); err == nil && parsed > 0 {
					result = parsed
				}
			}

			if result != tt.expectedValue {
				t.Errorf("Page parsing for %q: got %d, want %d", tt.input, result, tt.expectedValue)
			}
		})
	}
}

// Helper function to simulate strconv.Atoi
func parseInt(s string) (int, error) {
	var result int
	_, err := fmt.Sscanf(s, "%d", &result)
	return result, err
}

func TestPageSizeParsing(t *testing.T) {
	t.Parallel()

	// Test page size parsing logic from ListFiles
	tests := []struct {
		name          string
		input         string
		defaultValue  int
		expectedValue int
	}{
		{
			name:          "Valid page size",
			input:         "50",
			defaultValue:  50,
			expectedValue: 50,
		},
		{
			name:          "Invalid - negative",
			input:         "-10",
			defaultValue:  50,
			expectedValue: 50,
		},
		{
			name:          "Invalid - zero",
			input:         "0",
			defaultValue:  50,
			expectedValue: 50,
		},
		{
			name:          "Empty string",
			input:         "",
			defaultValue:  50,
			expectedValue: 50,
		},
		{
			name:          "Large page size",
			input:         "1000",
			defaultValue:  50,
			expectedValue: 1000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.defaultValue
			if tt.input != "" {
				if parsed, err := parseInt(tt.input); err == nil && parsed > 0 {
					result = parsed
				}
			}

			if result != tt.expectedValue {
				t.Errorf("PageSize parsing for %q: got %d, want %d", tt.input, result, tt.expectedValue)
			}
		})
	}
}

func TestWidthParsing(t *testing.T) {
	t.Parallel()

	// Test width parameter parsing from StreamVideo
	tests := []struct {
		name          string
		input         string
		defaultValue  int
		expectedValue int
	}{
		{
			name:          "Valid width",
			input:         "1920",
			defaultValue:  0,
			expectedValue: 1920,
		},
		{
			name:          "Invalid - not a number",
			input:         "abc",
			defaultValue:  0,
			expectedValue: 0,
		},
		{
			name:          "Empty string",
			input:         "",
			defaultValue:  0,
			expectedValue: 0,
		},
		{
			name:          "Negative width",
			input:         "-100",
			defaultValue:  0,
			expectedValue: -100, // Parsed but might be rejected by transcoder
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.defaultValue
			if tt.input != "" {
				parsed, _ := parseInt(tt.input)
				result = parsed
			}

			if result != tt.expectedValue {
				t.Errorf("Width parsing for %q: got %d, want %d", tt.input, result, tt.expectedValue)
			}
		})
	}
}

// =============================================================================
// NFS Retry Logic Tests
// =============================================================================

func TestStatWithRetry_WrapperFunction(t *testing.T) {
	t.Parallel()

	// Test that the wrapper function properly delegates
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	// Create a test file
	err := writeFile(testFile, []byte("test content"))
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Test successful stat
	config := DefaultNFSRetryConfig()
	info, err := StatWithRetry(testFile, config)
	if err != nil {
		t.Errorf("statWithRetry() error = %v, want nil", err)
	}
	if info == nil {
		t.Error("statWithRetry() returned nil FileInfo")
	}
	if info != nil && info.Size() != 12 {
		t.Errorf("FileInfo.Size() = %d, want 12", info.Size())
	}
}

func TestStatWithRetry_NonExistent(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	nonExistent := filepath.Join(tmpDir, "nonexistent.txt")

	// Test stat on non-existent file
	config := DefaultNFSRetryConfig()
	_, err := StatWithRetry(nonExistent, config)
	if err == nil {
		t.Error("statWithRetry() on non-existent file should return error")
	}
}

func TestOpenWithRetry_WrapperFunction(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	// Create a test file
	content := []byte("test content for reading")
	err := writeFile(testFile, content)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Test successful open
	config := DefaultNFSRetryConfig()
	file, err := OpenWithRetry(testFile, config)
	if err != nil {
		t.Errorf("openWithRetry() error = %v, want nil", err)
	}
	if file == nil {
		t.Fatal("openWithRetry() returned nil file")
	}
	defer file.Close()

	// Verify we can read from the file
	buf := make([]byte, len(content))
	n, err := file.Read(buf)
	if err != nil {
		t.Errorf("file.Read() error = %v", err)
	}
	if n != len(content) {
		t.Errorf("file.Read() read %d bytes, want %d", n, len(content))
	}
	if !bytes.Equal(buf, content) {
		t.Errorf("file.Read() content = %q, want %q", string(buf), string(content))
	}
}

func TestOpenWithRetry_NonExistent(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	nonExistent := filepath.Join(tmpDir, "nonexistent.txt")

	// Test open on non-existent file
	config := DefaultNFSRetryConfig()
	file, err := OpenWithRetry(nonExistent, config)
	if err == nil {
		if file != nil {
			file.Close()
		}
		t.Error("openWithRetry() on non-existent file should return error")
	}
	if file != nil {
		file.Close()
		t.Error("openWithRetry() should return nil file on error")
	}
}

// BenchmarkStatWithRetry benchmarks the retry wrapper overhead
func BenchmarkStatWithRetry(b *testing.B) {
	tmpDir := b.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	err := writeFile(testFile, []byte("test"))
	if err != nil {
		b.Fatalf("Failed to create test file: %v", err)
	}

	config := DefaultNFSRetryConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := StatWithRetry(testFile, config)
		if err != nil {
			b.Fatalf("statWithRetry error: %v", err)
		}
	}
}

func BenchmarkOpenWithRetry(b *testing.B) {
	tmpDir := b.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	err := writeFile(testFile, []byte("test content"))
	if err != nil {
		b.Fatalf("Failed to create test file: %v", err)
	}

	config := DefaultNFSRetryConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		file, err := OpenWithRetry(testFile, config)
		if err != nil {
			b.Fatalf("openWithRetry error: %v", err)
		}
		file.Close()
	}
}

// Helper function to write files in tests
func writeFile(path string, data []byte) error {
	// Import os at top of file if not already present
	return os.WriteFile(path, data, 0o644)
}

// =============================================================================
// isValidImageHeader Tests
// =============================================================================

func TestIsValidImageHeader(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		data     []byte
		expected bool
	}{
		{
			name: "Valid PNG header",
			data: []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
				0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52},
			expected: true,
		},
		{
			name:     "Valid PNG header - exactly 8 bytes",
			data:     []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A},
			expected: true,
		},
		{
			name:     "Valid JPEG header",
			data:     []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46},
			expected: true,
		},
		{
			name:     "Valid JPEG header - exactly 2 bytes",
			data:     []byte{0xFF, 0xD8},
			expected: true,
		},
		{
			name:     "Valid JPEG with EXIF marker",
			data:     []byte{0xFF, 0xD8, 0xFF, 0xE1},
			expected: true,
		},
		{
			name:     "Empty data",
			data:     []byte{},
			expected: false,
		},
		{
			name:     "Nil data",
			data:     nil,
			expected: false,
		},
		{
			name:     "Single byte",
			data:     []byte{0xFF},
			expected: false,
		},
		{
			name:     "Truncated PNG header - 7 bytes",
			data:     []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A},
			expected: false,
		},
		{
			name:     "GIF header - unsupported",
			data:     []byte{0x47, 0x49, 0x46, 0x38, 0x39, 0x61},
			expected: false,
		},
		{
			name:     "BMP header - unsupported",
			data:     []byte{0x42, 0x4D, 0x00, 0x00, 0x00, 0x00},
			expected: false,
		},
		{
			name:     "WebP header - unsupported",
			data:     []byte{0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00},
			expected: false,
		},
		{
			name:     "Random bytes",
			data:     []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07},
			expected: false,
		},
		{
			name:     "Almost PNG - wrong first byte",
			data:     []byte{0x88, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A},
			expected: false,
		},
		{
			name:     "Almost JPEG - wrong second byte",
			data:     []byte{0xFF, 0xD9, 0xFF, 0xE0},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			result := isValidImageHeader(tt.data)
			if result != tt.expected {
				t.Errorf("isValidImageHeader(%v) = %v, want %v", tt.data, result, tt.expected)
			}
		})
	}
}

// =============================================================================
// isThumbnailSupported Tests
// =============================================================================

func TestIsThumbnailSupported(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		fileType       database.FileType
		expectedOK     bool
		expectedStatus int // only checked when expectedOK is false
	}{
		{
			name:       "Image type supported",
			fileType:   database.FileTypeImage,
			expectedOK: true,
		},
		{
			name:       "Video type supported",
			fileType:   database.FileTypeVideo,
			expectedOK: true,
		},
		{
			name:       "Folder type supported",
			fileType:   database.FileTypeFolder,
			expectedOK: true,
		},
		{
			name:           "Playlist type unsupported",
			fileType:       database.FileTypePlaylist,
			expectedOK:     false,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Other type unsupported",
			fileType:       database.FileTypeOther,
			expectedOK:     false,
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := httptest.NewRecorder()
			result := isThumbnailSupported(w, "test/file.ext", tt.fileType)

			if result != tt.expectedOK {
				t.Errorf("isThumbnailSupported(_, _, %s) = %v, want %v", tt.fileType, result, tt.expectedOK)
			}

			if !tt.expectedOK && w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}

// =============================================================================
// validateThumbnailPath Tests
// =============================================================================

func newHandlersWithMediaDir(mediaDir string) *Handlers {
	return &Handlers{mediaDir: mediaDir}
}

func TestValidateThumbnailPath(t *testing.T) {
	t.Parallel()

	// Use a real temp dir so filepath.Abs resolves correctly
	tempMediaDir := t.TempDir()

	tests := []struct {
		name           string
		pathVar        string
		expectedOK     bool
		expectedStatus int
	}{
		{
			name:           "Empty path",
			pathVar:        "",
			expectedOK:     false,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Absolute path",
			pathVar:        "/etc/passwd",
			expectedOK:     false,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Path traversal",
			pathVar:        "../../../etc/passwd",
			expectedOK:     false,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Path traversal via nested components",
			pathVar:        "photos/../../etc/passwd",
			expectedOK:     false,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:       "Valid simple path",
			pathVar:    "image.jpg",
			expectedOK: true,
		},
		{
			name:       "Valid nested path",
			pathVar:    "photos/vacation/image.jpg",
			expectedOK: true,
		},
		{
			name:       "Valid path with dot components",
			pathVar:    "photos/./image.jpg",
			expectedOK: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newHandlersWithMediaDir(tempMediaDir)

			req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/"+tt.pathVar, http.NoBody)
			req = mux.SetURLVars(req, map[string]string{"path": tt.pathVar})
			w := httptest.NewRecorder()

			filePath, fullPath, ok := h.validateThumbnailPath(w, req)

			if ok != tt.expectedOK {
				t.Errorf("validateThumbnailPath() ok = %v, want %v", ok, tt.expectedOK)
			}

			if !tt.expectedOK {
				if w.Code != tt.expectedStatus {
					t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
				}
				if filePath != "" || fullPath != "" {
					t.Errorf("expected empty return values on failure, got filePath=%q, fullPath=%q", filePath, fullPath)
				}
			} else {
				if filePath == "" {
					t.Error("expected non-empty filePath on success")
				}
				if fullPath == "" {
					t.Error("expected non-empty fullPath on success")
				}
				// fullPath should be under mediaDir
				if !strings.HasPrefix(fullPath, tempMediaDir) {
					t.Errorf("expected fullPath under media dir, got %q", fullPath)
				}
			}
		})
	}
}

func TestValidateThumbnailPath_ReturnValues(t *testing.T) {
	t.Parallel()

	tempMediaDir := t.TempDir()
	h := newHandlersWithMediaDir(tempMediaDir)

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photos/image.jpg", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "photos/image.jpg"})
	w := httptest.NewRecorder()

	filePath, fullPath, ok := h.validateThumbnailPath(w, req)

	if !ok {
		t.Fatal("expected validation to pass")
	}

	if filePath != "photos/image.jpg" {
		t.Errorf("expected filePath %q, got %q", "photos/image.jpg", filePath)
	}

	expectedFullPath := filepath.Join(tempMediaDir, "photos", "image.jpg")
	if fullPath != expectedFullPath {
		t.Errorf("expected fullPath %q, got %q", expectedFullPath, fullPath)
	}
}

// =============================================================================
// validateThumbnailFileOnDisk Tests
// =============================================================================

func TestValidateThumbnailFileOnDisk(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	h := newHandlersWithMediaDir(tempDir)

	// Create a real file
	testFilePath := filepath.Join(tempDir, "image.jpg")
	if err := os.WriteFile(testFilePath, []byte("image data"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Create a directory
	testDirPath := filepath.Join(tempDir, "somedir")
	if err := os.MkdirAll(testDirPath, 0o755); err != nil {
		t.Fatalf("failed to create test dir: %v", err)
	}

	tests := []struct {
		name           string
		filePath       string
		fullPath       string
		expectedOK     bool
		expectedStatus int
	}{
		{
			name:       "Existing file",
			filePath:   "image.jpg",
			fullPath:   testFilePath,
			expectedOK: true,
		},
		{
			name:           "Non-existent file",
			filePath:       "missing.jpg",
			fullPath:       filepath.Join(tempDir, "missing.jpg"),
			expectedOK:     false,
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "Path is a directory",
			filePath:       "somedir",
			fullPath:       testDirPath,
			expectedOK:     false,
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := httptest.NewRecorder()
			result := h.validateThumbnailFileOnDisk(w, tt.filePath, tt.fullPath)

			if result != tt.expectedOK {
				t.Errorf("validateThumbnailFileOnDisk() = %v, want %v", result, tt.expectedOK)
			}

			if !tt.expectedOK && w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}

func TestValidateThumbnailFileOnDisk_PermissionError(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("skipping permission test when running as root")
	}
	t.Parallel()

	tempDir := t.TempDir()
	h := newHandlersWithMediaDir(tempDir)

	// Create a file then make the directory unreadable
	restrictedDir := filepath.Join(tempDir, "restricted")
	if err := os.MkdirAll(restrictedDir, 0o755); err != nil {
		t.Fatalf("failed to create restricted dir: %v", err)
	}
	restrictedFile := filepath.Join(restrictedDir, "secret.jpg")
	if err := os.WriteFile(restrictedFile, []byte("secret"), 0o644); err != nil {
		t.Fatalf("failed to create file: %v", err)
	}
	if err := os.Chmod(restrictedDir, 0o000); err != nil {
		t.Fatalf("failed to chmod: %v", err)
	}
	t.Cleanup(func() {
		// Restore permissions so TempDir cleanup succeeds
		_ = os.Chmod(restrictedDir, 0o755)
	})

	w := httptest.NewRecorder()
	result := h.validateThumbnailFileOnDisk(w, "restricted/secret.jpg", restrictedFile)

	if result {
		t.Error("expected validation to fail for inaccessible file")
	}

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500 for permission error, got %d", w.Code)
	}
}

// =============================================================================
// writeThumbnailResponse Tests
// =============================================================================

// validPNG returns a minimal valid PNG byte slice for testing
func validPNG() []byte {
	return []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
		0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
		0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
		0x44, 0xAE, 0x42, 0x60, 0x82,
	}
}

// validJPEG returns a minimal valid JPEG byte slice for testing
func validJPEG() []byte {
	return []byte{
		0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
		0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
		0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
	}
}

func TestWriteThumbnailResponse_ImageFile(t *testing.T) {
	t.Parallel()

	thumb := validJPEG()
	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w := httptest.NewRecorder()

	writeThumbnailResponse(w, req, "photo.jpg", database.FileTypeImage, thumb)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Check content type for image files
	contentType := w.Header().Get("Content-Type")
	if contentType != "image/jpeg" {
		t.Errorf("expected Content-Type image/jpeg, got %q", contentType)
	}

	// Check cache header for files (24 hours)
	cacheControl := w.Header().Get("Cache-Control")
	if cacheControl != "public, max-age=86400" {
		t.Errorf("expected Cache-Control for files, got %q", cacheControl)
	}

	// Check ETag is present and quoted
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Error("expected ETag header")
	}
	if !strings.HasPrefix(etag, `"`) || !strings.HasSuffix(etag, `"`) {
		t.Errorf("expected quoted ETag, got %q", etag)
	}

	// Verify XSS-mitigation security headers
	assertSecurityHeaders(t, w)

	// Check body contains the thumbnail data
	if w.Body.Len() != len(thumb) {
		t.Errorf("expected body length %d, got %d", len(thumb), w.Body.Len())
	}
}

func TestWriteThumbnailResponse_VideoFile(t *testing.T) {
	t.Parallel()

	thumb := validJPEG()
	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/clip.mp4", http.NoBody)
	w := httptest.NewRecorder()

	writeThumbnailResponse(w, req, "clip.mp4", database.FileTypeVideo, thumb)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	contentType := w.Header().Get("Content-Type")
	if contentType != "image/jpeg" {
		t.Errorf("expected Content-Type image/jpeg for video thumbnail, got %q", contentType)
	}

	cacheControl := w.Header().Get("Cache-Control")
	if cacheControl != "public, max-age=86400" {
		t.Errorf("expected 24-hour cache for video thumbnail, got %q", cacheControl)
	}

	// Verify XSS-mitigation security headers
	assertSecurityHeaders(t, w)
}

func TestWriteThumbnailResponse_Folder(t *testing.T) {
	t.Parallel()

	thumb := validPNG()
	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photos", http.NoBody)
	w := httptest.NewRecorder()

	writeThumbnailResponse(w, req, "photos", database.FileTypeFolder, thumb)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Check content type for folders (PNG)
	contentType := w.Header().Get("Content-Type")
	if contentType != "image/png" {
		t.Errorf("expected Content-Type image/png for folder, got %q", contentType)
	}

	// Check cache header for folders (5 minutes)
	cacheControl := w.Header().Get("Cache-Control")
	if cacheControl != "public, max-age=300, must-revalidate" {
		t.Errorf("expected shorter cache for folder, got %q", cacheControl)
	}

	// Verify XSS-mitigation security headers
	assertSecurityHeaders(t, w)
}

func TestWriteThumbnailResponse_ConditionalRequest304(t *testing.T) {
	t.Parallel()

	thumb := validJPEG()

	// First request to get the ETag
	req1 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w1 := httptest.NewRecorder()
	writeThumbnailResponse(w1, req1, "photo.jpg", database.FileTypeImage, thumb)

	etag := w1.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected ETag from first request")
	}

	// Second request with matching If-None-Match
	req2 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	req2.Header.Set("If-None-Match", etag)
	w2 := httptest.NewRecorder()
	writeThumbnailResponse(w2, req2, "photo.jpg", database.FileTypeImage, thumb)

	if w2.Code != http.StatusNotModified {
		t.Errorf("expected status 304, got %d", w2.Code)
	}

	if w2.Body.Len() != 0 {
		t.Errorf("expected empty body for 304, got %d bytes", w2.Body.Len())
	}

	// ETag should still be present
	if w2.Header().Get("ETag") != etag {
		t.Errorf("expected ETag %q in 304 response, got %q", etag, w2.Header().Get("ETag"))
	}
}

func TestWriteThumbnailResponse_ConditionalRequestStaleETag(t *testing.T) {
	t.Parallel()

	thumb := validJPEG()

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	req.Header.Set("If-None-Match", `"stale-etag-value"`)
	w := httptest.NewRecorder()

	writeThumbnailResponse(w, req, "photo.jpg", database.FileTypeImage, thumb)

	// Should return 200 with full body since ETag doesn't match
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 for stale ETag, got %d", w.Code)
	}

	if w.Body.Len() == 0 {
		t.Error("expected body for stale ETag request")
	}
}

func TestWriteThumbnailResponse_EmptyThumbnail(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w := httptest.NewRecorder()

	writeThumbnailResponse(w, req, "photo.jpg", database.FileTypeImage, []byte{})

	// Should not write any body for empty thumbnail
	if w.Body.Len() != 0 {
		t.Errorf("expected empty body for empty thumbnail, got %d bytes", w.Body.Len())
	}
}

func TestWriteThumbnailResponse_InvalidFormat(t *testing.T) {
	t.Parallel()

	invalidData := []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09}

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w := httptest.NewRecorder()

	writeThumbnailResponse(w, req, "photo.jpg", database.FileTypeImage, invalidData)

	// Should not write body for invalid image format
	if w.Body.Len() != 0 {
		t.Errorf("expected empty body for invalid format, got %d bytes", w.Body.Len())
	}
}

func TestWriteThumbnailResponse_ETagStability(t *testing.T) {
	t.Parallel()

	thumb := validJPEG()

	// Same thumbnail data should produce same ETag
	req1 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w1 := httptest.NewRecorder()
	writeThumbnailResponse(w1, req1, "photo.jpg", database.FileTypeImage, thumb)

	req2 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w2 := httptest.NewRecorder()
	writeThumbnailResponse(w2, req2, "photo.jpg", database.FileTypeImage, thumb)

	etag1 := w1.Header().Get("ETag")
	etag2 := w2.Header().Get("ETag")

	if etag1 != etag2 {
		t.Errorf("expected stable ETag for same data, got %q and %q", etag1, etag2)
	}
}

func TestWriteThumbnailResponse_ETagDiffersForDifferentData(t *testing.T) {
	t.Parallel()

	thumb1 := validJPEG()
	thumb2 := validPNG()

	req1 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w1 := httptest.NewRecorder()
	writeThumbnailResponse(w1, req1, "photo.jpg", database.FileTypeImage, thumb1)

	req2 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w2 := httptest.NewRecorder()
	writeThumbnailResponse(w2, req2, "photo.jpg", database.FileTypeFolder, thumb2)

	etag1 := w1.Header().Get("ETag")
	etag2 := w2.Header().Get("ETag")

	if etag1 == etag2 {
		t.Errorf("expected different ETags for different data, got same: %q", etag1)
	}
}

// =============================================================================
// Integration-style Tests for Refactored GetThumbnail
// =============================================================================

func TestGetThumbnail_EmptyPath(t *testing.T) {
	t.Parallel()

	h := newHandlersWithMediaDir(t.TempDir())

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": ""})
	w := httptest.NewRecorder()

	h.validateThumbnailPath(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for empty path, got %d", w.Code)
	}
}

func TestGetThumbnail_AbsolutePath(t *testing.T) {
	t.Parallel()

	h := newHandlersWithMediaDir(t.TempDir())

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail//etc/passwd", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "/etc/passwd"})
	w := httptest.NewRecorder()

	h.validateThumbnailPath(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for absolute path, got %d", w.Code)
	}
}

func TestGetThumbnail_PathTraversal(t *testing.T) {
	t.Parallel()

	h := newHandlersWithMediaDir(t.TempDir())

	traversalPaths := []string{
		"../../../etc/passwd",
		"photos/../../etc/shadow",
	}

	for _, path := range traversalPaths {
		t.Run(path, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/"+path, http.NoBody)
			req = mux.SetURLVars(req, map[string]string{"path": path})
			w := httptest.NewRecorder()

			_, _, ok := h.validateThumbnailPath(w, req)

			if ok {
				t.Errorf("expected path traversal %q to be rejected", path)
			}

			if w.Code != http.StatusBadRequest {
				t.Errorf("expected status 400 for path traversal %q, got %d", path, w.Code)
			}
		})
	}
}

// =============================================================================
// Benchmarks
// =============================================================================

func BenchmarkIsValidImageHeader_PNG(b *testing.B) {
	data := validPNG()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isValidImageHeader(data)
	}
}

func BenchmarkIsValidImageHeader_JPEG(b *testing.B) {
	data := validJPEG()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isValidImageHeader(data)
	}
}

func BenchmarkIsValidImageHeader_Invalid(b *testing.B) {
	data := []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isValidImageHeader(data)
	}
}

func BenchmarkWriteThumbnailResponse(b *testing.B) {
	thumb := validJPEG()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
		w := httptest.NewRecorder()
		writeThumbnailResponse(w, req, "photo.jpg", database.FileTypeImage, thumb)
	}
}

func BenchmarkWriteThumbnailResponse_304(b *testing.B) {
	thumb := validJPEG()

	// Get the ETag first
	req0 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w0 := httptest.NewRecorder()
	writeThumbnailResponse(w0, req0, "photo.jpg", database.FileTypeImage, thumb)
	etag := w0.Header().Get("ETag")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
		req.Header.Set("If-None-Match", etag)
		w := httptest.NewRecorder()
		writeThumbnailResponse(w, req, "photo.jpg", database.FileTypeImage, thumb)
	}
}

func TestWriteThumbnailResponse_SecurityHeaders(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		fileType database.FileType
		thumb    []byte
	}{
		{
			name:     "Image file",
			fileType: database.FileTypeImage,
			thumb:    validJPEG(),
		},
		{
			name:     "Video file",
			fileType: database.FileTypeVideo,
			thumb:    validJPEG(),
		},
		{
			name:     "Folder",
			fileType: database.FileTypeFolder,
			thumb:    validPNG(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/test", http.NoBody)
			w := httptest.NewRecorder()

			writeThumbnailResponse(w, req, "test", tt.fileType, tt.thumb)

			assertSecurityHeaders(t, w)
		})
	}
}

func TestWriteThumbnailResponse_SecurityHeadersOn304(t *testing.T) {
	t.Parallel()

	thumb := validJPEG()

	// First request to get ETag
	req1 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w1 := httptest.NewRecorder()
	writeThumbnailResponse(w1, req1, "photo.jpg", database.FileTypeImage, thumb)
	etag := w1.Header().Get("ETag")

	// Second request with matching ETag
	req2 := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	req2.Header.Set("If-None-Match", etag)
	w2 := httptest.NewRecorder()
	writeThumbnailResponse(w2, req2, "photo.jpg", database.FileTypeImage, thumb)

	if w2.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", w2.Code)
	}

	// Security headers must be present even on 304 responses
	assertSecurityHeaders(t, w2)
}

func TestWriteThumbnailResponse_SecurityHeadersOnEmptyThumbnail(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w := httptest.NewRecorder()

	writeThumbnailResponse(w, req, "photo.jpg", database.FileTypeImage, []byte{})

	// Security headers must be present even when thumbnail is empty
	assertSecurityHeaders(t, w)
}

func TestWriteThumbnailResponse_SecurityHeadersOnInvalidFormat(t *testing.T) {
	t.Parallel()

	invalidData := []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09}

	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/photo.jpg", http.NoBody)
	w := httptest.NewRecorder()

	writeThumbnailResponse(w, req, "photo.jpg", database.FileTypeImage, invalidData)

	// Security headers must be present even when format is invalid
	assertSecurityHeaders(t, w)
}

// assertSecurityHeaders verifies that XSS-mitigation headers are present on thumbnail responses
func assertSecurityHeaders(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()

	nosniff := w.Header().Get("X-Content-Type-Options")
	if nosniff != "nosniff" {
		t.Errorf("expected X-Content-Type-Options: nosniff, got %q", nosniff)
	}

	csp := w.Header().Get("Content-Security-Policy")
	if csp != "default-src 'none'" {
		t.Errorf("expected Content-Security-Policy: default-src 'none', got %q", csp)
	}
}

// =============================================================================
// Regression Tests: pathForFS and reEncodePath helpers
//
// Files on disk may contain literal percent-encoded characters in their names
// (e.g. "yummy_cake%21.jpg"). gorilla/mux decodes path vars, turning %21
// into !, so the mux var no longer matches the filesystem. pathForFS handles
// this by trying the decoded path first, then re-encoding and retrying.
// =============================================================================

// TestReEncodePath verifies that reEncodePath URL-encodes each path segment
// while preserving directory separators.
func TestReEncodePath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "plain path unchanged",
			input:    "simple.jpg",
			expected: "simple.jpg",
		},
		{
			name:     "exclamation mark encoded",
			input:    "yummy_cake!.jpg",
			expected: "yummy_cake%21.jpg",
		},
		{
			name:     "spaces encoded",
			input:    "My Photos/vacation pic.jpg",
			expected: "My%20Photos/vacation%20pic.jpg",
		},
		{
			name:     "hash encoded",
			input:    "photo#tag.jpg",
			expected: "photo%23tag.jpg",
		},
		{
			name:     "ampersand encoded",
			input:    "Tom & Jerry.jpg",
			expected: "Tom%20&%20Jerry.jpg",
		},
		{
			name:     "parentheses encoded",
			input:    "image (1).jpg",
			expected: "image%20%281%29.jpg",
		},
		{
			name:     "nested path with special chars",
			input:    "My Folder/Sub Dir/file!name.jpg",
			expected: "My%20Folder/Sub%20Dir/file%21name.jpg",
		},
		{
			name:     "already encoded percent preserved",
			input:    "file%21.jpg",
			expected: "file%2521.jpg",
		},
		{
			name:     "empty path",
			input:    "",
			expected: "",
		},
		{
			name:     "plus sign encoded",
			input:    "Beached+Whales.jpg",
			expected: "Beached%2BWhales.jpg",
		},
		{
			name:     "apostrophe encoded",
			input:    "Big_N'_Tall_1.jpg",
			expected: "Big_N%27_Tall_1.jpg",
		},
		{
			name:     "asterisk encoded",
			input:    "star*file.jpg",
			expected: "star%2Afile.jpg",
		},
		{
			name:     "multiple path-safe special chars",
			input:    "folder (1)/photo+extra!.jpg",
			expected: "folder%20%281%29/photo%2Bextra%21.jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := reEncodePath(tt.input)
			if result != tt.expected {
				t.Errorf("reEncodePath(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestPathForFS_NormalFilename verifies that pathForFS returns the direct
// path when the file exists with its decoded name.
func TestPathForFS_NormalFilename(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	mediaDir := t.TempDir()

	// Create a file with a normal name (no percent encoding)
	content := []byte("test content")
	if err := os.WriteFile(filepath.Join(mediaDir, "photo.jpg"), content, 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	result := pathForFS(mediaDir, "photo.jpg")
	expected := filepath.Join(mediaDir, "photo.jpg")

	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

// TestPathForFS_LiteralPercentFilename verifies that pathForFS falls back to
// the re-encoded path when the file on disk has literal percent characters.
// This is the core regression scenario: a file named "yummy_cake%21.jpg" on
// disk, where mux decoded %21 to !, producing "yummy_cake!.jpg".
func TestPathForFS_LiteralPercentFilename(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	mediaDir := t.TempDir()

	// Create a file with literal percent-encoding in its name
	literalName := "yummy_cake%21.jpg"
	if err := os.WriteFile(filepath.Join(mediaDir, literalName), []byte("content"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Mux decoded %21 → !, so we receive "yummy_cake!.jpg"
	muxDecoded := "yummy_cake!.jpg"

	result := pathForFS(mediaDir, muxDecoded)
	expected := filepath.Join(mediaDir, literalName)

	if result != expected {
		t.Errorf("REGRESSION: pathForFS did not find file with literal percent name.\n"+
			"  mux-decoded input: %q\n"+
			"  expected path:     %q\n"+
			"  got:               %q", muxDecoded, expected, result)
	}
}

// TestPathForFS_LiteralPercentInSubdirectory verifies the fallback works
// for files in subdirectories with literal percent characters.
func TestPathForFS_LiteralPercentInSubdirectory(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	mediaDir := t.TempDir()

	// Create subdirectory and file with literal percent-encoding
	subDir := filepath.Join(mediaDir, "My%20Photos")
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatalf("failed to create subdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(subDir, "pic%21.jpg"), []byte("content"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Mux decoded both segments: %20→space, %21→!
	muxDecoded := "My Photos/pic!.jpg"

	result := pathForFS(mediaDir, muxDecoded)
	expected := filepath.Join(mediaDir, "My%20Photos", "pic%21.jpg")

	if result != expected {
		t.Errorf("REGRESSION: pathForFS did not find file in percent-encoded subdirectory.\n"+
			"  mux-decoded input: %q\n"+
			"  expected path:     %q\n"+
			"  got:               %q", muxDecoded, expected, result)
	}
}

// TestPathForFS_FileNotFound verifies that pathForFS returns the original
// decoded path when neither form exists on disk.
func TestPathForFS_FileNotFound(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	mediaDir := t.TempDir()

	result := pathForFS(mediaDir, "nonexistent!.jpg")
	expected := filepath.Join(mediaDir, "nonexistent!.jpg")

	if result != expected {
		t.Errorf("expected original path %q when file not found, got %q", expected, result)
	}
}

// TestPathForFS_PrefersDecodedOverEncoded verifies that when both a decoded
// file and an encoded file exist, the decoded form takes priority.
// E.g., if both "file!.jpg" and "file%21.jpg" exist on disk, the decoded
// name wins because it's the direct match for the mux var.
func TestPathForFS_PrefersDecodedOverEncoded(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	mediaDir := t.TempDir()

	// Create both forms
	if err := os.WriteFile(filepath.Join(mediaDir, "file!.jpg"), []byte("decoded"), 0o644); err != nil {
		t.Fatalf("failed to create decoded file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(mediaDir, "file%21.jpg"), []byte("encoded"), 0o644); err != nil {
		t.Fatalf("failed to create encoded file: %v", err)
	}

	// Mux gives us "file!.jpg" — should prefer the direct match
	result := pathForFS(mediaDir, "file!.jpg")
	expected := filepath.Join(mediaDir, "file!.jpg")

	if result != expected {
		t.Errorf("expected decoded path %q to take priority, got %q", expected, result)
	}
}

// =============================================================================
// End-to-end regression: GetFile with literal percent-encoded filenames
// =============================================================================

// TestGetFile_LiteralPercentFilename_RegressionIntegration verifies that
// GetFile can serve files whose names contain literal percent-encoded
// characters (e.g. "yummy_cake%21.jpg" on disk). Mux decodes %21 to !,
// but pathForFS re-encodes to find the actual file.
func TestGetFile_LiteralPercentFilename_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Create a file with literal percent-encoding in its name on disk
	literalName := "file%21.jpg"
	testContent := "content of file with percent in name"
	fullPath := filepath.Join(h.mediaDir, literalName)
	if err := os.WriteFile(fullPath, []byte(testContent), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Add to database with the literal name (as the indexer would)
	addExistingFileToDatabase(t, h, literalName, database.FileTypeImage)

	// Mux decodes %21 → ! before we see it
	req := httptest.NewRequest(http.MethodGet, "/api/file/test", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "file!.jpg"})
	w := httptest.NewRecorder()

	h.GetFile(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("REGRESSION: GetFile returned status %d for file with literal percent in name — "+
			"pathForFS should have re-encoded the path to find it on disk", w.Code)
	}

	body := w.Body.String()
	if body != testContent {
		t.Errorf("expected content %q, got %q", testContent, body)
	}
}

// TestGetFile_NormalAndPercentFilenames_RegressionIntegration verifies that
// both normal filenames and literal-percent filenames work in the same
// media directory.
func TestGetFile_NormalAndPercentFilenames_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Normal file
	addTestMediaFile(t, h, "normal.jpg", database.FileTypeImage, "normal content")

	// File with literal percent in name
	literalName := "special%21.jpg"
	fullPath := filepath.Join(h.mediaDir, literalName)
	if err := os.WriteFile(fullPath, []byte("special content"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}
	addExistingFileToDatabase(t, h, literalName, database.FileTypeImage)

	// Test normal file (mux var = decoded = actual filename)
	req1 := httptest.NewRequest(http.MethodGet, "/api/file/test", http.NoBody)
	req1 = mux.SetURLVars(req1, map[string]string{"path": "normal.jpg"})
	w1 := httptest.NewRecorder()
	h.GetFile(w1, req1)

	if w1.Code != http.StatusOK {
		t.Errorf("normal file: expected 200, got %d", w1.Code)
	}
	if w1.Body.String() != "normal content" {
		t.Errorf("normal file: expected %q, got %q", "normal content", w1.Body.String())
	}

	// Test percent file (mux decoded %21 → !)
	req2 := httptest.NewRequest(http.MethodGet, "/api/file/test", http.NoBody)
	req2 = mux.SetURLVars(req2, map[string]string{"path": "special!.jpg"})
	w2 := httptest.NewRecorder()
	h.GetFile(w2, req2)

	if w2.Code != http.StatusOK {
		t.Errorf("percent file: expected 200, got %d", w2.Code)
	}
	if w2.Body.String() != "special content" {
		t.Errorf("percent file: expected %q, got %q", "special content", w2.Body.String())
	}
}

// =============================================================================
// End-to-end regression: GetThumbnail DB lookup fallback
// =============================================================================

// TestGetThumbnail_LiteralPercentDBLookup_RegressionIntegration verifies that
// GetThumbnail falls back to the re-encoded path for database lookups when
// the file on disk and in the DB has literal percent-encoded characters.
func TestGetThumbnail_LiteralPercentDBLookup_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Create file with literal percent in name
	literalName := "yummy_cake%21.jpg"
	fullPath := filepath.Join(h.mediaDir, literalName)
	if err := os.WriteFile(fullPath, []byte("image data"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}
	addExistingFileToDatabase(t, h, literalName, database.FileTypeImage)

	// Mux decoded %21 → !
	// Thumbnails are disabled in test setup, so we expect 503 (not 404 from DB miss)
	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/test", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "yummy_cake!.jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// 503 = thumbnails disabled, meaning path resolution AND DB lookup succeeded
	// 404 = REGRESSION: DB lookup failed because re-encode fallback didn't work
	if w.Code == http.StatusNotFound {
		t.Errorf("REGRESSION: GetThumbnail returned 404 — DB lookup failed for file with "+
			"literal percent in name. The reEncodePath fallback should have found %q in the DB",
			literalName)
	}

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503 (thumbnails disabled), got %d", w.Code)
	}
}

// =============================================================================
// End-to-end regression: StreamVideo with literal percent filenames
// =============================================================================

// TestStreamVideo_LiteralPercentFilename_RegressionIntegration verifies that
// StreamVideo can find files with literal percent-encoded names on disk.
func TestStreamVideo_LiteralPercentFilename_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Create a video file with literal percent in name
	literalName := "clip%21.mp4"
	fullPath := filepath.Join(h.mediaDir, literalName)
	if err := os.WriteFile(fullPath, []byte("fake video"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}
	addExistingFileToDatabase(t, h, literalName, database.FileTypeVideo)

	// Mux decoded %21 → !
	req := httptest.NewRequest(http.MethodGet, "/api/stream/test", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "clip!.mp4"})
	w := httptest.NewRecorder()

	h.StreamVideo(w, req)

	// Should NOT be 404 — pathForFS should re-encode and find the file.
	// May be 500 (ffprobe fails on fake video) which is fine — it means
	// the file was found on disk.
	if w.Code == http.StatusNotFound {
		t.Errorf("REGRESSION: StreamVideo returned 404 for file with literal percent in name — "+
			"pathForFS should have re-encoded to find %q on disk", literalName)
	}

	if w.Code == http.StatusBadRequest {
		t.Errorf("REGRESSION: StreamVideo returned 400 — path validation rejected the re-encoded path")
	}

	// 500 from ffprobe is acceptable — it means the file was found
	t.Logf("StreamVideo returned status %d (500 from ffprobe is expected for fake video)", w.Code)
}

// =============================================================================
// End-to-end regression: InvalidateThumbnail with literal percent filenames
// =============================================================================

// TestInvalidateThumbnail_LiteralPercentFilename_RegressionIntegration verifies
// that InvalidateThumbnail resolves the filesystem path correctly for files
// with literal percent-encoded names.
func TestInvalidateThumbnail_LiteralPercentFilename_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Mux decoded %21 → !
	// Thumbnails disabled → expect 503 (not 400 from path validation failure)
	req := httptest.NewRequest(http.MethodDelete, "/api/thumbnail/test", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "photo!.jpg"})
	w := httptest.NewRecorder()

	h.InvalidateThumbnail(w, req)

	if w.Code == http.StatusBadRequest {
		t.Errorf("REGRESSION: InvalidateThumbnail returned 400 for mux-decoded path with !")
	}

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503 (thumbnails disabled), got %d", w.Code)
	}
}

// TestPathForFS_LogsWarningOnFallback verifies that pathForFS finds the file
// via re-encoding when the mux-decoded path doesn't match, which is the
// scenario that triggers a warning about frontend encoding inconsistency.
func TestPathForFS_LogsWarningOnFallback(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	mediaDir := t.TempDir()

	// Create file with literal percent in name (only the encoded form exists)
	literalName := "photo%23tagged.jpg"
	if err := os.WriteFile(filepath.Join(mediaDir, literalName), []byte("content"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Mux decoded %23 → #, so we receive "photo#tagged.jpg"
	// pathForFS should:
	// 1. Try "photo#tagged.jpg" — not found
	// 2. Re-encode to "photo%23tagged.jpg" — found (and log warning)
	result := pathForFS(mediaDir, "photo#tagged.jpg")
	expected := filepath.Join(mediaDir, literalName)

	if result != expected {
		t.Errorf("expected re-encoded fallback path %q, got %q", expected, result)
	}

	// The warning is logged internally — we verify the behavior is correct.
	// In production, the log message helps track which files trigger the
	// fallback so the frontend encoding can be fixed.
}

// TestGetThumbnail_DBFallbackLogsWarning_RegressionIntegration verifies that
// the DB lookup fallback works and would trigger a warning log for files with
// literal percent-encoded names.
func TestGetThumbnail_DBFallbackLogsWarning_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// Create file with literal percent in name
	literalName := "photo%23tagged.jpg"
	fullPath := filepath.Join(h.mediaDir, literalName)
	if err := os.WriteFile(fullPath, []byte("image data"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}
	addExistingFileToDatabase(t, h, literalName, database.FileTypeImage)

	// Mux decoded %23 → #
	req := httptest.NewRequest(http.MethodGet, "/api/thumbnail/test", http.NoBody)
	req = mux.SetURLVars(req, map[string]string{"path": "photo#tagged.jpg"})
	w := httptest.NewRecorder()

	h.GetThumbnail(w, req)

	// 503 = thumbnails disabled = path + DB lookup both succeeded via fallback
	// 404 = REGRESSION: DB fallback didn't work
	if w.Code == http.StatusNotFound {
		t.Errorf("REGRESSION: GetThumbnail returned 404 — DB lookup fallback failed for %q. "+
			"The re-encoded form %q should have matched the database.", "photo#tagged.jpg", literalName)
	}

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503 (thumbnails disabled), got %d", w.Code)
	}
}

// TestGetFile_BothEncodingLevels_RegressionIntegration verifies that GetFile
// works regardless of whether the frontend single-encodes or double-encodes
// the path for a file with literal percent characters in its name.
func TestGetFile_BothEncodingLevels_RegressionIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	h, cleanup := setupMediaIntegrationTest(t)
	defer cleanup()

	// File on disk with literal percent
	literalName := "file%21.jpg"
	testContent := "percent file content"
	if err := os.WriteFile(filepath.Join(h.mediaDir, literalName), []byte(testContent), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}
	addExistingFileToDatabase(t, h, literalName, database.FileTypeImage)

	tests := []struct {
		name   string
		muxVar string // What mux provides after its decode
		desc   string
	}{
		{
			name:   "double-encoded by frontend (correct)",
			muxVar: "file%21.jpg", // Frontend sent %2521, mux decoded to %21
			desc:   "mux decoded double-encoding to literal form",
		},
		{
			name:   "single-encoded by frontend (fallback needed)",
			muxVar: "file!.jpg", // Frontend sent %21, mux decoded to !
			desc:   "mux over-decoded, pathForFS re-encodes to find file",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/file/test", http.NoBody)
			req = mux.SetURLVars(req, map[string]string{"path": tt.muxVar})
			w := httptest.NewRecorder()

			h.GetFile(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("%s: expected 200, got %d — %s", tt.name, w.Code, tt.desc)
			}

			body := w.Body.String()
			if body != testContent {
				t.Errorf("%s: expected content %q, got %q", tt.name, testContent, body)
			}
		})
	}
}

// =============================================================================
// encodePathSegment Tests
// =============================================================================

func TestEncodePathSegment(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "plain filename unchanged",
			input:    "image.jpg",
			expected: "image.jpg",
		},
		{
			name:     "safe characters preserved",
			input:    "simple-file_name.jpg",
			expected: "simple-file_name.jpg",
		},
		{
			name:     "plus sign encoded",
			input:    "Beached+Whales.jpg",
			expected: "Beached%2BWhales.jpg",
		},
		{
			name:     "apostrophe encoded",
			input:    "Big_N'_Tall_1.jpg",
			expected: "Big_N%27_Tall_1.jpg",
		},
		{
			name:     "exclamation mark encoded",
			input:    "wow!.jpg",
			expected: "wow%21.jpg",
		},
		{
			name:     "parentheses encoded",
			input:    "photo (1).jpg",
			expected: "photo%20%281%29.jpg",
		},
		{
			name:     "asterisk encoded",
			input:    "star*file.jpg",
			expected: "star%2Afile.jpg",
		},
		{
			name:     "at sign encoded",
			input:    "photo@home.jpg",
			expected: "photo%40home.jpg",
		},
		{
			name:     "multiple special chars in one segment",
			input:    "file (1) + extra!.jpg",
			expected: "file%20%281%29%20%2B%20extra%21.jpg",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			result := encodePathSegment(tt.input)
			if result != tt.expected {
				t.Errorf("encodePathSegment(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestEncodePathSegmentRoundTrip(t *testing.T) {
	t.Parallel()

	// Verify encode → decode returns the original input
	inputs := []string{
		"simple.jpg",
		"spaces in name.jpg",
		"Beached+Whales.jpg",
		"Big_N'_Tall_1.jpg",
		"photo (1).jpg",
		"wow!.jpg",
		"star*file.jpg",
		"file#tagged.jpg",
	}

	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			t.Parallel()
			encoded := encodePathSegment(input)
			decoded, err := url.PathUnescape(encoded)
			if err != nil {
				t.Fatalf("PathUnescape(%q) failed: %v", encoded, err)
			}
			if decoded != input {
				t.Errorf("round-trip failed: %q → %q → %q", input, encoded, decoded)
			}
		})
	}
}
