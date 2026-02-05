package handlers

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// =============================================================================
// writeJSON Tests
// =============================================================================

func TestWriteJSON(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    interface{}
		expected string
	}{
		{
			name:     "Simple map",
			input:    map[string]string{"status": "ok"},
			expected: `{"status":"ok"}`,
		},
		{
			name:     "String slice",
			input:    []string{"a", "b", "c"},
			expected: `["a","b","c"]`,
		},
		{
			name:     "Number",
			input:    42,
			expected: `42`,
		},
		{
			name:     "Boolean",
			input:    true,
			expected: `true`,
		},
		{
			name:     "Null",
			input:    nil,
			expected: `null`,
		},
		{
			name:     "Empty map",
			input:    map[string]string{},
			expected: `{}`,
		},
		{
			name:     "Empty slice",
			input:    []string{},
			expected: `[]`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeJSON(w, tt.input)

			body := w.Body.String()
			// Trim newline that json.Encoder adds
			body = body[:len(body)-1]

			if body != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, body)
			}
		})
	}
}

func TestWriteJSONStruct(t *testing.T) {
	t.Parallel()

	type testStruct struct {
		Name  string `json:"name"`
		Age   int    `json:"age"`
		Email string `json:"email,omitempty"`
	}

	tests := []struct {
		name     string
		input    testStruct
		expected string
	}{
		{
			name:     "Full struct",
			input:    testStruct{Name: "Alice", Age: 30, Email: "alice@example.com"},
			expected: `{"name":"Alice","age":30,"email":"alice@example.com"}`,
		},
		{
			name:     "Struct with omitted field",
			input:    testStruct{Name: "Bob", Age: 25},
			expected: `{"name":"Bob","age":25}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeJSON(w, tt.input)

			body := w.Body.String()
			body = body[:len(body)-1] // Trim newline

			if body != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, body)
			}
		})
	}
}

func TestWriteJSONNestedStructures(t *testing.T) {
	t.Parallel()

	type Address struct {
		City  string `json:"city"`
		State string `json:"state"`
	}

	type Person struct {
		Name    string  `json:"name"`
		Address Address `json:"address"`
	}

	input := Person{
		Name: "Charlie",
		Address: Address{
			City:  "Seattle",
			State: "WA",
		},
	}

	w := httptest.NewRecorder()
	writeJSON(w, input)

	var result Person
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode JSON: %v", err)
	}

	if result.Name != "Charlie" {
		t.Errorf("Expected name Charlie, got %s", result.Name)
	}

	if result.Address.City != "Seattle" {
		t.Errorf("Expected city Seattle, got %s", result.Address.City)
	}
}

func TestWriteJSONWithSpecialCharacters(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input map[string]string
	}{
		{
			name:  "Unicode characters",
			input: map[string]string{"text": "Hello 世界 🌍"},
		},
		{
			name:  "Escaped characters",
			input: map[string]string{"text": "Line 1\nLine 2\tTabbed"},
		},
		{
			name:  "Quotes",
			input: map[string]string{"text": `He said "Hello"`},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeJSON(w, tt.input)

			// Verify it's valid JSON by decoding
			var result map[string]string
			if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
				t.Fatalf("Failed to decode JSON: %v", err)
			}

			if result["text"] != tt.input["text"] {
				t.Errorf("Expected %q, got %q", tt.input["text"], result["text"])
			}
		})
	}
}

func TestWriteJSONHandlesInvalidTypes(t *testing.T) {
	t.Parallel()

	// JSON encoder handles most types, but channels cause errors
	ch := make(chan int)

	w := httptest.NewRecorder()
	writeJSON(w, ch)

	// The function should log the error but not panic
	// We verify it doesn't panic by getting here
	if w.Body.Len() == 0 {
		t.Log("writeJSON correctly handled unencodable type")
	}
}

// =============================================================================
// writeJSONStatus Tests
// =============================================================================

func TestWriteJSONStatus(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		status         string
		expectedBody   string
		expectedHeader string
	}{
		{
			name:           "OK status",
			status:         "ok",
			expectedBody:   `{"status":"ok"}`,
			expectedHeader: "application/json",
		},
		{
			name:           "Error status",
			status:         "error",
			expectedBody:   `{"status":"error"}`,
			expectedHeader: "application/json",
		},
		{
			name:           "Empty status",
			status:         "",
			expectedBody:   `{"status":""}`,
			expectedHeader: "application/json",
		},
		{
			name:           "Long status message",
			status:         "processing_request_please_wait",
			expectedBody:   `{"status":"processing_request_please_wait"}`,
			expectedHeader: "application/json",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeJSONStatus(w, tt.status)

			// Check Content-Type header
			contentType := w.Header().Get("Content-Type")
			if contentType != tt.expectedHeader {
				t.Errorf("Expected Content-Type %q, got %q", tt.expectedHeader, contentType)
			}

			// Check body
			body := w.Body.String()
			body = body[:len(body)-1] // Trim newline

			if body != tt.expectedBody {
				t.Errorf("Expected body %q, got %q", tt.expectedBody, body)
			}
		})
	}
}

func TestWriteJSONStatusDecodesCorrectly(t *testing.T) {
	t.Parallel()

	w := httptest.NewRecorder()
	writeJSONStatus(w, "success")

	var result map[string]string
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode JSON: %v", err)
	}

	if result["status"] != "success" {
		t.Errorf("Expected status 'success', got %q", result["status"])
	}
}

// =============================================================================
// Helper Function Tests
// =============================================================================

func TestJSONEncodingRoundTrip(t *testing.T) {
	t.Parallel()

	// Test that writeJSON produces valid JSON that can be decoded
	input := map[string]interface{}{
		"string": "value",
		"number": 123,
		"bool":   true,
		"array":  []int{1, 2, 3},
		"nested": map[string]string{
			"key": "value",
		},
	}

	w := httptest.NewRecorder()
	writeJSON(w, input)

	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode JSON: %v", err)
	}

	if result["string"] != "value" {
		t.Errorf("String field mismatch")
	}

	if result["number"].(float64) != 123 {
		t.Errorf("Number field mismatch")
	}

	if result["bool"] != true {
		t.Errorf("Bool field mismatch")
	}
}

func TestWriteJSONEmptyWriter(t *testing.T) {
	t.Parallel()

	// Test with a basic ResponseRecorder
	w := httptest.NewRecorder()

	// Verify initial state
	if w.Body.Len() != 0 {
		t.Error("Expected empty body initially")
	}

	writeJSON(w, map[string]string{"key": "value"})

	if w.Body.Len() == 0 {
		t.Error("Expected non-empty body after writeJSON")
	}
}

func TestWriteJSONMultipleCalls(t *testing.T) {
	t.Parallel()

	// Test that multiple calls append to the writer
	w := httptest.NewRecorder()

	writeJSON(w, map[string]string{"first": "value1"})
	firstLen := w.Body.Len()

	writeJSON(w, map[string]string{"second": "value2"})
	secondLen := w.Body.Len()

	if secondLen <= firstLen {
		t.Error("Expected body to grow with multiple writeJSON calls")
	}

	// Note: In practice, handlers should only call writeJSON once,
	// but this tests the low-level behavior
}

func TestWriteJSONBinaryData(t *testing.T) {
	t.Parallel()

	// Test encoding binary data (base64 encoded in JSON)
	binaryData := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE}
	input := map[string][]byte{
		"data": binaryData,
	}

	w := httptest.NewRecorder()
	writeJSON(w, input)

	var result map[string][]byte
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode JSON: %v", err)
	}

	if !bytes.Equal(result["data"], binaryData) {
		t.Error("Binary data mismatch after round-trip")
	}
}

func TestWriteJSONStatusWithSpecialCharacters(t *testing.T) {
	t.Parallel()

	specialStatuses := []string{
		"status with spaces",
		"status_with_underscores",
		"status-with-dashes",
		"status.with.dots",
		"status/with/slashes",
	}

	for _, status := range specialStatuses {
		t.Run(status, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeJSONStatus(w, status)

			var result map[string]string
			if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
				t.Fatalf("Failed to decode JSON for status %q: %v", status, err)
			}

			if result["status"] != status {
				t.Errorf("Status mismatch: got %q, want %q", result["status"], status)
			}
		})
	}
}
