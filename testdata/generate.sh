#!/bin/bash
# Generate minimal test media files for integration testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Generating test media files..."

# Generate minimal 1-second MP4 video (320x240, ~3KB)
if command -v ffmpeg &> /dev/null; then
    echo "Creating test.mp4 with ffmpeg..."
    ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=1 \
           -f lavfi -i sine=frequency=1000:duration=1 \
           -pix_fmt yuv420p -c:v libx264 -preset ultrafast -crf 40 \
           -c:a aac -b:a 32k \
           -y test.mp4 2>/dev/null
    echo "✓ test.mp4 created ($(du -h test.mp4 | cut -f1))"
else
    echo "⚠ ffmpeg not found, skipping test.mp4"
fi

# Generate minimal 100x100 JPEG (red square, ~800 bytes)
if command -v ffmpeg &> /dev/null; then
    echo "Creating test.jpg with ffmpeg..."
    ffmpeg -f lavfi -i color=c=red:s=100x100:d=1 \
           -frames:v 1 -q:v 10 \
           -y test.jpg 2>/dev/null
    echo "✓ test.jpg created ($(du -h test.jpg | cut -f1))"
else
    echo "⚠ ffmpeg not found, skipping test.jpg"
fi

# Generate minimal 100x100 PNG (blue square, ~200 bytes)
if command -v ffmpeg &> /dev/null; then
    echo "Creating test.png with ffmpeg..."
    ffmpeg -f lavfi -i color=c=blue:s=100x100:d=1 \
           -frames:v 1 \
           -y test.png 2>/dev/null
    echo "✓ test.png created ($(du -h test.png | cut -f1))"
else
    echo "⚠ ffmpeg not found, skipping test.png"
fi

echo ""
echo "Test files generated in $(pwd)"
ls -lh test.* 2>/dev/null || echo "No test files created - ffmpeg not available"
