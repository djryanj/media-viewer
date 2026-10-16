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
make pr-check-fix        # same, but with Go lint autofix
make pr-check-backend    # backend (Go) checks only
make pr-check-backend-fix  # backend checks with lint autofix
make pr-check-frontend   # frontend checks only
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

# Visual regression tests — compare screenshots against baselines in e2e/snapshots/
make frontend-test-e2e-visual          # compare
make frontend-test-e2e-visual-baselines  # regenerate baselines (commits new PNGs)

# Docs screenshot tests — write PNGs directly to docs/images/ for the docs site
make frontend-test-e2e-docs-screenshots          # requires running backend
make frontend-test-e2e-docs-screenshots-auto     # ephemeral backend

# Frontend lint (ESLint) + format (Prettier) + type check (svelte-check)
# All three are required by CI; make pr-check runs all three.
make frontend-lint          # ESLint
make frontend-format-check  # Prettier
make frontend-check         # svelte-check (TypeScript types)
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
- `frontend/src/routes/` — SvelteKit file-based routes (`/`, `login`, `search`, `collections`, `collections/[id]`, `favorites`, `playlists/[name]`)
- `frontend/src/lib/api/` — API client (`client.ts`) and shared types (`types.ts`)
- `frontend/src/lib/stores/` — Svelte 5 rune-based reactive stores (auth, gallery, lightbox, session, settings, toast)
- `frontend/src/lib/components/` — Shared UI components (gallery, lightbox, settings, ui)
- `frontend/e2e/` — Playwright end-to-end tests; baselines in `e2e/snapshots/`
- `frontend/src/tests/` — Vitest unit tests

Settings modal tabs: **Security** · **Passkeys** · **Library** (clock, sort, worker status) · **Tags** · **System** · **About**

**Docker build note:** `.dockerignore` must include `frontend/vite.config.ts` only if you want to exclude it — currently it is *not* excluded, which is required so that the SvelteKit Vite plugin is present during the Docker `npm run build` step. Excluding `vite.config.ts` causes a "Could not resolve entry module 'index.html'" error.

### Database Schema

Core tables: `files` (indexed media), `tags`, `file_tags`, `favorites`, `users`, `sessions`, `webauthn_credentials`, `webauthn_sessions`. Full-text search uses a FTS5 virtual table `files_fts` backed by `files`.

## Important Conventions

**Test-driven development** — write the failing test first (and confirm it fails for the right reason), then make the minimal change to pass it. This applies to bug fixes and features, Go and frontend alike; for a bug, the test reproduces it before the fix.

## Merging Dependency PRs (Dependabot / Renovate)

Before a release, open bot PRs are worked through with these rules:

1. **Changelog.** `.github/workflows/auto-changelog.yml` adds a `CHANGELOG.md` entry to bot PRs (on open/reopen, on a `/auto-changelog` comment, or via `workflow_dispatch` with the PR number). Because every PR edits the same lines, most bot PRs end up with merge conflicts or blocked merges from the changelog. Fix by recreating the PR (rule 2), then re-running auto-changelog if the entry is missing.
2. **Recreate, don't rebase.** Ask the bot to *recreate* the PR (Dependabot: comment `@dependabot recreate`; Renovate: tick the rebase/retry box in the PR body or run the Renovate workflow) rather than rebasing by hand. A recreated PR is rebuilt from current `main`, so all changes (including the changelog) are in the branch, CI runs fresh, and version bumps released since the PR was opened are picked up.
3. **Dedupe first.** Dependabot and Renovate often open PRs for the same dependency. List all open PRs before starting, compare the dependencies each one touches (`gh pr diff <n>`, including grouped PRs such as Renovate's "update go modules" / "all non-major"), keep one, and close the others with a comment saying which PR supersedes them.
4. **Insufficient bot PRs.** A bot PR may bump only part of what a change needs (e.g. a major bump of `@sveltejs/kit` without the matching `adapter-static`, or a `package.json` bump with no lockfile update). Pick one of the related PRs, check out its branch, make all the required changes locally (install/bump every needed package, fix code), run the checks, push to that single PR, and close the rest (or let the bot recreate them and decide for itself).
5. **CI failures.** If CI fails on a bot PR, check the branch out locally and fix whatever is needed rather than waiting on the bot.

**Commit messages** must follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`. Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`. Common scopes: `api`, `database`, `ui`, `thumbnails`, `transcoding`, `search`, `tags`, `favorites`.

**Go version** is enforced — `make build` and `make lint` will fail if your local Go doesn't match `go.mod`. In the devcontainer, rebuild the container to fix mismatches.

**Build tags** — always pass `-tags fts5` for Go builds and tests. The Makefile handles this via `GO_BUILD`, `GO_RUN`, and `GO_TEST` variables.

**Worker sizing** — CPU-bound pools use `GOMAXPROCS(0)` workers, I/O-bound use `2×`, mixed use `1.5×`. Index parallelism is controlled by the `INDEX_WORKERS` env var (default 3, NFS-safe).
