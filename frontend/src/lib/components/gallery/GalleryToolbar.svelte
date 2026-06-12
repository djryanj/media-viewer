<script lang="ts">
    import { galleryStore, type TypeFilter } from '$lib/stores/gallery.svelte';
    import { favorites, tags } from '$lib/api/client';
    import { toastStore } from '$lib/stores/toast.svelte';
    import { tagClipboard } from '$lib/stores/tagClipboard.svelte';
    import TagEditor from '$lib/components/ui/TagEditor.svelte';
    import CollectionsPanel from '$lib/components/lightbox/CollectionsPanel.svelte';

    const typeFilters: { value: TypeFilter; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'folder', label: 'Folders' },
        { value: 'image', label: 'Images' },
        { value: 'video', label: 'Videos' },
        { value: 'playlist', label: 'Playlists' }
    ];

    let sortOpen = $state(false);
    let tagPanelOpen = $state(false);
    let collectionsPanelOpen = $state(false);

    const selectedPaths = $derived(galleryStore.getSelectedItems().map((i) => i.path));
    let bulkTagValue: string[] = $state([]);

    const sortOptions = [
        { field: 'name' as const, order: 'asc' as const, label: 'Name (A–Z)' },
        { field: 'name' as const, order: 'desc' as const, label: 'Name (Z–A)' },
        { field: 'date' as const, order: 'desc' as const, label: 'Newest first' },
        { field: 'date' as const, order: 'asc' as const, label: 'Oldest first' },
        { field: 'size' as const, order: 'desc' as const, label: 'Largest first' },
        { field: 'size' as const, order: 'asc' as const, label: 'Smallest first' }
    ];

    const currentSortLabel = $derived(
        sortOptions.find((o) => o.field === galleryStore.sort && o.order === galleryStore.order)
            ?.label ?? 'Sort'
    );

    function openTagModal() {
        // Pre-populate with union of all selected items' existing tags
        const selected = galleryStore.getSelectedItems();
        const union = [...new Set(selected.flatMap((i) => i.tags ?? []))];
        bulkTagValue = union;
        tagPanelOpen = true;
    }

    async function bulkApplyTag(tag: string) {
        const paths = galleryStore.getSelectedItems().map((i) => i.path);
        if (!paths.length) return;
        try {
            await tags.bulkAdd({ paths, tag });
            galleryStore.getSelectedItems().forEach((item) => {
                const existing = item.tags ?? [];
                if (!existing.includes(tag)) {
                    galleryStore.updateItem(item.path, { tags: [...existing, tag] });
                }
            });
        } catch {
            toastStore.error(`Failed to apply tag "${tag}"`);
        }
    }

    async function bulkRemoveTag(tag: string) {
        const paths = galleryStore.getSelectedItems().map((i) => i.path);
        if (!paths.length) return;
        try {
            await tags.bulkRemove({ paths, tag });
            galleryStore.getSelectedItems().forEach((item) => {
                const existing = item.tags ?? [];
                galleryStore.updateItem(item.path, { tags: existing.filter((t) => t !== tag) });
            });
        } catch {
            toastStore.error(`Failed to remove tag "${tag}"`);
        }
    }

    async function handleBulkTagChange(next: string[]) {
        const added = next.filter((t) => !bulkTagValue.includes(t));
        const removed = bulkTagValue.filter((t) => !next.includes(t));
        bulkTagValue = next;
        for (const tag of added) await bulkApplyTag(tag);
        for (const tag of removed) await bulkRemoveTag(tag);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (!galleryStore.selectionMode) return;
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
            return;
        if (e.key === 't' || e.key === 'T') {
            e.preventDefault();
            if (tagPanelOpen) tagPanelOpen = false;
            else openTagModal();
        }
        if (e.key === 'Escape') {
            if (tagPanelOpen) tagPanelOpen = false;
            else if (collectionsPanelOpen) collectionsPanelOpen = false;
            else galleryStore.clearSelection();
        }
    }

    async function bulkPasteTags() {
        const items = galleryStore.getSelectedItems();
        if (!items.length || !tagClipboard.hasContent) return;
        let totalAdded = 0;
        const errors: string[] = [];
        await Promise.all(
            items.map(async (item) => {
                const merged = tagClipboard.merge(item.tags ?? []);
                const added = merged.length - (item.tags?.length ?? 0);
                if (added === 0) return;
                try {
                    await tags.setForFile(item.path, merged);
                    galleryStore.updateItem(item.path, { tags: merged });
                    totalAdded += added;
                } catch {
                    errors.push(item.name);
                }
            })
        );
        if (errors.length) {
            toastStore.error(`Failed to paste tags to: ${errors.slice(0, 2).join(', ')}`);
        } else if (totalAdded > 0) {
            toastStore.success(`Pasted tags to ${items.length} item(s)`);
        } else {
            toastStore.success('Tags already up to date');
        }
    }

    async function bulkFavorite() {
        const items = galleryStore.getSelectedItems();
        if (!items.length) return;
        try {
            await favorites.bulkAdd(
                items.map((i) => ({ path: i.path, name: i.name, type: i.type }))
            );
            items.forEach((i) => {
                galleryStore.updateItem(i.path, { isFavorite: true });
                galleryStore.addFavorite(i);
            });
            toastStore.success(`Added ${items.length} item(s) to favorites`);
            galleryStore.clearSelection();
        } catch {
            toastStore.error('Failed to add favorites');
        }
    }

    async function bulkUnfavorite() {
        const items = galleryStore.getSelectedItems();
        if (!items.length) return;
        try {
            await favorites.bulkRemove(items.map((i) => i.path));
            items.forEach((i) => {
                galleryStore.updateItem(i.path, { isFavorite: false });
                galleryStore.removeFavorite(i.path);
            });
            toastStore.success(`Removed ${items.length} item(s) from favorites`);
            galleryStore.clearSelection();
        } catch {
            toastStore.error('Failed to remove favorites');
        }
    }
</script>

<div class="toolbar">
    {#if galleryStore.selectionMode}
        <!-- Selection mode toolbar -->
        <div class="selection-bar">
            <span class="sel-count">{galleryStore.selectedCount} selected</span>
            <div class="sel-actions">
                <button class="tb-btn" onclick={galleryStore.selectAll}>All</button>
                <button
                    class="tb-btn"
                    class:active={collectionsPanelOpen}
                    onclick={() => (collectionsPanelOpen = !collectionsPanelOpen)}
                    aria-label="Add to collection"
                    aria-pressed={collectionsPanelOpen}
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                    Collections
                </button>
                <button
                    class="tb-btn"
                    class:active={tagPanelOpen}
                    onclick={() => {
                        if (tagPanelOpen) tagPanelOpen = false;
                        else openTagModal();
                    }}
                    aria-label="Tag selected"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <path
                            d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
                        />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                    Tag
                </button>
                {#if tagClipboard.hasContent}
                    <button
                        class="tb-btn paste-btn"
                        onclick={bulkPasteTags}
                        aria-label="Paste tags to selected"
                        title="Paste {tagClipboard.tags.length} tag(s) to selected items"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <path
                                d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                            />
                            <rect x="8" y="2" width="8" height="4" rx="1" />
                        </svg>
                        Paste Tags
                    </button>
                {/if}
                <button class="tb-btn" onclick={bulkFavorite} aria-label="Add to favorites">
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <polygon
                            points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                        />
                    </svg>
                </button>
                <button class="tb-btn" onclick={bulkUnfavorite} aria-label="Remove from favorites">
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
                <button class="tb-btn cancel" onclick={galleryStore.clearSelection}>Cancel</button>
            </div>
        </div>
    {:else}
        <!-- Default toolbar -->
        <div class="default-bar">
            <!-- Type filter chips -->
            <div class="type-filters" role="group" aria-label="Filter by type">
                {#each typeFilters as f}
                    <button
                        class="filter-chip"
                        class:active={galleryStore.typeFilter === f.value}
                        onclick={() => galleryStore.setTypeFilter(f.value)}
                        aria-pressed={galleryStore.typeFilter === f.value}>{f.label}</button
                    >
                {/each}
            </div>

            <div class="tb-right">
                <!-- Sort dropdown -->
                <div class="sort-wrap">
                    <button
                        class="tb-btn sort-btn"
                        onclick={() => (sortOpen = !sortOpen)}
                        aria-expanded={sortOpen}
                        aria-haspopup="listbox"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="15" y2="12" />
                            <line x1="3" y1="18" x2="9" y2="18" />
                        </svg>
                        {currentSortLabel}
                    </button>

                    {#if sortOpen}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div class="sort-backdrop" onclick={() => (sortOpen = false)}></div>
                        <ul class="sort-menu" role="listbox" aria-label="Sort options">
                            {#each sortOptions as opt}
                                <li
                                    role="option"
                                    aria-selected={opt.field === galleryStore.sort &&
                                        opt.order === galleryStore.order}
                                >
                                    <button
                                        class="sort-option"
                                        class:active={opt.field === galleryStore.sort &&
                                            opt.order === galleryStore.order}
                                        onclick={() => {
                                            galleryStore.setSort(opt.field, opt.order);
                                            sortOpen = false;
                                        }}>{opt.label}</button
                                    >
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>
            </div>
        </div>
    {/if}
</div>

<svelte:window onkeydown={handleKeydown} />

{#if tagPanelOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tag-modal-backdrop" onclick={() => (tagPanelOpen = false)}></div>
    <div class="tag-modal" role="dialog" aria-modal="true" aria-label="Tag selected items">
        <div class="tag-modal-header">
            <span class="tag-modal-title">Tags — {galleryStore.selectedCount} item(s)</span>
            <button
                class="tag-modal-close"
                onclick={() => (tagPanelOpen = false)}
                aria-label="Close"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>
        <div class="tag-modal-body">
            <TagEditor tags={bulkTagValue} onchange={handleBulkTagChange} />
        </div>
    </div>
{/if}

{#if collectionsPanelOpen && selectedPaths.length > 0}
    <CollectionsPanel itemPaths={selectedPaths} onclose={() => (collectionsPanelOpen = false)} />
{/if}

<style>
    .toolbar {
        position: sticky;
        top: 0;
        z-index: 50;
        background: var(--color-bg);
        border-bottom: 1px solid var(--color-border);
    }

    .default-bar,
    .selection-bar {
        display: flex;
        align-items: center;
        padding: var(--spacing-2) var(--spacing-4);
        gap: var(--spacing-3);
        min-height: 44px;
    }

    .type-filters {
        display: flex;
        align-items: center;
        gap: var(--spacing-1);
        flex-wrap: wrap;
        flex: 1;
    }

    .filter-chip {
        background: none;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        color: var(--color-text-muted);
        cursor: pointer;
        font-size: var(--text-xs);
        padding: 2px var(--spacing-2);
        transition:
            color var(--transition-fast),
            background var(--transition-fast),
            border-color var(--transition-fast);
        white-space: nowrap;
    }

    .filter-chip:hover {
        color: var(--color-text);
        background: var(--color-surface-2);
    }

    .filter-chip.active {
        background: color-mix(in srgb, var(--color-primary) 15%, transparent);
        border-color: var(--color-primary);
        color: var(--color-primary);
        font-weight: 500;
    }

    .sel-count {
        color: var(--color-text);
        font-weight: 500;
    }

    .tb-right,
    .sel-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
    }

    .tb-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-1);
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text);
        cursor: pointer;
        font-size: var(--text-sm);
        padding: var(--spacing-1) var(--spacing-3);
        height: 32px;
        transition: background var(--transition-fast);
        white-space: nowrap;
    }

    .tb-btn:hover {
        background: var(--color-surface-3);
    }

    .tb-btn svg {
        width: 15px;
        height: 15px;
    }

    .tb-btn.cancel {
        color: var(--color-text-muted);
    }

    .paste-btn {
        color: var(--color-primary);
        border-color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    }

    .paste-btn:hover {
        background: color-mix(in srgb, var(--color-primary) 20%, transparent);
    }

    .tb-btn.active {
        background: color-mix(in srgb, var(--color-primary) 15%, transparent);
        border-color: var(--color-primary);
        color: var(--color-primary);
    }

    /* Bulk tag modal */
    .tag-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 200;
        background: rgba(0, 0, 0, 0.5);
    }

    .tag-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 201;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        width: min(480px, calc(100vw - 32px));
        display: flex;
        flex-direction: column;
    }

    .tag-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-3) var(--spacing-4);
        border-bottom: 1px solid var(--color-border);
    }

    .tag-modal-title {
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--color-text);
    }

    .tag-modal-close {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        padding: var(--spacing-1);
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast);
    }

    .tag-modal-close:hover {
        color: var(--color-text);
    }

    .tag-modal-close svg {
        width: 16px;
        height: 16px;
    }

    .tag-modal-body {
        padding: var(--spacing-4);
    }

    /* Sort dropdown */
    .sort-wrap {
        position: relative;
    }

    .sort-backdrop {
        position: fixed;
        inset: 0;
        z-index: 90;
    }

    .sort-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        z-index: 95;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-md);
        list-style: none;
        min-width: 160px;
        overflow: hidden;
    }

    .sort-option {
        display: block;
        width: 100%;
        background: none;
        border: none;
        cursor: pointer;
        padding: var(--spacing-3) var(--spacing-4);
        font-size: var(--text-sm);
        color: var(--color-text);
        text-align: left;
        transition: background var(--transition-fast);
    }

    .sort-option:hover {
        background: var(--color-surface-2);
    }

    .sort-option.active {
        color: var(--color-primary);
        font-weight: 500;
    }
</style>
