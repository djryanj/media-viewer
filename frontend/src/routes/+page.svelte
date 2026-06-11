<script lang="ts">
    import { page } from '$app/stores';
    import { onMount, onDestroy, tick } from 'svelte';
    import { goto } from '$app/navigation';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import { settingsStore } from '$lib/stores/settings.svelte';
    import { createPullToRefresh } from '$lib/utils/pullToRefresh';
    import type { PathPart } from '$lib/api/types';
    import Gallery from '$lib/components/gallery/Gallery.svelte';
    import Breadcrumb from '$lib/components/gallery/Breadcrumb.svelte';
    import GalleryToolbar from '$lib/components/gallery/GalleryToolbar.svelte';
    import FavoritesStrip from '$lib/components/gallery/FavoritesStrip.svelte';
    import GalleryScrubber from '$lib/components/gallery/GalleryScrubber.svelte';

    // Navigate whenever the ?path= query param changes; save + restore scroll.
    $effect(() => {
        const path = $page.url.searchParams.get('path') ?? '';
        if (path !== galleryStore.path) {
            const mainEl = document.getElementById('main-content');
            if (mainEl) galleryStore.saveScrollPosition(galleryStore.path, mainEl.scrollTop);

            galleryStore.navigate(path).then((fromCache) => {
                if (fromCache) {
                    const scrollTop = galleryStore.getScrollPosition(path);
                    if (scrollTop > 0) {
                        tick().then(() => {
                            const el = document.getElementById('main-content');
                            if (el) el.scrollTop = scrollTop;
                        });
                    }
                }
            });
        }
    });

    function handleConnectivityRestored() {
        galleryStore.refresh();
    }

    // Tracks whether any worker is currently active, so the empty-gallery
    // state can show "Indexing…" instead of "This folder is empty."
    let indexerRunning = $state(false);

    // When the indexer finishes a run, refresh so newly indexed files appear.
    function handleIndexerComplete() {
        indexerRunning = false;
        galleryStore.refresh();
    }

    // While indexing is running, retry the gallery fetch if it came back empty.
    // This handles the common NFS case where the first query returns 0 items
    // because the indexer hasn't committed its first batch yet (< 500 files or
    // < 30 s elapsed).  StatusFooter fires this event on every 3 s status poll
    // while a worker is active, so we get automatic progressive refresh.
    function handleIndexerRunning() {
        indexerRunning = true;
        if (!galleryStore.loading && galleryStore.items.length === 0 && !galleryStore.error) {
            galleryStore.refresh();
        }
    }

    // ── Pull-to-refresh ────────────────────────────────────────────────────────
    let pullIndicator = $state(false);

    onMount(() => {
        const path = $page.url.searchParams.get('path') ?? '';
        galleryStore.navigate(path);

        window.addEventListener('connectivity:restored', handleConnectivityRestored);
        window.addEventListener('indexer:complete', handleIndexerComplete);
        window.addEventListener('indexer:running', handleIndexerRunning);

        // Attach pull-to-refresh touch handlers to the main scroll container.
        const mainEl = document.getElementById('main-content');
        if (mainEl) {
            const ptr = createPullToRefresh({
                getScrollTop: () => mainEl.scrollTop,
                onRefresh: () => galleryStore.refresh()
            });

            const onTS = (e: TouchEvent) => ptr.onTouchStart(e.touches[0].clientY);
            const onTM = (e: TouchEvent) => {
                pullIndicator = ptr.onTouchMove(e.touches[0].clientY);
            };
            const onTE = () => {
                const wasPulling = pullIndicator;
                pullIndicator = false;
                ptr.onTouchEnd(wasPulling);
            };

            mainEl.addEventListener('touchstart', onTS, { passive: true });
            mainEl.addEventListener('touchmove', onTM, { passive: true });
            mainEl.addEventListener('touchend', onTE, { passive: true });
            mainEl.addEventListener('touchcancel', onTE, { passive: true });

            return () => {
                mainEl.removeEventListener('touchstart', onTS);
                mainEl.removeEventListener('touchmove', onTM);
                mainEl.removeEventListener('touchend', onTE);
                mainEl.removeEventListener('touchcancel', onTE);
                ptr.destroy();
            };
        }
    });

    onDestroy(() => {
        window.removeEventListener('connectivity:restored', handleConnectivityRestored);
        window.removeEventListener('indexer:complete', handleIndexerComplete);
        window.removeEventListener('indexer:running', handleIndexerRunning);
    });

    // Build breadcrumb from the current path string
    const breadcrumb = $derived<PathPart[]>(
        (() => {
            const p = galleryStore.path;
            if (!p) return [];
            const parts: PathPart[] = [{ name: 'Library', path: '' }];
            const segments = p.split('/').filter(Boolean);
            segments.forEach((seg, i) => {
                parts.push({ name: seg, path: segments.slice(0, i + 1).join('/') });
            });
            return parts;
        })()
    );

    const currentDirName = $derived(
        galleryStore.path
            ? (galleryStore.path.split('/').filter(Boolean).pop() ?? 'Library')
            : 'Library'
    );

    function handleKeydown(e: KeyboardEvent) {
        if (e.key !== 'Escape') return;
        // Let other consumers handle their own Escape cases first.
        if (galleryStore.selectionMode || lightboxStore.open || settingsStore.open) return;
        const path = galleryStore.path;
        if (!path) return;
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        goto(parent ? `/?path=${encodeURIComponent(parent)}` : '/');
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
    <title
        >{currentDirName !== 'Library' ? `${currentDirName} — Media Viewer` : 'Media Viewer'}</title
    >
</svelte:head>

<div class="gallery-page" class:has-scrubber={galleryStore.totalItems > 100}>
    {#if pullIndicator}
        <div class="pull-indicator" aria-hidden="true" aria-label="Release to refresh">
            <div class="pull-spinner"></div>
        </div>
    {/if}

    {#if breadcrumb.length > 1}
        <Breadcrumb parts={breadcrumb} />
    {/if}

    <GalleryToolbar />

    {#if !galleryStore.loading && galleryStore.favorites.length > 0}
        <FavoritesStrip items={galleryStore.favorites} />
    {/if}

    {#if galleryStore.loading}
        <div class="state-message" role="status">
            <div class="spinner" aria-hidden="true"></div>
            <span>Loading…</span>
        </div>
    {:else if galleryStore.error}
        <div class="state-message state-error" role="alert">
            <p>{galleryStore.error}</p>
            <button onclick={() => galleryStore.navigate(galleryStore.path)}>Retry</button>
        </div>
    {:else if galleryStore.items.length === 0}
        <div class="state-message" role="status">
            {#if indexerRunning}
                <div class="spinner" aria-hidden="true"></div>
                <span>Indexing your library…</span>
            {:else}
                <p>This folder is empty.</p>
            {/if}
        </div>
    {:else if galleryStore.filteredItems.length === 0}
        <div class="state-message" role="status">
            <p>No {galleryStore.typeFilter}s in this folder.</p>
        </div>
    {:else}
        <Gallery items={galleryStore.filteredItems} />
    {/if}
</div>

<GalleryScrubber />

<style>
    .gallery-page {
        min-height: 100%;
    }

    /* Reserve space for the scrubber so thumbnails don't slide under it.
     * Values match the scrubber's width (28px mobile / 32px desktop) plus a
     * small gap so the track doesn't kiss the last thumbnail column. */
    .gallery-page.has-scrubber {
        padding-right: 32px;
    }

    @media (min-width: 1024px) {
        .gallery-page.has-scrubber {
            padding-right: 40px;
        }
    }

    /* Pull-to-refresh indicator — appears at the top of the gallery page while
     * the user is dragging down past the threshold. */
    .pull-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-3) 0;
        color: var(--color-primary);
    }

    .pull-spinner {
        width: 24px;
        height: 24px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
    }

    .state-message {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-4);
        padding: var(--spacing-8);
        color: var(--color-text-muted);
        min-height: 240px;
    }

    .state-error {
        color: var(--color-danger);
    }

    .state-error button {
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        color: var(--color-text);
        padding: var(--spacing-2) var(--spacing-4);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: var(--text-sm);
    }

    .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
