<script lang="ts">
    import { page } from '$app/stores';
    import { onMount, onDestroy, tick } from 'svelte';
    import { goto } from '$app/navigation';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import { settingsStore } from '$lib/stores/settings.svelte';
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

    onMount(() => {
        const path = $page.url.searchParams.get('path') ?? '';
        galleryStore.navigate(path);
        window.addEventListener('connectivity:restored', handleConnectivityRestored);
    });

    onDestroy(() => {
        window.removeEventListener('connectivity:restored', handleConnectivityRestored);
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

<div class="gallery-page">
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
            <p>This folder is empty.</p>
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
