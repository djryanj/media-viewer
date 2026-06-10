<script lang="ts">
    import { onDestroy, tick } from 'svelte';
    import type { MediaFile } from '$lib/api/types';
    import GalleryItem from './GalleryItem.svelte';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import { favorites as favApi } from '$lib/api/client';
    import { toastStore } from '$lib/stores/toast.svelte';
    import CollectionsPanel from '$lib/components/lightbox/CollectionsPanel.svelte';

    let {
        items,
        onitemupdate,
        externalScroll = false
    }: {
        items: MediaFile[];
        onitemupdate?: (path: string, patch: Partial<MediaFile>) => void;
        /** When true the gallery renders no infinite-scroll sentinels (caller manages pagination). */
        externalScroll?: boolean;
    } = $props();

    // Only media files (not folders) go into the lightbox
    const mediaItems = $derived(items.filter((i) => i.type !== 'folder'));

    function handleTap(item: MediaFile, shiftKey: boolean) {
        if (galleryStore.selectionMode) {
            if (shiftKey) {
                galleryStore.selectRange(item.path);
            } else {
                galleryStore.toggleSelection(item.path);
            }
            return;
        }
        if (item.type === 'folder') return;
        lightboxStore.show(item, mediaItems);
    }

    async function handleToggleFavorite(item: MediaFile) {
        const newState = !item.isFavorite;
        const patch = { isFavorite: newState };
        // Optimistic update
        galleryStore.updateItem(item.path, patch);
        onitemupdate?.(item.path, patch);
        if (newState) {
            galleryStore.addFavorite(item);
        } else {
            galleryStore.removeFavorite(item.path);
        }
        try {
            if (newState) {
                await favApi.add({ path: item.path, name: item.name, type: item.type });
            } else {
                await favApi.remove(item.path);
            }
        } catch {
            // Revert
            const revert = { isFavorite: !newState };
            galleryStore.updateItem(item.path, revert);
            onitemupdate?.(item.path, revert);
            if (!newState) {
                galleryStore.addFavorite(item);
            } else {
                galleryStore.removeFavorite(item.path);
            }
            toastStore.error('Failed to update favorite');
        }
    }

    // ── Per-item collections panel ────────────────────────────────────────────
    let collectionsItem = $state<MediaFile | null>(null);

    function handleCollections(item: MediaFile) {
        collectionsItem = item;
    }

    function handleLongPress(item: MediaFile) {
        if (item.type === 'folder') return;
        galleryStore.toggleSelection(item.path);
        // If the long-press gesture is still live, immediately set up a drag
        // so the user can keep dragging without lifting their finger.
        if (pendingPointerId !== -1 && pendingPointerPath === item.path) {
            dragAnchorPath = pendingPointerPath;
            dragPointerId = pendingPointerId;
            dragStartX = pendingPointerX;
            dragStartY = pendingPointerY;
            dragPointerType = pendingPointerType;
        }
        // Apply touch-action:none immediately (don't wait for Svelte re-render)
        if (galleryEl) galleryEl.style.touchAction = 'none';
    }

    // ── Drag-to-select ───────────────────────────────────────────────────────
    let galleryEl: HTMLDivElement | undefined = $state();
    let dragAnchorPath: string | null = null;
    let dragPointerId = -1;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragPointerType = 'mouse';
    // Pending pointer: tracks the most recent pointerdown regardless of selectionMode
    let pendingPointerPath: string | null = null;
    let pendingPointerId = -1;
    let pendingPointerX = 0;
    let pendingPointerY = 0;
    let pendingPointerType = 'mouse';

    // Sync touch-action to the DOM imperatively whenever selectionMode changes
    $effect(() => {
        if (galleryEl) galleryEl.style.touchAction = galleryStore.selectionMode ? 'none' : '';
    });

    function handleGalleryPointerDown(e: PointerEvent) {
        // Always record pending pointer info so long-press can initialize a drag.
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-path]');
        if (el?.dataset.path) {
            const hit = items.find((i) => i.path === el.dataset.path);
            if (hit && hit.type !== 'folder') {
                pendingPointerPath = el.dataset.path;
                pendingPointerId = e.pointerId;
                pendingPointerX = e.clientX;
                pendingPointerY = e.clientY;
                pendingPointerType = e.pointerType;
            }
        }
        if (!galleryStore.selectionMode) return;
        if (!el?.dataset.path) return;
        const hit2 = items.find((i) => i.path === el.dataset.path);
        if (!hit2 || hit2.type === 'folder') return;
        dragAnchorPath = el.dataset.path;
        dragPointerId = e.pointerId;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragPointerType = e.pointerType;
    }

    function handleGalleryPointerMove(e: PointerEvent) {
        if (dragAnchorPath === null || e.pointerId !== dragPointerId) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        const threshold = dragPointerType === 'touch' ? 16 : 8;
        if (Math.sqrt(dx * dx + dy * dy) < threshold) return;
        // Prevent the browser from scrolling during a drag-to-select gesture.
        e.preventDefault();
        // Capture the pointer on the first real drag move so we keep receiving
        // events even when the finger moves outside individual items.
        if (!galleryStore.isDragging) {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        const under = document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest<HTMLElement>('[data-path]');
        const toPath = under?.dataset.path ?? dragAnchorPath;
        galleryStore.selectDragRange(dragAnchorPath, toPath);
    }

    function handleGalleryPointerUp(e: PointerEvent) {
        pendingPointerId = -1;
        pendingPointerPath = null;
        if (e.pointerId !== dragPointerId) return;
        dragAnchorPath = null;
        dragPointerId = -1;
        // Delay so GalleryItem's pointerup fires first and sees isDragging=true
        setTimeout(() => galleryStore.endDrag(), 0);
    }

    // ── Infinite scroll — bottom sentinel (load next) ────────────────────────
    let sentinel: HTMLDivElement | undefined = $state();
    let bottomObserver: IntersectionObserver | null = null;

    function setupBottomObserver(el: HTMLDivElement) {
        bottomObserver?.disconnect();
        bottomObserver = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    galleryStore.loadMore();
                }
            },
            { rootMargin: '0px 0px 400px 0px' }
        );
        bottomObserver.observe(el);
    }

    $effect(() => {
        if (sentinel) setupBottomObserver(sentinel);
    });

    // ── Infinite scroll — top sentinel (load previous) ───────────────────────
    let topSentinel: HTMLDivElement | undefined = $state();
    let topObserver: IntersectionObserver | null = null;

    function setupTopObserver(el: HTMLDivElement) {
        topObserver?.disconnect();
        topObserver = new IntersectionObserver(
            async (entries) => {
                if (!entries[0].isIntersecting || !galleryStore.hasMorePrev) return;
                const container = document.getElementById('main-content');
                const prevScrollHeight = container?.scrollHeight ?? 0;
                await galleryStore.loadPrev();
                await tick();
                // Compensate for prepended items so the viewport stays on the same content.
                if (container) {
                    container.scrollTop += container.scrollHeight - prevScrollHeight;
                }
            },
            { rootMargin: '200px 0px 0px 0px' }
        );
        topObserver.observe(el);
    }

    $effect(() => {
        if (topSentinel) setupTopObserver(topSentinel);
    });

    onDestroy(() => {
        bottomObserver?.disconnect();
        topObserver?.disconnect();
    });
</script>

{#if !externalScroll && galleryStore.hasMorePrev}
    <div class="sentinel top-sentinel" bind:this={topSentinel} aria-hidden="true">
        {#if galleryStore.loadingPrev}
            <div class="load-spinner"></div>
        {/if}
    </div>
{/if}

<div
    class="gallery"
    id="gallery"
    role="list"
    bind:this={galleryEl}
    onpointerdown={handleGalleryPointerDown}
    onpointermove={handleGalleryPointerMove}
    onpointerup={handleGalleryPointerUp}
    onpointercancel={handleGalleryPointerUp}
>
    {#each items as item (item.path)}
        <GalleryItem
            {item}
            selected={galleryStore.isSelected(item.path)}
            selectionMode={galleryStore.selectionMode}
            ontap={handleTap}
            onlongpress={handleLongPress}
            ontogglefavorite={handleToggleFavorite}
            oncollections={handleCollections}
        />
    {/each}
</div>

{#if !externalScroll && galleryStore.hasMore}
    <div class="sentinel" bind:this={sentinel} aria-hidden="true">
        {#if galleryStore.loadingMore}
            <div class="load-spinner"></div>
        {/if}
    </div>
{/if}

{#if collectionsItem}
    <CollectionsPanel itemPaths={[collectionsItem.path]} onclose={() => (collectionsItem = null)} />
{/if}

<style>
    .gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 2px;
        padding: 2px;
        /* Contain stacking context so overlays don't bleed */
        isolation: isolate;
    }

    @media (min-width: 480px) {
        .gallery {
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        }
    }

    @media (min-width: 768px) {
        .gallery {
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 3px;
        }
    }

    @media (min-width: 1280px) {
        .gallery {
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        }
    }

    .sentinel {
        grid-column: 1 / -1;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .load-spinner {
        width: 24px;
        height: 24px;
        border: 2px solid var(--color-border);
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
