package workers

import (
	"os"
	"runtime"
	"testing"
)

func TestCount(t *testing.T) {
	// Save and restore original environment
	originalEnv := os.Getenv("THUMBNAIL_WORKERS")
	defer func() {
		if originalEnv != "" {
			os.Setenv("THUMBNAIL_WORKERS", originalEnv)
		} else {
			os.Unsetenv("THUMBNAIL_WORKERS")
		}
	}()

	// Clear any existing override
	os.Unsetenv("THUMBNAIL_WORKERS")

	availableCPU := runtime.GOMAXPROCS(0)

	tests := []struct {
		name       string
		multiplier float64
		limit      int
		minExpect  int
		maxExpect  int
	}{
		{
			name:       "CPU-bound task (1.0x multiplier)",
			multiplier: 1.0,
			limit:      0,
			minExpect:  1,
			maxExpect:  availableCPU,
		},
		{
			name:       "I/O-bound task (2.0x multiplier)",
			multiplier: 2.0,
			limit:      0,
			minExpect:  1,
			maxExpect:  availableCPU * 2,
		},
		{
			name:       "Mixed task (1.5x multiplier)",
			multiplier: 1.5,
			limit:      0,
			minExpect:  1,
			maxExpect:  int(float64(availableCPU) * 1.5),
		},
		{
			name:       "With limit lower than calculated",
			multiplier: 2.0,
			limit:      2,
			minExpect:  1,
			maxExpect:  2,
		},
		{
			name:       "Very low multiplier",
			multiplier: 0.1,
			limit:      0,
			minExpect:  1,
			maxExpect:  maxInt(1, int(float64(availableCPU)*0.1)),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Count(tt.multiplier, tt.limit)

			if got < tt.minExpect {
				t.Errorf("Count(%v, %d) = %d, expected >= %d", tt.multiplier, tt.limit, got, tt.minExpect)
			}

			if got > tt.maxExpect {
				t.Errorf("Count(%v, %d) = %d, expected <= %d", tt.multiplier, tt.limit, got, tt.maxExpect)
			}

			// Should always return at least 1
			if got < 1 {
				t.Errorf("Count(%v, %d) = %d, should never return less than 1", tt.multiplier, tt.limit, got)
			}
		})
	}
}

func TestCountWithEnvOverride(t *testing.T) {
	tests := []struct {
		name      string
		envValue  string
		limit     int
		expected  int
		wantError bool
	}{
		{
			name:     "Valid override",
			envValue: "8",
			limit:    0,
			expected: 8,
		},
		{
			name:     "Override with limit",
			envValue: "20",
			limit:    10,
			expected: 10, // Should be capped by limit
		},
		{
			name:     "Override below limit",
			envValue: "5",
			limit:    10,
			expected: 5,
		},
		{
			name:      "Invalid override (non-numeric)",
			envValue:  "invalid",
			limit:     0,
			expected:  -1, // Will use default calculation
			wantError: true,
		},
		{
			name:      "Invalid override (zero)",
			envValue:  "0",
			limit:     0,
			expected:  -1, // Will use default calculation
			wantError: true,
		},
		{
			name:      "Invalid override (negative)",
			envValue:  "-5",
			limit:     0,
			expected:  -1, // Will use default calculation
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Setenv("THUMBNAIL_WORKERS", tt.envValue)
			defer os.Unsetenv("THUMBNAIL_WORKERS")

			got := Count(1.0, tt.limit)

			if tt.wantError {
				// Should fall back to default calculation
				if got < 1 {
					t.Errorf("Count with invalid override should return at least 1, got %d", got)
				}
			} else {
				if got != tt.expected {
					t.Errorf("Count(1.0, %d) with THUMBNAIL_WORKERS=%s = %d, want %d", tt.limit, tt.envValue, got, tt.expected)
				}
			}
		})
	}
}

func TestForCPU(t *testing.T) {
	os.Unsetenv("THUMBNAIL_WORKERS")
	defer os.Unsetenv("THUMBNAIL_WORKERS")

	tests := []struct {
		name      string
		limit     int
		wantMin   int
		wantMax   int
		checkFunc func(int, int) bool
	}{
		{
			name:    "No limit",
			limit:   0,
			wantMin: 1,
			wantMax: runtime.GOMAXPROCS(0),
			checkFunc: func(got, _ int) bool {
				return got >= 1 && got <= runtime.GOMAXPROCS(0)
			},
		},
		{
			name:    "With limit of 4",
			limit:   4,
			wantMin: 1,
			wantMax: 4,
			checkFunc: func(got, limit int) bool {
				return got >= 1 && got <= limit
			},
		},
		{
			name:    "With limit of 1",
			limit:   1,
			wantMin: 1,
			wantMax: 1,
			checkFunc: func(got, _ int) bool {
				return got == 1
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ForCPU(tt.limit)

			if !tt.checkFunc(got, tt.limit) {
				t.Errorf("ForCPU(%d) = %d, want between %d and %d", tt.limit, got, tt.wantMin, tt.wantMax)
			}
		})
	}
}

func TestForIO(t *testing.T) {
	os.Unsetenv("THUMBNAIL_WORKERS")
	defer os.Unsetenv("THUMBNAIL_WORKERS")

	tests := []struct {
		name    string
		limit   int
		wantMin int
	}{
		{
			name:    "No limit",
			limit:   0,
			wantMin: 1,
		},
		{
			name:    "With limit of 8",
			limit:   8,
			wantMin: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ForIO(tt.limit)

			if got < tt.wantMin {
				t.Errorf("ForIO(%d) = %d, want >= %d", tt.limit, got, tt.wantMin)
			}

			if tt.limit > 0 && got > tt.limit {
				t.Errorf("ForIO(%d) = %d, should not exceed limit", tt.limit, got)
			}
		})
	}
}

func TestForMixed(t *testing.T) {
	os.Unsetenv("THUMBNAIL_WORKERS")
	defer os.Unsetenv("THUMBNAIL_WORKERS")

	got := ForMixed(0)

	if got < 1 {
		t.Errorf("ForMixed(0) = %d, want >= 1", got)
	}

	// Should be between CPU count and 2x CPU count
	cpuCount := runtime.GOMAXPROCS(0)
	expected := int(float64(cpuCount) * 1.5)

	if got != expected {
		t.Logf("ForMixed(0) = %d, expected ~%d (1.5x %d CPUs)", got, expected, cpuCount)
	}
}

func TestCountBoundaries(t *testing.T) {
	os.Unsetenv("THUMBNAIL_WORKERS")
	defer os.Unsetenv("THUMBNAIL_WORKERS")

	tests := []struct {
		name       string
		multiplier float64
		limit      int
	}{
		{"Zero multiplier", 0.0, 0},
		{"Negative multiplier", -1.0, 0},
		{"Very high multiplier", 100.0, 0},
		{"Zero limit", 1.0, 0},
		{"Very high limit", 1.0, 1000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Count(tt.multiplier, tt.limit)

			// Should never return less than 1
			if got < 1 {
				t.Errorf("Count(%v, %d) = %d, should never be less than 1", tt.multiplier, tt.limit, got)
			}

			// Should respect limit if set
			if tt.limit > 0 && got > tt.limit {
				t.Errorf("Count(%v, %d) = %d, should not exceed limit", tt.multiplier, tt.limit, got)
			}
		})
	}
}

func TestWorkerCountConsistency(t *testing.T) {
	os.Unsetenv("THUMBNAIL_WORKERS")
	defer os.Unsetenv("THUMBNAIL_WORKERS")

	// Multiple calls with same parameters should return same result
	multiplier := 1.5
	limit := 10

	first := Count(multiplier, limit)
	for i := 0; i < 5; i++ {
		got := Count(multiplier, limit)
		if got != first {
			t.Errorf("Count(%v, %d) returned different results: first=%d, iteration %d=%d", multiplier, limit, first, i, got)
		}
	}
}

func BenchmarkCount(b *testing.B) {
	os.Unsetenv("THUMBNAIL_WORKERS")

	b.Run("No override", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = Count(1.5, 10)
		}
	})

	b.Run("With override", func(b *testing.B) {
		os.Setenv("THUMBNAIL_WORKERS", "8")
		defer os.Unsetenv("THUMBNAIL_WORKERS")

		for i := 0; i < b.N; i++ {
			_ = Count(1.5, 10)
		}
	})
}

func BenchmarkForCPU(b *testing.B) {
	os.Unsetenv("THUMBNAIL_WORKERS")

	for i := 0; i < b.N; i++ {
		_ = ForCPU(0)
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
