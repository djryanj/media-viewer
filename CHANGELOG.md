# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

# Changelog

## [0.13.1] - 2026-02-12

### Fixed

- **NVIDIA GPU Support in Docker**: Requires `Dockerfile.nvidia` (Debian-based) due to musl/glibc incompatibility. Alpine-based standard Dockerfile cannot load NVIDIA drivers even with NVIDIA Container Toolkit configured. Docker users need `--gpus all` flag with Debian image. ([#259](https://github.com/djryanj/media-viewer/issues/259)). New docker tags like `:latest-nvidia`, `:v1.0.0-nvidia`, `:v1.0-nvidia` now available.

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
