package metrics

import (
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"time"

	"media-viewer/internal/logging"
)

// StatsProvider interface for collecting stats
type StatsProvider interface {
	GetStats() Stats
}

// StorageHealthChecker interface for database storage health checks
type StorageHealthChecker interface {
	CheckStorageHealth()
	UpdateDBMetrics()
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
	statsProvider        StatsProvider
	storageHealthChecker StorageHealthChecker
	dbPath               string
	transcoderCacheDir   string
	interval             time.Duration
	stopChan             chan struct{}
	lastGCCount          uint32
}

// NewCollector creates a new metrics collector
func NewCollector(provider StatsProvider, dbPath string, interval time.Duration) *Collector {
	return &Collector{
		statsProvider:      provider,
		dbPath:             dbPath,
		transcoderCacheDir: "",
		interval:           interval,
		stopChan:           make(chan struct{}),
	}
}

// SetStorageHealthChecker sets the database instance for storage health monitoring.
// This enables periodic checks that detect conditions which would have caused
// SIGBUS crashes when mmap was enabled.
func (c *Collector) SetStorageHealthChecker(checker StorageHealthChecker) {
	c.storageHealthChecker = checker
}

// Start begins the metrics collection loop
func (c *Collector) Start() {
	go c.collectLoop()
}

// Stop stops the metrics collection
func (c *Collector) Stop() {
	close(c.stopChan)
}

// SetTranscoderCacheDir sets the transcoder cache directory path
func (c *Collector) SetTranscoderCacheDir(dir string) {
	c.transcoderCacheDir = dir
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

	// Collect transcoder cache size
	c.collectTranscoderCacheSize()

	// Run database storage health check (detects conditions that cause SIGBUS with mmap)
	if c.storageHealthChecker != nil {
		c.storageHealthChecker.CheckStorageHealth()
		c.storageHealthChecker.UpdateDBMetrics()
	}

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

	if memStats.NumGC > c.lastGCCount {
		GoGCRuns.Add(float64(memStats.NumGC - c.lastGCCount))
		c.lastGCCount = memStats.NumGC
	}

	GoGCPauseTotalSeconds.Add(float64(memStats.PauseTotalNs) / 1e9)
	if memStats.NumGC > 0 {
		idx := (memStats.NumGC + 255) % 256
		GoGCPauseLastSeconds.Set(float64(memStats.PauseNs[idx]) / 1e9)
	}

	GoGCCPUFraction.Set(memStats.GCCPUFraction)

	if limit := debug.SetMemoryLimit(-1); limit > 0 && limit < 1<<62 {
		GoMemLimit.Set(float64(limit))
	}
}

func (c *Collector) collectDBSize() {
	if c.dbPath == "" {
		return
	}

	if fileInfo, err := os.Stat(c.dbPath); err == nil {
		DBSizeBytes.WithLabelValues("main").Set(float64(fileInfo.Size()))
	} else {
		logging.Debug("Failed to get database file size: %v", err)
	}

	if walInfo, err := os.Stat(c.dbPath + "-wal"); err == nil {
		DBSizeBytes.WithLabelValues("wal").Set(float64(walInfo.Size()))
	} else {
		DBSizeBytes.WithLabelValues("wal").Set(0)
	}

	if shmInfo, err := os.Stat(c.dbPath + "-shm"); err == nil {
		DBSizeBytes.WithLabelValues("shm").Set(float64(shmInfo.Size()))
	} else {
		DBSizeBytes.WithLabelValues("shm").Set(0)
	}
}

func (c *Collector) collectTranscoderCacheSize() {
	if c.transcoderCacheDir == "" {
		return
	}

	cacheSize, err := c.getDirSize(c.transcoderCacheDir)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.Debug("Failed to get transcoder cache size: %v", err)
		}
		TranscoderCacheSizeBytes.Set(0)
		return
	}

	TranscoderCacheSizeBytes.Set(float64(cacheSize))
}

func (c *Collector) getDirSize(path string) (int64, error) {
	var size int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}
