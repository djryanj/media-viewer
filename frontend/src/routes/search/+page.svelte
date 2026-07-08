<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { media } from '$lib/api/client';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import type { MediaFile, SearchSuggestion } from '$lib/api/types';
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

    // Suggestions for the search page input (mirrors SearchBar.svelte logic)
    let suggestions: SearchSuggestion[] = $state([]);
    let suggestionActiveIndex = $state(-1);
    let suggestionsEl: HTMLUListElement | undefined = $state();
    let suggestDebounce: ReturnType<typeof setTimeout>;

    $effect(() => {
        suggestions;
        suggestionActiveIndex = -1;
    });

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

    function handleSuggestInput() {
        suggestionActiveIndex = -1;
        clearTimeout(suggestDebounce);
        if (!editableQuery.trim()) {
            suggestions = [];
            return;
        }
        suggestDebounce = setTimeout(async () => {
            try {
                suggestions = await media.suggest(editableQuery);
            } catch {
                suggestions = [];
            }
        }, 200);
    }

    function handleSuggestion(s: SearchSuggestion) {
        suggestions = [];
        if (s.type === 'folder') {
            goto(`/?path=${encodeURIComponent(s.path)}`);
        } else if (s.type === 'playlist') {
            goto(`/playlists/${encodeURIComponent(s.name)}`);
        } else {
            goto(`/search?q=${encodeURIComponent(s.name)}`);
        }
    }

    function scrollSuggestionIntoView() {
        if (!suggestionsEl || suggestionActiveIndex < 0) return;
        (suggestionsEl.children[suggestionActiveIndex] as HTMLElement | undefined)?.scrollIntoView({
            block: 'nearest'
        });
    }

    function handleSuggestKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            suggestions = [];
            return;
        }
        if (e.key === 'Enter') {
            if (suggestionActiveIndex >= 0 && suggestions[suggestionActiveIndex]) {
                e.preventDefault();
                handleSuggestion(suggestions[suggestionActiveIndex]);
                return;
            }
            suggestions = [];
            const val = editableQuery.trim();
            if (val) goto(`/search?q=${encodeURIComponent(val)}`);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!suggestions.length) return;
            suggestionActiveIndex =
                suggestionActiveIndex < 0 ? 0 : (suggestionActiveIndex + 1) % suggestions.length;
            scrollSuggestionIntoView();
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!suggestions.length) return;
            suggestionActiveIndex =
                suggestionActiveIndex < 0
                    ? suggestions.length - 1
                    : (suggestionActiveIndex - 1 + suggestions.length) % suggestions.length;
            scrollSuggestionIntoView();
            return;
        }
    }

    function encodedPath(path: string): string {
        return path.split('/').map(encodeURIComponent).join('/');
    }

    function thumbUrl(s: SearchSuggestion): string | null {
        if (s.type === 'image' || s.type === 'video' || s.type === 'playlist') {
            return `/api/thumbnail/${encodedPath(s.path)}`;
        }
        return null;
    }

    function parentDir(path: string): string {
        const idx = path.lastIndexOf('/');
        return idx > 0 ? path.slice(0, idx) : '';
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
    <div class="search-input-wrap">
        <input
            class="search-query-input"
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            bind:value={editableQuery}
            placeholder="Search files and tags…"
            aria-label="Search query"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-autocomplete="list"
            aria-controls="page-search-suggestions"
            aria-activedescendant={suggestionActiveIndex >= 0
                ? `psug-${suggestionActiveIndex}`
                : undefined}
            oninput={handleSuggestInput}
            onkeydown={handleSuggestKeydown}
            onblur={() => setTimeout(() => (suggestions = []), 150)}
        />
        {#if suggestions.length > 0}
            <ul
                class="page-suggestions"
                id="page-search-suggestions"
                role="listbox"
                bind:this={suggestionsEl}
            >
                {#each suggestions as s, i}
                    <li id="psug-{i}" role="option" aria-selected={suggestionActiveIndex === i}>
                        <button
                            class="page-sug-item"
                            class:active={suggestionActiveIndex === i}
                            onmousedown={(e) => {
                                e.preventDefault();
                                handleSuggestion(s);
                            }}
                        >
                            <div class="page-sug-thumb">
                                {#if thumbUrl(s)}
                                    <img
                                        src={thumbUrl(s)}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        class="page-sug-img"
                                    />
                                {:else if s.type === 'folder'}
                                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path
                                            d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
                                        />
                                    </svg>
                                {:else if s.type === 'tag' || s.type === 'tag-exclude'}
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
                                {:else}
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        aria-hidden="true"
                                    >
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                        <polyline points="21 15 16 10 5 21" />
                                    </svg>
                                {/if}
                            </div>
                            <div class="page-sug-info">
                                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                                <span class="page-sug-name">{@html s.highlight || s.name}</span>
                                {#if s.type !== 'tag' && s.type !== 'tag-exclude' && parentDir(s.path)}
                                    <span class="page-sug-path">{parentDir(s.path)}</span>
                                {:else if s.type === 'folder' && s.itemCount}
                                    <span class="page-sug-path">{s.itemCount} items</span>
                                {/if}
                            </div>
                            {#if s.type === 'tag' || s.type === 'tag-exclude'}
                                <span class="page-sug-badge"
                                    >{s.type === 'tag-exclude' ? 'exclude' : 'tag'}</span
                                >
                            {/if}
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
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

    .search-input-wrap {
        position: relative;
        flex: 1;
        min-width: 180px;
        max-width: 480px;
    }

    .search-query-input {
        width: 100%;
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

    .page-suggestions {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        right: 0;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        list-style: none;
        overflow: hidden;
        z-index: 200;
        max-height: 400px;
        overflow-y: auto;
    }

    .page-sug-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        width: 100%;
        background: none;
        border: none;
        cursor: pointer;
        padding: var(--spacing-2) var(--spacing-3);
        text-align: left;
        color: var(--color-text);
        transition: background var(--transition-fast);
    }

    .page-sug-item:hover,
    .page-sug-item.active {
        background: var(--color-surface-2);
    }

    .page-sug-thumb {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: var(--color-surface-2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
    }

    .page-sug-thumb svg {
        width: 18px;
        height: 18px;
        opacity: 0.6;
    }

    .page-sug-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .page-sug-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }

    .page-sug-name {
        font-size: var(--text-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
    }

    .page-sug-path {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
    }

    .page-sug-badge {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        background: var(--color-surface-3);
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    :global(.page-sug-name mark) {
        background: transparent;
        color: var(--color-primary);
        font-weight: 600;
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
