<script lang="ts">
    import { tags as tagsApi } from '$lib/api/client';
    import { toastStore } from '$lib/stores/toast.svelte';
    import { galleryStore } from '$lib/stores/gallery.svelte';

    interface Props {
        onclose: () => void;
    }

    let { onclose }: Props = $props();

    const items = $derived(galleryStore.getSelectedItems().filter((i) => i.type !== 'folder'));
    const paths = $derived(items.map((i) => i.path));

    // tag → number of selected items that already have it
    let tagCounts = $state(new Map<string, number>());
    // which tags are checked for application
    let selected = $state(new Set<string>());
    let newTagInput = $state('');
    let loading = $state(true);
    let applying = $state(false);

    $effect(() => {
        if (paths.length) load(paths);
    });

    async function load(currentPaths: string[]) {
        loading = true;
        try {
            const byPath = await tagsApi.getBatch(currentPaths);
            const counts = new Map<string, number>();
            for (const path of currentPaths) {
                for (const tag of byPath[path] ?? []) {
                    counts.set(tag, (counts.get(tag) ?? 0) + 1);
                }
            }
            tagCounts = counts;
            selected = new Set(counts.keys());
        } catch {
            toastStore.error('Failed to load tags');
        } finally {
            loading = false;
        }
    }

    function toggleTag(tag: string) {
        const next = new Set(selected);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        selected = next;
    }

    function addNewTag() {
        const name = newTagInput.trim().toLowerCase();
        if (!name) return;
        if (!tagCounts.has(name)) {
            const next = new Map(tagCounts);
            next.set(name, 0);
            tagCounts = next;
        }
        const next = new Set(selected);
        next.add(name);
        selected = next;
        newTagInput = '';
    }

    async function apply() {
        if (selected.size === 0) {
            toastStore.error('No tags selected');
            return;
        }
        applying = true;
        try {
            await tagsApi.bulkAdd({ paths, tags: [...selected] });
            // Patch galleryStore so chips update immediately
            for (const item of items) {
                const existing = new Set(item.tags ?? []);
                for (const t of selected) existing.add(t);
                galleryStore.updateItem(item.path, { tags: [...existing] });
            }
            const n = selected.size;
            toastStore.success(
                `Merged ${n} tag${n !== 1 ? 's' : ''} into ${paths.length} item${paths.length !== 1 ? 's' : ''}`
            );
            onclose();
        } catch {
            toastStore.error('Failed to merge tags');
        } finally {
            applying = false;
        }
    }

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

    const sortedTags = $derived(
        [...tagCounts.entries()].sort((a, b) => {
            // Partial tags (not on all items) sorted after full tags; within each group alphabetical
            const aPartial = a[1] < paths.length && a[1] > 0;
            const bPartial = b[1] < paths.length && b[1] > 0;
            const aNew = a[1] === 0;
            const bNew = b[1] === 0;
            if (aNew !== bNew) return aNew ? 1 : -1;
            if (aPartial !== bPartial) return aPartial ? 1 : -1;
            return a[0].localeCompare(b[0]);
        })
    );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mt-backdrop" onclick={onclose}></div>

<div class="mt" role="dialog" aria-modal="true" aria-label="Merge Tags">
    <div class="mt-header">
        <svg
            class="mt-header-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
        >
            <path d="M8 6l4-4 4 4" />
            <path d="M12 2v10.3" />
            <path d="M8 18l4 4 4-4" />
            <path d="M12 21.7V11.7" />
            <path d="M3 12h4" />
            <path d="M17 12h4" />
        </svg>
        <span class="mt-title">Merge Tags — {paths.length} items</span>
        <button class="mt-close" onclick={onclose} aria-label="Close">
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

    <div class="mt-body">
        {#if loading}
            <div class="mt-state">Loading…</div>
        {:else}
            <p class="mt-description">
                Select tags to apply to <strong>all {paths.length} items</strong>. Tags marked
                <span class="mt-partial-example">(n/{paths.length})</span> are only on some items.
            </p>

            {#if sortedTags.length > 0}
                <div class="mt-chips">
                    {#each sortedTags as [tag, count] (tag)}
                        {@const isSelected = selected.has(tag)}
                        {@const isNew = count === 0}
                        {@const isPartial = count > 0 && count < paths.length}
                        <button
                            class="mt-chip"
                            class:mt-chip--on={isSelected}
                            class:mt-chip--new={isNew}
                            onclick={() => toggleTag(tag)}
                            title={isNew
                                ? 'New tag (will be added)'
                                : isPartial
                                  ? `Present on ${count} of ${paths.length} items`
                                  : 'Present on all items'}
                        >
                            {tag}
                            {#if isPartial}
                                <span class="mt-chip-count">({count}/{paths.length})</span>
                            {/if}
                            {#if isNew}
                                <span class="mt-chip-new">new</span>
                            {/if}
                        </button>
                    {/each}
                </div>
            {:else}
                <div class="mt-state">No existing tags across these items.</div>
            {/if}

            <div class="mt-select-row">
                <button class="mt-link-btn" onclick={() => (selected = new Set(tagCounts.keys()))}>
                    Select all
                </button>
                <span class="mt-link-sep">·</span>
                <button class="mt-link-btn" onclick={() => (selected = new Set())}>
                    Select none
                </button>
            </div>

            <div class="mt-add">
                <input
                    class="mt-input"
                    type="text"
                    placeholder="Add a tag…"
                    bind:value={newTagInput}
                    onkeydown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            addNewTag();
                        }
                        if (e.key === 'Escape') {
                            e.stopPropagation();
                            newTagInput = '';
                        }
                    }}
                />
                <button class="mt-add-btn" onclick={addNewTag} disabled={!newTagInput.trim()}
                    >Add</button
                >
            </div>
        {/if}
    </div>

    <div class="mt-footer">
        <button class="mt-cancel" onclick={onclose} disabled={applying}>Cancel</button>
        <button
            class="mt-confirm"
            onclick={apply}
            disabled={applying || loading || selected.size === 0}
        >
            {applying ? 'Applying…' : `Merge ${selected.size} tag${selected.size !== 1 ? 's' : ''}`}
        </button>
    </div>
</div>

<style>
    .mt-backdrop {
        position: fixed;
        inset: 0;
        z-index: 310;
        background: rgba(0, 0, 0, 0.45);
    }

    .mt {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 311;
        width: min(480px, calc(100vw - 32px));
        max-height: calc(100vh - 80px);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .mt-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        padding: var(--spacing-3) var(--spacing-4);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .mt-header-icon {
        width: 18px;
        height: 18px;
        color: var(--color-primary);
        flex-shrink: 0;
    }

    .mt-title {
        font-size: var(--text-sm);
        font-weight: 600;
        color: var(--color-text);
        flex: 1;
    }

    .mt-close {
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
        flex-shrink: 0;
    }

    .mt-close:hover {
        color: var(--color-text);
    }
    .mt-close svg {
        width: 14px;
        height: 14px;
    }

    .mt-body {
        padding: var(--spacing-4);
        overflow-y: auto;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-3);
    }

    .mt-state {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
        text-align: center;
        padding: var(--spacing-2) 0;
    }

    .mt-description {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
        line-height: 1.5;
        margin: 0;
    }

    .mt-partial-example {
        font-family: monospace;
        color: var(--color-text);
    }

    .mt-chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-2);
    }

    .mt-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: var(--radius-full, 9999px);
        font-size: var(--text-xs);
        font-weight: 500;
        cursor: pointer;
        border: 1px solid var(--color-border);
        background: var(--color-surface-2);
        color: var(--color-text-muted);
        transition:
            background var(--transition-fast),
            color var(--transition-fast),
            border-color var(--transition-fast);
    }

    .mt-chip--on {
        background: color-mix(in srgb, var(--color-primary, #c8ff00) 18%, transparent);
        border-color: var(--color-primary, #c8ff00);
        color: var(--color-text);
    }

    .mt-chip--new {
        border-style: dashed;
    }

    .mt-chip-count {
        font-size: 0.7em;
        opacity: 0.7;
    }

    .mt-chip-new {
        font-size: 0.65em;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-primary, #c8ff00);
        opacity: 0.9;
    }

    .mt-select-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
    }

    .mt-link-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        padding: 0;
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    .mt-link-btn:hover {
        color: var(--color-text);
    }

    .mt-link-sep {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
    }

    .mt-add {
        display: flex;
        gap: var(--spacing-2);
    }

    .mt-input {
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

    .mt-input:focus {
        border-color: var(--color-primary);
    }

    .mt-add-btn {
        flex-shrink: 0;
        padding: var(--spacing-1) var(--spacing-3);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
        background: var(--color-surface-2);
        color: var(--color-text);
        font-size: var(--text-sm);
        cursor: pointer;
        font-weight: 500;
    }

    .mt-add-btn:hover:not(:disabled) {
        background: var(--color-surface-3, var(--color-surface-2));
    }
    .mt-add-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .mt-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-2);
        padding: var(--spacing-3) var(--spacing-4);
        border-top: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .mt-cancel {
        padding: var(--spacing-1) var(--spacing-4);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
        background: none;
        color: var(--color-text-muted);
        font-size: var(--text-sm);
        cursor: pointer;
    }

    .mt-cancel:hover:not(:disabled) {
        color: var(--color-text);
    }
    .mt-cancel:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .mt-confirm {
        padding: var(--spacing-1) var(--spacing-4);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-primary, #c8ff00);
        background: var(--color-primary, #c8ff00);
        color: #000;
        font-size: var(--text-sm);
        cursor: pointer;
        font-weight: 600;
    }

    .mt-confirm:hover:not(:disabled) {
        opacity: 0.85;
    }
    .mt-confirm:disabled {
        opacity: 0.4;
        cursor: default;
    }
</style>
