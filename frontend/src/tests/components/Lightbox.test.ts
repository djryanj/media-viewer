import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Lightbox from '$lib/components/lightbox/Lightbox.svelte';
import { lightboxStore } from '$lib/stores/lightbox.svelte';
import type { MediaFile } from '$lib/api/types';

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
const tagApi = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), setForFile: vi.fn() }));

vi.mock('$app/navigation', () => ({
    beforeNavigate: vi.fn(),
    goto: nav.goto
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
        ...tagApi,
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
        selected: new Set<string>(),
        items: [],
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

    it('Escape is marked handled so page-level Escape handlers do not also navigate up', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));
        const notCancelled = await fireEvent.keyDown(window, { key: 'Escape' });
        expect(notCancelled).toBe(false); // false => preventDefault() was called
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

describe('Lightbox — scroll to item on close', () => {
    let scrollIntoView1: ReturnType<typeof vi.fn>;
    let el1: HTMLElement;

    beforeEach(() => {
        lightboxStore.close();
        vi.clearAllMocks();

        scrollIntoView1 = vi.fn();
        el1 = document.createElement('div');
        el1.dataset.path = img1.path;
        el1.scrollIntoView = scrollIntoView1 as unknown as typeof el1.scrollIntoView;
        document.body.appendChild(el1);
    });

    afterEach(() => {
        el1.remove();
    });

    it('calls scrollIntoView on the matching gallery element when the lightbox closes', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));

        lightboxStore.close();
        await tick();

        expect(scrollIntoView1).toHaveBeenCalledOnce();
    });

    it('passes { block: "nearest", inline: "nearest" } to scrollIntoView', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));

        lightboxStore.close();
        await tick();

        expect(scrollIntoView1).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });

    it('scrolls to the last navigated item, not the originally opened one', async () => {
        const scrollIntoView2 = vi.fn();
        const el2 = document.createElement('div');
        el2.dataset.path = img2.path;
        el2.scrollIntoView = scrollIntoView2 as unknown as typeof el2.scrollIntoView;
        document.body.appendChild(el2);

        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));

        lightboxStore.next(); // navigate to img2
        await tick();

        lightboxStore.close();
        await tick();

        expect(scrollIntoView2).toHaveBeenCalledOnce();
        expect(scrollIntoView1).not.toHaveBeenCalled();

        el2.remove();
    });

    it('does nothing when no gallery element with a matching data-path exists', async () => {
        el1.remove(); // no element in the DOM for img1

        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));

        // Should not throw
        expect(() => lightboxStore.close()).not.toThrow();
        await tick();
    });

    it('does not call scrollIntoView while the lightbox is open', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));

        lightboxStore.next();
        await tick();

        expect(scrollIntoView1).not.toHaveBeenCalled();
    });

    it('scrolls to the correct item across multiple open/close cycles', async () => {
        const scrollIntoView2 = vi.fn();
        const el2 = document.createElement('div');
        el2.dataset.path = img2.path;
        el2.scrollIntoView = scrollIntoView2 as unknown as typeof el2.scrollIntoView;
        document.body.appendChild(el2);

        render(Lightbox);

        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));
        lightboxStore.close();
        await tick();
        expect(scrollIntoView1).toHaveBeenCalledTimes(1);
        expect(scrollIntoView2).not.toHaveBeenCalled();

        lightboxStore.show(img2, twoItems);
        await waitFor(() => screen.getByRole('dialog'));
        lightboxStore.close();
        await tick();
        expect(scrollIntoView2).toHaveBeenCalledTimes(1);
        expect(scrollIntoView1).toHaveBeenCalledTimes(1); // still only once from first cycle

        el2.remove();
    });

    it('resets scrollLeft to 0 on #main-content when the lightbox closes', async () => {
        const mainContent = document.createElement('div');
        mainContent.id = 'main-content';
        mainContent.scrollLeft = 200;
        document.body.appendChild(mainContent);

        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));

        lightboxStore.close();
        await tick();

        expect(mainContent.scrollLeft).toBe(0);
        mainContent.remove();
    });

    it('does not throw when #main-content is absent on close', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));
        expect(() => lightboxStore.close()).not.toThrow();
        await tick();
    });
});

describe('Lightbox — touchmove prevents native scroll', () => {
    beforeEach(() => {
        lightboxStore.close();
        vi.clearAllMocks();
    });

    it('calls e.preventDefault() on touchmove when the lightbox is open', async () => {
        render(Lightbox);
        lightboxStore.show(img1, twoItems);
        await waitFor(() => screen.getByRole('dialog'));

        const event = Object.assign(new Event('touchmove', { cancelable: true }), {
            touches: []
        });
        const preventSpy = vi.spyOn(event, 'preventDefault');
        window.dispatchEvent(event);

        expect(preventSpy).toHaveBeenCalledOnce();
    });

    it('does not call e.preventDefault() on touchmove when the lightbox is closed', async () => {
        render(Lightbox);

        const event = Object.assign(new Event('touchmove', { cancelable: true }), {
            touches: []
        });
        const preventSpy = vi.spyOn(event, 'preventDefault');
        window.dispatchEvent(event);

        expect(preventSpy).not.toHaveBeenCalled();
    });
});

describe('Lightbox — tag panel', () => {
    const tagged = { ...makeImage(3, '/tagged.jpg'), tags: ['red'] };

    beforeEach(() => {
        lightboxStore.close();
        vi.clearAllMocks();
        tagApi.add.mockResolvedValue(undefined);
        tagApi.remove.mockResolvedValue(undefined);
    });

    async function openTags() {
        render(Lightbox);
        lightboxStore.show(tagged, [tagged]);
        await waitFor(() => screen.getByRole('button', { name: 'Edit tags' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
    }

    it('adds a tag through the per-tag endpoint and updates the open item', async () => {
        await openTags();
        const input = screen.getByRole('combobox', { name: 'Tag input' });
        await fireEvent.input(input, { target: { value: 'blue' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() =>
            expect(tagApi.add).toHaveBeenCalledWith({ path: '/tagged.jpg', tag: 'blue' })
        );
        expect(tagApi.setForFile).not.toHaveBeenCalled();
        await waitFor(() => expect(lightboxStore.item?.tags).toEqual(['red', 'blue']));
    });

    it('tapping a tag offers actions; Search closes the lightbox and searches the tag', async () => {
        await openTags();
        await fireEvent.click(screen.getByText('red'));
        await fireEvent.click(screen.getByRole('button', { name: 'Search for tag' }));
        expect(lightboxStore.open).toBe(false);
        expect(nav.goto).toHaveBeenCalledWith('/search?q=tag%3Ared');
    });
});

describe('Lightbox — tag panel on touch devices', () => {
    const tagged = { ...makeImage(4, '/touch.jpg'), tags: ['red', 'blue'] };
    const realMatchMedia = window.matchMedia;

    function stubPointer(coarse: boolean) {
        window.matchMedia = ((query: string) => ({
            matches: query.includes('pointer: coarse') ? coarse : false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            onchange: null,
            dispatchEvent: vi.fn()
        })) as unknown as typeof window.matchMedia;
    }

    async function openTags() {
        render(Lightbox);
        lightboxStore.show(tagged, [tagged, img2]);
        await waitFor(() => screen.getByRole('button', { name: 'Edit tags' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await tick();
    }

    beforeEach(() => {
        lightboxStore.close();
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.matchMedia = realMatchMedia;
    });

    it('does not focus the tag input (and raise the keyboard) when opened by touch', async () => {
        stubPointer(true);
        await openTags();
        const input = screen.getByRole('combobox', { name: 'Tag input' });
        expect(document.activeElement).not.toBe(input);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('still focuses the tag input when opened with a mouse', async () => {
        stubPointer(false);
        await openTags();
        expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Tag input' }));
    });

    it('offers a Done button on touch that closes the panel', async () => {
        stubPointer(true);
        await openTags();
        await fireEvent.click(screen.getByRole('button', { name: 'Done editing tags' }));
        expect(screen.queryByRole('combobox', { name: 'Tag input' })).toBeNull();
    });

    it('has no Done button with a mouse', async () => {
        stubPointer(false);
        await openTags();
        expect(screen.queryByRole('button', { name: 'Done editing tags' })).toBeNull();
    });

    it('lets touch scrolling happen inside the tag panel (no preventDefault)', async () => {
        stubPointer(true);
        await openTags();
        const panel = document.querySelector('.lb-tag-panel') as HTMLElement;
        const move = new Event('touchmove', { bubbles: true, cancelable: true });
        Object.assign(move, { touches: [{ clientX: 10, clientY: 10 }] });
        panel.dispatchEvent(move);
        expect(move.defaultPrevented).toBe(false);
    });

    it('still blocks touch scrolling over the rest of the lightbox', async () => {
        stubPointer(true);
        await openTags();
        const dialog = screen.getByRole('dialog');
        const move = new Event('touchmove', { bubbles: true, cancelable: true });
        Object.assign(move, { touches: [{ clientX: 10, clientY: 10 }] });
        dialog.dispatchEvent(move);
        expect(move.defaultPrevented).toBe(true);
    });

    function swipe(target: Element, from: [number, number], to: [number, number]) {
        const mk = (type: string, [x, y]: [number, number]) => {
            const e = new Event(type, { bubbles: true, cancelable: true });
            const t = [{ clientX: x, clientY: y }];
            Object.assign(e, {
                touches: type === 'touchend' ? [] : t,
                changedTouches: t
            });
            return e;
        };
        target.dispatchEvent(mk('touchstart', from));
        target.dispatchEvent(mk('touchend', to));
    }

    it('a downward drag inside the tag panel does not close the lightbox', async () => {
        stubPointer(true);
        await openTags();
        swipe(document.querySelector('.lb-tag-panel') as Element, [100, 100], [100, 300]);
        expect(lightboxStore.open).toBe(true);
    });

    it('a sideways drag inside the tag panel does not change the item', async () => {
        stubPointer(true);
        await openTags();
        swipe(document.querySelector('.lb-tag-panel') as Element, [300, 100], [50, 100]);
        expect(lightboxStore.item?.path).toBe('/touch.jpg');
    });

    it('a downward swipe elsewhere still closes the lightbox', async () => {
        stubPointer(true);
        await openTags();
        swipe(screen.getByRole('dialog'), [100, 100], [100, 300]);
        expect(lightboxStore.open).toBe(false);
    });
});
