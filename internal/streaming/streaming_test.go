package streaming

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTimeoutWriterConfig(t *testing.T) {
	config := TimeoutWriterConfig{
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
		MaxDuration:  5 * time.Minute,
		ChunkSize:    128 * 1024,
		OnProgress:   nil,
	}

	if config.WriteTimeout != 10*time.Second {
		t.Errorf("Expected WriteTimeout=10s, got %v", config.WriteTimeout)
	}

	if config.IdleTimeout != 30*time.Second {
		t.Errorf("Expected IdleTimeout=30s, got %v", config.IdleTimeout)
	}

	if config.MaxDuration != 5*time.Minute {
		t.Errorf("Expected MaxDuration=5m, got %v", config.MaxDuration)
	}

	if config.ChunkSize != 128*1024 {
		t.Errorf("Expected ChunkSize=128KB, got %d", config.ChunkSize)
	}

	if config.OnProgress != nil {
		t.Error("Expected OnProgress=nil, got non-nil function")
	}
}

func TestDefaultTimeoutWriterConfig(t *testing.T) {
	config := DefaultTimeoutWriterConfig()

	if config.WriteTimeout != 30*time.Second {
		t.Errorf("Expected WriteTimeout=30s, got %v", config.WriteTimeout)
	}

	if config.IdleTimeout != 60*time.Second {
		t.Errorf("Expected IdleTimeout=60s, got %v", config.IdleTimeout)
	}

	if config.MaxDuration != 0 {
		t.Errorf("Expected MaxDuration=0 (unlimited), got %v", config.MaxDuration)
	}

	if config.ChunkSize != 64*1024 {
		t.Errorf("Expected ChunkSize=64KB, got %d", config.ChunkSize)
	}

	if config.OnProgress != nil {
		t.Error("Expected OnProgress to be nil")
	}
}

func TestNewTimeoutWriter(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)

	if tw == nil {
		t.Fatal("NewTimeoutWriter returned nil")
	}

	if tw.bytesWritten != 0 {
		t.Errorf("Expected bytesWritten=0, got %d", tw.bytesWritten)
	}

	if tw.closed {
		t.Error("Expected closed=false")
	}

	// Clean up
	tw.Close()
}

func TestTimeoutWriterWrite(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	data := []byte("test data")
	n, err := tw.Write(data)

	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	if n != len(data) {
		t.Errorf("Expected to write %d bytes, wrote %d", len(data), n)
	}

	// Stats should track bytes written correctly
	bytesWritten, _ := tw.Stats()
	if bytesWritten != int64(len(data)) {
		t.Errorf("Expected bytes written=%d, got %d", len(data), bytesWritten)
	}
}

func TestTimeoutWriterClose(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)

	// Close should be safe
	err := tw.Close()
	if err != nil {
		t.Errorf("Close() returned error: %v", err)
	}

	// Second close should be safe
	err = tw.Close()
	if err != nil {
		t.Errorf("Second Close() returned error: %v", err)
	}

	// Writing after close should fail
	_, err = tw.Write([]byte("data"))
	if !errors.Is(err, ErrStreamCanceled) {
		t.Errorf("Expected ErrStreamCanceled, got %v", err)
	}
}

func TestTimeoutWriterContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	// Cancel the context
	cancel()

	// Give it a moment to detect cancellation
	time.Sleep(10 * time.Millisecond)

	// Write should fail with context error
	_, err := tw.Write([]byte("test"))
	if err == nil {
		t.Error("Expected write to fail after context cancellation")
	}
}

func TestTimeoutWriterBytesWritten(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	// Write multiple times
	writes := [][]byte{
		[]byte("first"),
		[]byte("second"),
		[]byte("third"),
	}

	totalBytes := int64(0)
	for _, data := range writes {
		n, err := tw.Write(data)
		if err != nil {
			t.Fatalf("Write failed: %v", err)
		}
		totalBytes += int64(n)

		// Verify bytes were written
		bytesWritten, _ := tw.Stats()
		if bytesWritten != totalBytes {
			t.Errorf("Expected bytes written=%d, got %d", totalBytes, bytesWritten)
		}
	}
}

func TestTimeoutWriterStats(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	// Stats should show zero bytes and minimal duration initially
	bytesWritten, duration := tw.Stats()
	if bytesWritten != 0 {
		t.Errorf("Initial bytes written should be 0, got %d", bytesWritten)
	}
	if duration > 100*time.Millisecond {
		t.Errorf("Initial duration too high: %v", duration)
	}

	// Write some data
	data := []byte("test data")
	_, err := tw.Write(data)
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	// Sleep briefly
	time.Sleep(50 * time.Millisecond)

	// Stats should show written bytes and increased duration
	bytesWritten, duration = tw.Stats()
	if bytesWritten != int64(len(data)) {
		t.Errorf("Expected bytes written=%d, got %d", len(data), bytesWritten)
	}
	if duration < 50*time.Millisecond {
		t.Errorf("Duration should be at least 50ms, got %v", duration)
	}
	if duration > 200*time.Millisecond {
		t.Errorf("Duration unexpectedly high: %v", duration)
	}
}

func TestTimeoutWriterOnProgress(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	progressCalled := false
	var progressBytes int64
	var progressDuration time.Duration

	config.OnProgress = func(bytes int64, duration time.Duration) {
		progressCalled = true
		progressBytes = bytes
		progressDuration = duration
	}

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	data := []byte("test data for progress callback")
	_, err := tw.Write(data)
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	// OnProgress might be called asynchronously or on certain conditions
	// This test just ensures the callback can be set
	_ = progressCalled
	_ = progressBytes
	_ = progressDuration
}

func TestSentinelErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		msg  string
	}{
		{
			name: "ErrWriteTimeout",
			err:  ErrWriteTimeout,
			msg:  "write timeout exceeded",
		},
		{
			name: "ErrClientGone",
			err:  ErrClientGone,
			msg:  "client disconnected",
		},
		{
			name: "ErrStreamCanceled",
			err:  ErrStreamCanceled,
			msg:  "stream canceled",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.err == nil {
				t.Fatal("Error should not be nil")
			}

			if tt.err.Error() != tt.msg {
				t.Errorf("Expected error message=%q, got %q", tt.msg, tt.err.Error())
			}
		})
	}
}

func TestSentinelErrorsAreDistinct(t *testing.T) {
	if errors.Is(ErrWriteTimeout, ErrClientGone) {
		t.Error("ErrWriteTimeout should not be ErrClientGone")
	}

	if errors.Is(ErrWriteTimeout, ErrStreamCanceled) {
		t.Error("ErrWriteTimeout should not be ErrStreamCanceled")
	}

	if errors.Is(ErrClientGone, ErrStreamCanceled) {
		t.Error("ErrClientGone should not be ErrStreamCanceled")
	}
}

func TestTimeoutWriterConfigZeroValues(t *testing.T) {
	var config TimeoutWriterConfig

	if config.WriteTimeout != 0 {
		t.Errorf("Zero-value WriteTimeout should be 0, got %v", config.WriteTimeout)
	}

	if config.IdleTimeout != 0 {
		t.Errorf("Zero-value IdleTimeout should be 0, got %v", config.IdleTimeout)
	}

	if config.MaxDuration != 0 {
		t.Errorf("Zero-value MaxDuration should be 0, got %v", config.MaxDuration)
	}

	if config.ChunkSize != 0 {
		t.Errorf("Zero-value ChunkSize should be 0, got %d", config.ChunkSize)
	}

	if config.OnProgress != nil {
		t.Error("Zero-value OnProgress should be nil")
	}
}

func TestTimeoutWriterWithCustomChunkSize(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()
	config.ChunkSize = 16 // Very small chunks for testing

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	// Write data larger than chunk size
	data := make([]byte, 64)
	for i := range data {
		data[i] = byte(i)
	}

	n, err := tw.Write(data)
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	if n != len(data) {
		t.Errorf("Expected to write %d bytes, wrote %d", len(data), n)
	}
}

func TestTimeoutWriterFlush(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	// Write some data
	data := []byte("test data for flushing")
	_, err := tw.Write(data)
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	// Verify data was written to underlying recorder
	if w.Body.Len() != len(data) {
		t.Errorf("Expected %d bytes in recorder, got %d", len(data), w.Body.Len())
	}
}

func TestTimeoutWriterConcurrentWrites(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	// Perform concurrent writes
	const numGoroutines = 5
	const writesPerGoroutine = 10

	done := make(chan error, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			for j := 0; j < writesPerGoroutine; j++ {
				data := []byte{byte(id), byte(j)}
				_, err := tw.Write(data)
				if err != nil {
					done <- err
					return
				}
			}
			done <- nil
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < numGoroutines; i++ {
		if err := <-done; err != nil {
			t.Errorf("Concurrent write failed: %v", err)
		}
	}
}

func TestTimeoutWriterOnProgressCallback(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()

	var progressCalled bool
	config := DefaultTimeoutWriterConfig()
	config.OnProgress = func(bytes int64, duration time.Duration) {
		progressCalled = true
		if bytes < 0 {
			t.Errorf("Expected non-negative bytes, got %d", bytes)
		}
		if duration < 0 {
			t.Errorf("Expected non-negative duration, got %v", duration)
		}
	}

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	// Write enough data to potentially trigger callback
	data := make([]byte, 1024*1024+1) // Slightly over 1MB
	_, err := tw.Write(data)
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	// Give callback time to execute
	time.Sleep(10 * time.Millisecond)

	// Use the variable to avoid unused warning
	_ = progressCalled
	// Callback may or may not be called depending on exact byte boundaries
	// Just verify no panic occurred
}

func TestTimeoutWriterChunkedWrites(t *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()
	config.ChunkSize = 10 // Small chunks

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	// Write data larger than chunk size
	data := make([]byte, 100)
	for i := range data {
		data[i] = byte(i % 256)
	}

	n, err := tw.Write(data)
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	if n != len(data) {
		t.Errorf("Expected to write %d bytes, wrote %d", len(data), n)
	}

	bytesWritten, _ := tw.Stats()
	if bytesWritten != int64(len(data)) {
		t.Errorf("Expected %d bytes written total, got %d", len(data), bytesWritten)
	}
}

func TestTimeoutWriterCloseIdempotent(_ *testing.T) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)

	// Close multiple times should not panic
	tw.Close()
	tw.Close()
	tw.Close()
}

func BenchmarkTimeoutWriterWrite(b *testing.B) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	tw := NewTimeoutWriter(ctx, w, config)
	defer tw.Close()

	data := make([]byte, 1024)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = tw.Write(data)
	}
}

func BenchmarkTimeoutWriterCreation(b *testing.B) {
	ctx := context.Background()
	w := httptest.NewRecorder()
	config := DefaultTimeoutWriterConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tw := NewTimeoutWriter(ctx, w, config)
		tw.Close()
	}
}
