// main.go
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/handlers"
	"media-viewer/internal/indexer"
	"media-viewer/internal/logging"
	"media-viewer/internal/media"
	"media-viewer/internal/memory"
	"media-viewer/internal/metrics"
	"media-viewer/internal/middleware"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"

	"github.com/gorilla/mux"
)

// dbStatsAdapter adapts database.Database to metrics.StatsProvider
type dbStatsAdapter struct {
	db *database.Database
}

// GetStats converts database.IndexStats to metrics.Stats
func (a *dbStatsAdapter) GetStats() metrics.Stats {
	dbStats := a.db.GetStats()
	return metrics.Stats{
		TotalFiles:     dbStats.TotalFiles,
		TotalFolders:   dbStats.TotalFolders,
		TotalImages:    dbStats.TotalImages,
		TotalVideos:    dbStats.TotalVideos,
		TotalPlaylists: dbStats.TotalPlaylists,
		TotalFavorites: dbStats.TotalFavorites,
		TotalTags:      dbStats.TotalTags,
	}
}

func main() {
	// Configure memory limit from environment FIRST, before any significant allocations
	memResult := memory.ConfigureFromEnv()

	startTime := time.Now()

	// Create a context for background operations that cancels on shutdown
	bgCtx, bgCancel := context.WithCancel(context.Background())
	defer bgCancel()

	// Load configuration
	config, err := startup.LoadConfig()
	if err != nil {
		startup.LogFatal("Configuration error: %v", err)
	}

	// Configure session duration
	database.SetSessionDuration(config.SessionDuration)

	// Log memory configuration
	startup.LogMemoryConfig(startup.MemoryConfig{
		Configured:     memResult.Configured,
		Source:         memResult.Source,
		ContainerLimit: memResult.ContainerLimit,
		GoMemLimit:     memResult.GoMemLimit,
		Ratio:          memResult.Ratio,
	})

	// Set application info metric
	metrics.SetAppInfo(startup.Version, startup.Commit, runtime.Version())

	memConfig := memory.DefaultConfig()
	memMonitor := memory.NewMonitor(memConfig)
	memMonitor.Start()
	logging.Info("Memory monitor started")

	// Initialize database
	dbStart := time.Now()
	db, err := database.New(config.DatabasePath)
	if err != nil {
		startup.LogFatal("Failed to initialize database: %v", err)
	}
	startup.LogDatabaseInit(time.Since(dbStart))

	// Clean up expired sessions periodically (use configured interval)
	go func() {
		ticker := time.NewTicker(config.SessionCleanup)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(bgCtx, 30*time.Second)
				if err := db.CleanExpiredSessions(ctx); err != nil {
					logging.Error("failed to clean expired sessions: %v", err)
				}
				cancel()
			case <-bgCtx.Done():
				return
			}
		}
	}()

	// Initialize transcoder
	startup.LogTranscoderInit(config.TranscodingEnabled)
	trans := transcoder.New(config.TranscodeDir, config.TranscodingEnabled)

	// Initialize thumbnail generator
	thumbGen := media.NewThumbnailGenerator(
		config.ThumbnailDir,
		config.MediaDir,
		config.ThumbnailsEnabled,
		db,
		config.ThumbnailInterval,
		memMonitor,
	)

	// Initialize indexer
	startup.LogIndexerInit(config.IndexInterval, config.PollInterval)
	idx := indexer.New(db, config.MediaDir, config.IndexInterval)
	idx.SetPollInterval(config.PollInterval)

	idx.SetOnIndexComplete(func() {
		thumbGen.NotifyIndexComplete()
	})

	// Start indexer in background
	go func() {
		if err := idx.Start(); err != nil {
			logging.Error("Failed to start indexer: %v", err)
		}
	}()
	startup.LogIndexerStarted()

	// Start thumbnail generator in background
	thumbGen.Start()
	logging.Info("Thumbnail generator started")

	// Start metrics collector
	metricsCollector := metrics.NewCollector(&dbStatsAdapter{db: db}, config.DatabasePath, 1*time.Minute)
	metricsCollector.Start()
	logging.Info("Metrics collector started")

	// Initialize handlers
	h := handlers.New(db, idx, trans, thumbGen, config)

	// Start metrics server if enabled
	var metricsSrv *http.Server
	if config.MetricsEnabled {
		metricsSrv = startMetricsServer(h, config.MetricsPort)
	}

	// Setup router
	router := setupRouter(h)

	// Log routes dynamically
	startup.LogHTTPRoutes(router, config.LogStaticFiles, config.LogHealthChecks)

	// Apply authentication middleware
	authedRouter := h.AuthMiddleware(router)

	// Apply metrics middleware
	metricsConfig := middleware.DefaultMetricsConfig()
	metricsHandler := middleware.Metrics(metricsConfig)(authedRouter)

	// Apply logging middleware
	loggingConfig := middleware.DefaultLoggingConfig()
	loggingConfig.LogStaticFiles = config.LogStaticFiles
	loggingConfig.LogHealthChecks = config.LogHealthChecks
	loggedHandler := middleware.Logger(loggingConfig)(metricsHandler)

	// Apply compression middleware
	compressionConfig := middleware.DefaultCompressionConfig()
	handler := middleware.Compression(compressionConfig)(loggedHandler)

	// Create server
	srv := &http.Server{
		Addr:         ":" + config.Port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  60 * time.Second,
	}

	// Channel to signal shutdown completion
	shutdownComplete := make(chan struct{})

	// Start graceful shutdown handler
	go handleShutdown(srv, metricsSrv, db, idx, trans, thumbGen, metricsCollector, memMonitor, shutdownComplete)

	// Start server
	startup.LogServerStarted(startup.ServerConfig{
		Port:            config.Port,
		MetricsPort:     config.MetricsPort,
		MetricsEnabled:  config.MetricsEnabled,
		StartupDuration: time.Since(startTime),
	})

	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		startup.LogFatal("Server error: %v", err)
	}

	// Wait for shutdown to complete
	<-shutdownComplete
}

// startMetricsServer starts a separate HTTP server for Prometheus metrics
func startMetricsServer(h *handlers.Handlers, port string) *http.Server {
	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", h.MetricsHandler())

	metricsMux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      metricsMux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			logging.Error("Metrics server error: %v", err)
		}
	}()

	return srv
}

func setupRouter(h *handlers.Handlers) *mux.Router {
	r := mux.NewRouter()

	// Health check and version routes (no auth required)
	r.HandleFunc("/health", h.HealthCheck).Methods("GET")
	r.HandleFunc("/healthz", h.HealthCheck).Methods("GET")
	r.HandleFunc("/livez", h.LivenessCheck).Methods("GET")
	r.HandleFunc("/readyz", h.ReadinessCheck).Methods("GET")
	r.HandleFunc("/version", h.GetVersion).Methods("GET")

	// PWA assets (must be accessible without auth for install prompts)
	r.HandleFunc("/manifest.json", serveStaticFile("./static/manifest.json", "application/manifest+json")).Methods("GET")
	r.HandleFunc("/favicon.ico", serveStaticFile("./static/icons/favicon.ico", "image/x-icon")).Methods("GET")
	r.PathPrefix("/icons/").Handler(http.StripPrefix("/icons/", http.FileServer(http.Dir("./static/icons"))))
	r.HandleFunc("/sw.js", serveStaticFile("./static/sw.js", "application/javascript")).Methods("GET")

	// Login page (needs to be accessible without auth)
	r.HandleFunc("/login.html", serveStaticFile("./static/login.html", "text/html; charset=utf-8")).Methods("GET")

	// Auth routes
	auth := r.PathPrefix("/api/auth").Subrouter()
	auth.HandleFunc("/setup-required", h.CheckSetupRequired).Methods("GET")
	auth.HandleFunc("/setup", h.Setup).Methods("POST")
	auth.HandleFunc("/login", h.Login).Methods("POST")
	auth.HandleFunc("/logout", h.Logout).Methods("POST")
	auth.HandleFunc("/check", h.CheckAuth).Methods("GET")
	auth.HandleFunc("/password", h.ChangePassword).Methods("PUT")
	auth.HandleFunc("/keepalive", h.Keepalive).Methods("POST")

	// Protected API routes
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/files", h.ListFiles).Methods("GET")
	api.HandleFunc("/media", h.GetMediaFiles).Methods("GET")
	api.HandleFunc("/file/{path:.*}", h.GetFile).Methods("GET")
	api.HandleFunc("/thumbnail/{path:.*}", h.GetThumbnail).Methods("GET")
	api.HandleFunc("/playlists", h.ListPlaylists).Methods("GET")
	api.HandleFunc("/playlist/{name}", h.GetPlaylist).Methods("GET")
	api.HandleFunc("/stream/{path:.*}", h.StreamVideo).Methods("GET")
	api.HandleFunc("/stream-info/{path:.*}", h.GetStreamInfo).Methods("GET")
	api.HandleFunc("/search", h.Search).Methods("GET")
	api.HandleFunc("/search/suggestions", h.SearchSuggestions).Methods("GET")
	api.HandleFunc("/stats", h.GetStats).Methods("GET")
	api.HandleFunc("/reindex", h.TriggerReindex).Methods("POST")

	// Favorites
	api.HandleFunc("/favorites", h.GetFavorites).Methods("GET")
	api.HandleFunc("/favorites", h.AddFavorite).Methods("POST")
	api.HandleFunc("/favorites", h.RemoveFavorite).Methods("DELETE")
	api.HandleFunc("/favorites/bulk", h.BulkAddFavorites).Methods("POST")
	api.HandleFunc("/favorites/bulk", h.BulkRemoveFavorites).Methods("DELETE")
	api.HandleFunc("/favorites/check", h.CheckFavorite).Methods("GET")

	// Tags
	api.HandleFunc("/tags", h.GetAllTags).Methods("GET")
	api.HandleFunc("/tags/file", h.GetFileTags).Methods("GET")
	api.HandleFunc("/tags/file", h.AddTagToFile).Methods("POST")
	api.HandleFunc("/tags/file", h.RemoveTagFromFile).Methods("DELETE")
	api.HandleFunc("/tags/file/set", h.SetFileTags).Methods("POST")
	api.HandleFunc("/tags/batch", h.GetBatchFileTags).Methods("POST")
	api.HandleFunc("/tags/bulk", h.BulkAddTag).Methods("POST")
	api.HandleFunc("/tags/bulk", h.BulkRemoveTag).Methods("DELETE")
	api.HandleFunc("/tags/{tag}", h.GetFilesByTag).Methods("GET")
	api.HandleFunc("/tags/{tag}", h.DeleteTag).Methods("DELETE")
	api.HandleFunc("/tags/{tag}", h.RenameTag).Methods("PUT")

	// Thumbnails
	api.HandleFunc("/thumbnail/{path:.*}", h.GetThumbnail).Methods("GET")
	api.HandleFunc("/thumbnail/{path:.*}", h.InvalidateThumbnail).Methods("DELETE")
	api.HandleFunc("/thumbnails/invalidate", h.InvalidateAllThumbnails).Methods("POST")
	api.HandleFunc("/thumbnails/rebuild", h.RebuildAllThumbnails).Methods("POST")
	api.HandleFunc("/thumbnails/status", h.GetThumbnailStatus).Methods("GET")

	// Static files
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./static")))

	return r
}

func handleShutdown(srv, metricsSrv *http.Server, db *database.Database, idx *indexer.Indexer, trans *transcoder.Transcoder, thumbGen *media.ThumbnailGenerator, metricsCollector *metrics.Collector, memMonitor *memory.Monitor, done chan struct{}) {
	defer close(done)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigChan

	startup.LogShutdownInitiated(sig.String())

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	startup.LogShutdownStep("Stopping metrics collector")
	metricsCollector.Stop()
	startup.LogShutdownStepComplete("Metrics collector stopped")

	startup.LogShutdownStep("Stopping thumbnail generator")
	thumbGen.Stop()
	startup.LogShutdownStepComplete("Thumbnail generator stopped")

	startup.LogShutdownStep("Stopping indexer")
	idx.Stop()
	startup.LogShutdownStepComplete("Indexer stopped")

	startup.LogShutdownStep("Cleaning up transcoder")
	trans.Cleanup()
	startup.LogShutdownStepComplete("Transcoder cleanup complete")

	startup.LogShutdownStep("Stopping memory monitor")
	memMonitor.Stop()
	startup.LogShutdownStepComplete("Memory monitor stopped")

	// Shutdown metrics server if running
	if metricsSrv != nil {
		startup.LogShutdownStep("Shutting down metrics server")
		if err := metricsSrv.Shutdown(ctx); err != nil {
			logging.Warn("Metrics server shutdown error: %v", err)
		} else {
			startup.LogShutdownStepComplete("Metrics server stopped")
		}
	}

	startup.LogShutdownStep("Shutting down HTTP server")
	if err := srv.Shutdown(ctx); err != nil {
		logging.Warn("Server shutdown error: %v", err)
	} else {
		startup.LogShutdownStepComplete("HTTP server stopped")
	}

	startup.LogShutdownStep("Closing database")
	if err := db.Close(); err != nil {
		logging.Warn("Database close error: %v", err)
	} else {
		startup.LogShutdownStepComplete("Database closed")
	}

	startup.LogShutdownComplete()
}

// serveStaticFile returns a handler that serves a specific static file with the given content type
func serveStaticFile(filepath, contentType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", contentType)
		http.ServeFile(w, r, filepath)
	}
}
