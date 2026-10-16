import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TagPanel from '$lib/components/ui/TagPanel.svelte';
import { tagClipboard } from '$lib/stores/tagClipboard.svelte';

const mocks = vi.hoisted(() => ({
    add: vi.fn(),
    remove: vi.fn(),
    bulkAdd: vi.fn(),
    bulkRemove: vi.fn(),
    goto: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
    tags: {
        add: mocks.add,
        remove: mocks.remove,
        bulkAdd: mocks.bulkAdd,
        bulkRemove: mocks.bulkRemove,
        related: vi.fn().mockResolvedValue([]),
        list: vi.fn().mockResolvedValue([])
    }
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: mocks.toastError, success: vi.fn(), show: vi.fn() }
}));

const one = [{ path: 'a.jpg', tags: ['red', 'blue'] }];
const three = [
    { path: 'a.jpg', tags: ['red', 'blue'] },
    { path: 'b.jpg', tags: ['red'] },
    { path: 'c.jpg', tags: ['red', 'green'] }
];

async function typeTag(name: string) {
    const input = screen.getByRole('combobox', { name: 'Tag input' });
    await fireEvent.input(input, { target: { value: name } });
    await fireEvent.keyDown(input, { key: 'Enter' });
}

describe('TagPanel — single item', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.add.mockResolvedValue(undefined);
        mocks.remove.mockResolvedValue(undefined);
        mocks.bulkAdd.mockResolvedValue({ success: 1, failed: 0 });
        mocks.bulkRemove.mockResolvedValue({ success: 1, failed: 0 });
        tagClipboard.clear();
    });

    it('shows the item tags as chips', () => {
        render(TagPanel, { items: one });
        expect(screen.getByText('red')).toBeTruthy();
        expect(screen.getByText('blue')).toBeTruthy();
    });

    it('adds a tag with tags.add (not a whole-list overwrite) and reports the result', async () => {
        const onapply = vi.fn();
        render(TagPanel, { items: one, onapply });
        await typeTag('new');
        await waitFor(() => expect(mocks.add).toHaveBeenCalledWith({ path: 'a.jpg', tag: 'new' }));
        expect(onapply).toHaveBeenCalledWith({ 'a.jpg': ['red', 'blue', 'new'] });
    });

    it('removes a tag with tags.remove via the chip action menu', async () => {
        const onapply = vi.fn();
        render(TagPanel, { items: one, onapply });
        await fireEvent.click(screen.getByText('red'));
        await fireEvent.click(screen.getByRole('button', { name: 'Remove from item' }));
        await waitFor(() =>
            expect(mocks.remove).toHaveBeenCalledWith({ path: 'a.jpg', tag: 'red' })
        );
        expect(onapply).toHaveBeenCalledWith({ 'a.jpg': ['blue'] });
    });

    it('removes a tag with the × on the chip', async () => {
        render(TagPanel, { items: one });
        await fireEvent.click(screen.getByRole('button', { name: 'Remove tag blue' }));
        await waitFor(() =>
            expect(mocks.remove).toHaveBeenCalledWith({ path: 'a.jpg', tag: 'blue' })
        );
    });

    it('reverts the displayed tags and toasts when saving fails', async () => {
        mocks.add.mockRejectedValue(new Error('boom'));
        const onapply = vi.fn();
        render(TagPanel, { items: one, onapply });
        await typeTag('new');
        await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
        expect(onapply).not.toHaveBeenCalled();
        expect(screen.queryByText('new')).toBeNull();
    });

    it('paste merges the clipboard into the item', async () => {
        tagClipboard.copy(['blue', 'extra']);
        render(TagPanel, { items: one });
        await fireEvent.click(screen.getByRole('button', { name: 'Paste tags' }));
        await waitFor(() =>
            expect(mocks.add).toHaveBeenCalledWith({ path: 'a.jpg', tag: 'extra' })
        );
        expect(mocks.add).toHaveBeenCalledTimes(1);
    });
});

describe('TagPanel — chip actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.remove.mockResolvedValue(undefined);
    });

    it('tapping a chip opens an action menu instead of navigating', async () => {
        render(TagPanel, { items: one });
        await fireEvent.click(screen.getByText('red'));
        expect(screen.getByRole('group', { name: 'Actions for tag red' })).toBeTruthy();
        expect(mocks.goto).not.toHaveBeenCalled();
    });

    it('"Search" navigates to the tag search and tells the host', async () => {
        const onnavigate = vi.fn();
        render(TagPanel, { items: one, onnavigate });
        await fireEvent.click(screen.getByText('red'));
        await fireEvent.click(screen.getByRole('button', { name: 'Search for tag' }));
        expect(onnavigate).toHaveBeenCalled();
        expect(mocks.goto).toHaveBeenCalledWith('/search?q=tag%3Ared');
    });

    it('"Exclude" navigates to a search excluding the tag', async () => {
        render(TagPanel, { items: one });
        await fireEvent.click(screen.getByText('red'));
        await fireEvent.click(screen.getByRole('button', { name: 'Exclude from search' }));
        expect(mocks.goto).toHaveBeenCalledWith('/search?q=-tag%3Ared');
    });

    it('closing the menu leaves tags untouched', async () => {
        render(TagPanel, { items: one });
        await fireEvent.click(screen.getByText('red'));
        await fireEvent.click(screen.getByRole('button', { name: 'Close tag actions' }));
        expect(screen.queryByRole('group', { name: 'Actions for tag red' })).toBeNull();
        expect(mocks.remove).not.toHaveBeenCalled();
    });
});

describe('TagPanel — multiple items', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.bulkAdd.mockResolvedValue({ success: 3, failed: 0 });
        mocks.bulkRemove.mockResolvedValue({ success: 3, failed: 0 });
    });

    it('shows tags on every item as solid chips and others with a count', () => {
        render(TagPanel, { items: three });
        expect(screen.getByText('red')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'blue, on 1 of 3 items' }).textContent).toContain(
            '1/3'
        );
        expect(screen.getByRole('button', { name: 'green, on 1 of 3 items' })).toBeTruthy();
    });

    it('adds a tag to every item with one bulk call', async () => {
        const onapply = vi.fn();
        render(TagPanel, { items: three, onapply });
        await typeTag('new');
        await waitFor(() =>
            expect(mocks.bulkAdd).toHaveBeenCalledWith({
                paths: ['a.jpg', 'b.jpg', 'c.jpg'],
                tags: ['new']
            })
        );
        expect(onapply).toHaveBeenCalledWith({
            'a.jpg': ['red', 'blue', 'new'],
            'b.jpg': ['red', 'new'],
            'c.jpg': ['red', 'green', 'new']
        });
    });

    it('removing a common tag removes it from every item', async () => {
        render(TagPanel, { items: three });
        await fireEvent.click(screen.getByRole('button', { name: 'Remove tag red' }));
        await waitFor(() =>
            expect(mocks.bulkRemove).toHaveBeenCalledWith({
                paths: ['a.jpg', 'b.jpg', 'c.jpg'],
                tags: ['red']
            })
        );
    });

    it('"Add to all" promotes a partial tag to every item', async () => {
        const onapply = vi.fn();
        render(TagPanel, { items: three, onapply });
        await fireEvent.click(screen.getByRole('button', { name: 'blue, on 1 of 3 items' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Add to all' }));
        await waitFor(() =>
            expect(mocks.bulkAdd).toHaveBeenCalledWith({
                paths: ['a.jpg', 'b.jpg', 'c.jpg'],
                tags: ['blue']
            })
        );
        expect(onapply).toHaveBeenCalledWith({
            'a.jpg': ['red', 'blue'],
            'b.jpg': ['red', 'blue'],
            'c.jpg': ['red', 'green', 'blue']
        });
    });

    it('"Remove from all" strips a partial tag from every item', async () => {
        render(TagPanel, { items: three });
        await fireEvent.click(screen.getByRole('button', { name: 'green, on 1 of 3 items' }));
        await fireEvent.click(screen.getByRole('button', { name: 'Remove from all' }));
        await waitFor(() =>
            expect(mocks.bulkRemove).toHaveBeenCalledWith({
                paths: ['a.jpg', 'b.jpg', 'c.jpg'],
                tags: ['green']
            })
        );
    });
});
