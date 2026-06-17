#!/usr/bin/env bash
set -euo pipefail

if [ $# -eq 0 ]; then
	echo "Usage: $0 <command> [args...]" >&2
	exit 1
fi

IMAGE_TAG="${IMAGE_TAG:-${IMAGE:-media-viewer}}"
TEST_DOCKER_KEEP_TEMP="${TEST_DOCKER_KEEP_TEMP:-false}"
TEST_PASSWORD="${TEST_PASSWORD:-testpass123}"
TEST_MEDIA_SOURCE_DIR="${TEST_MEDIA_SOURCE_DIR:-}"
FIXTURE_NAME="${AUTOTAGGER_RUNTIME_FIXTURE_NAME:-autotag.webp}"
EXPECTED_TAGS="${AUTOTAGGER_RUNTIME_EXPECTED_TAGS:-travel,mountains,landscape}"
CONTAINER_NAME="media-viewer-docker-test-$$"
TMP_ROOT="$(mktemp -d)"
MEDIA_DIR="$TMP_ROOT/media"
CACHE_DIR="$TMP_ROOT/cache"
DATABASE_DIR="$TMP_ROOT/database"
SERVER_LOG="$TMP_ROOT/docker.log"

cleanup() {
	if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
		docker logs "$CONTAINER_NAME" >"$SERVER_LOG" 2>&1 || true
		docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
	fi

	if [ "$TEST_DOCKER_KEEP_TEMP" = "true" ]; then
		echo "Docker test temp preserved: $TMP_ROOT" >&2
		return
	fi

	rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

require_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Required command not found: $1" >&2
		exit 1
	fi
}

find_free_port() {
	python3 - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}

wait_for_url() {
	local url="$1"
	local label="$2"
	local timeout_seconds="$3"

	for _ in $(seq 1 "$timeout_seconds"); do
		if curl -sf "$url" >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
	done

	echo "Timed out waiting for $label: $url" >&2
	docker logs "$CONTAINER_NAME" >"$SERVER_LOG" 2>&1 || true
	if [ -f "$SERVER_LOG" ]; then
		tail -n 100 "$SERVER_LOG" >&2 || true
	fi
	return 1
}

create_fixture() {
	local fixture_path="$MEDIA_DIR/$FIXTURE_NAME"
	local fixture_dir
	fixture_dir="$(dirname "$fixture_path")"
	mkdir -p "$fixture_dir"

	ffmpeg -y -f lavfi -i color=c=black:size=2x2 -frames:v 1 "$fixture_path" >/dev/null 2>&1

	IFS=',' read -r -a tag_array <<<"$EXPECTED_TAGS"
	local exiftool_args=(exiftool -overwrite_original)
	for raw_tag in "${tag_array[@]}"; do
		local trimmed_tag
		trimmed_tag="$(printf '%s' "$raw_tag" | sed 's/^ *//; s/ *$//')"
		if [ -n "$trimmed_tag" ]; then
			exiftool_args+=("-XMP-dc:Subject+=$trimmed_tag")
		fi
	done

	"${exiftool_args[@]}" "$fixture_path" >/dev/null
}

copy_media_source() {
	if [ -z "$TEST_MEDIA_SOURCE_DIR" ]; then
		return 0
	fi

	if [ ! -d "$TEST_MEDIA_SOURCE_DIR" ]; then
		echo "Warning: TEST_MEDIA_SOURCE_DIR does not exist or is not a directory: $TEST_MEDIA_SOURCE_DIR (continuing without sample media)" >&2
		return 0
	fi

	echo "Seeding Docker test media from: $TEST_MEDIA_SOURCE_DIR"
	cp -a "$TEST_MEDIA_SOURCE_DIR"/. "$MEDIA_DIR"/
}

prepare_mount_permissions() {
	# The runtime images run as nobody, so bind-mounted host temp dirs must be
	# readable/writable by a non-owner UID/GID inside the container.
	chmod -R a+rX "$MEDIA_DIR"
	chmod 0777 "$CACHE_DIR" "$DATABASE_DIR"
}

require_cmd docker
require_cmd ffmpeg
require_cmd exiftool
require_cmd curl
require_cmd python3

HOST_PORT="${HOST_PORT:-$(find_free_port)}"
TEST_BASE_URL="http://localhost:${HOST_PORT}"

mkdir -p "$MEDIA_DIR" "$CACHE_DIR" "$DATABASE_DIR"
copy_media_source
create_fixture
prepare_mount_permissions

echo "Starting Docker test server from image: $IMAGE_TAG"
docker run -d \
	--name "$CONTAINER_NAME" \
	-p "${HOST_PORT}:8080" \
	-e MEDIA_DIR=/media \
	-e CACHE_DIR=/cache \
	-e DATABASE_DIR=/database \
	-e INDEX_INTERVAL=24h \
	-e THUMBNAIL_INTERVAL=24h \
	-e EXIF_TAG_INTERVAL=24h \
	-e METRICS_ENABLED=false \
	-e LOG_HEALTH_CHECKS=false \
	-e LOG_LEVEL=info \
	-v "$MEDIA_DIR:/media:ro" \
	-v "$CACHE_DIR:/cache" \
	-v "$DATABASE_DIR:/database" \
	"$IMAGE_TAG" >/dev/null

docker logs "$CONTAINER_NAME" >"$SERVER_LOG" 2>&1 || true

wait_for_url "$TEST_BASE_URL/readyz" "server readiness" 60
wait_for_url "$TEST_BASE_URL/api/auth/check" "auth readiness" 30

export TEST_BASE_URL
export TEST_PASSWORD
export AUTOTAGGER_RUNTIME_FIXTURE_NAME="$FIXTURE_NAME"
export AUTOTAGGER_RUNTIME_EXPECTED_TAGS="$EXPECTED_TAGS"

"$@"
