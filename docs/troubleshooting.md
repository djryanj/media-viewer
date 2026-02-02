# Troubleshooting

Solutions to common issues with Media Viewer.

## Login Issues

### Cannot Log In

**Symptoms:** Password is rejected even though it's correct.

**Solutions:**

1. Check that the `PASSWORD` environment variable is set correctly
2. Ensure there are no extra spaces or quotes in the password
3. Passwords are case-sensitive
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

### High Memory Usage

**Symptoms:** Server uses excessive memory.

**Solutions:**

1. Very large libraries require more memory for indexing
2. Set memory limits in Docker configuration
3. Restart the container to clear memory

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
2. Verify the `PASSWORD` environment variable is set
3. Ensure ports aren't already in use
4. Check volume mount paths exist

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
