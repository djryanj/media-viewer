<script lang="ts">
    import { onMount } from 'svelte';
    import { favorites as favApi } from '$lib/api/client';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import type { MediaFile } from '$lib/api/types';
    import Gallery from '$lib/components/gallery/Gallery.svelte';

    let items: MediaFile[] = $state([]);
    let loading = $state(true);
    let error = $state('');

    onMount(async () => {
        try {
            items = await favApi.list();
        } catch {
            error = 'Failed to load favorites';
        } finally {
            loading = false;
        }
    });

    const mediaItems = $derived(items.filter((i) => i.type !== 'folder'));
</script>

<svelte:head>
    <title>Favorites — Media Viewer</title>
</svelte:head>

<div class="page-header">
    <h2 class="page-title">Favorites</h2>
    {#if !loading}
        <span class="page-count">{items.length} items</span>
    {/if}
</div>

{#if loading}
    <div class="state-msg"><div class="spinner"></div></div>
{:else if error}
    <div class="state-msg error">{error}</div>
{:else if items.length === 0}
    <div class="state-msg">No favorites yet. Star items to add them here.</div>
{:else}
    <Gallery
        {items}
        onitemupdate={(path, patch) => {
            items = items.map((i) => (i.path === path ? { ...i, ...patch } : i));
        }}
    />
{/if}

<style>
    .page-header {
        display: flex;
        align-items: baseline;
        gap: var(--spacing-3);
        padding: var(--spacing-4) var(--spacing-4) var(--spacing-2);
    }

    .page-title {
        font-size: var(--text-xl);
        font-weight: 700;
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
        to { transform: rotate(360deg); }
    }
</style>
