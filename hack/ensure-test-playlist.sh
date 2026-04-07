#!/usr/bin/env bash

set -euo pipefail

MEDIA_DIR="${1:-${MEDIA_DIR:-}}"

if [ -z "$MEDIA_DIR" ]; then
    echo "Usage: $0 <media-dir>" >&2
    echo "Or set MEDIA_DIR in the environment." >&2
    exit 1
fi

mkdir -p "$MEDIA_DIR"

playlist_path="$MEDIA_DIR/sample-playlist.wpl"
video_candidates=(
    "sample_video_01.mp4"
    "sample_video_02.mp4"
    "sample_video_03.mp4"
    "sample_video_04.mp4"
)

available_videos=()
for candidate in "${video_candidates[@]}"; do
    if [ -f "$MEDIA_DIR/$candidate" ]; then
        available_videos+=("$candidate")
    fi
done

if [ "${#available_videos[@]}" -lt 2 ]; then
    echo "[ensure-test-playlist] Skipping playlist creation; need at least 2 sample videos in $MEDIA_DIR" >&2
    exit 0
fi

cat > "$playlist_path" <<EOF
<?wpl version="1.0"?>
<smil>
    <head>
        <title>Sample Playlist</title>
    </head>
    <body>
        <seq>
$(for video in "${available_videos[@]:0:3}"; do printf '            <media src="%s"/>\n' "$video"; done)
        </seq>
    </body>
</smil>
EOF

echo "[ensure-test-playlist] Ensured $playlist_path"
