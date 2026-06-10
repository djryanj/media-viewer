<script lang="ts">
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';

    const tabs = [
        {
            href: '/',
            label: 'Library',
            icon: `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`
        },
        {
            href: '/favorites',
            label: 'Favorites',
            icon: `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`
        },
        {
            href: '/search',
            label: 'Search',
            icon: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>`
        },
        {
            href: '/collections',
            label: 'Albums',
            icon: `<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>`
        }
    ] as const;

    function isActive(href: string) {
        if (href === '/') return $page.url.pathname === '/';
        return $page.url.pathname.startsWith(href);
    }
</script>

<nav class="bottom-nav" aria-label="Main navigation">
    {#each tabs as tab}
        <button
            class="nav-item"
            class:active={isActive(tab.href)}
            onclick={() => goto(tab.href)}
            aria-label={tab.label}
            aria-current={isActive(tab.href) ? 'page' : undefined}
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                {@html tab.icon}
            </svg>
            <span class="nav-label">{tab.label}</span>
        </button>
    {/each}
</nav>

<style>
    .bottom-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 100;
        display: flex;
        height: calc(var(--nav-height) + var(--safe-area-inset-bottom));
        padding-bottom: var(--safe-area-inset-bottom);
        background: rgba(26, 26, 26, 0.95);
        border-top: 1px solid var(--color-border);
        -webkit-backdrop-filter: blur(12px);
        backdrop-filter: blur(12px);
    }

    .nav-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        transition: color var(--transition-fast);
        padding: 0;
        /* Minimum touch target */
        min-height: 44px;
    }

    .nav-item:hover,
    .nav-item.active {
        color: var(--color-primary);
    }

    .nav-item svg {
        width: 22px;
        height: 22px;
    }

    .nav-item.active svg {
        fill: var(--color-primary);
        stroke: var(--color-primary);
    }

    .nav-label {
        font-size: var(--text-xs);
        font-weight: 500;
    }

    /* On larger screens, hide the bottom nav and show a sidebar instead */
    @media (min-width: 1024px) {
        .bottom-nav {
            display: none;
        }
    }
</style>
