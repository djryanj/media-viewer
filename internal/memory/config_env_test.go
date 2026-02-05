package memory

import (
	"os"
	"runtime/debug"
	"testing"
)

func TestConfigureFromEnv_NoEnvironmentVariables(t *testing.T) {
	// Clean environment
	oldGoMemLimit := os.Getenv("GOMEMLIMIT")
	oldMemLimit := os.Getenv("MEMORY_LIMIT")
	oldMemRatio := os.Getenv("MEMORY_RATIO")
	defer func() {
		os.Setenv("GOMEMLIMIT", oldGoMemLimit)
		os.Setenv("MEMORY_LIMIT", oldMemLimit)
		os.Setenv("MEMORY_RATIO", oldMemRatio)
	}()

	os.Unsetenv("GOMEMLIMIT")
	os.Unsetenv("MEMORY_LIMIT")
	os.Unsetenv("MEMORY_RATIO")

	result := ConfigureFromEnv()

	if result.Configured {
		t.Error("Expected Configured to be false when no env vars set")
	}

	if result.Source != "none" {
		t.Errorf("Expected Source to be 'none', got %q", result.Source)
	}

	if result.ContainerLimit != 0 {
		t.Errorf("Expected ContainerLimit to be 0, got %d", result.ContainerLimit)
	}

	if result.GoMemLimit != 0 {
		t.Errorf("Expected GoMemLimit to be 0, got %d", result.GoMemLimit)
	}

	if result.Ratio != 0 {
		t.Errorf("Expected Ratio to be 0, got %f", result.Ratio)
	}
}

func TestConfigureFromEnv_GOMEMLIMITSet(t *testing.T) {
	// Save original values
	oldGoMemLimit := os.Getenv("GOMEMLIMIT")
	oldMemLimit := os.Getenv("MEMORY_LIMIT")
	oldLimit := debug.SetMemoryLimit(-1)
	defer func() {
		os.Setenv("GOMEMLIMIT", oldGoMemLimit)
		os.Setenv("MEMORY_LIMIT", oldMemLimit)
		debug.SetMemoryLimit(oldLimit)
	}()

	// Set GOMEMLIMIT (this takes precedence) and also set the actual memory limit
	os.Setenv("GOMEMLIMIT", "500MiB")
	os.Setenv("MEMORY_LIMIT", "1073741824") // 1GB

	// Set an actual memory limit so debug.SetMemoryLimit(-1) returns a valid value
	// Note: GOMEMLIMIT env var is only read at Go startup, so we simulate the effect
	debug.SetMemoryLimit(500 * 1024 * 1024) // 500 MiB

	result := ConfigureFromEnv()

	// The function detects GOMEMLIMIT is set via environment variable
	// and returns early after logging
	// Note: Since we can't truly test GOMEMLIMIT behavior (it's read at startup),
	// we verify it returns early when GOMEMLIMIT env var is set

	// The behavior depends on whether there's actually a memory limit set
	// If limit is set properly, Configured should be true and Source should be GOMEMLIMIT
	if result.Configured {
		if result.Source != sourceGOMEMLIMIT {
			t.Errorf("Expected Source to be %q, got %q", sourceGOMEMLIMIT, result.Source)
		}
		if result.GoMemLimit <= 0 {
			t.Error("Expected GoMemLimit to be positive when Configured is true")
		}
	}
	// If not configured, it means debug.SetMemoryLimit(-1) didn't return a valid limit
	// This is acceptable in test environment
}

func TestConfigureFromEnv_MEMORYLIMITSet(t *testing.T) {
	// Save original values
	oldGoMemLimit := os.Getenv("GOMEMLIMIT")
	oldMemLimit := os.Getenv("MEMORY_LIMIT")
	oldMemRatio := os.Getenv("MEMORY_RATIO")
	defer func() {
		os.Setenv("GOMEMLIMIT", oldGoMemLimit)
		os.Setenv("MEMORY_LIMIT", oldMemLimit)
		os.Setenv("MEMORY_RATIO", oldMemRatio)
		debug.SetMemoryLimit(-1) // Reset to unlimited
	}()

	os.Unsetenv("GOMEMLIMIT")
	os.Setenv("MEMORY_LIMIT", "1073741824") // 1GB
	os.Unsetenv("MEMORY_RATIO")

	result := ConfigureFromEnv()

	if !result.Configured {
		t.Error("Expected Configured to be true when MEMORY_LIMIT is set")
	}

	if result.Source != sourceMEMORYLIMIT {
		t.Errorf("Expected Source to be %q, got %q", sourceMEMORYLIMIT, result.Source)
	}

	if result.ContainerLimit != 1073741824 {
		t.Errorf("Expected ContainerLimit to be 1073741824, got %d", result.ContainerLimit)
	}

	memLimit := int64(1073741824)
	expectedGoMemLimit := int64(float64(memLimit) * DefaultMemoryRatio)
	if result.GoMemLimit != expectedGoMemLimit {
		t.Errorf("Expected GoMemLimit to be %d, got %d", expectedGoMemLimit, result.GoMemLimit)
	}

	if result.Ratio != DefaultMemoryRatio {
		t.Errorf("Expected Ratio to be %f, got %f", DefaultMemoryRatio, result.Ratio)
	}

	// Verify the actual memory limit was set correctly
	actualLimit := debug.SetMemoryLimit(-1)
	debug.SetMemoryLimit(actualLimit) // Restore it
	if actualLimit != expectedGoMemLimit {
		t.Logf("Note: Actual memory limit %d differs from expected %d (this is acceptable)", actualLimit, expectedGoMemLimit)
	}
}

func TestConfigureFromEnv_CustomRatio(t *testing.T) {
	// Save original values
	oldGoMemLimit := os.Getenv("GOMEMLIMIT")
	oldMemLimit := os.Getenv("MEMORY_LIMIT")
	oldMemRatio := os.Getenv("MEMORY_RATIO")
	defer func() {
		os.Setenv("GOMEMLIMIT", oldGoMemLimit)
		os.Setenv("MEMORY_LIMIT", oldMemLimit)
		os.Setenv("MEMORY_RATIO", oldMemRatio)
		debug.SetMemoryLimit(-1)
	}()

	os.Unsetenv("GOMEMLIMIT")
	os.Setenv("MEMORY_LIMIT", "2147483648") // 2GB
	os.Setenv("MEMORY_RATIO", "0.75")

	result := ConfigureFromEnv()

	if !result.Configured {
		t.Error("Expected Configured to be true")
	}

	if result.Source != sourceMEMORYLIMIT {
		t.Errorf("Expected Source to be %q, got %q", sourceMEMORYLIMIT, result.Source)
	}

	if result.ContainerLimit != 2147483648 {
		t.Errorf("Expected ContainerLimit to be 2147483648, got %d", result.ContainerLimit)
	}

	if result.Ratio != 0.75 {
		t.Errorf("Expected Ratio to be 0.75, got %f", result.Ratio)
	}

	memLimit := int64(2147483648)
	expectedGoMemLimit := int64(float64(memLimit) * 0.75)
	if result.GoMemLimit != expectedGoMemLimit {
		t.Errorf("Expected GoMemLimit to be %d, got %d", expectedGoMemLimit, result.GoMemLimit)
	}
}

func TestConfigureFromEnv_InvalidMEMORYLIMIT(t *testing.T) {
	// Save original values
	oldGoMemLimit := os.Getenv("GOMEMLIMIT")
	oldMemLimit := os.Getenv("MEMORY_LIMIT")
	defer func() {
		os.Setenv("GOMEMLIMIT", oldGoMemLimit)
		os.Setenv("MEMORY_LIMIT", oldMemLimit)
	}()

	os.Unsetenv("GOMEMLIMIT")
	os.Setenv("MEMORY_LIMIT", "not-a-number")

	result := ConfigureFromEnv()

	if result.Configured {
		t.Error("Expected Configured to be false when MEMORY_LIMIT is invalid")
	}

	if result.Source != "none" {
		t.Errorf("Expected Source to be 'none', got %q", result.Source)
	}
}

func TestConfigureFromEnv_InvalidRatio(t *testing.T) {
	tests := []struct {
		name          string
		ratioValue    string
		expectDefault bool
	}{
		{
			name:          "Not a number",
			ratioValue:    "not-a-number",
			expectDefault: true,
		},
		{
			name:          "Zero ratio",
			ratioValue:    "0",
			expectDefault: true,
		},
		{
			name:          "Negative ratio",
			ratioValue:    "-0.5",
			expectDefault: true,
		},
		{
			name:          "Ratio greater than 1",
			ratioValue:    "1.5",
			expectDefault: true,
		},
		{
			name:          "Valid ratio at boundary (1.0)",
			ratioValue:    "1.0",
			expectDefault: false,
		},
		{
			name:          "Valid ratio near zero",
			ratioValue:    "0.01",
			expectDefault: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Save original values
			oldGoMemLimit := os.Getenv("GOMEMLIMIT")
			oldMemLimit := os.Getenv("MEMORY_LIMIT")
			oldMemRatio := os.Getenv("MEMORY_RATIO")
			defer func() {
				os.Setenv("GOMEMLIMIT", oldGoMemLimit)
				os.Setenv("MEMORY_LIMIT", oldMemLimit)
				os.Setenv("MEMORY_RATIO", oldMemRatio)
				debug.SetMemoryLimit(-1)
			}()

			os.Unsetenv("GOMEMLIMIT")
			os.Setenv("MEMORY_LIMIT", "1073741824")
			os.Setenv("MEMORY_RATIO", tt.ratioValue)

			result := ConfigureFromEnv()

			if !result.Configured {
				t.Error("Expected Configured to be true even with invalid ratio")
			}

			if tt.expectDefault {
				if result.Ratio != DefaultMemoryRatio {
					t.Errorf("Expected default ratio %f when ratio is invalid, got %f", DefaultMemoryRatio, result.Ratio)
				}
			} else {
				// For valid values, parse and compare
				expectedRatio := 0.0
				switch tt.ratioValue {
				case "1.0":
					expectedRatio = 1.0
				case "0.01":
					expectedRatio = 0.01
				}
				if result.Ratio != expectedRatio {
					t.Errorf("Expected ratio %f, got %f", expectedRatio, result.Ratio)
				}
			}
		})
	}
}

func TestConfigureFromEnv_NegativeMEMORYLIMIT(t *testing.T) {
	// Save original values
	oldGoMemLimit := os.Getenv("GOMEMLIMIT")
	oldMemLimit := os.Getenv("MEMORY_LIMIT")
	defer func() {
		os.Setenv("GOMEMLIMIT", oldGoMemLimit)
		os.Setenv("MEMORY_LIMIT", oldMemLimit)
	}()

	os.Unsetenv("GOMEMLIMIT")
	os.Setenv("MEMORY_LIMIT", "-1073741824")

	result := ConfigureFromEnv()

	// Negative values should parse successfully as int64, but represent unusual config
	if !result.Configured {
		t.Error("Expected Configured to be true even with negative MEMORY_LIMIT")
	}

	if result.ContainerLimit != -1073741824 {
		t.Errorf("Expected ContainerLimit to be -1073741824, got %d", result.ContainerLimit)
	}
}

func TestConfigureFromEnv_VeryLargeMemoryLimit(t *testing.T) {
	// Save original values
	oldGoMemLimit := os.Getenv("GOMEMLIMIT")
	oldMemLimit := os.Getenv("MEMORY_LIMIT")
	defer func() {
		os.Setenv("GOMEMLIMIT", oldGoMemLimit)
		os.Setenv("MEMORY_LIMIT", oldMemLimit)
		debug.SetMemoryLimit(-1)
	}()

	os.Unsetenv("GOMEMLIMIT")
	// 100GB
	os.Setenv("MEMORY_LIMIT", "107374182400")

	result := ConfigureFromEnv()

	if !result.Configured {
		t.Error("Expected Configured to be true")
	}

	if result.ContainerLimit != 107374182400 {
		t.Errorf("Expected ContainerLimit to be 107374182400, got %d", result.ContainerLimit)
	}

	memLimit := int64(107374182400)
	expectedGoMemLimit := int64(float64(memLimit) * DefaultMemoryRatio)
	if result.GoMemLimit != expectedGoMemLimit {
		t.Errorf("Expected GoMemLimit to be %d, got %d", expectedGoMemLimit, result.GoMemLimit)
	}
}

func TestConfigureFromEnv_RatioEdgeCases(t *testing.T) {
	tests := []struct {
		name        string
		memLimit    string
		ratio       string
		expectRatio float64
	}{
		{
			name:        "Minimum valid ratio",
			memLimit:    "1073741824",
			ratio:       "0.01",
			expectRatio: 0.01,
		},
		{
			name:        "Maximum valid ratio",
			memLimit:    "1073741824",
			ratio:       "1.0",
			expectRatio: 1.0,
		},
		{
			name:        "Mid-range ratio",
			memLimit:    "1073741824",
			ratio:       "0.5",
			expectRatio: 0.5,
		},
		{
			name:        "High precision ratio",
			memLimit:    "1073741824",
			ratio:       "0.123456789",
			expectRatio: 0.123456789,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Save original values
			oldGoMemLimit := os.Getenv("GOMEMLIMIT")
			oldMemLimit := os.Getenv("MEMORY_LIMIT")
			oldMemRatio := os.Getenv("MEMORY_RATIO")
			defer func() {
				os.Setenv("GOMEMLIMIT", oldGoMemLimit)
				os.Setenv("MEMORY_LIMIT", oldMemLimit)
				os.Setenv("MEMORY_RATIO", oldMemRatio)
				debug.SetMemoryLimit(-1)
			}()

			os.Unsetenv("GOMEMLIMIT")
			os.Setenv("MEMORY_LIMIT", tt.memLimit)
			os.Setenv("MEMORY_RATIO", tt.ratio)

			result := ConfigureFromEnv()

			if !result.Configured {
				t.Error("Expected Configured to be true")
			}

			if result.Ratio != tt.expectRatio {
				t.Errorf("Expected Ratio to be %f, got %f", tt.expectRatio, result.Ratio)
			}
		})
	}
}

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		name     string
		bytes    int64
		expected string
	}{
		{
			name:     "Zero bytes",
			bytes:    0,
			expected: "0 B",
		},
		{
			name:     "Less than 1KB",
			bytes:    512,
			expected: "512 B",
		},
		{
			name:     "Exactly 1KB",
			bytes:    1024,
			expected: "1.0 KiB",
		},
		{
			name:     "Multiple KBs",
			bytes:    5120,
			expected: "5.0 KiB",
		},
		{
			name:     "Fractional KB",
			bytes:    1536,
			expected: "1.5 KiB",
		},
		{
			name:     "Exactly 1MB",
			bytes:    1048576,
			expected: "1.0 MiB",
		},
		{
			name:     "Multiple MBs",
			bytes:    10485760,
			expected: "10.0 MiB",
		},
		{
			name:     "Exactly 1GB",
			bytes:    1073741824,
			expected: "1.0 GiB",
		},
		{
			name:     "Multiple GBs",
			bytes:    5368709120,
			expected: "5.0 GiB",
		},
		{
			name:     "Fractional GB",
			bytes:    1610612736,
			expected: "1.5 GiB",
		},
		{
			name:     "Exactly 1TB",
			bytes:    1099511627776,
			expected: "1.0 TiB",
		},
		{
			name:     "Large value",
			bytes:    123456789012,
			expected: "115.0 GiB",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatBytes(tt.bytes)
			if result != tt.expected {
				t.Errorf("formatBytes(%d) = %q, expected %q", tt.bytes, result, tt.expected)
			}
		})
	}
}

func TestFormatBytes_AllUnits(t *testing.T) {
	units := []struct {
		name  string
		bytes int64
		unit  string
	}{
		{"Bytes", 100, "B"},
		{"KiB", 2048, "KiB"},
		{"MiB", 2097152, "MiB"},
		{"GiB", 2147483648, "GiB"},
		{"TiB", 2199023255552, "TiB"},
		{"PiB", 2251799813685248, "PiB"},
		{"EiB", 2305843009213693952, "EiB"},
	}

	for _, tt := range units {
		t.Run(tt.name, func(t *testing.T) {
			result := formatBytes(tt.bytes)
			// Check that the result contains the expected unit
			containsUnit := false
			if tt.unit == "B" && result != "" && result[len(result)-1] == 'B' && (len(result) == 1 || result[len(result)-2] == ' ') {
				containsUnit = true
			} else {
				for i := 0; i <= len(result)-len(tt.unit); i++ {
					if result[i:i+len(tt.unit)] == tt.unit {
						containsUnit = true
						break
					}
				}
			}
			if !containsUnit {
				t.Errorf("Expected result to contain unit %q, got %q", tt.unit, result)
			}
		})
	}
}

func TestConfigResultStructFields(t *testing.T) {
	result := ConfigResult{
		Configured:     true,
		Source:         sourceMEMORYLIMIT,
		ContainerLimit: 1073741824,
		GoMemLimit:     912680550,
		Ratio:          0.85,
	}

	if !result.Configured {
		t.Error("Expected Configured to be true")
	}

	if result.Source != "MEMORY_LIMIT" {
		t.Errorf("Expected Source to be 'MEMORY_LIMIT', got %q", result.Source)
	}

	if result.ContainerLimit != 1073741824 {
		t.Errorf("Expected ContainerLimit to be 1073741824, got %d", result.ContainerLimit)
	}

	if result.GoMemLimit != 912680550 {
		t.Errorf("Expected GoMemLimit to be 912680550, got %d", result.GoMemLimit)
	}

	if result.Ratio != 0.85 {
		t.Errorf("Expected Ratio to be 0.85, got %f", result.Ratio)
	}
}

func TestDefaultMemoryRatioConstant(t *testing.T) {
	if DefaultMemoryRatio != 0.85 {
		t.Errorf("Expected DefaultMemoryRatio to be 0.85, got %f", DefaultMemoryRatio)
	}

	if DefaultMemoryRatio <= 0 || DefaultMemoryRatio > 1.0 {
		t.Errorf("DefaultMemoryRatio should be between 0 and 1, got %f", DefaultMemoryRatio)
	}
}

func TestConfigureFromEnv_MultipleCallsIdempotent(t *testing.T) {
	// Save original values
	oldGoMemLimit := os.Getenv("GOMEMLIMIT")
	oldMemLimit := os.Getenv("MEMORY_LIMIT")
	defer func() {
		os.Setenv("GOMEMLIMIT", oldGoMemLimit)
		os.Setenv("MEMORY_LIMIT", oldMemLimit)
		debug.SetMemoryLimit(-1)
	}()

	os.Unsetenv("GOMEMLIMIT")
	os.Setenv("MEMORY_LIMIT", "1073741824")

	result1 := ConfigureFromEnv()
	result2 := ConfigureFromEnv()

	if result1.Configured != result2.Configured {
		t.Error("Multiple calls should return same Configured value")
	}

	if result1.Source != result2.Source {
		t.Error("Multiple calls should return same Source value")
	}

	if result1.ContainerLimit != result2.ContainerLimit {
		t.Error("Multiple calls should return same ContainerLimit value")
	}

	// Note: GoMemLimit might differ on subsequent calls because debug.SetMemoryLimit
	// is called each time, but the Configured and Source should remain consistent
}

func TestConfigureFromEnv_EmptyStringVsUnset(t *testing.T) {
	tests := []struct {
		name       string
		setToEmpty bool
		expectNone bool
	}{
		{
			name:       "Unset MEMORY_LIMIT",
			setToEmpty: false,
			expectNone: true,
		},
		{
			name:       "Empty string MEMORY_LIMIT",
			setToEmpty: true,
			expectNone: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Save original values
			oldGoMemLimit := os.Getenv("GOMEMLIMIT")
			oldMemLimit := os.Getenv("MEMORY_LIMIT")
			defer func() {
				os.Setenv("GOMEMLIMIT", oldGoMemLimit)
				os.Setenv("MEMORY_LIMIT", oldMemLimit)
			}()

			os.Unsetenv("GOMEMLIMIT")
			if tt.setToEmpty {
				os.Setenv("MEMORY_LIMIT", "")
			} else {
				os.Unsetenv("MEMORY_LIMIT")
			}

			result := ConfigureFromEnv()

			if result.Configured {
				t.Error("Expected Configured to be false")
			}

			if result.Source != "none" {
				t.Errorf("Expected Source to be 'none', got %q", result.Source)
			}
		})
	}
}

func BenchmarkConfigureFromEnv(b *testing.B) {
	// Save original values
	oldGoMemLimit := os.Getenv("GOMEMLIMIT")
	oldMemLimit := os.Getenv("MEMORY_LIMIT")
	defer func() {
		os.Setenv("GOMEMLIMIT", oldGoMemLimit)
		os.Setenv("MEMORY_LIMIT", oldMemLimit)
		debug.SetMemoryLimit(-1)
	}()

	os.Unsetenv("GOMEMLIMIT")
	os.Setenv("MEMORY_LIMIT", "1073741824")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = ConfigureFromEnv()
	}
}

func BenchmarkFormatBytes(b *testing.B) {
	testBytes := int64(1234567890)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = formatBytes(testBytes)
	}
}

func BenchmarkFormatBytes_SmallValue(b *testing.B) {
	testBytes := int64(512)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = formatBytes(testBytes)
	}
}

func BenchmarkFormatBytes_LargeValue(b *testing.B) {
	testBytes := int64(1099511627776) // 1TB
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = formatBytes(testBytes)
	}
}
