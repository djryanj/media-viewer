#!/bin/bash
# Don't exit on errors - we want to continue generating even if some files fail
set +e

# Generate a varied, synthetic sample media library for development and CI.
#
# Everything is produced locally with ffmpeg (no network), so the library is
# identical on every run and CI no longer depends on third-party hosts.
# Content is deliberately varied so tests exercise more than one code path:
#
#   images: many dimensions (16px .. 10000px wide), panoramas and tall strips,
#           jpg / png / webp / gif (incl. animated) / bmp / tiff, differing
#           pixel content and colour
#   videos: portrait and landscape, 160x120 .. 4K, 1s .. 2min, 10 .. 60fps,
#           with and without audio, h264 / hevc / vp9 / mpeg4, in
#           mp4 / webm / mov / avi / mkv containers
#
# Environment:
#   MEDIA_DIR          target directory (default: ../sample-media)
#   NUM_IMAGES         number of images (default 250)
#   NUM_VIDEOS         number of sample_video_NN.mp4 files (default 11); the
#                      other-format videos are always generated when > 0
#   GENERATE_JOBS      parallel ffmpeg jobs (default: number of CPUs)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_DIR="${MEDIA_DIR:-${SCRIPT_DIR}/../sample-media}"
ENSURE_TEST_PLAYLIST_SCRIPT="${SCRIPT_DIR}/ensure-test-playlist.sh"

# Configuration
NUM_IMAGES=${NUM_IMAGES:-250}
NUM_VIDEOS=${NUM_VIDEOS:-11}
GENERATE_JOBS=${GENERATE_JOBS:-$(nproc 2>/dev/null || echo 2)}

# Path to the sample.wpl file (same directory as this script)
SAMPLE_WPL="${SCRIPT_DIR}/sample.wpl"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Sample Media Generator${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Target: $MEDIA_DIR"
echo "Images to generate: $NUM_IMAGES"
echo "Videos to generate: $NUM_VIDEOS (plus other-format variants)"
echo "Parallel jobs: $GENERATE_JOBS"
echo ""

if ! command -v ffmpeg &>/dev/null || ! command -v ffprobe &>/dev/null; then
    echo -e "${RED}[ERROR] ffmpeg and ffprobe are required to generate sample media${NC}"
    exit 1
fi

mkdir -p "$MEDIA_DIR" || {
    echo -e "${RED}[ERROR] Failed to create $MEDIA_DIR${NC}"
    exit 1
}

# Count existing files
existing_count=$(find "$MEDIA_DIR" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.mp4" -o -name "*.webm" -o -name "*.wpl" \) | wc -l)
echo -e "${GREEN}Existing files in sample-media: $existing_count (valid ones will be preserved)${NC}"
echo ""

FAIL_DIR="$(mktemp -d)"
trap 'rm -rf "$FAIL_DIR"' EXIT

# A media file is valid when ffprobe can read a video stream (images included).
validate_media() {
    local out
    out=$(ffprobe -v error -select_streams v:0 -show_entries stream=width \
        -of csv=p=0 "$1" 2>/dev/null)
    [ -n "$out" ]
}

# Run "$@" in the background, keeping at most GENERATE_JOBS in flight.
run_job() {
    while [ "$(jobs -rp | wc -l)" -ge "$GENERATE_JOBS" ]; do
        wait -n
    done
    "$@" &
}

# ============================================================
# Images
# ============================================================

# Profiles cycle every 30 images: "WIDTHxHEIGHT:extension[:animated]".
# Images 1-11 are plain jpgs: the auto-tagger fixtures embed metadata in
# sample_image_001..011.jpg. The extremes (large, panorama, tall, tiny) are all
# in the first cycle, so even a small NUM_IMAGES exercises them.
IMAGE_PROFILES=(
    1920x1080:jpg 1600x1200:jpg 1280x720:jpg 1080x1080:jpg 800x600:jpg
    2400x1600:jpg 1024x1536:jpg 1500x1000:jpg 3000x2000:jpg 1200x800:jpg
    2048x1365:jpg
    # 12-30: extremes and other formats
    8000x5333:jpg    # large (~43MP)
    8000x800:jpg     # panorama 10:1
    800x8000:jpg     # tall strip 1:10
    32x32:png        # tiny
    64x48:gif        # tiny gif
    48x64:webp       # tiny portrait webp
    4000x3000:png    # large png
    3840x2160:webp   # 4K webp
    1920x1080:bmp
    1024x768:tiff
    320x240:gif:animated
    500x500:png
    2560x1440:webp
    6000x4000:jpg    # large (24MP)
    1200x1200:png
    300x900:jpg      # narrow portrait (gets an EXIF rotation)
    10000x6000:jpg   # huge (60MP)
    200x200:jpg      # (gets an EXIF rotation)
    1600x900:png
)

# generate_image <index>
generate_image() {
    local idx=$1
    local name="sample_image_$(printf "%03d" "$idx")"
    local profile="${IMAGE_PROFILES[$(((idx - 1) % ${#IMAGE_PROFILES[@]}))]}"
    local size="${profile%%:*}"
    local rest="${profile#*:}"
    local ext="${rest%%:*}"
    local animated=false
    [[ "$rest" == *:animated ]] && animated=true

    local w=${size%x*}
    local h=${size#*x}

    # Later cycles reuse the profile table: shrink the very large images so a
    # big library stays quick to generate, and nudge ordinary sizes so repeats
    # are not identical.
    if [ "$idx" -gt "${#IMAGE_PROFILES[@]}" ]; then
        if [ "$w" -ge 6000 ] || [ $((w * h)) -ge 8000000 ]; then
            w=$((w / 3))
            h=$((h / 3))
        elif [ "$w" -gt 64 ] && [ "$w" -le 3000 ] && [ "$h" -gt 64 ] && [ "$h" -le 3000 ]; then
            w=$((w + (idx * 37) % 200))
            h=$((h + (idx * 53) % 160))
        fi
    fi
    # Even dimensions keep every encoder happy (e.g. yuv420p).
    w=$((w / 2 * 2))
    h=$((h / 2 * 2))
    [ "$w" -lt 2 ] && w=2
    [ "$h" -lt 2 ] && h=2

    local filepath="$MEDIA_DIR/$name.$ext"
    if [ -f "$filepath" ] && validate_media "$filepath"; then
        echo "  [SKIP] $name.$ext (already exists and valid)"
        return 0
    fi
    rm -f "$filepath"

    # Pick a content source. The costlier sources are only used on small
    # canvases; big and tiny images use cheap gradients. Only use sources that
# exist in older ffmpeg builds: CI's static build is 7.0.x and has no perlin.
    local pixels=$((w * h))
    local src
    local kind=$((idx % 7))
    if [ "$pixels" -gt 4000000 ] || [ "$w" -lt 64 ] || [ "$h" -lt 64 ]; then
        kind=0
    fi
    case $kind in
        0) src="gradients=s=${w}x${h}:seed=${idx}:n=$((3 + idx % 3)):speed=0.01" ;;
        1) src="mandelbrot=s=${w}x${h}:start_x=-0.74:start_y=0.$((idx % 9 + 1)):start_scale=0.0$((idx % 8 + 1)):end_scale=0.01" ;;
        2) src="sierpinski=s=${w}x${h}" ;;
        3) src="cellauto=s=${w}x${h}:seed=${idx}:rule=$((30 + idx % 60)):random_fill_ratio=0.2" ;;
        4) src="rgbtestsrc=s=${w}x${h}" ;;
        5) src="testsrc2=s=${w}x${h}" ;;
        *) src="life=s=${w}x${h}:seed=${idx}:mold=10:ratio=0.1:life_color=#00ff88:death_color=#bb2255" ;;
    esac

    # Shift hues so same-source images differ, and add grain to mid-size
    # images so they compress like photographs instead of flat gradients.
    # trim ends the endless lavfi stream after one frame: palettegen (gif) reads
    # its whole input before emitting anything.
    local vf="trim=end_frame=1,format=rgb24,hue=h=$(((idx * 47) % 360))"
    # (Not on big pngs: lossless grain would make them tens of megabytes.)
    local grain_limit=12000000
    [ "$ext" = "png" ] && grain_limit=2000000
    if [ "$pixels" -le "$grain_limit" ] && [ "$w" -ge 64 ] && [ "$h" -ge 64 ]; then
        vf="$vf,noise=alls=$((8 + idx % 20)):allf=t"
    fi

    local -a enc
    case $ext in
        jpg)
            if [ "$pixels" -gt 12000000 ]; then
                enc=(-q:v 2 -pix_fmt yuvj420p)
            else
                enc=(-q:v $((2 + idx % 5)) -pix_fmt yuvj420p)
            fi
            ;;
        png) enc=(-compression_level 3 -pix_fmt rgb24) ;;
        webp) enc=(-c:v libwebp -quality 70) ;;
        bmp) enc=(-pix_fmt bgr24) ;;
        tiff) enc=(-c:v tiff -pix_fmt rgb24) ;;
        gif)
            vf="$vf,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
            enc=()
            ;;
    esac

    local -a inopts=()
    if $animated; then
        # A short animated gif: ten frames of a zooming fractal.
        src="mandelbrot=s=${w}x${h}:start_scale=0.5:end_scale=0.05:start_x=-0.74:start_y=0.1"
        inopts=(-t 1)
        vf="fps=10,format=rgb24,hue=h=$(((idx * 47) % 360)),split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
    fi

    if ffmpeg -nostdin -loglevel error -y -f lavfi "${inopts[@]}" -i "$src" -vf "$vf" "${enc[@]}" "$filepath" 2>/dev/null &&
        validate_media "$filepath"; then
        echo "  [OK] Generated: $name.$ext (${w}x${h})"
    else
        rm -f "$filepath"
        echo -e "${RED}  [ERROR] Failed to generate $name.$ext (${w}x${h})${NC}"
        touch "$FAIL_DIR/image_$idx"
    fi
}

generate_images() {
    local count=$1
    echo -e "${YELLOW}[INFO] Generating $count images...${NC}"
    local i
    for i in $(seq 1 "$count"); do
        run_job generate_image "$i"
    done
    wait
    local failed
    failed=$(find "$FAIL_DIR" -name 'image_*' | wc -l)
    if [ "$failed" -gt 0 ]; then
        echo -e "${RED}  [ERROR] $failed image(s) failed to generate${NC}"
        return 1
    fi
    echo "  [OK] Generated $count images"
}

# ============================================================
# Videos
# ============================================================

# Profiles for sample_video_01..11.mp4 (h264/aac unless noted):
# "WIDTHxHEIGHT:seconds:fps:source:audio". Videos 1-4 are used by the playlist
# fixture and the metadata tests, so they stay ordinary landscape videos.
VIDEO_PROFILES=(
    640x360:5:24:testsrc2:audio
    1280x720:10:30:mandelbrot:audio
    320x240:3:15:life:audio
    1920x1080:8:30:gradients:audio
    720x1280:5:30:cellauto:audio       # portrait
    1280x720:5:60:testsrc2:audio       # 60fps
    640x360:5:24:sierpinski:silent     # no audio track
    3840x2160:2:24:gradients:audio     # 4K
    320x180:120:24:gradients:audio     # two minutes, for seeking
    854x480:5:25:life:audio
    160x120:1:10:testsrc2:silent       # tiny and one second long
)

# video_source <name> <WxH> <fps> <seed>
video_source() {
    local s=$1 size=$2 fps=$3 seed=$4
    case $s in
        testsrc2) echo "testsrc2=s=${size}:r=${fps}" ;;
        mandelbrot) echo "mandelbrot=s=${size}:r=${fps}:start_scale=0.3:end_scale=0.002:start_x=-0.74:start_y=0.1" ;;
        gradients) echo "gradients=s=${size}:r=${fps}:seed=${seed}:n=4:speed=0.05" ;;
        life) echo "life=s=${size}:r=${fps}:seed=${seed}:mold=10:ratio=0.1:life_color=#00ff88:death_color=#bb2255" ;;
        cellauto) echo "cellauto=s=${size}:r=${fps}:seed=${seed}:rule=110:random_fill_ratio=0.3" ;;
        *) echo "sierpinski=s=${size}:r=${fps}" ;;
    esac
}

# generate_video <dest> <WxH> <seconds> <fps> <source> <audio|silent> <seed> [extra ffmpeg output args...]
generate_video() {
    local dest=$1 size=$2 dur=$3 fps=$4 source=$5 audio=$6 seed=$7
    shift 7

    if [ -f "$dest" ] && validate_media "$dest"; then
        echo "  [SKIP] $(basename "$dest") (already exists and valid)"
        return 0
    fi
    rm -f "$dest"

    local -a inputs=(-f lavfi -t "$dur" -i "$(video_source "$source" "$size" "$fps" "$seed")")
    if [ "$audio" = "audio" ]; then
        inputs+=(-f lavfi -t "$dur" -i "sine=frequency=$((220 + seed * 40 % 660)):sample_rate=44100")
    fi

    # Default encoder settings; callers override codec/container via extra args.
    local -a codec=(-c:v libx264 -preset ultrafast -pix_fmt yuv420p)
    [ "$audio" = "audio" ] && codec+=(-c:a aac -b:a 96k)
    [ $# -gt 0 ] && codec=("$@")

    if ffmpeg -nostdin -loglevel error -y "${inputs[@]}" "${codec[@]}" -shortest "$dest" 2>/dev/null &&
        validate_media "$dest"; then
        echo "  [OK] Generated: $(basename "$dest") ($size, ${dur}s, ${fps}fps, $source, $audio)"
    else
        rm -f "$dest"
        echo -e "${RED}  [ERROR] Failed to generate $(basename "$dest")${NC}"
        touch "$FAIL_DIR/video_$(basename "$dest")"
    fi
}

generate_sample_videos() {
    local count=$1
    echo -e "${YELLOW}[INFO] Generating $count sample videos...${NC}"
    local n profile size dur fps source audio
    for n in $(seq 1 "$count"); do
        profile="${VIDEO_PROFILES[$(((n - 1) % ${#VIDEO_PROFILES[@]}))]}"
        IFS=: read -r size dur fps source audio <<<"$profile"
        # Later cycles shrink the expensive profiles.
        if [ "$n" -gt "${#VIDEO_PROFILES[@]}" ]; then
            [ "${size%x*}" -ge 3840 ] && size=1280x720
            [ "$dur" -gt 30 ] && dur=20
        fi
        run_job generate_video "$MEDIA_DIR/sample_video_$(printf "%02d" "$n").mp4" \
            "$size" "$dur" "$fps" "$source" "$audio" "$n"
    done
    wait
}

# Videos in other codecs and containers, so playback, thumbnailing and the
# transcode decision are exercised for more than h264-in-mp4.
# Named sample_variant_* so they sort after sample_transcode_test.mkv, keeping
# the first video in name order (which the e2e tests open) unchanged.
generate_format_variant_videos() {
    echo -e "${YELLOW}[INFO] Generating videos in other codecs and containers...${NC}"

    run_job generate_video "$MEDIA_DIR/sample_variant_hevc.mp4" 1280x720 4 24 mandelbrot audio 21 \
        -c:v libx265 -preset ultrafast -pix_fmt yuv420p -tag:v hvc1 -x265-params log-level=error -c:a aac
    run_job generate_video "$MEDIA_DIR/sample_variant_vp9.webm" 854x480 4 24 life audio 22 \
        -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 1M -pix_fmt yuv420p -c:a libopus
    run_job generate_video "$MEDIA_DIR/sample_variant_quicktime.mov" 640x360 4 30 gradients audio 23 \
        -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac
    run_job generate_video "$MEDIA_DIR/sample_variant_legacy.avi" 480x360 4 25 testsrc2 audio 24 \
        -c:v mpeg4 -q:v 5 -pix_fmt yuv420p -c:a ac3
    run_job generate_multi_audio_video "$MEDIA_DIR/sample_variant_multiaudio.mkv"
    wait

    local failed
    failed=$(find "$FAIL_DIR" -name 'video_*' | wc -l)
    if [ "$failed" -gt 0 ]; then
        echo -e "${RED}  [ERROR] $failed video(s) failed to generate${NC}"
        return 1
    fi
}

# An mkv with two audio tracks (440Hz and 880Hz).
generate_multi_audio_video() {
    local dest=$1
    if [ -f "$dest" ] && validate_media "$dest"; then
        echo "  [SKIP] $(basename "$dest") (already exists and valid)"
        return 0
    fi
    rm -f "$dest"
    if ffmpeg -nostdin -loglevel error -y \
        -f lavfi -t 4 -i "cellauto=s=640x360:r=24:seed=25:rule=30:random_fill_ratio=0.3" \
        -f lavfi -t 4 -i "sine=frequency=440" -f lavfi -t 4 -i "sine=frequency=880" \
        -map 0:v -map 1:a -map 2:a -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac \
        -shortest "$dest" 2>/dev/null && validate_media "$dest"; then
        echo "  [OK] Generated: $(basename "$dest") (640x360, 4s, two audio tracks)"
    else
        rm -f "$dest"
        echo -e "${RED}  [ERROR] Failed to generate $(basename "$dest")${NC}"
        touch "$FAIL_DIR/video_$(basename "$dest")"
    fi
}

# Function to create subfolders and populate them with copies
# of generated media and the sample.wpl playlist file.
# ============================================================
create_subfolders_and_copy() {
    echo -e "${YELLOW}[INFO] Creating subfolders and copying sample files...${NC}"

    local folder1="$MEDIA_DIR/folder1"
    local folder2="$MEDIA_DIR/folder2"

    # Create subdirectories
    mkdir -p "$folder1" "$folder2"
    if [ $? -ne 0 ]; then
        echo -e "${RED}  [ERROR] Failed to create subfolders${NC}"
        return 1
    fi
    echo "  [OK] Created: folder1/ and folder2/"

    # --- Copy images into each folder ---
    # folder1 gets the first 5 sample images
    local copied_f1=0
    for i in $(seq 1 5); do
        src="$MEDIA_DIR/sample_image_$(printf "%03d" $i).jpg"
        if [ -f "$src" ]; then
            cp -n "$src" "$folder1/"
            echo "  [COPY] sample_image_$(printf "%03d" $i).jpg -> folder1/"
            ((copied_f1++))
        fi
    done

    # folder2 gets the next 5 sample images (006-010)
    local copied_f2=0
    for i in $(seq 6 10); do
        src="$MEDIA_DIR/sample_image_$(printf "%03d" $i).jpg"
        if [ -f "$src" ]; then
            cp -n "$src" "$folder2/"
            echo "  [COPY] sample_image_$(printf "%03d" $i).jpg -> folder2/"
            ((copied_f2++))
        fi
    done

    echo "  [OK] Copied $copied_f1 images into folder1/, $copied_f2 images into folder2/"

    # --- Copy sample_video_02.mp4 into folder1 ---
    local video_src="$MEDIA_DIR/sample_video_02.mp4"
    if [ -f "$video_src" ]; then
        cp -n "$video_src" "$folder1/"
        echo "  [COPY] sample_video_02.mp4 -> folder1/"
    else
        echo -e "${RED}  [WARN] sample_video_02.mp4 not found -- skipping video copy to folder1${NC}"
    fi

    # --- Copy sample.wpl into both subfolders ---
    if [ -f "$SAMPLE_WPL" ]; then
        cp -n "$SAMPLE_WPL" "$folder1/"
        cp -n "$SAMPLE_WPL" "$folder2/"
        echo "  [COPY] sample.wpl -> folder1/ and folder2/"
    else
        echo -e "${RED}  [WARN] sample.wpl not found at: $SAMPLE_WPL${NC}"
        echo "         Expected location: ${SCRIPT_DIR}/sample.wpl"
    fi

    echo "  [OK] Subfolder setup complete"
}

# ============================================================
# Function to create test files with special filenames
# needed by path-encoding integration tests.
# ============================================================
create_special_filename_files() {
    echo -e "${YELLOW}[INFO] Creating files with special filenames for path-encoding tests...${NC}"

    # Find a source image and video to copy from
    local src_image=$(find "$MEDIA_DIR" -maxdepth 1 -name "sample_image_001.jpg" -type f | head -1)
    local src_video=$(find "$MEDIA_DIR" -maxdepth 1 -name "sample_video_01.mp4" -type f | head -1)

    if [ -z "$src_image" ]; then
        src_image=$(find "$MEDIA_DIR" -maxdepth 1 -name "*.jpg" -type f | head -1)
    fi
    if [ -z "$src_video" ]; then
        src_video=$(find "$MEDIA_DIR" -maxdepth 1 -name "*.mp4" -type f | head -1)
    fi

    if [ -z "$src_image" ]; then
        echo -e "${RED}  [ERROR] No source image found to create special filename copies${NC}"
        return 1
    fi

    local created=0

    # --- Files with spaces ---
    local space_names=(
        "photo with spaces.jpg"
        "my vacation photo.jpg"
        "summer 2024 trip.jpg"
    )
    for name in "${space_names[@]}"; do
        local dest="$MEDIA_DIR/$name"
        if [ ! -f "$dest" ]; then
            cp "$src_image" "$dest"
            echo "  [OK] Created: '$name'"
            ((created++))
        else
            echo "  [SKIP] '$name' (already exists)"
        fi
    done

    # --- Files with special characters ---
    # Note: Some characters (like ?) are invalid in filenames on certain
    # filesystems, so we use ones that are broadly safe on Linux/macOS
    # but still exercise URL encoding.
    local special_names=(
        "photo#tagged.jpg"
        "file with spaces & ampersand.jpg"
        "price=100\$.jpg"
        "photo@home.jpg"
        "comma,separated.jpg"
        "semi;colon.jpg"
        "plus+sign.jpg"
        "percent%20literal.jpg"
    )
    for name in "${special_names[@]}"; do
        local dest="$MEDIA_DIR/$name"
        if [ ! -f "$dest" ]; then
            cp "$src_image" "$dest"
            echo "  [OK] Created: '$name'"
            ((created++))
        else
            echo "  [SKIP] '$name' (already exists)"
        fi
    done

    # --- Files with unicode characters ---
    local unicode_names=(
        "café photo.jpg"
        "日本語テスト.jpg"
        "фото дома.jpg"
        "naïve résumé.jpg"
        "über cool.jpg"
    )
    for name in "${unicode_names[@]}"; do
        local dest="$MEDIA_DIR/$name"
        if [ ! -f "$dest" ]; then
            cp "$src_image" "$dest"
            echo "  [OK] Created: '$name'"
            ((created++))
        else
            echo "  [SKIP] '$name' (already exists)"
        fi
    done

    # --- Videos with special filenames ---
    if [ -n "$src_video" ]; then
        local video_special_names=(
            "video with spaces.mp4"
            "clip#1 final.mp4"
            "über video.mp4"
        )
        for name in "${video_special_names[@]}"; do
            local dest="$MEDIA_DIR/$name"
            if [ ! -f "$dest" ]; then
                cp "$src_video" "$dest"
                echo "  [OK] Created: '$name'"
                ((created++))
            else
                echo "  [SKIP] '$name' (already exists)"
            fi
        done
    else
        echo -e "${YELLOW}  [WARN] No source video found, skipping special video filenames${NC}"
    fi

        # --- Files with URL-path-safe characters that caused thumbnail lookup failures ---
    # These characters are valid in URL paths (not encoded by Go's url.PathEscape)
    # but need special handling in the backend's reEncodePath/encodePathSegment.
    # The + sign was the specific production bug (issue #329).
    local pathsafe_names=(
        "Beached+Whales.jpg"
        "photo+extra.jpg"
        "Big_N'_Tall_1.jpg"
        "it's a test.jpg"
        "photo (1).jpg"
        "photo (2).jpg"
        "wow!.jpg"
        "bang!bang.jpg"
        "star*rating.jpg"
        "file (1) + extra!.jpg"
        "file@extra!.jpg"
    )
    for name in "${pathsafe_names[@]}"; do
        local dest="$MEDIA_DIR/$name"
        if [ ! -f "$dest" ]; then
            cp "$src_image" "$dest"
            echo "  [OK] Created: '$name'"
            ((created++))
        else
            echo "  [SKIP] '$name' (already exists)"
        fi
    done

    # --- Videos with URL-path-safe special characters ---
    if [ -n "$src_video" ]; then
        local video_pathsafe_names=(
            "clip+bonus.mp4"
            "director's cut.mp4"
            "take (1).mp4"
        )
        for name in "${video_pathsafe_names[@]}"; do
            local dest="$MEDIA_DIR/$name"
            if [ ! -f "$dest" ]; then
                cp "$src_video" "$dest"
                echo "  [OK] Created: '$name'"
                ((created++))
            else
                echo "  [SKIP] '$name' (already exists)"
            fi
        done
    fi

    # --- Subdirectory with path-safe special characters ---
    local special_subfolder="$MEDIA_DIR/folder (1)"
    mkdir -p "$special_subfolder"
    if [ -d "$special_subfolder" ]; then
        local subfolder_names=(
            "nested+plus.jpg"
            "it's nested.jpg"
            "photo (1).jpg"
        )
        for name in "${subfolder_names[@]}"; do
            local dest="$special_subfolder/$name"
            if [ ! -f "$dest" ]; then
                cp "$src_image" "$dest"
                echo "  [OK] Created: 'folder (1)/$name'"
                ((created++))
            fi
        done

        if [ -n "$src_video" ]; then
            dest="$special_subfolder/clip+extra.mp4"
            if [ ! -f "$dest" ]; then
                cp "$src_video" "$dest"
                echo "  [OK] Created: 'folder (1)/clip+extra.mp4'"
                ((created++))
            fi
        fi
    fi

    # --- Subdirectory with spaces in folder name ---
    local special_folder="$MEDIA_DIR/folder with spaces"
    mkdir -p "$special_folder"
    if [ -d "$special_folder" ]; then
        local dest="$special_folder/nested image.jpg"
        if [ ! -f "$dest" ]; then
            cp "$src_image" "$dest"
            echo "  [OK] Created: 'folder with spaces/nested image.jpg'"
            ((created++))
        fi

        dest="$special_folder/simple.jpg"
        if [ ! -f "$dest" ]; then
            cp "$src_image" "$dest"
            echo "  [OK] Created: 'folder with spaces/simple.jpg'"
            ((created++))
        fi

        if [ -n "$src_video" ]; then
            dest="$special_folder/video clip.mp4"
            if [ ! -f "$dest" ]; then
                cp "$src_video" "$dest"
                echo "  [OK] Created: 'folder with spaces/video clip.mp4'"
                ((created++))
            fi
        fi
    fi

    # --- Files with URL-delimiter characters that cause silent truncation ---
    # These are the most dangerous: # and ? silently truncate the URL
    # if not percent-encoded, causing the server to receive a completely
    # different path with no error indication.
    local delimiter_names=(
        "clip#1 final.jpg"
        "file#tagged.jpg"
        "what?really.jpg"
        "how?why#both.jpg"
    )
    for name in "${delimiter_names[@]}"; do
        local dest="$MEDIA_DIR/$name"
        if [ ! -f "$dest" ]; then
            cp "$src_image" "$dest"
            echo "  [OK] Created: '$name'"
            ((created++))
        else
            echo "  [SKIP] '$name' (already exists)"
        fi
    done

    echo "  [OK] Created $created files with special filenames"
}

# ============================================================
# Function to embed EXIF/XMP description metadata into a
# selection of the generated images so that the EXIF
# auto-tagger has realistic, varied fixtures to process.
#
# Embedding tool priority: exiftool (preferred, widely
# available) → ffmpeg (common in dev containers).
# Skipped gracefully if neither is found.
#
# Patterns covered — explicit tags: format:
#   sample_image_001 – basic lowercase "tags:…;", two tags
#   sample_image_002 – mixed-case tag names
#   sample_image_003 – title-case "Tags:" prefix + surrounding text
#   sample_image_004 – plain description with NO tags: pattern (negative)
#   sample_image_005 – single tag; semicolon terminates mid-sentence
#   sample_image_006 – single tag; no semicolon
#   sample_image_007 – tags at end of sentence; no semicolon
#
# Patterns covered — extended IPTC/XMP keyword detection:
#   sample_image_008 – plain comma-separated keywords via Description
#                (simulates XMP Subject / Lightroom export)
#   sample_image_009 – plain comma-separated multi-word keywords
#   sample_image_010 – prose with commas but sentence punctuation (negative:
#                extended path must NOT fire)
#   sample_image_011 – IPTC Keywords written via standard -IPTC:Keywords
#                field (simulates digiKam / Apple Photos tagging)
# ============================================================
embed_exif_tags_in_sample_media() {
    echo -e "${YELLOW}[INFO] Embedding EXIF description metadata for auto-tagger testing...${NC}"

    # --------------- resolve embedding tool ---------------
    local embed_tool=""
    if command -v exiftool &>/dev/null; then
        embed_tool="exiftool"
    elif command -v ffmpeg &>/dev/null; then
        embed_tool="ffmpeg"
    else
        echo -e "${YELLOW}  [WARN] Neither exiftool nor ffmpeg found; skipping EXIF embedding${NC}"
        return 0
    fi
    echo "  [INFO] Using $embed_tool to embed metadata"

    # --------------- helper: embed description into a JPEG ---------------
    # Usage: embed_description <file> <description_string>
    embed_description() {
        local file="$1"
        local desc="$2"

        if [ ! -f "$file" ]; then
            echo "  [SKIP] $(basename "$file") not found"
            return 1
        fi

        if [ "$embed_tool" = "exiftool" ]; then
            # exiftool writes EXIF ImageDescription in-place
            exiftool -quiet -Description="$desc" -overwrite_original "$file" 2>/dev/null
        else
            # ffmpeg: write to a temp file then replace the original
            local tmp="${file}.tmp_exif.jpg"
            # #nosec G204 -- controlled inputs; $file comes from MEDIA_DIR
            ffmpeg -y -i "$file" -metadata description="$desc" "$tmp" &>/dev/null
            if [ $? -eq 0 ] && [ -s "$tmp" ]; then
                mv "$tmp" "$file"
            else
                rm -f "$tmp"
                echo "  [WARN] ffmpeg failed to embed metadata in $(basename "$file")"
                return 1
            fi
        fi
        return 0
    }

    # --------------- helper: embed IPTC Keywords (exiftool only) ---------------
    # Simulates the field written by digiKam, Apple Photos, and similar tools.
    # Falls back to embed_description when exiftool is not available.
    # Usage: embed_iptc_keywords <file> <keyword1> [<keyword2> ...]
    embed_iptc_keywords() {
        local file="$1"
        shift
        local keywords=("$@")

        if [ ! -f "$file" ]; then
            echo "  [SKIP] $(basename "$file") not found"
            return 1
        fi

        if [ "$embed_tool" != "exiftool" ]; then
            # ffmpeg cannot write IPTC keywords; fall back to description
            local joined
            joined=$(IFS=', '; echo "${keywords[*]}")
            embed_description "$file" "$joined"
            return $?
        fi

        # Build exiftool argument list: one -IPTC:Keywords= per keyword
        local args=("-quiet" "-overwrite_original")
        for kw in "${keywords[@]}"; do
            args+=("-IPTC:Keywords+=$kw")
            args+=("-XMP-dc:Subject+=$kw")
        done
        args+=("$file")
        exiftool "${args[@]}" 2>/dev/null
    }

    local embedded=0

    # --- sample_image_001: basic lowercase tags, two values ---
    local f="$MEDIA_DIR/sample_image_001.jpg"
    if embed_description "$f" "tags:landscape, nature;"; then
        echo "  [OK] sample_image_001.jpg — 'tags:landscape, nature;'"
        ((embedded++))
    fi

    # --- sample_image_002: mixed-case tag names ---
    f="$MEDIA_DIR/sample_image_002.jpg"
    if embed_description "$f" "tags:Portrait, Indoor;"; then
        echo "  [OK] sample_image_002.jpg — 'tags:Portrait, Indoor;'"
        ((embedded++))
    fi

    # --- sample_image_003: title-case prefix + extra surrounding text ---
    f="$MEDIA_DIR/sample_image_003.jpg"
    if embed_description "$f" "A beautiful walk in the park. Tags:Black & White, Street Photography; Shot in 2024."; then
        echo "  [OK] sample_image_003.jpg — 'Tags:Black & White, Street Photography;' (with surrounding text)"
        ((embedded++))
    fi

    # --- sample_image_004: plain description without any tag pattern ---
    #     This file should NOT receive any auto-tags (negative fixture).
    f="$MEDIA_DIR/sample_image_004.jpg"
    if embed_description "$f" "No tag markers here — just a plain photo description."; then
        echo "  [OK] sample_image_004.jpg — no-tags description (negative fixture)"
        ((embedded++))
    fi

    # --- sample_image_005: single tag; semicolon mid-sentence ---------------
    f="$MEDIA_DIR/sample_image_005.jpg"
    if embed_description "$f" "tags:architecture; taken downtown with a 35mm lens"; then
        echo "  [OK] sample_image_005.jpg — 'tags:architecture;' (semicolon mid-sentence)"
        ((embedded++))
    fi

    # --- sample_image_006: single tag; no semicolon ---------------
    f="$MEDIA_DIR/sample_image_006.jpg"
    if embed_description "$f" "tags:architecture"; then
        echo "  [OK] sample_image_006.jpg — 'tags:architecture' (no semicolon)"
        ((embedded++))
    fi

    # --- sample_image_007: tags at end of sentence; no semicolon ---------------
    f="$MEDIA_DIR/sample_image_007.jpg"
    if embed_description "$f" "Fancy architecture; tags:architecture, fancy, beautiful"; then
        echo "  [OK] sample_image_007.jpg — 'Fancy architecture; tags:architecture, fancy, beautiful' (no semicolon)"
        ((embedded++))
    fi

    # -----------------------------------------------------------------------
    # Extended detection — plain keyword list (IPTC/XMP style)
    # -----------------------------------------------------------------------

    # --- sample_image_008: plain comma-separated keywords in Description field ---
    #     Simulates XMP Subject / Lightroom export with no tags: prefix.
    #     Extended path should detect and import these as tags.
    f="$MEDIA_DIR/sample_image_008.jpg"
    if embed_description "$f" "urban, city lights, night photography"; then
        echo "  [OK] sample_image_008.jpg — plain keywords 'urban, city lights, night photography' (extended path)"
        ((embedded++))
    fi

    # --- sample_image_009: multi-word keywords, no tags: prefix ---------------
    #     Verifies extended path handles multi-word tokens correctly.
    f="$MEDIA_DIR/sample_image_009.jpg"
    if embed_description "$f" "Black & White, Street Photography, Golden Hour"; then
        echo "  [OK] sample_image_009.jpg — 'Black & White, Street Photography, Golden Hour' (extended multi-word)"
        ((embedded++))
    fi

    # --- sample_image_010: prose with commas but sentence punctuation ----------
    #     Extended path must NOT fire because of the period.
    #     This is a negative fixture: no auto-tags should be applied.
    f="$MEDIA_DIR/sample_image_010.jpg"
    if embed_description "$f" "A walk through the city, late in the evening. Shot handheld."; then
        echo "  [OK] sample_image_010.jpg — prose with period (negative fixture, extended path blocked)"
        ((embedded++))
    fi

    # --- sample_image_011: IPTC Keywords via standard field --------------------
    #     Simulates digiKam, Apple Photos, or any IPTC-aware editor.
    #     The keywords arrive as "comment" in ffprobe and as a plain
    #     comma-separated list — the extended path picks them up.
    f="$MEDIA_DIR/sample_image_011.jpg"
    if embed_iptc_keywords "$f" "travel" "mountains" "landscape"; then
        echo "  [OK] sample_image_011.jpg — IPTC Keywords: travel, mountains, landscape (standard field)"
        ((embedded++))
    fi

    # --- EXIF orientation: files stored rotated, displayed upright ---------
    #     sample_image_027 (300x900) and sample_image_029 (200x200) carry
    #     Orientation=6 (90° CW) and 3 (180°), which thumbnailing and the
    #     lightbox must honour. Needs exiftool; skipped otherwise.
    if [ "$embed_tool" = "exiftool" ]; then
        for pair in "027:6" "029:3"; do
            f="$MEDIA_DIR/sample_image_${pair%%:*}.jpg"
            if [ -f "$f" ] && exiftool -quiet -n -Orientation="${pair##*:}" -overwrite_original "$f" 2>/dev/null; then
                echo "  [OK] sample_image_${pair%%:*}.jpg — EXIF Orientation=${pair##*:}"
            fi
        done
    fi

    # -----------------------------------------------------------------------
    # Video metadata — ffmpeg format.tags (description / comment fields)
    #
    # For MP4/MKV the autotagger reads ffprobe's format.tags entries
    # "description" and "comment" (case-insensitive).  ffmpeg embeds these
    # via -metadata key=value when re-muxing.  We use -c copy to avoid
    # re-encoding; a temp file is written then renamed in-place.
    #
    # Patterns covered:
    #   sample_video_01 – explicit tags: prefix in description (primary path)
    #   sample_video_02 – plain comma-separated keywords in description
    #                     (extended path: 2–5 tokens, no sentence punctuation)
    #   sample_video_03 – tags: prefix via comment field instead of description
    #   sample_video_04 – plain description, no recognisable tag pattern
    #                     (negative fixture)
    #   sample_transcode_test.mkv – same tags: prefix pattern, different container
    # -----------------------------------------------------------------------

    if command -v ffmpeg &>/dev/null; then

        # Helper: embed format-level metadata into an MP4 or MKV without re-encoding.
        # Usage: embed_video_metadata <file> <key> <value>
        embed_video_metadata() {
            local file="$1"
            local key="$2"
            local value="$3"

            if [ ! -f "$file" ]; then
                echo "  [SKIP] $(basename "$file") not found"
                return 1
            fi

            local ext="${file##*.}"
            local tmp="${file}.tmp_meta.${ext}"
            # -map_metadata 0 copies existing tags; -metadata key=value adds/overrides.
            # #nosec G204 -- controlled inputs from MEDIA_DIR
            if ffmpeg -y -i "$file" \
                      -map_metadata 0 \
                      -metadata "${key}=${value}" \
                      -c copy "$tmp" &>/dev/null; then
                mv "$tmp" "$file"
                return 0
            else
                rm -f "$tmp"
                echo "  [WARN] ffmpeg failed to embed metadata in $(basename "$file")"
                return 1
            fi
        }

        # --- sample_video_01: explicit tags: prefix in description ---
        f="$MEDIA_DIR/sample_video_01.mp4"
        if embed_video_metadata "$f" "description" "tags:outdoor, nature;"; then
            echo "  [OK] sample_video_01.mp4 — description: 'tags:outdoor, nature;'"
            ((embedded++))
        fi

        # --- sample_video_02: plain comma-separated keywords (extended path) ---
        f="$MEDIA_DIR/sample_video_02.mp4"
        if embed_video_metadata "$f" "description" "indoor, people, work"; then
            echo "  [OK] sample_video_02.mp4 — description: 'indoor, people, work' (extended path)"
            ((embedded++))
        fi

        # --- sample_video_03: tags: prefix in comment field ---
        f="$MEDIA_DIR/sample_video_03.mp4"
        if embed_video_metadata "$f" "comment" "tags:motion, detection;"; then
            echo "  [OK] sample_video_03.mp4 — comment: 'tags:motion, detection;'"
            ((embedded++))
        fi

        # --- sample_video_04: plain prose, no tag pattern (negative fixture) ---
        f="$MEDIA_DIR/sample_video_04.mp4"
        if embed_video_metadata "$f" "description" "A short sample clip with no tag markers."; then
            echo "  [OK] sample_video_04.mp4 — no-tags description (negative fixture)"
            ((embedded++))
        fi

        # --- sample_transcode_test.mkv: tags: prefix, mkv container ---
        f="$MEDIA_DIR/sample_transcode_test.mkv"
        if embed_video_metadata "$f" "description" "tags:test, transcode;"; then
            echo "  [OK] sample_transcode_test.mkv — description: 'tags:test, transcode;'"
            ((embedded++))
        fi

    else
        echo -e "${YELLOW}  [WARN] ffmpeg not found; skipping video metadata embedding${NC}"
    fi

    echo "  [OK] Embedded metadata in $embedded files"
}

# ============================================================
# Generate a video that requires transcoding to exercise the
# transcode code path in CI integration tests.
#
# Strategy: .mkv container + h264 codec.  "mkv" is NOT in the
# transcoder's compatibleContainers map, so NeedsTranscode=true
# even though the codec itself is h264.  ffmpeg handles mkv
# natively so thumbnail generation also works.
#
# The file is always (re-)created when invalid so that a stale
# cache entry from before this function was added doesn't hide
# the transcode path.
# ============================================================
generate_transcode_test_video() {
    local dest="$MEDIA_DIR/sample_transcode_test.mkv"

    # Skip if file already exists and ffprobe confirms it's valid
    if [ -f "$dest" ] && command -v ffprobe &>/dev/null; then
        if ffprobe -v error -show_entries format=duration \
                   -of default=noprint_wrappers=1:nokey=1 "$dest" &>/dev/null; then
            echo "  [SKIP] sample_transcode_test.mkv (already exists and valid)"
            return 0
        else
            echo "  [RETRY] Regenerating sample_transcode_test.mkv (invalid file)"
            rm -f "$dest"
        fi
    fi

    if ! command -v ffmpeg &>/dev/null; then
        echo -e "${YELLOW}  [WARN] ffmpeg not found; skipping transcode test video generation${NC}"
        return 0
    fi

    echo "  [GENERATE] sample_transcode_test.mkv (mkv container → NeedsTranscode=true)..."
    if ffmpeg -y \
              -f lavfi -i "testsrc=duration=5:size=320x240:rate=24" \
              -f lavfi -i "sine=frequency=440:duration=5" \
              -c:v libx264 -c:a aac -pix_fmt yuv420p \
              -shortest "$dest" &>/dev/null; then
        echo -e "${GREEN}  [OK] Generated: sample_transcode_test.mkv${NC}"
    else
        echo -e "${RED}  [ERROR] Failed to generate sample_transcode_test.mkv${NC}"
    fi
}

# Main generation process
echo -e "${BLUE}[INFO] Starting generation...${NC}"
echo ""

if ! generate_images "$NUM_IMAGES"; then
    echo -e "${RED}[ERROR] Failed to generate images. Exiting.${NC}"
    exit 1
fi
echo ""

if [ "$NUM_VIDEOS" -gt 0 ]; then
    generate_sample_videos "$NUM_VIDEOS"
    if ! generate_format_variant_videos; then
        echo -e "${RED}[ERROR] Failed to generate videos. Exiting.${NC}"
        exit 1
    fi
    if [ "$(find "$FAIL_DIR" -name 'video_*' | wc -l)" -gt 0 ]; then
        echo -e "${RED}[ERROR] Failed to generate videos. Exiting.${NC}"
        exit 1
    fi
    echo ""
fi

# Create subfolders and copy files into them
create_subfolders_and_copy
echo ""

# Create files with special filenames for path-encoding tests
create_special_filename_files
echo ""

# Generate a video that exercises the transcode code path
echo -e "${YELLOW}[INFO] Generating transcode test video...${NC}"
generate_transcode_test_video
echo ""

# Embed EXIF description metadata for auto-tagger testing
embed_exif_tags_in_sample_media
echo ""

# Ensure a stable multi-item playlist fixture exists for CI and E2E coverage
if [ -x "$ENSURE_TEST_PLAYLIST_SCRIPT" ]; then
    "$ENSURE_TEST_PLAYLIST_SCRIPT" "$MEDIA_DIR"
else
    bash "$ENSURE_TEST_PLAYLIST_SCRIPT" "$MEDIA_DIR"
fi
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Generation Complete!${NC}"
echo -e "${BLUE}========================================${NC}"

new_files=$(find "$MEDIA_DIR" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.webp" -o -name "*.gif" -o -name "*.bmp" -o -name "*.tiff" -o -name "*.mp4" -o -name "*.webm" -o -name "*.mov" -o -name "*.avi" -o -name "*.mkv" -o -name "*.wpl" \) | wc -l)
total_size=$(du -sh "$MEDIA_DIR" 2>/dev/null | cut -f1)

echo ""
echo "Summary:"
echo "  Total files: $new_files (including subfolder copies)"
echo "  Total size: $total_size"
echo "  Location: $MEDIA_DIR"
echo "  Subfolders: folder1/, folder2/"
echo ""
echo -e "${GREEN}[OK] Sample media ready for testing!${NC}"
echo ""
echo "Note: Existing valid files were preserved (skipped if already present)."
echo "To regenerate, delete specific files or the entire folder."
