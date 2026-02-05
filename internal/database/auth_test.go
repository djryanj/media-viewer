package database

import (
	"testing"
	"time"
)

// TestSetSessionDuration tests session duration configuration.
func TestSetSessionDuration(t *testing.T) {
	t.Parallel()

	// Save original duration
	originalDuration := sessionDuration
	defer func() {
		sessionDuration = originalDuration
	}()

	tests := []struct {
		name     string
		input    time.Duration
		expected time.Duration
	}{
		{
			name:     "valid duration 5 minutes",
			input:    5 * time.Minute,
			expected: 5 * time.Minute,
		},
		{
			name:     "valid duration 1 hour",
			input:    1 * time.Hour,
			expected: 1 * time.Hour,
		},
		{
			name:     "valid duration 24 hours",
			input:    24 * time.Hour,
			expected: 24 * time.Hour,
		},
		{
			name:     "minimum duration 1 minute",
			input:    1 * time.Minute,
			expected: 1 * time.Minute,
		},
		{
			name:     "too short duration clamped to 1 minute",
			input:    30 * time.Second,
			expected: 1 * time.Minute,
		},
		{
			name:     "zero duration clamped to 1 minute",
			input:    0,
			expected: 1 * time.Minute,
		},
		{
			name:     "negative duration clamped to 1 minute",
			input:    -5 * time.Minute,
			expected: 1 * time.Minute,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Note: Cannot use t.Parallel() here because we're modifying a package-level variable

			SetSessionDuration(tt.input)
			result := GetSessionDuration()

			if result != tt.expected {
				t.Errorf("SetSessionDuration(%v); GetSessionDuration() = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

// TestGetSessionDurationDefault tests the default session duration.
func TestGetSessionDurationDefault(t *testing.T) {
	// Save and restore original duration
	originalDuration := sessionDuration
	defer func() {
		sessionDuration = originalDuration
	}()

	// Reset to default
	sessionDuration = DefaultSessionDuration

	result := GetSessionDuration()

	if result != DefaultSessionDuration {
		t.Errorf("GetSessionDuration() = %v, want default %v", result, DefaultSessionDuration)
	}

	if DefaultSessionDuration != 5*time.Minute {
		t.Errorf("DefaultSessionDuration = %v, expected 5 minutes", DefaultSessionDuration)
	}
}

// TestSessionDurationConstants tests session duration constant values.
func TestSessionDurationConstants(t *testing.T) {
	t.Parallel()

	if DefaultSessionDuration < 1*time.Minute {
		t.Errorf("DefaultSessionDuration (%v) should be at least 1 minute", DefaultSessionDuration)
	}

	if DefaultSessionDuration > 24*time.Hour {
		t.Errorf("DefaultSessionDuration (%v) seems unreasonably long", DefaultSessionDuration)
	}
}

// TestSessionDurationPersistence tests that session duration persists across multiple calls.
func TestSessionDurationPersistence(t *testing.T) {
	// Save original duration
	originalDuration := sessionDuration
	defer func() {
		sessionDuration = originalDuration
	}()

	testDuration := 15 * time.Minute
	SetSessionDuration(testDuration)

	// Call multiple times and verify consistency
	for i := 0; i < 10; i++ {
		result := GetSessionDuration()
		if result != testDuration {
			t.Errorf("iteration %d: GetSessionDuration() = %v, want %v", i, result, testDuration)
		}
	}
}
