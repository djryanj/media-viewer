package logging

import (
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
)

// LogLevel represents the severity of a log message
type LogLevel int

const (
	// LevelDebug is the debug log level
	LevelDebug LogLevel = iota
	// LevelInfo is the info log level
	LevelInfo
	// LevelWarn is the warning log level
	LevelWarn
	// LevelError is the error log level
	LevelError
)

var (
	currentLevel LogLevel
	levelOnce    sync.Once
)

// initLevel initializes the log level from environment variables
func initLevel() {
	levelOnce.Do(func() {
		// Check DEBUG environment variable first
		if debug := os.Getenv("DEBUG"); debug != "" {
			switch strings.ToLower(debug) {
			case "1", "true", "yes", "on":
				currentLevel = LevelDebug
				return
			}
		}

		// Check LOG_LEVEL environment variable
		levelStr := strings.ToLower(os.Getenv("LOG_LEVEL"))
		switch levelStr {
		case "debug":
			currentLevel = LevelDebug
		case "info":
			currentLevel = LevelInfo
		case "warn", "warning":
			currentLevel = LevelWarn
		case "error":
			currentLevel = LevelError
		default:
			// Default to Info level (no debug logs)
			currentLevel = LevelInfo
		}
	})
}

// GetLevel returns the current log level
func GetLevel() LogLevel {
	initLevel()
	return currentLevel
}

// IsDebugEnabled returns true if debug logging is enabled
func IsDebugEnabled() bool {
	return GetLevel() <= LevelDebug
}

// Debug logs a debug message (only if DEBUG=true or LOG_LEVEL=debug)
func Debug(format string, args ...interface{}) {
	if GetLevel() <= LevelDebug {
		log.Printf("[DEBUG] "+format, args...)
	}
}

// Info logs an info message
func Info(format string, args ...interface{}) {
	if GetLevel() <= LevelInfo {
		log.Printf("[INFO] "+format, args...)
	}
}

// Warn logs a warning message
func Warn(format string, args ...interface{}) {
	if GetLevel() <= LevelWarn {
		log.Printf("[WARN] "+format, args...)
	}
}

// Error logs an error message
func Error(format string, args ...interface{}) {
	if GetLevel() <= LevelError {
		log.Printf("[ERROR] "+format, args...)
	}
}

// Fatal logs an error message and exits
func Fatal(format string, args ...interface{}) {
	log.Fatalf("[FATAL] "+format, args...)
}

// Printf is a pass-through to log.Printf for messages that should always print
func Printf(format string, args ...interface{}) {
	log.Printf(format, args...)
}

// Println is a pass-through to log.Println for messages that should always print
func Println(args ...interface{}) {
	log.Println(args...)
}

// String returns the string representation of a log level
func (l LogLevel) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelInfo:
		return "info"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	default:
		return fmt.Sprintf("unknown(%d)", l)
	}
}
