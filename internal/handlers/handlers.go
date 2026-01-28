package handlers

import (
	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

// Handlers contains all HTTP request handlers and their dependencies.
type Handlers struct {
	db         *database.Database
	indexer    *indexer.Indexer
	transcoder *transcoder.Transcoder
	thumbGen   *media.ThumbnailGenerator
	mediaDir   string
	cacheDir   string
}

// New creates a new Handlers instance with the given dependencies.
func New(db *database.Database, idx *indexer.Indexer, trans *transcoder.Transcoder, config *startup.Config) *Handlers {
	return &Handlers{
		db:         db,
		indexer:    idx,
		transcoder: trans,
		thumbGen:   media.NewThumbnailGenerator(config.ThumbnailDir, config.MediaDir, config.ThumbnailsEnabled, db),
		mediaDir:   config.MediaDir,
		cacheDir:   config.CacheDir,
	}
}
