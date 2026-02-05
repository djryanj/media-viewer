package startup

import (
	"testing"
)

func TestGetEnvBool(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		envValue     string
		defaultValue bool
		want         bool
		setEnv       bool
	}{
		{
			name:         "Returns default when env var not set",
			key:          "TEST_BOOL_UNSET",
			defaultValue: true,
			want:         true,
			setEnv:       false,
		},
		{
			name:         "Returns default false when env var not set",
			key:          "TEST_BOOL_UNSET2",
			defaultValue: false,
			want:         false,
			setEnv:       false,
		},
		{
			name:         "Returns true when env var is 'true'",
			key:          "TEST_BOOL_TRUE",
			envValue:     "true",
			defaultValue: false,
			want:         true,
			setEnv:       true,
		},
		{
			name:         "Returns false when env var is 'false'",
			key:          "TEST_BOOL_FALSE",
			envValue:     "false",
			defaultValue: true,
			want:         false,
			setEnv:       true,
		},
		{
			name:         "Returns true when env var is '1'",
			key:          "TEST_BOOL_ONE",
			envValue:     "1",
			defaultValue: false,
			want:         true,
			setEnv:       true,
		},
		{
			name:         "Returns false when env var is '0'",
			key:          "TEST_BOOL_ZERO",
			envValue:     "0",
			defaultValue: true,
			want:         false,
			setEnv:       true,
		},
		{
			name:         "Returns true when env var is 't'",
			key:          "TEST_BOOL_T",
			envValue:     "t",
			defaultValue: false,
			want:         true,
			setEnv:       true,
		},
		{
			name:         "Returns false when env var is 'f'",
			key:          "TEST_BOOL_F",
			envValue:     "f",
			defaultValue: true,
			want:         false,
			setEnv:       true,
		},
		{
			name:         "Returns true when env var is 'T'",
			key:          "TEST_BOOL_T_UPPER",
			envValue:     "T",
			defaultValue: false,
			want:         true,
			setEnv:       true,
		},
		{
			name:         "Returns false when env var is 'F'",
			key:          "TEST_BOOL_F_UPPER",
			envValue:     "F",
			defaultValue: true,
			want:         false,
			setEnv:       true,
		},
		{
			name:         "Returns true when env var is 'TRUE'",
			key:          "TEST_BOOL_TRUE_UPPER",
			envValue:     "TRUE",
			defaultValue: false,
			want:         true,
			setEnv:       true,
		},
		{
			name:         "Returns false when env var is 'FALSE'",
			key:          "TEST_BOOL_FALSE_UPPER",
			envValue:     "FALSE",
			defaultValue: true,
			want:         false,
			setEnv:       true,
		},
		{
			name:         "Returns default when env var is invalid",
			key:          "TEST_BOOL_INVALID",
			envValue:     "not-a-bool",
			defaultValue: true,
			want:         true,
			setEnv:       true,
		},
		{
			name:         "Returns default when env var is empty string",
			key:          "TEST_BOOL_EMPTY",
			envValue:     "",
			defaultValue: false,
			want:         false,
			setEnv:       true,
		},
		{
			name:         "Returns default when env var has spaces",
			key:          "TEST_BOOL_SPACES",
			envValue:     "   ",
			defaultValue: true,
			want:         true,
			setEnv:       true,
		},
		{
			name:         "Returns default when env var is 'yes'",
			key:          "TEST_BOOL_YES",
			envValue:     "yes",
			defaultValue: false,
			want:         false,
			setEnv:       true,
		},
		{
			name:         "Returns default when env var is 'no'",
			key:          "TEST_BOOL_NO",
			envValue:     "no",
			defaultValue: true,
			want:         true,
			setEnv:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setEnv {
				t.Setenv(tt.key, tt.envValue)
			}

			got := getEnvBool(tt.key, tt.defaultValue)
			if got != tt.want {
				t.Errorf("getEnvBool(%q, %v) = %v, want %v (env: %q)", tt.key, tt.defaultValue, got, tt.want, tt.envValue)
			}
		})
	}
}

func TestFormatBytesStartup(t *testing.T) {
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
			name:     "Fractional MB",
			bytes:    1572864,
			expected: "1.5 MiB",
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
			name:     "Exactly 1PB",
			bytes:    1125899906842624,
			expected: "1.0 PiB",
		},
		{
			name:     "Exactly 1EB",
			bytes:    1152921504606846976,
			expected: "1.0 EiB",
		},
		{
			name:     "Large value",
			bytes:    123456789012,
			expected: "115.0 GiB",
		},
		{
			name:     "870.4 MiB (from log)",
			bytes:    912680550,
			expected: "870.4 MiB",
		},
		{
			name:     "Small fractional value",
			bytes:    10737418, // ~10.2 MiB
			expected: "10.2 MiB",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatBytesStartup(tt.bytes)
			if result != tt.expected {
				t.Errorf("formatBytesStartup(%d) = %q, expected %q", tt.bytes, result, tt.expected)
			}
		})
	}
}

func TestFormatBytesStartup_AllUnits(t *testing.T) {
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
			result := formatBytesStartup(tt.bytes)
			// Check that the result contains the expected unit
			containsUnit := false
			for i := 0; i <= len(result)-len(tt.unit); i++ {
				if result[i:i+len(tt.unit)] == tt.unit {
					containsUnit = true
					break
				}
			}
			if !containsUnit {
				t.Errorf("Expected result to contain unit %q, got %q", tt.unit, result)
			}
		})
	}
}

func TestMemoryConfigStruct(t *testing.T) {
	mc := MemoryConfig{
		Configured:     true,
		Source:         "MEMORY_LIMIT",
		ContainerLimit: 1073741824,
		GoMemLimit:     912680550,
		Ratio:          0.85,
	}

	if !mc.Configured {
		t.Error("Expected Configured to be true")
	}

	if mc.Source != "MEMORY_LIMIT" {
		t.Errorf("Expected Source='MEMORY_LIMIT', got %q", mc.Source)
	}

	if mc.ContainerLimit != 1073741824 {
		t.Errorf("Expected ContainerLimit=1073741824, got %d", mc.ContainerLimit)
	}

	if mc.GoMemLimit != 912680550 {
		t.Errorf("Expected GoMemLimit=912680550, got %d", mc.GoMemLimit)
	}

	if mc.Ratio != 0.85 {
		t.Errorf("Expected Ratio=0.85, got %f", mc.Ratio)
	}
}

func TestLogMemoryConfig_NotConfigured(_ *testing.T) {
	mc := MemoryConfig{
		Configured: false,
	}

	// Should not panic when called with unconfigured memory
	LogMemoryConfig(mc)
}

func TestLogMemoryConfig_GOMEMLIMIT(_ *testing.T) {
	mc := MemoryConfig{
		Configured: true,
		Source:     "GOMEMLIMIT",
		GoMemLimit: 524288000,
	}

	// Should not panic
	LogMemoryConfig(mc)
}

func TestLogMemoryConfig_MEMORY_LIMIT(_ *testing.T) {
	mc := MemoryConfig{
		Configured:     true,
		Source:         "MEMORY_LIMIT",
		ContainerLimit: 1073741824,
		GoMemLimit:     912680550,
		Ratio:          0.85,
	}

	// Should not panic
	LogMemoryConfig(mc)
}

func TestLogWebAuthnInit_Disabled(_ *testing.T) {
	// Should not panic
	LogWebAuthnInit(false, "")
}

func TestLogWebAuthnInit_Enabled(_ *testing.T) {
	// Should not panic
	LogWebAuthnInit(true, "example.com")
}

func TestLogWebAuthnInitComplete_NoCredentials(_ *testing.T) {
	// Should not panic
	LogWebAuthnInitComplete(0)
}

func TestLogWebAuthnInitComplete_WithCredentials(_ *testing.T) {
	// Should not panic
	LogWebAuthnInitComplete(5)
}

func TestLogWebAuthnInitError(_ *testing.T) {
	// Should not panic
	LogWebAuthnInitError(nil)
}

func TestLogWebAuthnRegistration(_ *testing.T) {
	// Should not panic
	LogWebAuthnRegistration("test-device")
}

func TestLogWebAuthnLogin(_ *testing.T) {
	// Should not panic
	LogWebAuthnLogin()
}

func TestLogWebAuthnLoginFailure(_ *testing.T) {
	// Should not panic
	LogWebAuthnLoginFailure("invalid credential")
}

func TestBuildInfoStruct(t *testing.T) {
	info := BuildInfo{
		Version:   "1.0.0",
		Commit:    "abc123",
		BuildTime: "2026-01-01",
		GoVersion: "go1.21.0",
		OS:        "linux",
		Arch:      "amd64",
	}

	if info.Version != "1.0.0" {
		t.Errorf("Expected Version='1.0.0', got %q", info.Version)
	}

	if info.Commit != "abc123" {
		t.Errorf("Expected Commit='abc123', got %q", info.Commit)
	}

	if info.BuildTime != "2026-01-01" {
		t.Errorf("Expected BuildTime='2026-01-01', got %q", info.BuildTime)
	}

	if info.GoVersion != "go1.21.0" {
		t.Errorf("Expected GoVersion='go1.21.0', got %q", info.GoVersion)
	}

	if info.OS != "linux" {
		t.Errorf("Expected OS='linux', got %q", info.OS)
	}

	if info.Arch != "amd64" {
		t.Errorf("Expected Arch='amd64', got %q", info.Arch)
	}
}

func BenchmarkGetEnv(b *testing.B) {
	b.Setenv("BENCH_TEST_VAR", "test-value")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = getEnv("BENCH_TEST_VAR", "default")
	}
}

func BenchmarkGetEnvBool(b *testing.B) {
	b.Setenv("BENCH_TEST_BOOL", "true")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = getEnvBool("BENCH_TEST_BOOL", false)
	}
}

func BenchmarkFormatBytesStartup(b *testing.B) {
	testBytes := int64(1234567890)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = formatBytesStartup(testBytes)
	}
}

func BenchmarkFormatBytesStartup_SmallValue(b *testing.B) {
	testBytes := int64(512)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = formatBytesStartup(testBytes)
	}
}

func BenchmarkFormatBytesStartup_LargeValue(b *testing.B) {
	testBytes := int64(1099511627776) // 1TB

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = formatBytesStartup(testBytes)
	}
}
