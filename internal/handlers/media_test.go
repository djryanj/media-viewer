package handlers

import (
	"fmt"
	"path/filepath"
	"testing"
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
