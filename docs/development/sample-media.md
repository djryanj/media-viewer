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

## Generating Sample Media

A script generates a varied synthetic library locally with `ffmpeg`. It needs no network access, so it behaves the same on a laptop, in the devcontainer and in CI, and it produces the same files every run.

```bash
make generate-sample-media
```

Or run directly:

```bash
./hack/generate-sample-media.sh
```

Requirements: `ffmpeg` and `ffprobe` (required) and `exiftool` (optional; used for the metadata fixtures).

### What Gets Generated

By default, the script generates (about 400 MB, around 40 seconds on a 16-core machine):

- **250 images** with deliberately varied properties:
    - sizes from 32×32 up to 10000×6000 (60 MP), including panoramas (10:1) and tall strips (1:10)
    - `.jpg`, `.png`, `.webp`, `.gif` (one animated), `.bmp` and `.tiff`
    - different content and colour (gradients, fractals, noise, cellular automata, test patterns)
    - EXIF orientation fixtures (`sample_image_027.jpg`, `sample_image_029.jpg`)
- **11 videos** (`sample_video_01.mp4` ... `sample_video_11.mp4`): portrait and landscape, 160×120 up to 4K, 1 second up to 2 minutes, 10 to 60 fps, with and without audio
- **5 videos in other codecs and containers**: HEVC `.mp4`, VP9 `.webm`, `.mov`, legacy MPEG-4 `.avi`, and an `.mkv` with two audio tracks. A transcode test video (`sample_transcode_test.mkv`) is also created.
- Nested folders, files with special characters in their names, a sample playlist, and embedded EXIF/XMP metadata for the auto-tagger tests

`sample_image_001.jpg` ... `sample_image_011.jpg` carry the auto-tagger fixtures and are always plain JPEGs. The first 30 images cover every extreme (large, tiny, panorama, tall, every format), so a small `NUM_IMAGES` still exercises them.

### Customizing

```bash
# More images
NUM_IMAGES=500 ./hack/generate-sample-media.sh

# Fewer videos (other-format variants are always generated unless NUM_VIDEOS=0)
NUM_VIDEOS=5 ./hack/generate-sample-media.sh

# Combine options, and limit parallelism
NUM_IMAGES=300 NUM_VIDEOS=25 GENERATE_JOBS=2 ./hack/generate-sample-media.sh
```

## Script Behavior

The generator:

- **Preserves existing files**: valid files are skipped, invalid ones are regenerated
- **Creates the directory**: `sample-media/` is created if it doesn't exist
- **Is deterministic**: file names, sizes and content depend only on the file's index
- **Runs in parallel**: one ffmpeg job per CPU (set `GENERATE_JOBS` to change)
- **Fails loudly**: it exits non-zero if any file can't be generated

To test the generator itself, run `make test-sample-media`.

## Adding Your Own Media

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
# Generate a large collection
NUM_IMAGES=1000 NUM_VIDEOS=50 ./hack/generate-sample-media.sh
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
# Remove all generated sample media
rm -rf sample-media/*

# Keep specific files/folders
rm sample-media/sample_image_*
rm sample-media/sample_video_*
```

## CI/CD Integration

The sample media directory is typically excluded from version control (via `.gitignore`) since media files are large and can be regenerated.

For CI/CD pipelines that need sample data:

```yaml
- name: Set up ffmpeg
  uses: FedericoCarboni/setup-ffmpeg@v3.1 # pin to a commit SHA in real workflows

- name: Generate sample media
  run: |
      NUM_IMAGES=50 NUM_VIDEOS=5 ./hack/generate-sample-media.sh
```

This provides a small test dataset for automated testing without bloating the repository.

## Troubleshooting

### Generation Failures

If generation fails:

1. **Check ffmpeg**: `ffmpeg -version` and `ffprobe -version` must both work
2. **Check codecs**: the script needs `libx264`, `libx265`, `libvpx-vp9`, `libopus` and `libwebp` (any standard ffmpeg build has them). Check with `ffmpeg -encoders`.
3. **Read the log**: failed files are reported as `[ERROR] Failed to generate ...`
4. **Retry**: delete failed files and re-run (valid files are skipped)
5. **Try fewer files**: reduce `NUM_IMAGES` or `NUM_VIDEOS`

### Disk Space

The default library requires approximately 400 MB (about 300 MB of images and 50 MB of videos, plus copies in the subfolders). Ensure adequate disk space before generating large collections.

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

## Related Documentation

- [Architecture Overview](architecture.md) - How indexing and caching work
- [Testing Guide](testing.md) - Using sample media in tests
- [Contributing Guide](contributing.md) - Development workflow best practices
