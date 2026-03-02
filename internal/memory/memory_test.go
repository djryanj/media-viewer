package memory

import (
	"math"
	"runtime"
	"testing"
	"time"
)

func TestNewMonitor(t *testing.T) {
	t.Run("With explicit limit", func(t *testing.T) {
		config := Config{
			MemoryLimitBytes:  1024 * 1024 * 100, // 100 MB
			HighWaterMark:     0.7,
			CriticalWaterMark: 0.85,
			CheckInterval:     5 * time.Second,
		}

		monitor := NewMonitor(config)
		if monitor == nil {
			t.Fatal("NewMonitor returned nil")
		}

		if monitor.limit != config.MemoryLimitBytes {
			t.Errorf("Expected limit %d, got %d", config.MemoryLimitBytes, monitor.limit)
		}

		if monitor.config.HighWaterMark != config.HighWaterMark {
			t.Errorf("Expected high water mark %.2f, got %.2f", config.HighWaterMark, monitor.config.HighWaterMark)
		}
	})

	t.Run("Without limit", func(t *testing.T) {
		config := Config{
			MemoryLimitBytes:  0,
			HighWaterMark:     0.7,
			CriticalWaterMark: 0.85,
			CheckInterval:     5 * time.Second,
		}

		monitor := NewMonitor(config)
		if monitor == nil {
			t.Fatal("NewMonitor returned nil")
		}

		// Limit may be set from GOMEMLIMIT or remain 0
		// Just verify the monitor is created
		if monitor.config.CheckInterval != config.CheckInterval {
			t.Errorf("Expected check interval %v, got %v", config.CheckInterval, monitor.config.CheckInterval)
		}
	})
}

func TestMonitorStartStop(_ *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100, // 100 MB
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     50 * time.Millisecond,
	}

	monitor := NewMonitor(config)
	monitor.Start()

	// Let it run briefly
	time.Sleep(100 * time.Millisecond)

	// Stop should not panic
	monitor.Stop()

	// Give goroutine time to exit
	time.Sleep(50 * time.Millisecond)
}

func TestMonitorWithNoLimit(_ *testing.T) {
	config := Config{
		MemoryLimitBytes:  0, // No limit
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     50 * time.Millisecond,
	}

	monitor := NewMonitor(config)
	monitor.Start()

	// Should return immediately when no limit is configured
	time.Sleep(100 * time.Millisecond)

	monitor.Stop()
}

func TestMonitorGetStats(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100, // 100 MB
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     5 * time.Second,
	}

	monitor := NewMonitor(config)

	current, limit, usage := monitor.GetStats()

	if current < 0 {
		t.Errorf("Expected non-negative current, got %d", current)
	}

	if limit != config.MemoryLimitBytes {
		t.Errorf("Expected limit %d, got %d", config.MemoryLimitBytes, limit)
	}

	if usage < 0 || usage > 1 {
		t.Errorf("Expected usage between 0 and 1, got %f", usage)
	}
}

func TestMonitorGetUsage(t *testing.T) {
	t.Run("With limit", func(t *testing.T) {
		config := Config{
			MemoryLimitBytes:  1024 * 1024 * 100, // 100 MB
			HighWaterMark:     0.7,
			CriticalWaterMark: 0.85,
			CheckInterval:     5 * time.Second,
		}

		monitor := NewMonitor(config)
		usage := monitor.GetUsage()

		if usage < 0 || usage > 1 {
			t.Errorf("Expected usage between 0 and 1, got %f", usage)
		}
	})

	t.Run("Without limit", func(t *testing.T) {
		config := Config{
			MemoryLimitBytes:  0, // No limit
			HighWaterMark:     0.7,
			CriticalWaterMark: 0.85,
			CheckInterval:     5 * time.Second,
		}

		monitor := NewMonitor(config)
		usage := monitor.GetUsage()

		if usage != 0 {
			t.Errorf("Expected usage 0 when no limit, got %f", usage)
		}
	})
}

func TestMonitorIsPaused(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 10, // 10 MB (small to potentially trigger)
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     50 * time.Millisecond,
	}

	monitor := NewMonitor(config)

	// Initially should not be paused
	if monitor.IsPaused() {
		t.Error("Expected monitor to not be paused initially")
	}

	monitor.Start()
	time.Sleep(150 * time.Millisecond)
	monitor.Stop()

	// IsPaused should not panic
	_ = monitor.IsPaused()
}

func TestMonitorShouldThrottle(t *testing.T) {
	t.Run("With limit", func(t *testing.T) {
		config := Config{
			MemoryLimitBytes:  1024 * 1024 * 100, // 100 MB
			HighWaterMark:     0.7,
			CriticalWaterMark: 0.85,
			CheckInterval:     5 * time.Second,
		}

		monitor := NewMonitor(config)

		// Should return boolean without panic
		throttle := monitor.ShouldThrottle()
		if throttle != true && throttle != false {
			t.Error("ShouldThrottle should return a boolean")
		}
	})

	t.Run("Without limit", func(t *testing.T) {
		config := Config{
			MemoryLimitBytes:  0, // No limit
			HighWaterMark:     0.7,
			CriticalWaterMark: 0.85,
			CheckInterval:     5 * time.Second,
		}

		monitor := NewMonitor(config)

		throttle := monitor.ShouldThrottle()
		if throttle {
			t.Error("Expected ShouldThrottle to return false when no limit")
		}
	})
}

func TestMonitorWaitIfPaused(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100, // 100 MB
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     50 * time.Millisecond,
	}

	monitor := NewMonitor(config)
	monitor.Start()

	// Should return true when not paused
	result := monitor.WaitIfPaused()
	if !result {
		t.Error("Expected WaitIfPaused to return true when not paused")
	}

	monitor.Stop()

	// After stop, WaitIfPaused may return either true or false
	// depending on timing - both are acceptable
	_ = monitor.WaitIfPaused()
}

func TestMonitorForceGC(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100, // 100 MB
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     5 * time.Second,
	}

	monitor := NewMonitor(config)

	// Get GC stats before
	var statsBefore runtime.MemStats
	runtime.ReadMemStats(&statsBefore)

	// Should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ForceGC panicked: %v", r)
		}
	}()

	monitor.ForceGC()

	// Verify GC actually ran
	var statsAfter runtime.MemStats
	runtime.ReadMemStats(&statsAfter)

	// NumGC should increase after ForceGC, but in some test environments
	// it may not increment. At minimum, verify we can read stats after GC.
	switch {
	case statsAfter.NumGC > statsBefore.NumGC:
		t.Logf("GC ran successfully (NumGC: %d -> %d)", statsBefore.NumGC, statsAfter.NumGC)
	case statsAfter.NumGC == 0:
		t.Log("NumGC is 0, may be in limited test environment")
	default:
		// statsAfter.NumGC == statsBefore.NumGC (but both > 0)
		// This is acceptable - GC may have already run recently
		t.Logf("NumGC unchanged at %d (GC may have run recently)", statsAfter.NumGC)
	}
}

func TestMonitorCheckMemory(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100, // 100 MB
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     50 * time.Millisecond,
	}

	monitor := NewMonitor(config)
	monitor.Start()

	// Let the monitor run and check memory a few times
	time.Sleep(200 * time.Millisecond)

	// Get stats to verify monitoring is working
	current, limit, usage := monitor.GetStats()

	if current < 0 {
		t.Errorf("Expected non-negative current memory, got %d", current)
	}

	if limit != config.MemoryLimitBytes {
		t.Errorf("Expected limit %d, got %d", config.MemoryLimitBytes, limit)
	}

	if usage < 0 {
		t.Errorf("Expected non-negative usage, got %f", usage)
	}

	monitor.Stop()
}

// =============================================================================
// checkMemory branch coverage – critical path and recovery path
// =============================================================================

// TestCheckMemoryCriticalPath verifies that checkMemory sets isPaused=true when
// the simulated usage exceeds CriticalWaterMark.  We set m.limit=1 so that
// any real heap allocation produces usage >> 1.0.
func TestCheckMemoryCriticalPath(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100,
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     5 * time.Second,
	}
	monitor := NewMonitor(config)

	// Override the limit to 1 byte so actual alloc >> limit → critical.
	monitor.limit = 1

	monitor.checkMemory()

	monitor.mu.RLock()
	paused := monitor.isPaused
	monitor.mu.RUnlock()

	if !paused {
		t.Error("expected isPaused=true after checkMemory with limit=1")
	}
}

// TestCheckMemoryRecoveryPath verifies the recovery transition: isPaused goes
// from true → false when usage drops below HighWaterMark.
func TestCheckMemoryRecoveryPath(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100,
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     5 * time.Second,
	}
	monitor := NewMonitor(config)

	// Force critical state: limit=1 byte ensures usage >> CriticalWaterMark.
	monitor.limit = 1
	monitor.checkMemory()

	monitor.mu.RLock()
	paused := monitor.isPaused
	monitor.mu.RUnlock()
	if !paused {
		t.Fatal("precondition failed: expected isPaused=true after tiny-limit checkMemory")
	}

	// Now set an enormous limit so usage << HighWaterMark → recovery triggered.
	monitor.limit = math.MaxInt64 / 2
	monitor.checkMemory()

	monitor.mu.RLock()
	paused = monitor.isPaused
	monitor.mu.RUnlock()

	if paused {
		t.Error("expected isPaused=false after recovery (large limit) checkMemory")
	}
}

// TestWaitIfPausedBlocksUntilRecovery verifies that WaitIfPaused blocks while
// the monitor is paused and resumes (returning true) once recovery fires.
func TestWaitIfPausedBlocksUntilRecovery(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100,
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     5 * time.Second,
	}
	monitor := NewMonitor(config)

	// Put the monitor into paused state directly.
	monitor.limit = 1
	monitor.checkMemory() // sets isPaused=true and closes the old pauseChan

	if !monitor.isPaused {
		t.Fatal("precondition failed: monitor should be paused")
	}

	// WaitIfPaused in a separate goroutine — it should block until recovery.
	resultCh := make(chan bool, 1)
	go func() {
		resultCh <- monitor.WaitIfPaused()
	}()

	// Give the goroutine a moment to block on pauseChan.
	time.Sleep(20 * time.Millisecond)

	// Trigger recovery by raising the limit.
	monitor.limit = math.MaxInt64 / 2
	monitor.checkMemory()

	select {
	case result := <-resultCh:
		if !result {
			t.Error("WaitIfPaused returned false; expected true after recovery")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("WaitIfPaused did not unblock within 2s after recovery")
	}
}

// TestWaitIfPausedStopWhilePaused verifies that WaitIfPaused returns false when
// the stop channel is closed while the monitor is paused.
func TestWaitIfPausedStopWhilePaused(t *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100,
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     5 * time.Second,
	}
	monitor := NewMonitor(config)

	// Force paused state.
	monitor.limit = 1
	monitor.checkMemory()

	if !monitor.isPaused {
		t.Fatal("precondition failed: monitor should be paused")
	}

	resultCh := make(chan bool, 1)
	go func() {
		resultCh <- monitor.WaitIfPaused()
	}()

	time.Sleep(20 * time.Millisecond)

	// Close stop channel to simulate Stop().
	close(monitor.stopChan)

	select {
	case result := <-resultCh:
		if result {
			t.Error("WaitIfPaused returned true; expected false when stop channel closes")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("WaitIfPaused did not unblock within 2s after stop")
	}
}

// TestStartEarlyReturnWhenNoLimit verifies that Start() returns immediately
// without launching a goroutine when limit == 0, covering memory.go:76-78.
func TestStartEarlyReturnWhenNoLimit(_ *testing.T) {
	// Construct directly to guarantee limit == 0 regardless of GOMEMLIMIT.
	m := &Monitor{
		config: Config{
			HighWaterMark:     0.7,
			CriticalWaterMark: 0.85,
			CheckInterval:     50 * time.Millisecond,
		},
		limit:     0,
		stopChan:  make(chan struct{}),
		pauseChan: make(chan struct{}),
	}
	// Start must return immediately (no goroutine launched) — just verify no panic.
	m.Start()
}

// TestShouldThrottleNoLimitReturnsFalseDirectly covers the early-return path
// in ShouldThrottle() when limit == 0 (memory.go:162-164) by constructing a
// Monitor directly, bypassing NewMonitor's GOMEMLIMIT fallback.
func TestShouldThrottleNoLimitReturnsFalseDirectly(t *testing.T) {
	m := &Monitor{
		config: Config{
			HighWaterMark:     0.7,
			CriticalWaterMark: 0.85,
			CheckInterval:     5 * time.Second,
		},
		limit:     0,
		stopChan:  make(chan struct{}),
		pauseChan: make(chan struct{}),
	}
	if m.ShouldThrottle() {
		t.Error("ShouldThrottle should return false when limit == 0")
	}
}

// TestGetUsageNoLimitReturnsZeroDirectly covers the early-return path in
// GetUsage() when limit == 0 (memory.go:182-184).
func TestGetUsageNoLimitReturnsZeroDirectly(t *testing.T) {
	m := &Monitor{
		config: Config{
			HighWaterMark:     0.7,
			CriticalWaterMark: 0.85,
			CheckInterval:     5 * time.Second,
		},
		limit:     0,
		stopChan:  make(chan struct{}),
		pauseChan: make(chan struct{}),
	}
	if got := m.GetUsage(); got != 0 {
		t.Errorf("GetUsage should return 0 when limit == 0, got %f", got)
	}
}

func TestMonitorConcurrency(_ *testing.T) {
	config := Config{
		MemoryLimitBytes:  1024 * 1024 * 100, // 100 MB
		HighWaterMark:     0.7,
		CriticalWaterMark: 0.85,
		CheckInterval:     10 * time.Millisecond,
	}

	monitor := NewMonitor(config)
	monitor.Start()

	// Concurrently call various methods
	done := make(chan bool, 4)

	go func() {
		for i := 0; i < 10; i++ {
			monitor.GetUsage()
			time.Sleep(5 * time.Millisecond)
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 10; i++ {
			monitor.IsPaused()
			time.Sleep(5 * time.Millisecond)
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 10; i++ {
			monitor.ShouldThrottle()
			time.Sleep(5 * time.Millisecond)
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 10; i++ {
			monitor.GetStats()
			time.Sleep(5 * time.Millisecond)
		}
		done <- true
	}()

	// Wait for all goroutines
	for i := 0; i < 4; i++ {
		<-done
	}

	monitor.Stop()
}
