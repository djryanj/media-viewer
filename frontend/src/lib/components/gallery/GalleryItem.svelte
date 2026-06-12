<script lang="ts">
    import { goto } from '$app/navigation';
    import type { MediaFile } from '$lib/api/types';
    import { lazyLoad } from '$lib/utils/intersection';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import TagOverflowPopover from './TagOverflowPopover.svelte';

    let {
        item,
        selected = false,
        selectionMode = false,
        ontap,
        onlongpress,
        ontogglefavorite,
        oncollections
    }: {
        item: MediaFile;
        selected?: boolean;
        selectionMode?: boolean;
        ontap: (item: MediaFile, shiftKey: boolean) => void;
        onlongpress: (item: MediaFile) => void;
        ontogglefavorite?: (item: MediaFile) => void;
        oncollections?: (item: MediaFile) => void;
    } = $props();

    // ── Long-press detection ─────────────────────────────────────────────────
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    // 600ms: long enough that deliberate-but-unhurried taps don't accidentally
    // trigger selection mode (450ms was too easy to hit on mobile).
    const LONG_PRESS_MS = 600;
    // Suppresses the synthetic click the browser fires after a long-press or drag.
    let pointerHandled = false;
    let pressStartX = 0;
    let pressStartY = 0;

    function startPress(e: PointerEvent) {
        pointerHandled = false;
        pressStartX = e.clientX;
        pressStartY = e.clientY;
        pressTimer = setTimeout(() => {
            pressTimer = null;
            pointerHandled = true;
            onlongpress(item);
        }, LONG_PRESS_MS);
    }

    function cancelPress() {
        if (pressTimer !== null) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }

    // Cancel the long-press timer early when the finger moves enough to indicate
    // a scroll intent. Without this, a slow scroll can still fire long-press.
    function handlePointerMove(e: PointerEvent) {
        if (pressTimer === null || e.pointerType !== 'touch') return;
        const dx = e.clientX - pressStartX;
        const dy = e.clientY - pressStartY;
        if (Math.sqrt(dx * dx + dy * dy) > 8) cancelPress();
    }

    function handlePointerUp(_e: PointerEvent) {
        if (galleryStore.isDragging) {
            clearPress();
            pointerHandled = true; // suppress the subsequent click
            return;
        }
        // Clear the timer but do NOT fire handleTap here.
        // We let the browser's own `click` event be the tap signal.
        // The browser only synthesises `click` for genuine taps — it suppresses
        // it after `pointercancel` (scroll gesture), so this naturally handles
        // the case where slight finger movement caused pointercancel and lost the tap.
        if (pressTimer !== null) {
            clearPress();
        }
        // pressTimer === null → long-press fired (pointerHandled=true) or movement
        // tracking cancelled it. Either way the click event decides what to do.
    }

    function clearPress() {
        cancelPress();
    }

    function handleTap(e: Event) {
        e.preventDefault();
        const shiftKey = e instanceof MouseEvent ? e.shiftKey : false;
        if (item.type === 'folder') {
            if (!selectionMode) goto(`/?path=${encodeURIComponent(item.path)}`);
            return; // never select folders
        }
        if (item.type === 'playlist') {
            if (!selectionMode) {
                // Strip extension from the playlist name for the route
                const name = item.name.replace(/\.[^/.]+$/, '');
                goto(`/playlists/${encodeURIComponent(name)}`);
            }
            return;
        }
        ontap(item, shiftKey);
    }

    function handleClick(e: MouseEvent) {
        if (pointerHandled) {
            pointerHandled = false;
            return;
        }
        handleTap(e);
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTap(e);
        }
    }

    const isFolder = $derived(item.type === 'folder');
    const isVideo = $derived(item.type === 'video');
    const isPlaylist = $derived(item.type === 'playlist');
    const hasThumb = $derived(!!item.thumbnailUrl);

    // ── Tag overflow popover ──────────────────────────────────────────────────
    const MAX_VISIBLE_TAGS = 2;
    const itemTags = $derived(item.tags ?? []);
    const visibleTags = $derived(itemTags.slice(0, MAX_VISIBLE_TAGS));
    const overflowCount = $derived(Math.max(0, itemTags.length - MAX_VISIBLE_TAGS));

    let tagPopoverAnchor = $state<HTMLElement | undefined>(undefined);

    function openTagPopover(e: MouseEvent, el: HTMLElement) {
        e.stopPropagation();
        e.preventDefault();
        tagPopoverAnchor = tagPopoverAnchor === el ? undefined : el;
    }

    function handleCheckboxClick(e: MouseEvent) {
        e.stopPropagation();
        e.preventDefault();
        galleryStore.toggleSelection(item.path);
    }

    function handleCheckboxPointerDown(e: PointerEvent) {
        // Prevent the item's pointerdown handler from starting a press timer
        // when the user clicks the checkbox.
        e.stopPropagation();
    }

    function handleStarPointerDown(e: PointerEvent) {
        e.stopPropagation();
        cancelPress();
    }

    function handleStarClick(e: MouseEvent) {
        e.stopPropagation();
        if (ontogglefavorite) ontogglefavorite(item);
    }

    function handleCollectionsPointerDown(e: PointerEvent) {
        e.stopPropagation();
        cancelPress();
    }

    function handleCollectionsClick(e: MouseEvent) {
        e.stopPropagation();
        if (oncollections) oncollections(item);
    }
</script>

<div
    class="gallery-item"
    class:selected
    class:folder={isFolder}
    class:selection-mode={selectionMode}
    role="button"
    tabindex="0"
    data-path={item.path}
    data-type={item.type}
    onpointerdown={startPress}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={clearPress}
    onpointerleave={(e) => {
        if (e.pointerType !== 'touch') clearPress();
    }}
    oncontextmenu={(e) => e.preventDefault()}
    onclick={handleClick}
    onkeydown={handleKeyDown}
    aria-label="{item.name}{selected ? ' (selected)' : ''}"
>
    <!-- Aspect-ratio wrapper — 1:1 square grid -->
    <div class="thumb-wrap">
        {#if hasThumb}
            <!-- Lazy-loaded thumbnail via IntersectionObserver -->
            <img
                use:lazyLoad={{ src: item.thumbnailUrl! }}
                alt={item.name}
                class="thumb"
                loading="lazy"
                decoding="async"
            />
        {:else if isFolder}
            <div class="folder-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path
                        d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
                    />
                </svg>
                {#if item.itemCount}
                    <span class="folder-count">{item.itemCount}</span>
                {/if}
            </div>
        {:else if isPlaylist}
            <div class="playlist-icon" aria-hidden="true">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                >
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
            </div>
        {:else}
            <div class="placeholder" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path
                        d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"
                    />
                </svg>
            </div>
        {/if}

        <!-- Video badge -->
        {#if isVideo}
            <div class="badge video-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                </svg>
            </div>
        {/if}

        <!-- Playlist badge -->
        {#if isPlaylist}
            <div class="badge playlist-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
            </div>
        {/if}

        <!-- Collections button — visible on hover (desktop) or in selection mode; not for folders -->
        {#if !isFolder && oncollections}
            <button
                class="collections-btn"
                type="button"
                onpointerdown={handleCollectionsPointerDown}
                onclick={handleCollectionsClick}
                aria-label="Add to collection"
                tabindex="-1"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
            </button>
        {/if}

        <!-- Favorite toggle button — visible on hover (desktop), in selection mode, or when favorited -->
        <button
            class="favorite-btn"
            class:favorited={item.isFavorite}
            type="button"
            onpointerdown={handleStarPointerDown}
            onclick={handleStarClick}
            aria-label={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={item.isFavorite}
            tabindex="-1"
        >
            <svg
                viewBox="0 0 24 24"
                fill={item.isFavorite ? 'currentColor' : 'none'}
                stroke="currentColor"
                stroke-width="2"
            >
                <polygon
                    points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                />
            </svg>
        </button>

        <!-- Selection checkbox: always present on non-folders;
             visible on desktop hover or whenever in selection/selected state -->
        {#if !isFolder}
            <div class="selection-overlay" aria-hidden="true">
                <button
                    class="checkbox"
                    class:checked={selected}
                    onpointerdown={handleCheckboxPointerDown}
                    onclick={handleCheckboxClick}
                    tabindex="-1"
                    type="button"
                    aria-label={selected ? 'Deselect' : 'Select'}
                >
                    {#if selected}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    {/if}
                </button>
            </div>
        {/if}
    </div>

    <!-- File name beneath thumbnail -->
    <div class="item-label">
        <span class="item-name">{item.name}</span>
        {#if itemTags.length > 0}
            <div class="item-tags">
                {#each visibleTags as tag (tag)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <span
                        class="item-tag"
                        title={tag}
                        onclick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            goto(`/search?q=${encodeURIComponent(tag)}`);
                        }}>{tag}</span
                    >
                {/each}
                {#if overflowCount > 0}
                    <button
                        class="item-tag more-tag"
                        type="button"
                        onclick={(e) => openTagPopover(e, e.currentTarget as HTMLElement)}
                        aria-label="Show {overflowCount} more tags">+{overflowCount}</button
                    >
                {/if}
            </div>
        {/if}
    </div>
</div>

{#if tagPopoverAnchor}
    <TagOverflowPopover
        allTags={itemTags}
        itemPath={item.path}
        anchor={tagPopoverAnchor}
        onclose={() => (tagPopoverAnchor = undefined)}
    />
{/if}

<style>
    .gallery-item {
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: var(--color-surface-2);
        transition: transform var(--transition-fast);
        /* Touch action: pan only, no zoom */
        touch-action: pan-y;
    }

    .gallery-item:active {
        transform: scale(0.97);
    }

    .gallery-item.selected .thumb-wrap {
        outline: 3px solid var(--color-primary);
    }

    /* Square aspect ratio */
    .thumb-wrap {
        position: relative;
        width: 100%;
        padding-bottom: 100%;
        background: var(--color-surface-3);
        overflow: hidden;
    }

    .thumb {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        /* Avoid layout shift before image loads */
        background: var(--color-surface-3);
    }

    .folder-icon,
    .placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
        gap: var(--spacing-2);
    }

    .folder-icon svg,
    .placeholder svg,
    .playlist-icon svg {
        width: 48px;
        height: 48px;
        opacity: 0.4;
    }

    .playlist-icon {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
    }

    .folder-count {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
    }

    /* Collections button (bottom-left) */
    .collections-btn {
        position: absolute;
        bottom: var(--spacing-1);
        left: var(--spacing-1);
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.85);
        opacity: 0;
        pointer-events: none;
        transition:
            opacity var(--transition-fast),
            background var(--transition-fast);
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }

    .collections-btn svg {
        width: 13px;
        height: 13px;
    }

    @media (hover: hover) and (pointer: fine) {
        .gallery-item:hover .collections-btn {
            opacity: 1;
            pointer-events: all;
        }
        .collections-btn:hover {
            background: rgba(0, 0, 0, 0.55);
        }
    }

    .selection-mode .collections-btn {
        opacity: 1;
        pointer-events: all;
        width: 44px;
        height: 44px;
    }

    .selection-mode .collections-btn svg {
        width: 16px;
        height: 16px;
    }

    /* Badges (video play, favorite star) */
    .badge {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .video-badge {
        bottom: var(--spacing-2);
        right: var(--spacing-2);
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
    }

    .video-badge svg {
        width: 14px;
        height: 14px;
    }

    .favorite-btn {
        position: absolute;
        top: var(--spacing-1);
        right: var(--spacing-1);
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.85);
        opacity: 0;
        pointer-events: none;
        transition:
            opacity var(--transition-fast),
            color var(--transition-fast),
            background var(--transition-fast);
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }

    .favorite-btn svg {
        width: 14px;
        height: 14px;
    }

    /* Always visible and tappable when favorited */
    .favorite-btn.favorited {
        opacity: 1;
        pointer-events: all;
        color: #ffd700;
    }

    /* Reveal on hover (desktop) */
    @media (hover: hover) and (pointer: fine) {
        .gallery-item:hover .favorite-btn {
            opacity: 1;
            pointer-events: all;
        }
        .favorite-btn:hover {
            background: rgba(0, 0, 0, 0.55);
        }
    }

    /* Reveal in selection mode (after long-press on mobile) */
    .selection-mode .favorite-btn {
        opacity: 1;
        pointer-events: all;
        /* Expand touch target to 44 × 44 px minimum without changing visual size */
        width: 44px;
        height: 44px;
    }

    .selection-mode .favorite-btn svg {
        width: 16px;
        height: 16px;
    }

    .playlist-badge {
        bottom: var(--spacing-2);
        right: var(--spacing-2);
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
    }

    .playlist-badge svg {
        width: 14px;
        height: 14px;
    }

    /* Selection overlay */
    .selection-overlay {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }

    .checkbox {
        position: absolute;
        top: var(--spacing-2);
        left: var(--spacing-2);
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.8);
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        cursor: pointer;
        /* Hidden by default; revealed via hover on desktop or selection state */
        opacity: 0;
        pointer-events: none;
        transition:
            opacity var(--transition-fast),
            background var(--transition-fast),
            border-color var(--transition-fast),
            transform var(--transition-fast);
    }

    /* Always visible when checked or in selection mode */
    .checkbox.checked,
    .selection-mode .checkbox {
        opacity: 1;
        pointer-events: all;
    }

    /* Reveal on hover for pointer-capable (desktop) devices */
    @media (hover: hover) and (pointer: fine) {
        .gallery-item:hover .checkbox {
            opacity: 1;
            pointer-events: all;
        }
    }

    .checkbox.checked {
        background: var(--color-primary);
        border-color: var(--color-primary);
    }

    .checkbox:hover:not(.checked) {
        background: rgba(0, 0, 0, 0.5);
        border-color: #fff;
        transform: scale(1.1);
    }

    .checkbox svg {
        width: 12px;
        height: 12px;
        color: #fff;
    }

    /* Label */
    .item-label {
        padding: 4px var(--spacing-1) var(--spacing-1);
    }

    .item-name {
        display: block;
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .item-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        margin-top: 3px;
    }

    .item-tag {
        display: inline-block;
        font-size: 0.65rem;
        line-height: 1.4;
        padding: 0 4px;
        border-radius: 999px;
        background: var(--color-surface-3);
        color: var(--color-text-muted);
        border: 1px solid var(--color-border);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 80px;
        cursor: pointer;
        transition:
            background var(--transition-fast),
            color var(--transition-fast);
    }

    .item-tag:hover {
        background: var(--color-primary);
        color: #fff;
        border-color: var(--color-primary);
    }

    .more-tag {
        background: none;
        font-weight: 600;
        max-width: none;
        flex-shrink: 0;
    }
</style>
