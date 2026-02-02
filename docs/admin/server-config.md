# Server Configuration

This guide covers server-side configuration and deployment considerations for Media Viewer.

## Directory Structure

Media Viewer uses two primary directories:

### Media Directory

The read-only directory containing your media files.

- Default path: `/media`
- Configure with: `MEDIA_PATH` environment variable
- Mount as read-only for security: `-v /path/to/media:/media:ro`

Supported file types:

| Type      | Extensions                                               |
| --------- | -------------------------------------------------------- |
| Images    | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg` |
| Videos    | `.mp4`, `.webm`, `.mov`, `.avi`, `.mkv`, `.m4v`          |
| Playlists | `.playlist`                                              |

### Data Directory

Stores application data including the database and thumbnail cache.

- Default path: `/app/data`
- Configure with: `DATA_PATH` environment variable
- Must be writable
- Should be persisted between container restarts

Contents:

- `media.db` - SQLite database containing tags, favorites, and file index
- `thumbnails/` - Generated thumbnail cache

## Database

Media Viewer uses SQLite for data storage. The database is automatically created on first run.

### Database Contents

- File index (paths, sizes, modification dates)
- Tags and tag assignments
- Favorites
- Playlist metadata

### Database Location

The database file is stored at `{DATA_PATH}/media.db`.

### Backup

To backup your data:

```bash
# Stop the container first for consistency
docker stop media-viewer

# Copy the database
cp /path/to/data/media.db /path/to/backup/

# Restart
docker start media-viewer
```

## Indexing

Media Viewer automatically indexes your media library on startup and periodically thereafter.

### Initial Index

On first run, the application scans your entire media directory. This may take several minutes for large libraries.

### Incremental Updates

After the initial index, the application detects changes and updates the index accordingly.

### Manual Reindex

To force a complete reindex:

1. Stop the application
2. Delete the database file
3. Restart the application

## Resource Requirements

### Memory

- Base: ~100MB
- Add ~1MB per 10,000 indexed files
- Thumbnail generation temporarily increases memory usage

### Storage

- Database: ~1KB per indexed file
- Thumbnails: ~10-50KB per image/video

### CPU

- Thumbnail generation is CPU-intensive
- Consider limiting concurrent thumbnail generation for low-power systems

## Logging

Media Viewer logs to stdout, which Docker captures automatically.

### Viewing Logs

```bash
docker logs media-viewer
docker logs -f media-viewer  # Follow mode
```

### Log Levels

Logs include:

- Server startup and configuration
- Authentication events
- Indexing progress
- Errors and warnings

## Health Checks

The application provides a health endpoint for monitoring:

```
GET /health
```

Returns `200 OK` when the application is healthy.

### Docker Health Check

```yaml
healthcheck:
    test: ['CMD', 'curl', '-f', 'http://localhost:8080/health']
    interval: 30s
    timeout: 10s
    retries: 3
```
