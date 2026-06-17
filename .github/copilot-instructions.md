# Copilot Instructions

Use these as project-level defaults when editing or testing this repository.

## Source Of Truth

- Treat `cmd/media-viewer/main.go` route wiring and handler code as the source of truth for API paths and methods; `docs/swagger.json` may drift.
- For JSON field names and response shapes, prefer `internal/database/models.go` tags and the actual handler response envelopes over older docs.

## Commands

- Prefer repository `make` targets over direct `npm` commands when both exist; use the Makefile entry point unless there is a specific reason to call the underlying npm script directly.
- For containerized browser smoke coverage, use `make frontend-test-e2e-runtime-smoke` or `make frontend-test-e2e-runtime-smoke-auto`; the Playwright-based runtime smoke lane is the maintained path, not ad hoc shell smoke scripts.

## Autotagger And Metadata

- Treat `internal/autotagger/exif.go` as the source of truth for metadata extraction order: `exiftool` is the primary extractor for still images, while `ffprobe` is the fallback for still images and the primary extractor for video/container metadata.
- For runtime image changes, Alpine must install the `exiftool` package; `perl-image-exiftool` does not provide `/usr/bin/exiftool`. The Debian/NVIDIA image should continue using `libimage-exiftool-perl`.
- AutoTagger metadata extraction on NFS/PVC-style storage should preflight file access with `filesystem.StatWithRetry` and retry transient extractor failures such as stale file handle, input/output error, resource temporarily unavailable, and deadline timeouts.
- Keep WebP autotagger coverage exercised through XMP `Subject` metadata written with `exiftool`; that path has caught real still-image regressions.

## Changelog

- Keep changelog entries business-focused and user-facing rather than implementation-heavy technical detail.
- Include a GitHub issue reference for changelog entries.
- If the user asks for a changelog entry but does not provide a GitHub issue number, ask for one before adding the entry.

## Playwright And E2E

- Scope gallery-item selectors to `#gallery` when you mean the main grid; the favorites strip also contains `.gallery-item` nodes.
- `/api/media` returns a paged envelope. Helpers that open media outside the current in-memory listing should unwrap `data.items ?? []` and use `limit=0` when they need full parent-directory ordering.
- For stateful or mutation-heavy UI tests, prefer stable runtime helpers and API seeding over brittle toolbar/context-menu clicks. Examples already used in the repo include `ItemSelection`, `Tags`, and `Gallery.handleSingleTap(...)`.
- If a Playwright spec mutates shared backend state multiple times in one file, keep that file serial with `test.describe.configure({ mode: 'serial' })`.
- Settings toggles often use visually hidden checkbox inputs. Assert visible rows, labels, or select state rather than requiring visible checkbox inputs.
- Use `TEST_BASE_URL` for local/ephemeral server Playwright runs.
- Docker/runtime smoke should validate behavior through the shipped container via `hack/run-with-docker-test-server.sh`, including real metadata extraction, rather than only checking host-backed binaries or startup health.

## Docs Screenshots And Visual Baselines

- Docs screenshots live under `frontend/e2e/` and write directly to `docs/images/`.
- Visual regressions live under `frontend/e2e/` and compare PNG baselines stored in `frontend/e2e/snapshots/`.
- Both lanes are Chromium-only. Keep screenshot and visual states deterministic with API seeding or explicit runtime state setup before capture.

## SQLite And Storage Safety

- SQLite mmap is auto-disabled in startup when `DATABASE_DIR` resolves to detected unsafe Linux filesystems such as NFS, SMB/CIFS, or 9P/WSL. Preserve that behavior when changing startup or database initialization.
- Explicit `DB_MMAP_DISABLED=true` or `false` still overrides the auto-detection path; keep that override behavior intact.

## Startup Logging

- Keep startup-time component initialization banners and required-tool availability logs centralized in `internal/startup` rather than emitting them from runtime component packages.
- EXIF auto-tagger startup logging should follow the same pattern as transcoder and thumbnail initialization: `internal/startup` owns the initialization section and tool checks, while `internal/autotagger` keeps ongoing runtime/pass logs only.

## UI And UX Guardrails

- Collections UX should follow the same patterns as tags/favorites instead of inventing separate one-off interaction models.
- Single-item collection management should be membership-first; bulk collection flows should preserve selection state until the action succeeds or is dismissed.
- In an active collection context, prioritize current-collection actions before secondary add-to-other-collection actions.
- Avoid icon-only critical controls unless they have a stable readable label or text fallback.
- When extending complex modals, keep section boxing, footer padding, and mobile safe-area spacing visually consistent.
