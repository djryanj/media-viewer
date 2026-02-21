package metrics

import (
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"time"

	"media-viewer/internal/filesystem"
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
	c.collectMemoryMetrics()
	c.collectDBSize()
	c.collectTranscoderCacheSize()

	if c.storageHealthChecker != nil {
		c.storageHealthChecker.CheckStorageHealth()
		c.storageHealthChecker.UpdateDBMetrics()
	}

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

	retryConfig := filesystem.DefaultRetryConfig()

	if fileInfo, err := filesystem.StatWithRetry(c.dbPath, retryConfig); err == nil {
		DBSizeBytes.WithLabelValues("main").Set(float64(fileInfo.Size()))
	} else if !os.IsNotExist(err) {
		logging.Debug("Failed to get database file size: %v", err)
	}

	if walInfo, err := filesystem.StatWithRetry(c.dbPath+"-wal", retryConfig); err == nil {
		DBSizeBytes.WithLabelValues("wal").Set(float64(walInfo.Size()))
	} else {
		DBSizeBytes.WithLabelValues("wal").Set(0)
	}

	if shmInfo, err := filesystem.StatWithRetry(c.dbPath+"-shm", retryConfig); err == nil {
		DBSizeBytes.WithLabelValues("shm").Set(float64(shmInfo.Size()))
	} else {
		DBSizeBytes.WithLabelValues("shm").Set(0)
	}
}

func (c *Collector) collectTranscoderCacheSize() {
	if c.transcoderCacheDir == "" {
		return
	}

	// Use ReadDirWithRetry-based walk for cache directory on Longhorn
	start := time.Now()
	cacheSize, err := c.getDirSizeWithRetry(c.transcoderCacheDir)
	elapsed := time.Since(start)

	if err != nil {
		if !os.IsNotExist(err) {
			logging.Debug("Failed to get transcoder cache size (took %v): %v", elapsed, err)
		}
		TranscoderCacheSizeBytes.Set(0)
		return
	}

	TranscoderCacheSizeBytes.Set(float64(cacheSize))
}

// getDirSizeWithRetry walks a directory tree using retry-aware filesystem operations.
// Each directory listing uses ReadDirWithRetry; each file stat uses StatWithRetry.
func (c *Collector) getDirSizeWithRetry(root string) (int64, error) {
	retryConfig := filesystem.DefaultRetryConfig()

	var size int64
	var walkDir func(dir string) error

	walkDir = func(dir string) error {
		entries, err := filesystem.ReadDirWithRetry(dir, retryConfig)
		if err != nil {
			return err
		}

		for _, entry := range entries {
			fullPath := filepath.Join(dir, entry.Name())
			if entry.IsDir() {
				if err := walkDir(fullPath); err != nil {
					// Log but continue — don't abort the whole walk for one bad subdir
					logging.Debug("Failed to walk subdirectory %s: %v", fullPath, err)
				}
				continue
			}

			info, err := filesystem.StatWithRetry(fullPath, retryConfig)
			if err != nil {
				logging.Debug("Failed to stat file %s: %v", fullPath, err)
				continue
			}
			size += info.Size()
		}
		return nil
	}

	err := walkDir(root)
	return size, err
}
