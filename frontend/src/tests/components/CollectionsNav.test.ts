import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// ── Header nav ────────────────────────────────────────────────────────────────
const { pageMock } = vi.hoisted(() => ({ pageMock: { url: { pathname: '/' } } }));

vi.mock('$app/stores', () => ({
    page: {
        subscribe: (fn: (v: unknown) => void) => {
            fn(pageMock);
            return () => {};
        }
    }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: { path: '/', navigate: vi.fn(), sort: 'name', order: 'asc', favorites: [] }
}));
vi.mock('$lib/stores/auth.svelte', () => ({
    authStore: { user: null, loading: false }
}));
vi.mock('$lib/stores/settings.svelte', () => ({
    settingsStore: { open: false, show: vi.fn() }
}));
vi.mock('$lib/stores/lightbox.svelte', () => ({
    lightboxStore: { open: false }
}));

import Header from '$lib/components/layout/Header.svelte';
import BottomNav from '$lib/components/layout/BottomNav.svelte';

describe('Desktop nav — Collections replaces Favorites', () => {
    it('shows a Collections link in the desktop nav', () => {
        const { container } = render(Header);
        const nav = container.querySelector('.desktop-nav');
        expect(nav?.textContent).toContain('Collections');
    });

    it('does not show a Favorites link in the desktop nav', () => {
        const { container } = render(Header);
        const nav = container.querySelector('.desktop-nav');
        expect(nav?.textContent).not.toContain('Favorites');
    });

    it('does not show an Albums link anywhere in the desktop nav', () => {
        const { container } = render(Header);
        const nav = container.querySelector('.desktop-nav');
        expect(nav?.textContent).not.toContain('Albums');
    });

    it('Collections nav link is active when on /collections', () => {
        pageMock.url.pathname = '/collections';
        const { container } = render(Header);
        const activeLinks = container.querySelectorAll('.desktop-nav .nav-link.active');
        const labels = [...activeLinks].map((el) => el.textContent?.trim());
        expect(labels).toContain('Collections');
    });
});

describe('Bottom nav — Collections replaces Favorites and Albums', () => {
    it('shows a Collections tab in the bottom nav', () => {
        const { container } = render(BottomNav);
        expect(container.textContent).toContain('Collections');
    });

    it('does not show a Favorites tab in the bottom nav', () => {
        const { container } = render(BottomNav);
        expect(container.textContent).not.toContain('Favorites');
    });

    it('does not show an Albums tab in the bottom nav', () => {
        const { container } = render(BottomNav);
        expect(container.textContent).not.toContain('Albums');
    });
});
