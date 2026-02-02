// Package transcoder provides video transcoding capabilities for browser-compatible playback.
//
// The transcoder handles on-the-fly video conversion using FFmpeg, enabling playback of
// video formats that may not be natively supported by web browsers. It supports streaming
// transcoded content directly to clients without requiring full file conversion upfront.
//
// # Features
//
//   - Automatic codec detection to determine if transcoding is needed
//   - On-the-fly transcoding with FFmpeg for incompatible formats
//   - Direct streaming for browser-compatible videos (H.264, VP8, VP9, AV1)
//   - Resolution scaling support for adaptive quality
//   - Timeout-protected streaming to handle client disconnections gracefully
//   - Cache management for transcoded video files
//
// # Supported Formats
//
// The following codecs are considered browser-compatible and will be streamed directly:
//   - H.264 (most common)
//   - VP8
//   - VP9
//   - AV1
//
// The following containers are supported for direct playback:
//   - MP4
//   - WebM
//   - OGG
//
// Videos using other codecs or containers will be transcoded to H.264/AAC in an MP4
// container with fragmented streaming support.
//
// # Usage
//
// Create a new transcoder instance with a cache directory:
//
//	trans := transcoder.New("/path/to/cache", true)
//
// Check if a video needs transcoding:
//
//	info, err := trans.GetVideoInfo(ctx, "/path/to/video.mkv")
//	if info.NeedsTranscode {
//	    // Video will be transcoded when streamed
//	}
//
// Stream a video (transcoding automatically if needed):
//
//	err := trans.StreamVideo(ctx, "/path/to/video.mkv", responseWriter, 0)
//
// Clear the transcode cache:
//
//	freedBytes, err := trans.ClearCache()
//
// # Configuration
//
// The transcoder can be disabled by passing false as the enabled parameter to New().
// When disabled, only browser-compatible videos will play; incompatible formats will
// return an error.
//
// # FFmpeg Requirements
//
// This package requires FFmpeg and FFprobe to be installed and available in the
// system PATH. The following FFmpeg features are used:
//   - libx264 encoder for H.264 video
//   - AAC encoder for audio
//   - Fragmented MP4 output for streaming
//
// # Graceful Shutdown
//
// Call Cleanup() during application shutdown to terminate any active transcoding
// processes:
//
//	trans.Cleanup()
package transcoder
