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
existing_count=$(find "$MEDIA_DIR" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.mp4" -o -name "*.webm" -o -name "*.wpl" \) | wc -l)
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

# ============================================================
# Function to create test files with special filenames
# needed by path-encoding integration tests.
# ============================================================
create_special_filename_files() {
    echo -e "${YELLOW}[INFO] Creating files with special filenames for path-encoding tests...${NC}"

    # Find a source image and video to copy from
    local src_image=$(find "$MEDIA_DIR" -maxdepth 1 -name "picsum_001.jpg" -type f | head -1)
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

# Create files with special filenames for path-encoding tests
create_special_filename_files
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Download Complete!${NC}"
echo -e "${BLUE}========================================${NC}"

new_files=$(find "$MEDIA_DIR" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.mp4" -o -name "*.webm" -o -name "*.wpl" \) | wc -l)
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
