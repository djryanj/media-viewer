<script lang="ts">
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { playlists as playlistsApi } from '$lib/api/client';
    import type { Playlist, PlaylistItem } from '$lib/api/types';
    import VideoPlayer from '$lib/components/lightbox/VideoPlayer.svelte';
    import { toastStore } from '$lib/stores/toast.svelte';

    let playlist = $state<Playlist | null>(null);
    let loading = $state(true);
    let currentIndex = $state(0);
    let sidebarOpen = $state(false);
    let playerPageEl = $state<HTMLDivElement | undefined>(undefined);
    // Swipe-to-reveal sidebar on mobile
    let touchStartX = 0;
    let touchStartY = 0;

    const playlistName = $derived($page.params.name ?? '');
    const currentItem = $derived(playlist?.items[currentIndex] ?? null);

    async function load() {
        loading = true;
        try {
            playlist = await playlistsApi.get(playlistName);
        } catch {
            toastStore.error('Failed to load playlist');
            goto('/');
        } finally {
            loading = false;
        }
    }

    function selectItem(index: number) {
        currentIndex = index;
        // On mobile, auto-close sidebar when an item is selected
        if (window.innerWidth < 768) sidebarOpen = false;
    }

    function prev() {
        if (currentIndex > 0) currentIndex--;
    }

    function next() {
        if (playlist && currentIndex < playlist.items.length - 1) currentIndex++;
    }

    function handleTouchStart(e: TouchEvent) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }

    function handleTouchEnd(e: TouchEvent) {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // Swipe up to exit the playlist player
        if (dy < -80 && absDy > absDx) {
            goto('/');
            return;
        }

        if (absDy >= absDx * 0.75) return; // predominantly vertical — ignore

        if (sidebarOpen) {
            // Swipe right → close sidebar
            if (dx > 60) sidebarOpen = false;
            return;
        }

        // Right-edge swipe left → open sidebar
        if (touchStartX > window.innerWidth - 48 && dx < -30) {
            sidebarOpen = true;
            return;
        }

        // Swipe left → next video; swipe right → prev video
        const THRESHOLD = 60;
        if (dx < -THRESHOLD) next();
        else if (dx > THRESHOLD) prev();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'ArrowLeft') prev();
        else if (e.key === 'ArrowRight') next();
        else if (e.key === 'Escape') {
            // When fullscreen is active, let the browser exit it; don't navigate away.
            if (document.fullscreenElement) return;
            if (sidebarOpen) sidebarOpen = false;
            else goto('/');
        } else if (e.key === 'p' || e.key === 'P') sidebarOpen = !sidebarOpen;
    }

    onMount(() => {
        load();
    });

    function encPath(p: string) {
        return p.split('/').map(encodeURIComponent).join('/');
    }

    function isVideo(item: PlaylistItem) {
        return item.mediaType === 'video' || item.mediaType === undefined;
    }
</script>

<svelte:head>
    <title>{playlist?.name ?? 'Playlist'} — Media Viewer</title>
</svelte:head>

<svelte:window
    onkeydown={handleKeydown}
    ontouchstart={handleTouchStart}
    ontouchend={handleTouchEnd}
/>

<div class="player-page" bind:this={playerPageEl}>
    <!-- Header -->
    <header class="player-header">
        <button class="header-back" onclick={() => goto('/')} aria-label="Back to gallery">
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
            >
                <polyline points="15 18 9 12 15 6" />
            </svg>
        </button>
        <h1 class="header-title">{playlist?.name ?? 'Loading…'}</h1>
        {#if playlist}
            <span class="header-count">{currentIndex + 1} / {playlist.items.length}</span>
        {/if}
        <button
            class="header-btn"
            onclick={() => (sidebarOpen = !sidebarOpen)}
            aria-label="Toggle playlist"
            aria-pressed={sidebarOpen}
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
            >
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
        </button>
    </header>

    <div class="player-body">
        <!-- Video area -->
        <main class="player-main">
            {#if loading}
                <div class="loader">
                    <div class="spinner" aria-label="Loading"></div>
                </div>
            {:else if !currentItem}
                <div class="empty">
                    <p>This playlist is empty.</p>
                    <button onclick={() => goto('/')}>Go back</button>
                </div>
            {:else if !currentItem.exists}
                <div class="missing">
                    <p>File not found: <code>{currentItem.origPath ?? currentItem.name}</code></p>
                    {#if currentIndex < (playlist?.items.length ?? 0) - 1}
                        <button onclick={next}>Next item</button>
                    {/if}
                </div>
            {:else if isVideo(currentItem)}
                <VideoPlayer
                    path={currentItem.path}
                    autoplay={true}
                    loop={false}
                    showNav={true}
                    onPrev={currentIndex > 0 ? prev : undefined}
                    onNext={currentIndex < (playlist?.items.length ?? 0) - 1 ? next : undefined}
                    onEnded={currentIndex < (playlist?.items.length ?? 0) - 1 ? next : undefined}
                    fullscreenTarget={playerPageEl}
                />
            {:else}
                <!-- Non-video (audio) fallback -->
                <!-- svelte-ignore a11y_media_has_caption -->
                <audio
                    src="/api/stream/{encPath(currentItem.path)}"
                    controls
                    autoplay
                    class="audio-player"
                ></audio>
            {/if}
        </main>

        <!-- Sidebar -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <aside class="sidebar" class:open={sidebarOpen} aria-label="Playlist items">
            <div class="sidebar-header">
                <span class="sidebar-title">Playlist</span>
                <button
                    class="sidebar-close"
                    onclick={() => (sidebarOpen = false)}
                    aria-label="Close playlist"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <ul class="item-list" role="listbox" aria-label="Playlist items">
                {#each playlist?.items ?? [] as item, i (i)}
                    <li
                        class="item"
                        class:active={i === currentIndex}
                        class:missing={!item.exists}
                        role="option"
                        aria-selected={i === currentIndex}
                        tabindex="0"
                        onclick={() => selectItem(i)}
                        onkeydown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') selectItem(i);
                        }}
                    >
                        <span class="item-index">{i + 1}</span>
                        <div class="item-info">
                            <span class="item-name">{item.name}</span>
                            {#if !item.exists}
                                <span class="item-missing">File not found</span>
                            {/if}
                        </div>
                        {#if i === currentIndex}
                            <svg
                                class="item-playing-icon"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                aria-hidden="true"
                            >
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                        {/if}
                    </li>
                {/each}
            </ul>
        </aside>

        <!-- Sidebar backdrop (mobile) -->
        {#if sidebarOpen}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="sidebar-backdrop" onclick={() => (sidebarOpen = false)}></div>
        {/if}
    </div>
</div>

<style>
    :global(body) {
        overflow: hidden;
    }

    .player-page {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        background: #000;
        color: #fff;
        z-index: 200;
    }

    /* Header */
    .player-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        padding: var(--spacing-2) var(--spacing-3);
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
        flex-shrink: 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .header-back,
    .header-btn {
        width: 36px;
        height: 36px;
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.8);
        cursor: pointer;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition:
            background 0.15s,
            color 0.15s;
    }

    .header-back:hover,
    .header-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }
    .header-back svg,
    .header-btn svg {
        width: 20px;
        height: 20px;
    }

    .header-title {
        flex: 1;
        font-size: 0.9rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .header-count {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.5);
        white-space: nowrap;
        flex-shrink: 0;
    }

    /* Body */
    .player-body {
        flex: 1;
        display: flex;
        overflow: hidden;
        position: relative;
    }

    /* Main video area */
    .player-main {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        overflow: hidden;
    }

    .player-main :global(.vp) {
        width: 100%;
        height: 100%;
    }

    .loader,
    .empty,
    .missing {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        color: rgba(255, 255, 255, 0.6);
        font-size: 0.9rem;
        text-align: center;
        padding: 24px;
    }

    .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid rgba(255, 255, 255, 0.2);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .empty button,
    .missing button {
        padding: 8px 20px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: #fff;
        cursor: pointer;
        font-size: 0.85rem;
        transition: background 0.15s;
    }
    .empty button:hover,
    .missing button:hover {
        background: rgba(255, 255, 255, 0.2);
    }

    .missing code {
        font-size: 0.8rem;
        background: rgba(255, 255, 255, 0.1);
        padding: 2px 6px;
        border-radius: 4px;
        word-break: break-all;
    }

    .audio-player {
        width: min(480px, 100%);
    }

    /* Sidebar */
    .sidebar {
        width: 280px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        background: rgba(15, 15, 15, 0.95);
        border-left: 1px solid rgba(255, 255, 255, 0.08);
        overflow: hidden;
    }

    .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-3) var(--spacing-4);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
    }

    .sidebar-title {
        font-size: 0.85rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .sidebar-close {
        display: none;
        width: 32px;
        height: 32px;
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        border-radius: 4px;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
    }
    .sidebar-close:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }
    .sidebar-close svg {
        width: 16px;
        height: 16px;
    }

    .item-list {
        list-style: none;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        flex: 1;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
    }

    .item {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        padding: var(--spacing-3) var(--spacing-4);
        cursor: pointer;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        transition: background 0.1s;
    }

    .item:hover {
        background: rgba(255, 255, 255, 0.05);
    }
    .item.active {
        background: rgba(200, 255, 0, 0.06);
    }
    .item.missing {
        opacity: 0.4;
        cursor: default;
    }

    .item-index {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.35);
        width: 20px;
        text-align: right;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
    }

    .item.active .item-index {
        color: var(--color-primary, #c8ff00);
    }

    .item-info {
        flex: 1;
        overflow: hidden;
    }

    .item-name {
        display: block;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.85);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .item.active .item-name {
        color: #fff;
        font-weight: 500;
    }

    .item-missing {
        display: block;
        font-size: 0.7rem;
        color: var(--color-danger, #ef5350);
        margin-top: 2px;
    }

    .item-playing-icon {
        width: 12px;
        height: 12px;
        color: var(--color-primary, #c8ff00);
        flex-shrink: 0;
    }

    /* Sidebar backdrop */
    .sidebar-backdrop {
        display: none;
    }

    /* ── Mobile: sidebar overlays the video ─────────────────────────────────── */
    @media (max-width: 767px) {
        .sidebar {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: min(300px, 85vw);
            transform: translateX(100%);
            transition: transform 0.25s ease;
            z-index: 10;
        }

        .sidebar.open {
            transform: translateX(0);
        }

        .sidebar-close {
            display: flex;
        }

        .sidebar-backdrop {
            display: block;
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9;
        }
    }
</style>
