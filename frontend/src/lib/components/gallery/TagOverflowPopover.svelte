<script lang="ts">
    import { goto } from '$app/navigation';
    import { untrack } from 'svelte';
    import { tags as tagsApi } from '$lib/api/client';
    import { toastStore } from '$lib/stores/toast.svelte';
    import { galleryStore } from '$lib/stores/gallery.svelte';

    let {
        allTags,
        itemPath,
        anchor,
        onclose
    }: {
        allTags: string[];
        itemPath: string;
        anchor: HTMLElement;
        onclose: () => void;
    } = $props();

    let popoverEl = $state<HTMLDivElement | undefined>(undefined);

    // Position the popover above/below the anchor, centered horizontally.
    let style = $state('visibility:hidden');

    $effect(() => {
        if (!popoverEl || !anchor) return;
        const aRect = anchor.getBoundingClientRect();
        const pRect = popoverEl.getBoundingClientRect();
        const gap = 6;

        let top = aRect.top - pRect.height - gap;
        let left = aRect.left + aRect.width / 2 - pRect.width / 2;

        // Flip below if it would go above viewport
        if (top < 8) top = aRect.bottom + gap;

        // Clamp within viewport
        if (left < 8) left = 8;
        if (left + pRect.width > window.innerWidth - 8) left = window.innerWidth - pRect.width - 8;

        style = `position:fixed;top:${top}px;left:${left}px`;
    });

    // Intentional snapshot — the popover owns a mutable copy for optimistic removal.
    // untrack() silences the "captures initial value only" warning, which is intentional here.
    let localTags = $state(untrack(() => [...allTags]));

    async function removeTag(tag: string) {
        const prev = [...localTags];
        localTags = localTags.filter((t) => t !== tag);
        galleryStore.updateItem(itemPath, { tags: [...localTags] });
        try {
            await tagsApi.remove({ path: itemPath, tag });
        } catch {
            toastStore.error('Failed to remove tag');
            localTags = prev;
            galleryStore.updateItem(itemPath, { tags: prev });
        }
        if (localTags.length === 0) onclose();
    }

    function searchTag(tag: string) {
        onclose();
        goto(`/search?q=${encodeURIComponent(tag)}`);
    }

    function handleBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget) onclose();
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') onclose();
    }
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- Invisible full-screen backdrop to catch outside clicks -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={handleBackdropClick}></div>

<div class="popover" bind:this={popoverEl} {style} role="tooltip" aria-label="All tags">
    <div class="popover-title">All tags <span class="hint">(tap to search)</span></div>
    <div class="tag-list">
        {#each localTags as tag (tag)}
            <span class="tag-chip">
                <button
                    class="tag-remove"
                    type="button"
                    onclick={() => removeTag(tag)}
                    aria-label="Remove tag {tag}"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        aria-hidden="true"
                    >
                        <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                </button>
                <button class="tag-name" type="button" onclick={() => searchTag(tag)}>
                    {tag}
                </button>
            </span>
        {/each}
    </div>
</div>

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        z-index: 199;
    }

    .popover {
        z-index: 200;
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        min-width: 160px;
        max-width: 260px;
        animation: pop-in 0.1s ease;
    }

    .popover-title {
        font-size: 0.7rem;
        font-weight: 600;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 6px;
        padding: 0 2px;
    }

    .hint {
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
    }

    .tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .tag-chip {
        display: inline-flex;
        align-items: center;
        background: var(--color-surface-3);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        overflow: hidden;
        height: 24px;
    }

    .tag-remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 24px;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--color-text-muted);
        padding: 0;
        flex-shrink: 0;
        transition: color var(--transition-fast);
    }

    .tag-remove:hover {
        color: var(--color-danger, #e53e3e);
    }

    .tag-remove svg {
        width: 10px;
        height: 10px;
    }

    .tag-name {
        border: none;
        background: none;
        cursor: pointer;
        font-size: 0.72rem;
        color: var(--color-text);
        padding: 0 8px 0 2px;
        height: 24px;
        display: flex;
        align-items: center;
    }

    .tag-name:hover {
        color: var(--color-primary);
    }

    @keyframes pop-in {
        from {
            opacity: 0;
            transform: scale(0.92);
        }
        to {
            opacity: 1;
            transform: scale(1);
        }
    }
</style>
