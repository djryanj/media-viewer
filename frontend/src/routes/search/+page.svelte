<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { media } from '$lib/api/client';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import type { MediaFile } from '$lib/api/types';
    import Gallery from '$lib/components/gallery/Gallery.svelte';
    import GalleryToolbar from '$lib/components/gallery/GalleryToolbar.svelte';

    const PAGE_SIZE = 100;

    let items: MediaFile[] = $state([]);
    let loading = $state(false);
    let loadingMore = $state(false);
    let hasMore = $state(false);
    let error = $state('');
    let totalItems = $state(0);
    let currentQuery = $state('');
    let currentPage = $state(1);

    // editableQuery reflects the URL; stays in sync so the user can see
    // and edit the full search string including tag filters added by the pill buttons.
    let editableQuery = $state('');

    // Sync URL query param → currentQuery/editableQuery without triggering
    // a search itself (the search effect below watches currentQuery separately).
    $effect(() => {
        const q = $page.url.searchParams.get('q') ?? '';
        if (q !== currentQuery) {
            currentQuery = q;
            editableQuery = q;
        }
    });

    // Re-run the search whenever the query, sort field, or sort order changes.
    $effect(() => {
        const q = currentQuery;
        const sort = galleryStore.sort;
        const order = galleryStore.order;
        if (q) {
            runSearch(q, sort, order);
        } else {
            items = [];
            totalItems = 0;
            hasMore = false;
            galleryStore.clearSelection();
            galleryStore.setTotalItems(0);
        }
    });

    async function runSearch(q: string, sort: string, order: string) {
        loading = true;
        error = '';
        currentPage = 1;
        items = [];
        hasMore = false;
        galleryStore.clearSelection();
        try {
            const result = await media.search(q, 1, PAGE_SIZE, sort, order);
            items = result.items;
            totalItems = result.totalItems;
            hasMore = items.length < result.totalItems;
            galleryStore.setTotalItems(result.totalItems);
        } catch {
            error = 'Search failed. Please try again.';
        } finally {
            loading = false;
        }
    }

    // Keep galleryStore in sync so selectAll(), getSelectedItems(), GalleryToolbar
    // bulk actions, and shift-click range selection all work on search results.
    $effect(() => {
        galleryStore.setItems(items);
    });

    function handleKeydown(e: KeyboardEvent) {
        if (lightboxStore.open) return;
        const target = e.target as HTMLElement;
        const inInput =
            target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !inInput) {
            e.preventDefault();
            galleryStore.selectAll();
            return;
        }
        if (e.key === 'Escape' && galleryStore.selectionMode && !inInput) {
            galleryStore.clearSelection();
        }
    }

    async function loadMore() {
        if (loadingMore || !hasMore || !currentQuery) return;
        loadingMore = true;
        const nextPage = currentPage + 1;
        try {
            const result = await media.search(
                currentQuery,
                nextPage,
                PAGE_SIZE,
                galleryStore.sort,
                galleryStore.order
            );
            const newItems = result.items;
            items = [...items, ...newItems];
            currentPage = nextPage;
            hasMore = items.length < result.totalItems;
            if (lightboxStore.open) {
                lightboxStore.extendItems(
                    newItems.filter((i) => i.type !== 'folder' && i.type !== 'playlist')
                );
            }
        } catch {
            // silently ignore — retry on next scroll
        } finally {
            loadingMore = false;
        }
    }

    // ── Tag filtering helpers ────────────────────────────────────────────────
    /** Unique tags across all result items, sorted by frequency. */
    const uniqueTags = $derived.by<string[]>(() => {
        const counts = new Map<string, number>();
        for (const item of items) {
            for (const tag of item.tags ?? []) {
                counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
        }
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([t]) => t)
            .slice(0, 20);
    });

    /** Tags already present in the current query as include (`tag:x`) or exclude (`-tag:x`). */
    function parseTagFilters(q: string): { included: Set<string>; excluded: Set<string> } {
        const included = new Set<string>();
        const excluded = new Set<string>();
        for (const part of q.split(/\s+/)) {
            const m = part.match(/^(-?)tag:(.+)$/i);
            if (m) {
                if (m[1] === '-') excluded.add(m[2]);
                else included.add(m[2]);
            }
        }
        return { included, excluded };
    }

    const tagFilters = $derived(parseTagFilters(currentQuery));

    function applyTagFilter(tag: string, mode: 'include' | 'exclude' | 'remove') {
        // Strip any existing filter for this tag
        let q = currentQuery
            .split(/\s+/)
            .filter((p) => {
                const m = p.match(/^-?tag:(.+)$/i);
                return !(m && m[1].toLowerCase() === tag.toLowerCase());
            })
            .join(' ')
            .trim();

        if (mode === 'include') q = `${q} tag:${tag}`.trim();
        else if (mode === 'exclude') q = `${q} -tag:${tag}`.trim();

        goto(`/search?q=${encodeURIComponent(q)}`);
    }

    // Bottom sentinel for infinite scroll
    let sentinel: HTMLDivElement | undefined = $state();
    let observer: IntersectionObserver | null = null;

    $effect(() => {
        if (!sentinel) return;
        observer?.disconnect();
        observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) loadMore();
            },
            { rootMargin: '0px 0px 600px 0px' }
        );
        observer.observe(sentinel);
    });

    // Prevent setSort from triggering a folder re-navigation while on the search
    // page. Without this, if state.listing is non-null from a prior folder visit,
    // changing sort calls navigate(state.path) which overwrites totalItems with
    // the folder count, racing against the search's own setTotalItems call.
    onMount(() => {
        galleryStore.clearListing();
    });

    onDestroy(() => observer?.disconnect());
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
    <title>{currentQuery ? `Search: ${currentQuery}` : 'Search'} — Media Viewer</title>
</svelte:head>

<GalleryToolbar />

<div class="page-header">
    <h2 class="page-title">Search</h2>
    <input
        class="search-query-input"
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        bind:value={editableQuery}
        placeholder="Search files and tags…"
        aria-label="Search query"
        onkeydown={(e) => {
            if (e.key === 'Enter') {
                const val = editableQuery.trim();
                if (val) goto(`/search?q=${encodeURIComponent(val)}`);
            }
        }}
    />
    {#if !loading && currentQuery}
        <span class="page-count">{totalItems} item(s)</span>
    {/if}
</div>

{#if !loading && uniqueTags.length > 0}
    <div class="tag-filter-bar" role="group" aria-label="Filter by tag">
        <span class="tag-filter-label">Filter:</span>
        {#each uniqueTags as tag}
            {@const isIncluded = tagFilters.included.has(tag)}
            {@const isExcluded = tagFilters.excluded.has(tag)}
            <div class="tag-pill" class:included={isIncluded} class:excluded={isExcluded}>
                <span class="tag-pill-name">{tag}</span>
                {#if isIncluded || isExcluded}
                    <button
                        class="tag-pill-action remove"
                        onclick={() => applyTagFilter(tag, 'remove')}
                        aria-label="Remove {tag} filter"
                        title="Remove filter">✕</button
                    >
                {:else}
                    <button
                        class="tag-pill-action include"
                        onclick={() => applyTagFilter(tag, 'include')}
                        aria-label="Include {tag}"
                        title="Show only items with this tag">+</button
                    >
                    <button
                        class="tag-pill-action exclude"
                        onclick={() => applyTagFilter(tag, 'exclude')}
                        aria-label="Exclude {tag}"
                        title="Hide items with this tag">−</button
                    >
                {/if}
            </div>
        {/each}
    </div>
{/if}

{#if loading}
    <div class="state-msg"><div class="spinner"></div></div>
{:else if error}
    <div class="state-msg error">{error}</div>
{:else if !currentQuery}
    <div class="state-msg">Enter a search term above.</div>
{:else if items.length === 0}
    <div class="state-msg">No results found for "{currentQuery}".</div>
{:else}
    <Gallery
        {items}
        externalScroll
        onitemupdate={(path, patch) => {
            items = items.map((i) => (i.path === path ? { ...i, ...patch } : i));
        }}
    />
    {#if hasMore}
        <div class="sentinel" bind:this={sentinel} aria-hidden="true">
            {#if loadingMore}
                <div class="spinner"></div>
            {/if}
        </div>
    {/if}
{/if}

<style>
    .page-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        padding: var(--spacing-4) var(--spacing-4) var(--spacing-2);
        flex-wrap: wrap;
    }

    .page-title {
        font-size: var(--text-xl);
        font-weight: 700;
        flex-shrink: 0;
    }

    .search-query-input {
        flex: 1;
        min-width: 180px;
        max-width: 480px;
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        padding: var(--spacing-2) var(--spacing-3);
        font-size: var(--text-sm);
        color: var(--color-text);
        outline: none;
        transition: border-color var(--transition-fast);
    }

    .search-query-input:focus {
        border-color: var(--color-primary);
    }

    .search-query-input::-webkit-search-cancel-button {
        -webkit-appearance: none;
    }

    .page-count {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
    }

    /* Tag filter bar */
    .tag-filter-bar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-2);
        padding: 0 var(--spacing-4) var(--spacing-3);
    }

    .tag-filter-label {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        flex-shrink: 0;
    }

    .tag-pill {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        background: var(--color-surface-2);
        font-size: var(--text-xs);
        overflow: hidden;
    }

    .tag-pill.included {
        border-color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    }

    .tag-pill.excluded {
        border-color: var(--color-danger);
        background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    }

    .tag-pill-name {
        padding: 2px var(--spacing-2) 2px var(--spacing-2);
        color: var(--color-text);
        pointer-events: none;
    }

    .tag-pill-action {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border: none;
        background: none;
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        border-left: 1px solid var(--color-border);
        color: var(--color-text-muted);
        transition:
            background var(--transition-fast),
            color var(--transition-fast);
    }

    .tag-pill-action:first-of-type {
        border-left: none;
    }

    .tag-pill-action.include:hover {
        background: color-mix(in srgb, var(--color-primary) 20%, transparent);
        color: var(--color-primary);
    }

    .tag-pill-action.exclude:hover {
        background: color-mix(in srgb, var(--color-danger) 20%, transparent);
        color: var(--color-danger);
    }

    .tag-pill-action.remove {
        color: var(--color-text-muted);
        font-size: 10px;
    }

    .tag-pill-action.remove:hover {
        background: var(--color-surface-3);
        color: var(--color-text);
    }

    .state-msg {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        color: var(--color-text-muted);
        font-size: var(--text-sm);
        padding: var(--spacing-4);
        text-align: center;
    }

    .state-msg.error {
        color: var(--color-danger);
    }

    .sentinel {
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
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
