# Sample Media for Development

The `sample-media` directory provides test content for development and testing of the media viewer application.

## Overview

Sample media files are used to:

- **Test Features**: Validate gallery browsing, thumbnails, search, tags, and favorites
- **Performance Testing**: Measure indexing and rendering performance with realistic datasets
- **UI Development**: Develop and refine the user interface with actual content
- **Integration Testing**: Test video transcoding, thumbnail generation, and file handling

## Directory Structure

```
sample-media/
├── *.jpg, *.png          # Sample images
├── *.mp4, *.mov, *.webm  # Sample videos
├── folder/               # Nested directory examples
└── New folder/           # Test various folder naming patterns
```

The application automatically indexes all media files recursively within the `sample-media` directory.

## Downloading Sample Media

A convenience script is provided to download free, open-source, royalty-free sample media:

```bash
make download-sample-media
```

Or run directly:

```bash
./hack/download-sample-media.sh
```

### What Gets Downloaded

By default, the script downloads:

- **250 images** from Unsplash Source and Picsum (random, diverse content)
- **16+ videos** from Google's sample video collection and other free sources

All content is:

- ✅ **Free to use** - No licensing restrictions
- ✅ **Royalty-free** - No attribution required
- ✅ **Open source** - From public domain or creative commons sources

### Customizing Downloads

You can customize the number of files downloaded:

```bash
# Download more images
NUM_IMAGES=500 ./hack/download-sample-media.sh

# Download fewer videos
NUM_VIDEOS=10 ./hack/download-sample-media.sh

# Combine options
NUM_IMAGES=300 NUM_VIDEOS=25 ./hack/download-sample-media.sh
```

### Using Pexels API (Optional)

For additional video content, you can use the [Pexels API](https://www.pexels.com/api/) (free tier available):

1. Sign up at [pexels.com/api](https://www.pexels.com/api/)
2. Get your API key
3. Run with the API key:

```bash
PEXELS_API_KEY='your-api-key' ./hack/download-sample-media.sh
```

This enables downloading additional high-quality stock videos beyond the default sources.

## Script Behavior

The download script:

- **Preserves existing files**: Already downloaded files are skipped (no re-downloading)
- **Creates directory**: Automatically creates `sample-media/` if it doesn't exist
- **Random content**: Uses randomization to get diverse images on each run
- **Progress indicators**: Shows download progress with ✅/❌ status for each file
- **Rate limiting**: Includes delays between requests to be respectful to free APIs

## Sample Media Sources

### Images

- **[Picsum Photos](https://picsum.photos/)** - Lorem Ipsum for photos, free placeholder images
- **[Unsplash Source](https://source.unsplash.com/)** - Random photos from Unsplash's API

### Videos

- **[Google Sample Videos](https://goo.gle/sample-videos)** - High-quality creative commons videos
    - Big Buck Bunny
    - Sintel
    - Tears of Steel
    - ElephantsDream
    - Various short test clips
- **[Pexels Videos](https://www.pexels.com/videos/)** - Stock video library (requires API key)

## Manual Downloads

If you prefer to add your own media:

1. Place image/video files directly in `sample-media/`
2. Create subdirectories for organizational testing
3. Supported formats:
    - **Images**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`
    - **Videos**: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`

The indexer will automatically discover new files on the next scan cycle.

## Testing Different Scenarios

### Large Collections

Test performance with large media libraries:

```bash
# Download a large collection
NUM_IMAGES=1000 NUM_VIDEOS=50 ./hack/download-sample-media.sh
```

### Nested Directories

Create nested folder structures to test recursive indexing:

```bash
cd sample-media
mkdir -p nature/landscapes nature/animals cities/urban cities/architecture
# Move files into subdirectories for organization testing
```

### Special Characters

Test handling of various filename patterns:

- Spaces: `My Vacation Photo.jpg`
- Unicode: `日本の写真.jpg`, `Café☕.jpg`
- Special chars: `photo-2024_01.jpg`, `video (1080p).mp4`

## Cleaning Up

To start fresh:

```bash
# Remove all downloaded sample media
rm -rf sample-media/*

# Keep specific files/folders
rm sample-media/unsplash_*.jpg
rm sample-media/picsum_*.jpg
rm sample-media/sample_video_*.mp4
```

## CI/CD Integration

The sample media directory is typically excluded from version control (via `.gitignore`) since media files are large and can be regenerated.

For CI/CD pipelines that need sample data:

```yaml
- name: Download sample media
  run: |
      NUM_IMAGES=50 NUM_VIDEOS=5 ./hack/download-sample-media.sh
```

This provides a small test dataset for automated testing without bloating the repository.

## Troubleshooting

### Download Failures

If downloads fail:

1. **Check internet connection**: Ensure you can reach external APIs
2. **Check rate limits**: Wait a few minutes and retry
3. **Manual retry**: Delete failed files and re-run (script skips existing files)
4. **Try fewer files**: Reduce `NUM_IMAGES` or `NUM_VIDEOS`

### Disk Space

The default download (~250 images + 16 videos) requires approximately:

- **Images**: ~50-150 MB (varies by resolution)
- **Videos**: ~100-500 MB (depends on video quality/length)
- **Total**: ~200-650 MB

Ensure adequate disk space before downloading large collections.

### Indexing Performance

If indexing is slow with large collections:

1. Adjust `INDEX_INTERVAL` environment variable
2. Check system resources (CPU, disk I/O)
3. Consider reducing collection size for development
4. Use SSD storage for better performance

## Best Practices

- **Start small**: Begin with the default 250 images for development
- **Test incrementally**: Add more content as needed for specific testing
- **Clean periodically**: Remove unused sample files to save disk space
- **Document custom datasets**: If using specialized test media, document the purpose
- **Respect APIs**: Don't abuse free APIs with excessive requests

## Related Documentation

- [Architecture Overview](architecture.md) - How indexing and caching work
- [Testing Guide](testing.md) - Using sample media in tests
- [Contributing Guide](contributing.md) - Development workflow best practices
