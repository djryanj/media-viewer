package memory

import (
	"math"
	"runtime"
	"runtime/debug"
	"sync"
	"time"

	"media-viewer/internal/logging"
	"media-viewer/internal/metrics"
)

// Config holds memory management configuration
type Config struct {
	// MemoryLimitBytes is the soft memory limit (0 = use GOMEMLIMIT or no limit)
	MemoryLimitBytes int64

	// HighWaterMark is the percentage of limit at which to start throttling (0.0-1.0)
	HighWaterMark float64

	// CriticalWaterMark is the percentage at which to pause processing entirely (0.0-1.0)
	CriticalWaterMark float64

	// CheckInterval is how often to check memory usage
	CheckInterval time.Duration
}

// DefaultConfig returns sensible defaults for memory management
func DefaultConfig() Config {
	return Config{
		MemoryLimitBytes:  0, // Use GOMEMLIMIT if set
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     5 * time.Second,
	}
}

// Monitor tracks memory usage and provides backpressure signals
type Monitor struct {
	config    Config
	limit     int64
	stopChan  chan struct{}
	mu        sync.RWMutex
	current   uint64
	isPaused  bool
	pauseChan chan struct{}
}

// NewMonitor creates a new memory monitor
func NewMonitor(config Config) *Monitor {
	limit := config.MemoryLimitBytes

	// If no explicit limit, try to get GOMEMLIMIT
	if limit == 0 {
		if goMemLimit := debug.SetMemoryLimit(-1); goMemLimit > 0 && goMemLimit < 1<<62 {
			limit = goMemLimit
			logging.Info("Memory monitor using GOMEMLIMIT: %d bytes (%.1f MB)", limit, float64(limit)/(1024*1024))
		}
	}

	if limit == 0 {
		logging.Warn("Memory monitor: no memory limit configured, backpressure disabled")
	}

	return &Monitor{
		config:    config,
		limit:     limit,
		stopChan:  make(chan struct{}),
		pauseChan: make(chan struct{}),
	}
}

// Start begins monitoring memory usage
func (m *Monitor) Start() {
	if m.limit == 0 {
		return // No limit configured, nothing to monitor
	}

	go m.monitorLoop()
}

// Stop stops the memory monitor
func (m *Monitor) Stop() {
	close(m.stopChan)
}

func (m *Monitor) monitorLoop() {
	ticker := time.NewTicker(m.config.CheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.checkMemory()
		case <-m.stopChan:
			return
		}
	}
}

func (m *Monitor) checkMemory() {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)

	m.mu.Lock()
	m.current = stats.Alloc
	wasPaused := m.isPaused

	if m.limit > 0 {
		usage := float64(stats.Alloc) / float64(m.limit)

		// Update usage ratio metric
		metrics.MemoryUsageRatio.Set(usage)

		if usage >= m.config.CriticalWaterMark {
			if !m.isPaused {
				logging.Warn("Memory critical (%.1f%% of limit), pausing processing", usage*100)
				m.isPaused = true
				metrics.MemoryPaused.Set(1)
				metrics.MemoryGCPauses.Inc()
				go runtime.GC()
			}
		} else if usage < m.config.HighWaterMark {
			if m.isPaused {
				logging.Info("Memory recovered (%.1f%% of limit), resuming processing", usage*100)
				m.isPaused = false
				metrics.MemoryPaused.Set(0)
				close(m.pauseChan)
				m.pauseChan = make(chan struct{})
			}
		}
	}
	m.mu.Unlock()

	if m.isPaused != wasPaused {
		logging.Debug("Memory state changed: paused=%v, alloc=%.1f MB", m.isPaused, float64(stats.Alloc)/(1024*1024))
	}
}

// WaitIfPaused blocks if memory usage is critical, returns when it's safe to proceed
// Returns false if the stop channel is closed
func (m *Monitor) WaitIfPaused() bool {
	m.mu.RLock()
	if !m.isPaused {
		m.mu.RUnlock()
		return true
	}
	pauseChan := m.pauseChan
	m.mu.RUnlock()

	select {
	case <-pauseChan:
		return true
	case <-m.stopChan:
		return false
	}
}

// ShouldThrottle returns true if memory usage is above the high water mark
func (m *Monitor) ShouldThrottle() bool {
	if m.limit == 0 {
		return false
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	return float64(m.current) >= float64(m.limit)*m.config.HighWaterMark
}

// IsPaused returns true if processing should be paused entirely
func (m *Monitor) IsPaused() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.isPaused
}

// GetUsage returns current memory usage as a percentage of the limit (0.0-1.0)
// Returns 0 if no limit is configured
func (m *Monitor) GetUsage() float64 {
	if m.limit == 0 {
		return 0
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	return float64(m.current) / float64(m.limit)
}

// GetStats returns current memory statistics
func (m *Monitor) GetStats() (current, limit int64, usage float64) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Safe conversion from uint64 to int64, capping at max int64
	var currentInt64 int64
	if m.current > math.MaxInt64 {
		currentInt64 = math.MaxInt64
	} else {
		currentInt64 = int64(m.current)
	}

	var usageRatio float64
	if m.limit > 0 {
		usageRatio = float64(m.current) / float64(m.limit)
	}

	return currentInt64, m.limit, usageRatio
}

// ForceGC triggers a garbage collection
func (m *Monitor) ForceGC() {
	runtime.GC()
}
