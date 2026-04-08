package handlers

import (
	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

// AutoTagRunner can trigger an on-demand full auto-tagging pass.
type AutoTagRunner interface {
	TriggerRun()
}

// Handlers contains all HTTP request handlers and their dependencies.
type Handlers struct {
	db         *database.Database
	indexer    *indexer.Indexer
	transcoder *transcoder.Transcoder
	thumbGen   *media.ThumbnailGenerator
	autoTagger AutoTagRunner
	mediaDir   string
	cacheDir   string
}

// New creates a new Handlers instance with the given dependencies.
func New(db *database.Database, idx *indexer.Indexer, trans *transcoder.Transcoder, thumbGen *media.ThumbnailGenerator, config *startup.Config, autoTagger AutoTagRunner) *Handlers {
	return &Handlers{
		db:         db,
		indexer:    idx,
		transcoder: trans,
		thumbGen:   thumbGen,
		autoTagger: autoTagger,
		mediaDir:   config.MediaDir,
		cacheDir:   config.CacheDir,
	}
}
