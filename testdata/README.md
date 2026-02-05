# Test Data Files

This directory contains small media files used for integration testing.

## Files

- `test.jpg` - Small JPEG image for thumbnail generation tests
- `test.png` - Small PNG image for thumbnail generation tests
- `test.mp4` - Short MP4 video for video streaming tests

## Source

Files were generated using ffmpeg from the script `generate.sh` in this folder.

## Usage

Tests reference these files using:

```go
testdataPath := filepath.Join("..", "..", "testdata", "test.mp4")
```

Do not modify or remove these files as they are required for integration tests.
