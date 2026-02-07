package metrics

import (
	"os"
	"runtime"
	"runtime/debug"
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
	dbPath        string
	interval      time.Duration
	stopChan      chan struct{}
	lastGCCount   uint32
}

// NewCollector creates a new metrics collector
func NewCollector(provider StatsProvider, dbPath string, interval time.Duration) *Collector {
	return &Collector{
		statsProvider: provider,
		dbPath:        dbPath,
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
	// Collect memory metrics
	c.collectMemoryMetrics()

	// Collect database file size
	c.collectDBSize()

	// Collect stats from provider
	if c.statsProvider == nil {
		return
	}

	stats := c.statsProvider.GetStats()

	MediaFilesTotal.WithLabelValues("image").Set(float64(stats.TotalImages))
	MediaFilesTotal.WithLabelValues("video").Set(float64(stats.TotalVideos))
	MediaFilesTotal.WithLabelValues("playlist").Set(float64(stats.TotalPlaylists))
	MediaFoldersTotal.Set(float64(stats.TotalFolders))
	MediaTagsTotal.Set(float64(stats.TotalTags))

	logging.Debug("Metrics collected: files=%d, folders=%d, favorites=%d, tags=%d",
		stats.TotalFiles, stats.TotalFolders, stats.TotalFavorites, stats.TotalTags)
}

func (c *Collector) collectMemoryMetrics() {
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	GoMemAllocBytes.Set(float64(memStats.Alloc))
	GoMemSysBytes.Set(float64(memStats.Sys))

	// Track GC runs (as a counter, we need to track the delta)
	if memStats.NumGC > c.lastGCCount {
		GoGCRuns.Add(float64(memStats.NumGC - c.lastGCCount))
		c.lastGCCount = memStats.NumGC
	}

	// Report GOMEMLIMIT
	if limit := debug.SetMemoryLimit(-1); limit > 0 && limit < 1<<62 {
		GoMemLimit.Set(float64(limit))
	}
}

func (c *Collector) collectDBSize() {
	if c.dbPath == "" {
		return
	}

	// Main database file
	if fileInfo, err := os.Stat(c.dbPath); err == nil {
		DBSizeBytes.WithLabelValues("main").Set(float64(fileInfo.Size()))
	} else {
		logging.Debug("Failed to get database file size: %v", err)
	}

	// WAL file (Write-Ahead Log)
	if walInfo, err := os.Stat(c.dbPath + "-wal"); err == nil {
		DBSizeBytes.WithLabelValues("wal").Set(float64(walInfo.Size()))
	} else {
		DBSizeBytes.WithLabelValues("wal").Set(0)
	}

	// SHM file (Shared Memory)
	if shmInfo, err := os.Stat(c.dbPath + "-shm"); err == nil {
		DBSizeBytes.WithLabelValues("shm").Set(float64(shmInfo.Size()))
	} else {
		DBSizeBytes.WithLabelValues("shm").Set(0)
	}
}
