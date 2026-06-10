<script lang="ts">
    import { onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import { media } from '$lib/api/client';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import type { MediaFile } from '$lib/api/types';
    import Gallery from '$lib/components/gallery/Gallery.svelte';

    const PAGE_SIZE = 100;

    let items: MediaFile[] = $state([]);
    let loading = $state(false);
    let loadingMore = $state(false);
    let hasMore = $state(false);
    let error = $state('');
    let totalItems = $state(0);
    let currentQuery = $state('');
    let currentPage = $state(1);

    $effect(() => {
        const q = $page.url.searchParams.get('q') ?? '';
        if (q !== currentQuery) {
            currentQuery = q;
            if (q) runSearch(q);
            else {
                items = [];
                totalItems = 0;
                hasMore = false;
            }
        }
    });

    async function runSearch(q: string) {
        loading = true;
        error = '';
        currentPage = 1;
        items = [];
        hasMore = false;
        try {
            const result = await media.search(q, 1, PAGE_SIZE);
            items = result.items;
            totalItems = result.totalItems;
            hasMore = items.length < result.totalItems;
        } catch {
            error = 'Search failed. Please try again.';
        } finally {
            loading = false;
        }
    }

    async function loadMore() {
        if (loadingMore || !hasMore || !currentQuery) return;
        loadingMore = true;
        const nextPage = currentPage + 1;
        try {
            const result = await media.search(currentQuery, nextPage, PAGE_SIZE);
            const newItems = result.items;
            items = [...items, ...newItems];
            currentPage = nextPage;
            hasMore = items.length < result.totalItems;
            // Extend lightbox navigation so newly-visible items are reachable
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

    onDestroy(() => observer?.disconnect());
</script>

<svelte:head>
    <title>{currentQuery ? `Search: ${currentQuery}` : 'Search'} — Media Viewer</title>
</svelte:head>

<div class="page-header">
    <h2 class="page-title">
        {#if currentQuery}
            Results for <em>"{currentQuery}"</em>
        {:else}
            Search
        {/if}
    </h2>
    {#if !loading && currentQuery}
        <span class="page-count">{totalItems} item(s)</span>
    {/if}
</div>

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
        align-items: baseline;
        gap: var(--spacing-3);
        padding: var(--spacing-4) var(--spacing-4) var(--spacing-2);
        flex-wrap: wrap;
    }

    .page-title {
        font-size: var(--text-xl);
        font-weight: 700;
    }

    .page-title em {
        font-style: normal;
        color: var(--color-primary);
    }

    .page-count {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
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
