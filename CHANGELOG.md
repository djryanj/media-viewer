# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.18.1] - unreleased


### Changed

- chore(deps): update github actions ([#519](https://github.com/djryanj/media-viewer/pull/519))
- chore(deps): update node.js to v24.15.0 ([#520](https://github.com/djryanj/media-viewer/pull/520))
- build(deps): bump github.com/go-webauthn/webauthn from 0.16.4 to 0.17.0 ([#521](https://github.com/djryanj/media-viewer/pull/521))
- build(deps): bump renovatebot/github-action from 46.1.9 to 46.1.12 ([#522](https://github.com/djryanj/media-viewer/pull/522))
- build(deps): bump actions/setup-node from 6.3.0 to 6.4.0 ([#523](https://github.com/djryanj/media-viewer/pull/523))
- build(deps): bump github.com/mattn/go-sqlite3 from 1.14.42 to 1.14.44 ([#527](https://github.com/djryanj/media-viewer/pull/527))
### Added

- feat(api): The auto-tagger now exposes a status endpoint so admin tooling and automated smoke coverage can tell when an on-demand pass is still running and when it last completed, instead of polling for tag changes blindly. ([#524](https://github.com/djryanj/media-viewer/issues/524))

### Fixed

- fix(frontend): Tagging and pasting tags deep into very large galleries is now much faster and uses less browser memory. Tag writes now reuse updated tag data returned by the server instead of triggering extra follow-up reloads, background gallery tag-chip updates are deferred out of the hot path, and the infinite gallery now keeps only a bounded visible slice of loaded items mounted so deep positions no longer force the browser to repaint and retain thousands of off-screen cards at once. ([#524](https://github.com/djryanj/media-viewer/issues/524))

## [0.18.0] - 04-13-2026

### Changed

- chore(deps): update github actions ([#510](https://github.com/djryanj/media-viewer/pull/510))
- chore(deps): update all non-major dependencies ([#511](https://github.com/djryanj/media-viewer/pull/511))
- chore(deps): update dependency go to v1.26.2 ([#512](https://github.com/djryanj/media-viewer/pull/512))
- chore(deps): update github actions (major) ([#514](https://github.com/djryanj/media-viewer/pull/514))
- fix(deps): update go modules ([#513](https://github.com/djryanj/media-viewer/pull/513))

### Added

- feat(frontend): Mobile gallery and lightbox touch interactions have been redesigned for clarity and focus. Gallery cards on touch devices no longer show persistent collection or selection icons — tapping opens media and long-pressing enters selection mode. The scroll-restore prompt is now a compact anchored chip alongside the scrubber rather than a heavy floating card. The lightbox consolidates all single-item actions (Favorite, Tags, Collections, Download, Autoplay, Loop) into a single labeled bottom-sheet drawer opened from one button in the top chrome, replacing scattered icon-only controls spread across screen edges. Navigation arrows stay hidden by default so media stays primary. ([#509](https://github.com/djryanj/media-viewer/issues/509))

### Fixed

- fix(backend): Startup logs now report `exiftool` and `ffprobe` availability alongside the rest of the server's initialization checks, making it easier to confirm metadata extraction readiness in local and container deployments. The startup logging for these checks is also now centralized so component initialization output stays consistent. ([#507](https://github.com/djryanj/media-viewer/issues/507))

## [0.17.2] - 04-11-2026

### Fixed

- fix(frontend): Tagging from the lightbox now shows the same recent tags and related tag suggestions as the main gallery tagging flow, so autocomplete help stays consistent no matter where you add tags. ([#502](https://github.com/djryanj/media-viewer/issues/502))
- fix(backend): Auto-tagger runs are now more reliable on network-backed media storage. Still images now prefer `exiftool` for embedded metadata with `ffprobe` as fallback, runtime images validate that `exiftool` is actually available (it previously wasn't in many older image builds), and startup now automatically disables risky SQLite mmap behavior on unsafe Linux mounts such as NFS, SMB/CIFS, and WSL/9P to avoid storage-related indexing crashes. Progress logging during long scans is also cleaner. ([#504](https://github.com/djryanj/media-viewer/issues/504))

## Changed

- test(ci): CI and release now run Docker-backed smoke coverage against both the standard and NVIDIA images, combining the normal Chromium smoke flow with runtime metadata checks so regressions between local-host test runs and shipped containers are caught earlier. Frontend test setup is also prepared once and reused across jobs so these container checks start sooner and finish faster. ([#504](https://github.com/djryanj/media-viewer/issues/504))

## [0.17.1] - 04-09-2026

### Changed

- test(ci): Tagged releases now rerun the stable Chromium smoke suite before publishing, and CI now includes scheduled and manually triggered browser performance checks so regressions in key frontend workflows are more likely to be caught before release. ([#493](https://github.com/djryanj/media-viewer/issues/493))
- fix(backend): Auto-tagger runs are now easier to monitor. Server logs report full and incremental pass start/progress/completion details, and Prometheus now exposes current-run and last-run counts so long-running metadata tagging work is easier to understand and troubleshoot. ([#495](https://github.com/djryanj/media-viewer/issues/495))

### Fixed

- fix(docs): Documentation pages deployed to static hosting now load images from the correct path. ([#497](https://github.com/djryanj/media-viewer/issues/497))

## [0.17.0] - 04-08-2026

### Added

- feat: Media files can now be automatically tagged from embedded metadata. When the library is indexed, any tags encoded in a file's EXIF/XMP description field are merged into its tag set — no manual steps required. Tags from Lightroom, digiKam, Apple Photos, and similar tools that use standard keyword fields are also picked up automatically. Auto-tagging runs after every index pass and on a configurable periodic interval, and can be triggered on demand from the new "Run Auto-Tagger" button in Settings → Cache. ([#151](https://github.com/djryanj/media-viewer/issues/151))

### Changed

- build(deps): bump github.com/mattn/go-sqlite3 from 1.14.40 to 1.14.41 ([#487](https://github.com/djryanj/media-viewer/pull/487))
- build(deps): bump renovatebot/github-action from 46.1.7 to 46.1.8 ([#488](https://github.com/djryanj/media-viewer/pull/488))
- test(frontend): The Playwright test workflow has been overhauled and stabilized. PRs now have a dedicated Chromium smoke lane, default E2E runs are split from visual-regression, docs-screenshot, and performance lanes, the static E2E coverage report is now trustworthy, and coverage has been expanded across collections, paginated search, playlist, and tags/favorites flows including tag-tooltip behavior. Contributor docs and the PR template were updated to match the new expectations. ([#289](https://github.com/djryanj/media-viewer/issues/289))
- fix(deps): update go modules ([#484](https://github.com/djryanj/media-viewer/pull/484))
- chore(deps): update docker/login-action action to v4.1.0 ([#483](https://github.com/djryanj/media-viewer/pull/483))
- chore(deps): update all non-major dependencies ([#482](https://github.com/djryanj/media-viewer/pull/482))

### Fixed

- fix(frontend): The lightbox's top-left action icons now stay aligned in a single toolbar instead of overlapping or drifting out of sync between desktop and mobile layouts. Pin, tag, autoplay, loop, and collections controls now share the same toolbar layout and sizing rules, and the change is covered by updated docs screenshots plus new layout and visual-regression tests. ([#490](https://github.com/djryanj/media-viewer/issues/490))
- fix(frontend): Overflow tag tooltips now load and initialize correctly on the main page, including after the DOM is already ready, so tooltip search/remove behavior works reliably in the app and in end-to-end coverage. ([#289](https://github.com/djryanj/media-viewer/issues/289))
- fix(frontend): Opening media via its parent directory now correctly handles both paged `/api/media` envelopes and plain array payloads when reconstructing the lightbox item list, fixing a gallery/lightbox fallback regression uncovered by the new frontend tests. ([#289](https://github.com/djryanj/media-viewer/issues/289))

## [0.16.1] - 04-04-2026

### Added

- feat(frontend): tagging workflows now surface browser-local recent tags and related co-occurring tag suggestions near the top of the tag UI, including grouped ranking for empty and typed states in single-item, bulk, and lightbox flows. The release also adds the supporting `POST /api/tags/suggestions` API, updated docs, and expanded automated coverage for tagging screenshots and suggestion behavior. ([#149](https://github.com/djryanj/media-viewer/issues/149))

## [0.16.0] - 04-04-2026

### Added

- feat(frontend): added a full Collections workflow for saving custom groups of images and videos. You can now create collections from the gallery, manage them from collected items, browse them in their own ordered view, reorder items more directly, and work with the same collections from the lightbox. Recent collections are surfaced first to make repeat organizing faster, and collections stay tied to a single folder so they remain predictable. ([#87](https://github.com/djryanj/media-viewer/issues/87))

## [0.15.7] - 04-01-2026

### Added

- test: added basic playwright tests. Not all working yet. [#289](https://github.com/djryanj/media-viewer/issues/289)

### Changed

- build(deps): bump renovatebot/github-action from 46.1.5 to 46.1.7 ([#476](https://github.com/djryanj/media-viewer/pull/476))
- chore(deps): update node.js to v24.14.1 ([#472](https://github.com/djryanj/media-viewer/pull/472))
- build(deps): bump actions/setup-go from 6.3.0 to 6.4.0 ([#474](https://github.com/djryanj/media-viewer/pull/474))
- chore(deps): update module github.com/golangci/golangci-lint to v2.11.4 ([#465](https://github.com/djryanj/media-viewer/pull/465))
- chore(deps): update github actions ([#471](https://github.com/djryanj/media-viewer/pull/471))
- chore(deps): update all non-major dependencies ([#467](https://github.com/djryanj/media-viewer/pull/467))
- build(deps): bump github.com/mattn/go-sqlite3 from 1.14.34 to 1.14.37 ([#461](https://github.com/djryanj/media-viewer/pull/461))
- fix(deps): update go modules ([#473](https://github.com/djryanj/media-viewer/pull/473))
- build(deps): bump golang.org/x/image from 0.37.0 to 0.38.0 ([#468](https://github.com/djryanj/media-viewer/pull/468))
- chore(deps): update github actions ([#464](https://github.com/djryanj/media-viewer/pull/464))
- build(deps): bump anchore/sbom-action from 0.23.1 to 0.24.0 ([#470](https://github.com/djryanj/media-viewer/pull/470))
- chore(deps): update all non-major dependencies ([#457](https://github.com/djryanj/media-viewer/pull/457))
- fix(deps): update go modules ([#456](https://github.com/djryanj/media-viewer/pull/456))
- chore(deps): update module github.com/golangci/golangci-lint to v2.11.3 ([#455](https://github.com/djryanj/media-viewer/pull/455))
- chore(deps): update github actions ([#454](https://github.com/djryanj/media-viewer/pull/454))
- chore(deps): update dorny/paths-filter action to v4 ([#458](https://github.com/djryanj/media-viewer/pull/458))
- build(deps): bump docker/setup-buildx-action from 3.12.0 to 4.0.0 ([#450](https://github.com/djryanj/media-viewer/pull/450))
- build(deps): bump renovatebot/github-action from 46.1.3 to 46.1.4 ([#449](https://github.com/djryanj/media-viewer/pull/449))
- build(deps): bump anchore/sbom-action from 0.23.0 to 0.23.1 ([#448](https://github.com/djryanj/media-viewer/pull/448))
- chore(deps): update github actions (major) ([#447](https://github.com/djryanj/media-viewer/pull/447))
- chore(deps): update module github.com/golangci/golangci-lint to v2.11.2 ([#446](https://github.com/djryanj/media-viewer/pull/446))
- chore(deps): update github actions ([#445](https://github.com/djryanj/media-viewer/pull/445))
- chore(deps): update all non-major dependencies ([#444](https://github.com/djryanj/media-viewer/pull/444))

### Added

- feat(backend): GIF files are now correctly played as video regardless of their file extension. Files with image extensions (e.g. `.jpg`) that are actually GIFs are detected by their content during indexing and transcoded to H.264 for smooth HLS playback. Previously these files would be displayed as broken images. [#459](https://github.com/djryanj/media-viewer/issues/459)

### Fixed

- fix(backend): HLS video streaming now starts playback faster and pauses less between segments. Segment length has been reduced from 6 seconds to 2 seconds, and the server now buffers two segments before handing the playlist to the player, giving a consistent 4-second head start over the encoder. Previously the player would frequently stall after the first segment while waiting for the next one to finish encoding. [#459](https://github.com/djryanj/media-viewer/issues/459)
- fix(backend): Videos that required transcoding to H.264 from palette-based pixel formats (such as GIF) would fail to play in Firefox and other browsers due to an incompatible H.264 profile (High 4:4:4 Predictive). The transcoder now forces `yuv420p` colour format on all re-encode paths, producing the universally-supported High profile instead. [#459](https://github.com/djryanj/media-viewer/issues/459)
- fix(backend): After a GIF file was reclassified as video during re-indexing, the browser would continue to display it as a broken image until a hard refresh because the cached API response had not changed (same file modification time). The server-side ETag for file listings now incorporates each item's media type, so reclassification correctly invalidates the browser cache. [#459](https://github.com/djryanj/media-viewer/issues/459)
- fix(build): `make pr-check` no longer reports success when a sub-check (e.g. `make test`) fails. Previously, `set -e` was silently ignored inside shell `if` blocks, allowing a failing step to be swallowed and the success message to print regardless. Steps now use explicit `|| exit 1` so any failure immediately halts the recipe with a non-zero exit code.
- feat(backend): Three new Prometheus metrics added to distinguish NFS/storage latency from CPU/goroutine scheduling pressure during directory walks. `media_viewer_indexer_dir_stat_duration_seconds` (histogram) times each `d.Info()` call — a high P99 indicates slow NFS GETATTR round-trips. `media_viewer_indexer_job_queue_wait_seconds` (histogram) times how long each walk job waits in the worker channel before being picked up — a high P99 with a low stat P99 points to CPU or goroutine scheduling starvation rather than storage slowness. `media_viewer_indexer_walk_phase_duration_seconds` (gauge) records the total walk phase duration from the last index run, excluding the database insert phase; comparing it against `media_viewer_indexer_last_run_duration_seconds` isolates whether slow runs are caused by the walk or the DB writes. All three are visualised in a new "NFS & Walk Diagnostics" row in the Grafana dashboard. [#441](https://github.com/djryanj/media-viewer/issues/441)
- feat(frontend): Favorites in the strip can now be drag-and-drop reordered. On desktop, drag any favorite thumbnail left or right; a coloured bar indicates where it will land. On touch devices, long-press a thumbnail (≥ 300 ms without significant movement) to lift it into drag mode, then drag to the desired position and release. The new order is persisted immediately via `PUT /api/favorites/order`. A new `position` column is added to the `favorites` database table; existing installations are migrated automatically at startup, preserving the current display order. [#421](https://github.com/djryanj/media-viewer/issues/421)
- fix(frontend): Tags modal in both the gallery and lightbox views tended to hide behind the soft keyboard on mobile. This has been fixed. [#439](https://github.com/djryanj/media-viewer/issues/439)

## [0.15.6] - 03-07-2026

### Changed

- fix(backend): Server startup no longer blocks the health check for an entire index run. If a database exists with items, it returns healthy as soon as the server is online. If it's a new database, the health check will block for 500 items indexed, 30 seconds, or the index being completed, whichever is shorter. The indexer also logs much better what it's doing, whereas before it was kind of a black hole. [#436](https://github.com/djryanj/media-viewer/issues/436)

## [0.15.5] - 03-07-2026

### Added

- feat(frontend): Closing the lightbox after navigating through images now scrolls the gallery back to the item that was open, keeping it centred in the viewport. Previously the gallery remained at the scroll position from when the lightbox was first opened. [#420](https://github.com/djryanj/media-viewer/issues/420)
- feat(frontend): Swiping down in the lightbox now closes it. The lightbox follows the finger in real time, fading slightly as it moves. Releasing before the threshold (120 px or 30 % of screen height) or reversing direction snaps it back; releasing past the threshold or flicking quickly (≥ 0.5 px/ms) slides it off screen and closes it. A fast swipe in the opposite direction (horizontal) is unaffected — the gesture recogniser commits to horizontal or vertical on the first 10 px of movement, keeping swipe-navigation and swipe-to-close mutually exclusive. [#419](https://github.com/djryanj/media-viewer/issues/419)
- feat(backend): Five new Prometheus metrics added to surface WAL checkpoint behaviour and writer-pool contention — the root cause of the cold-start indexing regression ([#432](https://github.com/djryanj/media-viewer/issues/432)). `media_viewer_db_wal_checkpoint_total{mode}` and `media_viewer_db_wal_checkpoint_duration_seconds{mode}` replace the previous un-labelled counter and histogram, adding a `mode` label (`"passive"` / `"truncate"`) so each checkpoint type can be tracked independently (a non-zero rate for `mode="truncate"` during normal writes is an immediate red flag). `media_viewer_db_wal_checkpoint_blocked_total` counts checkpoints where `busy > 0`, meaning at least one WAL frame was left behind because an active reader held a snapshot — a sustained rate indicates WAL growth pressure. `media_viewer_db_writer_wait_total` and `media_viewer_db_writer_wait_seconds_total` mirror the cumulative `sql.DBStats.WaitCount` / `WaitDuration` for the single writer connection pool; a spike in their rate during bulk indexing is a direct indicator that the writer was held by a blocking operation. Example PromQL queries are documented in the package doc. [#432](https://github.com/djryanj/media-viewer/issues/432)

### Changed

- refactor(backend): The custom background WAL checkpoint worker introduced in 0.15.2 has been removed. Re-enabling SQLite's built-in `wal_autocheckpoint` at a higher threshold (4 000 pages, ~16 MB) replaces it with no observable correctness regression. The `WAL_CHECKPOINT_INTERVAL_SECONDS` environment variable is no longer recognised; existing deployments that set it can remove it safely — the value is now silently ignored. [#432](https://github.com/djryanj/media-viewer/issues/432)
- refactor(backend): The Vacuum function was removed from the database as it was not used. [#432](https://github.com/djryanj/media-viewer/issues/432)
- build(deps): pin Go toolchain to 1.26.1 and introduce better DX to inform if go.mod and local Go versions don't match. ([#425](https://github.com/djryanj/media-viewer/issues/425))
- build(deps): bump renovatebot/github-action from 46.1.2 to 46.1.3 ([#406](https://github.com/djryanj/media-viewer/pull/406))
- build(deps): bump actions/setup-node from 6.2.0 to 6.3.0 ([#405](https://github.com/djryanj/media-viewer/pull/405))
- build(deps): bump docker/setup-qemu-action from 3.7.0 to 4.0.0 ([#404](https://github.com/djryanj/media-viewer/pull/404))
- build(deps): bump docker/login-action from 3.7.0 to 4.0.0 ([#403](https://github.com/djryanj/media-viewer/pull/403))

### Fixed

- fix(frontend): In the lightbox on mobile, tapping where the controls (close, tag, pin, download) would appear while they are hidden now restores the controls instead of closing the lightbox. Previously, because hidden controls have `pointer-events: none`, taps in that area passed through to the lightbox background and triggered the close action. [#429](https://github.com/djryanj/media-viewer/issues/429)
- fix(backend): `media_viewer_db_transaction_duration_seconds` now correctly distinguishes batch upsert transactions (`type="batch_insert"`) from cleanup transactions (`type="cleanup"`). Previously `EndBatch` always recorded `type="commit"` regardless of context, leaving the `batch_insert`, `batch_update`, and `cleanup` label series permanently at zero even though they were pre-seeded in the metrics output. A new `SetTxType` method on `BatchInserter` carries the intended label through to `EndBatch`; callers that do not call `SetTxType` continue to emit `type="commit"` unchanged. [#432](https://github.com/djryanj/media-viewer/issues/432)
- fix(backend): The WAL file no longer stays at its bulk-index high-water mark after startup indexing completes. `BulkIndexEnd` uses a `PASSIVE` checkpoint (which copies WAL frames to the main database file but never truncates the WAL file on disk), so a 40 k-file initial index could leave a ~250 MB WAL file permanently occupying disk space even though its content had been fully checkpointed. Root cause: `wal_autocheckpoint=0` (introduced in 0.15.2 to suppress the ~92 ms commit spike) also prevented SQLite from ever reclaiming WAL disk space on its own. Fix is two-pronged: (1) `wal_autocheckpoint` is re-enabled at a higher threshold (`wal_autocheckpoint=4000`, ~16 MB) so routine writes don't accumulate unboundedly — note that autocheckpoint always uses `PASSIVE` mode and therefore also does not physically truncate the WAL file; (2) after `BulkIndexEnd`'s synchronous `PASSIVE` checkpoint returns, a background goroutine runs a `TRUNCATE` checkpoint to physically shrink the WAL file once in-flight reader snapshots (thumbnail generation etc.) drain. The goroutine is launched from inside `BulkIndexEnd` so the indexer is not blocked; reader transactions typically release their WAL snapshot within milliseconds of the passive checkpoint completing. The custom background checkpoint worker and its `WAL_CHECKPOINT_INTERVAL_SECONDS` configuration knob have been removed. [#432](https://github.com/djryanj/media-viewer/issues/432)
- fix(backend): Full thumbnail generation progress logs now show the correct denominator (e.g., `500/36000`) instead of reporting the numerator and denominator as equal (e.g., `500/500`, `1000/1000`). The total file count is now determined with a single `COUNT(*)` query before the pagination loop begins, rather than being accumulated one page at a time in lockstep with the processed count. [#431](https://github.com/djryanj/media-viewer/issues/431)
- perf(backend): Cold-start indexing of large NFS libraries (40 k+ files) was degraded from ~30–60 s to ~10 minutes. The background WAL checkpoint worker was calling the `Checkpoint()` method which uses `PRAGMA wal_checkpoint(TRUNCATE)`. TRUNCATE mode waits for all active reader transactions to drain before it can truncate the WAL file, and does so while holding the single writer-pool connection. If the timer fired during a bulk-index write burst, every subsequent `BeginTx()` call in `processBatchedFiles` had to wait (up to the 30 s `busy_timeout`) for the blocked writer connection to become free again — multiplied across 80 batches. Fixed by adding a `passiveCheckpoint` helper that runs `PRAGMA wal_checkpoint(PASSIVE)`, which copies as many WAL frames as possible without waiting on readers or holding any connection. The background worker and the `BulkIndexEnd` post-insert checkpoint now both use `passiveCheckpoint`. The intentional blocking TRUNCATE checkpoint at shutdown and via the public `Checkpoint()` API is unchanged. [#432](https://github.com/djryanj/media-viewer/issues/432)
- fix: Fast-scrolling to the bottom of a large gallery no longer stalls. Four interrelated improvements were made: (1) `IntersectionObserver` sentinel threshold is now checked after every `loadMore()` and catch-up batch completes, so a stalled observer that missed a state-change event is always re-armed. (2) `checkAndFillViewport` detects when the sentinel is already above the viewport and the scroll target is more than one page ahead, routing to a new `_parallelCatchUp` path that issues a single `?offset=N&pageSize=M` API request instead of many sequential 100-item pages. (3) The default page size has been increased from 50 to 100 items in both the frontend and the backend `/api/media` and `/api/search` handlers. (4) Thumbnail images now use a custom `IntersectionObserver` with a 1 500 px root-margin instead of `loading="lazy"`, giving a predictable preload window that is decoupled from the DOM-item sentinel. The sentinel root-margin has also been increased from 800 px to 1 200 px. Additionally, `lucide.createIcons()` is now scoped to only the newly added elements on each render batch instead of scanning the entire document, eliminating O(n) DOM traversal that caused visible jank in galleries with hundreds or thousands of items. [#413](https://github.com/djryanj/media-viewer/issues/413)
- fix(backend): In the gallery view with the **All** filter active, videos were always displayed after all images regardless of the selected sort field (name, date, or size). The `ORDER BY f.type ASC` optimisation introduced in 0.15.4 ([#408](https://github.com/djryanj/media-viewer/issues/408)) sorted images before videos lexicographically as a side-effect, while the lightbox `/api/media` endpoint (which uses a separate query) correctly interleaved them. The primary sort key has been changed back to `CASE WHEN f.type = 'folder' THEN 0 ELSE 1 END ASC` so that only folders are pinned first and images/videos are interleaved by the user-selected sort field. Three expression indexes (`idx_files_folder_first_name`, `_date`, `_size`) have been added to allow SQLite to satisfy the `ORDER BY` without a post-scan sort step, preserving the query performance improvement from 0.15.4. Regression tests added to both `buildListDirQuery` (unit) and `ListDirectory`/`GetMediaInDirectoryPaged` (integration) to prevent recurrence. [#418](https://github.com/djryanj/media-viewer/issues/418)

## [0.15.4] - 03-05-2026

### Added

- feat(frontend): In the lightbox tags drawer and the tag modal, pressing **Tab** now accepts the currently highlighted suggestion (or the first suggestion if none is highlighted) and immediately adds the tag, matching common autocomplete conventions. **ArrowDown** / **ArrowUp** navigate the suggestion list and highlight items; **Enter** also accepts highlighted suggestions. [#399](https://github.com/djryanj/media-viewer/issues/399)
- feat(frontend): On desktop, the tag input field is automatically focused when the lightbox tags drawer is opened, so the user can start typing a tag immediately without clicking. [#400](https://github.com/djryanj/media-viewer/issues/400)

### Fixed

- perf(frontend): Tag operations (add, remove, merge, and bulk apply) in the Tags modal and the lightbox drawer now make fewer API requests. Gallery cards update from locally-available tag data without re-fetching from the server, and element lookups use an O(1) map instead of scanning all gallery items. [#399](https://github.com/djryanj/media-viewer/issues/399)
- perf(frontend): `content-visibility: auto` is now applied to gallery items, reducing layout and paint work for off-screen items during scrolling. [#402](https://github.com/djryanj/media-viewer/issues/402)
- perf(frontend): Entering selection mode is significantly faster in large galleries. Multiple sources of main-thread blocking have been eliminated, including CSS cascade traversals affecting tens of thousands of elements, redundant DOM scans on entry and exit, and style recalculations triggered by `prefers-reduced-motion`. The first entry takes approximately 100–130 ms on a large gallery; subsequent entries are effectively instant. [#402](https://github.com/djryanj/media-viewer/issues/402)
- perf(backend): The `/api/media` endpoint now returns results in pages of 500 rather than fetching the entire directory at once. For large directories, this reduces P95 response times from over 500 ms to a small fraction of that. The frontend loads the first page immediately and streams remaining pages in the background; the lightbox can open and navigate before all pages have arrived. Because `Lightbox.items` is a direct reference to `state.mediaFiles`, background pages pushed onto that array are immediately visible to prev/next navigation — no changes to lightbox.js were required. [#309](https://github.com/djryanj/media-viewer/issues/309)
- perf(backend): `AuthMiddleware` now only extends the session (sliding expiration DB write) for `/api/` requests. Static files, HTML pages, thumbnails, and HLS segments no longer each trigger an `UPDATE sessions` write, eliminating a write-storm of ~200 DB writes on a typical gallery page load. Additionally, `ExtendSession` applies a 60-second in-memory cooldown per token so that bursts of concurrent API calls only produce a single DB write per minute. [#409](https://github.com/djryanj/media-viewer/issues/409)
- perf(backend): Full thumbnail generation no longer loads every media file into memory at once. The database query now uses `LIMIT`/`OFFSET` pagination (500 files per page) so peak heap during a startup-triggered full generation is O(page size) rather than O(library size). The unindexable depth-first `ORDER BY` expression has been replaced with a plain `ORDER BY path ASC`, which resolves to an index scan. Any folder thumbnail that depends on not-yet-generated child thumbnails self-corrects on the next periodic run — an acceptable trade-off that was previously irrelevant anyway because the prior ordering offered no guarantee across generation batches. `GetAllMediaFiles` (unused in production) has been removed. [#323](https://github.com/djryanj/media-viewer/issues/323)
- perf(backend): `ListDirectory` startup overhead reduced. The `ORDER BY (CASE WHEN f.type = 'folder' THEN 0 ELSE 1 END)` expression, which was opaque to the query planner, has been replaced with `ORDER BY f.type ASC` — `'folder' < 'image' < 'video'` alphabetically produces the same folder-first ordering while allowing SQLite to satisfy the sort directly from the `idx_files_media_directory_name` and `idx_files_media_directory_date` covering indexes without a post-scan sort step. All 16 query variants (4 sort columns × 2 directions × 2 filter states) are pre-compiled as prepared statements at startup so no query parsing or plan compilation occurs at request time. [#408](https://github.com/djryanj/media-viewer/issues/408)

### Changed

- test(frontend): Updated selection mode tests to match the refactored implementation. [#402](https://github.com/djryanj/media-viewer/issues/402)
- chore(deps): update mikepenz/release-changelog-builder-action digest to a34a800 ([#386](https://github.com/djryanj/media-viewer/pull/386))
- chore(deps): update github actions (major) ([#389](https://github.com/djryanj/media-viewer/pull/389))
- fix(deps): update go modules ([#388](https://github.com/djryanj/media-viewer/pull/388))
- chore(deps): update all non-major dependencies ([#387](https://github.com/djryanj/media-viewer/pull/387)

## [0.15.3] - 03-02-2026

### Changed

- refactor(config): `WAL_CHECKPOINT_INTERVAL_SECONDS` and `SLOW_QUERY_THRESHOLD_MS` environment variables are now parsed, validated, and logged to the console during startup in `startup.go`, following the same pattern as all other environment variables. Previously both were read directly from the environment at call-time inside `database.go` (`getCheckpointInterval()` / `getSlowQueryThreshold()`). The parsed values flow through `Config` into `database.Options` (`SlowQueryThresholdMs`) and directly into `StartCheckpointWorker(ctx, interval)`, which now receives the interval as a parameter rather than reading the environment itself. The package-level `observeQuery()` function has been converted to a `(*Database).observeQuery()` method so it can read `d.slowQueryThreshold` from the struct instead of calling `os.Getenv` on every query. [#395](https://github.com/djryanj/media-viewer/issues/395)

### Fixed

- fix(database): WAL checkpoint mode changed from `RESTART` to `TRUNCATE`. `RESTART` mode resets the WAL write position so SQLite can reuse the file space for new writes, but the physical file size stays at its high-water mark — the WAL file on disk never shrinks. `TRUNCATE` mode does everything `RESTART` does and additionally truncates the WAL file to zero bytes after a successful checkpoint, which actually reduces the file size on disk. The background checkpoint worker and the shutdown checkpoint both now use `TRUNCATE`. [#395](https://github.com/djryanj/media-viewer/issues/395)

## [0.15.2] - 03-02-2026

### Tests

- test(backend): 126 new test functions resulting in coverage improvement from ~71% to ~77.2%. [#370](https://github.com/djryanj/media-viewer/issues/370)

### Changed

- refactor(metrics): removed `media_viewer_go_gc_runs_total` and `media_viewer_go_gc_pause_total_seconds` as they are exact duplicates of the standard Go runtime metrics `go_gc_duration_seconds_count` and `go_gc_duration_seconds_sum`. All Grafana dashboard panels and documentation queries updated to use the standard metrics. `media_viewer_go_gc_pause_last_seconds` is retained as it has no standard equivalent.
- fix(database): disabled SQLite `wal_autocheckpoint` (set to 0) to prevent checkpoint I/O from blocking write-commit transactions. Previously the default threshold of 1,000 pages (~4 MB) could cause commits to block synchronously on a checkpoint, explaining the observed ~92ms average commit latency with a long tail into 500ms–1s.
- fix(database): `BulkIndexEnd` WAL checkpoint now goes through the new `Checkpoint()` method so it records metrics consistently with all other checkpoint operations.

### Added

- feat(metrics): three new WAL checkpoint metrics: `media_viewer_db_wal_checkpoint_total` (counter), `media_viewer_db_wal_checkpoint_duration_seconds` (histogram), and `media_viewer_db_wal_pages` (gauge with `log`/`checkpointed`/`busy` labels) to track checkpoint health and WAL file size over time.

## [0.15.1] - 03-01-2026

### Fixed

- perf(frontend): `lucide.createIcons()` was called three times on every lightbox navigation (pin button, tag button, and loop/autoplay toggle) because each `updatePinButton`, `updateTagButton`, and `updateLoopButton` call replaced `innerHTML` and re-rendered icons from scratch. On every next/prev click this triggered a full DOM mutation, causing the Lucide library and browser extensions to re-scan the subtree. Fixed by adding `_initStaticIcons()`, called once at lightbox startup, which writes the icon `<i>` elements and calls `lucide.createIcons({ nodes })` a single time. All update functions now only toggle CSS classes and the button `title` — no DOM mutation occurs during navigation. [#114](https://github.com/djryanj/media-viewer/issues/114)
- perf(frontend): `getTagsFromGallery` performed an O(n) `document.querySelector` scan on every tag lookup. The function now checks `InfiniteScroll._galleryItemsByPath` (a `Map` populated by `renderItems`) first, falling back to the DOM scan only when InfiniteScroll is unavailable or the path is absent from the map. [#114](https://github.com/djryanj/media-viewer/issues/114)
- perf(frontend): `_getGridGeometry` forced a synchronous layout reflow on every call by reading `getComputedStyle` and `offsetWidth`. The result is now cached in `_cachedGridGeometry` and reused until explicitly invalidated. The cache is cleared by `_positionScrubber` (called on resize), by a full re-render in `renderItems`, and by `resetState`. [#114](https://github.com/djryanj/media-viewer/issues/114)
- fix(frontend): persistent scroll-position restore only worked at the root folder. The `savePersistentScrollPosition` function reads `MediaApp.state.currentPath` at call time, but was only ever triggered via a 500 ms debounced scroll listener. If the user scrolled in a subfolder and navigated away before the debounce fired, the timer stayed pending and eventually wrote the subfolder's scroll position under the (by then already updated) new path's localStorage key, or was silently dropped by the `scrollY < 50` guard after the page reset to the top. Root worked because users typically pause at root longer than 500 ms. Fixed by flushing `savePersistentScrollPosition` synchronously in the `navigateTo` wrapper and `beforeunload` handler, before `currentPath` changes — clearing the pending timer to prevent a subsequent double-write. [#382](https://github.com/djryanj/media-viewer/issues/382)
- fix(frontend): "Continue where you left off?" popover flashed on screen briefly and then immediately disappeared. `hideScrollRestorePopover` schedules a 250 ms `setTimeout` to add the `hidden` class (allowing the CSS fade-out to complete) but did not track or expose that timer. `resetState` (called at the start of every directory load) calls `hideScrollRestorePopover`, leaving a pending 250 ms timer. When `_checkPersistentRestore` then calls `showScrollRestorePopover` moments later, the stale timer fires and adds `hidden` to the freshly-shown popover. Fixed by storing the hide-delay timer in `_restorePopoverHideTimer` and cancelling it at the top of `showScrollRestorePopover`. [#382](https://github.com/djryanj/media-viewer/issues/382)

## [0.15.0] - 03-01-2026

### Changed

> **Breaking**: Some of the changes in this release alter the REST API. Clients and integrations must be updated accordingly. [#112](https://github.com/djryanj/media-viewer/issues/112)

- fix(api)!: all REST routes now use consistent plural resource names. `/api/file/` → `/api/files/`, `/api/tag/` → `/api/tags/`, `/api/favorite/` → `/api/favorites/`, `/api/thumbnail/` → `/api/thumbnails/`. [#112](https://github.com/djryanj/media-viewer/issues/112)
- fix(api)!: `POST /api/tags/batch` renamed to `POST /api/tags/query` to better reflect that the endpoint queries tags for a set of files rather than performing a batch mutation. [#112](https://github.com/djryanj/media-viewer/issues/112)
- fix(api)!: tag rename (`POST /api/tags/rename`) and tag delete (`DELETE /api/tags/delete`) consolidated into a single `PATCH /api/tags/{id}` route that accepts a JSON body with the desired operation. [#112](https://github.com/djryanj/media-viewer/issues/112)
- fix(api)!: `POST /api/tags/file/set` replaced by `PUT /api/tags/file` — setting the full tag list on a file is now expressed as an idiomatic PUT. [#112](https://github.com/djryanj/media-viewer/issues/112)
- fix(api)!: `BulkFavoriteRequest` split into two distinct request types: `BulkAddFavoritesRequest` (contains `items`) for `POST /api/favorites/bulk` and `BulkRemoveFavoritesRequest` (contains `paths`) for `DELETE /api/favorites/bulk`. Previously both operations shared one struct with optional fields. [#112](https://github.com/djryanj/media-viewer/issues/112)
- fix(api)!: `POST /api/auth/keepalive` changed to `PUT /api/auth/keepalive`. Session extension is idempotent and does not create a resource; PUT is the correct HTTP method. [#112](https://github.com/djryanj/media-viewer/issues/112)
- perf(backend): `BulkIndexEnd` now runs `PRAGMA wal_checkpoint(PASSIVE)` after the FTS rebuild and trigger restore. On large libraries the bulk-index write load grows the WAL to tens of MB; without a checkpoint the WAL is not folded back into the main database file until the next full checkpoint, which keeps read latency elevated. The checkpoint is best-effort (PASSIVE mode); a failure is logged at WARN level but does not cause `BulkIndexEnd` to return an error. [#372](https://github.com/djryanj/media-viewer/issues/372)

### Removed

- fix(api)!: `GET /api/favorites/check` removed. The endpoint was unused by the frontend, which tracks favorite state locally. [#112](https://github.com/djryanj/media-viewer/issues/112)

### Added

- feat(frontend): added a virtual spacer element (`#virtual-spacer`) that gives the browser the correct full-height scroll range even when most items are not yet loaded. The spacer height is computed from unloaded item count × row height so the native scrollbar thumb always reflects the true collection size. A skeleton-tile grid inside the spacer is repositioned on each scroll event so placeholder tiles are visible wherever the user scrolls in the unloaded zone. [#114](https://github.com/djryanj/media-viewer/issues/114)
- feat(frontend): added a custom touch-friendly scroll scrubber — a fixed 12 px rail on the right edge with a draggable pill thumb. The thumb lives in item-space (position = item index / totalItems) so it remains stable while pages load. An item-count label (e.g. "1,234 / 4,500") appears beside the thumb while dragging. The native scrollbar is hidden via `scrollbar-width:none` while the custom scrubber is active. [#114](https://github.com/djryanj/media-viewer/issues/114)
- feat(frontend): added parallel catch-up loading (`_parallelCatchUp`). Releasing the scrubber thumb on an unloaded position triggers a single `?offset=N&pageSize=M` fetch that retrieves all needed items at once, then scrolls directly to the target element. The `html.catchup-active` class is applied during the load to disable `overflow-anchor` so the browser does not fight JS scroll management while the virtual spacer shrinks. [#114](https://github.com/djryanj/media-viewer/issues/114)
- feat(frontend): added persistent scroll-position restore. A debounced `localStorage` write (key `media-viewer:scroll-positions`) fires 500 ms after each scroll event, storing `scrollY`, a normalised `fraction`, and a `timestamp`. On re-visit, `_checkPersistentRestore` reads the entry; if `scrollY > innerHeight` it shows a "Continue where you left off?" popover offering "Yes!" (triggers catch-up to the saved position) or "Dismiss" (clears the entry). Entries older than 7 days are pruned automatically. The popover anchors beside the scrubber rail when the scrubber is visible, with a pulsing marker on the rail indicating the saved position. [#114](https://github.com/djryanj/media-viewer/issues/114)
- feat(backend): `GET /api/files` now accepts an `?offset=` query parameter (0-based integer). When provided, `fetchDirectoryItems` uses it directly as the SQL `OFFSET` instead of the page-derived value, allowing the frontend to fetch an arbitrary window of items in a single request. The derived `Page` field in the response is set to `offset/pageSize + 1` so pagination metadata remains consistent. [#114](https://github.com/djryanj/media-viewer/issues/114)
- feat(backend): added `media_viewer_db_connections_in_use` and `media_viewer_db_connections_idle` Prometheus gauges. The existing `media_viewer_db_connections_open` gauge reports `InUse + Idle`, which is nearly always 0 at scrape time because the connection is released before the scrape arrives; the two new gauges expose the underlying `sql.DBStats.InUse` and `sql.DBStats.Idle` fields directly, providing a more useful picture of connection-pool pressure. [#372](https://github.com/djryanj/media-viewer/issues/372)

### Fixed

- perf(frontend): thumbnail images were loaded via `fetch() → blob() → createObjectURL()`, which bypassed `loading="lazy"` entirely (all thumbnails fetched unconditionally on render) and permanently pinned decoded bitmaps in memory (blob URLs were revoked, leaving no URL for the browser to re-fetch from). Changed to direct `img.src` assignment so the browser's lazy-loading and bitmap-eviction mechanisms work as intended. [#114](https://github.com/djryanj/media-viewer/issues/114)
- fix(frontend): `checkAndFillViewport` rescheduled itself unconditionally after every `loadMore` call, creating an infinite async timer loop when all pages were exhausted but `state.hasMore` remained true. The function now only reschedules when `loadedItems.length` actually grew, preventing the runaway loop. [#114](https://github.com/djryanj/media-viewer/issues/114)
- fix(frontend): `_fetchPage` caught all exceptions and returned `null`, making `loadMore`'s "Server is offline" (TypeError) and "Server not responding" (AbortError) toast branches permanently unreachable. `AbortError` and `TypeError` are now re-thrown from `_fetchPage` so the caller can display the appropriate message. [#114](https://github.com/djryanj/media-viewer/issues/114)
- fix(frontend): clicking a favorited image or video that lives in a subdirectory no longer silently fails to open the lightbox. Previously `handleSingleTap` searched only the current directory's in-memory media list, so any favorite from a different path returned index -1 and the lightbox was never opened. The handler now falls back to fetching the item's parent directory from `/api/media` and opens the lightbox with that result set. [#284](https://github.com/djryanj/media-viewer/issues/284)
- fix(frontend): favorited images and videos that share the same filename but reside in different directories are now visually distinguishable in the favorites strip. A small overlay badge showing the immediate parent folder name has been added to each thumbnail; hovering the badge reveals the full path. [#284](https://github.com/djryanj/media-viewer/issues/284)
- fix(frontend): the favorites strip is now always visible and current regardless of which directory is being browsed. Previously it was hidden whenever you navigated into a subfolder, and adding or removing a favorite in a subfolder would not refresh the strip when returning to root. `updateFromListing` now always calls `loadFavorites()`, and `addFavorite`/`removeFavorite` no longer gate the refresh on `currentPath === ''`. [#284](https://github.com/djryanj/media-viewer/issues/284)
- fix(backend): `media_viewer_db_storage_health_check_duration_seconds` always showed zero observations because `SetStorageHealthChecker` was never called on the metrics collector in `main.go`. The wiring call has been added so the collector invokes `CheckStorageHealth` on every collection cycle. [#372](https://github.com/djryanj/media-viewer/issues/372)
- fix(backend): `media_viewer_file_hash_compute_duration_seconds` and `media_viewer_directory_walk_depth` were registered as Prometheus metrics but `Observe()` was never called in either the sequential or parallel indexer code paths, so both histograms were permanently empty. Both metrics are now instrumented in `createMediaFile` (sequential walker) and `processFile` (parallel walker): `FileHashComputeDuration` wraps the `md5.Sum` call for every file and directory entry; `DirectoryWalkDepth` is computed as `strings.Count(relPath, sep) + 1` and observed for directory entries only. [#372](https://github.com/djryanj/media-viewer/issues/372)
- fix(frontend): playlist video load timeout ID was stored in a local `let` variable inside `playCurrentVideo`, making it impossible to cancel when the user navigated to a different item before the timeout elapsed. After 5 minutes the stale callback would fire, calling `hideLoading()` and showing a misleading timeout toast against whatever video was currently playing. The timeout is now stored as `this._loadTimeoutId` and cleared at the start of every `playCurrentVideo` call, and set to `null` in both the `onReady` and `onError` callbacks. [#298](https://github.com/djryanj/media-viewer/issues/298)
- fix(frontend): `checkVideoAuthError` could trigger `SessionManager.handleSessionExpired()` (or a redirect to `/login.html`) for the wrong playlist item when the server was slow. If the user navigated away before the 3-second HEAD request completed, the response would arrive in the context of an already-abandoned video load and act on it anyway. Fixed by threading an `AbortController` signal through `checkVideoAuthError`; navigating to a new item aborts the in-flight check by storing the controller as `this._videoCheckController` and aborting it at the start of each `playCurrentVideo` call. `AbortError` exceptions from `fetchWithTimeout` are silently ignored. [#298](https://github.com/djryanj/media-viewer/issues/298)
- fix(frontend): playlist modal was blocked from opening until the `/api/tags/batch` request completed. On a slow server this meant users waited up to 10 seconds (5 s playlist fetch + 5 s tag fetch) staring at a loading spinner before the modal appeared. The playlist now opens immediately once playlist data arrives; tag loading continues in the background and the sidebar re-renders once complete. [#298](https://github.com/djryanj/media-viewer/issues/298)
- fix(backend): `ParseWPL` now accepts a `context.Context` as its first argument. Two `ctx.Err()` checks were added — one before `os.ReadFile` and one after parsing the XML — so the function returns the context error promptly when the client has already disconnected (e.g. because the frontend's 5-second timeout fired). Previously the file read and XML parse would continue to completion even after the request was cancelled. [#298](https://github.com/djryanj/media-viewer/issues/298)

### Tests

- test(frontend): added unit tests for `updateVirtualSpacer` (height, skeleton grid population/clearing), `updateSpacerGridPosition`, `savePersistentScrollPosition` (threshold, fraction, timestamp, pruning, QuotaExceededError), `showScrollRestorePopover`/`hideScrollRestorePopover`, `_onScrubberRelease` (catch-up scheduling, in-DOM navigation, timer clearing), `createScrollScrubber` (DOM creation, pointer events), `updateScrollScrubber` (hidden/visible logic, thumb position, label text), and updated `resetState` tests for virtual-spacer reset and popover hide. [#114](https://github.com/djryanj/media-viewer/issues/114)
- test(frontend): added integration tests for virtual spacer DOM creation, height after partial/full load and after `loadMore`, skeleton grid population/clearing, scroll-restore popover DOM creation, show/hide behaviour (localStorage trigger, in-memory cache bypass, dismiss button, fraction propagation, legacy-entry fallback), custom scrubber DOM creation and `updateScrollScrubber` visible/hidden transitions, scrubber dragging class on pointer events, and `resetState` clearing the spacer and popover. Updated existing item-count selector to `.gallery-item:not(.skeleton)` to exclude virtual-spacer skeletons. [#114](https://github.com/djryanj/media-viewer/issues/114)
- test(frontend): added E2E test file `scroll-features.spec.js` covering virtual spacer DOM structure and height behaviour, scroll-restore popover structure and behaviour (appears on re-visit, dismiss clears localStorage, "Go back" scrolls to saved position, auto-dismiss), and custom scrubber structure and visibility. [#114](https://github.com/djryanj/media-viewer/issues/114)
- test(frontend): updated `gallery.test.js` thumbnail tests: replaced the stale `'uses provided thumbnail URL'` test (which assumed `fetch`-based loading) with three new tests asserting direct `img.src` assignment, no `fetch` call for thumbnail loading, and fallback-icon display on load error; updated `'adds loaded class on successful load'` to dispatch a DOM `Event('load')` rather than call `img.onload()` directly. [#114](https://github.com/djryanj/media-viewer/issues/114)
- test(backend): added `TestListFilesWithOffsetIntegration` verifying that `?offset=` skips the correct items, that `Page` is derived correctly from offset and pageSize, that `offset=0` returns from the beginning, that offset and page-based results are equivalent, and that negative offsets are rejected. Added `TestOffsetParsing` unit tests covering valid offsets, zero, negative, non-numeric, empty, large, and edge-case pageSize=1 values. Added `TestNormalizeListOptions` cases for positive and zero `Offset` field pass-through. [#114](https://github.com/djryanj/media-viewer/issues/114)
- test(backend): added `TestDatabaseMetricsExist` entries and `TestDatabaseMetricOperations` subtests for the new `DBConnectionsInUse` and `DBConnectionsIdle` gauges. [#372](https://github.com/djryanj/media-viewer/issues/372)
- test(backend): added `TestBulkIndexEndCheckpointsWAL` verifying `BulkIndexEnd` returns no error when the WAL checkpoint PRAGMA runs, and `TestUpdateDBMetricsConnectionDetails` verifying `UpdateDBMetrics` sets connection gauges without panicking. [#372](https://github.com/djryanj/media-viewer/issues/372)
- test(backend): added `TestParallelWalkerDirectoryWalkDepthMetric` verifying directory entries at depth 1 and 2 produce a non-empty `FileHash` (exercising the `DirectoryWalkDepth` instrumentation path), and `TestParallelWalkerFileHashComputeDurationObserved` verifying regular files produce a non-empty `FileHash` (exercising the `FileHashComputeDuration` instrumentation path). [#372](https://github.com/djryanj/media-viewer/issues/372)
- test(backend): added `TestMetricsCollectorStorageHealthCheckerWiring` documenting and validating that `SetStorageHealthChecker` must be called on the metrics collector to enable storage health observations. [#372](https://github.com/djryanj/media-viewer/issues/372)
- test(frontend): added unit tests verifying `_loadTimeoutId` is stored on `this`, cleared when `playCurrentVideo` is called a second time, cleared in the `onReady` callback, and cleared in the `onError` callback. [#298](https://github.com/djryanj/media-viewer/issues/298)
- test(frontend): added unit tests verifying `_videoCheckController` from a previous play is aborted when `playCurrentVideo` is called again, and that `checkVideoAuthError` does not call `handleSessionExpired` when the provided signal is already aborted. [#298](https://github.com/djryanj/media-viewer/issues/298)
- test(frontend): added integration tests asserting the playlist modal opens before the tag request completes (testing the non-blocking tag load), and that the sidebar re-renders after background tag loading finishes. [#298](https://github.com/djryanj/media-viewer/issues/298)
- test(backend): added unit tests for `ParseWPL` with a pre-cancelled context, an expired deadline, and an active context (regression guard). [#298](https://github.com/djryanj/media-viewer/issues/298)
- test(backend): added integration tests verifying `GetPlaylist` and `ListPlaylists` return a non-200 response when invoked with an already-cancelled request context. [#298](https://github.com/djryanj/media-viewer/issues/298)

## [0.14.3] - 02-26-2026

### Fixed

- fix(backend): **regression** — initial index of large libraries (40 k+ files) was dramatically slower in 0.14.0 due to FTS5 trigram trigger overhead introduced by the database refactor. Each `UpsertFile` call fired an `AFTER UPDATE` trigger that deleted and re-inserted the row into `files_fts` with trigram tokenisation, producing ~80 000 FTS write operations for a 40 k-file library. These writes bloated the SQLite WAL to hundreds of MB, which also caused reads to appear blocked (WAL mode readers must scan the entire WAL file on every query, even though they are not mutex-serialised). Fixed by calling `BulkIndexBegin` at the start of every index run, which drops the three FTS triggers (`files_ai`, `files_au`, `files_ad`) for the duration of the run, then calling `BulkIndexEnd` afterwards which rebuilds the FTS index from the source table in a single pass and restores the triggers.
- fix(backend): increased `PRAGMA busy_timeout` from 5 000 ms to 30 000 ms. On NFS-backed storage, individual WAL commits can take several seconds; the previous 5-second timeout caused spurious `SQLITE_BUSY` errors during indexing and under concurrent read load.
- fix(backend): SIGBUS crash (`sigcode=2 / BUS_ADRERR`) during SQLite query execution when the database file resides on NFS. SQLite's mmap accesses a memory-mapped region backed by an NFS page; if the NFS connection is interrupted or the page is evicted the kernel delivers SIGBUS into the CGo call, crashing the process. The existing `DB_MMAP_DISABLED=true` environment variable (added in 0.13.4) is the correct fix — its documentation has been improved in the relevant env-var docs. The new `busy_timeout` increase (see above) also reduces the likelihood of lock-related retries that can trigger mmap reads under load.

## [0.14.2] - 02-26-2026 "Just the chores"

### Changed

- chore(deps): update dependency happy-dom to v20 ([#353](https://github.com/djryanj/media-viewer/pull/353))
- chore(deps): update dependency globals to v17 ([#352](https://github.com/djryanj/media-viewer/pull/352))
- chore(deps): update dependency eslint-plugin-jsdoc to v62 ([#351](https://github.com/djryanj/media-viewer/pull/351))
- chore(deps): update dependency eslint-config-prettier to v10 ([#350](https://github.com/djryanj/media-viewer/pull/350))
- chore(deps): update all non-major dependencies ([#349](https://github.com/djryanj/media-viewer/pull/349))
- chore(deps): update ghcr.io/djryanj/media-viewer docker tag to v0.14.2 ([#360](https://github.com/djryanj/media-viewer/pull/360))
- chore(deps): pin dependencies ([#359](https://github.com/djryanj/media-viewer/pull/359))
- chore(deps): update node.js to v24.14.0# ([#361](https://github.com/djryanj/media-viewer/pull/361))
- chore(deps): update actions/cache action to v5 ([#362](https://github.com/djryanj/media-viewer/pull/362))
- chore(deps): update dependency stylelint to v17 ([#366](https://github.com/djryanj/media-viewer/pull/366)) #366
- chore(deps): update dependency stylelint-config-standard to v40 ([#363](https://github.com/djryanj/media-viewer/pull/363)) #363
- chore(deps): update eslint monorepo to v10 (major) ([#364](https://github.com/djryanj/media-viewer/pull/364))
- chore(deps): update vitest monorepo to v4 (major) ([#365](https://github.com/djryanj/media-viewer/pull/365))

## [0.14.1] - 02-25-2026

### Fixed

- fix(frontend): folder and playlist names are now visible again in the gallery. A previous refactor removed filename display from all gallery items; names are now re-implemented as an overlay (matching the existing mobile gradient overlay) exclusively for `folder` and `playlist` items on both mobile and desktop. Playlist names have their file extension stripped. Playlist icons are now also coloured with `--type-playlist`. [#354](https://github.com/djryanj/media-viewer/issues/354)
- fix(backend): filenames containing shell metacharacters (`&`, `$`, `|`, `;`, `>`, `<`) now transcode and stream correctly via both the direct-stream and HLS paths. The ffmpeg argument sanitizer was rejecting these characters as potential shell-injection vectors, but Go's `exec.Command` passes arguments directly to `execve(2)` without invoking a shell, making the checks both unnecessary and harmful for legitimate filenames (e.g. `S&E.avi`, `$100 Concert.mkv`). All `ContainsAny` character-class checks have been removed; path traversal and null-byte protection is provided entirely by `sanitizeFilePath` (which uses `filepath.Abs` + `filepath.EvalSymlinks` + `isSubPath`). Additionally, `transcodeAndCache` was the only ffmpeg code path that did not call `sanitizeFilePath` before passing the input path to ffmpeg — this has been corrected.
- fix(backend): `StreamVideo` now short-circuits on `HEAD` requests when transcoding is required, returning `200 OK` with `Content-Type: video/mp4` headers without invoking `ffmpeg`. Previously a `HEAD` request to any video that needed transcoding would trigger a full transcode, causing CI failures. [#345](https://github.com/djryanj/media-viewer/issues/345)
- fix(backend): resolve URL-encoded path handling for files with special characters in filenames. Filenames containing characters like `!`, `#`, `&`, spaces, and other URL-sensitive characters were not loading properly (thumbnails, file serving, video streaming) because gorilla/mux's automatic path decoding would transform literal percent-encoded characters in filenames (e.g. `file%21.jpg` on disk became `file!.jpg`), causing mismatches against both the database and filesystem. [#329](https://github.com/djryanj/media-viewer/issues/329)
- fix(backend): add `pathForFS` helper that tries the mux-decoded path first, then falls back to re-encoding for files with literal percent characters in their names. This ensures both normal filenames and percent-encoded filenames are resolved correctly on disk. [#329](https://github.com/djryanj/media-viewer/issues/329)
- fix(backend): add `reEncodePath` fallback for database lookups in `GetThumbnail` when the mux-decoded path doesn't match the indexed filename. [#329](https://github.com/djryanj/media-viewer/issues/329)
- fix(backend): `GetThumbnail` now updates both `filePath` and `fullPath` after a successful re-encoded DB lookup fallback. Previously the DB lookup would succeed via re-encoding but subsequent filesystem validation and thumbnail generation still used the original mux-decoded path, causing "file not found" errors. [#329](https://github.com/djryanj/media-viewer/issues/329)
- fix(backend): `encodePathSegment` now encodes `+`, `'`, `!`, `(`, `)`, `*`, and `@` in addition to characters already handled by `url.PathEscape`. These characters are valid in URL paths (so Go's `url.PathEscape` leaves them alone) but may appear as literal percent-encoded sequences in filenames on disk (e.g., `%2B` decoded to `+` by mux). [#329](https://github.com/djryanj/media-viewer/issues/329)
- fix(backend): remove redundant `url.QueryUnescape` call from `validateThumbnailPath` that was causing double-decode issues for thumbnail requests. [#329](https://github.com/djryanj/media-viewer/issues/329)
- fix(frontend): thumbnail URLs now always constructed using `encodeURIComponent` path encoding instead of using the backend-provided `thumbnailUrl` field, which contained raw unencoded paths. Filenames containing `#` or `?` would silently truncate the URL (e.g., `clip#1 final.mp4` sent only `/api/thumbnail/clip` to the server). [#329](https://github.com/djryanj/media-viewer/issues/329)
- fix(frontend): ensured consistency across all API endpoints (`/api/file/`, `/api/thumbnail/`, `/api/stream/`, `/api/stream-info/`), using the `path.split('/').map(encodeURIComponent).join('/')` pattern to ensure round-trips through the backend for files with spaces, special characters, and unicode in their names succeed. [#329](https://github.com/djryanj/media-viewer/issues/329)

### Added

- feat(backend): HLS segmented streaming for videos that require transcoding. A new `POST /api/hls/session` endpoint creates a dedicated ffmpeg session that writes 6-second MPEG-TS segments to `<cacheDir>/hls/<sessionId>/`. `GET /api/hls/{id}/playlist.m3u8` polls until at least one segment is ready (~6 s) and then serves the growing HLS playlist; `GET /api/hls/{id}/seg{n}.ts` waits for the requested segment and serves it with `immutable` cache headers. GPU acceleration (NVENC, VA-API, VideoToolbox) and CPU fallback are both supported. Idle sessions (no requests for 10 min) are cleaned up automatically in the background. [#346](https://github.com/djryanj/media-viewer/issues/346)
- feat(frontend): video player now uses hls.js for transcoded videos instead of waiting for a complete transcode before playback begins. Chrome/Firefox/Edge use hls.js; Safari/WebKit use native HLS via `<video src="…m3u8">`. Falls back to the direct-stream path on any fatal hls.js error. [#346](https://github.com/djryanj/media-viewer/issues/346)

### Changed

- build(deps): bump actions/setup-node from 4 to 6 ([#341](https://github.com/djryanj/media-viewer/pull/341))
- build(deps): bump actions/cache from 4 to 5 ([#342](https://github.com/djryanj/media-viewer/pull/342))
- build(deps): bump renovatebot/github-action from 46.1.1 to 46.1.2 ([#343](https://github.com/djryanj/media-viewer/pull/343))
- refactor(frontend): `loadVideo` in `lightbox.js` is now `async`; it queries `/api/stream-info/` first and dispatches to HLS (`loadVideoHLS` / `loadVideoHLSNative`) or the existing direct-stream path (`loadVideoDirectStream`) based on the `needsTranscode` field. [#346](https://github.com/djryanj/media-viewer/issues/346)
- refactor(backend): introduced `decodePath` helper to centralize path extraction from mux vars across all file-serving handlers (`GetFile`, `GetThumbnail`, `StreamVideo`, `GetStreamInfo`, `InvalidateThumbnail`), replacing inconsistent inline `mux.Vars(r)["path"]` usage. [#329](https://github.com/djryanj/media-viewer/issues/329)
- refactor(backend): downgraded `pathForFS` and `GetThumbnail` re-encode fallback log messages from `Warn` to `Debug`, since this is expected behavior for files with percent-decoded characters in their names. [#329](https://github.com/djryanj/media-viewer/issues/329)
- ci: added scheduled weekly workflow to warm the sample media cache on the default branch, preventing GitHub Actions' 7-day cache eviction. Added `restore-keys` fallback so PR workflows can restore stale caches when the download script changes, minimizing re-downloads. [#329](https://github.com/djryanj/media-viewer/issues/329)

### Tests

- test(backend): added `TestStreamVideoHEADRequestNeedsTranscodeIntegration` to verify that `HEAD` requests on videos requiring transcoding return `200 OK` with `Content-Type` set, an empty body, and no `ffmpeg` invocation. [#345](https://github.com/djryanj/media-viewer/issues/345)
- test(backend): added unit tests for `pathForFS` covering normal filenames, literal percent filenames, subdirectories, file-not-found, and priority when both decoded and encoded forms exist on disk. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(backend): added unit tests for `reEncodePath` covering plain paths, special characters, nested paths, and already-encoded percent sequences. Added cases for `+`, `'`, `*`, and combined folder+file paths. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(backend): added unit tests for `encodePathSegment` covering `+`, `'`, `!`, `(`, `)`, `*`, `@`, and round-trip encode/decode verification. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(backend): added regression tests to verify `decodePath` preserves the mux var without double-decoding. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(backend): added end-to-end regression tests for `GetFile`, `StreamVideo`, `GetThumbnail`, `GetStreamInfo`, and `InvalidateThumbnail` with both normal filenames and literal percent-encoded filenames. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(backend): added `pathForFS` regression tests for literal `%2B` (plus), `%27` (apostrophe), and `%2A` (asterisk) in filenames on disk. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(backend): added `GetThumbnail` DB lookup fallback regression tests for files with literal `%2B` and `%27` in their names, verifying the re-encode fallback resolves both the database lookup and filesystem path. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(backend): added tests verifying both single-encoded and double-encoded frontend requests are handled correctly for the same file. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(backend): fixed existing tests to correctly simulate gorilla/mux behavior by passing decoded paths via `mux.SetURLVars` instead of URL-encoded paths. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(frontend): added integration tests for frontend path encoding consistency across all API endpoints (`/api/file/`, `/api/thumbnail/`, `/api/stream/`, `/api/stream-info/`), verifying that the `path.split('/').map(encodeURIComponent).join('/')` pattern used in the frontend correctly round-trips through the backend for files with spaces, special characters, and unicode in their names. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(frontend): added unit tests verifying `encodePath` correctly encodes `#` and `?` (URL fragment/query delimiters that cause silent path truncation) and `+` (misinterpreted as space by some servers). [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(frontend): added thumbnail-specific integration tests for files with `#`, `+`, `'`, `(`, `)`, `!`, and `?` in their names. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(frontend): added cross-endpoint consistency tests verifying both `/api/file/` and `/api/thumbnail/` serve the same files with fragment-unsafe and path-safe special characters. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(frontend): fixed path-encoding integration test helpers to use shared authenticated session (`apiRequest`) instead of raw `fetch` with unpopulated `globalThis.__TEST_AUTH_COOKIE__`, which caused all file-serving requests to be unauthenticated. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(frontend): fixed path traversal test to accept 404 (in addition to 400) as a valid rejection response, matching actual server behavior where resolved traversal paths are treated as not found. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(frontend): fixed cross-endpoint consistency tests to use GET instead of HEAD requests, matching actual frontend behavior in `gallery.js` and `lightbox.js`. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(frontend): updated sample media download script to generate test files with spaces, special characters (`#`, `+`, `'`, `(`, `)`, `!`, `*`, `?`), and unicode in filenames, including a subdirectory `folder (1)/` with nested special-character files. [#329](https://github.com/djryanj/media-viewer/issues/329)
- test(frontend): fixed `find` command grouping syntax in sample media download script (replaced erroneous `$` with `$` / `$` for proper `-o` operator grouping). [#329](https://github.com/djryanj/media-viewer/issues/329)

## [0.14.0] - 02-24-2026

### Added

- test: added basic playwright tests. Not all working yet. [#289](https://github.com/djryanj/media-viewer/issues/289)

### Changed

- Major UI Overhaul ([#331](https://github.com/djryanj/media-viewer/issues/331)): During the work for [#326](https://github.com/djryanj/media-viewer/issues/326), it became apparent that the UI was a contributing factor in many of the problems experienced by users during tagging and general browsing workflows, such as taps removing tags on items in the gallery _through_ the tagging modal. The following were implemented:
    - Desktop and mobile gallery views are now effectively identical. No more extra "select" button or information pane.
    - Tags and filename overlays are now hidden in the gallery. They can still be accessed and used for search in the lightbox.
    - Tags and favorite icon removed from gallery view. They can still be accessed in the lightbox and from the bottom toolbar in selection mode.
    - Select icon moved from lower left to upper left.
    - Spacing reduced on desktop.
    - Click-drag to select multiple items extended to desktop.
    - Tags in the lightbox have been changed to a drawer system with better copy/paste functionality. [#327](https://github.com/djryanj/media-viewer/issues/327)
      The interface now much more closely resembles proven designs.
- BREAKING: Database layer refactored for significantly improved performance and concurrency ([#338](https://github.com/djryanj/media-viewer/issues/338)
    - Removed application-level sync.RWMutex from all database operations. SQLite WAL mode with busy_timeout now handles all read/write concurrency internally, eliminating unnecessary Go-level serialization that was blocking concurrent readers during writes.
    - WAL mode and all SQLite PRAGMAs (synchronous, cache_size, temp_store, busy_timeout, mmap_size) moved from the connection string to a ConnectHook, ensuring consistent per-connection configuration across the pool.
    - Introduced separate reader and writer connection pools. The writer pool is limited to a single connection (eliminating SQLITE_BUSY between writers entirely), while the reader pool allows up to 16 concurrent read connections under WAL mode.
    - Introduced BatchInserter type for batch indexing operations. The upsert and delete prepared statements are now created once per batch and reused across all files, eliminating repeated query parsing during indexing.
    - BeginBatch now returns a \*BatchInserter (breaking API change). UpsertFile and DeleteMissingFiles are now methods on BatchInserter rather than Database.
    - Fixed N+1 query pattern in GetFilesByTag — per-row tag and favorite lookups replaced with scalar subqueries in the main SQL query.
    - Benchmark results show 2× faster writes (UpsertFile), 11% faster directory listings, and up to 16% faster large read operations with many tags.
- perf: optimizing some slow database queries [[#322](https://github.com/djryanj/media-viewer/issues/322)]. Performance analysis before/after:
- tests: fixed a variety of test cases across both frontend and backend.
- perf: Frontend performance problems during tagging operations and selection. Narrowed down to requiring backend changes to the bulk tags endpoint; may also affect [#322](https://github.com/djryanj/media-viewer/issues/322). ([#326](https://github.com/djryanj/media-viewer/issues/326))

## [0.13.6] - 02-22-2026

### Fixed

- ci: pipelines now correctly run conditional build steps [[#315](https://github.com/djryanj/media-viewer/issues/315)]
- dx: cleaned up makefile and made local frontend integration tests correctly run (and kill) a temporary server
- ui: fixed an issue where the pull-to-refresh behaviour introduced in ([#312](https://github.com/djryanj/media-viewer/issues/312)) accidentally fired when tapping buttons near the top. ([#319](https://github.com/djryanj/media-viewer/issues/319))

## [0.13.5] - 02-21-2026

### Added

- ui: Pull-to-refresh support on mobile ([#312](https://github.com/djryanj/media-viewer/issues/312))
  Added a pull-to-refresh gesture on the gallery view. Pulling down clears the service worker API cache and reloads the current directory, providing an explicit way to force fresh data on mobile.

### Fixed

- ui: under some circumstances with the paste modal, e.g., there is a state that happens when you select several files, tag them, and then exit the tag screen. If you re-enter the tag screen, then touch events to the files underneath are not blocked; you can inadvertently remove a tag (for example) from an image in the gallery if you happen to touch in the spot where the remove for that tag would be. This fix adds a better touchstart handler to avoid those issues in the paste modal. ([#306](https://github.com/djryanj/media-viewer/issues/306))

- Performance: Improve lightbox media query speed ([#308](https://github.com/djryanj/media-viewer/issues/308))
  Optimized the database query used to load media files for the lightbox viewer. The previous query structure caused unnecessary work that scaled poorly in directories with many files and tags. Replaced with a more efficient query pattern and added supporting database indexes.

    No API, frontend, or test changes required.

- ui: Tags not displayed on gallery items after navigating away and back to a directory ([#313](https://github.com/djryanj/media-viewer/issues/313))
  The ETag cache key for `/api/files` and `/api/media` was computed from file metadata only (modification times, sizes, counts). Tag changes did not alter any of these values, so the server returned 304 Not Modified with stale data. Combined with `max-age=300` and the service worker cache, tags could be missing for up to 5 minutes after being added. The ETag now incorporates tag state so that tag additions or removals invalidate the cache immediately.
  This was also due to the infinite-scroll ignoring data from the server if it has a cache entry.

## [0.13.4] - 02-21-2026

### Added

- Extensive frontend test suite added along with CI and other requirements. [#49](https://github.com/djryanj/media-viewer/issues/49))
- Extended renovate config to address golangci (see below in fixed section)
- Add `DB_MMAP_DISABLED` environment variable to disable SQLite mmap on network-backed storage (avoid SIGBUS) ([#292](https://github.com/djryanj/media-viewer/issues/292)); ([#290](https://github.com/djryanj/media-viewer/issues/290))

### Fixed

- (Frontend) various bugs discovered through the CI process. [#49](https://github.com/djryanj/media-viewer/issues/49))
- (Backend) during CI update, a new version of golangci was being used which uncovered some additional lint errors. These were also fixed. [#49](https://github.com/djryanj/media-viewer/issues/49))
- Regression: fixed a regression introduced in a previous commit to enforce file path safety from unsafe characters which were actually valid characters in file paths that caused thumbnail generation to fail for those files; like `#`, `~`, `&`, `[``]`, etc. [#297](https://github.com/djryanj/media-viewer/issues/297))
- lightbox and playlist: Fixed behaviour where if you stop moving your finger on the screen during a swipe action, it didn't cancel the swipe navigation ([#288](https://github.com/djryanj/media-viewer/issues/288))
- CI: Fixed an issue where frontend-only changes were skipping the backend build and frontend integration tests (which required a built binary) on PR builds.

### Changed

- Filesystem retry metrics now include per-volume labels to distinguish between media, cache, and database mount points in Grafana dashboards ([#293](https://github.com/djryanj/media-viewer/issues/293))
- **Optimized `GetAllIndexedPaths` database query for orphan thumbnail cleanup** ([#293](https://github.com/djryanj/media-viewer/issues/293))
    - Eliminated a redundant `COUNT(*)` query that was performing a full table scan solely to pre-size a map, reducing the number of database round-trips from two to one.
    - Inverted the type filter from `IN ('image', 'video', 'folder')` to `NOT IN ('playlist')`, allowing SQLite to use a simpler and faster query plan instead of a multi-range index merge.
    - Switched the return type from `map[string]bool` to `map[string]struct{}` for reduced memory overhead and GC pressure.
    - On a ~40,000 item database, this query was regularly taking ~250ms; these changes are expected to reduce that by approximately 50-60%.

- **Application crashes caused by database memory-mapping on network storage** [#290](https://github.com/djryanj/media-viewer/issues/290)), ([#292](https://github.com/djryanj/media-viewer/issues/292))
    - Resolved an issue where the application could crash unexpectedly (SIGBUS) when the underlying storage — such as NFS mounts or Longhorn volumes — experienced brief interruptions. The root cause was SQLite's memory-mapping feature, which was enabled by default in the container's system library. When mapped database pages became temporarily unavailable, the application would crash immediately with no opportunity to recover.
      The fix disables memory-mapping for database access. Benchmarking confirmed this has no measurable impact on performance for any database operation, including reads, writes, searches, and concurrent workloads. In mixed read/write scenarios, the change actually showed a small improvement.
      Additionally, we added storage health monitoring that periodically checks whether the database files are accessible. If a storage disruption occurs, it is now detected, logged, and reported through metrics rather than causing a crash. Operators can set alerts on the new db_storage_errors_total metric to be notified of storage issues before they affect users.

- Backend reliability & observability improvements related to thumbnails, filesystem retries, and metrics ([#293](https://github.com/djryanj/media-viewer/issues/293))
    - Introduced a `filesystem.Observer` interface and a Prometheus-backed observer implementation to record per-volume filesystem operation and retry metrics (media, cache, database, unknown).
    - Metrics collector and filesystem access now use retry-aware helpers (`StatWithRetry`, `ReadDirWithRetry`, `WriteFileWithRetry`) and a robust directory-walk (`getDirSizeWithRetry`) so operations behave reliably on flaky network storage (NFS/Longhorn).
    - Hardened thumbnail generation: NFS-safe cache writes, added `detectImageFormat()` for format-aware metrics, and recorded decode/resize/encode/cache phase metrics to improve troubleshooting and performance analysis.
    - Added defensive checks (nil-DB guards) in orphan-cleanup and rebuild paths to avoid panics when the database is unavailable.
    - Large expansion and refactor of unit/integration tests and benchmarks across `internal/filesystem`, `internal/media`, and `internal/metrics` to cover the new behavior and improve CI confidence.
- Video controls: Enlarged touchable area that will grab the seek bar [#281](https://github.com/djryanj/media-viewer/issues/281)
- Video controls: Touching anywhere on the seek bar now grabs the handle and seeks to that spot, rather than needing to explicitly grab the handle ([#281](https://github.com/djryanj/media-viewer/issues/281))
- ci: bump version of download-artifact github action to v7 in ci.yml ([#303](https://github.com/djryanj/media-viewer/issues/303))
- chore: Release pipeline did not include anything for frontend checks and was too light on backend. Extended to include all that. ([#303](https://github.com/djryanj/media-viewer/issues/303))

## [0.13.3] - 2026-02-13

### Changed

- build(deps): bump renovatebot/github-action from 46.0.2 to 46.1.1 ([#282](https://github.com/djryanj/media-viewer/pull/282))
- build(deps): bump actions/github-script from 7 to 8 ([#283](https://github.com/djryanj/media-viewer/pull/283))

### Added

- build(docs): Added a github action to automatically create changelog entries for bot-submitted PRs ([#276](https://github.com/djryanj/media-viewer/issues/276))

### Changed

- **Improved Performance for Large Libraries** ([#278](https://github.com/djryanj/media-viewer/issues/278)): Significantly faster browsing and navigation for libraries with thousands of files:
    - Thumbnail cleanup operations are now **8-25x faster** (2.5 seconds → ~100-300ms on 40,000+ item libraries)
    - Opening folders and viewing media is now **5-10x faster** (100ms → 10-20ms for large directories)
    - Improved performance when browsing folders with favorites and tags
- build: fixed PR cleanup action so that it properly cleans up all docker images related to the PR ([#274](https://github.com/djryanj/media-viewer/issues/274))
- extra: grafana dashboard updated to remove junk, fix variable so it detects the existence of the app before needing http requests to it

## [0.13.2] - 2026-02-13

### Added

- **Garbage Collection Performance Monitoring** ([#261](https://github.com/djryanj/media-viewer/issues/261), [#262](https://github.com/djryanj/media-viewer/issues/2602)): Added comprehensive GC metrics to track garbage collection overhead and tune performance:
    - `media_viewer_go_gc_cpu_fraction` - Percentage of CPU time spent in GC
    - `media_viewer_go_gc_pause_total_seconds` - Cumulative time spent in GC pauses
    - `media_viewer_go_gc_pause_last_seconds` - Duration of most recent GC pause
    - Enhanced Grafana dashboard with dedicated "Garbage Collection Performance" section
    - Complete monitoring stack with Docker Compose, Prometheus, and Grafana in `hack/` directory

### Changed

- **Garbage Collection Optimization** ([#261](https://github.com/djryanj/media-viewer/issues/261), [#262](https://github.com/djryanj/media-viewer/issues/2602)): Removed manual `runtime.GC()` calls from image and thumbnail processing hot paths:
    - Removed forced GC after thumbnail resizing (was triggering GC on every thumbnail)
    - Removed forced GC after intermediate image resize operations
    - Retained memory monitor GC triggers for emergency memory pressure situations (>85% memory usage)
    - **Benchmark Results** (3,106 thumbnail test):
        - Before: 31 GC/s, 1.88% CPU overhead
        - After (MEMORY_RATIO=0.75): 0.2-6 GC/s (adaptive), 0.16% CPU overhead ✅
        - Improvement: **91% reduction in GC CPU overhead**
    - Result: Dramatically better throughput and predictable latency for image operations
- **Memory Configuration Guidance** ([#261](https://github.com/djryanj/media-viewer/issues/261), [#262](https://github.com/djryanj/media-viewer/issues/2602)): Updated all documentation to recommend `MEMORY_RATIO=0.75` for production containerized deployments:
    - **Recommended approach** (containerized): `MEMORY_RATIO=0.75`
        - Adaptive: 0.2 GC/s idle → 6 GC/s under heavy load
        - Container-aware: Respects memory limits, prevents OOM
        - Benchmarked: 0.16% CPU overhead, tested with heavy thumbnail generation
    - **Alternative approach** (non-containerized): `GOGC=150`
        - Fixed rate: 4.5 GC/s (consistent)
        - Simple: Predictable behavior
        - Benchmarked: 0.15% CPU overhead
    - Updated README, installation guide, configuration docs, Kubernetes manifests with production-tested settings
    - Added comprehensive GC monitoring guide (hack/GC-MONITORING.md) with real-world benchmarks
- **Service Worker Caching Strategy** ([#261](https://github.com/djryanj/media-viewer/issues/261), [#262](https://github.com/djryanj/media-viewer/issues/2602)): Updated PWA service worker (v3) to use network-first caching for expensive API endpoints that have proper HTTP caching (ETag/304 support):
    - `/api/media` - Large responses (up to 4MB before gzip) now use network-first with cache fallback
    - `/api/files` - Directory listings use network-first for better offline experience
    - `/api/thumbnail` - Thumbnail requests use network-first with cache fallback
    - Previous behavior: All `/api/*` paths completely bypassed service worker cache
    - New behavior: Expensive endpoints go to network first (respecting 304 Not Modified), but fall back to cache when offline
    - Benefits: Better offline support while still respecting server-side cache headers and ETag validation

- build(deps): bump github.com/mattn/go-sqlite3 from 1.14.33 to 1.14.34 ([#252](https://github.com/djryanj/media-viewer/pull/252))
- build(deps): bump golang.org/x/image from 0.35.0 to 0.36.0 ([#251](https://github.com/djryanj/media-viewer/pull/251))
- build(deps): bump golang.org/x/term from 0.39.0 to 0.40.0 ([#250](https://github.com/djryanj/media-viewer/pull/250))
- build(deps): bump renovatebot/github-action from 46.0.1 to 46.0.2 ([#249](https://github.com/djryanj/media-viewer/pull/249))
- build(deps): bump golang from 1.25-alpine to 1.26-alpine ([#248](https://github.com/djryanj/media-viewer/pull/248))
- build(deps): bump golang.org/x/crypto from 0.47.0 to 0.48.0 ([#247](https://github.com/djryanj/media-viewer/pull/247))
- Bump Go version to 1.26 ([#272](https://github.com/djryanj/media-viewer/pull/272))

### Performance

- **Significant API Latency Improvements** ([#261](https://github.com/djryanj/media-viewer/issues/261), [#262](https://github.com/djryanj/media-viewer/issues/2602)): Dramatically improved response times for key API endpoints, especially noticeable with large libraries (40,000+ items) and directories with 14,000+ files:
    - **`/api/stats`**: Reduced p95 latency from 242ms to ~20ms (12x faster) by implementing a 2-minute cache for both thumbnail and transcode cache size calculations, using atomic operations instead of walking the entire directory tree on every request
    - **`/api/files`**: Reduced p95 latency from 95ms to ~40ms (2.4x faster) by optimizing the folder count subquery to only calculate counts for folders in the current result set rather than materializing counts for all folders in the database
    - **Database Query Optimization**: Added composite indexes for JOIN operations (`idx_files_parent_type_name`, `idx_files_parent_type_modtime`, `idx_files_parent_type_size`, `idx_files_path_type`) to accelerate directory listing queries with sorting and filtering, particularly beneficial for large directories
    - **Slow Query Logging**: Added automatic logging of queries exceeding 100ms (configurable via `SLOW_QUERY_THRESHOLD_MS` environment variable) to help identify performance bottlenecks in production environments

    These improvements make browsing large media libraries significantly more responsive, with most API calls now completing in under 50ms even for directories containing thousands of files.

## [0.13.1] - 2026-02-12

### Fixed

- **Thumbnail Generation Reliability**: Fixed an issue where thumbnail generation could run multiple times simultaneously, causing thumbnails to be invalidated and regenerated unnecessarily. This could happen when the scheduled thumbnail generation triggered at the same time as indexing completed or when a manual rebuild was requested. The system now properly ensures only one thumbnail generation process runs at a time, preventing wasted resources and cache conflicts. ([#260](https://github.com/djryanj/media-viewer/issues/260))

- **GPU Transcoding During Shutdown**: Fixed GPU video transcoding unnecessarily retrying with CPU encoding when the application is shutting down. Previously, if a GPU transcode was interrupted during shutdown, it would detect the GPU failure and attempt to retry with CPU encoding, delaying the shutdown process. The system now properly detects when shutdown is in progress and cancels transcoding immediately without retrying. ([#258](https://github.com/djryanj/media-viewer/issues/258))

- **Docker Health Check Compatibility**: Fixed health check endpoints failing in Debian-based Docker images (including the NVIDIA GPU image). GNU wget's `--spider` flag uses HEAD requests, while BusyBox wget uses GET requests. Health endpoints now accept both HTTP methods to ensure Docker HEALTHCHECK works correctly across all image variants. This fix prevents containers from being incorrectly marked as unhealthy in orchestrated environments like Kubernetes and Docker Swarm. ([#264](https://github.com/djryanj/media-viewer/issues/264))

- **Large Directory Performance**: Significantly improved loading speed for directories containing thousands of files. Browsing directories with many items is now 5x faster - for example, a directory with 14,000 files now loads in 100ms instead of 500ms. This improvement applies across the application:
    - **Directory listings**: Faster browsing with large folders
    - **Search results**: Faster search with hundreds of matching files
    - **Favorites view**: Faster loading when you have many favorited folders
    - **HTTP caching**: Browser instantly serves previously viewed directories from cache when nothing has changed

    These optimizations eliminate thousands of redundant database queries that were previously being made for each directory view, search, or favorites list. The improvements are especially noticeable when browsing large photo collections or video libraries, making navigation feel much more responsive. ([#261](https://github.com/djryanj/media-viewer/issues/261))

- **NVIDIA GPU Support in Docker**: Requires `Dockerfile.nvidia` (Debian-based) due to musl/glibc incompatibility. Alpine-based standard Dockerfile cannot load NVIDIA drivers even with NVIDIA Container Toolkit configured. Docker users need `--gpus all` flag with Debian image. ([#259](https://github.com/djryanj/media-viewer/issues/259)). New docker tags like `:latest-nvidia`, `:v1.0.0-nvidia`, `:v1.0-nvidia` now available. ([#265](https://github.com/djryanj/media-viewer/issues/265))

## [0.13.0] - 2026-02-11

### Added

- **GPU-Accelerated Video Transcoding**: Added support for hardware-accelerated video transcoding using GPU encoders for significantly faster video processing and lower CPU usage. When enabled, transcoding can be 2-5x faster compared to CPU-only encoding, making it ideal for high-resolution videos and systems with limited CPU capacity. The system automatically detects available GPU hardware (NVIDIA NVENC, Intel/AMD VA-API, or Apple VideoToolbox) and falls back to CPU encoding if no GPU is available. Configure with the `GPU_ACCEL` environment variable (default: `auto` for automatic detection). ([#254](https://github.com/djryanj/media-viewer/issues/254))
    - **Intel/AMD VA-API Support**: Fully supported in standard Dockerfile (Alpine-based) for amd64. Docker users need `--device /dev/dri:/dev/dri` flag.
    - See `docs/admin/docker-gpu.md` for detailed setup instructions including Windows/WSL2 configuration.

- **Improved Stability and Performance for NFS Storage**: Major improvements to prevent crashes and improve responsiveness when media is stored on network filesystems (NFS). ([#253](https://github.com/djryanj/media-viewer/issues/253))
    - **Automatic Error Recovery**: The application now automatically retries failed operations when network storage becomes temporarily unavailable, preventing crashes during rapid browsing and eliminating "stale file handle" and "broken pipe" errors.
    - **Better Concurrent Operations**: Improved handling of multiple simultaneous operations (browsing, thumbnail generation, indexing) to prevent the server from becoming unresponsive.
    - **Faster Response Times**: The application now stops unnecessary work when you navigate away from a page, making the interface more responsive when browsing quickly through your library.
    - **NFS-Optimized Defaults**: Changed default settings to work better with network storage. For problematic NFS systems, you can further reduce load using the new `INDEX_WORKERS` environment variable (set to 1-3 for NFS, or 8-16 for fast local storage). For thumbnail generation tuning, use `THUMBNAIL_WORKERS` (defaults to auto-calculated, max 6).
    - **Enhanced Monitoring**: Added new metrics to help diagnose and monitor NFS-related issues if they occur.
    - **Comprehensive Documentation**: Added troubleshooting guides, configuration examples, and best practices for running Media Viewer on NFS storage.

- **Improved Test Commands**: Enhanced Makefile test commands to be more convenient and provide better output logging. You can now test multiple packages at once using simple space-delimited syntax (e.g., `make test-package database handlers`) instead of running separate commands. All test output is automatically saved to log files for later review, with each package getting its own log file for easy troubleshooting.

- Enabled race detector on pull request builds now that race conditions have been resolved

### Fixed

- **Enhanced Stability**: Fixed several internal concurrency issues that could cause crashes or unpredictable behavior under heavy load. These improvements ensure the application runs more reliably when multiple users are browsing simultaneously or when many background operations are happening at once. Benchmark testing confirms these fixes resolved critical transcoder package failures while improving video streaming performance by 44% (TimeoutWriter) and reducing memory allocations by 27%, with only minor overhead in non-critical paths.

- **Thumbnail Generation Responsiveness**: Improved how thumbnail generation responds when cancelled or interrupted. When navigating quickly through your library, the system now stops unnecessary thumbnail generation much faster, making the application feel more responsive and preventing wasted resources on thumbnails you'll never see.

- **Test Infrastructure**: Fixed various issues in the application's internal testing system to ensure better reliability and accuracy when verifying application behavior. These improvements help maintain code quality and catch potential issues before they affect users.

- Renovatebot config should now actually make renovatebot work

### Changed

- Changed Pull Request template with some better checkboxes

## [0.12.2] - 2026-02-10

### Added

- **Cache Size Information**: Added cache size and file count display in Settings when managing thumbnails and transcoded videos. Before clearing caches or rebuilding thumbnails, you can now see exactly how much disk space is being used and how many files will be affected. The Cache tab shows current sizes immediately when opened, and confirmation dialogs display the specific amount of data and number of files that will be deleted, helping you make informed decisions about cache management. ([#241](https://github.com/djryanj/media-viewer/issues/241))

### Fixed

- **Video Dimension Compatibility**: Fixed transcoding failures for videos with unusual dimensions. Some older videos (particularly FLV files and certain codecs) have dimensions that aren't compatible with modern web video formats, causing "height not divisible by 2" errors and preventing playback. The transcoder now automatically adjusts video dimensions during conversion to ensure compatibility, allowing these videos to play successfully in your browser. ([#244](https://github.com/djryanj/media-viewer/issues/244))

- **Transcoding Error Display**: Fixed transcoding errors not being displayed to users. When video transcoding failed (due to corrupted files, unsupported formats, or other issues), the error was only logged on the server with no feedback shown in the browser. Users would see indefinite loading spinners without knowing what went wrong. The system now properly communicates transcoding failures to your browser, displaying user-friendly error messages like "Video transcoding failed" so you know when a video can't be played. ([#244](https://github.com/djryanj/media-viewer/issues/244))

## [0.12.1] - 2026-02-10

### Fixed

- **Playlist Transcoding Notifications**: Fixed toast notification not appearing when videos need transcoding in the playlist player. The player was using the `loadeddata` event which fires too early for transcoding videos (when the first frame loads), preventing the "Preparing video for playback" message from displaying. Now uses the `canplay` event which fires after sufficient buffering, matching the lightbox behavior and properly showing transcoding status notifications. ([#214](https://github.com/djryanj/media-viewer/issues/214))

## [0.12.0] - 2026-02-10

### Added

- **Favorites Scroll Indicators**: Added visual feedback for scrollable content in the favorites section. The favorites count now displays in the header (e.g., "5 favorites"), and subtle fade gradients appear on the left and right edges when there's more content to scroll. The gradients dynamically update as you scroll, providing clear indication of scrollable content in the favorites strip without cluttering the interface. ([#230](https://github.com/djryanj/media-viewer/issues/230))

- **Transcoder Cache Monitoring**: Added monitoring support for the transcoder cache directory. The system now tracks the total size of transcoded video files, displaying this information in both the monitoring metrics and the admin dashboard. This helps administrators monitor cache growth and determine when cleanup may be needed. ([#228](https://github.com/djryanj/media-viewer/issues/228))

- **Pinch-to-Zoom in Lightbox**: Added pinch-to-zoom functionality for images in the lightbox viewer. Pinch with two fingers to zoom in up to 5x magnification, and the zoom level persists until explicitly reset - no need to hold your fingers on the screen to maintain zoom. When zoomed in, drag with one finger to pan around the image with intelligent boundary constraints to prevent white space. Double-tap to instantly reset zoom back to 1x. Back button navigation is zoom-aware: pressing back when zoomed unzooms the image first before closing the lightbox. All existing touch gestures continue to work seamlessly - swipe navigation operates normally when not zoomed, video controls remain functional, and UI overlay toggles are preserved. ([#227](https://github.com/djryanj/media-viewer/issues/227))

- **Tags Overlay in Lightbox**: The tags overlay in the lightbox was too intrusive when there were lots of tags, so it has been changed to be smaller by default. If there are more tags than are visible, tapping on the overlay will bring it up. ([#226](https://github.com/djryanj/media-viewer/issues/226))

- **Lightbox UI Fade Controls**: Added automatic fading controls for lightbox interface elements. After viewing an image or video for 3 seconds, control buttons, the clock, and other interface elements smoothly fade away for an unobstructed viewing experience. Tap or click anywhere on the image or video to instantly show or hide controls. On desktop, moving your mouse automatically brings controls back. Navigation arrows (chevrons) and hotzone areas remain unaffected and work independently. Added "Always Keep Clock Visible" preference in Display settings to keep the clock visible even when other controls fade - enabled by default. This preference is automatically disabled when the "Show Clock" option is turned off. Controls remain easily accessible whenever you need them while staying out of the way during viewing. ([#226](https://github.com/djryanj/media-viewer/issues/226))

### Changed

- **Lightbox Button Styling**: Reduced visual intensity of active overlay buttons in the lightbox for a more subtle appearance when active or enabled, making them less obtrusive while still maintaining a clear visual distinction between enabled and disabled states. ([#231](https://github.com/djryanj/media-viewer/issues/231))

- **Favorites Bar Alignment**: Fixed star icon and "Favorites" text not aligning properly in the favorites section header. The icon now displays inline with the text instead of appearing on separate lines. ([#229](https://github.com/djryanj/media-viewer/issues/229))

- **Video Player Controls**: Fixed video scrub bar becoming unusable on mobile devices in lightbox. After the recent hotzone fix, attempting to drag the playhead to scrub through video would trigger swipe gestures instead, making it impossible to seek to a specific time. Both navigation swipes and video scrubbing now work properly on mobile devices. ([#225](https://github.com/djryanj/media-viewer/issues/225))

- **Toast Notifications**: Fixed notification messages extending off the screen edge on small screens in portrait mode. Long messages like "Preparing video for playback. Large files may take a few minutes..." would overflow past the viewport width and become partially unreadable. Notification messages now wrap to multiple lines and stay fully visible on all screen sizes. ([#224](https://github.com/djryanj/media-viewer/issues/224))

## [0.11.3] - 2026-02-09

### Fixed

- **Lightbox Image Alignment**: Fixed image centering and viewport filling in lightbox viewer. Recent video scaling improvements inadvertently broke image display, causing images to be left-aligned instead of centered and filling the viewport. Images now properly center and scale within the lightbox by hiding the video wrapper container when displaying images and showing it only in video mode. ([#220](https://github.com/djryanj/media-viewer/issues/220))

- **Lightbox Video Hotzones**: Fixed navigation hotzones in lightbox video player on mobile devices. Video control overlay was blocking all touch input across the entire video area, preventing left/right navigation taps from working. Changed video controls to use pointer-events only on the actual control buttons, allowing hotzones to receive touch events for navigation between media items. ([#221](https://github.com/djryanj/media-viewer/issues/221))

## [0.11.2] - 2026-02-09

### Changed

- **Video Player Controls Layout**: Improved video player control button positioning to center all navigation controls together. Previous, Play/Pause, and Next buttons now appear grouped in the center third of the video instead of being spread across the edges. This creates a more cohesive control layout that's easier to use. Also enabled navigation buttons in the lightbox video player, allowing users to navigate between media items directly from the video overlay without closing the lightbox. ([#211](https://github.com/djryanj/media-viewer/issues/211))

- **Video Scaling**: Fixed video sizing in both playlist player and lightbox to properly scale small videos to fill the viewport vertically while maintaining aspect ratio. Small videos (e.g., 450x360) now scale up to fill the available vertical space instead of displaying at their native resolution. Container elements now use explicit dimensions with flex layout to prevent shrinking to video natural size, allowing `object-fit: contain` to properly scale video content up or down as needed. ([#213](https://github.com/djryanj/media-viewer/issues/213))

- **Playlist Sidebar**: Videos in the playlist player now automatically resize when the playlist sidebar is opened in theater or landscape modes, maintaining proper aspect ratio and ensuring the video remains fully visible without being obscured by the sidebar. The playlist toggle button stays anchored to the edge between the video and playlist for easy access. ([#212](https://github.com/djryanj/media-viewer/issues/212))

## [0.11.1] - 2026-02-09

### Changed

- **Mobile Drag Selection**: Enhanced selection mode drag behavior on mobile devices. Gallery now freezes (prevents scrolling) during drag selection, making multi-row selection practical and intuitive. Drag selection now uses range-based logic that follows reading order - all items between the start and end points are selected, not just items directly touched. For example, starting on the last item of a row and dragging down three rows will select that item plus all items in the rows between. Works naturally whether dragging forward or backward through the gallery. Optimized for performance in large libraries by caching the gallery items array during drag operations, eliminating expensive DOM queries on every touch move event. ([#152](https://github.com/djryanj/media-viewer/issues/152))

- **Gallery Tag Icon**: Reduced visual prominence of tag icon in gallery view. Changed icon color from bright accent to muted neutral tone, reduced background opacity from 70% to 40%, and replaced bright accent border with subtle semi-transparent outline. Icon remains fully functional but is less visually obtrusive. ([#207](https://github.com/djryanj/media-viewer/issues/207))

## [0.11.0] - 2026-02-09

### Added

- **Tag Manager**: Added comprehensive tag management interface in Settings modal under new "Tags" tab. View all tags with usage counts, search/filter tags, sort by name or usage count, rename tags across entire library with automatic merge support for duplicate names, delete tags from all files with styled confirmation dialogs showing impact, and find unused tags (tags with zero file associations) for cleanup. All tag operations are transactional with detailed feedback showing affected file counts. Backend API provides four new endpoints: `GET /api/tags/stats` (list all tags with counts), `GET /api/tags/unused` (find unused tags), `POST /api/tags/{tag}/rename` (rename everywhere with merge), `DELETE /api/tags/{tag}/delete` (cascade delete). Database operations use LEFT JOIN for efficient counting and proper CASCADE delete relationships. Supports case-only tag renames (e.g., "animal" → "Animal"). Includes comprehensive integration tests for all database and handler operations. ([#148](https://github.com/djryanj/media-viewer/issues/148))

## [0.10.2] - 2026-02-08

### Added

- **Short Video Thumbnails**: Fixed thumbnail generation failure for videos shorter than 1 second using a three-stage fallback strategy. First attempt uses standard 1-second seek (fast, works for 99% of videos). If that produces no output, video duration is probed with ffprobe and an intelligent seek time is calculated at 10% into the video (minimum 0.1 seconds, no maximum cap). Final fallback attempts extraction without seek time if intelligent retry fails. This ensures optimal performance for normal videos while gracefully handling short videos and edge cases without impacting the common case. ([#139](https://github.com/djryanj/media-viewer/issues/139))

### Improved

- **Thumbnail Failure Logging**: Enhanced thumbnail generation error logging to provide detailed diagnostic information when thumbnail generation fails. Error logs now include the specific file path, file type (image/video/folder), failure stage (decode/encode/FFmpeg), and detailed error messages including FFmpeg stderr output. This makes it significantly easier to diagnose thumbnail generation issues by identifying which files failed and why. Added corresponding troubleshooting documentation in admin guide with log checking commands and resolution steps. ([#139](https://github.com/djryanj/media-viewer/issues/139))

## [0.10.1] - 2026-02-08

### Added

- **Transcoder Log Files**: Added optional transcoder logging via `TRANSCODER_LOG_DIR` environment variable. When configured, FFmpeg output for each transcode operation is saved to timestamped log files (`YYYYMMDD-HHMMSS-videoname-wWIDTH.log`). Useful for debugging video transcoding issues. Log files include transcode timestamp, source path, target width, and complete FFmpeg stderr output. This is in preparation for[#178](https://github.com/djryanj/media-viewer/issues/178).

### Fixed

- **Gallery Filter Type Selection**: Fixed filter dropdown to correctly filter files by type (images, videos, playlists). Corrected frontend filter values to use singular forms ("image", "video", "playlist") matching backend database schema. Added automatic viewport filling when filter results in few items - infinite scroll now continues loading until viewport is filled or no more items available. Fixed "All" filter to properly clear filter and reload full directory listing. Folders are always shown for navigation regardless of filter selection. ([#194](https://github.com/djryanj/media-viewer/issues/194))

- **Lightbox Clock Mobile Alignment**: Fixed lightbox clock positioning on mobile devices in both portrait and landscape orientations. Clock now properly aligns with other control buttons at 4px from top, matching button height (48px) with appropriate padding. Reduced font size and optimized spacing to fit alongside autoplay and loop controls without overlapping. ([#188](https://github.com/djryanj/media-viewer/issues/188))

- **Video Controls Auto-Hide on Mobile**: Fixed video controls not auto-hiding on mobile devices in video players. Added touch event handlers to detect taps on video area, preventing mousemove events from constantly resetting the hide timer. Controls now properly hide after 3 seconds when video is playing, and can be toggled by tapping on the video (excluding control buttons). Improved control visibility logic to only restart hide timer when controls transition from hidden to visible. ([#187](https://github.com/djryanj/media-viewer/issues/187))

- **Pagination Consistency**: Standardized page size to 50 items across frontend and backend. Backend `/api/files` endpoint default `PageSize` reduced from 100 to 50 to match frontend infinite scroll `batchSize`, ensuring consistent pagination and preventing item count mismatches. ([#192](https://github.com/djryanj/media-viewer/issues/192))

- **Infinite Scroll Retry on Recovery**: Fixed infinite scroll not retrying failed loads when server connectivity is restored. Now properly tracks load failure state and automatically retries loading more items when Gallery's connectivity check detects server is back online. ([#192](https://github.com/djryanj/media-viewer/issues/192))

- **HEAD Request Body for Liveness Check**: Fixed `/livez` endpoint returning JSON body for HEAD requests. HEAD requests now properly return only headers with no body, as per HTTP specification, improving efficiency of connectivity polling. ([#192](https://github.com/djryanj/media-viewer/issues/192))

- **Infinite Scroll Race Conditions**: Added safeguards to prevent multiple simultaneous page loads in infinite scroll, including early return checks for `isLoading` state and safety validation against total item count. Prevents loading beyond total items and duplicate page requests during rapid scroll or connectivity recovery. ([#192](https://github.com/djryanj/media-viewer/issues/192))

- **Video Transcoding and Caching**: Fixed transcoder cache not being used - all transcode operations were streaming-only with no caching. Implemented hybrid caching strategy: fast remux operations (h264 videos) skip caching since they complete in under 1 second, while slow re-encode operations (incompatible codecs like HEVC, or any video requiring scaling) are cached for reuse. Added cache validation with source file modification time checking to invalidate stale cache. Fixed bug where scaling with `-c:v copy` codec would fail - now forces re-encoding when scaling is required since copy mode is incompatible with video filters. Added concurrent safety with cache locks to prevent duplicate transcode operations. ([#190](https://github.com/djryanj/media-viewer/issues/190))

- **Video Progress Bar During Transcoding**: Fixed video progress bar and seeking issues during transcoding by implementing complete-transcode-before-serving strategy with proper MP4 finalization. FFmpeg now writes directly to file instead of piping through stdout, enabling use of the `+faststart` movflag which places the MP4 moov atom at the beginning of the file for immediate duration detection. The server waits for transcoding to complete (up to 5 minutes) before serving the video, ensuring proper MP4 structure with Range request support. This fixes duration detection issues where video length would expand progressively and seeking would fail. Frontend extended video load timeout from 10 seconds to 5 minutes for transcoding scenarios. After 3 seconds of loading, users receive an informative toast notification explaining that the video is being prepared and may take a few minutes for large files. Progress logging shows transcode status every 2 seconds with size and transfer rate. Once cached, subsequent video loads are instant with perfect Range support using `http.ServeFile`. Updated `buildFFmpegArgs` signature to accept output path parameter for proper file-based transcoding. Consolidated progressive streaming tests into main test file. ([#191](https://github.com/djryanj/media-viewer/issues/191))

- **Lightbox Button and Clock Alignment**: Fixed lightbox control buttons (favorite, tags, autoplay, loop) being hidden behind video content by adding `z-index: 20`. Fixed lightbox clock misalignment on desktop where clock was 4px from top instead of 8px (0.5rem) like other buttons. Removed overly broad mobile media query override that was affecting desktop and tablet screens, allowing clock to properly inherit base positioning and align with other top controls. ([#198](https://github.com/djryanj/media-viewer/issues/198))

## [0.10.0] - 2026-02-07

### Added

- **Clock Display**: Added configurable clock display for lightbox and playlist views showing current browser time (hours and minutes only). Clock appears in top-right corner, positioned to avoid overlapping controls. Dimmed by default (30% opacity) and brightens to full opacity on hover. Clock updates every minute and supports both 12-hour (with AM/PM) and 24-hour time formats. Enabled by default with preferences stored in localStorage. Automatically adjusts positioning in theater mode and landscape mode to prevent overlapping with player controls. Clock visibility persists across sessions and respects user preferences.

- **Display Settings Tab**: Added new "Display" tab to settings modal (positioned between Cache and About tabs) for visual display preferences. Includes toggle switch for enabling/disabling clock and dropdown selector for 12/24 hour time format. Added configuration for default sort order (sort field and sort direction) that applies to all folders by default. Features responsive layout with properly styled toggle switches, labels, and hint text. Settings changes take effect immediately without requiring page reload.

- **Per-Folder Sort Preferences**: Added ability to remember custom sort preferences on a per-folder basis. When changing sort order or sort field in any folder, that preference is saved to localStorage and applied automatically when returning to that folder. Folder-specific sort preferences override the global default sort settings. Added reset button (rotate-ccw icon) that appears only when a folder has a custom sort that differs from global defaults, allowing users to clear the folder-specific preference and revert to defaults. ([#86](https://github.com/djryanj/media-viewer/issues/86))

- **Download Button**: Added download button to both lightbox and gallery views. In the lightbox, the button appears in the bottom right corner. In the gallery, it appears on hover in the bottom right of each thumbnail. Keyboard shortcut 'D' added for lightbox download. Extended `/api/file/{path}` endpoint to support `?download=true` query parameter for forcing file downloads with proper Content-Disposition headers. ([#166](https://github.com/djryanj/media-viewer/issues/166))

- **Global Fetch Timeout Wrapper**: Implemented `fetchWithTimeout` global utility function that wraps all fetch requests with a default 5-second timeout and proper AbortController handling. This ensures consistent timeout behavior across all API calls throughout the application. ([#169](https://github.com/djryanj/media-viewer/issues/169))

- **Comprehensive Offline Handling**: Added robust server offline detection and recovery across the application:
    - All network requests use AbortController with proper timeout handling (3-10s depending on operation)
    - Gallery thumbnails and lightbox images use fetch with blob URLs instead of direct img.src to enable request cancellation
    - Active connectivity polling when server is detected offline (checks `/api/auth/check` every 5 seconds)
    - Automatic retry of failed content when server connectivity is restored
    - Smart retry strategy: only visible thumbnails retry immediately, off-screen failures retry on scroll into view
    - Scroll-based lazy retry mechanism for failed thumbnails
    - Consecutive failure tracking (2 failures triggers connectivity check)
    - Clear user feedback with toast notifications (offline warnings, recovery messages)
    - Video loading timeout detection (10 seconds)
    - Session keepalive failure tracking with warnings after 2 consecutive failures
    - Lightbox image preloading converted to use fetch with proper cancellation
    - Batch tag loading with timeout protection
    - Prevents infinite loading states and hanging network requests

### Changed

- **Setup Check Optimization**: Refactored authentication to use a database `setup_complete` flag and consolidated the setup check into `/api/auth/check`. This eliminates the redundant `/api/auth/setup-required` endpoint and reduces login page load from 2 API calls to 1, improving both performance and API design. The `/api/auth/check` endpoint now returns both authentication status and setup requirements in a single response. Includes automatic migration for existing databases. ([#83](https://github.com/djryanj/media-viewer/issues/83))

- **Thumbnail Loading**: Changed gallery thumbnail loading from direct img.src assignment to fetch-based blob loading with AbortController, enabling proper request cancellation on timeout. Timeout increased from 7s to 10s for initial load to accommodate lazy loading delays. Retry timeout set to 5s since server is known to be online. ([#169](https://github.com/djryanj/media-viewer/issues/169))

- **Lightbox Image Loading**: Converted from img.src to fetch with blob URLs, enabling proper network request cancellation. Timeout set to 5 seconds with automatic retry on recovery. ([#169](https://github.com/djryanj/media-viewer/issues/169))

- **Error Messages**: Offline error messages changed from "Thumbnails cannot be loaded" to "Content cannot be loaded" to be context-appropriate for both gallery and lightbox usage. ([#169](https://github.com/djryanj/media-viewer/issues/169))

- **Connectivity Check Optimization**: Changed server connectivity checks from `GET /api/auth/check` to `HEAD /livez` for improved efficiency. The liveness endpoint is lighter weight (no database queries or JSON parsing required), and HEAD requests eliminate unnecessary response body transmission. Backend now supports both GET and HEAD methods for `/livez` endpoint. ([#169](https://github.com/djryanj/media-viewer/issues/169))

### Fixed

- **Lightbox Close Button**: Fixed lightbox close button not being clickable when overlapping video elements in landscape mode on mobile. Added proper z-index stacking to ensure navigation buttons (close, prev, next) are always above video content. ([#174](https://github.com/djryanj/media-viewer/issues/174))

- **Lightbox Tag Button State**: Fixed tag button in lightbox not updating immediately when tags are applied or removed via the tag manager. The button now correctly shows the highlighted state when tags are present. ([#175](https://github.com/djryanj/media-viewer/issues/175))

- **Hanging Network Requests**: Fixed infinite hanging network requests when server goes offline by implementing proper AbortController cancellation across all image/thumbnail loading. Previously, img.src assignments would hang forever even with timeout handlers. ([#169](https://github.com/djryanj/media-viewer/issues/169))

- **Race Conditions in Retry Logic**: Fixed multiple race conditions in thumbnail retry mechanism:
    - Added `retryInProgress` flag to prevent overlapping retry operations
    - Removed batching delays to enable immediate parallel retry of visible content
    - Fixed issue where `failedThumbnails` array was cleared during reset, losing retry targets
    - Proper completion tracking for all retry operations
    - Prevention of excessive API calls with connectivity check guards

- **Lightbox Preload Blocking**: Fixed lightbox image preloading using img.src without timeout, causing app to hang when preloading fails. Now uses fetch with proper cancellation. ([#169](https://github.com/djryanj/media-viewer/issues/169))

- **Video Loading Timeout**: Added 10-second timeout detection for video streams that fail to start, preventing infinite loading states when video endpoint is unreachable. ([#169](https://github.com/djryanj/media-viewer/issues/169))

- **Batch Tag Loading**: Fixed `/api/tags/batch` calls across lightbox, tags, playlist, and tag-clipboard not having timeout protection, causing potential hangs. Now uses `fetchWithTimeout` with 5-second limit. ([#169](https://github.com/djryanj/media-viewer/issues/169))

- **GIF Loop Detection**: Fixed animation loop detection incorrectly restarting all GIFs, including those with infinite loop metadata. Implemented proper GIF binary parser to extract Netscape Application Extension loop count. System now only monitors and restarts GIFs that play once or a finite number of times (loop count > 0 or null), while skipping infinitely-looping GIFs (loop count = 0) which the browser handles natively. Increased unchanged frame threshold from 2 seconds to 10 seconds to prevent false positives on GIFs with slow animations or pauses. Added comprehensive debug logging for GIF loop metadata parsing and monitoring decisions. ([#121](https://github.com/djryanj/media-viewer/issues/121))

## [0.9.0] - 2026-02-07

### Added

- Major overhaul to the playlist view, including better video controls, better playlist positioning, fullscreen and theater mode views, better audio controls, and more. ([#173](https://github.com/djryanj/media-viewer/issues/173))

- **Reusable VideoPlayer Component**: Created a shared VideoPlayer component used by both lightbox and playlist player, eliminating ~400 lines of duplicate code. Component features custom controls with volume persistence, audio detection, and touch-optimized progress bar. ([#173](https://github.com/djryanj/media-viewer/issues/173))

- The above component is now in use for both the playlist and lightbox video players.

### Changed

- **File Rename**: Renamed `player.js` to `playlist.js` and `Player` object to `Playlist` for better clarity and consistency. ([#173](https://github.com/djryanj/media-viewer/issues/173))

### Removed

- **Favorites Prometheus Metric**: Removed `media_viewer_favorites_total` Prometheus metric as it did not provide useful monitoring information. The `TotalFavorites` field remains in the database statistics for use by the frontend UI.

### Fixed

- **Prometheus Metrics for Streaming Endpoints**: Fixed false positive high-latency alarms for `/api/stream/` endpoints in Prometheus monitoring. The metrics middleware now tracks time-to-first-byte (TTFB) instead of total streaming duration for video/audio streaming endpoints. This prevents p95 latency metrics from incorrectly showing 10+ seconds when users are simply watching videos for extended periods. Non-streaming endpoints continue to use total request duration as before.

- **Prometheus Metrics Cardinality**: Fixed metrics cardinality explosion for static assets and playlist endpoints. Paths like `/js/gallery.js`, `/css/style.css`, `/icons/icon-192.png`, and `/api/playlist/12345` are now normalized to `/js/{path}`, `/css/{path}`, `/icons/{path}`, and `/api/playlist/{path}` respectively, preventing individual file metrics from creating thousands of unique metric series.

- **Tags Metric Always Zero**: Fixed `media_viewer_tags_total` Prometheus metric always reporting zero. The `CalculateStats()` function was missing a query to count tags from the `tags` table. The metric now correctly reflects the actual number of unique tags in the database. ([#153](https://github.com/djryanj/media-viewer/issues/153))

## [0.8.4] - 2026-02-06

### Bug Fixes

- **WebAuthn Error Messaging**: Fixed misleading "not supported by browser" message that appeared when the real issue was server misconfiguration or missing credentials. The system now accurately distinguishes between four distinct states:
    - Server configuration errors (RP_ID/Origins mismatch) - shows specific configuration guidance
    - Missing passkey credentials (enabled but not yet registered)
    - Insecure context (HTTP instead of HTTPS)
    - Browser not supporting WebAuthn

    Added runtime validation to detect RP_ID and origin mismatches, and extended error messaging to both the settings modal and login page with context-appropriate warnings. Fixed several related bugs including constructor order in WebAuthnManager, duplicate const declarations, and conditional UI null checks. ([#165](https://github.com/djryanj/media-viewer/issues/165))

- **PWA Logout Behavior**: Fixed two issues when logging out in PWA mode:
    - Automatic passkey login now skips for 3 seconds after logout, preventing the immediate passkey prompt that would re-authenticate the user
    - Back button on the login screen after logout now closes the PWA instead of returning to the authenticated app by using `window.location.replace()` instead of `window.location.href`
      ([#167](https://github.com/djryanj/media-viewer/issues/167))

- **Lightbox Video Mode Hotzones**: Fixed navigation hotzone positioning in video mode to dynamically adapt to actual video size instead of using fixed percentages. Hotzones now end 50px above the video bottom, keeping them clear of native video controls regardless of video dimensions or aspect ratio. Added proper timing checks using `videoHeight`/`videoWidth` properties and `requestAnimationFrame` to ensure calculations happen after video metadata loads and layout completes.

- **Lightbox Swipe Gestures**: Fixed swipe gestures in lightbox only working when touching the image or video itself. Swipe events are now attached to the full lightbox overlay, allowing navigation from anywhere on screen.

### API Changes

- **WebAuthn Available Endpoint**: Extended `/api/auth/webauthn/available` response with two new fields:
    - `hasCredentials` (boolean) - indicates if any passkey credentials are registered
    - `configError` (string) - contains validation error message if server configuration is incorrect

## [0.8.3] - 2026-02-06

### Bug Fixes

- **Tag Modal Touch Events (Mobile)**: Fixed tag management modal on mobile devices where taps would pass through to the underlying UI, causing unintended screen jumps and accidental activation of multiple actions. The modal now properly prevents body scroll and captures all touch events. ([#161](https://github.com/djryanj/media-viewer/issues/161))

## [0.8.2] - 2026-02-06

### Bug Fixes

- **Sorting Controls**: Fixed broken sorting functionality where sort field and direction controls were not working. The JavaScript was referencing incorrect element IDs (`sort-field` and `sort-order`) that didn't match the actual HTML element IDs (`sort-select` and `sort-direction`). ([#159](https://github.com/djryanj/media-viewer/issues/159))

## [0.8.1] - 2026-02-05

### Bug Fixes

- **Search Tag Parsing**: Fixed critical bug where tags with spaces in their names could not be searched. The tag filter parser now correctly handles tag names containing spaces by parsing character-by-character until the next tag pattern is encountered. (e.g., `tag:summer vacation` now correctly searches for the tag "summer vacation") ([#156](https://github.com/djryanj/media-viewer/issues/156))
- **Search Results Header Layout**: Fixed search results header to match the main page header layout on desktop:
    - Added Media Viewer logo and title to the left side of the search header on desktop (hidden on mobile/tablet)
    - Fixed header width constraint - now properly limited to 1800px and centered like the main header
    - Moved padding from outer container to inner container for consistent spacing
    - Removed duplicate CSS rules that were causing layout conflicts
      ([#156](https://github.com/djryanj/media-viewer/issues/156))

### Code Quality

- **Search Query Refactoring**: Added comprehensive unit tests for `parseTagFilters` and `findTagEnd` helper functions with 37 test cases covering edge cases, whitespace handling, case sensitivity, and complex multi-pattern queries. ([#156](https://github.com/djryanj/media-viewer/issues/156))

## [0.8.0] - February 5, 2026

### New Features

- **Select All Enhancement**: The "Select All" function now selects all items in the current directory, not just those currently loaded in the viewport. A new lightweight API endpoint (`/api/files/paths`) efficiently retrieves item metadata without full file details, enabling selection of thousands of items with minimal overhead. ([#141](https://github.com/djryanj/media-viewer/issues/141))

- **Persistent Selection State**: Selected items now maintain their visual selection state as you scroll through large directories. Items loaded via infinite scroll automatically reflect the correct selection status. ([#141](https://github.com/djryanj/media-viewer/issues/141))

- **Sample Media Download Script**: Added a developer script to download a large number of royalty-free sample media files

**Enhanced Select All Functionality** ([#118](https://github.com/djryanj/media-viewer/issues/118))

- The "Select All" function now selects all items in the current directory, including items not yet loaded in the viewport. A new lightweight API endpoint efficiently retrieves item metadata, enabling selection of thousands of items with minimal overhead.
- Selected items maintain their visual selection state as you scroll through large directories. Items loaded via infinite scroll automatically display the correct selection status.

**Improved Tag Copy/Paste Workflow** ([#118](https://github.com/djryanj/media-viewer/issues/118))

- Added "Copy Tags to Clipboard" button in the tag management modal, allowing you to copy tags from any item for later pasting to other items not currently in view.
- New "Copy All Tags" option when managing tags for multiple items with different tags, copying all unique tags across the selection.
- Added ability to add new tags during paste/merge operations, with an option to apply new tags to the source item as well.
- Partial tags (tags not on all selected items) now display a merge button (+) to quickly apply them to all selected items.
- Keyboard shortcuts: `Ctrl+C` copies common tags, `Ctrl+Shift+C` copies all unique tags when the tag modal is open.

**Tag Modal Enhancements** ([#118](https://github.com/djryanj/media-viewer/issues/118))

- When multiple items are selected with different tags, the modal now clearly distinguishes between common tags (on all items) and partial tags (on some items).
- Partial tags display a visual indicator (~) and tooltip showing which items have the tag.
- Single item selection in bulk mode now displays the item name instead of "1 items selected".

**Tag Exclusion in Search** ([#18](https://github.com/djryanj/media-viewer/issues/18))

- Search now supports excluding tags from results using `-tag:tagname` or `NOT tag:tagname` syntax.
- Combine inclusions and exclusions in a single query (e.g., `tag:vacation -tag:2023` finds items tagged "vacation" but not "2023").
- Mix text search with tag filters (e.g., `beach -tag:private` searches for "beach" excluding items tagged "private").
- Tag suggestions appear when typing `-` to help discover exclusion options.
- In search results, tags display an exclude button (−) on hover to quickly add that tag as an exclusion to the current search.
- Right-click or long-press on any tag in search results to access "Search for" or "Exclude" options.

**Editable Search in Results View** ([#18](https://github.com/djryanj/media-viewer/issues/18))

- Search results now include an editable search bar, allowing you to refine your search without closing the results view.
- Full autocomplete support with Tab to complete suggestions.
- Press `/` or `Ctrl+K` to focus the search bar from anywhere in the app.

**Tags in Search View Are Search Focused** ([#18](https://github.com/djryanj/media-viewer/issues/18))

- When in the Search view, the ability to edit tags using the tag chips has been replaced by a search-focused tag modal

### Performance Improvements

- **Search Query Optimization**: Refactored search suggestion logic for improved maintainability and code quality. Reduced cognitive complexity from 39 to manageable levels by breaking down `SearchSuggestions` into focused helper functions. ([#18](https://github.com/djryanj/media-viewer/issues/18))

- **Database Pagination Limits**: Increased maximum page size from 500 to 100,000 items to support efficient bulk operations. The lightweight file path endpoint can now retrieve metadata for entire large directories in a single request without pagination overhead. ([#141](https://github.com/djryanj/media-viewer/issues/141))

- **Batch Tag Operations**: Tag operations on multiple items now use batch API endpoints, dramatically reducing the number of server requests. Previously, selecting 500 items and applying tags would generate 500+ individual API calls; now this is accomplished with just 2-3 requests. ([#141](https://github.com/djryanj/media-viewer/issues/141))

- **Bulk Tag Limits Increased**: The maximum number of items for bulk tag operations has been increased from 100 to 10,000, supporting large-scale library organization. ([#141](https://github.com/djryanj/media-viewer/issues/141))

- **Optimized Tag Refresh**: After bulk tag operations, gallery items are refreshed using a single batch request instead of individual requests per item. ([#141](https://github.com/djryanj/media-viewer/issues/141))

### Bug Fixes

- **Search Tag Modal Mobile Layout**: Fixed positioning issues where the search tag modal appeared with unwanted vertical space at the top on mobile devices. Modal now properly fills the screen from top to bottom with correct scrolling behavior. ([#18](https://github.com/djryanj/media-viewer/issues/18))
- **Search Input State**: Search input field now properly clears when closing the search view, preventing confusion from stale query text. ([#18](https://github.com/djryanj/media-viewer/issues/18))
- **Escape Key Priority**: Fixed escape key handling to prioritize closing the search tag modal over closing the entire search view when the modal is open. ([#18](https://github.com/djryanj/media-viewer/issues/18))
- **Tag Suggestions Styling**: Fixed an issue where tag suggestions in the tag modal appeared visually spread out instead of compact.
- Fixed inconsistent behavior between single-item tag modal and selection-mode tag modal. ([#118](https://github.com/djryanj/media-viewer/issues/118))
- Tags copied to clipboard now properly persist between folder navigation ([#118](https://github.com/djryanj/media-viewer/issues/118))
- **Lightbox Navigation Bug**: Fixed an issue where closing the lightbox while in a subfolder would incorrectly navigate up to the parent folder. The bug was caused by duplicate Escape key handlers in both the lightbox and history manager, each triggering `history.back()`. ([#147](https://github.com/djryanj/media-viewer/issues/147))
- If the database is closed, degrade gracefully (discovered during testing [#18](https://github.com/djryanj/media-viewer/issues/18))

### API Changes

- Added `GET /api/files/paths` - Returns lightweight file metadata (path, name, type) for all items in a directory
- Added `POST /api/tags/batch` - Retrieves tags for multiple files in a single request
- Updated `POST /api/tags/bulk` - Now supports up to 10,000 paths per request
- Updated `DELETE /api/tags/bulk` - Now supports up to 10,000 paths per request
- Updated database pagination - Maximum page size increased from 500 to 100,000 for bulk operation endpoints
- Updated `GET /api/search` - Now supports tag exclusion with `-tag:name` and `NOT tag:name` syntax
- Updated `GET /api/search/suggestions` - Returns exclusion suggestions when query starts with `-tag:` or `-`
- Updated `SearchSuggestion` model - Added `itemCount` field, changed `Type` from `FileType` to `string` to support `tag` and `tag-exclude` types

### Documentation

- Added information on downloading sample media using script

### Keyboard Shortcuts

| Shortcut        | Context                 | Action                            |
| --------------- | ----------------------- | --------------------------------- |
| `Ctrl+C`        | Tag modal open          | Copy common tags to clipboard     |
| `Ctrl+Shift+C`  | Tag modal open          | Copy all unique tags to clipboard |
| `Ctrl+A`        | Selection mode          | Select all items                  |
| `Ctrl+V`        | Selection mode          | Paste tags to selected items      |
| `/` or `Ctrl+K` | Anywhere                | Focus search bar                  |
| `Tab`           | Search with suggestions | Autocomplete current suggestion   |
| `Escape`        | Search results open     | Close search results              |

## [0.7.2] - February 4, 2026

This is a bugfix and testing package release with no new features.

### Added

- Comprehensive test suite for the backend with several thousand tests of all kinds (unit, integration, performance) across all packages
- Integrated testing into GitHub release process
- Documentation on testing

### Fixed

- Several bugs found during the testing process were addressed

## [0.7.1] - February 3, 2026

### Fixed

- **Database Migration Error** - Fixed SQLite error when migrating to add `content_updated_at` column
    - SQLite's `ALTER TABLE ADD COLUMN` doesn't support expressions in DEFAULT clause
    - Changed from `DEFAULT (strftime('%s', 'now'))` to `DEFAULT 0` with immediate UPDATE
    - Migration now succeeds on existing databases without "Cannot add a column with non-constant default" error

## [0.7.0] - February 3, 2026

### Added

- **Comprehensive Prometheus Metrics** - Added 50+ metrics across 8 categories for deep observability
    - **Filesystem I/O Metrics**: Track latency by operation type (stat, readdir) and directory path
        - `media_viewer_filesystem_operation_duration_seconds{operation, directory}` - Histogram of filesystem operation latencies
        - `media_viewer_filesystem_operations_total{operation, directory}` - Counter of filesystem operations
    - **Thumbnail Generation Metrics**: Detailed performance tracking across all phases
        - `media_viewer_thumbnail_cache_read_latency_seconds` - Cache lookup performance
        - `media_viewer_thumbnail_memory_usage_bytes{type}` - Memory consumption during generation
        - `media_viewer_thumbnail_generation_duration_detailed_seconds{type, phase}` - Per-phase timing (decode, resize, encode, cache)
        - `media_viewer_thumbnail_ffmpeg_duration_seconds` - Video frame extraction time
        - `media_viewer_thumbnail_cache_hits_total` / `media_viewer_thumbnail_cache_misses_total` - Cache effectiveness
    - **Indexer Performance Metrics**: Track media library scanning efficiency
        - `media_viewer_indexer_run_duration_seconds` - Full index run time
        - `media_viewer_indexer_files_per_second` - Indexing throughput
        - `media_viewer_indexer_batch_processing_duration_seconds` - Database batch operation timing
        - `media_viewer_indexer_files_processed_total` / `media_viewer_indexer_files_added_total` / `media_viewer_indexer_files_updated_total` - File operation counters
    - **Database Transaction Metrics**: Monitor database performance
        - `media_viewer_db_transaction_duration_seconds{type}` - Transaction latency (commit, rollback)
        - `media_viewer_db_rows_affected{operation}` - Rows modified by operation (upsert_file, delete_files)
        - `media_viewer_db_size_bytes{file}` - Database file sizes (main, wal, shm)
    - **Memory Pressure Gauge**: Single indicator for Go memory health
        - `media_viewer_memory_pressure_ratio` - Ratio of allocated memory to GOMEMLIMIT (0.0-1.0)
    - **HTTP Request Metrics**: Fixed high-cardinality issue with path normalization
        - Paths like `/api/file/*`, `/api/thumbnail/*`, `/api/stream/*` now normalized to prevent metric explosion

- **Complete Metrics Documentation**
    - New [docs/admin/metrics.md](docs/admin/metrics.md) with comprehensive reference
    - All 50+ metrics documented with types, labels, descriptions, and units
    - PromQL query examples for common monitoring scenarios
    - Example alerting rules for production deployments
    - Performance tuning guidance for metric collection
    - Grafana dashboard structure with 7 organized sections

- **Admin Documentation Section**
    - New [docs/admin/overview.md](docs/admin/overview.md) as landing page for admin guides
    - Updated navigation in mkdocs.yml with dedicated Admin section
    - Cross-referenced metrics documentation from configuration guides

- GitHub action definition to automatically build and publish documentation changes to documentation site

### Changed

- **Database Schema - Separated Record Touch from Content Change** - Critical fix for indexer cleanup and thumbnail regeneration
    - Added `content_updated_at` field to track when file content actually changes
    - `updated_at` now always updated when indexer touches a file (for "last seen" cleanup logic)
    - `content_updated_at` only updated when file size, mod_time, type, or hash changes (for thumbnail invalidation)
    - Fixes catastrophic bug where indexer's cleanup deleted all files as "missing" because `updated_at` was preserved
    - Fixes thumbnail cache being invalidated on every index run even when no files changed
    - **Migration**: Schema automatically migrates on first startup; existing files get `content_updated_at` set from `updated_at`

- **Environment Variables Documentation** - Corrected [docs/admin/environment-variables.md](docs/admin/environment-variables.md)
    - Fixed variable names: `MEDIA_DIR` (not MEDIA_PATH), `CACHE_DIR` and `DATABASE_DIR` (separate, not DATA_PATH)
    - Corrected duration format examples: Go duration syntax (`24h`, `30m`, `10s`) instead of milliseconds
    - Added missing variables: `METRICS_PORT`, `METRICS_ENABLED`, `INDEX_INTERVAL`, `POLL_INTERVAL`, `THUMBNAIL_INTERVAL`
    - Added complete WebAuthn configuration section
    - Added memory management section: `MEMORY_LIMIT`, `MEMORY_RATIO`, `GOMEMLIMIT`
    - Added logging and debugging section: `LOG_LEVEL`, `LOG_STATIC_FILES`, `LOG_HEALTH_CHECKS`
    - Added Docker Compose and Kubernetes configuration examples

- **Documentation Cross-References** - Updated multiple documentation files
    - [docs/admin/server-config.md](docs/admin/server-config.md) - Added metrics configuration section
    - [docs/admin/thumbnails.md](docs/admin/thumbnails.md) - Added metrics monitoring section
    - [docs/troubleshooting.md](docs/troubleshooting.md) - Added metrics-based diagnostics
    - [docs/index.md](docs/index.md) - Added link to metrics documentation

- Updated reference Grafana dashboard [hack/grafana/dashboard.json](hack/grafana/dashboard.json) with above metrics
- Updated README.md to point to documentation for most things ([#110](https://github.com/djryanj/media-viewer/issues/110))

### Fixed

- **Critical: Indexer Deleted All Files on Every Run** - Fixed catastrophic regression
    - **Root cause**: Indexer cleanup logic deletes files WHERE `updated_at < index_start_time`
    - **Problem**: Previous fix preserved `updated_at` for unchanged files, causing them to be deleted as "missing"
    - **Solution**: Separated `updated_at` (always touched) from `content_updated_at` (only on changes)
    - **Impact**: Database is now properly maintained; files no longer disappear on every index run

- **Unnecessary Thumbnail Regeneration** - Files with unchanged modification times no longer trigger regeneration ([#117](https://github.com/djryanj/media-viewer/issues/117))
    - **Root cause**: `content_updated_at` was being set even when content hadn't changed
    - **Fix**: Use COALESCE to handle NULL values properly, only update timestamp when size/modtime/type/hash actually changes
    - **Benefit**: Thumbnails only regenerate when files actually change, not on every index run

- **Gosec Security Warning** - Fixed potential integer overflow in thumbnail memory tracking
    - Changed `int64(memAfter.Alloc - memBefore.Alloc)` to direct `float64()` conversion
    - Prevents gosec G115 warning about potential integer overflow

- **Database Permission Diagnostics** - Added comprehensive permission checking for SQLite WAL mode
    - Checks and logs database directory, main DB file, WAL file, and SHM file permissions
    - Automatically attempts to fix read-only WAL/SHM files from previous container runs
    - Helps diagnose "disk I/O error: read-only file system" errors in Kubernetes deployments
    - Critical for containers using `readOnlyRootFilesystem: true` with persistent volume mounts

- **Lightbox Hotzone Positioning** - Fixed mobile navigation hotzones to work correctly regardless of image size
    - Changed hotzones from `position: absolute` to `position: fixed` so they extend to screen edges even when images are narrower than viewport
    - Added vertical spacing (`top: 60px`, `bottom: 80px`) to prevent blocking close button and info bar
    - Hide hotzones on desktop (≥900px) where dedicated prev/next buttons are used
    - Added gradient masks for smooth fade-out at top and bottom edges of all hotzones
    - Enhanced video mode hotzones with additional vertical gradient masks for polished appearance near video controls

- WebAuthN cleanup doesn't try to happen if it's not enabled ([#120](https://github.com/djryanj/media-viewer/issues/120))
- Entering selection mode on mobile performance enhancements ([#79](https://github.com/djryanj/media-viewer/issues/79))
- On initial password creation, tab order selected the "eye" icons instead of skipping to the next input box ([#127](https://github.com/djryanj/media-viewer/issues/127))
- Eye icons were not rendering properly and they were being selected as with the above in the password change modal ([#127](https://github.com/djryanj/media-viewer/issues/127))
- Dockerfile issues with cross compilation as a result of moving to VIPS package ([#117](https://github.com/djryanj/media-viewer/issues/117))

### Performance

- **Optimized Thumbnail Memory Usage with libvips** - Integrated libvips for true decode-time downsampling
    - **Root cause**: Standard image libraries load full original into memory before resizing
    - **Solution**: libvips provides decode-time shrinking - never loads full-size image into memory
    - **Implementation**:
        - Added govips library with conservative memory settings (50MB cache, single concurrent operation)
        - JPEG files now use vips decode-time shrinking when available
        - Fallback to two-stage resize if vips unavailable (Box filter → Lanczos)
        - Fallback to standard imaging library for non-JPEG or if vips fails
    - **Memory Impact**: For 6000x4000 JPEG (96MB full decode):
        - Standard method: Loads 96MB, resizes to 10MB = 106MB peak
        - libvips: Decodes directly to 10MB = 10MB peak (~90% reduction)
    - **Quality**: Maintains excellent quality using Lanczos resampling in vips
    - **Compatibility**: Gracefully degrades if libvips not available (dev environments)
    - **Benefit**: Dramatic memory reduction for large JPEGs, enables higher concurrency, reduces GC pressure

- **Instrumented Code Paths** - All major operations now emit detailed metrics
    - `internal/database/database.go` - Transaction duration, rows affected, storage size
    - `internal/indexer/indexer.go` - Run duration, throughput, batch timing, filesystem operations
    - `internal/media/thumbnail.go` - Cache latency, memory usage, phase-by-phase timing, FFmpeg duration
    - `internal/metrics/metrics.go` - Centralized metric definitions with optimized histogram buckets

- **Reduced Metrics Cardinality** - Fixed high-cardinality path metrics
    - File paths in `/api/file/*`, `/api/thumbnail/*`, `/api/stream/*` now normalized
    - Prevents Prometheus memory bloat from thousands of unique metric labels
    - Maintains useful metrics without per-file granularity

### Developer Notes

#### Monitoring Setup

The new metrics enable comprehensive observability. Key areas to monitor:

1. **Filesystem Performance** - Critical for NFS deployments

    ```promql
    histogram_quantile(0.95, rate(media_viewer_filesystem_operation_duration_seconds_bucket[5m]))
    ```

2. **Thumbnail Efficiency** - Cache hit rate and generation times

    ```promql
    rate(media_viewer_thumbnail_cache_hits_total[5m]) /
    (rate(media_viewer_thumbnail_cache_hits_total[5m]) + rate(media_viewer_thumbnail_cache_misses_total[5m]))
    ```

3. **Indexer Throughput** - Files processed per second

    ```promql
    media_viewer_indexer_files_per_second
    ```

4. **Memory Pressure** - Early warning for memory limits
    ```promql
    media_viewer_memory_pressure_ratio > 0.9
    ```

See [docs/admin/metrics.md](docs/admin/metrics.md) for complete monitoring guide with Grafana dashboard structure, alerting rules, and performance tuning recommendations.

## [v0.6.0] - February 2, 2026

### Added

- **Passkey (WebAuthn) Authentication**
    - Passwordless authentication using biometrics (Face ID, Touch ID, Windows Hello) or security keys (YubiKey, Titan)
    - Support for platform authenticators (built-in device biometrics) and roaming authenticators (USB keys)
    - Conditional UI support for passkey autofill in password fields (Chrome 108+, Edge 108+, Safari 16+)
    - Auto-prompt for passkey login on supported browsers when passkeys are registered
    - Multi-passkey support: register passkeys on multiple devices
    - Named passkeys for easy device identification (e.g., "MacBook Pro", "iPhone")
    - Passkeys management UI in Settings → Passkeys tab:
        - List all registered passkeys with creation and last used dates
        - Add new passkeys with custom naming via modal dialog
        - Delete passkeys with confirmation
    - Custom passkey naming modal with better UX than browser's default prompt
    - Fallback to password authentication always available
    - **Secure Context Requirement**: WebAuthn requires HTTPS (or `http://localhost` for development)

- **New Environment Variables for WebAuthn**
    - `WEBAUTHN_ENABLED` - Enable/disable passkey authentication (default: `false`)
    - `WEBAUTHN_RP_ID` - Relying Party ID (your domain, e.g., `example.com`)
    - `WEBAUTHN_RP_NAME` - Display name shown in authenticator prompts (default: `Media Viewer`)
    - `WEBAUTHN_ORIGINS` - Comma-separated list of allowed origins (e.g., `https://example.com,https://media.example.com`)

- **New API Endpoints**
    - `GET /api/auth/webauthn/available` - Check if passkey login is available (WebAuthn enabled + credentials registered)
    - `POST /api/auth/webauthn/register/begin` - Start passkey registration ceremony
    - `POST /api/auth/webauthn/register/finish` - Complete passkey registration
    - `POST /api/auth/webauthn/login/begin` - Start passkey authentication ceremony
    - `POST /api/auth/webauthn/login/finish` - Complete passkey authentication and create session
    - `GET /api/auth/webauthn/passkeys` - List all registered passkeys
    - `DELETE /api/auth/webauthn/passkeys` - Delete a passkey by ID

- **New Database Tables**
    - `webauthn_credentials` - Stores registered passkey credentials with metadata (name, sign count, transports, timestamps)
    - `webauthn_sessions` - Stores WebAuthn ceremony challenge data (5-minute TTL)

- **Development Testing Support**
    - Comprehensive documentation for testing WebAuthn with ngrok, Cloudflare Tunnel, or mkcert
    - ngrok recommended for easiest mobile device testing with real HTTPS
    - Instructions for secure context requirements and browser-specific behavior
    - Developer troubleshooting guide for common WebAuthn issues

### Changed

- **Login Page Enhancements**
    - Passkey section dynamically appears when passkeys are registered
    - Auto-prompts for passkey authentication on page load (browsers without Conditional UI)
    - Conditional UI integration shows passkeys in password field autofill (supported browsers)
    - "Sign in with Passkey" button with fingerprint icon
    - Improved error handling with user-friendly messages for cancellation, timeout, and missing passkeys
    - Passkey login aborts when user focuses password field (intentional password entry)
    - Loading states and disabled buttons during authentication

- **Settings Modal**
    - Added "Passkeys" tab for managing registered passkeys
    - Passkey list shows device names, creation dates, last used dates, and sign counts
    - Browser compatibility detection hides passkey section if WebAuthn not supported
    - Loading states while fetching passkey data
    - Empty state message when no passkeys registered

- **Frontend Architecture**
    - New `webauthn.js` module with `WebAuthnManager` class for all WebAuthn operations
    - Base64url encoding/decoding utilities for credential transport
    - Credential serialization for registration and authentication
    - Conditional UI support with automatic fallback to modal flow
    - Platform authenticator availability detection

### Fixed

- **Login Flow**
    - Passkey section only appears when passkeys are actually registered (not just WebAuthn enabled)
    - Prevents auto-prompt spam when no passkeys exist
    - Proper cleanup of Conditional UI when user cancels or fails authentication
- Added a time skew to allow for NFS clock differences to prevent thumbnail generator running every time ([#117](https://github.com/djryanj/media-viewer/issues/117))

### Security

- **WebAuthn Implementation**
    - User verification required for all passkeys (enforces biometric/PIN)
    - Resident keys preferred for discoverable credentials
    - Platform authenticators preferred over roaming for better UX
    - Attestation preference set to `none` (privacy-focused)
    - Exclusion lists prevent duplicate credential registration
    - Sign count tracking for credential cloning detection
    - Challenge data stored with 5-minute expiration
    - One-time use of challenge data (deleted after verification)

### Browser Support

| Browser      | Platform Auth | Security Keys | Conditional UI |
| ------------ | ------------- | ------------- | -------------- |
| Chrome 108+  | ✅            | ✅            | ✅             |
| Edge 108+    | ✅            | ✅            | ✅             |
| Safari 16+   | ✅            | ✅            | ✅             |
| Firefox 119+ | ✅            | ✅            | ❌             |

### Developer Notes

#### Testing WebAuthn in Development

WebAuthn requires a secure context. For development:

**Local Testing (Simplest):**

```bash
export WEBAUTHN_ENABLED=true
export WEBAUTHN_RP_ID=localhost
export WEBAUTHN_ORIGINS=http://localhost:8080
make dev
```

**Mobile Testing with ngrok (Recommended):**

```bash
# Terminal 1: Start dev server
make dev

# Terminal 2: Start ngrok
ngrok http 8080

# Configure WebAuthn with ngrok URL
export WEBAUTHN_ENABLED=true
export WEBAUTHN_RP_ID=abc123.ngrok-free.app
export WEBAUTHN_ORIGINS=https://abc123.ngrok-free.app
make dev
```

See README.md for complete testing guide including Cloudflare Tunnel and mkcert options.

#### Database Schema Changes

The WebAuthn feature adds two new tables. Database migrations are automatic on first startup when `WEBAUTHN_ENABLED=true`.

#### Go Dependencies

- `github.com/go-webauthn/webauthn` v0.11.2 - WebAuthn library for credential management and verification

## [0.5.0] - February 1, 2026

### Added

- Infinite scroll with paginated fallback in both main gallery and search views
- Session keepalive system to maintain active sessions during user activity
- Shorter server sessions by default (configurable with `SESSION_DURATION` environment variable) which ensures that media stays private without complex PWA and frontend changes ([#73](https://github.com/djryanj/media-viewer/issues/73), [#82](https://github.com/djryanj/media-viewer/issues/82))
- Escape key logs out from the main screen ([#73](https://github.com/djryanj/media-viewer/issues/73))
- Navigation improvements (back button)
- Tag copy/paste system for selection mode with clipboard support
    - Copy tags from single selected item (`Ctrl+C`)
    - Paste tags to selected items (`Ctrl+V`) with confirmation modal
    - Merge tags across multiple selected items (`Ctrl+M`)
- Smart paste destination handling excludes source item from targets

### Changed

- Colorblind accessibility improvements including a subtle change to the icon design (#100)
- Sort order button now uses distinct icons (`arrow-up-narrow-wide` / `arrow-down-wide-narrow`) for clearer visual feedback
- Gallery tag chips now use "X | tag" layout with remove button on left (desktop)
- Paste confirmation modal displays tags as selectable chips with Select All/None

### Fixed

- Sort order changes no longer pollute browser history ([#97](https://github.com/djryanj/media-viewer/issues/97))
- Sort order icon now correctly reflects current state ([#97](https://github.com/djryanj/media-viewer/issues/97))
- Prevented duplicate app initialization that caused redundant network requests
- Lightbox now correctly displays tag indicator by sourcing tags from gallery and preloading for adjacent items ([#106](https://github.com/djryanj/media-viewer/issues/106))
- Escape key now closes tag modal when input field is focused
- Tag overflow tooltip no longer triggers search when clicking +N indicator
- Fixed null reference error when refreshing tooltip after tag removal
- Fixed tag chip hover expansion caused by `transition: all`

### Deprecated

- Manual pagination (hidden, kept for fallback)

### Performance

- Intersection Observer vs scroll events
- Batched selection updates (single paint cycle)
- Priority loading for visible items on cache restore
- O(1) selection lookups via Set
- Eliminated duplicate initialization improving app responsiveness
- Lightbox preloads tags for adjacent items using batch endpoint

## [0.4.2] - January 31, 2026

- **NOTE**: Due to a significant performance degredation in 0.4.1 on NFS-mounted filesystems, do not use 0.4.2.

### Fixed

- Filesystem performance issues on NFS

## [0.4.1] - January 31, 2026

### Added

- **Media Loop Control** - Toggle looping for videos and animated images (GIF, WebP, APNG) in the lightbox viewer
    - Loop button appears automatically for supported media types
    - Keyboard shortcut: `L` to toggle loop
    - Preference saved and persists across sessions
    - Videos use native HTML5 loop attribute
    - Animated images use canvas-based detection to force continuous playback
- Polling-based change detection for media library updates (replaces fsnotify)
- Incremental thumbnail generation that only processes changed files
- Orphan thumbnail cleanup removes thumbnails for deleted files
- Meta file tracking (`.meta` sidecar files) for thumbnail source path lookup
- Legacy thumbnail cleanup for thumbnails without meta files
- Video frame support in folder thumbnail generation
- Indexer notifies thumbnail generator on completion for immediate processing

### Changed

- **Login Page UX Improvements**
    - Added show/hide password toggle (eye icon) for all password fields
    - Password text is now selected on login failure, allowing easy correction
    - Added shake animation on invalid password for visual feedback
    - Error messages auto-clear when user starts typing
    - Improved accessibility with proper ARIA labels
    - Better focus management after password visibility toggle
- Consolidated duplicate media type definitions into new `mediatypes` package
- Folder thumbnails now include video frames, not just images
- Thumbnail generator waits for initial index completion instead of fixed 30-second delay
- Replaced fsnotify-based file watching with polling-based change detection (better for containers)
- Change detection now polls every 30 seconds (configurable via `POLL_INTERVAL` environment variable)
- More reliable in Docker/container environments with mounted volumes

### Removed

- Removed fsnotify-based file watching (unreliable in containerized environments)
- Removed unused `media/scanner.go` (superseded by database-backed indexer)
- Removed unused `media/types.go` (consolidated into `mediatypes` package)
- Removed duplicate extension maps and file type detection from `indexer` package
- Removed scanner-related Prometheus metrics

### Fixed

- **Playlist View Hotzones** - previously, these were blocking the video controls in the playlist. ([#56](https://github.com/djryanj/media-viewer/issues/56))
- Folder thumbnails now update when contents change
- Orphaned thumbnails are properly cleaned up when source files are deleted
- Thumbnail generator now receives index completion events immediately on startup

## [v0.4.0] - January 31, 2026

### Added

- **We have an icon now!**

- **Progressive Web App (PWA) Support**
    - Web App Manifest (`manifest.json`) enabling "Add to Home Screen" functionality
    - Service Worker (`sw.js`) for PWA installability and offline caching of app shell
    - Standalone display mode removes browser UI when installed
    - `display_override` with `minimal-ui` fallback for Firefox Android
    - iOS Safari PWA meta tags for full-screen experience
    - Android adaptive icon support with maskable icons

- **Screen Wake Lock**
    - Screen stays awake during media viewing in lightbox
    - Screen stays awake during video playback in player
    - Automatically re-acquires lock when app regains focus
    - New `wake-lock.js` module for wake lock management

- **Safe Area Support**
    - CSS updates for devices with notches (iPhone X+, Android phones with cutouts)
    - Proper padding for status bars and home indicators
    - Improved landscape mode handling for fullscreen media viewing

- **App Icons**
    - New lock-themed icon representing private/secure media
    - Icons generated in all required sizes for PWA (16px to 512px)
    - Maskable icons for Android adaptive icon support
    - Simplified favicon optimized for small sizes
    - Developer tooling for icon generation (`static/generate-icons.js`)

### Changed

- Updated `index.html` with PWA meta tags, manifest link, and iOS-specific tags
- Updated `app.js` to register service worker and check PWA status
- Updated `lightbox.js` to acquire/release wake lock during media viewing
- Updated `player.js` to acquire/release wake lock during video playback
- Updated `style.css` with safe area insets, overscroll behavior, and PWA-specific styles

### Fixed

- Proper Content-Type headers for PWA assets (`application/manifest+json`, `application/javascript`)

### Developer Notes

#### Icon Generation

Icons are pre-generated and committed to the repository. Regeneration is only needed when modifying the icon design.

```bash
make icons
```

See README.md for detailed icon generation instructions.

## Version 0.3.1 - 2026-01-30

### New Features

#### Memory Management for Kubernetes

- **Automatic GOMEMLIMIT Configuration**: Added support for configuring Go's memory limit from Kubernetes container limits via the Downward API
    - Set `MEMORY_LIMIT` environment variable using `resourceFieldRef` to pass container memory limits
    - `MEMORY_RATIO` environment variable controls what percentage of container memory is allocated to Go heap (default: 85%)
    - Remaining memory is reserved for FFmpeg subprocesses, image processing, and OS buffers
    - Direct `GOMEMLIMIT` override supported for non-Kubernetes deployments

- **Memory Metrics**: Added Prometheus metrics for monitoring memory usage
    - `media_viewer_go_memlimit_bytes` - Configured GOMEMLIMIT value
    - `media_viewer_go_memalloc_bytes` - Current Go heap allocation
    - `media_viewer_go_memsys_bytes` - Total memory obtained from OS
    - `media_viewer_go_gc_runs_total` - Garbage collection cycle count

- **Startup Memory Reporting**: Memory configuration is now logged at startup, showing container limit, ratio, calculated GOMEMLIMIT, and memory reserved for external processes

#### New Environment Variables

| Variable       | Default | Description                                                    |
| -------------- | ------- | -------------------------------------------------------------- |
| `MEMORY_LIMIT` | (none)  | Container memory limit in bytes (from Kubernetes Downward API) |
| `MEMORY_RATIO` | `0.85`  | Percentage of container memory for Go heap (0.0-1.0)           |
| `GOMEMLIMIT`   | (none)  | Direct Go memory limit override (e.g., `400MiB`)               |

## Version 0.3.0 - 2026-01-30

### New Features

#### Enhanced Tag Management

- Tags are now clickable throughout the application to search for items with that tag
- Added tag overflow tooltip: clicking the "+n" indicator on items with many tags displays a popup showing all tags
- Tags can now be removed directly from gallery items on desktop by hovering and clicking the X button
- Added tag display in lightbox view with gradient overlay at the bottom of images
- Lightbox tags support both search (click tag) and removal (click X button) actions

#### Improved Navigation and State Management

- Search results now preserve previous state: closing search returns to the lightbox at the same position if one was open
- Gallery scroll position is now preserved when returning from search results
- Browser back button properly navigates through search, lightbox, and gallery states

#### Selection Mode Improvements

- "Select All" button now toggles between selecting all and deselecting all items
- Button text updates to indicate current action ("All" or "None")

#### New Metrics

- **Database Size Metrics**: Added Prometheus metrics to track SQLite database file sizes
    - `media_viewer_db_size_bytes{file="main"}` - Main database file size
    - `media_viewer_db_size_bytes{file="wal"}` - Write-ahead log file size
    - `media_viewer_db_size_bytes{file="shm"}` - Shared memory file size
- **Grafana Dashboard Updates**: Added new "Database Storage" section with:
    - Total database size stat panel with threshold alerts (yellow >100MB, red >500MB)
    - Individual panels for main DB and WAL file sizes
    - Storage distribution pie chart
    - Database size over time graph
    - Database growth rate trend analysis

### User Interface Improvements

#### Layout Consistency

- Header, breadcrumb, favorites, and footer sections now respect the same maximum width as the gallery content
- User control buttons (password, cache, logout) moved to the right side of the header on all screen sizes
- Consistent padding and spacing across all breakpoints

#### Mobile Improvements

- Tags in gallery items are now properly tappable for search on mobile devices
- Tag removal buttons hidden on mobile to prevent accidental taps; tags can still be managed via the tag modal
- Improved touch targets for tag interactions

#### Favorites Section

- Fixed favorites display on desktop to show compact thumbnails instead of full card layout
- Star icons now render correctly in favorites section

### Performance Improvements

#### Concurrency and Parallelism

- **Parallel Directory Indexing**: Added parallel directory walker with configurable worker pool for significantly faster initial indexing of large media libraries (2-4x improvement)
- **Parallel Thumbnail Generation**: Background thumbnail generation now uses a worker pool instead of sequential processing, dramatically improving throughput
- **Per-File Thumbnail Locking**: Replaced global thumbnail mutex with per-file locking, allowing parallel generation of thumbnails for different files
- **Container-Aware Worker Pools**: Worker counts automatically scale based on available CPU resources, respecting Kubernetes/container CPU limits via GOMAXPROCS
- **New `workers` Utility Package**: Centralized worker count calculation with task-specific helpers (`ForCPU`, `ForIO`, `ForMixed`) and environment variable override support

#### Streaming Improvements

- **Timeout-Protected Video Streaming**: Added chunked streaming with per-write timeouts to prevent slow/disconnected clients from holding server resources indefinitely
- **Idle Connection Detection**: Streams are automatically terminated if no data flows for a configurable period
- **Client Disconnect Handling**: Proper detection and cleanup when clients disconnect during video streaming

#### Metrics Improvements

- **Reduced Metrics Cardinality**: Fixed high-cardinality issue where individual file paths under `/api/file/`, `/api/thumbnail/`, `/api/stream/`, and `/api/stream-info/` were creating separate metric labels
    - Paths are now normalized to `/api/file/{path}`, `/api/thumbnail/{path}`, etc.
    - Prevents Prometheus memory bloat from thousands of unique metric labels

#### Other Performance Improvements

- Replaced universal CSS selector (`*`) with explicit element reset for improved rendering performance
- Optimized image preloading in lightbox with priority-based loading (adjacent images load with higher priority)

### Code Quality Improvements

#### Context Propagation

- Added proper `context.Context` propagation throughout the codebase for improved request cancellation and timeout handling
- All HTTP handlers now pass request context to database operations
- Database operations respect context cancellation, allowing long-running queries to be terminated when clients disconnect
- Background operations (indexing, thumbnail generation) use appropriate contexts that survive request completion

#### New Packages

- **`internal/streaming`**: Timeout-protected HTTP streaming utilities with configurable write timeouts, idle detection, and progress callbacks
- **`internal/workers`**: CPU-aware worker pool sizing utilities that respect container resource limits

#### Linting and Code Standards

- Fixed all `contextcheck` linter errors by properly propagating context through call chains
- Fixed `nilerr` warnings with appropriate error handling or explicit nolint directives
- Fixed `ifElseChain` warnings by converting to switch statements
- Fixed unused parameter warnings
- Fixed redefinition of built-in function warnings (renamed `max` parameter to `limit`)
- Added proper documentation comments to all exported variables and types
- Added `//nolint` directives with explanations for intentional patterns (e.g., MD5 for cache keys, background operations not using request context)

### Bug Fixes

- Fixed Escape key not closing search results when viewing full search gallery
- Fixed tag click events propagating to gallery item handlers, causing both search and lightbox to trigger
- Fixed inconsistent card heights in gallery when some items have tags and others do not
- Fixed mobile filename overlay being too prominent
- Resolved various linting errors related to undefined globals and unused variables

## [Unreleased] - 2026-01-30

### Changed

#### Authentication System

- **Simplified to password-only authentication**: Removed username requirement for single-user application
    - Login now requires only a password
    - Initial setup creates a password without username
    - Session management remains token-based with 7-day expiration

#### Database Schema

- Removed `username` column from `users` table
- Updated all authentication queries to work with single-user model
- **Breaking Change**: Existing databases must be deleted and recreated

#### API Changes

- `POST /api/auth/login` - Now accepts `{ "password": "..." }` instead of `{ "username": "...", "password": "..." }`
- `POST /api/auth/setup` - Now accepts `{ "password": "..." }` instead of `{ "username": "...", "password": "..." }`
- `GET /api/auth/check` - Response `username` field now returns empty string
- `PUT /api/auth/password` - **New endpoint** for changing password (requires current password verification)

#### User Interface

##### Header

- Removed username display from header
- Added password change button (🔑) alongside existing cache clear and logout buttons
- Added password change modal with current password verification

##### Mobile Gallery (Breaking Visual Change)

- Redesigned gallery layout for mobile devices:
    - Compact 3-column grid with 2px gaps (was larger cards with more spacing)
    - Square aspect ratio thumbnails using `object-fit: cover`
    - Filename and tags now appear in gradient overlay at bottom of thumbnail
    - File size hidden on mobile (visible on desktop only)
    - 4 columns at 480px+, 5 columns at 600px+
- Desktop (900px+) retains card-style layout with info below thumbnail

##### Search Suggestions

- Added thumbnail previews to search dropdown suggestions
- Thumbnails load lazily with fallback to icons on error
- Responsive thumbnail sizes: 40px mobile, 48px tablet, 56px desktop

#### Frontend Architecture

- Renamed global `App` object to `MediaApp` to avoid conflict with built-in globals
- Updated all JavaScript files to reference `MediaApp` instead of `App`
- Added proper ESLint global declarations

#### CLI Tool (`usermgmt`)

- Simplified to two commands:
    - `reset` - Reset the password
    - `status` - Check if password is configured
- Removed `create`, `list`, `delete` commands (not needed for single-user)

### Fixed

- Fixed redirect loop on login caused by missing HTML element IDs
- Fixed element ID mismatches between HTML and JavaScript:
    - `search-close` → `search-results-close`
    - `ctx-favorite` → `ctx-add-favorite`
    - `ctx-unfavorite` → `ctx-remove-favorite`
    - `tag-modal-file` → `tag-modal-path`
    - `tag-add-btn` → `add-tag-btn`
    - `player-title` → `playlist-title`
    - `player-video` → `playlist-video`
    - `player-prev` → `prev-video`
    - `player-next` → `next-video`
- Added missing `history.js` script include

### Removed

- Username field from login and setup forms
- Username display in application header
- `GetUserByUsername()` database function
- `DeleteUser()` database function
- `DeleteUserSessions()` database function (replaced with `DeleteAllSessions()`)
- `ValidateUser()` database function (replaced with `ValidatePassword()`)

### Security

- Password changes require verification of current password
- All sessions invalidated when password is changed
- Maintained secure session token hashing (SHA-256)
- Maintained bcrypt password hashing

---

## Migration Guide

### For Existing Installations

1. **Backup any important data** (favorites, tags) if needed

2. **Delete the existing database**:

    ```bash
    rm /database/media.db
    ```

3. **Update all application files** (Go backend, JavaScript frontend, HTML, CSS)

4. **Rebuild the Go application**:

    ```bash
    go build -o media-viewer .
    go build -o resetpw ./cmd/resetpw
    ```

5. **Restart the application**

6. **Complete initial setup** by creating a new password when prompted

### API Migration

If you have external integrations calling the authentication API:

**Before:**

```json
POST /api/auth/login
{
  "username": "admin",
  "password": "secret123"
}
```

**After:**

```json
POST /api/auth/login
{
  "password": "secret123"
}
```

### Password Management

To reset a forgotten password using the CLI tool:

```bash
./resetpw reset
```

To check if a password is configured:

```bash
./resetpw status
```

## [Unreleased]

### Added

- Initial media browsing with folder navigation
- Thumbnail generation for images and videos
- Video transcoding for browser compatibility
- Full-text search with FTS5
- Tag management system
- Favorites system
- User authentication with sessions
- Docker container support
- Automatic media library indexing
- Real-time file system watching
- Playlist support (WPL format)
- Responsive web interface

### Security

- Secure password hashing with bcrypt
- Session-based authentication
- Path validation to prevent directory traversal

## How to Release

1. Update this CHANGELOG with the new version and date
2. Create a git tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
3. Push the tag: `git push origin v1.0.0`
4. GitHub Actions will automatically build and publish Docker images

[Unreleased]: https://github.com/djryanj/media-viewer/compare/v1.0.0...HEAD
