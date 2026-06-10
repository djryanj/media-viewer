# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Media Viewer is a single-user web application for browsing and viewing images, videos, and playlists. It consists of a Go HTTP backend and a SvelteKit frontend. The backend serves the compiled SvelteKit output as a SPA and exposes a REST API at `/api`.

## Build Commands

All Go operations require the `fts5` build tag (SQLite FTS5 requires CGO):

```bash
# Build binary
make build

# Run backend with hot reload (air) — sets debug logging and WebAuthn dev config
make dev

# Frontend dev server (proxy to Go backend at :8080, must run alongside make dev)
make dev-frontend   # or: make dev-proxy

# Both simultaneously
make dev-full
```

## Testing

```bash
# Run all Go tests
make test

# Run tests for a specific package (short name resolves to ./internal/<pkg>)
make test-package handlers
make test-package database TESTARGS="-run=TestSearch"

# Run with race detector
make test-race

# Run only unit tests (fast, no external deps)
make test-unit

# Go lint
make lint
make lint-fix

# Pre-PR gate — runs lint/test/race for Go changes; check/unit/integration/smoke for frontend changes
make pr-check
make pr-check-fix   # same, but with Go lint autofix
```

Frontend tests (from `frontend/` directory):

```bash
# Unit tests (no backend needed)
cd frontend && npm run test:unit
make frontend-test-unit

# E2E smoke suite (requires running backend)
make frontend-test-e2e-smoke

# E2E with ephemeral auto-managed backend (matches CI)
make frontend-test-e2e-smoke-auto

# Frontend lint/format/type checks
make frontend-check
```

## Architecture

### Backend (`cmd/`, `internal/`)

Entry point is [cmd/media-viewer/main.go](cmd/media-viewer/main.go). It wires up all subsystems and registers routes on a Gorilla Mux router.

Key internal packages:

| Package | Purpose |
|---|---|
| `internal/database` | SQLite via `mattn/go-sqlite3`; single connection with `sync.RWMutex`; FTS5 virtual table for search |
| `internal/handlers` | HTTP request handlers; `handlers.New()` is the main constructor |
| `internal/indexer` | Background directory walker; polls for changes; notifies thumbnail generator and autotagger on completion |
| `internal/media` | Thumbnail generation via govips and FFmpeg; per-file locks prevent duplicate work |
| `internal/transcoder` | HLS video transcoding via FFmpeg; sessions managed at `/api/hls/*` |
| `internal/filesystem` | NFS-resilient wrappers for `os.Stat` and `os.Open` with exponential backoff on ESTALE errors |
| `internal/autotagger` | Reads EXIF/XMP metadata from media files and creates tags automatically |
| `internal/startup` | Config loading, structured startup/shutdown logging |
| `internal/middleware` | Auth, logging, metrics, compression middleware chain |
| `internal/metrics` | Prometheus metrics; served on a separate port (default 9090) |

Authentication uses bcrypt-hashed passwords + SHA-256-hashed session tokens in HTTP-only cookies. WebAuthn/passkey auth is also supported.

The middleware chain order (outermost → innermost): Compression → Logger → Metrics → AuthMiddleware → Router.

### Frontend (`frontend/`)

SvelteKit app compiled with `adapter-static`, output to `frontend/build/`. The Go backend serves this as a SPA with index.html fallback for unknown paths.

During development, `vite dev` runs on port 5173 and proxies `/api`, `/version`, `/thumbnails`, and `/stream` to the Go backend at port 8080.

Structure:
- `frontend/src/routes/` — SvelteKit file-based routes (`login`, `search`, `collections`, `favorites`, `settings`)
- `frontend/src/lib/api/` — API client (`client.ts`) and shared types (`types.ts`)
- `frontend/src/lib/stores/` — Svelte 5 rune-based reactive stores (auth, gallery, lightbox, session, settings, toast)
- `frontend/src/lib/components/` — Shared UI components

> **Note:** The `static/` directory contains an older vanilla JS frontend that is still present. The active frontend being developed is the SvelteKit app in `frontend/`.

### Database Schema

Core tables: `files` (indexed media), `tags`, `file_tags`, `favorites`, `users`, `sessions`, `webauthn_credentials`, `webauthn_sessions`. Full-text search uses a FTS5 virtual table `files_fts` backed by `files`.

## Important Conventions

**Commit messages** must follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`. Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`. Common scopes: `api`, `database`, `ui`, `thumbnails`, `transcoding`, `search`, `tags`, `favorites`.

**Go version** is enforced — `make build` and `make lint` will fail if your local Go doesn't match `go.mod`. In the devcontainer, rebuild the container to fix mismatches.

**Build tags** — always pass `-tags fts5` for Go builds and tests. The Makefile handles this via `GO_BUILD`, `GO_RUN`, and `GO_TEST` variables.

**Worker sizing** — CPU-bound pools use `GOMAXPROCS(0)` workers, I/O-bound use `2×`, mixed use `1.5×`. Index parallelism is controlled by the `INDEX_WORKERS` env var (default 3, NFS-safe).
