// Main entry point for the media viewer application.
//
// It starts an HTTP server that provides:
//   - Web-based media browsing interface
//   - RESTful API for media operations
//   - Background media indexing
//   - Video transcoding and streaming
//   - User authentication
//
// Configuration is provided via environment variables:
//   - MEDIA_DIR: Path to media files (default: /media)
//   - CACHE_DIR: Path to cache directory (default: /cache)
//   - DATABASE_DIR: Path to database directory (default: /database)
//   - PORT: HTTP server port (default: 8080)
//   - INDEX_INTERVAL: Media indexing interval (default: 30m)
//   - LOG_LEVEL: Logging verbosity (default: info)
//   - LOG_STATIC_FILES: Log static file requests (default: false)
//   - LOG_HEALTH_CHECKS: Log health check requests (default: true)
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"media-viewer/internal/database"
	"media-viewer/internal/handlers"
	"media-viewer/internal/indexer"
	"media-viewer/internal/logging"
	"media-viewer/internal/media"
	"media-viewer/internal/middleware"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"

	"github.com/gorilla/mux"
)

func main() {
	startTime := time.Now()

	// Load configuration
	config, err := startup.LoadConfig()
	if err != nil {
		startup.LogFatal("Configuration error: %v", err)
	}

	// Initialize database
	dbStart := time.Now()
	db, err := database.New(config.DatabasePath)
	if err != nil {
		startup.LogFatal("Failed to initialize database: %v", err)
	}
	startup.LogDatabaseInit(time.Since(dbStart))

	// Clean up expired sessions periodically
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := db.CleanExpiredSessions(); err != nil {
				logging.Error("failed to clean expired sessions: %v", err)
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
	)

	// Initialize indexer
	startup.LogIndexerInit(config.IndexInterval)
	idx := indexer.New(db, config.MediaDir, config.IndexInterval)

	// Start indexer in background (non-blocking)
	go func() {
		if err := idx.Start(); err != nil {
			logging.Error("Failed to start indexer: %v", err)
		}
	}()
	startup.LogIndexerStarted()

	// Start thumbnail generator in background
	thumbGen.Start()
	logging.Info("Thumbnail generator started")

	// Initialize handlers
	h := handlers.New(db, idx, trans, thumbGen, config)

	// Setup router
	router := setupRouter(h)

	// Log routes dynamically
	startup.LogHTTPRoutes(router, config.LogStaticFiles, config.LogHealthChecks)

	// Apply authentication middleware
	authedRouter := h.AuthMiddleware(router)

	// Apply logging middleware
	loggingConfig := middleware.DefaultLoggingConfig()
	loggingConfig.LogStaticFiles = config.LogStaticFiles
	loggingConfig.LogHealthChecks = config.LogHealthChecks
	loggedHandler := middleware.Logger(loggingConfig)(authedRouter)

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
	go handleShutdown(srv, db, idx, trans, thumbGen, shutdownComplete)

	// Start server
	startup.LogServerStarted(config.Port, time.Since(startTime))
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		startup.LogFatal("Server error: %v", err)
	}

	// Wait for shutdown to complete
	<-shutdownComplete
}

func setupRouter(h *handlers.Handlers) *mux.Router {
	r := mux.NewRouter()

	// Health check and version routes (no auth required)
	r.HandleFunc("/health", h.HealthCheck).Methods("GET")
	r.HandleFunc("/healthz", h.HealthCheck).Methods("GET")
	r.HandleFunc("/livez", h.LivenessCheck).Methods("GET")
	r.HandleFunc("/readyz", h.ReadinessCheck).Methods("GET")
	r.HandleFunc("/version", h.GetVersion).Methods("GET")

	// Auth routes
	auth := r.PathPrefix("/api/auth").Subrouter()
	auth.HandleFunc("/setup-required", h.CheckSetupRequired).Methods("GET")
	auth.HandleFunc("/setup", h.Setup).Methods("POST")
	auth.HandleFunc("/login", h.Login).Methods("POST")
	auth.HandleFunc("/logout", h.Logout).Methods("POST")
	auth.HandleFunc("/check", h.CheckAuth).Methods("GET")

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
	api.HandleFunc("/favorites/check", h.CheckFavorite).Methods("GET")

	// Tags
	api.HandleFunc("/tags", h.GetAllTags).Methods("GET")
	api.HandleFunc("/tags/file", h.GetFileTags).Methods("GET")
	api.HandleFunc("/tags/file", h.AddTagToFile).Methods("POST")
	api.HandleFunc("/tags/file", h.RemoveTagFromFile).Methods("DELETE")
	api.HandleFunc("/tags/file/set", h.SetFileTags).Methods("POST")
	api.HandleFunc("/tags/batch", h.GetBatchFileTags).Methods("POST")
	api.HandleFunc("/tags/{tag}", h.GetFilesByTag).Methods("GET")
	api.HandleFunc("/tags/{tag}", h.DeleteTag).Methods("DELETE")
	api.HandleFunc("/tags/{tag}", h.RenameTag).Methods("PUT")

	// Static files
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./static")))

	// Thumbnails
	api.HandleFunc("/thumbnail/{path:.*}", h.GetThumbnail).Methods("GET")
	api.HandleFunc("/thumbnail/{path:.*}", h.InvalidateThumbnail).Methods("DELETE")
	api.HandleFunc("/thumbnails/invalidate", h.InvalidateAllThumbnails).Methods("POST")
	api.HandleFunc("/thumbnails/rebuild", h.RebuildAllThumbnails).Methods("POST")
	api.HandleFunc("/thumbnails/status", h.GetThumbnailStatus).Methods("GET")

	return r
}

func handleShutdown(srv *http.Server, db *database.Database, idx *indexer.Indexer, trans *transcoder.Transcoder, thumbGen *media.ThumbnailGenerator, done chan struct{}) {
	defer close(done)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigChan

	startup.LogShutdownInitiated(sig.String())

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	startup.LogShutdownStep("Stopping thumbnail generator")
	thumbGen.Stop()
	startup.LogShutdownStepComplete("Thumbnail generator stopped")

	startup.LogShutdownStep("Stopping indexer")
	idx.Stop()
	startup.LogShutdownStepComplete("Indexer stopped")

	startup.LogShutdownStep("Cleaning up transcoder")
	trans.Cleanup()
	startup.LogShutdownStepComplete("Transcoder cleanup complete")

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
