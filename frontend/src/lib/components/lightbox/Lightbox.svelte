<script lang="ts">
    import { onDestroy } from 'svelte';
    import { beforeNavigate } from '$app/navigation';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import { favorites, tags } from '$lib/api/client';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import { toastStore } from '$lib/stores/toast.svelte';
    import { formatBytes, formatDate } from '$lib/utils/format';
    import TagEditor from '$lib/components/ui/TagEditor.svelte';
    import VideoPlayer from '$lib/components/lightbox/VideoPlayer.svelte';
    import CollectionsPanel from '$lib/components/lightbox/CollectionsPanel.svelte';

    // ── Back-button: cancel any navigation while lightbox is open ────────────
    beforeNavigate(({ cancel }) => {
        if (lightboxStore.open) {
            cancel();
            lightboxStore.close();
        }
    });

    // ── Idle-fade controls ───────────────────────────────────────────────────
    const IDLE_TIMEOUT = 3500;
    let controlsVisible = $state(true);
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    function showControls() {
        controlsVisible = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (!lightboxStore.open) return;
        idleTimer = setTimeout(() => {
            if (!collectionsOpen) controlsVisible = false;
        }, IDLE_TIMEOUT);
    }

    function clearIdleTimer() {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    }

    $effect(() => {
        if (lightboxStore.open) showControls();
        else { clearIdleTimer(); controlsVisible = true; }
    });

    // Reset on item change
    $effect(() => { lightboxStore.item; if (lightboxStore.open) showControls(); });

    // Keep visible while collections panel is open
    $effect(() => { if (collectionsOpen) controlsVisible = true; });

    // ── Playback preferences (toggled by keyboard shortcuts L) ──────────────
    let loopEnabled = $state(false);

    // ── Slideshow (auto-advance; A key) ──────────────────────────────────────
    const SLIDESHOW_DELAY = 4000;
    let slideshowActive = $state(false);
    let slideshowTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleSlide() {
        clearSlideTimer();
        if (!slideshowActive || !lightboxStore.hasNext) { slideshowActive = false; return; }
        slideshowTimer = setTimeout(() => {
            if (!slideshowActive) return;
            lightboxStore.next();
            scheduleSlide();
        }, SLIDESHOW_DELAY);
    }

    function clearSlideTimer() {
        if (slideshowTimer) { clearTimeout(slideshowTimer); slideshowTimer = null; }
    }

    $effect(() => {
        if (slideshowActive && lightboxStore.open) scheduleSlide();
        else clearSlideTimer();
    });

    onDestroy(clearSlideTimer);

    // ── Download helper ──────────────────────────────────────────────────────
    function triggerDownload() {
        const current = lightboxStore.item;
        if (!current) return;
        const a = document.createElement('a');
        a.href = `/api/files/${encodedPath(current.path)}?download=true`;
        a.download = current.name;
        a.click();
    }

    // ── Collections panel ────────────────────────────────────────────────────
    let collectionsOpen = $state(false);

    // ── VideoPlayer ref (for Space play/pause relay) ──────────────────────
    let videoPlayerRef = $state<{ togglePlay?: () => void } | undefined>(undefined);

    // ── Keyboard navigation ──────────────────────────────────────────────────
    function handleKeydown(e: KeyboardEvent) {
        if (!lightboxStore.open) return;
        showControls();
        // Don't steal from inputs (e.g. TagEditor)
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

        switch (e.key) {
            case 'ArrowLeft': collectionsOpen = false; lightboxStore.prev(); break;
            case 'ArrowRight': collectionsOpen = false; lightboxStore.next(); break;
            case 'Escape': lightboxStore.close(); break;
            case 'c': case 'C': e.preventDefault(); collectionsOpen = !collectionsOpen; break;
            case 'f': case 'F': e.preventDefault(); toggleFavorite(); break;
            case 'd': case 'D': e.preventDefault(); triggerDownload(); break;
            case 'a': case 'A': e.preventDefault(); slideshowActive = !slideshowActive; break;
            case 'l': case 'L': e.preventDefault(); loopEnabled = !loopEnabled; break;
            case ' ':
                if (isVideo) { e.preventDefault(); videoPlayerRef?.togglePlay?.(); }
                break;
        }
    }

    // ── Pinch-to-zoom state ───────────────────────────────────────────────────
    let zoom = $state(1);
    let panX = $state(0);
    let panY = $state(0);

    // Reset zoom when item changes
    $effect(() => {
        lightboxStore.item; // reactive dependency
        zoom = 1; panX = 0; panY = 0;
    });

    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let pinchStartPanX = 0;
    let pinchStartPanY = 0;
    let pinchMidX = 0;
    let pinchMidY = 0;
    let isPinching = false;

    // Single-finger pan (when zoomed)
    let singlePanStartX = 0;
    let singlePanStartY = 0;
    let singlePanStartTouchX = 0;
    let singlePanStartTouchY = 0;

    function touchDist(t1: Touch, t2: Touch): number {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function clampPan(scale: number, px: number, py: number): [number, number] {
        const el = document.querySelector('.lb-image') as HTMLElement | null;
        if (!el) return [px, py];
        const rect = el.getBoundingClientRect();
        const maxPanX = Math.max(0, (rect.width * (scale - 1)) / 2);
        const maxPanY = Math.max(0, (rect.height * (scale - 1)) / 2);
        return [Math.max(-maxPanX, Math.min(maxPanX, px)), Math.max(-maxPanY, Math.min(maxPanY, py))];
    }

    // ── Touch/swipe — window-level so works from anywhere on screen ──────────
    let touchStartX = 0;
    let touchStartY = 0;
    let touchOriginEl: Element | null = null;
    let swipeHandled = false;

    function handleTouchStart(e: TouchEvent) {
        if (!lightboxStore.open) return;
        showControls();

        if (e.touches.length === 2) {
            // Begin pinch
            isPinching = true;
            pinchStartDist = touchDist(e.touches[0], e.touches[1]);
            pinchStartScale = zoom;
            pinchStartPanX = panX;
            pinchStartPanY = panY;
            pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            return;
        }

        if (e.touches.length === 1) {
            if (zoom > 1) {
                // Track for panning
                singlePanStartTouchX = e.touches[0].clientX;
                singlePanStartTouchY = e.touches[0].clientY;
                singlePanStartX = panX;
                singlePanStartY = panY;
            }
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchOriginEl = e.target as Element | null;
            swipeHandled = false;
        }
    }

    function handleTouchMove(e: TouchEvent) {
        if (!lightboxStore.open) return;

        if (e.touches.length === 2 && isPinching) {
            e.preventDefault();
            const newDist = touchDist(e.touches[0], e.touches[1]);
            const rawScale = pinchStartScale * (newDist / pinchStartDist);
            const newScale = Math.max(1, Math.min(5, rawScale));

            // Pan based on midpoint movement
            const newMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const newMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const [cx, cy] = clampPan(newScale,
                pinchStartPanX + (newMidX - pinchMidX),
                pinchStartPanY + (newMidY - pinchMidY)
            );
            zoom = newScale;
            panX = cx;
            panY = cy;
        } else if (e.touches.length === 1 && zoom > 1 && !isPinching) {
            e.preventDefault();
            const dx = e.touches[0].clientX - singlePanStartTouchX;
            const dy = e.touches[0].clientY - singlePanStartTouchY;
            const [cx, cy] = clampPan(zoom, singlePanStartX + dx, singlePanStartY + dy);
            panX = cx;
            panY = cy;
        }
    }

    function handleTouchEnd(e: TouchEvent) {
        if (!lightboxStore.open) return;

        if (isPinching) {
            // Snap back to 1× if barely zoomed
            if (zoom < 1.05) { zoom = 1; panX = 0; panY = 0; }
            if (e.touches.length === 0) isPinching = false;
            return;
        }

        // Block swipe gestures while zoomed in
        if (zoom > 1) return;

        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // Swipe up to close (upward, predominantly vertical, 80 px minimum)
        if (dy < -80 && absDy > absDx) {
            swipeHandled = true;
            lightboxStore.close();
            requestAnimationFrame(() => { swipeHandled = false; });
            return;
        }

        // Horizontal swipe for prev/next — require predominantly horizontal
        if (absDx < 50 || absDy > absDx * 0.75) return;

        // Don't steal swipes from video controls
        if (touchOriginEl?.closest('video')) return;

        swipeHandled = true;
        if (dx < 0) lightboxStore.next();
        else lightboxStore.prev();
        // Clear flag after a frame so any synthetic click is suppressed
        requestAnimationFrame(() => { swipeHandled = false; });
    }

    // ── Preloading ───────────────────────────────────────────────────────────
    // Hold strong refs so the browser doesn't GC the objects before caching.
    const preloadCache = new Map<string, HTMLImageElement | HTMLVideoElement>();

    function encodedPath(path: string): string {
        return path.split('/').map(encodeURIComponent).join('/');
    }

    function preloadOne(item: (typeof lightboxStore.items)[number]) {
        if (preloadCache.has(item.path)) return;
        if (item.type === 'image') {
            const img = new Image();
            img.src = `/api/files/${encodedPath(item.path)}`;
            preloadCache.set(item.path, img);
        } else if (item.type === 'video') {
            // Preload just metadata (duration, first frame) — full video is too large
            const vid = document.createElement('video');
            vid.preload = 'metadata';
            vid.src = `/api/stream/${encodedPath(item.path)}`;
            preloadCache.set(item.path, vid);
        }
    }

    $effect(() => {
        if (!lightboxStore.open) return;
        const idx = lightboxStore.index;
        const items = lightboxStore.items;
        // Preload ±2 neighbours (up to 5 items including current)
        for (let d = -2; d <= 2; d++) {
            const i = idx + d;
            if (i >= 0 && i < items.length) preloadOne(items[i]);
        }
    });

    onDestroy(() => {
        preloadCache.clear();
        clearIdleTimer();
    });

    // ── Favorite toggle ──────────────────────────────────────────────────────
    let favoriteLoading = $state(false);

    async function toggleFavorite() {
        const item = lightboxStore.item;
        if (!item || favoriteLoading) return;
        favoriteLoading = true;
        try {
            if (item.isFavorite) {
                await favorites.remove(item.path);
            } else {
                await favorites.add({ path: item.path, name: item.name, type: item.type });
            }
            const updated = { isFavorite: !item.isFavorite };
            lightboxStore.updateCurrent(updated);
            galleryStore.updateItem(item.path, updated);
            if (updated.isFavorite) {
                galleryStore.addFavorite({ ...item, isFavorite: true });
            } else {
                galleryStore.removeFavorite(item.path);
            }
        } catch {
            toastStore.error('Failed to update favorite');
        } finally {
            favoriteLoading = false;
        }
    }

    // ── Tag editing ──────────────────────────────────────────────────────────
    async function handleTagsChange(newTags: string[]) {
        const current = lightboxStore.item;
        if (!current) return;
        try {
            await tags.setForFile(current.path, newTags);
            const updated = { tags: newTags };
            lightboxStore.updateCurrent(updated);
            galleryStore.updateItem(current.path, updated);
        } catch {
            toastStore.error('Failed to update tags');
        }
    }

    const item = $derived(lightboxStore.item);
    const isVideo = $derived(item?.type === 'video');
    const itemTags = $derived(item?.tags ?? []);

    // ── Clock ────────────────────────────────────────────────────────────────
    const PREFS_KEY = 'mediaViewerPreferences';
    let clockEnabled = $state(true);
    let clockFormat = $state<'12' | '24'>('12');
    let clockTime = $state('');
    let clockTimer: ReturnType<typeof setInterval> | null = null;

    function readClockPrefs() {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (raw) {
                const p = JSON.parse(raw) as Record<string, unknown>;
                clockEnabled = (p.clockEnabled as boolean) ?? true;
                clockFormat = ((p.clockFormat as string) === '24' ? '24' : '12');
            }
        } catch { /* ignore */ }
    }

    function updateClock() {
        const now = new Date();
        const m = now.getMinutes().toString().padStart(2, '0');
        if (clockFormat === '24') {
            clockTime = `${now.getHours().toString().padStart(2, '0')}:${m}`;
        } else {
            const h = now.getHours();
            clockTime = `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
        }
    }

    $effect(() => {
        if (lightboxStore.open && clockEnabled) {
            readClockPrefs();
            updateClock();
            clockTimer = setInterval(updateClock, 1000);
        } else {
            if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
        }
        return () => { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } };
    });

    // Re-read prefs when settings are saved (SettingsModal dispatches this event).
    $effect(() => {
        function onClockPrefChanged() { readClockPrefs(); updateClock(); }
        window.addEventListener('clockPreferenceChanged', onClockPrefChanged);
        return () => window.removeEventListener('clockPreferenceChanged', onClockPrefChanged);
    });
</script>

<svelte:window onkeydown={handleKeydown} onmousemove={showControls} ontouchstart={handleTouchStart} ontouchmove={handleTouchMove} ontouchend={handleTouchEnd} />

{#if lightboxStore.open && item}
    <!-- Backdrop -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="lightbox-backdrop"
        onclick={() => {
            if (!controlsVisible) { showControls(); return; }
            if (!swipeHandled) lightboxStore.close();
        }}
        aria-label="Close lightbox"
    ></div>

    <div
        class="lightbox"
        class:controls-hidden={!controlsVisible}
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        tabindex="-1"
    >
        <!-- Top bar -->
        <div class="lightbox-topbar">
            <button
                class="lb-btn"
                onclick={() => lightboxStore.close()}
                aria-label="Close"
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                </svg>
            </button>

            {#if clockEnabled && clockTime}
                <span class="lb-clock" aria-label="Current time">{clockTime}</span>
            {/if}

            <span class="lb-title">{item.name}</span>

            <div class="lb-actions">
                <!-- Slideshow toggle (A) — available for images and videos -->
                {#if lightboxStore.items.length > 1}
                    <button
                        class="lb-btn"
                        class:active={slideshowActive}
                        onclick={() => (slideshowActive = !slideshowActive)}
                        aria-label={slideshowActive ? 'Slideshow on (press A to stop)' : 'Slideshow (press A to start)'}
                        aria-pressed={slideshowActive}
                        title="Slideshow (A)"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                            <line x1="19" y1="3" x2="19" y2="21"/>
                        </svg>
                    </button>
                {/if}

                <!-- Loop toggle (L) — video only -->
                {#if isVideo}
                    <button
                        class="lb-btn"
                        class:active={loopEnabled}
                        onclick={() => (loopEnabled = !loopEnabled)}
                        aria-label={loopEnabled ? 'Loop on (press L to toggle)' : 'Loop off (press L to toggle)'}
                        aria-pressed={loopEnabled}
                        title="Loop (L)"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <polyline points="17 1 21 5 17 9"/>
                            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                            <polyline points="7 23 3 19 7 15"/>
                            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                        </svg>
                    </button>
                {/if}

                <button
                    class="lb-btn"
                    class:active={collectionsOpen}
                    onclick={() => (collectionsOpen = !collectionsOpen)}
                    aria-label="Collections"
                    aria-pressed={collectionsOpen}
                    title="Collections (C)"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <rect x="3" y="3" width="7" height="7" rx="1"/>
                        <rect x="14" y="3" width="7" height="7" rx="1"/>
                        <rect x="3" y="14" width="7" height="7" rx="1"/>
                        <rect x="14" y="14" width="7" height="7" rx="1"/>
                    </svg>
                </button>

                <button
                    class="lb-btn"
                    class:active={item.isFavorite}
                    onclick={toggleFavorite}
                    disabled={favoriteLoading}
                    aria-label={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-pressed={item.isFavorite}
                    title="Favorite (F)"
                >
                    <svg viewBox="0 0 24 24" fill={item.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                </button>

                <a
                    class="lb-btn"
                    href="/api/files/{encodedPath(item.path)}?download=true"
                    download={item.name}
                    aria-label="Download"
                    title="Download (D)"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" x2="12" y1="15" y2="3" />
                    </svg>
                </a>
            </div>
        </div>

        <!-- Media area -->
        <div class="lb-media">
            {#key item.path}
            {#if isVideo}
                <VideoPlayer
                    bind:this={videoPlayerRef}
                    path={item.path}
                    autoplay={true}
                    loop={loopEnabled}
                    showNav={lightboxStore.hasPrev || lightboxStore.hasNext}
                    onPrev={lightboxStore.hasPrev ? lightboxStore.prev : undefined}
                    onNext={lightboxStore.hasNext ? lightboxStore.next : undefined}
                    onclick={(e) => e.stopPropagation()}
                />
            {:else}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <img
                    src="/api/files/{encodedPath(item.path)}"
                    alt={item.name}
                    class="lb-image"
                    class:zoomed={zoom > 1}
                    style="transform: scale({zoom}) translate({panX / zoom}px, {panY / zoom}px)"
                    onclick={(e) => e.stopPropagation()}
                    draggable="false"
                />
            {/if}
            {/key}
        </div>

        <!-- Prev / Next (images only — VideoPlayer renders its own nav for videos) -->
        {#if !isVideo && lightboxStore.hasPrev}
            <button
                class="lb-nav lb-nav--prev"
                onclick={(e) => { e.stopPropagation(); lightboxStore.prev(); }}
                aria-label="Previous"
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                </svg>
            </button>
        {/if}

        {#if !isVideo && lightboxStore.hasNext}
            <button
                class="lb-nav lb-nav--next"
                onclick={(e) => { e.stopPropagation(); lightboxStore.next(); }}
                aria-label="Next"
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>
        {/if}

        <!-- Collections panel -->
        {#if collectionsOpen}
            <CollectionsPanel itemPaths={[item.path]} onclose={() => (collectionsOpen = false)} />
        {/if}

        <!-- Info bar -->
        <div class="lb-info">
            <div class="lb-meta">
                <span>{formatBytes(item.size)}</span>
                <span>{formatDate(item.modTime)}</span>
            </div>
            <div class="lb-tag-row">
                <TagEditor
                    tags={itemTags}
                    onchange={handleTagsChange}
                    compact
                />
            </div>
        </div>
    </div>
{/if}

<style>
    .lightbox-backdrop {
        position: fixed;
        inset: 0;
        z-index: 300;
        background: var(--color-scrim);
    }

    .lightbox {
        position: fixed;
        inset: 0;
        z-index: 301;
        display: flex;
        flex-direction: column;
        pointer-events: none;
    }

    /* All direct children of lightbox should capture events */
    .lightbox > * {
        pointer-events: all;
    }

    .lightbox-topbar {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        padding: var(--spacing-2) var(--spacing-3);
        background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent);
        transition: opacity 0.35s ease;
    }

    .lb-clock {
        font-size: var(--text-sm);
        color: rgba(255,255,255,0.75);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .lb-title {
        flex: 1;
        font-size: var(--text-sm);
        color: #fff;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .lb-actions {
        display: flex;
        gap: var(--spacing-1);
    }

    .lb-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border: none;
        background: none;
        cursor: pointer;
        color: rgba(255,255,255,0.8);
        border-radius: var(--radius-md);
        transition: color var(--transition-fast), background var(--transition-fast);
        text-decoration: none;
    }

    .lb-btn:hover,
    .lb-btn.active {
        color: #fff;
        background: rgba(255,255,255,0.1);
    }

    .lb-btn.active {
        color: #ffd700;
    }

    .lb-btn svg {
        width: 22px;
        height: 22px;
    }

    .lb-media {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        pointer-events: none;
    }

    .lb-image {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        pointer-events: all;
        user-select: none;
        -webkit-user-select: none;
        transform-origin: center center;
        transition: transform 0.05s linear;
        touch-action: none;
    }

    .lb-image.zoomed {
        cursor: grab;
    }

    /* VideoPlayer fills the media area */
    .lb-media :global(.vp) {
        width: 100%;
        height: 100%;
        pointer-events: all;
    }

    .lb-nav {
        position: fixed;
        top: 50%;
        transform: translateY(-50%);
        z-index: 302;
        width: 44px;
        height: 72px;
        background: rgba(0,0,0,0.4);
        border: none;
        cursor: pointer;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-md);
        transition: background var(--transition-fast), opacity 0.35s ease;
    }

    .lb-nav:hover {
        background: rgba(0,0,0,0.65);
    }

    .lb-nav svg {
        width: 24px;
        height: 24px;
    }

    .lb-nav--prev {
        left: var(--spacing-2);
    }

    .lb-nav--next {
        right: var(--spacing-2);
    }

    .lb-info {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
        padding: var(--spacing-2) var(--spacing-4);
        padding-bottom: calc(var(--spacing-3) + var(--safe-area-inset-bottom));
        background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
        transition: opacity 0.35s ease;
    }

    /* Idle-fade: hide controls when inactive */
    .lightbox.controls-hidden .lightbox-topbar,
    .lightbox.controls-hidden .lb-info {
        opacity: 0;
        pointer-events: none;
    }

    .lightbox.controls-hidden .lb-nav {
        opacity: 0;
        pointer-events: none;
    }

    .lb-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-3);
        font-size: var(--text-xs);
        color: rgba(255,255,255,0.6);
    }

    .lb-tag-row { color: var(--color-text); }
</style>
