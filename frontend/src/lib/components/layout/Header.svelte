<script lang="ts">
    import { tick } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import { authStore } from '$lib/stores/auth.svelte';
    import { settingsStore } from '$lib/stores/settings.svelte';
    import { lightboxStore } from '$lib/stores/lightbox.svelte';
    import SearchBar from '../ui/SearchBar.svelte';

    let showSearch = $state(false);
    let searchBarRef = $state<{ focus: () => void } | undefined>(undefined);

    function handleLogo() {
        galleryStore.navigate('');
        goto('/');
    }

    async function handleLogout() {
        await authStore.logout();
        goto('/login');
    }

    async function openSearch() {
        showSearch = true;
        await tick();
        searchBarRef?.focus();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (lightboxStore.open) return;
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
            return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            openSearch();
        } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            openSearch();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<header class="header">
    <div class="header-inner">
        <!-- Logo / title -->
        <button class="logo-btn" onclick={handleLogo} aria-label="Go to library root">
            <img src="/icons/icon.svg" alt="" class="logo-icon" aria-hidden="true" />
            <span class="logo-text">Media Viewer</span>
        </button>

        <!-- Search (desktop: always visible; mobile: toggle) -->
        <div class="search-wrap" class:visible={showSearch}>
            <SearchBar bind:this={searchBarRef} onclose={() => (showSearch = false)} />
        </div>

        <!-- Desktop nav links (hidden on mobile — BottomNav handles those) -->
        <nav class="desktop-nav" aria-label="Main navigation">
            <button
                class="nav-link"
                class:active={$page.url.pathname === '/'}
                onclick={handleLogo}
                aria-label="Library">Library</button
            >
            <button
                class="nav-link"
                class:active={$page.url.pathname.startsWith('/collections')}
                onclick={() => goto('/collections')}
                aria-label="Collections">Collections</button
            >
        </nav>

        <!-- Header actions -->
        <div class="header-actions">
            <button
                class="icon-btn"
                onclick={() => (showSearch = !showSearch)}
                aria-label="Toggle search"
                aria-expanded={showSearch}
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                </svg>
            </button>

            {#if galleryStore.selectionMode}
                <button
                    class="icon-btn selection-clear"
                    onclick={() => galleryStore.clearSelection()}
                    aria-label="Clear selection"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                    <span>{galleryStore.selectedCount}</span>
                </button>
            {/if}

            <button class="icon-btn" onclick={() => settingsStore.show()} aria-label="Settings">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <path
                        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                    />
                    <circle cx="12" cy="12" r="3" />
                </svg>
            </button>

            <button class="icon-btn" onclick={handleLogout} aria-label="Sign out">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" x2="9" y1="12" y2="12" />
                </svg>
            </button>
        </div>
    </div>
</header>

<style>
    .header {
        position: sticky;
        top: 0;
        z-index: 100;
        height: var(--header-height);
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
        /* Prevent bleed-through on iOS */
        -webkit-backdrop-filter: blur(12px);
        backdrop-filter: blur(12px);
        background: rgba(26, 26, 26, 0.92);
    }

    .header-inner {
        display: flex;
        align-items: center;
        height: 100%;
        padding: 0 var(--spacing-4);
        gap: var(--spacing-3);
    }

    @media (min-width: 1024px) {
        .header-inner {
            max-width: 1600px;
            margin-inline: auto;
            padding-inline: var(--spacing-5);
        }
    }

    @media (min-width: 1440px) {
        .header-inner {
            padding-inline: var(--spacing-6);
        }
    }

    .desktop-nav {
        display: none;
        align-items: center;
        gap: var(--spacing-1);
    }

    @media (min-width: 1024px) {
        .desktop-nav {
            display: flex;
        }
    }

    .nav-link {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        font-size: var(--text-sm);
        font-weight: 500;
        padding: var(--spacing-1) var(--spacing-3);
        border-radius: var(--radius-md);
        transition:
            color var(--transition-fast),
            background var(--transition-fast);
        white-space: nowrap;
    }

    .nav-link:hover {
        color: var(--color-text);
        background: var(--color-surface-2);
    }

    .nav-link.active {
        color: var(--color-primary);
    }

    .logo-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text);
        font-size: var(--text-lg);
        font-weight: 600;
        padding: var(--spacing-1) 0;
        flex-shrink: 0;
    }

    .logo-icon {
        width: 28px;
        height: 28px;
    }

    .logo-text {
        display: none;
    }

    @media (min-width: 640px) {
        .logo-text {
            display: block;
        }
    }

    .search-wrap {
        flex: 1;
        /* Hidden on mobile until toggled */
        display: none;
    }

    .search-wrap.visible {
        display: flex;
    }

    @media (min-width: 768px) {
        .search-wrap {
            display: flex;
        }
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        margin-left: auto;
    }

    .icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-1);
        width: 36px;
        height: 36px;
        background: none;
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        color: var(--color-text-muted);
        transition:
            color var(--transition-fast),
            background var(--transition-fast);
        text-decoration: none;
        flex-shrink: 0;
    }

    .icon-btn:hover {
        color: var(--color-text);
        background: var(--color-surface-2);
    }

    .icon-btn svg {
        width: 20px;
        height: 20px;
    }

    .selection-clear {
        color: var(--color-primary);
        width: auto;
        padding: 0 var(--spacing-2);
    }
</style>
