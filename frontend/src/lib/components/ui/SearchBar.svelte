<script lang="ts">
    import { goto } from '$app/navigation';
    import { media } from '$lib/api/client';
    import type { SearchSuggestion } from '$lib/api/types';

    let { onclose }: { onclose?: () => void } = $props();

    let query = $state('');
    let suggestions: SearchSuggestion[] = $state([]);
    let loading = $state(false);
    let activeIndex = $state(-1);
    let debounceTimer: ReturnType<typeof setTimeout>;
    let inputEl: HTMLInputElement;
    let listEl: HTMLUListElement | undefined = $state();

    $effect(() => {
        inputEl?.focus();
    });

    // Reset keyboard selection when suggestions change
    $effect(() => {
        suggestions; // reactive dep
        activeIndex = -1;
    });

    export function focus() {
        inputEl?.focus();
        inputEl?.select();
    }

    function handleInput() {
        activeIndex = -1;
        clearTimeout(debounceTimer);
        if (!query.trim()) {
            suggestions = [];
            return;
        }
        debounceTimer = setTimeout(async () => {
            loading = true;
            try {
                suggestions = await media.suggest(query);
            } catch {
                suggestions = [];
            } finally {
                loading = false;
            }
        }, 200);
    }

    function scrollActiveIntoView() {
        if (!listEl || activeIndex < 0) return;
        (listEl.children[activeIndex] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
    }

    function handleSubmit() {
        if (!query.trim()) return;
        suggestions = [];
        goto(`/search?q=${encodeURIComponent(query.trim())}`);
        onclose?.();
    }

    function handleSuggestion(s: SearchSuggestion) {
        if (s.type === 'folder') {
            goto(`/?path=${encodeURIComponent(s.path)}`);
        } else if (s.type === 'playlist') {
            goto(`/playlists/${encodeURIComponent(s.name)}`);
        } else {
            goto(`/search?q=${encodeURIComponent(s.name)}`);
        }
        query = '';
        suggestions = [];
        onclose?.();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            if (suggestions.length > 0) { suggestions = []; activeIndex = -1; return; }
            query = '';
            onclose?.();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!suggestions.length) return;
            activeIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % suggestions.length;
            scrollActiveIntoView();
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!suggestions.length) return;
            activeIndex = activeIndex < 0 ? suggestions.length - 1 : (activeIndex - 1 + suggestions.length) % suggestions.length;
            scrollActiveIntoView();
            return;
        }
        if (e.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
            e.preventDefault();
            handleSuggestion(suggestions[activeIndex]);
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
</script>

<div class="search-bar" role="search">
    <div class="input-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <input
                bind:this={inputEl}
                bind:value={query}
                type="search"
                placeholder="Search files and tags…"
                autocomplete="off"
                class="search-input"
                role="combobox"
                aria-expanded={suggestions.length > 0}
                aria-autocomplete="list"
                aria-controls="search-suggestions"
                aria-activedescendant={activeIndex >= 0 ? `sug-${activeIndex}` : undefined}
                oninput={handleInput}
                onkeydown={handleKeydown}
            />
        </form>
        {#if query}
            <button class="clear-btn" onclick={() => { query = ''; suggestions = []; }} aria-label="Clear search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                </svg>
            </button>
        {/if}
    </div>

    {#if suggestions.length > 0}
        <ul class="suggestions" id="search-suggestions" role="listbox" bind:this={listEl}>
            {#each suggestions as s, i}
                <li id="sug-{i}" role="option" aria-selected={activeIndex === i}>
                    <button class="suggestion-item" class:active={activeIndex === i} onclick={() => handleSuggestion(s)}>
                        <!-- Thumbnail / type icon -->
                        <div class="sug-thumb">
                            {#if thumbUrl(s)}
                                <img src={thumbUrl(s)} alt="" loading="lazy" decoding="async" class="sug-img" />
                            {:else if s.type === 'folder'}
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                </svg>
                            {:else if s.type === 'tag' || s.type === 'tag-exclude'}
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                                    <line x1="7" y1="7" x2="7.01" y2="7" />
                                </svg>
                            {:else}
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                    <rect x="3" y="3" width="18" height="18" rx="2" />
                                    <circle cx="8.5" cy="8.5" r="1.5" />
                                    <polyline points="21 15 16 10 5 21" />
                                </svg>
                            {/if}
                        </div>

                        <!-- Name + path -->
                        <div class="sug-info">
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                            <span class="sug-name">{@html s.highlight || s.name}</span>
                            {#if s.type !== 'tag' && s.type !== 'tag-exclude' && parentDir(s.path)}
                                <span class="sug-path">{parentDir(s.path)}</span>
                            {:else if s.type === 'folder' && s.itemCount}
                                <span class="sug-path">{s.itemCount} items</span>
                            {/if}
                        </div>

                        <!-- Type badge (tags only) -->
                        {#if s.type === 'tag' || s.type === 'tag-exclude'}
                            <span class="sug-badge">{s.type === 'tag-exclude' ? 'exclude' : 'tag'}</span>
                        {/if}
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .search-bar {
        position: relative;
        width: 100%;
        max-width: 560px;
    }

    .input-wrap {
        display: flex;
        align-items: center;
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        padding: 0 var(--spacing-3);
        transition: border-color var(--transition-fast);
    }

    .input-wrap:focus-within {
        border-color: var(--color-primary);
    }

    .search-icon {
        width: 16px;
        height: 16px;
        color: var(--color-text-muted);
        flex-shrink: 0;
    }

    .input-wrap form {
        flex: 1;
        display: flex;
    }

    .search-input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        padding: var(--spacing-2) var(--spacing-2);
        font-size: var(--text-sm);
        color: var(--color-text);
        width: 100%;
    }

    .search-input::placeholder {
        color: var(--color-text-subtle);
    }

    .search-input::-webkit-search-cancel-button {
        -webkit-appearance: none;
    }

    .clear-btn {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        padding: 0;
        display: flex;
        flex-shrink: 0;
    }

    .clear-btn svg {
        width: 16px;
        height: 16px;
    }

    .suggestions {
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

    .suggestion-item {
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

    .suggestion-item:hover,
    .suggestion-item.active {
        background: var(--color-surface-2);
    }

    /* Thumbnail / icon box */
    .sug-thumb {
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

    .sug-thumb svg {
        width: 18px;
        height: 18px;
        opacity: 0.6;
    }

    .sug-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    /* Name + path */
    .sug-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }

    .sug-name {
        font-size: var(--text-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
    }

    .sug-path {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
    }

    /* Tag badge */
    .sug-badge {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        background: var(--color-surface-3);
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    :global(.sug-name mark) {
        background: transparent;
        color: var(--color-primary);
        font-weight: 600;
    }
</style>
