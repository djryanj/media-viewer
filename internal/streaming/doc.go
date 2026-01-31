/*
Package streaming provides timeout-protected streaming utilities for HTTP responses.

# Overview

This package addresses a common problem in HTTP servers: slow or disconnected clients
can hold server resources indefinitely when streaming large responses. The streaming
package wraps http.ResponseWriter with timeout protection, ensuring that stalled
connections are detected and terminated gracefully.

# Key Features

  - Per-write timeouts: Individual write operations are bounded by configurable timeouts
  - Idle detection: Connections with no data flow are terminated after an idle period
  - Chunked transfer: Large writes are automatically split into smaller chunks
  - Client disconnect detection: Leverages request context for early termination
  - Progress callbacks: Optional monitoring of streaming progress

# Basic Usage

The simplest way to use this package is with the StreamWithTimeout function:

	func (h *Handler) StreamVideo(w http.ResponseWriter, r *http.Request) {
		file, err := os.Open(videoPath)
		if err != nil {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}
		defer file.Close()

		config := streaming.DefaultTimeoutWriterConfig()
		err = streaming.StreamWithTimeout(r.Context(), w, file, config)
		if err != nil && err != streaming.ErrClientGone {
			log.Printf("Streaming error: %v", err)
		}
	}

# Advanced Usage

For more control, create a TimeoutWriter directly:

	func (h *Handler) StreamWithProgress(w http.ResponseWriter, r *http.Request) {
		config := streaming.DefaultTimeoutWriterConfig()
		config.WriteTimeout = 60 * time.Second
		config.ChunkSize = 128 * 1024 // 128KB chunks
		config.OnProgress = func(bytes int64, duration time.Duration) {
			log.Printf("Streamed %d bytes in %v", bytes, duration)
		}

		tw := streaming.NewTimeoutWriter(r.Context(), w, config)
		defer tw.Close()

		_, err := io.Copy(tw, dataSource)
		if err != nil {
			// Handle error
		}

		bytesWritten, duration := tw.Stats()
		log.Printf("Complete: %d bytes in %v", bytesWritten, duration)
	}

# Configuration

TimeoutWriterConfig controls the behavior of timeout-protected streaming:

	type TimeoutWriterConfig struct {
		// WriteTimeout is the maximum time for a single write operation.
		// If a write takes longer than this, the stream is terminated.
		// Default: 30 seconds
		WriteTimeout time.Duration

		// IdleTimeout is the maximum time between successful writes.
		// If no data flows for this duration, the stream is terminated.
		// Default: 60 seconds
		IdleTimeout time.Duration

		// MaxDuration is the absolute maximum streaming duration.
		// Set to 0 for unlimited duration.
		// Default: 0 (unlimited)
		MaxDuration time.Duration

		// ChunkSize splits large writes into smaller pieces.
		// This allows for more frequent timeout checks and better
		// responsiveness to cancellation. Set to 0 to disable chunking.
		// Default: 64KB
		ChunkSize int

		// OnProgress is called periodically with streaming statistics.
		// Useful for logging or metrics. May be nil.
		OnProgress func(bytesWritten int64, duration time.Duration)
	}

# Error Handling

The package defines several sentinel errors for specific conditions:

	var (
		// ErrWriteTimeout indicates a write operation exceeded WriteTimeout
		ErrWriteTimeout = errors.New("write timeout exceeded")

		// ErrClientGone indicates the client disconnected
		ErrClientGone = errors.New("client disconnected")

		// ErrStreamCanceled indicates the stream was canceled programmatically
		ErrStreamCanceled = errors.New("stream canceled")
	)

These errors can be checked using errors.Is:

	err := streaming.StreamWithTimeout(ctx, w, r, config)
	if errors.Is(err, streaming.ErrClientGone) {
		// Client disconnected, not a server error
		return
	}
	if errors.Is(err, streaming.ErrWriteTimeout) {
		// Client too slow, connection terminated
		log.Warn("Slow client terminated")
		return
	}

# Thread Safety

TimeoutWriter is safe for concurrent use from multiple goroutines, though typical
usage involves a single goroutine writing to the stream. The internal state is
protected by a mutex, and the idle checker runs in a separate goroutine.

# Integration with net/http

The TimeoutWriter is designed to work seamlessly with Go's net/http package.
It implements io.Writer and properly handles http.Flusher for streaming responses:

	// Streaming responses are automatically flushed after each chunk
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Transfer-Encoding", "chunked")
	streaming.StreamWithTimeout(ctx, w, videoFile, config)

# Performance Considerations

  - ChunkSize affects memory usage and responsiveness. Larger chunks are more
    efficient but less responsive to cancellation.
  - WriteTimeout should be generous enough for slow networks but short enough
    to detect stalled connections promptly.
  - The idle checker goroutine adds minimal overhead (one goroutine per stream).

# Container and Kubernetes Considerations

When running in containers with resource limits, streaming large files can
cause memory pressure. Use appropriate chunk sizes and consider implementing
backpressure if the data source produces data faster than clients consume it.
*/
package streaming
