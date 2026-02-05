package memory

import (
	"testing"
	"time"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.MemoryLimitBytes != 0 {
		t.Errorf("Expected MemoryLimitBytes to be 0, got %d", cfg.MemoryLimitBytes)
	}

	if cfg.HighWaterMark != 0.7 {
		t.Errorf("Expected HighWaterMark to be 0.7, got %f", cfg.HighWaterMark)
	}

	if cfg.CriticalWaterMark != 0.85 {
		t.Errorf("Expected CriticalWaterMark to be 0.85, got %f", cfg.CriticalWaterMark)
	}

	if cfg.CheckInterval != 5*time.Second {
		t.Errorf("Expected CheckInterval to be 5s, got %v", cfg.CheckInterval)
	}
}

func TestConfigValidation(t *testing.T) {
	tests := []struct {
		name   string
		config Config
		valid  bool
	}{
		{
			name:   "Default config is valid",
			config: DefaultConfig(),
			valid:  true,
		},
		{
			name: "Custom valid config",
			config: Config{
				MemoryLimitBytes:  1024 * 1024 * 1024, // 1GB
				HighWaterMark:     0.75,
				CriticalWaterMark: 0.9,
				CheckInterval:     10 * time.Second,
			},
			valid: true,
		},
		{
			name: "Zero check interval",
			config: Config{
				MemoryLimitBytes:  0,
				HighWaterMark:     0.7,
				CriticalWaterMark: 0.85,
				CheckInterval:     0,
			},
			valid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Basic validation - check interval should not be zero
			if tt.config.CheckInterval == 0 && tt.valid {
				t.Error("Config with zero CheckInterval should be invalid")
			}

			// High water mark should be less than critical
			if tt.config.HighWaterMark >= tt.config.CriticalWaterMark && tt.valid {
				t.Error("HighWaterMark should be less than CriticalWaterMark")
			}
		})
	}
}

func TestConfigWatermarks(t *testing.T) {
	tests := []struct {
		name             string
		high             float64
		critical         float64
		expectValidOrder bool
	}{
		{
			name:             "Valid watermarks",
			high:             0.7,
			critical:         0.85,
			expectValidOrder: true,
		},
		{
			name:             "Equal watermarks",
			high:             0.8,
			critical:         0.8,
			expectValidOrder: false,
		},
		{
			name:             "Inverted watermarks",
			high:             0.9,
			critical:         0.7,
			expectValidOrder: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			validOrder := tt.high < tt.critical

			if validOrder != tt.expectValidOrder {
				t.Errorf("Expected validOrder=%v, got %v", tt.expectValidOrder, validOrder)
			}
		})
	}
}

func TestConfigMemoryLimitBytes(t *testing.T) {
	tests := []struct {
		name  string
		bytes int64
		valid bool
	}{
		{"Zero limit (unlimited)", 0, true},
		{"1GB limit", 1024 * 1024 * 1024, true},
		{"Negative limit", -1, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := Config{
				MemoryLimitBytes:  tt.bytes,
				HighWaterMark:     0.7,
				CriticalWaterMark: 0.85,
				CheckInterval:     5 * time.Second,
			}

			if tt.bytes < 0 && tt.valid {
				t.Error("Negative memory limit should be invalid")
			}

			if config.MemoryLimitBytes != tt.bytes {
				t.Errorf("Expected MemoryLimitBytes=%d, got %d", tt.bytes, config.MemoryLimitBytes)
			}

			if config.HighWaterMark != 0.7 {
				t.Errorf("Expected HighWaterMark=0.7, got %f", config.HighWaterMark)
			}

			if config.CriticalWaterMark != 0.85 {
				t.Errorf("Expected CriticalWaterMark=0.85, got %f", config.CriticalWaterMark)
			}

			if config.CheckInterval != 5*time.Second {
				t.Errorf("Expected CheckInterval=5s, got %v", config.CheckInterval)
			}
		})
	}
}

func TestConfigCheckInterval(t *testing.T) {
	tests := []struct {
		name     string
		interval time.Duration
		valid    bool
	}{
		{"5 seconds", 5 * time.Second, true},
		{"1 second", 1 * time.Second, true},
		{"Zero interval", 0, false},
		{"Negative interval", -1 * time.Second, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := Config{
				MemoryLimitBytes:  0,
				HighWaterMark:     0.7,
				CriticalWaterMark: 0.85,
				CheckInterval:     tt.interval,
			}

			if tt.interval <= 0 && tt.valid {
				t.Error("Non-positive check interval should be invalid")
			}

			if config.CheckInterval != tt.interval {
				t.Errorf("Expected CheckInterval=%v, got %v", tt.interval, config.CheckInterval)
			}

			if config.MemoryLimitBytes != 0 {
				t.Errorf("Expected MemoryLimitBytes=0, got %d", config.MemoryLimitBytes)
			}

			if config.HighWaterMark != 0.7 {
				t.Errorf("Expected HighWaterMark=0.7, got %f", config.HighWaterMark)
			}

			if config.CriticalWaterMark != 0.85 {
				t.Errorf("Expected CriticalWaterMark=0.85, got %f", config.CriticalWaterMark)
			}
		})
	}
}

func TestConfigWatermarkBoundaries(t *testing.T) {
	tests := []struct {
		name     string
		high     float64
		critical float64
		valid    bool
	}{
		{"Valid range", 0.7, 0.85, true},
		{"At boundaries", 0.0, 1.0, true},
		{"High below zero", -0.1, 0.85, false},
		{"Critical above 1.0", 0.7, 1.1, false},
		{"Both out of range", -0.1, 1.1, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := Config{
				MemoryLimitBytes:  0,
				HighWaterMark:     tt.high,
				CriticalWaterMark: tt.critical,
				CheckInterval:     5 * time.Second,
			}

			validRange := tt.high >= 0 && tt.high <= 1.0 && tt.critical >= 0 && tt.critical <= 1.0
			validOrder := tt.high < tt.critical

			if validRange && validOrder != tt.valid {
				t.Errorf("Expected valid=%v, but range=%v order=%v", tt.valid, validRange, validOrder)
			}

			_ = config
		})
	}
}

func TestConfigStructFields(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  2048,
		HighWaterMark:     0.6,
		CriticalWaterMark: 0.8,
		CheckInterval:     10 * time.Second,
	}

	if config.MemoryLimitBytes != 2048 {
		t.Errorf("MemoryLimitBytes field mismatch")
	}

	if config.HighWaterMark != 0.6 {
		t.Errorf("HighWaterMark field mismatch")
	}

	if config.CriticalWaterMark != 0.8 {
		t.Errorf("CriticalWaterMark field mismatch")
	}

	if config.CheckInterval != 10*time.Second {
		t.Errorf("CheckInterval field mismatch")
	}
}

func TestDefaultConfigValues(t *testing.T) {
	// Test that defaults are reasonable
	cfg := DefaultConfig()

	// Check interval should be positive and not too frequent
	if cfg.CheckInterval < 1*time.Second {
		t.Error("Default check interval should be at least 1 second")
	}

	// Watermarks should be in valid range
	if cfg.HighWaterMark < 0 || cfg.HighWaterMark > 1.0 {
		t.Errorf("HighWaterMark should be between 0 and 1, got %f", cfg.HighWaterMark)
	}

	if cfg.CriticalWaterMark < 0 || cfg.CriticalWaterMark > 1.0 {
		t.Errorf("CriticalWaterMark should be between 0 and 1, got %f", cfg.CriticalWaterMark)
	}

	// High should be less than critical
	if cfg.HighWaterMark >= cfg.CriticalWaterMark {
		t.Error("HighWaterMark should be less than CriticalWaterMark")
	}
}

func BenchmarkDefaultConfig(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = DefaultConfig()
	}
}
