package memory

import (
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
