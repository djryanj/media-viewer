<!--
  TagPanel — the one tagging UI, for a single item or a whole selection.

  Wraps TagEditor and owns everything around it: optimistic saving through the
  per-tag endpoints (never a whole-list overwrite, so a stale panel can't wipe
  tags added elsewhere), error revert, clipboard paste, and the per-tag action
  menu (search, exclude, remove).

  With several items, tags on every item are solid chips; tags on only some are
  dimmed "n/m" chips whose menu offers "Add to all" / "Remove from all".

  Props:
    items      — { path, tags } for each item being edited
    compact    — dark layout for the lightbox
    onapply    — called with the new tags of every item after a successful save
    onnavigate — called just before navigating to a search (host can close itself)
    onpaste    — optional override for pasting the tag clipboard
-->
<script lang="ts">
    import { goto } from '$app/navigation';
    import { tags as tagsApi } from '$lib/api/client';
    import { toastStore } from '$lib/stores/toast.svelte';
    import TagEditor from '$lib/components/ui/TagEditor.svelte';
    import { tallyTags, diffTags } from '$lib/utils/tagSelection';

    let {
        items,
        compact = false,
        onapply = undefined,
        onnavigate = undefined,
        onpaste = undefined
    }: {
        items: Array<{ path: string; tags: string[] }>;
        compact?: boolean;
        onapply?: (updates: Record<string, string[]>) => void;
        onnavigate?: () => void;
        onpaste?: (clipboardTags: string[]) => void;
    } = $props();

    // Optimistic edits layered over the props; dropped whenever the host hands
    // us fresh items.
    let overrides = $state<Record<string, string[]> | null>(null);
    $effect(() => {
        void items;
        overrides = null;
    });

    const paths = $derived(items.map((i) => i.path));
    const view = $derived<Record<string, string[]>>(
        overrides ?? Object.fromEntries(items.map((i) => [i.path, i.tags ?? []]))
    );
    const tally = $derived(tallyTags(paths.map((p) => view[p] ?? [])));
    const multi = $derived(paths.length > 1);

    let editorRef = $state<{ focus: () => void } | undefined>(undefined);
    export function focus() {
        editorRef?.focus();
    }

    let activeTag = $state<string | null>(null);
    const activeIsPartial = $derived(
        activeTag !== null && tally.partial.some((p) => p.name === activeTag)
    );

    async function mutate(added: string[], removed: string[]) {
        if (added.length === 0 && removed.length === 0) return;
        const previous = overrides;
        const next: Record<string, string[]> = {};
        for (const p of paths) {
            const kept = (view[p] ?? []).filter((t) => !removed.includes(t));
            next[p] = [...kept, ...added.filter((t) => !kept.includes(t))];
        }
        overrides = next;
        try {
            if (paths.length === 1) {
                for (const tag of added) await tagsApi.add({ path: paths[0], tag });
                for (const tag of removed) await tagsApi.remove({ path: paths[0], tag });
            } else {
                let failed = 0;
                if (added.length) {
                    failed += (await tagsApi.bulkAdd({ paths, tags: added }))?.failed ?? 0;
                }
                if (removed.length) {
                    failed += (await tagsApi.bulkRemove({ paths, tags: removed }))?.failed ?? 0;
                }
                if (failed > 0) toastStore.error(`${failed} item(s) could not be updated`);
            }
            onapply?.(next);
        } catch {
            overrides = previous;
            toastStore.error('Failed to update tags');
        }
    }

    function handleChange(next: string[]) {
        const { added, removed } = diffTags(tally.common, next);
        return mutate(added, removed);
    }

    function handlePaste(clipboardTags: string[]) {
        if (onpaste) return onpaste(clipboardTags);
        return mutate(
            clipboardTags.filter((t) => !tally.common.includes(t)),
            []
        );
    }

    function search(tag: string, exclude: boolean) {
        activeTag = null;
        onnavigate?.();
        goto(`/search?q=${encodeURIComponent(`${exclude ? '-' : ''}tag:${tag}`)}`);
    }

    function act(tag: string, kind: 'add' | 'remove') {
        activeTag = null;
        return kind === 'add' ? mutate([tag], []) : mutate([], [tag]);
    }
</script>

<div class="tag-panel" class:compact>
    {#if activeTag}
        {@const tag = activeTag}
        <div class="tag-menu" role="group" aria-label="Actions for tag {tag}">
            <span class="tag-menu-title">{tag}</span>
            <button type="button" onclick={() => search(tag, false)}>Search for tag</button>
            <button type="button" onclick={() => search(tag, true)}>Exclude from search</button>
            {#if activeIsPartial}
                <button type="button" onclick={() => act(tag, 'add')}>Add to all</button>
            {/if}
            <button type="button" class="danger" onclick={() => act(tag, 'remove')}>
                {multi ? 'Remove from all' : 'Remove from item'}
            </button>
            <button
                type="button"
                class="menu-close"
                aria-label="Close tag actions"
                onclick={() => (activeTag = null)}>×</button
            >
        </div>
    {/if}

    <TagEditor
        bind:this={editorRef}
        tags={tally.common}
        partialTags={tally.partial}
        {compact}
        onchange={handleChange}
        ontagclick={(tag) => (activeTag = activeTag === tag ? null : tag)}
        onpaste={handlePaste}
    />
</div>

<style>
    .tag-panel {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
    }

    .tag-menu {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-2);
    }

    .tag-menu-title {
        font-weight: 600;
        font-size: var(--text-sm);
        margin-right: var(--spacing-1);
    }

    .tag-menu button {
        min-height: 36px;
        padding: 0 var(--spacing-3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        background: var(--color-surface-2);
        color: var(--color-text);
        font-size: var(--text-sm);
        cursor: pointer;
    }

    .tag-menu button.danger {
        color: var(--color-error, #e5484d);
    }

    .tag-menu .menu-close {
        padding: 0;
        width: 36px;
        margin-left: auto;
    }

    .compact .tag-menu-title,
    .compact .tag-menu button {
        color: #fff;
        border-color: rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.1);
    }

    .compact .tag-menu button.danger {
        color: #ff8b8b;
    }

    @media (pointer: coarse) {
        .tag-menu button {
            min-height: 44px;
        }
        .tag-menu .menu-close {
            width: 44px;
        }
    }
</style>
