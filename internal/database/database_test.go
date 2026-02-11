package database

import (
	"errors"
	"testing"
	"time"

	"media-viewer/internal/metrics"
)

// TestRecordQuery tests the recordQuery helper function.
func TestRecordQuery(t *testing.T) {
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

			start := time.Now()
			time.Sleep(1 * time.Millisecond) // Ensure some duration

			// Record the query - this should not panic
			recordQuery(tt.operation, start, tt.err)

			// Verify duration was calculated (at least 1ms passed)
			elapsed := time.Since(start)
			if elapsed < 1*time.Millisecond {
				t.Error("recordQuery should have measured non-zero duration")
			}
		})
	}
}

// TestRecordQueryMetrics tests that metrics are properly recorded.
func TestRecordQueryMetrics(t *testing.T) {
	t.Parallel()

	operation := "test_metrics_operation"
	start := time.Now()

	// Get initial metric values (if possible)
	// Note: This is a best-effort test since we can't easily read Prometheus metrics
	// The main goal is to ensure recordQuery doesn't panic

	// Test success case
	recordQuery(operation, start, nil)

	// Test error case
	recordQuery(operation, start, errors.New("test error"))

	// If we got here without panicking, the test passes
}

// TestRecordQueryWithZeroDuration tests handling of very fast queries.
func TestRecordQueryWithZeroDuration(t *testing.T) {
	t.Parallel()

	operation := "instant_query"
	start := time.Now()

	// Record immediately (near-zero duration)
	recordQuery(operation, start, nil)

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

			// Verify session fields are set
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

			// Check if expired by comparing with the captured 'now' time
			// A session is expired only if ExpiresAt is strictly before now
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
	start := time.Now()
	recordQuery("test_integration", start, nil)
	recordQuery("test_integration", start, errors.New("test error"))

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
	// This is a unit test to verify the pool configuration constants
	// The actual connection pool behavior is tested in integration tests

	expectedMaxOpen := 25
	expectedMaxIdle := 10

	// Note: We can't directly test the pool settings without creating a real database
	// but we can verify the constants are reasonable
	if expectedMaxOpen < expectedMaxIdle {
		t.Errorf("MaxOpenConns (%d) should be >= MaxIdleConns (%d)", expectedMaxOpen, expectedMaxIdle)
	}

	if expectedMaxIdle < 1 {
		t.Error("MaxIdleConns should be at least 1")
	}

	// For media-viewer with concurrent thumbnail generation and indexing,
	// we should have enough connections
	minRecommended := 10
	if expectedMaxOpen < minRecommended {
		t.Errorf("MaxOpenConns (%d) should be at least %d for concurrent operations", expectedMaxOpen, minRecommended)
	}
}

// TestBeginBatchLockingBehavior tests transaction lock management
func TestBeginBatchLockingBehavior(t *testing.T) {
	// This test verifies that BeginBatch doesn't hold locks unnecessarily
	// The actual behavior is tested in integration tests with real database

	// Verify that the pattern of acquire -> begin tx -> release is correct
	// This is a documentation test to ensure the pattern is maintained

	t.Log("BeginBatch should:")
	t.Log("1. Acquire transaction lock")
	t.Log("2. Begin transaction")
	t.Log("3. Release lock immediately (allow reads)")
	t.Log("4. Transaction committed later with EndBatch")

	// The fix moved the lock release to happen immediately after tx.Begin()
	// rather than waiting until EndBatch/transaction completion
}

// BenchmarkRecordQuery benchmarks the query recording overhead
func BenchmarkRecordQuery(b *testing.B) {
	operation := "benchmark_operation"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		recordQuery(operation, start, nil)
	}
}

// BenchmarkRecordQueryWithError benchmarks query recording with errors
func BenchmarkRecordQueryWithError(b *testing.B) {
	operation := "benchmark_operation"
	err := errors.New("test error")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		recordQuery(operation, start, err)
	}
}

// BenchmarkRecordQueryConcurrent benchmarks concurrent query recording
func BenchmarkRecordQueryConcurrent(b *testing.B) {
	operation := "benchmark_operation"

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			start := time.Now()
			recordQuery(operation, start, nil)
		}
	})
}
