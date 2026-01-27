package startup

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
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

	log.Println("------------------------------------------------------------")
	log.Println("CONFIGURATION")
	log.Println("------------------------------------------------------------")

	mediaDir := getEnv("MEDIA_DIR", "/media")
	cacheDir := getEnv("CACHE_DIR", "/cache")
	port := getEnv("PORT", "8080")
	indexIntervalStr := getEnv("INDEX_INTERVAL", "30m")
	logStaticFiles := getEnv("LOG_STATIC_FILES", "false") == "true"

	log.Printf("  MEDIA_DIR:        %s", mediaDir)
	log.Printf("  CACHE_DIR:        %s", cacheDir)
	log.Printf("  PORT:             %s", port)
	log.Printf("  INDEX_INTERVAL:   %s", indexIntervalStr)
	log.Printf("  LOG_STATIC_FILES: %v", logStaticFiles)

	indexInterval, err := time.ParseDuration(indexIntervalStr)
	if err != nil {
		log.Printf("  [WARN] Invalid INDEX_INTERVAL, using default: 30m")
		indexInterval = 30 * time.Minute
	}

	// Resolve paths
	log.Println("")
	log.Println("------------------------------------------------------------")
	log.Println("DIRECTORY SETUP")
	log.Println("------------------------------------------------------------")

	mediaDir, err = filepath.Abs(mediaDir)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve media directory path: %w", err)
	}
	log.Printf("  Media directory (absolute): %s", mediaDir)

	cacheDir, err = filepath.Abs(cacheDir)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve cache directory path: %w", err)
	}
	log.Printf("  Cache directory (absolute): %s", cacheDir)

	// Check/create media directory (warning only)
	if err := ensureDirectory(mediaDir, "media"); err != nil {
		log.Printf("  [WARN] Media directory issue: %v", err)
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
	log.Printf("  Testing cache directory write access (required for database)...")
	if err := testWriteAccess(cacheDir); err != nil {
		return nil, fmt.Errorf("cache directory is not writable (required for database): %w", err)
	}
	log.Printf("  [OK] Cache directory is writable")

	// Setup thumbnail directory (optional)
	config.ThumbnailsEnabled = setupOptionalDir(config.ThumbnailDir, "thumbnails")

	// Setup transcode directory (optional)
	config.TranscodingEnabled = setupOptionalDir(config.TranscodeDir, "transcoding")

	// Summary
	log.Println("")
	log.Println("  Feature availability:")
	log.Printf("    Database:    ENABLED (required)")
	log.Printf("    Thumbnails:  %s", enabledString(config.ThumbnailsEnabled))
	log.Printf("    Transcoding: %s", enabledString(config.TranscodingEnabled))

	return config, nil
}

func setupOptionalDir(path, name string) bool {
	log.Printf("  Setting up %s directory: %s", name, path)

	// Try to create directory
	if err := os.MkdirAll(path, 0755); err != nil {
		log.Printf("    [WARN] Failed to create %s directory: %v", name, err)
		log.Printf("    [WARN] %s will be disabled", name)
		return false
	}

	// Test write access
	testFile := filepath.Join(path, ".write-test")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		log.Printf("    [WARN] %s directory is not writable: %v", name, err)
		log.Printf("    [WARN] %s will be disabled", name)
		return false
	}
	os.Remove(testFile)

	log.Printf("    [OK] %s directory ready", name)
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
	log.Println("")
	log.Println("------------------------------------------------------------")
	log.Println("DATABASE INITIALIZATION")
	log.Println("------------------------------------------------------------")
	log.Printf("  [OK] Database initialized in %v", duration)
}

// LogTranscoderInit logs transcoder initialization and checks FFmpeg
func LogTranscoderInit(enabled bool) {
	log.Println("")
	log.Println("------------------------------------------------------------")
	log.Println("TRANSCODER INITIALIZATION")
	log.Println("------------------------------------------------------------")

	if !enabled {
		log.Printf("  [WARN] Transcoding disabled (cache directory not writable)")
		log.Printf("  [WARN] Videos requiring transcoding will not play")
		return
	}

	if err := checkFFmpeg(); err != nil {
		log.Printf("  [WARN] FFmpeg check failed: %v", err)
		log.Printf("  [WARN] Video transcoding may not work correctly")
	} else {
		log.Printf("  [OK] FFmpeg is available")
	}
}

// LogThumbnailInit logs thumbnail generator initialization
func LogThumbnailInit(enabled bool) {
	if !enabled {
		log.Printf("  [INFO] Thumbnails disabled (cache directory not writable)")
		log.Printf("  [INFO] Default icons will be shown instead")
	}
}

// LogIndexerInit logs indexer initialization
func LogIndexerInit(interval time.Duration) {
	log.Println("")
	log.Println("------------------------------------------------------------")
	log.Println("INDEXER INITIALIZATION")
	log.Println("------------------------------------------------------------")
	log.Printf("  Index interval: %v", interval)
	log.Printf("  Starting indexer...")
}

// LogIndexerStarted logs successful indexer start
func LogIndexerStarted() {
	log.Printf("  [OK] Indexer started (initial scan running in background)")
}

// LogHTTPRoutes logs all registered HTTP routes
func LogHTTPRoutes(logStaticFiles bool) {
	log.Println("")
	log.Println("------------------------------------------------------------")
	log.Println("HTTP SERVER SETUP")
	log.Println("------------------------------------------------------------")
	log.Println("  Registered API routes:")
	log.Println("    GET  /api/files            - List directory contents")
	log.Println("    GET  /api/media            - List media files in directory")
	log.Println("    GET  /api/file/{path}      - Get raw file")
	log.Println("    GET  /api/thumbnail/{path} - Get thumbnail")
	log.Println("    GET  /api/playlists        - List all playlists")
	log.Println("    GET  /api/playlist/{name}  - Get playlist details")
	log.Println("    GET  /api/stream/{path}    - Stream video")
	log.Println("    GET  /api/stream-info/{p}  - Get video info")
	log.Println("    GET  /api/search           - Search files")
	log.Println("    GET  /api/stats            - Get index statistics")
	log.Println("    POST /api/reindex          - Trigger re-index")
	log.Println("    GET  /*                    - Static files")
	log.Println("")
	log.Println("  HTTP logging enabled")
	if logStaticFiles {
		log.Println("    Static file logging: ON")
	} else {
		log.Println("    Static file logging: OFF (set LOG_STATIC_FILES=true to enable)")
	}
}

// LogServerStarted logs successful server start
func LogServerStarted(port string, startupDuration time.Duration) {
	log.Println("")
	log.Println("------------------------------------------------------------")
	log.Println("SERVER STARTED")
	log.Println("------------------------------------------------------------")
	log.Printf("  Startup time:    %v", startupDuration)
	log.Printf("  Listening on:    http://0.0.0.0:%s", port)
	log.Printf("  Local access:    http://localhost:%s", port)
	log.Println("")
	log.Println("  Press Ctrl+C to stop the server")
	log.Println("------------------------------------------------------------")
	log.Println("")
}

// LogShutdownInitiated logs shutdown start
func LogShutdownInitiated(signal string) {
	log.Println("")
	log.Println("------------------------------------------------------------")
	log.Printf("SHUTDOWN INITIATED (received %s)", signal)
	log.Println("------------------------------------------------------------")
}

// LogShutdownStep logs a shutdown step
func LogShutdownStep(step string) {
	log.Printf("  %s...", step)
}

// LogShutdownStepComplete logs a completed shutdown step
func LogShutdownStepComplete(step string) {
	log.Printf("  [OK] %s", step)
}

// LogShutdownComplete logs shutdown completion
func LogShutdownComplete() {
	log.Println("  [OK] Shutdown complete")
}

// LogFatal logs a fatal error and exits
func LogFatal(format string, args ...interface{}) {
	log.Fatalf("  [ERROR] "+format, args...)
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
	log.Printf("  Version: %s", Version)
	log.Printf("  Started: %s", time.Now().Format(time.RFC1123))
	log.Println("")
}

func logSystemInfo() {
	log.Println("------------------------------------------------------------")
	log.Println("SYSTEM INFORMATION")
	log.Println("------------------------------------------------------------")
	log.Printf("  Go version:      %s", runtime.Version())
	log.Printf("  OS/Arch:         %s/%s", runtime.GOOS, runtime.GOARCH)
	log.Printf("  CPUs available:  %d", runtime.NumCPU())
	log.Printf("  Goroutines:      %d", runtime.NumGoroutine())

	if wd, err := os.Getwd(); err == nil {
		log.Printf("  Working dir:     %s", wd)
	}

	if hostname, err := os.Hostname(); err == nil {
		log.Printf("  Hostname:        %s", hostname)
	}

	log.Println("")
}

func ensureDirectory(path, name string) error {
	log.Printf("  Checking %s directory: %s", name, path)

	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		log.Printf("    Directory does not exist, creating...")
		if err := os.MkdirAll(path, 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}
		log.Printf("    [OK] Created directory: %s", path)
		return nil
	}

	if err != nil {
		return fmt.Errorf("failed to stat directory: %w", err)
	}

	if !info.IsDir() {
		return fmt.Errorf("path exists but is not a directory")
	}

	log.Printf("    [OK] Directory exists")

	// List contents summary for media directory
	if name == "media" {
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
			log.Printf("    Contents: %d files, %d directories (top level)", fileCount, dirCount)
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
	log.Printf("  FFmpeg path: %s", path)

	cmd := exec.Command("ffmpeg", "-version")
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to get ffmpeg version: %w", err)
	}

	lines := strings.Split(string(output), "\n")
	if len(lines) > 0 {
		log.Printf("  FFmpeg version: %s", strings.TrimSpace(lines[0]))
	}

	return nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
