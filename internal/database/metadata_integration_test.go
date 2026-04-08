package database

import (
	"context"
	"testing"
	"time"
)

func TestGetMetadataIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Get non-existent key (should return error)
	value, err := db.GetMetadata(ctx, "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent key")
	}
	if value != "" {
		t.Errorf("Expected empty string with error, got %s", value)
	}

	// Set metadata
	err = db.SetMetadata(ctx, "testkey", "testvalue")
	if err != nil {
		t.Fatalf("SetMetadata failed: %v", err)
	}

	// Get metadata
	value, err = db.GetMetadata(ctx, "testkey")
	if err != nil {
		t.Fatalf("GetMetadata failed: %v", err)
	}

	if value != "testvalue" {
		t.Errorf("Expected value 'testvalue', got %s", value)
	}
}

func TestSetMetadataIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Set initial value
	err := db.SetMetadata(ctx, "key1", "value1")
	if err != nil {
		t.Fatalf("SetMetadata failed: %v", err)
	}

	// Update value
	err = db.SetMetadata(ctx, "key1", "value2")
	if err != nil {
		t.Fatalf("SetMetadata update failed: %v", err)
	}

	// Verify updated value
	value, err := db.GetMetadata(ctx, "key1")
	if err != nil {
		t.Fatalf("GetMetadata failed: %v", err)
	}

	if value != "value2" {
		t.Errorf("Expected updated value 'value2', got %s", value)
	}
}

func TestMetadataMultipleKeysIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Set multiple keys
	keys := map[string]string{
		"key1": "value1",
		"key2": "value2",
		"key3": "value3",
	}

	for k, v := range keys {
		err := db.SetMetadata(ctx, k, v)
		if err != nil {
			t.Fatalf("SetMetadata failed for %s: %v", k, err)
		}
	}

	// Verify all keys
	for k, expectedV := range keys {
		v, err := db.GetMetadata(ctx, k)
		if err != nil {
			t.Fatalf("GetMetadata failed for %s: %v", k, err)
		}
		if v != expectedV {
			t.Errorf("Expected %s=%s, got %s", k, expectedV, v)
		}
	}
}

func TestMetadataEmptyValueIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Set empty value
	err := db.SetMetadata(ctx, "emptykey", "")
	if err != nil {
		t.Fatalf("SetMetadata with empty value failed: %v", err)
	}

	// Get empty value
	value, err := db.GetMetadata(ctx, "emptykey")
	if err != nil {
		t.Fatalf("GetMetadata failed: %v", err)
	}

	if value != "" {
		t.Errorf("Expected empty value, got %s", value)
	}
}

func TestMetadataLongValueIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Set long value (10KB string)
	longValue := string(make([]byte, 10240))
	for i := range longValue {
		longValue = longValue[:i] + "a" + longValue[i+1:]
	}

	err := db.SetMetadata(ctx, "longkey", longValue)
	if err != nil {
		t.Fatalf("SetMetadata with long value failed: %v", err)
	}

	// Get long value
	value, err := db.GetMetadata(ctx, "longkey")
	if err != nil {
		t.Fatalf("GetMetadata failed: %v", err)
	}

	if len(value) != len(longValue) {
		t.Errorf("Expected value length %d, got %d", len(longValue), len(value))
	}
}

func TestMetadataSpecialCharactersIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Test special characters
	specialValue := "test'value\"with\nnewlines\tand\ttabs"
	err := db.SetMetadata(ctx, "special", specialValue)
	if err != nil {
		t.Fatalf("SetMetadata with special chars failed: %v", err)
	}

	value, err := db.GetMetadata(ctx, "special")
	if err != nil {
		t.Fatalf("GetMetadata failed: %v", err)
	}

	if value != specialValue {
		t.Errorf("Special characters not preserved correctly")
	}
}

func TestMetadataConcurrencyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Set/get metadata concurrently
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(id int) {
			key := "concurrent" + string(rune('0'+id))
			value := "value" + string(rune('0'+id))
			_ = db.SetMetadata(ctx, key, value)
			_, _ = db.GetMetadata(ctx, key)
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify all keys were set correctly
	for i := 0; i < 10; i++ {
		key := "concurrent" + string(rune('0'+i))
		expectedValue := "value" + string(rune('0'+i))
		value, err := db.GetMetadata(ctx, key)
		if err != nil {
			t.Errorf("GetMetadata failed for %s: %v", key, err)
		}
		if value != expectedValue {
			t.Errorf("Expected %s=%s, got %s", key, expectedValue, value)
		}
	}
}

// TestGetLastThumbnailRunNoValue tests GetLastThumbnailRun when no value has been set.
func TestGetLastThumbnailRunNoValue(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Should return zero time, no error when key doesn't exist
	ts, err := db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun on empty DB failed: %v", err)
	}
	if !ts.IsZero() {
		t.Errorf("Expected zero time, got %v", ts)
	}
}

// TestSetAndGetLastThumbnailRun tests round-trip of SetLastThumbnailRun / GetLastThumbnailRun.
func TestSetAndGetLastThumbnailRun(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Set a specific time
	now := time.Now().Truncate(time.Second) // RFC3339 has second precision
	if err := db.SetLastThumbnailRun(ctx, now); err != nil {
		t.Fatalf("SetLastThumbnailRun failed: %v", err)
	}

	// Get returns matching time
	ts, err := db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun failed: %v", err)
	}
	if !ts.Equal(now) {
		t.Errorf("Expected time %v, got %v", now, ts)
	}

	// Set zero time — should store empty value
	if err := db.SetLastThumbnailRun(ctx, time.Time{}); err != nil {
		t.Fatalf("SetLastThumbnailRun with zero time failed: %v", err)
	}

	ts2, err := db.GetLastThumbnailRun(ctx)
	if err != nil {
		t.Fatalf("GetLastThumbnailRun after zero time set failed: %v", err)
	}
	if !ts2.IsZero() {
		t.Errorf("Expected zero time after clearing, got %v", ts2)
	}
}

func TestGetLastExifTagRunNoValueIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Fetching when no value exists should return zero time, no error
	ts, err := db.GetLastExifTagRun(ctx)
	if err != nil {
		t.Fatalf("GetLastExifTagRun on empty DB failed: %v", err)
	}
	if !ts.IsZero() {
		t.Errorf("Expected zero time for missing key, got %v", ts)
	}
}

func TestSetAndGetLastExifTagRunIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	// Set a specific time (truncate to seconds — RFC3339 resolution)
	now := time.Now().Truncate(time.Second)
	if err := db.SetLastExifTagRun(ctx, now); err != nil {
		t.Fatalf("SetLastExifTagRun failed: %v", err)
	}

	ts, err := db.GetLastExifTagRun(ctx)
	if err != nil {
		t.Fatalf("GetLastExifTagRun failed: %v", err)
	}
	if !ts.Equal(now) {
		t.Errorf("Expected %v, got %v", now, ts)
	}

	// Overwrite with a later time
	later := now.Add(2 * time.Hour)
	if err := db.SetLastExifTagRun(ctx, later); err != nil {
		t.Fatalf("SetLastExifTagRun (update) failed: %v", err)
	}

	ts2, err := db.GetLastExifTagRun(ctx)
	if err != nil {
		t.Fatalf("GetLastExifTagRun after update failed: %v", err)
	}
	if !ts2.Equal(later) {
		t.Errorf("After update: expected %v, got %v", later, ts2)
	}

	// Clear with zero time
	if err := db.SetLastExifTagRun(ctx, time.Time{}); err != nil {
		t.Fatalf("SetLastExifTagRun with zero time failed: %v", err)
	}

	ts3, err := db.GetLastExifTagRun(ctx)
	if err != nil {
		t.Fatalf("GetLastExifTagRun after zero-time set failed: %v", err)
	}
	if !ts3.IsZero() {
		t.Errorf("Expected zero time after clearing, got %v", ts3)
	}
}

func TestExifTagRunIsolatedFromThumbnailRunIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}
	db, _ := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	thumbTime := time.Now().Truncate(time.Second)
	exifTime := thumbTime.Add(90 * time.Minute)

	if err := db.SetLastThumbnailRun(ctx, thumbTime); err != nil {
		t.Fatalf("SetLastThumbnailRun failed: %v", err)
	}
	if err := db.SetLastExifTagRun(ctx, exifTime); err != nil {
		t.Fatalf("SetLastExifTagRun failed: %v", err)
	}

	gotThumb, err := db.GetLastThumbnailRun(ctx)
	if err != nil || !gotThumb.Equal(thumbTime) {
		t.Errorf("Thumbnail run time contaminated by exif run: got %v, err %v", gotThumb, err)
	}

	gotExif, err := db.GetLastExifTagRun(ctx)
	if err != nil || !gotExif.Equal(exifTime) {
		t.Errorf("Exif run time wrong: got %v, err %v", gotExif, err)
	}
}
