<script lang="ts">
    import { collections as collectionsApi, ApiError } from '$lib/api/client';
    import { toastStore } from '$lib/stores/toast.svelte';
    import type { Collection } from '$lib/api/types';

    interface Props {
        /** One or more file paths to manage. Single-item: [path]. Bulk: [path, ...] */
        itemPaths: string[];
        onclose: () => void;
    }

    let { itemPaths, onclose }: Props = $props();

    let allCollections: Collection[] = $state([]);
    /** Collection IDs where ALL itemPaths are members. */
    let fullMemberIds = $state(new Set<number>());
    /** Collection IDs where SOME (but not all) itemPaths are members. */
    let partialMemberIds = $state(new Set<number>());
    let loading = $state(true);
    let toggling = $state(new Set<number>());

    async function load() {
        if (!itemPaths.length) return;
        loading = true;
        try {
            const [cols, memberships] = await Promise.all([
                collectionsApi.list(),
                collectionsApi.memberships(itemPaths)
            ]);
            allCollections = cols;
            computeMembership(memberships);
        } catch {
            toastStore.error('Failed to load collections');
        } finally {
            loading = false;
        }
    }

    function computeMembership(memberships: Record<string, number[]>) {
        // memberships maps path → [collectionId, ...]
        const full = new Set<number>();
        const partial = new Set<number>();
        for (const col of allCollections) {
            const memberCount = itemPaths.filter((p) =>
                (memberships[p] ?? []).includes(col.id)
            ).length;
            if (memberCount === itemPaths.length) full.add(col.id);
            else if (memberCount > 0) partial.add(col.id);
        }
        fullMemberIds = full;
        partialMemberIds = partial;
    }

    $effect(() => {
        if (itemPaths.length) load();
    });

    /** Extract the human-readable message from an ApiError whose body is JSON. */
    function apiErrorMessage(err: unknown): string | null {
        if (!(err instanceof ApiError)) return null;
        try {
            const body = JSON.parse(err.message) as { error?: string };
            return body.error ?? null;
        } catch {
            return null;
        }
    }

    async function toggle(col: Collection) {
        if (toggling.has(col.id)) return;
        toggling = new Set([...toggling, col.id]);

        const isFullMember = fullMemberIds.has(col.id);
        try {
            if (isFullMember) {
                // Remove all paths from this collection
                await collectionsApi.removeItems(col.id, itemPaths);
                const next = new Set(fullMemberIds);
                next.delete(col.id);
                fullMemberIds = next;
                const partial = new Set(partialMemberIds);
                partial.delete(col.id);
                partialMemberIds = partial;
            } else {
                // Add all paths not yet in the collection
                await collectionsApi.addItems(col.id, itemPaths);
                const full = new Set(fullMemberIds);
                full.add(col.id);
                fullMemberIds = full;
                const partial = new Set(partialMemberIds);
                partial.delete(col.id);
                partialMemberIds = partial;
            }
        } catch (err) {
            const specific = apiErrorMessage(err);
            toastStore.error(
                specific ?? `Failed to ${isFullMember ? 'remove from' : 'add to'} "${col.name}"`
            );
        } finally {
            const next = new Set(toggling);
            next.delete(col.id);
            toggling = next;
        }
    }

    let newColName = $state('');
    let creating = $state(false);

    async function createCollection() {
        const name = newColName.trim();
        if (!name || creating) return;
        creating = true;
        try {
            await collectionsApi.create(name, itemPaths);
            newColName = '';
            await load();
        } catch (err) {
            const specific = apiErrorMessage(err);
            toastStore.error(specific ?? 'Failed to create collection');
        } finally {
            creating = false;
        }
    }

    // Derive the folder of the current items (all items must share a folder for
    // collections to work, so we use the first path as a representative).
    const itemFolder = $derived(
        (() => {
            if (!itemPaths.length) return '';
            const p = itemPaths[0];
            const idx = p.lastIndexOf('/');
            return idx > 0 ? p.slice(0, idx) : '';
        })()
    );

    // Capture phase fires before +page.svelte's bubble-phase handler, so Escape closes
    // this panel instead of triggering the page's navigate-up or clear-selection logic.
    $effect(() => {
        function captureKeydown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                onclose();
            }
        }
        window.addEventListener('keydown', captureKeydown, true);
        return () => window.removeEventListener('keydown', captureKeydown, true);
    });

    // Only show collections that are folder-compatible with the current items.
    // `folderPath === undefined` means the collection has no folder constraint (DB NULL).
    // An empty-string folderPath means the collection belongs to the root folder; it
    // must NOT fall through the !col.folderPath guard because '' is falsy.
    const visibleCollections = $derived(
        allCollections.filter(
            (col) => col.folderPath === undefined || col.folderPath === itemFolder
        )
    );

    const isBulk = $derived(itemPaths.length > 1);
    const title = $derived(isBulk ? `Collections — ${itemPaths.length} items` : 'Collections');
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cp-backdrop" onclick={onclose}></div>

<div class="cp" role="dialog" aria-label={title} aria-modal="true">
    <div class="cp-header">
        <span class="cp-title">{title}</span>
        <button class="cp-close" onclick={onclose} aria-label="Close">
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

    <div class="cp-body">
        {#if loading}
            <div class="cp-state">Loading…</div>
        {:else if visibleCollections.length === 0}
            <div class="cp-state cp-state--empty">
                {allCollections.length === 0
                    ? 'No collections yet.'
                    : 'No collections in this folder.'}
            </div>
        {:else}
            <ul class="cp-list">
                {#each visibleCollections as col}
                    {@const isFull = fullMemberIds.has(col.id)}
                    {@const isPartial = partialMemberIds.has(col.id)}
                    {@const isToggling = toggling.has(col.id)}
                    <li>
                        <button
                            class="cp-item"
                            class:member={isFull}
                            class:partial={isPartial}
                            onclick={() => toggle(col)}
                            disabled={isToggling}
                            aria-pressed={isFull}
                            title={isPartial
                                ? 'Partially in collection — click to add remaining'
                                : undefined}
                        >
                            <span class="cp-check" aria-hidden="true">
                                {#if isFull}
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2.5"
                                    >
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                {:else if isPartial}
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2.5"
                                    >
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                    </svg>
                                {/if}
                            </span>
                            <span class="cp-name">{col.name}</span>
                            <span class="cp-count">{col.itemCount}</span>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>

    <div class="cp-footer">
        <input
            type="text"
            class="cp-input"
            placeholder="New collection…"
            bind:value={newColName}
            onkeydown={(e) => e.key === 'Enter' && createCollection()}
            disabled={creating}
            aria-label="New collection name"
        />
        <button
            class="cp-create"
            onclick={createCollection}
            disabled={creating || !newColName.trim()}
            aria-label="Create collection"
        >
            {creating ? '…' : 'Create'}
        </button>
    </div>
</div>

<style>
    .cp-backdrop {
        position: fixed;
        inset: 0;
        z-index: 310;
    }

    .cp {
        position: fixed;
        top: 60px;
        right: var(--spacing-3);
        z-index: 311;
        width: min(280px, calc(100vw - 32px));
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 80px);
        overflow: hidden;
    }

    .cp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-2) var(--spacing-3);
        border-bottom: 1px solid var(--color-border);
    }

    .cp-title {
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--color-text);
    }

    .cp-close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        border-radius: var(--radius-sm);
    }

    .cp-close svg {
        width: 14px;
        height: 14px;
    }
    .cp-close:hover {
        color: var(--color-text);
    }

    .cp-body {
        overflow-y: auto;
        flex: 1;
    }

    .cp-state {
        padding: var(--spacing-4);
        text-align: center;
        font-size: var(--text-sm);
        color: var(--color-text-muted);
    }

    .cp-list {
        list-style: none;
        padding: var(--spacing-1);
    }

    .cp-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        width: 100%;
        background: none;
        border: none;
        cursor: pointer;
        padding: var(--spacing-2) var(--spacing-2);
        border-radius: var(--radius-md);
        text-align: left;
        transition: background var(--transition-fast);
        color: var(--color-text);
    }

    .cp-item:hover:not(:disabled) {
        background: var(--color-surface-2);
    }
    .cp-item:disabled {
        opacity: 0.6;
        cursor: wait;
    }

    .cp-check {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-primary);
    }

    .cp-check svg {
        width: 16px;
        height: 16px;
    }

    .cp-item.partial .cp-check {
        color: var(--color-text-muted);
    }

    .cp-name {
        flex: 1;
        font-size: var(--text-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .cp-count {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        flex-shrink: 0;
    }

    .cp-state--empty {
        padding-bottom: 0;
    }

    .cp-footer {
        display: flex;
        gap: var(--spacing-2);
        padding: var(--spacing-2) var(--spacing-2);
        border-top: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .cp-input {
        flex: 1;
        min-width: 0;
        padding: var(--spacing-1) var(--spacing-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface-2);
        color: var(--color-text);
        font-size: var(--text-sm);
        outline: none;
    }

    .cp-input:focus {
        border-color: var(--color-primary);
    }
    .cp-input:disabled {
        opacity: 0.5;
    }

    .cp-create {
        flex-shrink: 0;
        padding: var(--spacing-1) var(--spacing-3);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-primary);
        background: var(--color-primary);
        color: #fff;
        font-size: var(--text-sm);
        cursor: pointer;
        font-weight: 500;
    }

    .cp-create:hover:not(:disabled) {
        opacity: 0.9;
    }
    .cp-create:disabled {
        opacity: 0.4;
        cursor: default;
    }
</style>
