<script lang="ts">
    import { favorites as favApi } from '$lib/api/client';
    import { toastStore } from '$lib/stores/toast.svelte';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import { goto } from '$app/navigation';
    import type { MediaFile } from '$lib/api/types';

    let { items }: { items: MediaFile[] } = $props();

    // Local mutable order (optimistic)
    let orderedItems = $state<MediaFile[]>([]);
    $effect(() => {
        orderedItems = [...items];
    });

    // ── Drag-and-drop (pointer-based so it works on touch too) ────────────────
    let dragIndex = $state<number | null>(null);
    let overIndex = $state<number | null>(null);
    let saving = $state(false);

    function handleDragStart(e: DragEvent, idx: number) {
        dragIndex = idx;
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', String(idx));
    }

    function handleDragOver(e: DragEvent, idx: number) {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        overIndex = idx;
    }

    function handleDragLeave() {
        overIndex = null;
    }

    function handleDrop(e: DragEvent, targetIdx: number) {
        e.preventDefault();
        if (dragIndex === null || dragIndex === targetIdx) {
            dragIndex = null;
            overIndex = null;
            return;
        }
        const next = [...orderedItems];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(targetIdx, 0, moved);
        orderedItems = next;
        dragIndex = null;
        overIndex = null;
        persistOrder(next);
    }

    function handleDragEnd() {
        dragIndex = null;
        overIndex = null;
    }

    async function persistOrder(ordered: MediaFile[]) {
        if (saving) return;
        saving = true;
        try {
            await favApi.order(ordered.map((i) => i.path));
            galleryStore.setFavorites(ordered);
        } catch {
            toastStore.error('Failed to save favorites order');
            orderedItems = [...items]; // revert on error
        } finally {
            saving = false;
        }
    }

    function handleTap(item: MediaFile) {
        if (item.type === 'folder') {
            goto(`/?path=${encodeURIComponent(item.path)}`);
            return;
        }
        if (item.type === 'playlist') {
            goto(`/playlists/${encodeURIComponent(item.name)}`);
            return;
        }
        const mediaItems = orderedItems.filter((i) => i.type !== 'folder' && i.type !== 'playlist');
        lightboxStore.show(item, mediaItems);
    }

    // ── Long-press to remove ──────────────────────────────────────────────────
    let removalPending = $state<string | null>(null);
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressStartX = 0;
    let pressStartY = 0;
    let suppressNextClick = false;

    const LONG_PRESS_MS = 600;

    function startItemPress(e: PointerEvent, path: string) {
        if (removalPending) {
            removalPending = null;
            return;
        }
        pressStartX = e.clientX;
        pressStartY = e.clientY;
        suppressNextClick = false;
        pressTimer = setTimeout(() => {
            pressTimer = null;
            suppressNextClick = true;
            removalPending = path;
        }, LONG_PRESS_MS);
    }

    function cancelItemPress() {
        if (pressTimer !== null) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }

    function handleItemPointerMove(e: PointerEvent) {
        if (pressTimer === null || e.pointerType !== 'touch') return;
        const dx = e.clientX - pressStartX;
        const dy = e.clientY - pressStartY;
        if (Math.sqrt(dx * dx + dy * dy) > 8) cancelItemPress();
    }

    function handleItemClick(e: MouseEvent, item: MediaFile) {
        if (suppressNextClick) {
            suppressNextClick = false;
            return;
        }
        if (removalPending === item.path) {
            removalPending = null;
            return;
        }
        if (removalPending) {
            removalPending = null;
            return;
        }
        handleTap(item);
    }

    async function executeRemove(path: string) {
        removalPending = null;
        galleryStore.removeFavorite(path);
        orderedItems = orderedItems.filter((i) => i.path !== path);
        try {
            await favApi.remove(path);
        } catch {
            toastStore.error('Failed to remove from favorites');
        }
    }
</script>

<section class="favorites-strip" aria-label="Favorites">
    <div class="strip-header">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
            />
        </svg>
        <span>Favorites</span>
        {#if saving}
            <span class="strip-saving" aria-live="polite">saving…</span>
        {/if}
    </div>
    <div class="strip-scroll">
        {#each orderedItems as item, idx (item.path)}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
                class="strip-item"
                class:drag-over={overIndex === idx && dragIndex !== idx}
                class:dragging={dragIndex === idx}
                class:removal-pending={removalPending === item.path}
                role="img"
                aria-label={item.name}
                draggable="true"
                onpointerdown={(e) => startItemPress(e, item.path)}
                onpointermove={handleItemPointerMove}
                onpointerup={cancelItemPress}
                onpointercancel={cancelItemPress}
                onclick={(e) => handleItemClick(e, item)}
                ondragstart={(e) => {
                    removalPending = null;
                    handleDragStart(e, idx);
                }}
                ondragover={(e) => handleDragOver(e, idx)}
                ondragleave={handleDragLeave}
                ondrop={(e) => handleDrop(e, idx)}
                ondragend={handleDragEnd}
            >
                {#if item.thumbnailUrl && item.type !== 'playlist'}
                    <img src={item.thumbnailUrl} alt={item.name} loading="lazy" decoding="async" />
                {:else if item.type === 'playlist'}
                    <div class="strip-placeholder">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            aria-hidden="true"
                        >
                            <path
                                d="M15 10l4.553-2.069A1 1 0 0 1 21 8.82v6.36a1 1 0 0 1-1.447.89L15 14"
                            />
                            <rect x="2" y="6" width="13" height="12" rx="2" />
                        </svg>
                    </div>
                {:else}
                    <div class="strip-placeholder">
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path
                                d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
                            />
                        </svg>
                    </div>
                {/if}

                <!-- Name label for folders and playlists (no thumbnail to identify them) -->
                {#if item.type === 'folder' || item.type === 'playlist'}
                    <div class="strip-name" title={item.name}>{item.name}</div>
                {/if}

                <!-- Drag handle hint -->
                <div class="drag-handle" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="9" cy="7" r="1.5" /><circle cx="15" cy="7" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                        <circle cx="9" cy="17" r="1.5" /><circle cx="15" cy="17" r="1.5" />
                    </svg>
                </div>

                <!-- Long-press remove overlay -->
                {#if removalPending === item.path}
                    <!-- svelte-ignore a11y_autofocus -->
                    <button
                        class="remove-overlay"
                        autofocus
                        onclick={(e) => {
                            e.stopPropagation();
                            executeRemove(item.path);
                        }}
                        onblur={() => (removalPending = null)}
                        aria-label="Remove {item.name} from favorites"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                    </button>
                {/if}
            </div>
        {/each}
    </div>
</section>

<style>
    .favorites-strip {
        padding: var(--spacing-3) 0 0;
        border-bottom: 1px solid var(--color-border);
    }

    .strip-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        padding: 0 var(--spacing-4) var(--spacing-2);
        font-size: var(--text-sm);
        font-weight: 600;
        color: var(--color-text-muted);
    }

    .strip-header svg {
        width: 14px;
        height: 14px;
        color: #ffd700;
    }

    .strip-saving {
        font-size: var(--text-xs);
        font-weight: 400;
        color: var(--color-text-subtle);
        margin-left: auto;
    }

    .strip-scroll {
        display: flex;
        gap: 3px;
        overflow-x: auto;
        padding: 0 var(--spacing-4) var(--spacing-3);
        scrollbar-width: none;
        -ms-overflow-style: none;
    }

    .strip-scroll::-webkit-scrollbar {
        display: none;
    }

    .strip-item {
        flex-shrink: 0;
        width: 80px;
        height: 80px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        cursor: grab;
        background: var(--color-surface-2);
        transition:
            opacity var(--transition-fast),
            outline var(--transition-fast);
        position: relative;
    }

    .strip-item:hover {
        opacity: 0.85;
    }

    .strip-item.dragging {
        opacity: 0.4;
        cursor: grabbing;
    }

    .strip-item.drag-over {
        outline: 2px solid var(--color-primary);
    }

    .strip-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
    }

    .strip-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
        pointer-events: none;
    }

    .strip-placeholder svg {
        width: 28px;
        height: 28px;
        opacity: 0.4;
    }

    .strip-name {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 3px 4px 4px;
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
        font-size: 10px;
        line-height: 1.2;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        pointer-events: none;
    }

    .drag-handle {
        position: absolute;
        top: 2px;
        left: 50%;
        transform: translateX(-50%);
        opacity: 0;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 3px;
        padding: 1px 3px;
        transition: opacity var(--transition-fast);
        pointer-events: none;
    }

    .drag-handle svg {
        width: 10px;
        height: 10px;
        fill: rgba(255, 255, 255, 0.8);
        display: block;
    }

    .strip-item:hover .drag-handle {
        opacity: 1;
    }

    .remove-overlay {
        position: absolute;
        inset: 0;
        background: rgba(180, 0, 0, 0.82);
        border: none;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        z-index: 2;
        animation: fade-in-overlay 0.12s ease;
    }

    .remove-overlay svg {
        width: 22px;
        height: 22px;
        pointer-events: none;
    }

    .strip-item.removal-pending {
        outline: 2px solid rgba(200, 0, 0, 0.6);
    }

    @keyframes fade-in-overlay {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }
</style>
