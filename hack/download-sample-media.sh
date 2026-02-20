#!/bin/bash
# Don't exit on errors - we want to continue downloading even if some fail
set +e

# Download free, open-source, royalty-free sample media
# Uses multiple sources to get a diverse collection

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_DIR="${MEDIA_DIR:-${SCRIPT_DIR}/../sample-media}"

# Configuration
NUM_IMAGES=${NUM_IMAGES:-250}
NUM_VIDEOS=${NUM_VIDEOS:-15}
PEXELS_API_KEY="${PEXELS_API_KEY:-}"

# Path to the sample.wpl file (same directory as this script)
SAMPLE_WPL="${SCRIPT_DIR}/sample.wpl"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Sample Media Downloader${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Target: $MEDIA_DIR"
echo "Images to download: $NUM_IMAGES"
echo "Videos to download: $NUM_VIDEOS"
echo ""

# Check if sample-media directory exists, create if not
if [ ! -d "$MEDIA_DIR" ]; then
    echo -e "${YELLOW}[INFO] Creating sample-media directory...${NC}"
    mkdir -p "$MEDIA_DIR"
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] Failed to create sample-media directory${NC}"
        exit 1
    fi
    echo -e "${GREEN}[OK] Created: $MEDIA_DIR${NC}"
    echo ""
fi

# Count existing files
existing_count=$(find "$MEDIA_DIR" -type f $ -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.mp4" -o -name "*.webm" -o -name "*.wpl" $ | wc -l)
echo -e "${GREEN}Existing files in sample-media: $existing_count (will be preserved)${NC}"
echo ""

# Function to validate image file
validate_image() {
    local filepath=$1
    local verbose=${2:-false}

    # Check if file command is available
    if command -v file &> /dev/null; then
        file_type=$(file -b --mime-type "$filepath" 2>/dev/null)
        if $verbose; then
            echo "  [DEBUG] File type detected: $file_type" >&2
        fi
        if [[ "$file_type" =~ ^image/ ]]; then
            return 0
        fi
    fi
    # Fallback: check file size (images should be at least a few KB)
    local size=$(stat -f%z "$filepath" 2>/dev/null || stat -c%s "$filepath" 2>/dev/null)
    if $verbose; then
        echo "  [DEBUG] File size: $size bytes" >&2
    fi
    if [ -f "$filepath" ] && [ $size -gt 5000 ]; then
        return 0
    fi
    return 1
}

# Function to validate video file
validate_video() {
    local filepath=$1
    local verbose=${2:-false}

    # Check if ffprobe is available (best validation)
    if command -v ffprobe &> /dev/null; then
        if ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$filepath" &>/dev/null; then
            return 0
        fi
        if $verbose; then
            echo "  [DEBUG] ffprobe validation failed" >&2
        fi
        return 1
    fi
    # Fallback: use file command
    if command -v file &> /dev/null; then
        file_type=$(file -b --mime-type "$filepath" 2>/dev/null)
        if $verbose; then
            echo "  [DEBUG] File type detected: $file_type" >&2
        fi
        if [[ "$file_type" =~ ^video/ ]]; then
            return 0
        fi
    fi
    # Fallback: check file size (videos should be at least 100 KB)
    local size=$(stat -f%z "$filepath" 2>/dev/null || stat -c%s "$filepath" 2>/dev/null)
    if $verbose; then
        echo "  [DEBUG] File size: $size bytes" >&2
    fi
    if [ -f "$filepath" ] && [ $size -gt 100000 ]; then
        return 0
    fi
    return 1
}

# Function to download images from Picsum (Lorem Ipsum for photos)
download_picsum_images() {
    local count=$1
    echo -e "${YELLOW}[INFO] Downloading $count images from Picsum...${NC}"

    local downloaded=0
    local attempt=0
    local max_attempts=$((count * 3))  # Allow up to 3x attempts to get desired count

    while [ $downloaded -lt $count ] && [ $attempt -lt $max_attempts ]; do
        ((attempt++))
        filename="picsum_$(printf "%03d" $((downloaded + 1))).jpg"
        filepath="$MEDIA_DIR/$filename"

        # Check if file exists and is valid
        if [ -f "$filepath" ]; then
            if validate_image "$filepath"; then
                echo "  [SKIP] $filename (already exists and valid)"
                ((downloaded++))
                continue
            else
                echo "  [RETRY] Re-downloading $filename (invalid file detected)"
                rm -f "$filepath"
            fi
        fi

        # Random size and ID
        width=$((800 + RANDOM % 1120))
        height=$((600 + RANDOM % 480))
        image_id=$((1 + RANDOM % 1000))

        # Try up to 3 times to get a valid image
        local retry=0
        local success=false

        while [ $retry -lt 3 ] && [ "$success" = false ]; do
            if [ $retry -gt 0 ]; then
                echo "  [RETRY] Attempt $retry/3 for $filename..."
            fi

            curl -L -s "https://picsum.photos/id/$image_id/${width}/${height}" -o "$filepath" 2>/dev/null

            if [ $? -eq 0 ] && [ -s "$filepath" ]; then
                # Validate downloaded file
                if validate_image "$filepath"; then
                    echo "  [OK] Downloaded: $filename (${width}x${height})"
                    ((downloaded++))
                    success=true
                else
                    echo "  [WARN] Invalid image on attempt $((retry + 1))"
                    rm -f "$filepath"
                    # Try a different image ID on retry
                    image_id=$((1 + RANDOM % 1000))
                fi
            else
                echo "  [WARN] Download failed on attempt $((retry + 1))"
                rm -f "$filepath"
            fi

            ((retry++))
            if [ "$success" = false ] && [ $retry -lt 3 ]; then
                sleep 0.5
            fi
        done

        if [ "$success" = false ]; then
            echo "  [ERROR] Failed after 3 attempts: $filename"
        fi

        sleep 0.3
    done

    if [ $downloaded -lt $count ]; then
        echo "  [WARN] Only downloaded $downloaded/$count images after $attempt attempts"
    else
        echo "  [OK] Successfully downloaded $downloaded images"
    fi
}

# Function to download sample videos
download_sample_videos() {
    local count=$1
    echo -e "${YELLOW}[INFO] Downloading $count sample videos...${NC}"

    # Sample video URLs (creative commons / free to use)
    local video_urls=(
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4"
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4"
    )

    local downloaded=0
    for i in "${!video_urls[@]}"; do
        if [ $downloaded -ge $count ]; then
            break
        fi

        url="${video_urls[$i]}"
        filename="sample_video_$(printf "%02d" $((i+1))).mp4"
        filepath="$MEDIA_DIR/$filename"

        # Check if file exists and is valid
        if [ -f "$filepath" ]; then
            if validate_video "$filepath"; then
                echo "  [SKIP] $filename (already exists and valid)"
                ((downloaded++))
                continue
            else
                echo "  [RETRY] Re-downloading $filename (invalid file detected)"
                rm -f "$filepath"
            fi
        fi

        echo "  [DOWNLOAD] Downloading: $filename..."
        echo "  [DEBUG] URL: $url" >&2
        curl_output=$(curl -L -w "\n%{http_code}" --max-time 60 "$url" -o "$filepath" 2>&1)
        curl_exit=$?
        http_code=$(echo "$curl_output" | tail -n1)

        echo "  [DEBUG] Curl exit code: $curl_exit, HTTP: $http_code" >&2

        if [ $curl_exit -eq 0 ] && [ -s "$filepath" ]; then
            # Validate downloaded file
            echo "  [DEBUG] Validating downloaded file..." >&2
            if validate_video "$filepath" true; then
                size=$(du -h "$filepath" | cut -f1)
                echo "  [OK] Downloaded: $filename ($size, HTTP $http_code)"
                ((downloaded++))
            else
                echo "  [ERROR] Failed: $filename (invalid video, HTTP $http_code)"
                rm -f "$filepath"
            fi
        else
            echo "  [ERROR] Failed: $filename (curl exit code: $curl_exit)"
            if [ $curl_exit -eq 7 ]; then
                echo "  [DEBUG] Error 7: Failed to connect to host. Check network/firewall." >&2
            fi
            echo "  [DEBUG] URL: $url" >&2
            rm -f "$filepath"
        fi

        sleep 0.5
    done

    echo "  [INFO] Downloaded $downloaded videos"
}

# Function to download from Pexels API (requires API key)
download_pexels_videos() {
    if [ -z "$PEXELS_API_KEY" ]; then
        echo -e "${YELLOW}[WARN] Skipping Pexels videos (no API key set)${NC}"
        echo "   To enable: export PEXELS_API_KEY='your-api-key'"
        echo "   Get free API key at: https://www.pexels.com/api/"
        return
    fi

    local count=$1
    echo -e "${YELLOW}[INFO] Downloading $count videos from Pexels...${NC}"

    # Search for various topics to get diverse content
    local topics=("nature" "city" "ocean" "sunset" "people" "technology" "food" "animals")

    for i in $(seq 1 $count); do
        filename="pexels_video_$(printf "%03d" $i).mp4"
        filepath="$MEDIA_DIR/$filename"

        # Check if file exists and is valid
        if [ -f "$filepath" ]; then
            if validate_video "$filepath"; then
                echo "  [SKIP] $filename (already exists and valid)"
                continue
            else
                echo "  [RETRY] Re-downloading $filename (invalid file detected)"
                rm -f "$filepath"
            fi
        fi

        topic="${topics[$((RANDOM % ${#topics[@]}))]}"
        page=$((1 + RANDOM % 10))

        # Get video URL from API
        video_url=$(curl -s -H "Authorization: $PEXELS_API_KEY" \
            "https://api.pexels.com/videos/search?query=$topic&per_page=1&page=$page" | \
            jq -r '.videos[0].video_files[] | select(.quality == "sd" or .quality == "hd") | .link' | head -1)

        if [ -n "$video_url" ] && [ "$video_url" != "null" ]; then
            curl -L -s --max-time 60 "$video_url" -o "$filepath" 2>/dev/null

            if [ $? -eq 0 ] && [ -s "$filepath" ]; then
                # Validate downloaded file
                if validate_video "$filepath"; then
                    size=$(du -h "$filepath" | cut -f1)
                    echo "  [OK] Downloaded: $filename ($topic, $size)"
                else
                    echo "  [ERROR] Failed: $filename (invalid video)"
                    rm -f "$filepath"
                fi
            else
                echo "  [ERROR] Failed: $filename"
                rm -f "$filepath"
            fi
        else
            echo "  [ERROR] Failed to get video URL for $filename"
        fi

        sleep 1
    done
}

# ============================================================
# Function to create subfolders and populate them with copies
# of downloaded media and the sample.wpl playlist file.
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
    # folder1 gets the first 5 picsum images
    local copied_f1=0
    for i in $(seq 1 5); do
        src="$MEDIA_DIR/picsum_$(printf "%03d" $i).jpg"
        if [ -f "$src" ]; then
            cp -n "$src" "$folder1/"
            echo "  [COPY] picsum_$(printf "%03d" $i).jpg -> folder1/"
            ((copied_f1++))
        fi
    done

    # folder2 gets the next 5 picsum images (006-010)
    local copied_f2=0
    for i in $(seq 6 10); do
        src="$MEDIA_DIR/picsum_$(printf "%03d" $i).jpg"
        if [ -f "$src" ]; then
            cp -n "$src" "$folder2/"
            echo "  [COPY] picsum_$(printf "%03d" $i).jpg -> folder2/"
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

# Main download process
echo -e "${BLUE}[INFO] Starting downloads...${NC}"
echo ""

# Download all images from Picsum (reliable source)
download_picsum_images $NUM_IMAGES
echo ""

# Download videos
if [ $NUM_VIDEOS -gt 0 ]; then
    # Try sample videos first (no API key needed)
    download_sample_videos $((NUM_VIDEOS < 16 ? NUM_VIDEOS : 16))
    echo ""

    # If we want more than 16 videos and have API key, use Pexels
    remaining_videos=$((NUM_VIDEOS - 16))
    if [ $remaining_videos -gt 0 ]; then
        download_pexels_videos $remaining_videos
        echo ""
    fi
fi

# Create subfolders and copy files into them
create_subfolders_and_copy
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Download Complete!${NC}"
echo -e "${BLUE}========================================${NC}"

new_files=$(find "$MEDIA_DIR" -type f $ -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.mp4" -o -name "*.webm" -o -name "*.wpl" $ | wc -l)
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
echo "Note: Existing files were preserved (skipped if already present)."
echo "To re-download, delete specific files or the entire folder."
