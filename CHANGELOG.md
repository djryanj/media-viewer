# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.19.5] - Unreleased

### Changed

- chore(deps): update github actions ([#605](https://github.com/djryanj/media-viewer/pull/605))
- chore(deps): update all non-major dependencies ([#606](https://github.com/djryanj/media-viewer/pull/606))
- build(deps): bump github.com/mattn/go-sqlite3 from 1.14.47 to 1.14.48 ([#616](https://github.com/djryanj/media-viewer/pull/616))
- build(deps): bump actions/setup-python from 6.2.0 to 7.0.0 ([#617](https://github.com/djryanj/media-viewer/pull/617))
- build(deps): bump actions/setup-go from 6.4.0 to 7.0.0 ([#618](https://github.com/djryanj/media-viewer/pull/618))
- chore(deps): update ghcr.io/devcontainers/features/docker-in-docker docker tag to v4 ([#619](https://github.com/djryanj/media-viewer/pull/619))
- build(deps): bump github.com/prometheus/client_golang from 1.23.2 to 1.24.1 ([#620](https://github.com/djryanj/media-viewer/pull/620))

## [0.19.4] - 07-26-2026

### Fixed

- fix(indexer): change detection no longer stats every top-level directory on every poll. With `POLL_INTERVAL` at its 30s default that was 2,880 stat calls per directory per day — a permanent background load on large libraries, and pure round-trip cost on network mounts. Each poll now sweeps a bounded window of 64 directories and the next one resumes where it left off, so the whole tree is still covered at a fraction of the rate. A newly appeared directory is also detected from its name alone, with no stat at all. ([#621](https://github.com/djryanj/media-viewer/issues/621))
- fix(indexer): a subdirectory that fails to stat during change detection is now logged and counted instead of being silently skipped. A dangling symlink, a removed directory, or a stale filehandle failed on every poll indefinitely with no trace in the logs or metrics, hiding a permanent source of filesystem errors. New counters: `media_viewer_indexer_poll_subdir_stats_total` and `media_viewer_indexer_poll_stat_errors_total`. ([#621](https://github.com/djryanj/media-viewer/issues/621))
- fix(indexer): image files are no longer re-opened on every index run to content-sniff them. The GIF-in-a-.jpg check required an `open()`+`read()` of every image in the library every `INDEX_INTERVAL` (30m by default); the result is now reused when a file's size and modification time are unchanged since the previous run. Files that have changed on disk are still sniffed. New counters: `media_viewer_indexer_sniff_cache_hits_total` and `media_viewer_indexer_sniff_opens_total`. Note that extending the sniff to recognise a new format now requires an index rebuild to reclassify existing files. ([#621](https://github.com/djryanj/media-viewer/issues/621))
- fix(thumbnails): serving a cached thumbnail no longer touches the media volume. Each request previously stat'd the source file twice — once in the HTTP handler and once inside the generator — both before the local cache was consulted, so a gallery of 100 cached thumbnails cost 200 filesystem round-trips. The cache is now read first and the source is validated only on a cache miss, where it has to be read anyway. Response codes are unchanged: missing files still return 404, and a path indexed as a file but present on disk as a directory still returns 400. ([#621](https://github.com/djryanj/media-viewer/issues/621))

## [0.19.3] - 07-09-2026

### Changed

- build(deps): bump golang.org/x/image from 0.43.0 to 0.44.0 ([#589](https://github.com/djryanj/media-viewer/pull/589))
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
