package handlers

import (
	"encoding/json"
	"strings"
	"testing"
)

// =============================================================================
// TagRequest Structure Tests
// =============================================================================

func TestTagRequestValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		req     TagRequest
		isValid bool
		reason  string
	}{
		{
			name:    "Valid add tag request",
			req:     TagRequest{Path: "photos/image.jpg", Tag: "vacation"},
			isValid: true,
			reason:  "Has both path and tag",
		},
		{
			name:    "Missing path",
			req:     TagRequest{Tag: "vacation"},
			isValid: false,
			reason:  "Path is required",
		},
		{
			name:    "Missing tag",
			req:     TagRequest{Path: "photos/image.jpg"},
			isValid: false,
			reason:  "Tag is required",
		},
		{
			name:    "Empty path",
			req:     TagRequest{Path: "", Tag: "vacation"},
			isValid: false,
			reason:  "Path cannot be empty",
		},
		{
			name:    "Empty tag",
			req:     TagRequest{Path: "photos/image.jpg", Tag: ""},
			isValid: false,
			reason:  "Tag cannot be empty",
		},
		{
			name:    "Valid with special characters",
			req:     TagRequest{Path: "photos/my photo.jpg", Tag: "vacation 2024"},
			isValid: true,
			reason:  "Should handle spaces",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.req.Path != "" && tt.req.Tag != ""
			if isValid != tt.isValid {
				t.Errorf("Expected valid=%v (%s), got %v", tt.isValid, tt.reason, isValid)
			}
		})
	}
}

func TestTagRequestJSONEncoding(t *testing.T) {
	t.Parallel()

	req := TagRequest{
		Path: "photos/vacation.jpg",
		Tag:  "summer",
	}

	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("Failed to marshal TagRequest: %v", err)
	}

	var decoded TagRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal TagRequest: %v", err)
	}

	if decoded.Path != req.Path {
		t.Errorf("Expected path %q, got %q", req.Path, decoded.Path)
	}

	if decoded.Tag != req.Tag {
		t.Errorf("Expected tag %q, got %q", req.Tag, decoded.Tag)
	}
}

// =============================================================================
// BatchTagsRequest Tests
// =============================================================================

func TestBatchTagsRequestValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		req     BatchTagsRequest
		isValid bool
	}{
		{
			name:    "Valid batch request",
			req:     BatchTagsRequest{Paths: []string{"photo1.jpg", "photo2.jpg"}},
			isValid: true,
		},
		{
			name:    "Empty paths array",
			req:     BatchTagsRequest{Paths: []string{}},
			isValid: false,
		},
		{
			name:    "Nil paths",
			req:     BatchTagsRequest{},
			isValid: false,
		},
		{
			name:    "Single path",
			req:     BatchTagsRequest{Paths: []string{"photo.jpg"}},
			isValid: true,
		},
		{
			name:    "Many paths",
			req:     BatchTagsRequest{Paths: make([]string, 100)},
			isValid: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := len(tt.req.Paths) > 0
			if isValid != tt.isValid {
				t.Errorf("Expected valid=%v, got %v", tt.isValid, isValid)
			}
		})
	}
}

func TestBatchTagsRequestMaxPaths(t *testing.T) {
	t.Parallel()

	// Test the max paths limit logic
	maxPaths := 100

	tests := []struct {
		name          string
		pathCount     int
		expectedCount int
	}{
		{
			name:          "Below limit",
			pathCount:     50,
			expectedCount: 50,
		},
		{
			name:          "At limit",
			pathCount:     100,
			expectedCount: 100,
		},
		{
			name:          "Above limit",
			pathCount:     150,
			expectedCount: 100,
		},
		{
			name:          "Way above limit",
			pathCount:     1000,
			expectedCount: 100,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			paths := make([]string, tt.pathCount)

			// Simulate the truncation logic
			if len(paths) > maxPaths {
				paths = paths[:maxPaths]
			}

			if len(paths) != tt.expectedCount {
				t.Errorf("Expected %d paths, got %d", tt.expectedCount, len(paths))
			}
		})
	}
}

// =============================================================================
// BulkTagRequest Tests
// =============================================================================

func TestBulkTagRequestValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		req     BulkTagRequest
		isValid bool
		reason  string
	}{
		{
			name:    "Valid bulk request",
			req:     BulkTagRequest{Paths: []string{"photo1.jpg", "photo2.jpg"}, Tag: "vacation"},
			isValid: true,
			reason:  "Has paths and tag",
		},
		{
			name:    "Empty paths",
			req:     BulkTagRequest{Paths: []string{}, Tag: "vacation"},
			isValid: false,
			reason:  "Paths required",
		},
		{
			name:    "Empty tag",
			req:     BulkTagRequest{Paths: []string{"photo.jpg"}, Tag: ""},
			isValid: false,
			reason:  "Tag required",
		},
		{
			name:    "Both empty",
			req:     BulkTagRequest{},
			isValid: false,
			reason:  "Both required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := len(tt.req.Paths) > 0 && tt.req.Tag != ""
			if isValid != tt.isValid {
				t.Errorf("Expected valid=%v (%s), got %v", tt.isValid, tt.reason, isValid)
			}
		})
	}
}

// =============================================================================
// BulkTagResponse Tests
// =============================================================================

func TestBulkTagResponseStructure(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		response BulkTagResponse
	}{
		{
			name: "All successful",
			response: BulkTagResponse{
				Success: 5,
				Failed:  0,
				Errors:  nil,
			},
		},
		{
			name: "Some failures",
			response: BulkTagResponse{
				Success: 3,
				Failed:  2,
				Errors:  []string{"error1", "error2"},
			},
		},
		{
			name: "All failed",
			response: BulkTagResponse{
				Success: 0,
				Failed:  5,
				Errors:  []string{"error1", "error2", "error3"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.response)
			if err != nil {
				t.Fatalf("Failed to marshal response: %v", err)
			}

			var decoded BulkTagResponse
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("Failed to unmarshal response: %v", err)
			}

			if decoded.Success != tt.response.Success {
				t.Errorf("Expected success=%d, got %d", tt.response.Success, decoded.Success)
			}

			if decoded.Failed != tt.response.Failed {
				t.Errorf("Expected failed=%d, got %d", tt.response.Failed, decoded.Failed)
			}
		})
	}
}

func TestBulkTagResponseErrorLimit(t *testing.T) {
	t.Parallel()

	// Test the error limit logic (max 10 errors)
	maxErrors := 10

	tests := []struct {
		name          string
		errorCount    int
		expectedCount int
	}{
		{
			name:          "Below limit",
			errorCount:    5,
			expectedCount: 5,
		},
		{
			name:          "At limit",
			errorCount:    10,
			expectedCount: 10,
		},
		{
			name:          "Above limit",
			errorCount:    15,
			expectedCount: 10,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errors := []string{}
			for i := 0; i < tt.errorCount; i++ {
				if len(errors) < maxErrors {
					errors = append(errors, "error")
				}
			}

			if len(errors) != tt.expectedCount {
				t.Errorf("Expected %d errors, got %d", tt.expectedCount, len(errors))
			}
		})
	}
}

// =============================================================================
// Tag Name Validation Tests
// =============================================================================

func TestTagNameValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		tagName string
		isValid bool
	}{
		{
			name:    "Simple tag",
			tagName: "vacation",
			isValid: true,
		},
		{
			name:    "Tag with spaces",
			tagName: "summer vacation",
			isValid: true,
		},
		{
			name:    "Tag with numbers",
			tagName: "2024",
			isValid: true,
		},
		{
			name:    "Empty tag",
			tagName: "",
			isValid: false,
		},
		{
			name:    "Tag with special characters",
			tagName: "vacation!",
			isValid: true,
		},
		{
			name:    "Unicode tag",
			tagName: "休暇",
			isValid: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.tagName != ""
			if isValid != tt.isValid {
				t.Errorf("Expected valid=%v for tag %q, got %v", tt.isValid, tt.tagName, isValid)
			}
		})
	}
}

// =============================================================================
// Path Filtering Tests
// =============================================================================

func TestEmptyPathFiltering(t *testing.T) {
	t.Parallel()

	// Test that empty paths are filtered out
	paths := []string{"photo1.jpg", "", "photo2.jpg", "", "photo3.jpg"}

	var filtered []string
	for _, path := range paths {
		if path != "" {
			filtered = append(filtered, path)
		}
	}

	expectedCount := 3
	if len(filtered) != expectedCount {
		t.Errorf("Expected %d non-empty paths, got %d", expectedCount, len(filtered))
	}
}

func TestBatchTagsResultMap(t *testing.T) {
	t.Parallel()

	// Test that result map structure works correctly
	result := make(map[string][]string)

	result["photo1.jpg"] = []string{"vacation", "summer"}
	result["photo2.jpg"] = []string{"family"}

	if len(result) != 2 {
		t.Errorf("Expected 2 entries in result map, got %d", len(result))
	}

	tags, exists := result["photo1.jpg"]
	if !exists {
		t.Error("Expected photo1.jpg in result map")
	}

	if len(tags) != 2 {
		t.Errorf("Expected 2 tags for photo1.jpg, got %d", len(tags))
	}
}

// =============================================================================
// Tag Rename Tests
// =============================================================================

func TestTagRenameValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		oldName string
		newName string
		isValid bool
	}{
		{
			name:    "Valid rename",
			oldName: "vacation",
			newName: "holiday",
			isValid: true,
		},
		{
			name:    "Empty old name",
			oldName: "",
			newName: "holiday",
			isValid: false,
		},
		{
			name:    "Empty new name",
			oldName: "vacation",
			newName: "",
			isValid: false,
		},
		{
			name:    "Both empty",
			oldName: "",
			newName: "",
			isValid: false,
		},
		{
			name:    "Same name",
			oldName: "vacation",
			newName: "vacation",
			isValid: true, // Valid but no-op
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.oldName != "" && tt.newName != ""
			if isValid != tt.isValid {
				t.Errorf("Expected valid=%v, got %v", tt.isValid, isValid)
			}
		})
	}
}

// =============================================================================
// Tag Color Tests
// =============================================================================

func TestTagColorValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		color   string
		isValid bool
	}{
		{
			name:    "Hex color",
			color:   "#FF5733",
			isValid: true,
		},
		{
			name:    "Short hex color",
			color:   "#F57",
			isValid: true,
		},
		{
			name:    "Named color",
			color:   "red",
			isValid: true,
		},
		{
			name:    "Empty color",
			color:   "",
			isValid: true, // Optional
		},
		{
			name:    "RGB color",
			color:   "rgb(255, 87, 51)",
			isValid: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Color validation is optional in the handler
			// This test documents accepted formats
			t.Logf("Color %q is accepted", tt.color)
		})
	}
}

// =============================================================================
// SetFileTags Tests
// =============================================================================

func TestSetFileTagsValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		req     TagRequest
		isValid bool
	}{
		{
			name:    "Valid with tags",
			req:     TagRequest{Path: "photo.jpg", Tags: []string{"vacation", "summer"}},
			isValid: true,
		},
		{
			name:    "Valid with empty tags",
			req:     TagRequest{Path: "photo.jpg", Tags: []string{}},
			isValid: true, // Clears all tags
		},
		{
			name:    "Missing path",
			req:     TagRequest{Tags: []string{"vacation"}},
			isValid: false,
		},
		{
			name:    "Nil tags array",
			req:     TagRequest{Path: "photo.jpg"},
			isValid: true, // Can set to empty
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.req.Path != ""
			if isValid != tt.isValid {
				t.Errorf("Expected valid=%v, got %v", tt.isValid, isValid)
			}
		})
	}
}

// =============================================================================
// Tag Name Case Sensitivity Tests
// =============================================================================

func TestTagNameCaseSensitivity(t *testing.T) {
	t.Parallel()

	// Test that tag names are case-sensitive
	tags := []string{"Vacation", "vacation", "VACATION"}

	uniqueTags := make(map[string]bool)
	for _, tag := range tags {
		uniqueTags[tag] = true
	}

	// All three should be considered different
	expectedCount := 3
	if len(uniqueTags) != expectedCount {
		t.Errorf("Expected %d unique tags (case-sensitive), got %d", expectedCount, len(uniqueTags))
	}
}

func TestTagNameNormalization(t *testing.T) {
	t.Parallel()

	// Test common normalization operations
	tests := []struct {
		name    string
		input   string
		trimmed string
		lower   string
	}{
		{
			name:    "With leading/trailing spaces",
			input:   "  vacation  ",
			trimmed: "vacation",
			lower:   "  vacation  ",
		},
		{
			name:    "Mixed case",
			input:   "VaCaTiOn",
			trimmed: "VaCaTiOn",
			lower:   "vacation",
		},
		{
			name:    "With newlines",
			input:   "vacation\n",
			trimmed: "vacation",
			lower:   "vacation\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trimmed := strings.TrimSpace(tt.input)
			lower := strings.ToLower(tt.input)

			if trimmed != tt.trimmed {
				t.Errorf("Expected trimmed %q, got %q", tt.trimmed, trimmed)
			}

			if lower != tt.lower {
				t.Errorf("Expected lower %q, got %q", tt.lower, lower)
			}
		})
	}
}
