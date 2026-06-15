# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.19.0] - Unreleased


### Changed

- fix(deps): update go modules ([#551](https://github.com/djryanj/media-viewer/pull/551))
### Added

- feat(admin): The footer and Settings → System tab now shows live status for indexing, thumbnail generation, and auto-tagging from one unified system status view, including whether each worker is running or idle plus progress details such as throughput, ETA, last-run information, and direct maintenance actions. This work also adds a single `/api/system/status` backend endpoint in place of the removed `/api/stats`, `/api/thumbnails/status`, and `/api/autotagger/status` endpoints. ([#526](https://github.com/djryanj/media-viewer/issues/526))

### Changed

- feat(frontend): Total rewrite of the frontend using SvelteKit (Svelte 5, TypeScript, Vite). Feature-parity with v0.18.2 with improved performance, accessibility, and maintainability.
- build(deps): bump golang.org/x/image from 0.39.0 to 0.40.0 ([#546](https://github.com/djryanj/media-viewer/pull/546))

## Older

Older changelog entries are in [CHANGELOG-1.md](CHANGELOG-1.md) (versions 0.0.0 – 0.18.2).
