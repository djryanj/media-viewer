package metrics

import (
	"time"

	"media-viewer/internal/logging"
)

// StatsProvider interface for collecting stats
type StatsProvider interface {
	GetStats() Stats
}

// Stats holds the current statistics
type Stats struct {
	TotalFiles     int
	TotalFolders   int
	TotalImages    int
	TotalVideos    int
	TotalPlaylists int
	TotalFavorites int
	TotalTags      int
}

// Collector periodically collects and updates metrics
type Collector struct {
	statsProvider StatsProvider
	interval      time.Duration
	stopChan      chan struct{}
}

// NewCollector creates a new metrics collector
func NewCollector(provider StatsProvider, interval time.Duration) *Collector {
	return &Collector{
		statsProvider: provider,
		interval:      interval,
		stopChan:      make(chan struct{}),
	}
}

// Start begins the metrics collection loop
func (c *Collector) Start() {
	go c.collectLoop()
}

// Stop stops the metrics collection
func (c *Collector) Stop() {
	close(c.stopChan)
}

func (c *Collector) collectLoop() {
	// Collect immediately on start
	c.collect()

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.collect()
		case <-c.stopChan:
			return
		}
	}
}

func (c *Collector) collect() {
	if c.statsProvider == nil {
		return
	}

	stats := c.statsProvider.GetStats()

	MediaFilesTotal.WithLabelValues("image").Set(float64(stats.TotalImages))
	MediaFilesTotal.WithLabelValues("video").Set(float64(stats.TotalVideos))
	MediaFilesTotal.WithLabelValues("playlist").Set(float64(stats.TotalPlaylists))
	MediaFoldersTotal.Set(float64(stats.TotalFolders))
	MediaFavoritesTotal.Set(float64(stats.TotalFavorites))
	MediaTagsTotal.Set(float64(stats.TotalTags))

	logging.Debug("Metrics collected: files=%d, folders=%d, favorites=%d, tags=%d",
		stats.TotalFiles, stats.TotalFolders, stats.TotalFavorites, stats.TotalTags)
}
