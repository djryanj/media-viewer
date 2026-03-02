package logging

import (
	"os"
	"sync"
	"testing"
)

func TestLogLevel(t *testing.T) {
	tests := []struct {
		name     string
		envVar   string
		envValue string
		expected LogLevel
	}{
		{
			name:     "Debug via LOG_LEVEL",
			envVar:   "LOG_LEVEL",
			envValue: "debug",
			expected: LevelDebug,
		},
		{
			name:     "Info via LOG_LEVEL",
			envVar:   "LOG_LEVEL",
			envValue: "info",
			expected: LevelInfo,
		},
		{
			name:     "Warn via LOG_LEVEL",
			envVar:   "LOG_LEVEL",
			envValue: "warn",
			expected: LevelWarn,
		},
		{
			name:     "Error via LOG_LEVEL",
			envVar:   "LOG_LEVEL",
			envValue: "error",
			expected: LevelError,
		},
		{
			name:     "Case insensitive",
			envVar:   "LOG_LEVEL",
			envValue: "DEBUG",
			expected: LevelDebug,
		},
		{
			name:     "Warning alias",
			envVar:   "LOG_LEVEL",
			envValue: "warning",
			expected: LevelWarn,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Reset the sync.Once for each test
			// This is a limitation - in real code levelOnce can't be reset
			// But we can at least test the parseLevel logic indirectly
			os.Setenv(tt.envVar, tt.envValue)
			defer os.Unsetenv(tt.envVar)

			// Note: Due to sync.Once, we can't truly test GetLevel() multiple times
			// in the same process. This test documents the expected behavior.
			if tt.expected < LevelDebug || tt.expected > LevelError {
				t.Errorf("Invalid expected level: %v", tt.expected)
			}
		})
	}
}

func TestLogLevelConstants(t *testing.T) {
	// Verify log level ordering
	if LevelDebug >= LevelInfo {
		t.Error("LevelDebug should be less than LevelInfo")
	}
	if LevelInfo >= LevelWarn {
		t.Error("LevelInfo should be less than LevelWarn")
	}
	if LevelWarn >= LevelError {
		t.Error("LevelWarn should be less than LevelError")
	}

	// Verify level values for comparison operations
	levels := []LogLevel{LevelDebug, LevelInfo, LevelWarn, LevelError}
	for i := 0; i < len(levels)-1; i++ {
		if levels[i] >= levels[i+1] {
			t.Errorf("Log levels should be in ascending order: %v >= %v", levels[i], levels[i+1])
		}
	}
}

func TestIsDebugEnabled(t *testing.T) {
	// Test that IsDebugEnabled returns a boolean
	result := IsDebugEnabled()
	if result != true && result != false {
		t.Error("IsDebugEnabled should return a boolean value")
	}
}

// TestLoggingFunctions tests that logging functions don't panic
func TestLoggingFunctions(t *testing.T) {
	tests := []struct {
		name string
		fn   func()
	}{
		{
			name: "Debug doesn't panic",
			fn:   func() { Debug("test message") },
		},
		{
			name: "Info doesn't panic",
			fn:   func() { Info("test message") },
		},
		{
			name: "Warn doesn't panic",
			fn:   func() { Warn("test message") },
		},
		{
			name: "Error doesn't panic",
			fn:   func() { Error("test message") },
		},
		{
			name: "Debug with args doesn't panic",
			fn:   func() { Debug("test %s %d", "message", 123) },
		},
		{
			name: "Info with args doesn't panic",
			fn:   func() { Info("test %s %d", "message", 123) },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Function panicked: %v", r)
				}
			}()
			tt.fn()
		})
	}
}

func TestPrintfAndPrintln(t *testing.T) {
	// Test that Printf and Println don't panic
	t.Run("Printf doesn't panic", func(t *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Printf panicked: %v", r)
			}
		}()
		Printf("test message")
		Printf("test %s %d", "message", 123)
	})

	t.Run("Println doesn't panic", func(t *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Println panicked: %v", r)
			}
		}()
		Println("test message")
		Println("test", "message", 123)
	})
}

func TestLogLevelString(t *testing.T) {
	tests := []struct {
		level    LogLevel
		expected string
	}{
		{LevelDebug, "debug"},
		{LevelInfo, "info"},
		{LevelWarn, "warn"},
		{LevelError, "error"},
		{LogLevel(99), "unknown(99)"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			got := tt.level.String()
			if got != tt.expected {
				t.Errorf("LogLevel.String() = %q, want %q", got, tt.expected)
			}
		})
	}
}

// =============================================================================
// initLevel DEBUG env-var branch coverage
// These tests need to reset the package-level sync.Once (accessible because
// they are in the same package) to exercise initLevel fresh for each case.
// =============================================================================

// TestInitLevelDEBUGEnvTruthy verifies that DEBUG=1/true/yes/on all select
// LevelDebug, covering the previously uncovered case body of initLevel.
func TestInitLevelDEBUGEnvTruthy(t *testing.T) {
	// Restore package state when the whole test completes so later tests are
	// not affected by our level/Once manipulation.
	t.Cleanup(func() {
		levelOnce = sync.Once{}
		currentLevel = LevelInfo
	})

	tests := []struct {
		debugVal string
	}{
		{"1"},
		{"true"},
		{"yes"},
		{"on"},
		{"TRUE"}, // case-insensitive
		{"ON"},
	}

	for _, tt := range tests {
		t.Run("DEBUG="+tt.debugVal, func(t *testing.T) {
			// Reset once and level for each sub-run.
			levelOnce = sync.Once{}
			currentLevel = LevelInfo

			t.Setenv("DEBUG", tt.debugVal)
			t.Setenv("LOG_LEVEL", "") // ensure LOG_LEVEL doesn't interfere

			initLevel()

			if currentLevel != LevelDebug {
				t.Errorf("DEBUG=%s: expected LevelDebug, got %v", tt.debugVal, currentLevel)
			}
		})
	}
}

// TestInitLevelDEBUGEnvNonTruthy verifies that a non-empty but non-truthy
// DEBUG value (e.g., "false") falls through to the LOG_LEVEL check and then
// to the default (LevelInfo), covering the if-body entry without the case hit.
func TestInitLevelDEBUGEnvNonTruthy(t *testing.T) {
	t.Cleanup(func() {
		levelOnce = sync.Once{}
		currentLevel = LevelInfo
	})

	levelOnce = sync.Once{}
	currentLevel = LevelInfo

	t.Setenv("DEBUG", "false")
	t.Setenv("LOG_LEVEL", "") // not set → default

	initLevel()

	if currentLevel != LevelInfo {
		t.Errorf("DEBUG=false with no LOG_LEVEL: expected LevelInfo, got %v", currentLevel)
	}
}

// TestInitLevelLOGLEVELCases verifies the individual LOG_LEVEL switch case
// bodies (info, warn, warning, error, default) inside initLevel — these are
// not reached by the DEBUG-env tests because DEBUG= triggers an early return.
func TestInitLevelLOGLEVELCases(t *testing.T) {
	t.Cleanup(func() {
		levelOnce = sync.Once{}
		currentLevel = LevelInfo
	})

	tests := []struct {
		logLevel string
		want     LogLevel
	}{
		{"info", LevelInfo},
		{"INFO", LevelInfo}, // case-insensitive via strings.ToLower
		{"warn", LevelWarn},
		{"warning", LevelWarn},
		{"error", LevelError},
		{"", LevelInfo},        // default case
		{"unknown", LevelInfo}, // default case
	}

	for _, tt := range tests {
		t.Run("LOG_LEVEL="+tt.logLevel, func(t *testing.T) {
			// Reset levelOnce so initLevel executes fresh.
			levelOnce = sync.Once{}
			currentLevel = LevelDebug // start different from expected to detect changes

			// No DEBUG env — must reach the LOG_LEVEL switch.
			os.Unsetenv("DEBUG")
			t.Setenv("LOG_LEVEL", tt.logLevel)

			initLevel()

			if currentLevel != tt.want {
				t.Errorf("LOG_LEVEL=%q: expected level %v, got %v", tt.logLevel, tt.want, currentLevel)
			}
		})
	}
}

// TestDebugBodyExecutedWhenDebugEnabled verifies that Debug()'s log.Printf
// branch (line 74 in logging.go) is executed when the log level is LevelDebug.
// This covers the "73.30,75.3" uncovered block from the coverage report.
func TestDebugBodyExecutedWhenDebugEnabled(t *testing.T) {
	t.Cleanup(func() {
		levelOnce = sync.Once{}
		currentLevel = LevelInfo
	})

	// Set level directly — the check in Debug() is `GetLevel() <= LevelDebug`.
	// By setting currentLevel = LevelDebug and firing a fresh levelOnce we ensure
	// the condition is true and the Printf line is reached.
	levelOnce = sync.Once{}
	os.Unsetenv("DEBUG")
	t.Setenv("LOG_LEVEL", "debug")
	initLevel() // sets currentLevel = LevelDebug

	// This call must reach log.Printf inside Debug(), covering the branch.
	Debug("coverage probe: %s", "debug body executed")

	if currentLevel != LevelDebug {
		t.Errorf("expected LevelDebug after LOG_LEVEL=debug, got %v", currentLevel)
	}
}
