// Package transcoder provides video transcoding capabilities using FFmpeg.
//
// It supports:
//   - On-the-fly video transcoding for browser compatibility
//   - Resolution scaling for bandwidth optimization
//   - Streaming transcoded output directly to HTTP responses
//   - Video metadata extraction (codec, resolution, duration)
//
// Transcoding is performed using FFmpeg and requires it to be installed
// and available in the system PATH.
package transcoder
