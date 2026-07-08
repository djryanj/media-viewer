# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.19.3] - Unreleased

### Changed

- build(deps): bump actions/checkout from 6.0.3 to 7.0.0 ([#590](https://github.com/djryanj/media-viewer/pull/590))
- build(deps): bump renovatebot/github-action from 46.1.16 to 46.1.18 ([#593](https://github.com/djryanj/media-viewer/pull/593))
- chore(deps): update dependency eslint to v10 ([#595](https://github.com/djryanj/media-viewer/pull/595))
- chore(deps): update dependency globals to v17 ([#596](https://github.com/djryanj/media-viewer/pull/596))
- chore(deps): update dependency prettier-plugin-svelte to v4 ([#597](https://github.com/djryanj/media-viewer/pull/597))
- chore(deps): update vite to v8, @sveltejs/vite-plugin-svelte to v7, and svelte minimum to v5.46.4 ([#599](https://github.com/djryanj/media-viewer/pull/599))
- chore(deps): update node.js to v24.18.0 ([#586](https://github.com/djryanj/media-viewer/pull/586))
- chore(deps): update all non-major dependencies ([#585](https://github.com/djryanj/media-viewer/pull/585))
- chore(deps): update github actions ([#583](https://github.com/djryanj/media-viewer/pull/583))

### Fixed

- fix(build): convert `manualChunks` in vite.config.ts from object to function form (rolldown/vite 8 breaking change) ([#599](https://github.com/djryanj/media-viewer/pull/599))
- fix(ci): auto-changelog action now correctly targets the unreleased version block (`## [X.Y.Z] - Unreleased` format), creates one when none exists rather than appending to a released version, and no longer fails the workflow when PR comment permissions are denied ([#599](https://github.com/djryanj/media-viewer/pull/599))
- fix(ui): search results are now properly sortable and display the correct number of returned results in the footer. [#157](https://github.com/djryanj/media-viewer/issues/157)
- fix(ui): search suggestions now appear while typing on the search page on mobile, where the header search bar is hidden. [#601](https://github.com/djryanj/media-viewer/issues/601)

## [0.19.2] - 06-18-2026

- fix(ui): there are 2 "s"'s in the version display ([#577](https://github.com/djryanj/media-viewer/issues/577))
- fix(ui): when loading a video that needs transcoding on the server, there was just a long pause rather than some kind of notification that it was loading. ([#578](https://github.com/djryanj/media-viewer/issues/578))

## [0.19.1] - 06-18-2026

- build(deps): bump node from 22-bookworm-slim to 26-bookworm-slim ([#569](https://github.com/djryanj/media-viewer/pull/569))
- chore: clean up old legacy vanilla JS code ([#572](https://github.com/djryanj/media-viewer/issues/572))
- fix(ui): passkey authorization flow will auto-trigger if available ([#570](https://github.com/djryanj/media-viewer/issues/570))
- fix(ui): when exiting the lightbox, the gallery view should be centered on the last item viewed. [#571](https://github.com/djryanj/media-viewer/issues/571)

## [0.19.0] - 06-15-2026

### Changed

- build(deps): bump alpine from 3.23 to 3.24 ([#565](https://github.com/djryanj/media-viewer/pull/565))
- chore(deps): update dependency eslint-plugin-jsdoc to v63 ([#553](https://github.com/djryanj/media-viewer/pull/553))
- build(deps): bump mikepenz/release-changelog-builder-action from 6.2.1 to 6.2.2 ([#550](https://github.com/djryanj/media-viewer/pull/550))
- fix(deps): update go modules ([#551](https://github.com/djryanj/media-viewer/pull/551))
- fix(deps): update all non-major dependencies ([#549](https://github.com/djryanj/media-viewer/pull/549))
- chore(deps): update node.js to v24.16.0 ([#552](https://github.com/djryanj/media-viewer/pull/552))

### Added

- feat(admin): The footer and Settings → System tab now shows live status for indexing, thumbnail generation, and auto-tagging from one unified system status view, including whether each worker is running or idle plus progress details such as throughput, ETA, last-run information, and direct maintenance actions. This work also adds a single `/api/system/status` backend endpoint in place of the removed `/api/stats`, `/api/thumbnails/status`, and `/api/autotagger/status` endpoints. ([#526](https://github.com/djryanj/media-viewer/issues/526))

### Changed

- feat(frontend): Total rewrite of the frontend using SvelteKit (Svelte 5, TypeScript, Vite). Feature-parity with v0.18.2 with improved performance, accessibility, and maintainability.
- build(deps): bump golang.org/x/image from 0.39.0 to 0.40.0 ([#546](https://github.com/djryanj/media-viewer/pull/546))

## Older

Older changelog entries are in [CHANGELOG-1.md](CHANGELOG-1.md) (versions 0.0.0 – 0.18.2).
