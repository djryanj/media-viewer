# Thumbnail Management

Media Viewer generates thumbnails for images and videos to provide fast gallery browsing.

## How Thumbnails Work

### Generation

Thumbnails are generated:

- On-demand when an item is first viewed
- Incrementally in the background after media indexing
- Periodically via full scan (configurable with `THUMBNAIL_INTERVAL`)

### Storage

Thumbnails are stored in the cache directory:

```
{DATA_PATH}/thumbnails/
```

The thumbnail cache can grow significantly for large libraries. Plan storage accordingly.

### Caching

- Thumbnails are cached indefinitely until manually cleared
- Browser caching further improves performance
- The PWA caches thumbnails for offline access

## Cache Management

<div align="center">
  <img src="../../images/settings-tab-cache.png" alt="Settings Cache tab showing the Background Activity section with live cards for the indexer, thumbnails, auto-tagger, and transcode cache" width="700">
  <p><em>The System tab groups maintenance actions with live worker status.</em></p>
</div>

### Viewing Cache Status

The stats bar at the bottom of the gallery shows library totals, index freshness, version/build information, and a compact worker summary for the indexer, thumbnails, and auto-tagger.

For detailed maintenance visibility, open **Settings → System**. The **Background Activity** section expands that same status into live cards for the indexer, thumbnail generator, auto-tagger, and transcode cache utility.

### Rebuilding Thumbnails

To clear and rebuild all thumbnails:

1. Open **Settings** (⚙️ icon)
2. Go to the **Cache** tab
3. In **Background Activity**, use the **Thumbnails** card and click **Rebuild Thumbnails**
4. Confirm the action — thumbnails regenerate in the background

This is useful when:

- Thumbnails appear corrupted
- You want to reclaim disk space and regenerate
- Source files have been modified

### Clearing Transcoded Videos

To remove cached transcoded videos and free disk space:

1. Open **Settings** (⚙️ icon)
2. Go to the **Cache** tab
3. In **Background Activity**, use the **Transcode Cache** card and click **Clear Cache**
4. Confirm the action — Media Viewer reports the space freed after deletion

This is useful when:

- The transcode cache has grown larger than you want to keep
- You want stale transcodes to be recreated from the source files on next playback
- You need to reclaim storage without affecting original media files

Cleared transcodes are regenerated automatically the next time an affected video needs browser-compatible playback.

### Manual Cache Clearing

To manually clear the thumbnail cache:

```bash
# Stop the container
docker stop media-viewer

# Remove thumbnail directory
rm -rf /path/to/data/thumbnails

# Restart
docker start media-viewer
```

Thumbnails regenerate on-demand as items are viewed.

## Thumbnail Quality

### Images

Image thumbnails preserve aspect ratio and are optimized for gallery display.

### Videos

Video thumbnails are extracted from an early frame of the video. The exact frame may vary based on video encoding.

### Folders

Folder thumbnails show a preview of contents when available, or a folder icon otherwise.

## Performance Considerations

### Initial Load

First-time viewing of items requires thumbnail generation, which may cause brief delays. Subsequent views are instant.

### Background Generation

After clearing the cache, thumbnails regenerate in the background. You may notice:

- Brief loading indicators on items
- Gradual appearance of thumbnails
- Temporary increase in CPU usage

### Storage Space

Estimate thumbnail storage:

- ~10-50KB per image
- ~20-100KB per video
- Plan for 1-5% of your media library size

### Network Usage

Thumbnails are transferred to browsers on demand. For remote access over slow connections:

- Initial gallery load transfers visible thumbnails
- Scrolling loads additional thumbnails
- PWA installation caches thumbnails locally

## Troubleshooting

### Thumbnail Generation Failures

When thumbnails fail to generate, detailed error logs are written to help diagnose issues:

**Log Format:**

```
ERROR Thumbnail generation failed for /path/to/file.jpg (type: image): <error details>
```

**Common Failure Scenarios:**

- **Image decode failures**: Logs show which decode method failed (constrained load, imaging.Open, or FFmpeg fallback) with specific error details
- **FFmpeg errors**: Logs include FFmpeg stderr output for video/image processing failures
- **Encoding errors**: Logs specify whether PNG or JPEG encoding failed
- **Folder thumbnail components**: Individual file failures within folder thumbnails are logged as warnings

**Checking Logs:**

```bash
# View recent thumbnail errors
docker logs media-viewer 2>&1 | grep "Thumbnail.*failed"

# Follow thumbnail generation in real-time
docker logs -f media-viewer 2>&1 | grep -i thumbnail
```

**Resolution Steps:**

1. Check log output for specific file paths and error messages
2. Verify file permissions and integrity
3. For FFmpeg failures, check that FFmpeg is available and supports the file format
4. For large images, consider memory constraints and `MAX_IMAGE_DIMENSION` settings
5. Invalid or corrupted files may need repair or exclusion from the library

## Monitoring

Use [Prometheus metrics](metrics.md) to monitor thumbnail generation performance:

### Key Metrics

- **Cache Hit Rate**: `thumbnail_cache_hits_total` / (`thumbnail_cache_hits_total` + `thumbnail_cache_misses_total`)
- **Generation Duration**: `thumbnail_generation_duration_seconds` - P50/P95/P99 latencies by type
- **Memory Usage**: `thumbnail_memory_usage_bytes` - Memory allocated per thumbnail
- **Phase Timing**: `thumbnail_generation_duration_detailed_seconds` - Breakdown by decode/resize/encode/cache
- **Cache Size**: `thumbnail_cache_size_bytes` and `thumbnail_cache_count`
- **Error Rate**: `thumbnail_generations_total{status="error*"}` - Track different error types

### Performance Tuning

Monitor these metrics to optimize:

1. **Cache efficiency**: Low hit rate may indicate cache issues or high user activity
2. **Generation bottlenecks**: Compare phase timings to identify decode vs resize vs encode issues
3. **Memory pressure**: High memory usage per thumbnail may require tuning
4. **FFmpeg performance**: `thumbnail_ffmpeg_duration_seconds` tracks video/image decode time

See the [Metrics & Monitoring](metrics.md) guide for detailed queries and alerting examples.
