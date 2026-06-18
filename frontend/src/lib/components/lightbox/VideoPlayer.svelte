<script lang="ts">
    import { onDestroy } from 'svelte';
    import Hls from 'hls.js';

    interface Props {
        path: string;
        autoplay?: boolean;
        loop?: boolean;
        showNav?: boolean;
        /** Show a clock overlay. Set to false when a parent already renders a clock. */
        showClock?: boolean;
        onPrev?: () => void;
        onNext?: () => void;
        onEnded?: () => void;
        /** When set, fullscreen targets this element instead of the .vp container.
         *  Use this in playlist mode to keep the header/sidebar inside fullscreen. */
        fullscreenTarget?: HTMLElement;
        onclick?: (e: MouseEvent) => void;
    }

    let {
        path,
        autoplay = true,
        loop = false,
        showNav = false,
        showClock = true,
        onPrev,
        onNext,
        onEnded,
        fullscreenTarget,
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
    let hasError = $state(false);
    let loading = $state(false);
    let transcoding = $state(false);

    // ── Volume (persisted) ────────────────────────────────────────────────────
    let volume = $state(loadVolume());
    let muted = $state(loadMuted());

    function loadVolume(): number {
        try {
            return parseFloat(localStorage.getItem('playerVolume') ?? '1') || 1;
        } catch {
            return 1;
        }
    }
    function loadMuted(): boolean {
        try {
            return localStorage.getItem('playerMuted') === 'true';
        } catch {
            return false;
        }
    }
    function saveVolumePrefs() {
        try {
            localStorage.setItem('playerVolume', String(volume));
            localStorage.setItem('playerMuted', String(muted));
        } catch {
            /* ignore */
        }
    }

    // ── HLS / source management ───────────────────────────────────────────────
    let hlsInstance: Hls | null = null;
    let hlsEndedListener: ((e: Event) => void) | null = null;
    let loadId = 0;

    function encPath(p: string) {
        return p.split('/').map(encodeURIComponent).join('/');
    }

    function cleanupPrev() {
        if (hlsEndedListener && videoEl) {
            videoEl.removeEventListener('ended', hlsEndedListener);
            hlsEndedListener = null;
        }
        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }
        if (videoEl && !videoEl.paused) videoEl.pause();
        if (videoEl) {
            videoEl.removeAttribute('src');
            videoEl.load();
        }
    }

    async function loadSource(p: string) {
        const id = ++loadId;
        const stale = () => id !== loadId;

        cleanupPrev();
        hasError = false;
        loading = true;
        transcoding = false;

        if (!videoEl) return;

        videoEl.loop = loop;

        let info: { needsTranscode?: boolean } | null = null;
        try {
            const r = await fetch(`/api/stream-info/${encPath(p)}`);
            if (r.ok) info = await r.json();
        } catch {
            /* non-fatal */
        }

        if (stale() || !videoEl) return;

        if (info?.needsTranscode) {
            transcoding = true;
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
        } catch {
            /* fall through */
        }

        if (stale() || !videoEl) return;
        if (!sessionData?.playlistUrl) {
            loadDirect(p, id);
            return;
        }

        const hls = new Hls({
            debug: false,
            lowLatencyMode: false,
            startPosition: 0,
            manifestLoadingTimeOut: 20000,
            levelLoadingTimeOut: 20000,
            fragLoadingTimeOut: 60000
        });
        hlsInstance = hls;
        hls.loadSource(sessionData.playlistUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (stale()) {
                hls.destroy();
                if (hlsInstance === hls) hlsInstance = null;
                return;
            }
            applyVolumeToVideo();
            if (autoplay) {
                if (videoEl) videoEl.currentTime = 0;
                videoEl?.play().catch(() => {});
            }
        });

        // hls.js ignores native loop — handle manually.
        // Only loop when there is no onEnded callback; if onEnded is provided it
        // takes priority (e.g. playlist auto-advance) and we let it run instead.
        hlsEndedListener = () => {
            if (!videoEl?.loop || onEnded) return;
            videoEl.currentTime = 0;
            videoEl.play().catch(() => {});
        };
        videoEl.addEventListener('ended', hlsEndedListener);

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
        } catch {
            /* fall through */
        }

        if (stale() || !videoEl) return;
        if (!sessionData?.playlistUrl) {
            loadDirect(p, id);
            return;
        }

        videoEl.src = sessionData.playlistUrl;
        videoEl.load();
        videoEl.currentTime = 0;
        applyVolumeToVideo();
        if (autoplay) videoEl.play().catch(() => {});
    }

    function loadDirect(p: string, id: number) {
        if (id !== loadId || !videoEl) return;
        videoEl.src = `/api/stream/${encPath(p)}`;
        videoEl.load();
        videoEl.currentTime = 0;
        applyVolumeToVideo();
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
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    }

    function scheduleHide() {
        cancelHide();
        if (paused || isDragging || isInteractingWithBar) return;
        hideTimer = setTimeout(() => {
            controlsVisible = false;
            hideTimer = null;
        }, 3000);
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
        const clientX =
            'touches' in e
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
        if (videoEl) {
            videoEl.volume = v;
            videoEl.muted = false;
        }
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
        if (volume > 0.5)
            return 'M11 5 6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07';
        return 'M11 5 6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07';
    }

    // ── Fullscreen ────────────────────────────────────────────────────────────
    let isFullscreen = $state(false);

    function toggleFullscreen() {
        const target = fullscreenTarget ?? containerEl;
        if (!target) return;
        if (!document.fullscreenElement) {
            target.requestFullscreen().catch(() => {});
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
        } catch {
            /* ignore — may fail when page is not visible */
        }
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

    // ── Clock ─────────────────────────────────────────────────────────────────
    const PREFS_KEY = 'mediaViewerPreferences';
    let clockEnabled = $state(true);
    let clockAlwaysVisible = $state(false);
    let clockFormat = $state<'12' | '24'>('12');
    let clockTime = $state('');
    let clockTimer: ReturnType<typeof setInterval> | null = null;

    function readClockPrefs() {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (raw) {
                const p = JSON.parse(raw) as Record<string, unknown>;
                clockEnabled = (p.clockEnabled as boolean) ?? true;
                clockAlwaysVisible = (p.clockAlwaysVisible as boolean) ?? false;
                clockFormat = (p.clockFormat as string) === '24' ? '24' : '12';
            }
        } catch {
            /* ignore */
        }
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
        if (showClock && clockEnabled) {
            readClockPrefs();
            updateClock();
            clockTimer = setInterval(updateClock, 1000);
        } else {
            if (clockTimer) {
                clearInterval(clockTimer);
                clockTimer = null;
            }
        }
        return () => {
            if (clockTimer) {
                clearInterval(clockTimer);
                clockTimer = null;
            }
        };
    });

    $effect(() => {
        function onPrefChanged() {
            readClockPrefs();
            updateClock();
        }
        window.addEventListener('clockPreferenceChanged', onPrefChanged);
        return () => window.removeEventListener('clockPreferenceChanged', onPrefChanged);
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    $effect(() => {
        if (path && videoEl) loadSource(path);
    });

    onDestroy(() => {
        wakeLockDestroyed = true;
        unload();
        cancelHide();
        releaseWakeLock();
        // Don't call exitFullscreen here — the browser exits fullscreen automatically
        // when the fullscreen element is removed from the DOM. Calling it explicitly
        // would also prematurely exit fullscreen when switching playlist items (where
        // the VideoPlayer remounts but the fullscreen container stays in the tree).
    });

    // ── Video event handlers ──────────────────────────────────────────────────
    function onPlay() {
        loading = false;
        transcoding = false;
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
        if (videoEl) {
            duration = videoEl.duration;
            loading = false;
            transcoding = false;
        }
    }
    function onError() {
        loading = false;
        transcoding = false;
        hasError = true;
    }
    function onEndedHandler() {
        // Always call onEnded when provided — an explicit advance callback (e.g.
        // playlist next) takes priority over the loop setting.  When there is no
        // callback the video simply stops, which is the correct non-playlist behavior.
        onEnded?.();
    }
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
    onmouseleave={() => {
        if (!paused) scheduleHide();
    }}
    ontouchstart={showControls}
    onclick={(e) => {
        onclick?.(e);
    }}
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
        preload="metadata"
        onplay={onPlay}
        onpause={onPause}
        ontimeupdate={onTimeUpdate}
        ondurationchange={onDurationChange}
        onerror={onError}
        onended={onEndedHandler}
        onclick={(e) => {
            e.stopPropagation();
            togglePlay();
        }}
    ></video>

    {#if hasError}
        <div class="vp-error">Failed to load video</div>
    {/if}

    {#if loading && !hasError}
        <div
            class="vp-loading"
            aria-live="polite"
            aria-label={transcoding ? 'Transcoding video' : 'Loading video'}
        >
            <div class="vp-spinner" aria-hidden="true"></div>
            {#if transcoding}
                <span class="vp-loading-label">Transcoding video…</span>
            {/if}
        </div>
    {/if}

    <!-- Clock overlay -->
    {#if showClock && clockEnabled && clockTime}
        <span class="vp-clock" class:always-visible={clockAlwaysVisible} aria-label="Current time"
            >{clockTime}</span
        >
    {/if}

    <!-- Controls overlay -->
    <div class="vp-controls" class:visible={controlsVisible || paused}>
        <!-- Center play/pause -->
        <button
            class="vp-center-btn"
            onclick={(e) => {
                e.stopPropagation();
                togglePlay();
            }}
            aria-label={paused ? 'Play' : 'Pause'}
        >
            {#if paused}
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                    ><polygon points="5 3 19 12 5 21 5 3" /></svg
                >
            {:else}
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                    ><rect x="6" y="4" width="4" height="16" /><rect
                        x="14"
                        y="4"
                        width="4"
                        height="16"
                    /></svg
                >
            {/if}
        </button>

        <!-- Prev / Next (optional) -->
        {#if showNav && onPrev}
            <button
                class="vp-nav vp-nav--prev"
                onclick={(e) => {
                    e.stopPropagation();
                    onPrev?.();
                }}
                aria-label="Previous"
            >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                    ><polygon points="19 20 9 12 19 4 19 20" /><line
                        x1="5"
                        y1="19"
                        x2="5"
                        y2="5"
                        stroke="currentColor"
                        stroke-width="2"
                    /></svg
                >
            </button>
        {/if}
        {#if showNav && onNext}
            <button
                class="vp-nav vp-nav--next"
                onclick={(e) => {
                    e.stopPropagation();
                    onNext?.();
                }}
                aria-label="Next"
            >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                    ><polygon points="5 4 15 12 5 20 5 4" /><line
                        x1="19"
                        y1="5"
                        x2="19"
                        y2="19"
                        stroke="currentColor"
                        stroke-width="2"
                    /></svg
                >
            </button>
        {/if}

        <!-- Bottom bar -->
        <div
            class="vp-bottom"
            onmouseenter={() => {
                isInteractingWithBar = true;
                cancelHide();
            }}
            onmouseleave={() => {
                isInteractingWithBar = false;
                scheduleHide();
            }}
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
                <button
                    class="vp-btn"
                    onclick={(e) => {
                        e.stopPropagation();
                        togglePlay();
                    }}
                    aria-label={paused ? 'Play' : 'Pause'}
                >
                    {#if paused}
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                            ><polygon points="5 3 19 12 5 21 5 3" /></svg
                        >
                    {:else}
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                            ><rect x="6" y="4" width="4" height="16" /><rect
                                x="14"
                                y="4"
                                width="4"
                                height="16"
                            /></svg
                        >
                    {/if}
                </button>

                <button
                    class="vp-btn"
                    onclick={(e) => {
                        e.stopPropagation();
                        toggleMute();
                    }}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                    >
                        <path d={volumeIcon()} />
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
                        min="0"
                        max="1"
                        step="0.02"
                        value={muted ? 0 : volume}
                        style="--vol-pct: {(muted ? 0 : volume) * 100}%"
                        oninput={(e) => setVolume(parseFloat((e.target as HTMLInputElement).value))}
                        aria-label="Volume"
                    />
                </div>

                <span class="vp-time">{fmt(currentTime)} / {fmt(duration)}</span>

                <button
                    class="vp-btn"
                    onclick={(e) => {
                        e.stopPropagation();
                        toggleFullscreen();
                    }}
                    aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                    {#if isFullscreen}
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <path
                                d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"
                            />
                        </svg>
                    {:else}
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <path
                                d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
                            />
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
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.875rem;
    }

    .vp-loading {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        pointer-events: none;
    }

    .vp-spinner {
        width: 36px;
        height: 36px;
        border: 3px solid rgba(255, 255, 255, 0.2);
        border-top-color: rgba(255, 255, 255, 0.8);
        border-radius: 50%;
        animation: vp-spin 0.75s linear infinite;
    }

    .vp-loading-label {
        font-size: 0.8125rem;
        color: rgba(255, 255, 255, 0.65);
        letter-spacing: 0.01em;
    }

    @keyframes vp-spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* Clock — centered at top, matching the Lightbox clock position */
    .vp-clock {
        position: absolute;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2;
        font-size: 0.875rem;
        color: rgba(255, 255, 255, 0.75);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        pointer-events: none;
        opacity: 1;
        transition: opacity 0.35s ease;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    }

    /* Clock fades with controls by default */
    .controls-hidden .vp-clock:not(.always-visible) {
        opacity: 0;
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
        background: rgba(0, 0, 0, 0.55);
        border: none;
        border-radius: 50%;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
            background 0.15s,
            transform 0.1s;
    }

    .vp-center-btn:hover {
        background: rgba(0, 0, 0, 0.75);
        transform: translate(-50%, -50%) scale(1.08);
    }

    .vp-center-btn svg {
        width: 26px;
        height: 26px;
    }

    /* Prev/next nav */
    .vp-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 44px;
        height: 64px;
        background: rgba(0, 0, 0, 0.4);
        border: none;
        border-radius: 6px;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
    }

    .vp-nav:hover {
        background: rgba(0, 0, 0, 0.65);
    }
    .vp-nav svg {
        width: 22px;
        height: 22px;
    }
    .vp-nav--prev {
        left: 8px;
    }
    .vp-nav--next {
        right: 8px;
    }

    /* Bottom bar */
    .vp-bottom {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 40px 12px 10px;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent);
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
        left: 0;
        right: 0;
        height: 4px;
        background: rgba(255, 255, 255, 0.3);
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
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
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
        color: rgba(255, 255, 255, 0.85);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition:
            color 0.15s,
            background 0.15s;
        flex-shrink: 0;
    }

    .vp-btn:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.12);
    }
    .vp-btn svg {
        width: 18px;
        height: 18px;
    }

    .vp-vol-wrap {
        display: flex;
        align-items: center;
    }

    .vp-volume {
        width: 72px;
        height: 18px;
        appearance: none;
        background: transparent;
        outline: none;
        cursor: pointer;
    }

    .vp-volume::-webkit-slider-runnable-track {
        height: 4px;
        background: linear-gradient(
            to right,
            var(--color-primary, #c8ff00) 0%,
            var(--color-primary, #c8ff00) var(--vol-pct, 100%),
            rgba(255, 255, 255, 0.3) var(--vol-pct, 100%),
            rgba(255, 255, 255, 0.3) 100%
        );
        border-radius: 2px;
    }

    .vp-volume::-moz-range-track {
        height: 4px;
        background: rgba(255, 255, 255, 0.3);
        border-radius: 2px;
        border: none;
    }

    .vp-volume::-moz-range-progress {
        height: 4px;
        background: var(--color-primary, #c8ff00);
        border-radius: 2px;
    }

    .vp-volume::-webkit-slider-thumb {
        appearance: none;
        width: 14px;
        height: 14px;
        background: #fff;
        border-radius: 50%;
        cursor: pointer;
        margin-top: -5px;
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
    }

    .vp-volume::-moz-range-thumb {
        width: 14px;
        height: 14px;
        background: #fff;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
    }

    .vp-time {
        margin-left: auto;
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.7);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    @media (max-width: 480px) {
        .vp-volume {
            width: 50px;
        }
    }
</style>
