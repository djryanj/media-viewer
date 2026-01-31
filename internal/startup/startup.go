package startup

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"media-viewer/internal/logging"

	"github.com/gorilla/mux"
)

// Build-time variables (injected via -ldflags)
var (
	Version   = "dev"
	Commit    = "unknown"
	BuildTime = "unknown"
	GoVersion = runtime.Version()
)

// BuildInfo contains version and build information
type BuildInfo struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildTime string `json:"buildTime"`
	GoVersion string `json:"goVersion"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
}

// GetBuildInfo returns the current build information
func GetBuildInfo() BuildInfo {
	return BuildInfo{
		Version:   Version,
		Commit:    Commit,
		BuildTime: BuildTime,
		GoVersion: GoVersion,
		OS:        runtime.GOOS,
		Arch:      runtime.GOARCH,
	}
}

// RouteInfo contains information about a registered route
type RouteInfo struct {
	Method string
	Path   string
	Name   string
}

// Config holds all application configuration
type Config struct {
	MediaDir          string
	CacheDir          string
	DatabaseDir       string
	Port              string
	MetricsPort       string
	IndexInterval     time.Duration
	ThumbnailInterval time.Duration
	LogStaticFiles    bool
	LogHealthChecks   bool
	MetricsEnabled    bool

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
	databaseDir := getEnv("DATABASE_DIR", "/database")
	port := getEnv("PORT", "8080")
	metricsPort := getEnv("METRICS_PORT", "9090")
	indexIntervalStr := getEnv("INDEX_INTERVAL", "30m")
	thumbnailIntervalStr := getEnv("THUMBNAIL_INTERVAL", "6h")
	logStaticFiles := getEnvBool("LOG_STATIC_FILES", false)
	logHealthChecks := getEnvBool("LOG_HEALTH_CHECKS", true)
	metricsEnabled := getEnvBool("METRICS_ENABLED", true)

	logging.Info("  MEDIA_DIR:           %s", mediaDir)
	logging.Info("  CACHE_DIR:           %s", cacheDir)
	logging.Info("  DATABASE_DIR:        %s", databaseDir)
	logging.Info("  PORT:                %s", port)
	logging.Info("  METRICS_PORT:        %s", metricsPort)
	logging.Info("  METRICS_ENABLED:     %v", metricsEnabled)
	logging.Info("  INDEX_INTERVAL:      %s", indexIntervalStr)
	logging.Info("  THUMBNAIL_INTERVAL:  %s", thumbnailIntervalStr)
	logging.Info("  LOG_STATIC_FILES:    %v", logStaticFiles)
	logging.Info("  LOG_HEALTH_CHECKS:   %v", logHealthChecks)
	logging.Info("  LOG_LEVEL:           %s", logging.GetLevel())

	indexInterval, err := time.ParseDuration(indexIntervalStr)
	if err != nil {
		logging.Warn("  Invalid INDEX_INTERVAL, using default: 30m")
		indexInterval = 30 * time.Minute
	}

	thumbnailInterval, err := time.ParseDuration(thumbnailIntervalStr)
	if err != nil {
		logging.Warn("  Invalid THUMBNAIL_INTERVAL, using default: 6h")
		thumbnailInterval = 6 * time.Hour
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

	databaseDir, err = filepath.Abs(databaseDir)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve database directory path: %w", err)
	}
	logging.Info("  Database directory (absolute): %s", databaseDir)

	// Check/create media directory (warning only)
	if err := ensureDirectory(mediaDir, "media"); err != nil {
		logging.Warn("  Media directory issue: %v", err)
	}

	config := &Config{
		MediaDir:          mediaDir,
		CacheDir:          cacheDir,
		DatabaseDir:       databaseDir,
		Port:              port,
		MetricsPort:       metricsPort,
		IndexInterval:     indexInterval,
		ThumbnailInterval: thumbnailInterval,
		LogStaticFiles:    logStaticFiles,
		LogHealthChecks:   logHealthChecks,
		MetricsEnabled:    metricsEnabled,
		DatabasePath:      filepath.Join(databaseDir, "media.db"),
		ThumbnailDir:      filepath.Join(cacheDir, "thumbnails"),
		TranscodeDir:      filepath.Join(cacheDir, "transcoded"),
	}

	// Ensure base database directory exists (required for database)
	if err := ensureDirectory(databaseDir, "database"); err != nil {
		return nil, fmt.Errorf("database directory error: %w", err)
	}

	// Test write access for database (required)
	logging.Debug("  Testing database directory write access...")
	if err := testWriteAccess(databaseDir); err != nil {
		return nil, fmt.Errorf("database directory is not writable (required for database): %w", err)
	}
	logging.Info("  [OK] Database directory is writable")

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
	logging.Info("    Metrics:     %s", enabledString(config.MetricsEnabled))

	return config, nil
}

func setupOptionalDir(path, name string) bool {
	logging.Debug("  Setting up %s directory: %s", name, path)

	if err := os.MkdirAll(path, 0o755); err != nil {
		logging.Warn("    Failed to create %s directory: %v", name, err)
		logging.Warn("    %s will be disabled", name)
		return false
	}

	testFile := filepath.Join(path, ".write-test")
	if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
		logging.Warn("    %s directory is not writable: %v", name, err)
		logging.Warn("    %s will be disabled", name)
		return false
	}
	if err := os.Remove(testFile); err != nil {
		logging.Warn("    failed to remove test file %s: %v", testFile, err)
		// Still return true since write succeeded
	}

	logging.Debug("    [OK] %s directory ready", name)
	return true
}

func enabledString(enabled bool) string {
	if enabled {
		return "ENABLED"
	}
	return "DISABLED"
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
	logging.Info("  Starting indexer...")
}

// LogIndexerStarted logs successful indexer start
func LogIndexerStarted() {
	logging.Info("  [OK] Indexer started")
}

// GetRoutes extracts all registered routes from a mux.Router
func GetRoutes(router *mux.Router) ([]RouteInfo, error) {
	var routes []RouteInfo

	err := router.Walk(func(route *mux.Route, _ *mux.Router, _ []*mux.Route) error {
		pathTemplate, err := route.GetPathTemplate()
		if err != nil {
			return err
		}

		methods, err := route.GetMethods()
		if err != nil {
			// Route might not have methods specified (e.g., static file server)
			methods = []string{"*"}
		}

		name := route.GetName()

		for _, method := range methods {
			routes = append(routes, RouteInfo{
				Method: method,
				Path:   pathTemplate,
				Name:   name,
			})
		}

		return nil
	})

	return routes, err
}

// LogHTTPRoutes logs all registered HTTP routes dynamically
func LogHTTPRoutes(router *mux.Router, logStaticFiles, logHealthChecks bool) {
	logging.Info("")
	logging.Info("------------------------------------------------------------")
	logging.Info("HTTP SERVER SETUP")
	logging.Info("------------------------------------------------------------")

	if logging.IsDebugEnabled() {
		routes, err := GetRoutes(router)
		if err != nil {
			logging.Warn("error walking routes: %v", err)
		}

		logging.Debug("  Registered routes (%d total):", len(routes))
		logging.Debug("")

		// Group routes by prefix for cleaner output
		groups := make(map[string][]RouteInfo)
		for _, route := range routes {
			prefix := getRouteGroup(route.Path)
			groups[prefix] = append(groups[prefix], route)
		}

		// Sort group keys
		groupKeys := make([]string, 0, len(groups))
		for k := range groups {
			groupKeys = append(groupKeys, k)
		}
		sort.Strings(groupKeys)

		// Print routes by group
		for _, group := range groupKeys {
			groupRoutes := groups[group]
			if group != "" {
				logging.Debug("  [%s]", group)
			} else {
				logging.Debug("  [root]")
			}

			for _, route := range groupRoutes {
				methodPadded := fmt.Sprintf("%-6s", route.Method)
				logging.Debug("    %s %s", methodPadded, route.Path)
			}
			logging.Debug("")
		}
	}

	logging.Info("  HTTP logging enabled")
	if logStaticFiles {
		logging.Info("    Static file logging: ON")
	} else {
		logging.Info("    Static file logging: OFF (set LOG_STATIC_FILES=true to enable)")
	}
	if logHealthChecks {
		logging.Info("    Health check logging: ON")
	} else {
		logging.Info("    Health check logging: OFF (set LOG_HEALTH_CHECKS=true to enable)")
	}
}

// getRouteGroup extracts a group name from a route path
func getRouteGroup(path string) string {
	// Remove leading slash
	path = strings.TrimPrefix(path, "/")

	// Get first segment
	parts := strings.SplitN(path, "/", 2)
	if len(parts) == 0 {
		return ""
	}

	first := parts[0]

	// Special handling for API routes
	if first == "api" && len(parts) > 1 {
		subParts := strings.SplitN(parts[1], "/", 2)
		return "api/" + subParts[0]
	}

	return first
}

// ServerConfig holds configuration for the server startup log
type ServerConfig struct {
	Port            string
	MetricsPort     string
	MetricsEnabled  bool
	StartupDuration time.Duration
}

// LogServerStarted logs successful server start with all endpoint information
func LogServerStarted(config ServerConfig) {
	logging.Info("")
	logging.Info("------------------------------------------------------------")
	logging.Info("SERVER STARTED")
	logging.Info("------------------------------------------------------------")
	logging.Info("  Startup time:    %v", config.StartupDuration)
	logging.Info("")
	logging.Info("  Endpoints:")
	logging.Info("    Application:   http://0.0.0.0:%s", config.Port)
	if config.MetricsEnabled {
		logging.Info("    Metrics:       http://0.0.0.0:%s/metrics", config.MetricsPort)
	} else {
		logging.Info("    Metrics:       DISABLED")
	}
	logging.Info("")
	logging.Info("  Local access:")
	logging.Info("    Application:   http://localhost:%s", config.Port)
	if config.MetricsEnabled {
		logging.Info("    Metrics:       http://localhost:%s/metrics", config.MetricsPort)
	}
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
	logging.Info("  Version:    %s", Version)
	logging.Info("  Commit:     %s", Commit)
	logging.Info("  Build Time: %s", BuildTime)
	logging.Info("  Started:    %s", time.Now().Format(time.RFC1123))
	logging.Info("")
}

func logSystemInfo() {
	logging.Info("------------------------------------------------------------")
	logging.Info("SYSTEM INFORMATION")
	logging.Info("------------------------------------------------------------")
	logging.Info("  Go version:      %s", runtime.Version())
	logging.Info("  OS/Arch:         %s/%s", runtime.GOOS, runtime.GOARCH)
	logging.Info("  CPUs available:  %d", runtime.NumCPU())
	logging.Info("  GOMAXPROCS:      %d", runtime.GOMAXPROCS(0))

	if runtime.GOMAXPROCS(0) < runtime.NumCPU() {
		logging.Info("  (Container CPU limit detected)")
	}

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
		if err := os.MkdirAll(path, 0o755); err != nil {
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
	if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
		return err
	}
	if err := os.Remove(testFile); err != nil {
		logging.Warn("failed to remove write test file %s: %v", testFile, err)
		// Don't return error since write access was confirmed
	}
	return nil
}

func checkFFmpeg() error {
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		return fmt.Errorf("ffmpeg not found in PATH")
	}
	logging.Debug("  FFmpeg path: %s", path)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg", "-version")
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

func getEnvBool(key string, defaultValue bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		logging.Warn("Invalid boolean value for %s: %q, using default: %v", key, value, defaultValue)
		return defaultValue
	}
	return parsed
}
