package startup

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"media-viewer/internal/logging"
)

const Version = "1.0.0"

// Config holds all application configuration
type Config struct {
	MediaDir       string
	CacheDir       string
	Port           string
	IndexInterval  time.Duration
	LogStaticFiles bool

	// Derived paths
	DatabasePath string
	ThumbnailDir string
	TranscodeDir string

	// Feature flags based on directory availability
	ThumbnailsEnabled  bool
	TranscodingEnabled bool
}

// LoadConfig loads and validates configuration from environment variables
func LoadConfig() (*Config, error) {
	printBanner()
	logSystemInfo()

	logging.Info("------------------------------------------------------------")
	logging.Info("CONFIGURATION")
	logging.Info("------------------------------------------------------------")

	mediaDir := getEnv("MEDIA_DIR", "/media")
	cacheDir := getEnv("CACHE_DIR", "/cache")
	port := getEnv("PORT", "8080")
	indexIntervalStr := getEnv("INDEX_INTERVAL", "30m")
	logStaticFiles := getEnv("LOG_STATIC_FILES", "false") == "true"

	logging.Info("  MEDIA_DIR:        %s", mediaDir)
	logging.Info("  CACHE_DIR:        %s", cacheDir)
	logging.Info("  PORT:             %s", port)
	logging.Info("  INDEX_INTERVAL:   %s", indexIntervalStr)
	logging.Info("  LOG_STATIC_FILES: %v", logStaticFiles)
	logging.Info("  LOG_LEVEL:        %s", logging.GetLevel())

	indexInterval, err := time.ParseDuration(indexIntervalStr)
	if err != nil {
		logging.Warn("  Invalid INDEX_INTERVAL, using default: 30m")
		indexInterval = 30 * time.Minute
	}

	// Resolve paths
	logging.Info("")
	logging.Info("------------------------------------------------------------")
	logging.Info("DIRECTORY SETUP")
	logging.Info("------------------------------------------------------------")

	mediaDir, err = filepath.Abs(mediaDir)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve media directory path: %w", err)
	}
	logging.Info("  Media directory (absolute): %s", mediaDir)

	cacheDir, err = filepath.Abs(cacheDir)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve cache directory path: %w", err)
	}
	logging.Info("  Cache directory (absolute): %s", cacheDir)

	// Check/create media directory (warning only)
	if err := ensureDirectory(mediaDir, "media"); err != nil {
		logging.Warn("  Media directory issue: %v", err)
	}

	// Check/create cache directory structure
	config := &Config{
		MediaDir:       mediaDir,
		CacheDir:       cacheDir,
		Port:           port,
		IndexInterval:  indexInterval,
		LogStaticFiles: logStaticFiles,
		DatabasePath:   filepath.Join(cacheDir, "media.db"),
		ThumbnailDir:   filepath.Join(cacheDir, "thumbnails"),
		TranscodeDir:   filepath.Join(cacheDir, "transcoded"),
	}

	// Ensure base cache directory exists (required for database)
	if err := ensureDirectory(cacheDir, "cache"); err != nil {
		return nil, fmt.Errorf("cache directory error: %w", err)
	}

	// Test write access for database (required)
	logging.Debug("  Testing cache directory write access...")
	if err := testWriteAccess(cacheDir); err != nil {
		return nil, fmt.Errorf("cache directory is not writable (required for database): %w", err)
	}
	logging.Info("  [OK] Cache directory is writable")

	// Setup thumbnail directory (optional)
	config.ThumbnailsEnabled = setupOptionalDir(config.ThumbnailDir, "thumbnails")

	// Setup transcode directory (optional)
	config.TranscodingEnabled = setupOptionalDir(config.TranscodeDir, "transcoding")

	// Summary
	logging.Info("")
	logging.Info("  Feature availability:")
	logging.Info("    Database:    ENABLED (required)")
	logging.Info("    Thumbnails:  %s", enabledString(config.ThumbnailsEnabled))
	logging.Info("    Transcoding: %s", enabledString(config.TranscodingEnabled))

	return config, nil
}

func setupOptionalDir(path, name string) bool {
	logging.Debug("  Setting up %s directory: %s", name, path)

	// Try to create directory
	if err := os.MkdirAll(path, 0755); err != nil {
		logging.Warn("    Failed to create %s directory: %v", name, err)
		logging.Warn("    %s will be disabled", name)
		return false
	}

	// Test write access
	testFile := filepath.Join(path, ".write-test")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		logging.Warn("    %s directory is not writable: %v", name, err)
		logging.Warn("    %s will be disabled", name)
		return false
	}
	os.Remove(testFile)

	logging.Debug("    [OK] %s directory ready", name)
	return true
}

func enabledString(enabled bool) string {
	if enabled {
		return "ENABLED"
	}
	return "DISABLED (directory not writable)"
}

// LogDatabaseInit logs database initialization
func LogDatabaseInit(duration time.Duration) {
	logging.Info("")
	logging.Info("------------------------------------------------------------")
	logging.Info("DATABASE INITIALIZATION")
	logging.Info("------------------------------------------------------------")
	logging.Info("  [OK] Database initialized in %v", duration)
}

// LogTranscoderInit logs transcoder initialization and checks FFmpeg
func LogTranscoderInit(enabled bool) {
	logging.Info("")
	logging.Info("------------------------------------------------------------")
	logging.Info("TRANSCODER INITIALIZATION")
	logging.Info("------------------------------------------------------------")

	if !enabled {
		logging.Warn("  Transcoding disabled (cache directory not writable)")
		logging.Warn("  Videos requiring transcoding will not play")
		return
	}

	if err := checkFFmpeg(); err != nil {
		logging.Warn("  FFmpeg check failed: %v", err)
		logging.Warn("  Video transcoding may not work correctly")
	} else {
		logging.Info("  [OK] FFmpeg is available")
	}
}

// LogThumbnailInit logs thumbnail generator initialization
func LogThumbnailInit(enabled bool) {
	if !enabled {
		logging.Info("  Thumbnails disabled (cache directory not writable)")
		logging.Info("  Default icons will be shown instead")
	}
}

// LogIndexerInit logs indexer initialization
func LogIndexerInit(interval time.Duration) {
	logging.Info("")
	logging.Info("------------------------------------------------------------")
	logging.Info("INDEXER INITIALIZATION")
	logging.Info("------------------------------------------------------------")
	logging.Info("  Index interval: %v", interval)
	logging.Debug("  Starting indexer...")
}

// LogIndexerStarted logs successful indexer start
func LogIndexerStarted() {
	logging.Info("  [OK] Indexer started (initial scan running in background)")
}

// LogHTTPRoutes logs all registered HTTP routes
func LogHTTPRoutes(logStaticFiles bool) {
	logging.Info("")
	logging.Info("------------------------------------------------------------")
	logging.Info("HTTP SERVER SETUP")
	logging.Info("------------------------------------------------------------")

	if logging.IsDebugEnabled() {
		logging.Debug("  Registered API routes:")
		logging.Debug("    GET  /api/files            - List directory contents")
		logging.Debug("    GET  /api/media            - List media files in directory")
		logging.Debug("    GET  /api/file/{path}      - Get raw file")
		logging.Debug("    GET  /api/thumbnail/{path} - Get thumbnail")
		logging.Debug("    GET  /api/playlists        - List all playlists")
		logging.Debug("    GET  /api/playlist/{name}  - Get playlist details")
		logging.Debug("    GET  /api/stream/{path}    - Stream video")
		logging.Debug("    GET  /api/stream-info/{p}  - Get video info")
		logging.Debug("    GET  /api/search           - Search files")
		logging.Debug("    GET  /api/stats            - Get index statistics")
		logging.Debug("    POST /api/reindex          - Trigger re-index")
		logging.Debug("    GET  /*                    - Static files")
		logging.Debug("")
	}

	logging.Info("  HTTP logging enabled")
	if logStaticFiles {
		logging.Info("    Static file logging: ON")
	} else {
		logging.Info("    Static file logging: OFF (set LOG_STATIC_FILES=true to enable)")
	}
}

// LogServerStarted logs successful server start
func LogServerStarted(port string, startupDuration time.Duration) {
	logging.Info("")
	logging.Info("------------------------------------------------------------")
	logging.Info("SERVER STARTED")
	logging.Info("------------------------------------------------------------")
	logging.Info("  Startup time:    %v", startupDuration)
	logging.Info("  Listening on:    http://0.0.0.0:%s", port)
	logging.Info("  Local access:    http://localhost:%s", port)
	logging.Info("")
	logging.Info("  Press Ctrl+C to stop the server")
	logging.Info("------------------------------------------------------------")
	logging.Info("")
}

// LogShutdownInitiated logs shutdown start
func LogShutdownInitiated(signal string) {
	logging.Info("")
	logging.Info("------------------------------------------------------------")
	logging.Info("SHUTDOWN INITIATED (received %s)", signal)
	logging.Info("------------------------------------------------------------")
}

// LogShutdownStep logs a shutdown step
func LogShutdownStep(step string) {
	logging.Debug("  %s...", step)
}

// LogShutdownStepComplete logs a completed shutdown step
func LogShutdownStepComplete(step string) {
	logging.Info("  [OK] %s", step)
}

// LogShutdownComplete logs shutdown completion
func LogShutdownComplete() {
	logging.Info("  [OK] Shutdown complete")
}

// LogFatal logs a fatal error and exits
func LogFatal(format string, args ...interface{}) {
	logging.Fatal(format, args...)
}

// Helper functions

func printBanner() {
	banner := `
------------------------------------------------------------
    __  ___         ___         _    ___                    
   /  |/  /__  ____/ (_)___ _  | |  / (_)__ _      _____  ___ 
  / /|_/ / _ \/ __  / / __ '/  | | / / / _ \ | /| / / _ \/ __|
 / /  / /  __/ /_/ / / /_/ /   | |/ / /  __/ |/ |/ /  __/ |   
/_/  /_/\___/\__,_/_/\__,_/    |___/_/\___/|__/|__/\___/|_|   
                                                              
------------------------------------------------------------`
	fmt.Println(banner)
	logging.Info("  Version: %s", Version)
	logging.Info("  Started: %s", time.Now().Format(time.RFC1123))
	logging.Info("")
}

func logSystemInfo() {
	logging.Info("------------------------------------------------------------")
	logging.Info("SYSTEM INFORMATION")
	logging.Info("------------------------------------------------------------")
	logging.Info("  Go version:      %s", runtime.Version())
	logging.Info("  OS/Arch:         %s/%s", runtime.GOOS, runtime.GOARCH)
	logging.Info("  CPUs available:  %d", runtime.NumCPU())

	if logging.IsDebugEnabled() {
		logging.Debug("  Goroutines:      %d", runtime.NumGoroutine())

		if wd, err := os.Getwd(); err == nil {
			logging.Debug("  Working dir:     %s", wd)
		}

		if hostname, err := os.Hostname(); err == nil {
			logging.Debug("  Hostname:        %s", hostname)
		}
	}

	logging.Info("")
}

func ensureDirectory(path, name string) error {
	logging.Debug("  Checking %s directory: %s", name, path)

	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		logging.Debug("    Directory does not exist, creating...")
		if err := os.MkdirAll(path, 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}
		logging.Debug("    [OK] Created directory: %s", path)
		return nil
	}

	if err != nil {
		return fmt.Errorf("failed to stat directory: %w", err)
	}

	if !info.IsDir() {
		return fmt.Errorf("path exists but is not a directory")
	}

	logging.Debug("    [OK] Directory exists")

	// List contents summary for media directory (debug only)
	if name == "media" && logging.IsDebugEnabled() {
		entries, err := os.ReadDir(path)
		if err == nil {
			fileCount := 0
			dirCount := 0
			for _, e := range entries {
				if e.IsDir() {
					dirCount++
				} else {
					fileCount++
				}
			}
			logging.Debug("    Contents: %d files, %d directories (top level)", fileCount, dirCount)
		}
	}

	return nil
}

func testWriteAccess(dir string) error {
	testFile := filepath.Join(dir, ".write-test")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		return err
	}
	os.Remove(testFile)
	return nil
}

func checkFFmpeg() error {
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		return fmt.Errorf("ffmpeg not found in PATH")
	}
	logging.Debug("  FFmpeg path: %s", path)

	cmd := exec.Command("ffmpeg", "-version")
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to get ffmpeg version: %w", err)
	}

	lines := strings.Split(string(output), "\n")
	if len(lines) > 0 {
		logging.Debug("  FFmpeg version: %s", strings.TrimSpace(lines[0]))
	}

	return nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
