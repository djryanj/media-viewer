# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.19.1] - Unreleased

- build(deps): bump node from 22-bookworm-slim to 26-bookworm-slim ([#569](https://github.com/djryanj/media-viewer/pull/569))
- chore: clean up old legacy vanilla JS code ([#572](https://github.com/djryanj/media-viewer/issues/572))

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
