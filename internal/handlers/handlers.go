package handlers

import (
	"media-viewer/internal/database"
	"media-viewer/internal/indexer"
	"media-viewer/internal/media"
	"media-viewer/internal/startup"
	"media-viewer/internal/transcoder"
)

type Handlers struct {
	db         *database.Database
	indexer    *indexer.Indexer
	transcoder *transcoder.Transcoder
	thumbGen   *media.ThumbnailGenerator
	mediaDir   string
	cacheDir   string
}

func New(db *database.Database, idx *indexer.Indexer, trans *transcoder.Transcoder, config *startup.Config) *Handlers {
	return &Handlers{
		db:         db,
		indexer:    idx,
		transcoder: trans,
		thumbGen:   media.NewThumbnailGenerator(config.ThumbnailDir, config.ThumbnailsEnabled),
		mediaDir:   config.MediaDir,
		cacheDir:   config.CacheDir,
	}
}
