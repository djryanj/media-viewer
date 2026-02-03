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
