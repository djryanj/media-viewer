package streaming

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"media-viewer/internal/logging"
)

// Sentinel errors for streaming operations.
var (
	// ErrWriteTimeout indicates that a write operation exceeded the configured timeout.
	// This typically occurs when a client is receiving data too slowly.
	ErrWriteTimeout = errors.New("write timeout exceeded")

	// ErrClientGone indicates that the client disconnected before the stream completed.
	// This is detected via the request context being canceled.
	ErrClientGone = errors.New("client disconnected")

	// ErrStreamCancelled indicates that the stream was canceled programmatically,
	// either by calling Close() on the TimeoutWriter or via context cancellation.
	ErrStreamCanceled = errors.New("stream canceled")
)

// TimeoutWriterConfig configures the timeout writer behavior
type TimeoutWriterConfig struct {
	// WriteTimeout is the maximum time to wait for a single write operation
	WriteTimeout time.Duration
	// IdleTimeout is the maximum time between successful writes
	IdleTimeout time.Duration
	// MaxDuration is the absolute maximum streaming duration (0 = unlimited)
	MaxDuration time.Duration
	// ChunkSize is the size of chunks to write (0 = write as received)
	ChunkSize int
	// OnProgress is called periodically with bytes written
	OnProgress func(bytesWritten int64, duration time.Duration)
}

// DefaultTimeoutWriterConfig returns sensible defaults
func DefaultTimeoutWriterConfig() TimeoutWriterConfig {
	return TimeoutWriterConfig{
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
		MaxDuration:  0,         // Unlimited by default
		ChunkSize:    64 * 1024, // 64KB chunks
		OnProgress:   nil,
	}
}

// TimeoutWriter wraps an http.ResponseWriter with timeout protection
type TimeoutWriter struct {
	w            http.ResponseWriter
	ctx          context.Context
	cancel       context.CancelFunc
	config       TimeoutWriterConfig
	startTime    time.Time
	lastWrite    time.Time
	bytesWritten int64
	mu           sync.Mutex
	closed       bool
	flusher      http.Flusher
}

// NewTimeoutWriter creates a new timeout-protected writer
func NewTimeoutWriter(ctx context.Context, w http.ResponseWriter, config TimeoutWriterConfig) *TimeoutWriter {
	writerCtx, cancel := context.WithCancel(ctx)

	tw := &TimeoutWriter{
		w:         w,
		ctx:       writerCtx,
		cancel:    cancel,
		config:    config,
		startTime: time.Now(),
		lastWrite: time.Now(),
	}

	// Check if the underlying writer supports flushing
	if flusher, ok := w.(http.Flusher); ok {
		tw.flusher = flusher
	}

	// Start idle timeout checker
	go tw.idleChecker()

	return tw
}

// Write implements io.Writer with timeout protection
func (tw *TimeoutWriter) Write(p []byte) (n int, err error) {
	tw.mu.Lock()
	if tw.closed {
		tw.mu.Unlock()
		return 0, ErrStreamCanceled
	}
	tw.mu.Unlock()

	// Check context before writing
	select {
	case <-tw.ctx.Done():
		return 0, tw.contextError()
	default:
	}

	// Check max duration
	if tw.config.MaxDuration > 0 && time.Since(tw.startTime) > tw.config.MaxDuration {
		return 0, ErrWriteTimeout
	}

	// Write in chunks if configured
	if tw.config.ChunkSize > 0 && len(p) > tw.config.ChunkSize {
		return tw.writeChunked(p)
	}

	return tw.writeWithTimeout(p)
}

// writeChunked writes data in smaller chunks
func (tw *TimeoutWriter) writeChunked(p []byte) (int, error) {
	totalWritten := 0

	for len(p) > 0 {
		// Check context between chunks
		select {
		case <-tw.ctx.Done():
			return totalWritten, tw.contextError()
		default:
		}

		chunkSize := tw.config.ChunkSize
		if len(p) < chunkSize {
			chunkSize = len(p)
		}

		n, err := tw.writeWithTimeout(p[:chunkSize])
		totalWritten += n

		if err != nil {
			return totalWritten, err
		}

		p = p[chunkSize:]

		// Flush after each chunk for streaming
		if tw.flusher != nil {
			tw.flusher.Flush()
		}
	}

	return totalWritten, nil
}

// writeWithTimeout performs a single write with timeout
func (tw *TimeoutWriter) writeWithTimeout(p []byte) (int, error) {
	// Create a channel for the write result
	type writeResult struct {
		n   int
		err error
	}
	resultCh := make(chan writeResult, 1)

	// Perform write in goroutine
	go func() {
		n, err := tw.w.Write(p)
		resultCh <- writeResult{n, err}
	}()

	// Wait for write or timeout
	select {
	case result := <-resultCh:
		if result.err == nil {
			tw.mu.Lock()
			tw.lastWrite = time.Now()
			tw.bytesWritten += int64(result.n)
			bytesWritten := tw.bytesWritten
			tw.mu.Unlock()

			// Call progress callback if configured
			if tw.config.OnProgress != nil && bytesWritten%(1024*1024) < int64(len(p)) {
				tw.config.OnProgress(bytesWritten, time.Since(tw.startTime))
			}
		}
		return result.n, result.err

	case <-time.After(tw.config.WriteTimeout):
		tw.cancel()
		return 0, ErrWriteTimeout

	case <-tw.ctx.Done():
		return 0, tw.contextError()
	}
}

// idleChecker monitors for idle connections
func (tw *TimeoutWriter) idleChecker() {
	if tw.config.IdleTimeout <= 0 {
		return
	}

	ticker := time.NewTicker(tw.config.IdleTimeout / 4)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			tw.mu.Lock()
			idle := time.Since(tw.lastWrite)
			closed := tw.closed
			tw.mu.Unlock()

			if closed {
				return
			}

			if idle > tw.config.IdleTimeout {
				logging.Warn("Stream idle timeout exceeded: %v", idle)
				tw.cancel()
				return
			}

		case <-tw.ctx.Done():
			return
		}
	}
}

// contextError returns an appropriate error based on context state
func (tw *TimeoutWriter) contextError() error {
	if tw.ctx.Err() == context.Canceled {
		return ErrClientGone
	}
	return ErrStreamCanceled
}

// Close marks the writer as closed
func (tw *TimeoutWriter) Close() error {
	tw.mu.Lock()
	defer tw.mu.Unlock()

	if tw.closed {
		return nil
	}

	tw.closed = true
	tw.cancel()

	return nil
}

// Stats returns streaming statistics
func (tw *TimeoutWriter) Stats() (bytesWritten int64, duration time.Duration) {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	return tw.bytesWritten, time.Since(tw.startTime)
}

// StreamWithTimeout streams from a reader to an HTTP response with timeout protection
func StreamWithTimeout(ctx context.Context, w http.ResponseWriter, r io.Reader, config TimeoutWriterConfig) error {
	tw := NewTimeoutWriter(ctx, w, config)
	defer func() {
		if err := tw.Close(); err != nil {
			logging.Warn("Failed to close timeout writer: %v", err)
		}
	}()

	// Set headers for streaming
	w.Header().Set("Transfer-Encoding", "chunked")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	// Copy with our timeout writer
	_, err := io.Copy(tw, r)

	bytesWritten, duration := tw.Stats()
	logging.Debug("Stream completed: %d bytes in %v", bytesWritten, duration)

	return err
}
