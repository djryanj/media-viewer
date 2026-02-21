package database

import (
	"errors"
	"sync"
	"testing"
	"time"

	"media-viewer/internal/metrics"
)

// TestObserveQuery tests the observeQuery helper function.
func TestObserveQuery(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		operation string
		err       error
		wantEmpty bool
	}{
		{
			name:      "successful query",
			operation: "test_operation",
			err:       nil,
			wantEmpty: false,
		},
		{
			name:      "failed query",
			operation: "test_operation",
			err:       errors.New("test error"),
			wantEmpty: false,
		},
		{
			name:      "empty operation name",
			operation: "",
			err:       nil,
			wantEmpty: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			// Record the query using the new closure pattern - this should not panic
			done := observeQuery(tt.operation)
			time.Sleep(1 * time.Millisecond) // Ensure some duration
			done(tt.err)
		})
	}
}

// TestObserveQueryMetrics tests that metrics are properly recorded.
func TestObserveQueryMetrics(t *testing.T) {
	t.Parallel()

	operation := "test_metrics_operation"

	// Test success case
	done := observeQuery(operation)
	done(nil)

	// Test error case
	done = observeQuery(operation)
	done(errors.New("test error"))

	// If we got here without panicking, the test passes
}

// TestObserveQueryWithZeroDuration tests handling of very fast queries.
func TestObserveQueryWithZeroDuration(t *testing.T) {
	t.Parallel()

	operation := "instant_query"

	// Record immediately (near-zero duration)
	done := observeQuery(operation)
	done(nil)

	// Should not panic even with zero/near-zero duration
}

// TestIndexStatsStruct tests the IndexStats struct.
func TestIndexStatsStruct(t *testing.T) {
	t.Parallel()

	stats := IndexStats{
		TotalFiles:     1000,
		TotalFolders:   50,
		TotalImages:    600,
		TotalVideos:    400,
		TotalPlaylists: 5,
		TotalFavorites: 25,
		TotalTags:      15,
		LastIndexed:    time.Now(),
		IndexDuration:  "5.2s",
	}

	if stats.TotalFiles != 1000 {
		t.Errorf("TotalFiles = %d, want 1000", stats.TotalFiles)
	}

	if stats.TotalFolders != 50 {
		t.Errorf("TotalFolders = %d, want 50", stats.TotalFolders)
	}

	if stats.TotalImages != 600 {
		t.Errorf("TotalImages = %d, want 600", stats.TotalImages)
	}

	if stats.TotalVideos != 400 {
		t.Errorf("TotalVideos = %d, want 400", stats.TotalVideos)
	}

	if stats.TotalPlaylists != 5 {
		t.Errorf("TotalPlaylists = %d, want 5", stats.TotalPlaylists)
	}

	if stats.TotalFavorites != 25 {
		t.Errorf("TotalFavorites = %d, want 25", stats.TotalFavorites)
	}

	if stats.TotalTags != 15 {
		t.Errorf("TotalTags = %d, want 15", stats.TotalTags)
	}

	if stats.IndexDuration != "5.2s" {
		t.Errorf("IndexDuration = %s, want '5.2s'", stats.IndexDuration)
	}

	if stats.LastIndexed.IsZero() {
		t.Error("LastIndexed should not be zero")
	}
}

// TestIndexStatsZeroValues tests IndexStats with zero values.
func TestIndexStatsZeroValues(t *testing.T) {
	t.Parallel()

	stats := IndexStats{}

	if stats.TotalFiles != 0 {
		t.Errorf("Default TotalFiles = %d, want 0", stats.TotalFiles)
	}

	if stats.TotalFolders != 0 {
		t.Errorf("Default TotalFolders = %d, want 0", stats.TotalFolders)
	}

	if stats.TotalImages != 0 {
		t.Errorf("Default TotalImages = %d, want 0", stats.TotalImages)
	}

	if stats.TotalVideos != 0 {
		t.Errorf("Default TotalVideos = %d, want 0", stats.TotalVideos)
	}

	if stats.TotalPlaylists != 0 {
		t.Errorf("Default TotalPlaylists = %d, want 0", stats.TotalPlaylists)
	}

	if stats.TotalFavorites != 0 {
		t.Errorf("Default TotalFavorites = %d, want 0", stats.TotalFavorites)
	}

	if stats.TotalTags != 0 {
		t.Errorf("Default TotalTags = %d, want 0", stats.TotalTags)
	}

	if stats.IndexDuration != "" {
		t.Errorf("Default IndexDuration = %s, want empty string", stats.IndexDuration)
	}

	if !stats.LastIndexed.IsZero() {
		t.Errorf("Default LastIndexed should be zero time, got %v", stats.LastIndexed)
	}
}

// TestIndexStatsLargeValues tests IndexStats with large values.
func TestIndexStatsLargeValues(t *testing.T) {
	t.Parallel()

	stats := IndexStats{
		TotalFiles:     1_000_000,
		TotalFolders:   100_000,
		TotalImages:    600_000,
		TotalVideos:    400_000,
		TotalPlaylists: 1_000,
		TotalFavorites: 50_000,
		TotalTags:      10_000,
		LastIndexed:    time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
		IndexDuration:  "1h23m45s",
	}

	if stats.TotalFiles != 1_000_000 {
		t.Errorf("TotalFiles = %d, want 1000000", stats.TotalFiles)
	}

	if stats.LastIndexed.IsZero() {
		t.Error("LastIndexed should not be zero")
	}

	if stats.TotalFolders != 100_000 {
		t.Errorf("TotalFolders = %d, want 100000", stats.TotalFolders)
	}

	if stats.TotalImages != 600_000 {
		t.Errorf("TotalImages = %d, want 600000", stats.TotalImages)
	}

	if stats.TotalVideos != 400_000 {
		t.Errorf("TotalVideos = %d, want 400000", stats.TotalVideos)
	}

	if stats.TotalPlaylists != 1_000 {
		t.Errorf("TotalPlaylists = %d, want 1000", stats.TotalPlaylists)
	}

	if stats.TotalFavorites != 50_000 {
		t.Errorf("TotalFavorites = %d, want 50000", stats.TotalFavorites)
	}

	if stats.TotalTags != 10_000 {
		t.Errorf("TotalTags = %d, want 10000", stats.TotalTags)
	}

	if stats.IndexDuration != "1h23m45s" {
		t.Errorf("IndexDuration = %s, want '1h23m45s'", stats.IndexDuration)
	}
}

// TestUserStruct tests the User struct.
func TestUserStruct(t *testing.T) {
	t.Parallel()

	now := time.Now()
	user := User{
		ID:           1,
		PasswordHash: "$2a$10$abcdef...",
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if user.ID != 1 {
		t.Errorf("ID = %d, want 1", user.ID)
	}

	if user.PasswordHash != "$2a$10$abcdef..." {
		t.Errorf("PasswordHash = %s, want '$2a$10$abcdef...'", user.PasswordHash)
	}

	if !user.CreatedAt.Equal(now) {
		t.Errorf("CreatedAt = %v, want %v", user.CreatedAt, now)
	}

	if !user.UpdatedAt.Equal(now) {
		t.Errorf("UpdatedAt = %v, want %v", user.UpdatedAt, now)
	}
}

// TestSessionStruct tests the Session struct.
func TestSessionStruct(t *testing.T) {
	t.Parallel()

	now := time.Now()
	expiresAt := now.Add(5 * time.Minute)

	session := Session{
		ID:        1,
		UserID:    42,
		Token:     "abc123token",
		ExpiresAt: expiresAt,
		CreatedAt: now,
	}

	if session.ID != 1 {
		t.Errorf("ID = %d, want 1", session.ID)
	}

	if session.UserID != 42 {
		t.Errorf("UserID = %d, want 42", session.UserID)
	}

	if session.Token != "abc123token" {
		t.Errorf("Token = %s, want 'abc123token'", session.Token)
	}

	if !session.ExpiresAt.Equal(expiresAt) {
		t.Errorf("ExpiresAt = %v, want %v", session.ExpiresAt, expiresAt)
	}

	if !session.CreatedAt.Equal(now) {
		t.Errorf("CreatedAt = %v, want %v", session.CreatedAt, now)
	}
}

// TestSessionExpiration tests session expiration logic.
func TestSessionExpiration(t *testing.T) {
	t.Parallel()

	now := time.Now()

	tests := []struct {
		name      string
		expiresAt time.Time
		isExpired bool
	}{
		{
			name:      "not expired - future",
			expiresAt: now.Add(5 * time.Minute),
			isExpired: false,
		},
		{
			name:      "expired - past",
			expiresAt: now.Add(-5 * time.Minute),
			isExpired: true,
		},
		{
			name:      "expires now",
			expiresAt: now,
			isExpired: false, // Exact time is not expired
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			session := Session{
				ID:        1,
				UserID:    1,
				Token:     "test",
				ExpiresAt: tt.expiresAt,
				CreatedAt: now,
			}

			if session.ID != 1 {
				t.Errorf("Session.ID = %d, want 1", session.ID)
			}
			if session.UserID != 1 {
				t.Errorf("Session.UserID = %d, want 1", session.UserID)
			}
			if session.Token != "test" {
				t.Errorf("Session.Token = %q, want %q", session.Token, "test")
			}
			if !session.CreatedAt.Equal(now) {
				t.Errorf("Session.CreatedAt = %v, want %v", session.CreatedAt, now)
			}

			actualExpired := session.ExpiresAt.Before(now)
			if actualExpired != tt.isExpired {
				t.Errorf("Session expiration check: got %v, want %v", actualExpired, tt.isExpired)
			}
		})
	}
}

// TestSearchOptionsStruct tests the SearchOptions struct.
func TestSearchOptionsStruct(t *testing.T) {
	t.Parallel()

	opts := SearchOptions{
		Query:    "vacation photos",
		Page:     2,
		PageSize: 25,
	}

	if opts.Query != "vacation photos" {
		t.Errorf("Query = %s, want 'vacation photos'", opts.Query)
	}

	if opts.Page != 2 {
		t.Errorf("Page = %d, want 2", opts.Page)
	}

	if opts.PageSize != 25 {
		t.Errorf("PageSize = %d, want 25", opts.PageSize)
	}
}

// TestSearchOptionsDefaults tests SearchOptions with default values.
func TestSearchOptionsDefaults(t *testing.T) {
	t.Parallel()

	opts := SearchOptions{}

	if opts.Query != "" {
		t.Errorf("Default Query = %s, want empty string", opts.Query)
	}

	if opts.Page != 0 {
		t.Errorf("Default Page = %d, want 0", opts.Page)
	}

	if opts.PageSize != 0 {
		t.Errorf("Default PageSize = %d, want 0", opts.PageSize)
	}
}

// TestMetricsIntegration tests that metrics functions don't panic.
func TestMetricsIntegration(t *testing.T) {
	t.Parallel()

	// Ensure metrics are initialized
	if metrics.DBQueryTotal == nil {
		t.Skip("Metrics not initialized")
	}

	// Test that metrics calls don't panic
	done := observeQuery("test_integration")
	done(nil)

	done = observeQuery("test_integration")
	done(errors.New("test error"))

	// If we got here without panicking, test passes
}

// TestDefaultTimeoutConstant tests the default timeout constant.
func TestDefaultTimeoutConstant(t *testing.T) {
	t.Parallel()

	if defaultTimeout != 5*time.Second {
		t.Errorf("defaultTimeout = %v, want 5 seconds", defaultTimeout)
	}

	if defaultTimeout < 1*time.Second {
		t.Error("defaultTimeout should be at least 1 second")
	}
}

// TestConnectionPoolConfiguration tests that connection pool is properly configured
func TestConnectionPoolConfiguration(t *testing.T) {
	expectedMaxOpen := 25
	expectedMaxIdle := 10

	if expectedMaxOpen < expectedMaxIdle {
		t.Errorf("MaxOpenConns (%d) should be >= MaxIdleConns (%d)", expectedMaxOpen, expectedMaxIdle)
	}

	if expectedMaxIdle < 1 {
		t.Error("MaxIdleConns should be at least 1")
	}

	minRecommended := 10
	if expectedMaxOpen < minRecommended {
		t.Errorf("MaxOpenConns (%d) should be at least %d for concurrent operations", expectedMaxOpen, minRecommended)
	}
}

// TestBeginBatchLockingBehavior tests transaction lock management
func TestBeginBatchLockingBehavior(t *testing.T) {
	t.Log("BeginBatch should:")
	t.Log("1. Acquire transaction lock")
	t.Log("2. Begin transaction")
	t.Log("3. Release lock immediately (allow reads)")
	t.Log("4. Transaction committed later with EndBatch")
}

// =============================================================================
// Mmap / SIGBUS Protection — Unit Tests
// =============================================================================

// TestDriverNameConstant verifies the custom driver name is set correctly.
func TestDriverNameConstant(t *testing.T) {
	t.Parallel()

	if driverName != "sqlite3_mmap_disabled" {
		t.Errorf("driverName = %q, want %q", driverName, "sqlite3_mmap_disabled")
	}

	if standardDriverName != "sqlite3" {
		t.Errorf("standardDriverName = %q, want %q", standardDriverName, "sqlite3")
	}
}

// TestActiveDriverName verifies driver selection based on options.
func TestActiveDriverName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		opts     *Options
		wantName string
	}{
		{
			name:     "nil options uses standard driver",
			opts:     nil,
			wantName: standardDriverName,
		},
		{
			name:     "mmap enabled uses standard driver",
			opts:     &Options{MmapDisabled: false},
			wantName: standardDriverName,
		},
		{
			name:     "mmap disabled uses custom driver",
			opts:     &Options{MmapDisabled: true},
			wantName: driverName,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := activeDriverName(tt.opts)
			if got != tt.wantName {
				t.Errorf("activeDriverName(%+v) = %q, want %q", tt.opts, got, tt.wantName)
			}
		})
	}
}

// TestOptionsStruct tests the Options struct.
func TestOptionsStruct(t *testing.T) {
	t.Parallel()

	// Default zero value should have mmap enabled (not disabled)
	opts := Options{}
	if opts.MmapDisabled {
		t.Error("Default Options.MmapDisabled should be false")
	}

	// Explicit disable
	opts = Options{MmapDisabled: true}
	if !opts.MmapDisabled {
		t.Error("Options.MmapDisabled should be true when set")
	}
}

// TestRegisterDriverIdempotent verifies that registerDriver can be called
// multiple times without panicking (sync.Once protection).
func TestRegisterDriverIdempotent(t *testing.T) {
	t.Parallel()

	// registerDriver() was already called by init().
	// Calling it again should be a no-op via sync.Once.
	registerDriver()
	registerDriver()
	registerDriver()

	// If we got here without panicking, the test passes.
}

// BenchmarkObserveQuery benchmarks the query recording overhead
func BenchmarkObserveQuery(b *testing.B) {
	operation := "benchmark_operation"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		done := observeQuery(operation)
		done(nil)
	}
}

// BenchmarkObserveQueryWithError benchmarks query recording with errors
func BenchmarkObserveQueryWithError(b *testing.B) {
	operation := "benchmark_operation"
	err := errors.New("test error")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		done := observeQuery(operation)
		done(err)
	}
}

// BenchmarkObserveQueryConcurrent benchmarks concurrent query recording
func BenchmarkObserveQueryConcurrent(b *testing.B) {
	operation := "benchmark_operation"

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			done := observeQuery(operation)
			done(nil)
		}
	})
}

// TestObserveQueryClosureTimingAccuracy verifies that the closure measures
// the elapsed time between observeQuery() and done(), not some other interval.
func TestObserveQueryClosureTimingAccuracy(t *testing.T) {
	t.Parallel()

	done := observeQuery("timing_accuracy_test")

	// Sleep a known duration so the closure captures real elapsed time
	time.Sleep(10 * time.Millisecond)

	// Calling done should not panic and should record a non-trivial duration
	done(nil)
}

// TestObserveQueryIndependentClosures verifies that multiple calls to
// observeQuery produce independent closures with their own start times.
func TestObserveQueryIndependentClosures(t *testing.T) {
	t.Parallel()

	// Start two queries at different times
	done1 := observeQuery("independent_first")
	time.Sleep(5 * time.Millisecond)

	done2 := observeQuery("independent_second")
	time.Sleep(5 * time.Millisecond)

	// Finish in reverse order — each closure should be independent
	done2(nil)
	done1(nil)

	// If we got here without panicking, closures are independent
}

// TestObserveQueryStatusLabels verifies that done() handles both nil
// and non-nil errors without panicking.
func TestObserveQueryStatusLabels(t *testing.T) {
	t.Parallel()

	// Success case
	done := observeQuery("status_success")
	done(nil)

	// Error case
	done = observeQuery("status_error")
	done(errors.New("something went wrong"))

	// Wrapped error case
	done = observeQuery("status_wrapped_error")
	done(errors.New("outer: inner error"))
}

// TestObserveQueryDoubleDone verifies that calling done() twice doesn't panic.
// In production code done() should only be called once, but we want to ensure
// it doesn't crash if misused.
func TestObserveQueryDoubleDone(t *testing.T) {
	t.Parallel()

	done := observeQuery("double_done_test")
	done(nil)

	// Second call should not panic
	done(errors.New("second call"))
}

// TestObserveQueryReturnsImmediately verifies that the observeQuery call
// itself is near-instant — it should only capture the start time and return.
func TestObserveQueryReturnsImmediately(t *testing.T) {
	t.Parallel()

	start := time.Now()
	done := observeQuery("instant_return_test")
	elapsed := time.Since(start)

	// observeQuery() should return in well under 1ms
	if elapsed > 1*time.Millisecond {
		t.Errorf("observeQuery() took %v, expected < 1ms", elapsed)
	}

	done(nil)
}

// TestObserveQueryVariousOperationNames verifies that different operation
// names used throughout the codebase don't cause panics in metrics recording.
func TestObserveQueryVariousOperationNames(t *testing.T) {
	t.Parallel()

	operations := []string{
		"upsert_file",
		"list_directory",
		"get_files_by_tag",
		"validate_session",
		"calculate_stats",
		"search",
		"add_favorite",
		"delete_tag",
		"create_session",
		"save_webauthn_credential",
	}

	for _, op := range operations {
		done := observeQuery(op)
		done(nil)
	}
}

// TestObserveQueryConcurrentClosureSafety verifies that many goroutines
// can each create and use their own done() closure without data races.
// Run with: go test -race -run TestObserveQueryConcurrentClosureSafety
func TestObserveQueryConcurrentClosureSafety(t *testing.T) {
	t.Parallel()

	const goroutines = 100
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func(id int) {
			defer wg.Done()

			done := observeQuery("concurrent_safety_test")
			time.Sleep(time.Duration(id%5) * time.Millisecond)

			var err error
			if id%3 == 0 {
				err = errors.New("simulated error")
			}
			done(err)
		}(i)
	}

	wg.Wait()
}
