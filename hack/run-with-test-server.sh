#!/usr/bin/env bash
#
# run-with-test-server.sh — Start an ephemeral media-viewer server and run a
# command against it.  Designed for CI / pr-check so that:
#   • The server listens on a random free port (no conflict with make dev).
#   • DATABASE_DIR and CACHE_DIR point at a fresh temp directory.
#   • MEDIA_DIR is inherited from the environment (unchanged).
#   • The server is reliably killed on exit, even on Ctrl-C.
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
BINARY="$PROJECT_ROOT/media-viewer"

# ── Build the server binary ─────────────────────────────────────────────────
info "Building server binary..."
make -C "$PROJECT_ROOT" build
if [ ! -x "$BINARY" ]; then
    error "Build succeeded but binary not found at $BINARY"
    exit 1
fi

# ── Create ephemeral directories ────────────────────────────────────────────
TMPDIR_BASE="$(mktemp -d "${TMPDIR:-/tmp}/media-viewer-test.XXXXXXXXXX")"
TEST_DATABASE_DIR="$TMPDIR_BASE/db"
TEST_CACHE_DIR="$TMPDIR_BASE/cache"
mkdir -p "$TEST_DATABASE_DIR" "$TEST_CACHE_DIR"
info "Temp directory: $TMPDIR_BASE"

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

    if [ -d "$TMPDIR_BASE" ]; then
        info "Removing temp directory: $TMPDIR_BASE"
        rm -rf "$TMPDIR_BASE"
    fi

    if [ $exit_code -ne 0 ]; then
        error "Exiting with code $exit_code"
    fi
    return $exit_code
}

trap cleanup EXIT INT TERM HUP

# ── Start the server ────────────────────────────────────────────────────────
info "Starting server..."

PORT="$TEST_PORT" \
DATABASE_DIR="$TEST_DATABASE_DIR" \
CACHE_DIR="$TEST_CACHE_DIR" \
LOG_LEVEL="${LOG_LEVEL:-warn}" \
"$BINARY" &

SERVER_PID=$!
info "Server started (PID $SERVER_PID)"

# ── Wait for readiness ──────────────────────────────────────────────────────
READY_URL="${TEST_BASE_URL}/readyz"
TIMEOUT=30
INTERVAL=1

info "Waiting for server to be ready at $READY_URL (timeout: ${TIMEOUT}s)..."

elapsed=0
while [ $elapsed -lt $TIMEOUT ]; do
    # Check that the process hasn't crashed.
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        error "Server process exited unexpectedly."
        # Show any logs that might help debug.
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
    exit 1
fi

# ── Run the user-supplied command ────────────────────────────────────────────
info "Running: $*"
info "TEST_BASE_URL=$TEST_BASE_URL"

# Export TEST_BASE_URL so the command (and its children) can see it.
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
fi

# cleanup runs via trap; propagate the command's exit code.
exit $CMD_EXIT
