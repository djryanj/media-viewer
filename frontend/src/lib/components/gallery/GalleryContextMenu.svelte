<script lang="ts">
    import { tags as tagsApi } from '$lib/api/client';
    import type { MediaFile } from '$lib/api/types';
    import TagEditor from '$lib/components/ui/TagEditor.svelte';
    import { toastStore } from '$lib/stores/toast.svelte';

    let {
        item,
        onclose,
        ontogglefavorite,
        onselect
    }: {
        item: MediaFile;
        onclose: () => void;
        ontogglefavorite: (item: MediaFile) => void;
        onselect: (item: MediaFile) => void;
    } = $props();

    const isFolder = $derived(item.type === 'folder');
    const isPlaylist = $derived(item.type === 'playlist');
    const canDownload = $derived(!isFolder && !isPlaylist);
    const canTagOrSelect = $derived(!isFolder && !isPlaylist);

    // ── Tag editing sub-panel ─────────────────────────────────────────────────
    let tagEditing = $state(false);
    let itemTags = $state<string[]>([]);
    let tagsLoading = $state(false);

    async function openTagEditor() {
        tagEditing = true;
        tagsLoading = true;
        try {
            itemTags = await tagsApi.getForFile(item.path);
        } catch {
            itemTags = [];
        } finally {
            tagsLoading = false;
        }
    }

    async function handleTagsChange(newTags: string[]) {
        itemTags = newTags;
        try {
            await tagsApi.setForFile(item.path, newTags);
        } catch {
            toastStore.error('Failed to save tags');
        }
    }

    // Per-segment URL encoding so path separators stay as /
    function encodedPath(path: string) {
        return path.split('/').map(encodeURIComponent).join('/');
    }

    function handleOverlayClick(e: MouseEvent) {
        if (e.target === e.currentTarget) onclose();
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            if (tagEditing) {
                tagEditing = false;
            } else {
                onclose();
            }
        }
    }
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- Backdrop -->
<div class="overlay" role="presentation" onclick={handleOverlayClick}>
    <!-- Bottom sheet -->
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Options for {item.name}">
        <div class="handle" aria-hidden="true"></div>

        <header class="sheet-header">
            <span class="item-name" title={item.name}>{item.name}</span>
        </header>

        {#if tagEditing}
            <!-- Tag editor sub-panel -->
            <div class="tag-panel">
                <button class="back-btn" type="button" onclick={() => (tagEditing = false)}>
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        aria-hidden="true"
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Back
                </button>
                {#if tagsLoading}
                    <p class="tag-loading">Loading tags…</p>
                {:else}
                    <TagEditor tags={itemTags} onchange={handleTagsChange} />
                {/if}
            </div>
        {:else}
            <ul class="menu-list" role="list">
                {#if canDownload}
                    <li>
                        <a
                            class="menu-action"
                            href="/api/files/{encodedPath(item.path)}?download=true"
                            download={item.name}
                            onclick={onclose}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                aria-hidden="true"
                            >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Download
                        </a>
                    </li>
                {/if}

                <li>
                    <button
                        class="menu-action"
                        class:favorited={item.isFavorite}
                        type="button"
                        onclick={() => {
                            ontogglefavorite(item);
                            onclose();
                        }}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill={item.isFavorite ? 'currentColor' : 'none'}
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <polygon
                                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                            />
                        </svg>
                        {item.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                    </button>
                </li>

                {#if canTagOrSelect}
                    <li>
                        <button class="menu-action" type="button" onclick={openTagEditor}>
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
                            Tags
                        </button>
                    </li>
                {/if}

                {#if canTagOrSelect}
                    <li>
                        <button
                            class="menu-action"
                            type="button"
                            onclick={() => {
                                onselect(item);
                                onclose();
                            }}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                aria-hidden="true"
                            >
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                <polyline points="9 11 12 14 22 4" />
                            </svg>
                            Select
                        </button>
                    </li>
                {/if}
            </ul>
        {/if}

        <button class="cancel-btn" type="button" onclick={onclose}>Cancel</button>
    </div>
</div>

<style>
    .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        z-index: 500;
        display: flex;
        align-items: flex-end;
        animation: fade-in 0.15s ease;
        /* Prevent scroll on the gallery behind while menu is open */
        touch-action: none;
    }

    .sheet {
        width: 100%;
        background: var(--color-surface-2);
        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        padding-bottom: max(12px, env(safe-area-inset-bottom));
        animation: slide-up 0.22s cubic-bezier(0.32, 0.72, 0, 1);
        max-height: 85dvh;
        overflow-y: auto;
    }

    .handle {
        width: 36px;
        height: 4px;
        background: var(--color-border);
        border-radius: 2px;
        margin: 10px auto 14px;
    }

    .sheet-header {
        padding: 0 20px 14px;
        border-bottom: 1px solid var(--color-border);
    }

    .item-name {
        display: block;
        font-weight: 600;
        font-size: 0.95rem;
        color: var(--color-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .menu-list {
        list-style: none;
        margin: 0;
        padding: 6px 0;
    }

    .menu-action {
        display: flex;
        align-items: center;
        gap: 16px;
        width: 100%;
        padding: 14px 20px;
        background: none;
        border: none;
        border-bottom: 1px solid var(--color-border);
        color: var(--color-text);
        font-size: 1rem;
        text-align: left;
        text-decoration: none;
        cursor: pointer;
        min-height: 52px;
        transition: background var(--transition-fast);
    }

    .menu-list li:last-child .menu-action {
        border-bottom: none;
    }

    .menu-action:active {
        background: var(--color-surface-3);
    }

    .menu-action svg {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
    }

    .menu-action.favorited {
        color: #ffd700;
    }

    .cancel-btn {
        display: block;
        width: calc(100% - 32px);
        margin: 10px 16px 4px;
        padding: 14px;
        background: var(--color-surface-3);
        border: none;
        border-radius: var(--radius-md);
        color: var(--color-text);
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        min-height: 52px;
        transition: opacity var(--transition-fast);
    }

    .cancel-btn:active {
        opacity: 0.7;
    }

    /* Tag sub-panel */
    .tag-panel {
        padding: 8px 16px 4px;
    }

    .back-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: none;
        border: none;
        color: var(--color-primary);
        font-size: 1rem;
        cursor: pointer;
        padding: 8px 0 12px;
        margin-bottom: 4px;
    }

    .back-btn svg {
        width: 18px;
        height: 18px;
    }

    .tag-loading {
        color: var(--color-text-muted);
        padding: 20px 0;
        text-align: center;
        margin: 0;
    }

    @keyframes fade-in {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    @keyframes slide-up {
        from {
            transform: translateY(100%);
        }
        to {
            transform: translateY(0);
        }
    }
</style>
