import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Lightbox from '$lib/components/lightbox/Lightbox.svelte';
import { lightboxStore } from '$lib/stores/lightbox.svelte';
import type { MediaFile } from '$lib/api/types';

vi.mock('$app/navigation', () => ({
    beforeNavigate: vi.fn(),
    goto: vi.fn()
}));

vi.mock('hls.js', () => ({
    default: class {
        static isSupported() {
            return false;
        }
        destroy() {}
    }
}));

vi.mock('$lib/api/client', () => ({
    favorites: { add: vi.fn(), remove: vi.fn() },
    tags: {
        setForFile: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        related: vi.fn().mockResolvedValue([])
    },
    collections: {
        list: vi.fn().mockResolvedValue([]),
        memberships: vi.fn().mockResolvedValue({})
    }
}));

vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: {
        updateItem: vi.fn(),
        addFavorite: vi.fn(),
        removeFavorite: vi.fn()
    }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));

function makeImage(id: number, path: string): MediaFile {
    return {
        id,
        name: `image${id}.jpg`,
        path,
        parentPath: '/',
        type: 'image',
        size: 1024 * 200,
        modTime: '2024-06-01T12:00:00Z'
    };
}

const img1 = makeImage(1, '/photo1.jpg');
const img2 = makeImage(2, '/photo2.jpg');
const twoItems = [img1, img2];

describe('Lightbox — basic rendering', () => {
    beforeEach(() => {
        lightboxStore.close();
        vi.clearAllMocks();
    });

    it('renders nothing when the lightbox is closed', () => {
        render(Lightbox);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders the lightbox dialog after show()', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    });

    it('dialog is labelled with the current item name', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => expect(screen.getByRole('dialog', { name: img1.name })).toBeTruthy());
    });

    it('hides the dialog after close()', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));
        lightboxStore.close();
        await tick();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Close button calls lightboxStore.close()', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Close' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        await tick();
        expect(lightboxStore.open).toBe(false);
    });

    it('Escape key closes the lightbox', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));
        await fireEvent.keyDown(window, { key: 'Escape' });
        await tick();
        expect(lightboxStore.open).toBe(false);
    });
});

describe('Lightbox — collections panel', () => {
    beforeEach(() => {
        lightboxStore.close();
        vi.clearAllMocks();
    });

    it('collections button is present when lightbox is open', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        expect(screen.getByRole('button', { name: 'Collections' })).toBeTruthy();
    });

    it('collections panel is closed on initial open (aria-pressed=false)', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('false');
    });

    it('clicking the collections button opens the panel (aria-pressed=true)', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('true');
    });

    it('clicking the collections button again closes the panel', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('false');
    });

    it('collections panel is reset to closed when the lightbox is re-opened', async () => {
        render(Lightbox);

        // Open lightbox and open the collections panel
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('true');

        // Close the lightbox (panel is still open at this point)
        lightboxStore.close();
        await tick();
        expect(screen.queryByRole('dialog')).toBeNull();

        // Re-open the lightbox
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));

        // Collections panel must start closed
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('false');
    });

    it('closing via the Close button resets the collections panel for the next open', async () => {
        const { container } = render(Lightbox);

        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('true');

        // When the collections panel is also open there are two "Close" buttons in
        // the DOM (lightbox's own + CollectionsPanel's). Target the lightbox topbar one.
        const closeBtn = container.querySelector('.lightbox-topbar [aria-label="Close"]');
        await fireEvent.click(closeBtn as HTMLElement);
        await tick();

        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('false');
    });

    it('pressing Escape resets the collections panel for the next open', async () => {
        render(Lightbox);

        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('true');

        await fireEvent.keyDown(window, { key: 'Escape' });
        await tick();

        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('false');
    });

    it('navigating to the next image closes the collections panel', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('true');

        await fireEvent.keyDown(window, { key: 'ArrowRight' });

        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('false');
    });

    it('navigating to the previous image closes the collections panel', async () => {
        render(Lightbox);
        lightboxStore.show(img2, twoItems); // start at second item so prev is available
        await waitFor(() => screen.getByRole('button', { name: 'Collections' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('true');

        await fireEvent.keyDown(window, { key: 'ArrowLeft' });

        expect(
            screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-pressed')
        ).toBe('false');
    });
});
