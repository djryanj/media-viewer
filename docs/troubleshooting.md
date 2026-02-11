# Troubleshooting

Solutions to common issues with Media Viewer.

## Login Issues

### Cannot Log In

**Symptoms:** Password is rejected even though it's correct.

**Solutions:**

1. Verify you're entering the correct password (passwords are case-sensitive)
2. Try using the `resetpw` utility if you've forgotten your password
3. Check server logs for authentication errors
4. Try restarting the container

### Session Expires Quickly

**Symptoms:** Frequently logged out while actively using the application.

**Solutions:**

1. Increase `SESSION_DURATION` in your configuration
2. Check for network issues that might interrupt keepalive requests
3. Ensure your browser accepts cookies

## Display Issues

### Thumbnails Not Loading

**Symptoms:** Gallery shows placeholder icons instead of thumbnails.

**Solutions:**

1. Wait for thumbnail generation (first load takes time)
2. Check that the data directory is writable
3. Clear and rebuild thumbnails using the cache button
4. Check server logs for errors

### Gallery Is Empty

**Symptoms:** No items appear in the gallery.

**Solutions:**

1. Verify the media directory is mounted correctly
2. Check that media files have supported extensions
3. Verify file permissions allow reading
4. Check server logs for indexing errors

### Layout Issues on Mobile

**Symptoms:** Interface doesn't display correctly on mobile devices.

**Solutions:**

1. Ensure you're using a supported browser
2. Try clearing browser cache
3. Disable browser extensions that might interfere
4. Check if zoom is enabled and reset to 100%

## Performance Issues

### Slow Gallery Loading

**Symptoms:** Gallery takes a long time to load.

**Solutions:**

1. Large directories load slower; consider organizing into subfolders
2. Check network connection speed
3. Thumbnails generate on first view; subsequent loads are faster
4. Consider increasing server resources
5. Use [Prometheus metrics](admin/metrics.md) to identify bottlenecks

### High Memory Usage

**Symptoms:** Server uses excessive memory.

**Solutions:**

1. Very large libraries require more memory for thumbnail generation and steady state afterwards
2. Set memory limits in Docker configuration (`GOMEMLIMIT` environment variable)
3. Monitor memory metrics: `media_viewer_memory_usage_ratio` and `media_viewer_go_memalloc_bytes`
4. Restart the container to clear memory
5. See [Metrics & Monitoring](admin/metrics.md) for memory tuning guidance

### Slow Indexing

**Symptoms:** Media indexing takes a very long time, especially on NFS.

**Solutions:**

1. **Tune worker count**: Set `INDEX_WORKERS=3` (or lower) for NFS mounts - see [INDEX_WORKERS](admin/environment-variables.md#index_workers)
2. Monitor filesystem latency metrics: `media_viewer_filesystem_operation_duration_seconds`
3. Check NFS mount performance with `nfsstat` or `nfsiostat`
4. Review indexer metrics: `media_viewer_indexer_files_per_second` and `media_viewer_indexer_batch_duration_seconds`
5. For NFS, ensure `async` mount option is used for better performance
6. Consider local caching layer for metadata-heavy operations
7. See [Metrics & Monitoring](admin/metrics.md) for indexing performance analysis

### NFS Stale File Handle Errors

**Symptoms:** Errors in logs like "stale file handle" (ESTALE), "broken pipe", or application crashes when browsing rapidly on NFS.

**Background:** NFS can return stale file handle errors when files are modified, deleted, or the NFS connection is interrupted. Media Viewer automatically retries these operations.

**Automatic Retry:** Media Viewer includes built-in retry logic for NFS operations:

- File stat operations retry up to 3 times with exponential backoff (50ms → 500ms)
- File open operations use the same retry logic
- Only ESTALE errors trigger retries; other errors fail immediately
- Successful retries are logged: "NFS Stat succeeded on retry X for <path>"

**If you're still seeing ESTALE errors:**

1. **Reduce indexer workers**: Lower `INDEX_WORKERS` to 1-2 to reduce concurrent NFS operations
2. **Check NFS mount options**:
    ```bash
    # Recommended NFS mount options
    mount -t nfs -o rsize=131072,wsize=131072,hard,intr,async nfs-server:/path /media
    ```
3. **Check NFS server logs**: Look for server-side issues causing file handle invalidation
4. **Monitor NFS performance**: Use `nfsstat` or `nfsiostat` to check for saturation
5. **Verify network stability**: Check for packet loss or high latency
6. **Check server resources**: Ensure NFS server has adequate CPU and memory

**Understanding the retry metrics:**

Monitor these Prometheus metrics to see retry effectiveness:

- `media_viewer_filesystem_retry_attempts_total{operation="stat|open"}` - Number of retry attempts
- `media_viewer_filesystem_retry_success_total{operation="stat|open"}` - Successful retries (recovered from ESTALE)
- `media_viewer_filesystem_retry_failures_total{operation="stat|open"}` - Failed retries (exhausted all attempts)
- `media_viewer_filesystem_estale_errors_total{operation="stat|open"}` - Total ESTALE errors encountered
- `media_viewer_filesystem_retry_duration_seconds{operation="stat|open"}` - Operation duration including retries
- Look for INFO log messages: "NFS Stat succeeded on retry N" indicates recoverable errors
- ERROR log messages: "NFS Stat failed after N retries" indicates persistent issues

**Example PromQL queries:**

```promql
# Rate of retry attempts per second
rate(media_viewer_filesystem_retry_attempts_total[5m])

# Retry success rate
rate(media_viewer_filesystem_retry_success_total[5m]) / rate(media_viewer_filesystem_retry_attempts_total[5m])

# ESTALE error rate
rate(media_viewer_filesystem_estale_errors_total[5m])

# 99th percentile retry duration
histogram_quantile(0.99, rate(media_viewer_filesystem_retry_duration_seconds_bucket[5m]))
```

### Video Playback Issues

**Symptoms:** Videos don't play or buffer slowly.

**Solutions:**

1. Check that the video format is supported
2. Verify network bandwidth is sufficient
3. Large video files may buffer slowly on slow connections
4. Try a different browser

## Data Issues

### Tags Not Saving

**Symptoms:** Added tags disappear after refresh.

**Solutions:**

1. Check that the data directory is writable
2. Verify the database file isn't corrupted
3. Check server logs for database errors
4. Ensure sufficient disk space

### Favorites Not Persisting

**Symptoms:** Favorites disappear after restart.

**Solutions:**

1. Ensure the data volume is properly mounted
2. Check that the volume persists between container restarts
3. Verify database file permissions

### Search Not Finding Items

**Symptoms:** Search returns no results for items that exist.

**Solutions:**

1. Wait for indexing to complete after adding new files
2. Check the exact spelling (search is case-insensitive but exact)
3. For tag search, use the `tag:` prefix
4. Try rebuilding the index by restarting the server

## Installation Issues

### Container Won't Start

**Symptoms:** Docker container exits immediately.

**Solutions:**

1. Check logs: `docker logs media-viewer`
2. Ensure ports aren't already in use
3. Check volume mount paths exist
4. Verify all required directories are properly mounted

### Permission Denied Errors

**Symptoms:** Errors about file permissions in logs.

**Solutions:**

1. Check ownership of mounted directories
2. Ensure the container user can read media files
3. Ensure the container user can write to the data directory
4. On Linux, check SELinux or AppArmor policies

### Port Already in Use

**Symptoms:** Error binding to port 8080.

**Solutions:**

1. Change the port mapping: `-p 3000:8080`
2. Find and stop the conflicting service
3. Use `netstat` or `lsof` to identify what's using the port

## PWA Issues

### PWA Won't Install

**Symptoms:** No install option appears in browser.

**Solutions:**

1. PWA requires HTTPS (except localhost)
2. Clear browser cache and try again
3. Check browser compatibility
4. Ensure the manifest file loads correctly

### PWA Shows Old Content

**Symptoms:** Updates aren't reflected in the installed PWA.

**Solutions:**

1. Close and reopen the PWA
2. Clear PWA data in device settings
3. Uninstall and reinstall the PWA

## Getting Help

If these solutions don't resolve your issue:

1. Check the [GitHub Issues](https://github.com/djryanj/media-viewer/issues) for similar problems
2. Search closed issues for solutions
3. Open a new issue with:
    - Detailed description of the problem
    - Steps to reproduce
    - Server logs (if applicable)
    - Browser and device information
