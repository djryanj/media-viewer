<script lang="ts">
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { collections as collectionsApi } from '$lib/api/client';
    import type { Collection } from '$lib/api/types';

    let items: Collection[] = $state([]);
    let loading = $state(true);
    let error = $state('');

    onMount(async () => {
        try {
            items = await collectionsApi.list();
        } catch {
            error = 'Failed to load collections';
        } finally {
            loading = false;
        }
    });
</script>

<svelte:head>
    <title>Albums — Media Viewer</title>
</svelte:head>

<div class="page-header">
    <h2 class="page-title">Albums</h2>
    {#if !loading}
        <span class="page-count">{items.length} albums</span>
    {/if}
</div>

{#if loading}
    <div class="state-msg"><div class="spinner"></div></div>
{:else if error}
    <div class="state-msg error">{error}</div>
{:else if items.length === 0}
    <div class="state-msg">No albums yet.</div>
{:else}
    <div class="collections-grid">
        {#each items as col (col.id)}
            <button
                class="collection-card"
                onclick={() => goto(`/collections/${col.id}`)}
                aria-label={col.name}
            >
                <div class="collection-cover">
                    {#if col.coverPath}
                        <img
                            src="/api/thumbnail/{encodeURIComponent(col.coverPath)}"
                            alt=""
                            class="cover-img"
                            loading="lazy"
                        />
                    {:else}
                        <div class="cover-placeholder" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <rect width="7" height="7" x="3" y="3" rx="1" />
                                <rect width="7" height="7" x="14" y="3" rx="1" />
                                <rect width="7" height="7" x="14" y="14" rx="1" />
                                <rect width="7" height="7" x="3" y="14" rx="1" />
                            </svg>
                        </div>
                    {/if}
                </div>
                <div class="collection-info">
                    <span class="collection-name">{col.name}</span>
                    <span class="collection-count">{col.itemCount} items</span>
                </div>
            </button>
        {/each}
    </div>
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

    .collections-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: var(--spacing-3);
        padding: var(--spacing-4);
    }

    @media (min-width: 640px) {
        .collections-grid {
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        }
    }

    .collection-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
        cursor: pointer;
        text-align: left;
        transition:
            border-color var(--transition-fast),
            box-shadow var(--transition-fast);
        padding: 0;
    }

    .collection-card:hover {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 1px var(--color-primary);
    }

    .collection-cover {
        width: 100%;
        padding-bottom: 100%;
        position: relative;
        background: var(--color-surface-2);
        overflow: hidden;
    }

    .cover-img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .cover-placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
        opacity: 0.3;
    }

    .cover-placeholder svg {
        width: 48px;
        height: 48px;
    }

    .collection-info {
        padding: var(--spacing-3);
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .collection-name {
        font-size: var(--text-sm);
        font-weight: 600;
        color: var(--color-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .collection-count {
        font-size: var(--text-xs);
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
        to {
            transform: rotate(360deg);
        }
    }
</style>
