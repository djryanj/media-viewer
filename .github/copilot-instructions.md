# Copilot Instructions

Use these as project-level defaults when editing or testing this repository.

## Source Of Truth

- Treat `cmd/media-viewer/main.go` route wiring and handler code as the source of truth for API paths and methods; `docs/swagger.json` may drift.
- For JSON field names and response shapes, prefer `internal/database/models.go` tags and the actual handler response envelopes over older docs.

## Commands

- Prefer repository `make` targets over direct `npm` commands when both exist; use the Makefile entry point unless there is a specific reason to call the underlying npm script directly.

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

## Docs Screenshots And Visual Baselines

- Docs screenshots live under `static/e2e/specs/workflows/` and write directly to `docs/images/`.
- Visual regressions live under `static/e2e/specs/visual/` and compare deterministic JSON snapshots stored in `static/e2e/baselines/`.
- Both lanes are Chromium-only. Keep screenshot and visual states deterministic with API seeding or explicit runtime state setup before capture.

## UI And UX Guardrails

- Collections UX should follow the same patterns as tags/favorites instead of inventing separate one-off interaction models.
- Single-item collection management should be membership-first; bulk collection flows should preserve selection state until the action succeeds or is dismissed.
- In an active collection context, prioritize current-collection actions before secondary add-to-other-collection actions.
- Avoid icon-only critical controls unless they have a stable readable label or text fallback.
- When extending complex modals, keep section boxing, footer padding, and mobile safe-area spacing visually consistent.
