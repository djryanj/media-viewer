#!/usr/bin/env bash
#
# run-with-test-server.sh — Start an ephemeral media-viewer server and run a
# command against it. Designed for both local auto targets and CI so they share
# the same backend startup, readiness, and teardown behavior.
#
# Default behavior:
#   • The server listens on a random free port (no conflict with make dev).
#   • DATABASE_DIR and CACHE_DIR point at a fresh temp directory.
#   • MEDIA_DIR is inherited from the environment; when set, playlist fixtures
#     are prepared in that media tree before startup.
#   • The helper waits for both /readyz and /api/auth/check so frontend tests
#     do not race database/auth initialization.
#   • The server is reliably killed on exit, even on Ctrl-C.
#
# Useful environment overrides:
#   • BINARY_PATH: reuse an already-built binary instead of the default
#     project-root media-viewer binary.
#   • TEST_SERVER_SKIP_BUILD=true: skip the implicit `make build` step.
#   • TEST_SERVER_KEEP_TEMP=true: preserve temp db/cache/log directories for
#     CI artifact upload or local debugging.
#   • TEST_SERVER_LOG_LEVEL=info: override backend log level for the helper.
#   • TEST_SERVER_READY_TIMEOUT / TEST_SERVER_AUTH_TIMEOUT: tune readiness
#     waits for slower environments.
#   • TEST_SERVER_TMPDIR_ROOT: choose the parent directory for temp state.
#   • TEST_SERVER_WAIT_FOR_AUTH=false: skip the auth endpoint readiness check.
#
# Usage:
#   ./hack/run-with-test-server.sh <command> [args...]
#
# The command receives TEST_BASE_URL in its environment, pointing at the
# ephemeral server (e.g. http://localhost:52437).
#
# Examples:
#   ./hack/run-with-test-server.sh make frontend-test-integration
#   ./hack/run-with-test-server.sh make frontend-test-e2e
#   TEST_SERVER_SKIP_BUILD=true BINARY_PATH=./media-viewer MEDIA_DIR=/tmp/media \
#     ./hack/run-with-test-server.sh make frontend-test-e2e-smoke

set -euo pipefail

# ── Colour helpers (disabled when stdout is not a terminal) ──────────────────
if [ -t 1 ]; then
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    RED='\033[0;31m'
    CYAN='\033[0;36m'
    RESET='\033[0m'
else
    GREEN='' YELLOW='' RED='' CYAN='' RESET=''
fi

info()  { printf "${CYAN}[test-server]${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}[test-server]${RESET} %s\n" "$*"; }
error() { printf "${RED}[test-server]${RESET} %s\n" "$*" >&2; }
ok()    { printf "${GREEN}[test-server]${RESET} %s\n" "$*"; }

# ── Validate arguments ──────────────────────────────────────────────────────
if [ $# -eq 0 ]; then
    error "Usage: $0 <command> [args...]"
    error "Example: $0 make frontend-test-integration"
    exit 1
fi

# ── Locate project root (directory containing the Makefile) ─────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARY="${BINARY_PATH:-$PROJECT_ROOT/media-viewer}"
TEST_SERVER_SKIP_BUILD="${TEST_SERVER_SKIP_BUILD:-false}"
TEST_SERVER_KEEP_TEMP="${TEST_SERVER_KEEP_TEMP:-false}"
TEST_SERVER_WAIT_FOR_AUTH="${TEST_SERVER_WAIT_FOR_AUTH:-true}"
TEST_SERVER_READY_TIMEOUT="${TEST_SERVER_READY_TIMEOUT:-30}"
TEST_SERVER_AUTH_TIMEOUT="${TEST_SERVER_AUTH_TIMEOUT:-15}"
TEST_SERVER_TMPDIR_ROOT="${TEST_SERVER_TMPDIR_ROOT:-}"
TEST_SERVER_LOG_LEVEL="${TEST_SERVER_LOG_LEVEL:-${LOG_LEVEL:-warn}}"

# ── Build the server binary ─────────────────────────────────────────────────
if [ "$TEST_SERVER_SKIP_BUILD" = "true" ]; then
    info "Using existing server binary: $BINARY"
else
    info "Building server binary..."
    make -C "$PROJECT_ROOT" build
fi

if [ ! -x "$BINARY" ]; then
    error "Server binary not found or not executable at $BINARY"
    exit 1
fi

# ── Create ephemeral directories ────────────────────────────────────────────
if [ -n "$TEST_SERVER_TMPDIR_ROOT" ]; then
    mkdir -p "$TEST_SERVER_TMPDIR_ROOT"
    TMPDIR_BASE="$(mktemp -d "$TEST_SERVER_TMPDIR_ROOT/media-viewer-test.XXXXXXXXXX")"
else
    TMPDIR_BASE="$(mktemp -d "${TMPDIR:-/tmp}/media-viewer-test.XXXXXXXXXX")"
fi
TEST_DATABASE_DIR="$TMPDIR_BASE/db"
TEST_CACHE_DIR="$TMPDIR_BASE/cache"
SERVER_LOG="$TMPDIR_BASE/server.log"
mkdir -p "$TEST_DATABASE_DIR" "$TEST_CACHE_DIR"
info "Temp directory: $TMPDIR_BASE"
info "Server log:     $SERVER_LOG"

# ── Server log helper ───────────────────────────────────────────────────────
# Prints the last N lines of the server log to stderr so it appears even when
# stdout has been redirected. Only called on failure paths.
dump_server_log() {
    local lines="${1:-50}"
    if [ -s "$SERVER_LOG" ]; then
        printf "${YELLOW}[test-server]${RESET} ── last %s lines of server log (%s) ──\n" "$lines" "$SERVER_LOG" >&2
        tail -n "$lines" "$SERVER_LOG" >&2
        printf "${YELLOW}[test-server]${RESET} ── end of server log ──\n" >&2
    else
        warn "Server log is empty or missing: $SERVER_LOG" >&2
    fi
}

# ── Find a free port ────────────────────────────────────────────────────────
find_free_port() {
    # Preferred: use Python to let the kernel assign a port.
    if command -v python3 &>/dev/null; then
        python3 -c '
import socket
s = socket.socket()
s.bind(("", 0))
print(s.getsockname()[1])
s.close()
'
        return
    fi
    # Fallback: use Python 2.
    if command -v python &>/dev/null; then
        python -c '
import socket
s = socket.socket()
s.bind(("", 0))
print(s.getsockname()[1])
s.close()
'
        return
    fi
    # Last resort: pick a random port in the dynamic range and hope for the best.
    warn "Python not found; falling back to random port selection."
    echo $(( (RANDOM % 16383) + 49152 ))
}

TEST_PORT="$(find_free_port)"
TEST_BASE_URL="http://localhost:${TEST_PORT}"
info "Using port $TEST_PORT ($TEST_BASE_URL)"

# ── Cleanup function ────────────────────────────────────────────────────────
SERVER_PID=""

cleanup() {
    local exit_code=$?

    if [ -n "$SERVER_PID" ]; then
        # Check if the process is still running.
        if kill -0 "$SERVER_PID" 2>/dev/null; then
            info "Stopping server (PID $SERVER_PID)..."
            kill "$SERVER_PID" 2>/dev/null || true

            # Give it a moment to shut down gracefully.
            local waited=0
            while kill -0 "$SERVER_PID" 2>/dev/null && [ $waited -lt 5 ]; do
                sleep 1
                waited=$((waited + 1))
            done

            # Force-kill if still alive.
            if kill -0 "$SERVER_PID" 2>/dev/null; then
                warn "Server did not exit gracefully; sending SIGKILL..."
                kill -9 "$SERVER_PID" 2>/dev/null || true
            fi
        fi
    fi

    if [ $exit_code -ne 0 ]; then
        # Print server log on any unexpected exit so the cause is visible.
        dump_server_log 80
        error "Exiting with code $exit_code"
    fi

    if [ "$TEST_SERVER_KEEP_TEMP" != "true" ] && [ -d "$TMPDIR_BASE" ]; then
        info "Removing temp directory: $TMPDIR_BASE"
        rm -rf "$TMPDIR_BASE"
    elif [ "$TEST_SERVER_KEEP_TEMP" = "true" ]; then
        info "Keeping temp directory: $TMPDIR_BASE"
    fi

    return $exit_code
}

trap cleanup EXIT INT TERM HUP

if [ -n "${GITHUB_ENV:-}" ]; then
    {
        echo "TEST_SERVER_TMPDIR=$TMPDIR_BASE"
        echo "TEST_SERVER_LOG=$SERVER_LOG"
        echo "TEST_SERVER_DATABASE_DIR=$TEST_DATABASE_DIR"
        echo "TEST_SERVER_CACHE_DIR=$TEST_CACHE_DIR"
    } >> "$GITHUB_ENV"
fi

# ── Start the server ────────────────────────────────────────────────────────
info "Starting server..."

if [ -n "${MEDIA_DIR:-}" ]; then
    bash "$SCRIPT_DIR/ensure-test-playlist.sh" "$MEDIA_DIR"
    export MEDIA_DIR
fi

PORT="$TEST_PORT" \
DATABASE_DIR="$TEST_DATABASE_DIR" \
CACHE_DIR="$TEST_CACHE_DIR" \
METRICS_ENABLED="${METRICS_ENABLED:-false}" \
LOG_HEALTH_CHECKS="${LOG_HEALTH_CHECKS:-false}" \
LOG_LEVEL="$TEST_SERVER_LOG_LEVEL" \
"$BINARY" >"$SERVER_LOG" 2>&1 &

SERVER_PID=$!
info "Server started (PID $SERVER_PID)"

# ── Wait for readiness ──────────────────────────────────────────────────────
READY_URL="${TEST_BASE_URL}/readyz"
TIMEOUT="$TEST_SERVER_READY_TIMEOUT"
INTERVAL=1

info "Waiting for server to be ready at $READY_URL (timeout: ${TIMEOUT}s)..."

elapsed=0
while [ $elapsed -lt $TIMEOUT ]; do
    # Check that the process hasn't crashed.
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        error "Server process exited unexpectedly."
        dump_server_log 80
        exit 1
    fi

    if curl -sf -o /dev/null "$READY_URL" 2>/dev/null; then
        ok "Server is ready (took ${elapsed}s)"
        break
    fi

    sleep "$INTERVAL"
    elapsed=$((elapsed + INTERVAL))
done

if [ $elapsed -ge $TIMEOUT ]; then
    error "Server failed to become ready within ${TIMEOUT}s"
    dump_server_log 80
    exit 1
fi

if [ "$TEST_SERVER_WAIT_FOR_AUTH" = "true" ]; then
    info "Verifying auth endpoint is ready..."
    auth_elapsed=0
    while [ $auth_elapsed -lt $TEST_SERVER_AUTH_TIMEOUT ]; do
        AUTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${TEST_BASE_URL}/api/auth/check" 2>/dev/null)
        if [ "$AUTH_RESPONSE" != "000" ] && [ "$AUTH_RESPONSE" != "502" ] && [ "$AUTH_RESPONSE" != "503" ]; then
            ok "Auth endpoint is ready (HTTP $AUTH_RESPONSE)"
            break
        fi

        sleep "$INTERVAL"
        auth_elapsed=$((auth_elapsed + INTERVAL))
    done

    if [ $auth_elapsed -ge $TEST_SERVER_AUTH_TIMEOUT ]; then
        error "Auth endpoint failed to become ready within ${TEST_SERVER_AUTH_TIMEOUT}s"
        dump_server_log 80
        exit 1
    fi
fi

# ── Run the user-supplied command ────────────────────────────────────────────
# Note: initial password seeding is handled by Playwright's globalSetup
# (e2e/global-setup.js) so it works for any invocation, not only this script.
info "Running: $*"
info "TEST_BASE_URL=$TEST_BASE_URL"

# Export TEST_BASE_URL so the command (and its children) can see it.
# Both Playwright (playwright.config.js) and the vitest integration tests
# (tests/test.config.js) read this variable.
export TEST_BASE_URL

# Run the command, capturing its exit code without letting set -e kill us.
set +e
"$@"
CMD_EXIT=$?
set -e

if [ $CMD_EXIT -eq 0 ]; then
    ok "Command completed successfully."
else
    error "Command failed with exit code $CMD_EXIT."
    dump_server_log 50
fi

# cleanup runs via trap; propagate the command's exit code.
exit $CMD_EXIT
