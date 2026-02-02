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

### Viewing Cache Status

The stats bar at the bottom of the gallery shows library statistics, including when the library was last indexed.

### Clearing the Cache

To clear and rebuild all thumbnails:

1. Click the **clear cache** button (trash icon) in the header
2. Confirm the action
3. The page reloads and thumbnails regenerate in the background

This is useful when:

- Thumbnails appear corrupted
- You want to reclaim disk space and regenerate
- Source files have been modified

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
