#!/usr/bin/env bash
# Tests for hack/generate-sample-media.sh.
#
# The generator must produce a varied, valid, deterministic library without
# touching the network (CI used to depend on picsum.photos and Google's sample
# bucket, both of which broke). Run: make test-sample-media

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR="$SCRIPT_DIR/generate-sample-media.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=0
fail() {
    echo "FAIL: $*" >&2
    failures=$((failures + 1))
}
pass() { echo "ok:   $*"; }
check() { # check <description> <command...>
    local desc=$1
    shift
    if "$@"; then pass "$desc"; else fail "$desc"; fi
}

# Any attempt to reach the network fails loudly and is recorded.
mkdir -p "$WORK/bin"
for tool in curl wget; do
    cat >"$WORK/bin/$tool" <<EOF
#!/bin/sh
echo "$tool \$*" >> "$WORK/network-calls"
exit 6
EOF
    chmod +x "$WORK/bin/$tool"
done

generate() { # generate <dir>
    PATH="$WORK/bin:$PATH" MEDIA_DIR="$1" NUM_IMAGES=30 NUM_VIDEOS=11 \
        bash "$GENERATOR" >"$1.log" 2>&1
}

probe() { # probe <file> <entries>  -> csv of the first video stream
    ffprobe -v error -select_streams v:0 -show_entries "stream=$2" \
        -of csv=p=0 "$1" 2>/dev/null | head -1
}

dims() { probe "$1" width,height; }

dir_a="$WORK/a"
dir_b="$WORK/b"

if [ ! -f "$GENERATOR" ]; then
    fail "generator exists at $GENERATOR"
    exit 1
fi

generate "$dir_a"
check "generator exits successfully" test -d "$dir_a"
check "generator made no network calls" test ! -e "$WORK/network-calls"

# ── Images ────────────────────────────────────────────────────────────────────
mapfile -t images < <(find "$dir_a" -maxdepth 1 -type f -name 'sample_image_*' | sort)
check "generated 30 images (got ${#images[@]})" test "${#images[@]}" -eq 30

invalid=0
declare -A distinct_dims=()
max_w=0
min_side=999999
has_panorama=false
has_tall=false
for f in "${images[@]}"; do
    d=$(dims "$f")
    if [ -z "$d" ]; then
        invalid=$((invalid + 1))
        echo "  not decodable: $f" >&2
        continue
    fi
    w=${d%,*}
    h=${d#*,}
    distinct_dims["$d"]=1
    [ "$w" -gt "$max_w" ] && max_w=$w
    [ "$w" -lt "$min_side" ] && min_side=$w
    [ "$h" -lt "$min_side" ] && min_side=$h
    [ $((w / h)) -ge 5 ] && has_panorama=true
    [ $((h / w)) -ge 5 ] && has_tall=true
done
check "every image is decodable ($invalid invalid)" test "$invalid" -eq 0
check "images use many distinct dimensions (got ${#distinct_dims[@]})" test "${#distinct_dims[@]}" -ge 10
check "includes a large image >= 6000px wide (max $max_w)" test "$max_w" -ge 6000
check "includes a tiny image <= 64px (min $min_side)" test "$min_side" -le 64
check "includes a panorama (aspect >= 5:1)" $has_panorama
check "includes a tall image (aspect <= 1:5)" $has_tall

for ext in jpg png webp gif bmp tiff; do
    n=$(find "$dir_a" -maxdepth 1 -type f -name "sample_image_*.$ext" | wc -l)
    check "includes at least one .$ext image (got $n)" test "$n" -ge 1
done

# EXIF/autotagger fixtures address images 001-011 as JPEGs.
for i in $(seq 1 11); do
    check "sample_image_$(printf '%03d' "$i").jpg is a jpg tag fixture" \
        test -f "$dir_a/sample_image_$(printf '%03d' "$i").jpg"
done

# Not every image may look alike: content hashes must differ.
unique=$(md5sum "${images[@]}" | cut -d' ' -f1 | sort -u | wc -l)
check "images are all distinct content ($unique/30)" test "$unique" -eq 30

if command -v exiftool >/dev/null 2>&1; then
    check "sample_image_027.jpg carries EXIF orientation 6" \
        test "$(exiftool -n -s3 -Orientation "$dir_a/sample_image_027.jpg")" = "6"
fi

# ── Videos ────────────────────────────────────────────────────────────────────
declare -A video_dims=()
has_portrait=false
has_4k=false
has_silent=false
has_long=false
has_hfr=false
vinvalid=0
for i in $(seq 1 11); do
    f="$dir_a/sample_video_$(printf '%02d' "$i").mp4"
    if [ ! -f "$f" ]; then
        fail "sample_video_$(printf '%02d' "$i").mp4 exists"
        continue
    fi
    d=$(dims "$f")
    if [ -z "$d" ]; then
        vinvalid=$((vinvalid + 1))
        continue
    fi
    w=${d%,*}
    h=${d#*,}
    video_dims["$d"]=1
    [ "$h" -gt "$w" ] && has_portrait=true
    [ "$w" -ge 3840 ] && has_4k=true
    [ -z "$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$f")" ] && has_silent=true
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
    [ "${dur%.*}" -ge 60 ] && has_long=true
    fps=$(probe "$f" r_frame_rate)
    [ $((${fps%/*} / ${fps#*/})) -ge 50 ] && has_hfr=true
done
check "every sample_video_NN.mp4 is valid ($vinvalid invalid)" test "$vinvalid" -eq 0
check "videos use many distinct resolutions (got ${#video_dims[@]})" test "${#video_dims[@]}" -ge 7
check "includes a portrait video" $has_portrait
check "includes a 4K video" $has_4k
check "includes a video without an audio track" $has_silent
check "includes a long video (>= 60s)" $has_long
check "includes a high frame rate video (>= 50fps)" $has_hfr

for ext in webm mov avi mkv; do
    n=$(find "$dir_a" -maxdepth 1 -type f -name "*.$ext" | wc -l)
    check "includes a .$ext video (got $n)" test "$n" -ge 1
    for f in "$dir_a"/*."$ext"; do
        [ -f "$f" ] || continue
        check "$(basename "$f") is valid" test -n "$(dims "$f")"
    done
done

hevc=false
for f in "$dir_a"/*.mp4; do
    [ "$(probe "$f" codec_name)" = "hevc" ] && hevc=true
done
check "includes an HEVC video" $hevc

# ── Existing fixtures other tests depend on ──────────────────────────────────
check "folder1/ is populated" test -f "$dir_a/folder1/sample_image_001.jpg"
check "folder2/ is populated" test -f "$dir_a/folder2/sample_image_006.jpg"
check "sample playlist exists" test -f "$dir_a/sample-playlist.wpl"
check "transcode test video exists" test -f "$dir_a/sample_transcode_test.mkv"
check "special filename fixture exists" test -f "$dir_a/photo with spaces.jpg"

# ── Determinism: the same inputs produce the same library ────────────────────
generate "$dir_b"
listing() { (cd "$1" && find . -type f -name 'sample_*' | sort | while read -r f; do echo "$f $(dims "$f")"; done); }
check "second run produces identical names and dimensions" \
    test "$(listing "$dir_a")" = "$(listing "$dir_b")"

if [ "$failures" -gt 0 ]; then
    echo "$failures check(s) failed" >&2
    exit 1
fi
echo "all checks passed"
