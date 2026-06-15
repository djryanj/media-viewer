<script lang="ts">
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { collections as collectionsApi } from '$lib/api/client';
    import type { CollectionDetail, MediaFile } from '$lib/api/types';
    import Gallery from '$lib/components/gallery/Gallery.svelte';
    import { toastStore } from '$lib/stores/toast.svelte';

    const id = $derived(Number($page.params.id));
    let detail = $state<CollectionDetail | null>(null);
    let loading = $state(true);
    let error = $state('');

    // Rename state
    let renaming = $state(false);
    let renameValue = $state('');

    function startRename() {
        if (!detail) return;
        renameValue = detail.name;
        renaming = true;
    }

    async function submitRename() {
        const name = renameValue.trim();
        if (!name || !detail) return;
        try {
            await collectionsApi.rename(id, name);
            detail = { ...detail, name };
            renaming = false;
        } catch {
            toastStore.error('Failed to rename collection');
        }
    }

    // Reorder state
    let reorderMode = $state(false);
    let reorderedItems = $state<MediaFile[]>([]);
    let savingOrder = $state(false);
    let dragFromIdx = $state(-1);
    let dragOverIdx = $state(-1);

    onMount(async () => {
        try {
            detail = await collectionsApi.get(id);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            error = msg || 'Failed to load album';
        } finally {
            loading = false;
        }
    });

    function enterReorder() {
        reorderedItems = [...(detail?.items ?? [])];
        reorderMode = true;
    }

    function cancelReorder() {
        reorderMode = false;
        reorderedItems = [];
        dragFromIdx = -1;
        dragOverIdx = -1;
    }

    async function saveOrder() {
        if (!detail) return;
        savingOrder = true;
        try {
            await collectionsApi.reorder(
                id,
                reorderedItems.map((i) => i.path)
            );
            detail = { ...detail, items: reorderedItems };
            reorderMode = false;
        } catch {
            toastStore.error('Failed to save order');
        } finally {
            savingOrder = false;
        }
    }

    function moveItem(fromIdx: number, toIdx: number) {
        const arr = [...reorderedItems];
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, moved);
        reorderedItems = arr;
    }

    // HTML5 drag-and-drop handlers
    function handleDragStart(e: DragEvent, idx: number) {
        dragFromIdx = idx;
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(e: DragEvent, idx: number) {
        e.preventDefault();
        dragOverIdx = idx;
    }

    function handleDrop(e: DragEvent, dropIdx: number) {
        e.preventDefault();
        if (dragFromIdx === -1 || dragFromIdx === dropIdx) {
            dragFromIdx = -1;
            dragOverIdx = -1;
            return;
        }
        moveItem(dragFromIdx, dropIdx);
        dragFromIdx = -1;
        dragOverIdx = -1;
    }

    function handleDragEnd() {
        dragFromIdx = -1;
        dragOverIdx = -1;
    }
</script>

<svelte:head>
    <title>{detail?.name ?? 'Album'} — Media Viewer</title>
</svelte:head>

<div class="page-header">
    <button class="back-btn" onclick={() => history.back()} aria-label="Back">
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    </button>
    {#if detail}
        {#if renaming}
            <form
                class="rename-form"
                onsubmit={(e) => {
                    e.preventDefault();
                    submitRename();
                }}
            >
                <input
                    class="rename-input"
                    type="text"
                    bind:value={renameValue}
                    aria-label="Collection name"
                    maxlength="100"
                />
                <button class="action-btn action-btn--save" type="submit">Save</button>
                <button
                    class="action-btn action-btn--cancel"
                    type="button"
                    onclick={() => (renaming = false)}>Cancel</button
                >
            </form>
        {:else}
            <h2 class="page-title">{detail.name}</h2>
            <span class="page-count">{detail.items.length} items</span>
            {#if !reorderMode}
                <button
                    class="action-btn icon-btn"
                    onclick={startRename}
                    aria-label="Rename collection"
                    title="Rename"
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
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                </button>
                {#if detail.items.length > 1}
                    <button class="action-btn" onclick={enterReorder}>Reorder</button>
                {/if}
            {:else}
                <button
                    class="action-btn action-btn--cancel"
                    onclick={cancelReorder}
                    disabled={savingOrder}>Cancel</button
                >
                <button
                    class="action-btn action-btn--save"
                    onclick={saveOrder}
                    disabled={savingOrder}
                >
                    {savingOrder ? 'Saving…' : 'Save'}
                </button>
            {/if}
        {/if}
    {/if}
</div>

{#if loading}
    <div class="state-msg"><div class="spinner"></div></div>
{:else if error}
    <div class="state-msg error">{error}</div>
{:else if detail?.items.length === 0}
    <div class="state-msg">This album is empty.</div>
{:else if reorderMode}
    <ul class="reorder-list" role="listbox" aria-label="Drag to reorder items">
        {#each reorderedItems as item, idx}
            <li
                class="reorder-item"
                class:drag-over={dragOverIdx === idx && dragFromIdx !== idx}
                class:dragging={dragFromIdx === idx}
                draggable="true"
                ondragstart={(e) => handleDragStart(e, idx)}
                ondragover={(e) => handleDragOver(e, idx)}
                ondrop={(e) => handleDrop(e, idx)}
                ondragend={handleDragEnd}
            >
                <span class="drag-handle" aria-hidden="true" title="Drag to reorder">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                        <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                        <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                    </svg>
                </span>

                {#if item.thumbnailUrl}
                    <img
                        class="reorder-thumb"
                        src={item.thumbnailUrl}
                        alt={item.name}
                        loading="lazy"
                    />
                {:else}
                    <div class="reorder-thumb reorder-thumb--placeholder" aria-hidden="true"></div>
                {/if}

                <span class="reorder-name">{item.name}</span>

                <div class="move-btns">
                    <button
                        class="move-btn"
                        onclick={() => moveItem(idx, idx - 1)}
                        disabled={idx === 0}
                        aria-label="Move up"
                        title="Move up"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <polyline points="18 15 12 9 6 15" />
                        </svg>
                    </button>
                    <button
                        class="move-btn"
                        onclick={() => moveItem(idx, idx + 1)}
                        disabled={idx === reorderedItems.length - 1}
                        aria-label="Move down"
                        title="Move down"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </button>
                </div>
            </li>
        {/each}
    </ul>
{:else if detail}
    <Gallery items={detail.items} externalScroll />
{/if}

<style>
    .page-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        padding: var(--spacing-3) var(--spacing-4) var(--spacing-2);
        flex-wrap: nowrap;
    }

    .back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: var(--radius-full);
        border: none;
        background: transparent;
        color: var(--color-text);
        cursor: pointer;
        flex-shrink: 0;
    }

    .back-btn:hover {
        background: var(--color-surface-2);
    }
    .back-btn svg {
        width: 20px;
        height: 20px;
    }

    .page-title {
        font-size: var(--text-xl);
        font-weight: 700;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .page-count {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
        flex-shrink: 0;
    }

    .rename-form {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        flex: 1;
        min-width: 0;
    }

    .rename-input {
        flex: 1;
        min-width: 0;
        padding: var(--spacing-1) var(--spacing-2);
        background: var(--color-surface);
        border: 1px solid var(--color-primary);
        border-radius: var(--radius-md);
        color: var(--color-text);
        font-size: var(--text-base);
        font-weight: 700;
        outline: none;
    }

    .action-btn {
        flex-shrink: 0;
        padding: var(--spacing-1) var(--spacing-3);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
        background: var(--color-surface-2);
        color: var(--color-text);
        font-size: var(--text-sm);
        cursor: pointer;
    }

    .icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
    }

    .icon-btn svg {
        width: 15px;
        height: 15px;
    }

    .action-btn:hover:not(:disabled) {
        background: var(--color-surface-3);
    }
    .action-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .action-btn--save {
        background: var(--color-primary);
        color: #fff;
        border-color: var(--color-primary);
    }

    .action-btn--save:hover:not(:disabled) {
        opacity: 0.9;
        background: var(--color-primary);
    }

    .action-btn--cancel {
        color: var(--color-text-muted);
    }

    /* Reorder list */
    .reorder-list {
        list-style: none;
        padding: var(--spacing-2) var(--spacing-4);
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 640px;
    }

    .reorder-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        padding: var(--spacing-2);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        cursor: grab;
        transition:
            background var(--transition-fast),
            opacity var(--transition-fast);
        user-select: none;
    }

    .reorder-item:hover {
        background: var(--color-surface-2);
    }

    .reorder-item.dragging {
        opacity: 0.4;
        cursor: grabbing;
    }

    .reorder-item.drag-over {
        border-color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
    }

    .drag-handle {
        color: var(--color-text-muted);
        cursor: grab;
        flex-shrink: 0;
        display: flex;
        align-items: center;
    }

    .reorder-thumb {
        width: 64px;
        height: 64px;
        object-fit: cover;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
        background: var(--color-surface-2);
    }

    .reorder-thumb--placeholder {
        background: var(--color-surface-3);
    }

    .reorder-name {
        flex: 1;
        font-size: var(--text-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .move-btns {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex-shrink: 0;
    }

    .move-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 22px;
        border: none;
        background: none;
        color: var(--color-text-muted);
        cursor: pointer;
        border-radius: var(--radius-sm);
    }

    .move-btn:hover:not(:disabled) {
        background: var(--color-surface-3);
        color: var(--color-text);
    }
    .move-btn:disabled {
        opacity: 0.25;
        cursor: default;
    }
    .move-btn svg {
        width: 14px;
        height: 14px;
    }

    /* Common */
    .state-msg {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        color: var(--color-text-muted);
        font-size: var(--text-sm);
    }

    .state-msg.error {
        color: var(--color-danger);
    }

    .spinner {
        width: 28px;
        height: 28px;
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
