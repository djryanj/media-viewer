<script lang="ts">
    import { goto } from '$app/navigation';
    import type { PathPart } from '$lib/api/types';

    let { parts }: { parts: PathPart[] } = $props();
</script>

<nav class="breadcrumb" aria-label="Directory navigation">
    <button class="crumb root" onclick={() => goto('/')} aria-label="Library root">
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
        >
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
    </button>
    {#each parts as part, i}
        <span class="sep" aria-hidden="true">/</span>
        {#if i === parts.length - 1}
            <span class="crumb current" aria-current="page">{part.name}</span>
        {:else}
            <button class="crumb" onclick={() => goto(`/?path=${encodeURIComponent(part.path)}`)}
                >{part.name}</button
            >
        {/if}
    {/each}
</nav>

<style>
    .breadcrumb {
        display: flex;
        align-items: center;
        gap: var(--spacing-1);
        padding: var(--spacing-3) var(--spacing-4);
        overflow-x: auto;
        scrollbar-width: none;
        white-space: nowrap;
        font-size: var(--text-sm);
        color: var(--color-text-muted);
    }

    .breadcrumb::-webkit-scrollbar {
        display: none;
    }

    .crumb {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        font-size: var(--text-sm);
        padding: 2px 4px;
        border-radius: var(--radius-sm);
        transition:
            color var(--transition-fast),
            background var(--transition-fast);
        display: flex;
        align-items: center;
    }

    .crumb:hover {
        color: var(--color-text);
        background: var(--color-surface-2);
    }

    .crumb.current {
        color: var(--color-text);
        cursor: default;
        font-weight: 500;
    }

    .crumb.root svg {
        width: 16px;
        height: 16px;
    }

    .sep {
        color: var(--color-text-subtle);
        user-select: none;
    }
</style>
