<script lang="ts">
    import { onDestroy } from 'svelte';
    import Hls from 'hls.js';

    interface Props {
        path: string;
        autoplay?: boolean;
        loop?: boolean;
        showNav?: boolean;
        onPrev?: () => void;
        onNext?: () => void;
        onclick?: (e: MouseEvent) => void;
    }

    let {
        path,
        autoplay = true,
        loop = false,
        showNav = false,
        onPrev,
        onNext,
        onclick
    }: Props = $props();

    // ── DOM refs ─────────────────────────────────────────────────────────────
    let videoEl = $state<HTMLVideoElement | undefined>(undefined);
    let containerEl = $state<HTMLDivElement | undefined>(undefined);

    // ── Playback state ────────────────────────────────────────────────────────
    let paused = $state(true);
    let duration = $state(0);
    let currentTime = $state(0);
    let controlsVisible = $state(true);
    let isDragging = $state(false);
    let isInteractingWithBar = $state(false);
    let loaded = $state(false);
    let hasError = $state(false);

    // ── Volume (persisted) ────────────────────────────────────────────────────
    let volume = $state(loadVolume());
    let muted = $state(loadMuted());

    function loadVolume(): number {
        try { return parseFloat(localStorage.getItem('playerVolume') ?? '1') || 1; } catch { return 1; }
    }
    function loadMuted(): boolean {
        try { return localStorage.getItem('playerMuted') === 'true'; } catch { return false; }
    }
    function saveVolumePrefs() {
        try {
            localStorage.setItem('playerVolume', String(volume));
            localStorage.setItem('playerMuted', String(muted));
        } catch { /* ignore */ }
    }

    // ── HLS / source management ───────────────────────────────────────────────
    let hlsInstance: Hls | null = null;
    let loadId = 0;

    function encPath(p: string) {
        return p.split('/').map(encodeURIComponent).join('/');
    }

    function cleanupPrev() {
        if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
        if (videoEl && !videoEl.paused) videoEl.pause();
        if (videoEl) { videoEl.removeAttribute('src'); videoEl.load(); }
    }

    async function loadSource(p: string) {
        const id = ++loadId;
        const stale = () => id !== loadId;

        cleanupPrev();
        hasError = false;
        loaded = false;

        if (!videoEl) return;

        videoEl.loop = loop;

        let info: { needsTranscode?: boolean } | null = null;
        try {
            const r = await fetch(`/api/stream-info/${encPath(p)}`);
            if (r.ok) info = await r.json();
        } catch { /* non-fatal */ }

        if (stale() || !videoEl) return;

        if (info?.needsTranscode) {
            if (Hls.isSupported()) {
                await loadViaHls(p, id);
                return;
            }
            if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                await loadViaNativeHls(p, id);
                return;
            }
        }
        loadDirect(p, id);
    }

    async function loadViaHls(p: string, id: number) {
        const stale = () => id !== loadId;
        let sessionData: { playlistUrl?: string } | null = null;
        try {
            const r = await fetch('/api/hls/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: p, width: 0 })
            });
            if (r.ok) sessionData = await r.json();
        } catch { /* fall through */ }

        if (stale() || !videoEl) return;
        if (!sessionData?.playlistUrl) { loadDirect(p, id); return; }

        const hls = new Hls({
            debug: false,
            lowLatencyMode: false,
            manifestLoadingTimeOut: 20000,
            levelLoadingTimeOut: 20000,
            fragLoadingTimeOut: 60000
        });
        hlsInstance = hls;
        hls.loadSource(sessionData.playlistUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (stale()) { hls.destroy(); if (hlsInstance === hls) hlsInstance = null; return; }
            applyVolumeToVideo();
            loaded = true;
            if (autoplay) videoEl?.play().catch(() => {});
        });

        // hls.js ignores native loop — handle manually
        videoEl.addEventListener('ended', function onEnded() {
            if (!videoEl?.loop) return;
            videoEl.currentTime = 0;
            videoEl.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_ev, data) => {
            if (!data.fatal) return;
            hls.destroy();
            if (hlsInstance === hls) hlsInstance = null;
            if (stale()) return;
            loadDirect(p, id);
        });
    }

    async function loadViaNativeHls(p: string, id: number) {
        const stale = () => id !== loadId;
        let sessionData: { playlistUrl?: string } | null = null;
        try {
            const r = await fetch('/api/hls/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: p, width: 0 })
            });
            if (r.ok) sessionData = await r.json();
        } catch { /* fall through */ }

        if (stale() || !videoEl) return;
        if (!sessionData?.playlistUrl) { loadDirect(p, id); return; }

        videoEl.src = sessionData.playlistUrl;
        videoEl.load();
        applyVolumeToVideo();
        loaded = true;
        if (autoplay) videoEl.play().catch(() => {});
    }

    function loadDirect(p: string, id: number) {
        if (id !== loadId || !videoEl) return;
        videoEl.src = `/api/stream/${encPath(p)}`;
        videoEl.load();
        applyVolumeToVideo();
        loaded = true;
        if (autoplay) videoEl.play().catch(() => {});
    }

    function unload() {
        loadId++;
        cleanupPrev();
    }

    // ── Volume application ────────────────────────────────────────────────────
    function applyVolumeToVideo() {
        if (!videoEl) return;
        videoEl.volume = volume;
        videoEl.muted = muted;
    }

    // ── Controls visibility (auto-hide) ───────────────────────────────────────
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    function showControls() {
        controlsVisible = true;
        if (!paused && !isInteractingWithBar && !isDragging) scheduleHide();
    }

    function cancelHide() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }

    function scheduleHide() {
        cancelHide();
        if (paused || isDragging || isInteractingWithBar) return;
        hideTimer = setTimeout(() => { controlsVisible = false; hideTimer = null; }, 3000);
    }

    // ── Progress bar interaction ──────────────────────────────────────────────
    let progressBarEl = $state<HTMLDivElement | undefined>(undefined);

    function progressPercent() {
        if (!duration) return 0;
        return (currentTime / duration) * 100;
    }

    function getProgressFraction(e: MouseEvent | TouchEvent): number {
        if (!progressBarEl) return 0;
        const rect = progressBarEl.getBoundingClientRect();
        const clientX = 'touches' in e
            ? (e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0)
            : (e as MouseEvent).clientX;
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    function seekTo(fraction: number) {
        if (!videoEl || !duration) return;
        videoEl.currentTime = fraction * duration;
        currentTime = videoEl.currentTime;
    }

    function onProgressPointerDown(e: MouseEvent | TouchEvent) {
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        cancelHide();
        seekTo(getProgressFraction(e));

        const onMove = (ev: MouseEvent | TouchEvent) => {
            ev.preventDefault();
            seekTo(getProgressFraction(ev));
        };
        const onUp = (ev: MouseEvent | TouchEvent) => {
            ev.stopPropagation();
            isDragging = false;
            scheduleHide();
            document.removeEventListener('mousemove', onMove as EventListener);
            document.removeEventListener('touchmove', onMove as EventListener);
            document.removeEventListener('mouseup', onUp as EventListener);
            document.removeEventListener('touchend', onUp as EventListener);
        };
        document.addEventListener('mousemove', onMove as EventListener);
        document.addEventListener('touchmove', onMove as EventListener, { passive: false });
        document.addEventListener('mouseup', onUp as EventListener);
        document.addEventListener('touchend', onUp as EventListener);
    }

    // ── Volume ────────────────────────────────────────────────────────────────
    function setVolume(v: number) {
        volume = v;
        muted = false;
        if (videoEl) { videoEl.volume = v; videoEl.muted = false; }
        saveVolumePrefs();
    }

    function toggleMute() {
        muted = !muted;
        if (videoEl) {
            videoEl.muted = muted;
            if (!muted) videoEl.volume = volume;
        }
        saveVolumePrefs();
    }

    function volumeIcon() {
        if (muted || volume === 0) return 'M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6';
        if (volume > 0.5) return 'M11 5 6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07';
        return 'M11 5 6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07';
    }

    // ── Fullscreen ────────────────────────────────────────────────────────────
    let isFullscreen = $state(false);

    function toggleFullscreen() {
        if (!containerEl) return;
        if (!document.fullscreenElement) {
            containerEl.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    }

    function onFullscreenChange() {
        isFullscreen = !!document.fullscreenElement;
    }

    // ── Wake lock ─────────────────────────────────────────────────────────────
    let wakeLock: WakeLockSentinel | null = null;
    let wakeLockDestroyed = false;

    async function acquireWakeLock() {
        if (!('wakeLock' in navigator) || wakeLockDestroyed) return;
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            // Re-acquire when page becomes visible after a tab switch — the browser
            // automatically releases the sentinel when the document is hidden.
            wakeLock.addEventListener('release', () => {
                if (!wakeLockDestroyed && !paused) acquireWakeLock();
            });
        } catch { /* ignore — may fail when page is not visible */ }
    }

    function releaseWakeLock() {
        wakeLock?.release().catch(() => {});
        wakeLock = null;
    }

    // ── Time formatting ───────────────────────────────────────────────────────
    function fmt(s: number): string {
        if (!isFinite(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    }

    // ── Keyboard (Space = play/pause, only when player is focused) ────────────
    function handleKey(e: KeyboardEvent) {
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            togglePlay();
        }
    }

    function togglePlay() {
        if (!videoEl) return;
        if (videoEl.paused) videoEl.play().catch(() => {});
        else videoEl.pause();
    }

    export { togglePlay };

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    $effect(() => {
        if (path && videoEl) loadSource(path);
    });

    onDestroy(() => {
        wakeLockDestroyed = true;
        unload();
        cancelHide();
        releaseWakeLock();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    });

    // ── Video event handlers ──────────────────────────────────────────────────
    function onPlay() {
        paused = false;
        scheduleHide();
        acquireWakeLock();
    }
    function onPause() {
        paused = true;
        cancelHide();
        controlsVisible = true;
        releaseWakeLock();
    }
    function onTimeUpdate() {
        if (!isDragging && videoEl) currentTime = videoEl.currentTime;
    }
    function onDurationChange() {
        if (videoEl) duration = videoEl.duration;
    }
    function onError() { hasError = true; loaded = true; }
    function onCanPlay() { loaded = true; }
</script>

<svelte:window onfullscreenchange={onFullscreenChange} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    class="vp"
    class:controls-hidden={!controlsVisible && !paused}
    bind:this={containerEl}
    onmousemove={showControls}
    onmouseleave={() => { if (!paused) scheduleHide(); }}
    ontouchstart={showControls}
    onclick={(e) => { onclick?.(e); }}
    onkeydown={handleKey}
    role="application"
    aria-label="Video player"
    tabindex="-1"
>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
        bind:this={videoEl}
        class="vp-video"
        playsinline
        preload="auto"
        onplay={onPlay}
        onpause={onPause}
        ontimeupdate={onTimeUpdate}
        ondurationchange={onDurationChange}
        onerror={onError}
        oncanplay={onCanPlay}
        onclick={(e) => { e.stopPropagation(); togglePlay(); }}
    ></video>

    {#if hasError}
        <div class="vp-error">Failed to load video</div>
    {/if}

    <!-- Controls overlay -->
    <div class="vp-controls" class:visible={controlsVisible || paused}>

        <!-- Center play/pause -->
        <button
            class="vp-center-btn"
            onclick={(e) => { e.stopPropagation(); togglePlay(); }}
            aria-label={paused ? 'Play' : 'Pause'}
        >
            {#if paused}
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            {:else}
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            {/if}
        </button>

        <!-- Prev / Next (optional) -->
        {#if showNav && onPrev}
            <button class="vp-nav vp-nav--prev" onclick={(e) => { e.stopPropagation(); onPrev?.(); }} aria-label="Previous">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"/></svg>
            </button>
        {/if}
        {#if showNav && onNext}
            <button class="vp-nav vp-nav--next" onclick={(e) => { e.stopPropagation(); onNext?.(); }} aria-label="Next">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"/></svg>
            </button>
        {/if}

        <!-- Bottom bar -->
        <div
            class="vp-bottom"
            onmouseenter={() => { isInteractingWithBar = true; cancelHide(); }}
            onmouseleave={() => { isInteractingWithBar = false; scheduleHide(); }}
        >
            <!-- Progress -->
            <div
                class="vp-progress"
                bind:this={progressBarEl}
                onmousedown={(e) => onProgressPointerDown(e)}
                ontouchstart={(e) => onProgressPointerDown(e)}
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent()}
                tabindex="0"
                onkeydown={(e) => {
                    if (e.key === 'ArrowRight') seekTo(Math.min(1, (currentTime + 5) / duration));
                    if (e.key === 'ArrowLeft') seekTo(Math.max(0, (currentTime - 5) / duration));
                }}
            >
                <div class="vp-progress-fill" style="width:{progressPercent()}%"></div>
                <div class="vp-progress-handle" style="left:{progressPercent()}%"></div>
            </div>

            <!-- Controls row -->
            <div class="vp-row">
                <button class="vp-btn" onclick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label={paused ? 'Play' : 'Pause'}>
                    {#if paused}
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    {:else}
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    {/if}
                </button>

                <button class="vp-btn" onclick={(e) => { e.stopPropagation(); toggleMute(); }} aria-label={muted ? 'Unmute' : 'Mute'}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d={volumeIcon()}/>
                    </svg>
                </button>

                <!-- Volume slider — stop touch/mouse events so swipe gestures don't fire -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="vp-vol-wrap"
                    ontouchstart={(e) => e.stopPropagation()}
                    ontouchmove={(e) => e.stopPropagation()}
                    ontouchend={(e) => e.stopPropagation()}
                    onmousedown={(e) => e.stopPropagation()}
                >
                    <input
                        class="vp-volume"
                        type="range"
                        min="0" max="1" step="0.02"
                        value={muted ? 0 : volume}
                        oninput={(e) => setVolume(parseFloat((e.target as HTMLInputElement).value))}
                        aria-label="Volume"
                    />
                </div>

                <span class="vp-time">{fmt(currentTime)} / {fmt(duration)}</span>

                <button class="vp-btn" onclick={(e) => { e.stopPropagation(); toggleFullscreen(); }} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                    {#if isFullscreen}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                        </svg>
                    {:else}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                        </svg>
                    {/if}
                </button>
            </div>
        </div>
    </div>
</div>

<style>
    .vp {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        overflow: hidden;
        cursor: default;
    }

    .vp-video {
        max-width: 100%;
        max-height: 100%;
        display: block;
    }

    .vp-error {
        position: absolute;
        color: rgba(255,255,255,0.7);
        font-size: 0.875rem;
    }

    /* Controls */
    .vp-controls {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .vp-controls.visible {
        opacity: 1;
        pointer-events: all;
    }

    .controls-hidden .vp-controls {
        cursor: none;
    }

    /* Center play/pause */
    .vp-center-btn {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 56px;
        height: 56px;
        background: rgba(0,0,0,0.55);
        border: none;
        border-radius: 50%;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, transform 0.1s;
    }

    .vp-center-btn:hover { background: rgba(0,0,0,0.75); transform: translate(-50%, -50%) scale(1.08); }

    .vp-center-btn svg { width: 26px; height: 26px; }

    /* Prev/next nav */
    .vp-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 44px;
        height: 64px;
        background: rgba(0,0,0,0.4);
        border: none;
        border-radius: 6px;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
    }

    .vp-nav:hover { background: rgba(0,0,0,0.65); }
    .vp-nav svg { width: 22px; height: 22px; }
    .vp-nav--prev { left: 8px; }
    .vp-nav--next { right: 8px; }

    /* Bottom bar */
    .vp-bottom {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 40px 12px 10px;
        background: linear-gradient(to top, rgba(0,0,0,0.75), transparent);
    }

    /* Progress */
    .vp-progress {
        position: relative;
        height: 18px;
        display: flex;
        align-items: center;
        cursor: pointer;
        margin-bottom: 6px;
        touch-action: none;
    }

    .vp-progress::before {
        content: '';
        position: absolute;
        left: 0; right: 0;
        height: 4px;
        background: rgba(255,255,255,0.3);
        border-radius: 2px;
        top: 50%;
        transform: translateY(-50%);
    }

    .vp-progress-fill {
        position: absolute;
        left: 0;
        height: 4px;
        background: var(--color-primary, #c8ff00);
        border-radius: 2px;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
    }

    .vp-progress-handle {
        position: absolute;
        width: 14px;
        height: 14px;
        background: #fff;
        border-radius: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        box-shadow: 0 0 4px rgba(0,0,0,0.5);
    }

    /* Controls row */
    .vp-row {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .vp-btn {
        width: 36px;
        height: 36px;
        background: none;
        border: none;
        color: rgba(255,255,255,0.85);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
        flex-shrink: 0;
    }

    .vp-btn:hover { color: #fff; background: rgba(255,255,255,0.12); }
    .vp-btn svg { width: 18px; height: 18px; }

    .vp-vol-wrap {
        display: flex;
        align-items: center;
    }

    .vp-volume {
        width: 72px;
        height: 4px;
        appearance: none;
        background: rgba(255,255,255,0.3);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
    }

    .vp-volume::-webkit-slider-thumb {
        appearance: none;
        width: 12px;
        height: 12px;
        background: #fff;
        border-radius: 50%;
        cursor: pointer;
    }

    .vp-volume::-moz-range-thumb {
        width: 12px;
        height: 12px;
        background: #fff;
        border-radius: 50%;
        border: none;
        cursor: pointer;
    }

    .vp-time {
        margin-left: auto;
        font-size: 0.75rem;
        color: rgba(255,255,255,0.7);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    @media (max-width: 480px) {
        .vp-volume { width: 50px; }
    }
</style>
