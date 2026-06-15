import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import MergeTagsModal from '$lib/components/gallery/MergeTagsModal.svelte';
import type { MediaFile } from '$lib/api/types';

const mocks = vi.hoisted(() => ({
    getBatch: vi.fn(),
    bulkAdd: vi.fn(),
    getSelectedItems: vi.fn(),
    updateItem: vi.fn()
}));

vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: {
        getSelectedItems: mocks.getSelectedItems,
        updateItem: mocks.updateItem
    }
}));

vi.mock('$lib/api/client', () => ({
    tags: {
        getBatch: mocks.getBatch,
        bulkAdd: mocks.bulkAdd
    }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));

import { toastStore } from '$lib/stores/toast.svelte';

function makeItem(id: number, path: string): MediaFile {
    return { id, name: path.slice(1), path, parentPath: '/', type: 'image', size: 0, modTime: '' };
}

const itemA = makeItem(1, '/a.jpg');
const itemB = makeItem(2, '/b.jpg');
const itemC = makeItem(3, '/c.jpg');

describe('MergeTagsModal — loading and rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSelectedItems.mockReturnValue([itemA, itemB]);
        mocks.getBatch.mockResolvedValue({
            '/a.jpg': ['vacation', 'beach'],
            '/b.jpg': ['vacation', 'city']
        });
        mocks.bulkAdd.mockResolvedValue({ success: 2, failed: 0 });
    });

    it('shows loading state initially', () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        expect(screen.getByText('Loading…')).toBeTruthy();
    });

    it('shows all tags as chips after loading', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByText('vacation')).toBeTruthy();
        expect(screen.getByText('beach')).toBeTruthy();
        expect(screen.getByText('city')).toBeTruthy();
    });

    it('all chips are selected by default', async () => {
        const { container } = render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const onChips = container.querySelectorAll('.mt-chip--on');
        expect(onChips.length).toBe(3);
    });

    it('shows dialog role and accessible label', () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        expect(screen.getByRole('dialog', { name: /merge tags/i })).toBeTruthy();
    });

    it('shows item count in title', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByText(/merge tags.*2 items/i)).toBeTruthy();
    });
});

describe('MergeTagsModal — partial tag indicators', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSelectedItems.mockReturnValue([itemA, itemB, itemC]);
        mocks.getBatch.mockResolvedValue({
            '/a.jpg': ['vacation', 'beach'],
            '/b.jpg': ['vacation'],
            '/c.jpg': ['vacation']
        });
        mocks.bulkAdd.mockResolvedValue({ success: 3, failed: 0 });
    });

    it('shows (n/total) count for tags not on all items', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        // 'beach' is only on 1 of 3 items
        expect(screen.getByText('(1/3)')).toBeTruthy();
    });

    it('does not show count for tags on all items', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        // 'vacation' is on all 3 items — no count chip
        expect(screen.queryByText('(3/3)')).toBeNull();
    });
});

describe('MergeTagsModal — chip interactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSelectedItems.mockReturnValue([itemA, itemB]);
        mocks.getBatch.mockResolvedValue({
            '/a.jpg': ['vacation', 'beach'],
            '/b.jpg': ['vacation']
        });
        mocks.bulkAdd.mockResolvedValue({ success: 2, failed: 0 });
    });

    it('clicking a chip toggles it off', async () => {
        const { container } = render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const vacationChip = [...container.querySelectorAll('.mt-chip')].find((el) =>
            el.textContent?.includes('vacation')
        ) as HTMLElement;
        expect(vacationChip.classList.contains('mt-chip--on')).toBe(true);
        await fireEvent.click(vacationChip);
        expect(vacationChip.classList.contains('mt-chip--on')).toBe(false);
    });

    it('clicking a deselected chip toggles it back on', async () => {
        const { container } = render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const chip = [...container.querySelectorAll('.mt-chip')].find((el) =>
            el.textContent?.includes('vacation')
        ) as HTMLElement;
        await fireEvent.click(chip); // off
        await fireEvent.click(chip); // on again
        expect(chip.classList.contains('mt-chip--on')).toBe(true);
    });

    it('"Select none" deselects all chips', async () => {
        const { container } = render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(screen.getByText('Select none'));
        expect(container.querySelectorAll('.mt-chip--on').length).toBe(0);
    });

    it('"Select all" re-selects all chips after deselecting', async () => {
        const { container } = render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(screen.getByText('Select none'));
        await fireEvent.click(screen.getByText('Select all'));
        const total = container.querySelectorAll('.mt-chip').length;
        expect(container.querySelectorAll('.mt-chip--on').length).toBe(total);
    });
});

describe('MergeTagsModal — adding new tags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSelectedItems.mockReturnValue([itemA, itemB]);
        mocks.getBatch.mockResolvedValue({ '/a.jpg': ['vacation'], '/b.jpg': ['vacation'] });
        mocks.bulkAdd.mockResolvedValue({ success: 2, failed: 0 });
    });

    it('typing and pressing Add inserts a new chip', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const input = screen.getByPlaceholderText('Add a tag…');
        await fireEvent.input(input, { target: { value: 'portrait' } });
        await fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
        expect(screen.getByText('portrait')).toBeTruthy();
    });

    it('Enter in the input adds the tag', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const input = screen.getByPlaceholderText('Add a tag…');
        await fireEvent.input(input, { target: { value: 'nature' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByText('nature')).toBeTruthy();
    });

    it('new tag chip has the "new" badge', async () => {
        const { container } = render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const input = screen.getByPlaceholderText('Add a tag…');
        await fireEvent.input(input, { target: { value: 'portrait' } });
        await fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
        const newChip = [...container.querySelectorAll('.mt-chip')].find((el) =>
            el.textContent?.includes('portrait')
        );
        expect(newChip?.classList.contains('mt-chip--new')).toBe(true);
    });

    it('Add button is disabled when input is empty', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const addBtn = screen.getByRole('button', { name: /^add$/i });
        expect((addBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('input clears after adding a tag', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const input = screen.getByPlaceholderText('Add a tag…') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'portrait' } });
        await fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
        expect(input.value).toBe('');
    });
});

describe('MergeTagsModal — merge confirmation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSelectedItems.mockReturnValue([itemA, itemB]);
        mocks.getBatch.mockResolvedValue({
            '/a.jpg': ['vacation', 'beach'],
            '/b.jpg': ['vacation']
        });
        mocks.bulkAdd.mockResolvedValue({ success: 2, failed: 0 });
    });

    it('Merge button shows selected tag count', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        // 'vacation' + 'beach' = 2 selected
        expect(screen.getByRole('button', { name: /merge 2 tags/i })).toBeTruthy();
    });

    it('Merge button is disabled when no tags selected', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(screen.getByText('Select none'));
        const btn = screen.getByRole('button', { name: /merge/i });
        expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    it('clicking Merge calls bulkAdd with correct paths and tags', async () => {
        const onclose = vi.fn();
        render(MergeTagsModal, { onclose });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(screen.getByRole('button', { name: /merge 2 tags/i }));
        await waitFor(() => expect(mocks.bulkAdd).toHaveBeenCalledOnce());
        const call = mocks.bulkAdd.mock.calls[0][0];
        expect(call.paths).toEqual(expect.arrayContaining(['/a.jpg', '/b.jpg']));
        expect(call.tags).toEqual(expect.arrayContaining(['vacation', 'beach']));
    });

    it('shows success toast and calls onclose after merge', async () => {
        const onclose = vi.fn();
        render(MergeTagsModal, { onclose });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(screen.getByRole('button', { name: /merge 2 tags/i }));
        await waitFor(() => expect(onclose).toHaveBeenCalledOnce());
        expect(toastStore.success).toHaveBeenCalled();
    });

    it('shows error toast and stays open when bulkAdd fails', async () => {
        mocks.bulkAdd.mockRejectedValue(new Error('server error'));
        const onclose = vi.fn();
        render(MergeTagsModal, { onclose });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(screen.getByRole('button', { name: /merge 2 tags/i }));
        await waitFor(() => expect(toastStore.error).toHaveBeenCalled());
        expect(onclose).not.toHaveBeenCalled();
    });
});

describe('MergeTagsModal — empty state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSelectedItems.mockReturnValue([itemA, itemB]);
        mocks.getBatch.mockResolvedValue({ '/a.jpg': [], '/b.jpg': [] });
        mocks.bulkAdd.mockResolvedValue({ success: 2, failed: 0 });
    });

    it('shows empty state message when no tags exist', async () => {
        render(MergeTagsModal, { onclose: vi.fn() });
        await waitFor(() =>
            expect(screen.getByText(/no existing tags across these items/i)).toBeTruthy()
        );
    });
});

describe('MergeTagsModal — close actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSelectedItems.mockReturnValue([itemA, itemB]);
        mocks.getBatch.mockResolvedValue({ '/a.jpg': ['vacation'], '/b.jpg': ['vacation'] });
        mocks.bulkAdd.mockResolvedValue({ success: 2, failed: 0 });
    });

    it('Cancel button calls onclose', async () => {
        const onclose = vi.fn();
        render(MergeTagsModal, { onclose });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onclose).toHaveBeenCalledOnce();
    });

    it('close (×) button calls onclose', async () => {
        const onclose = vi.fn();
        render(MergeTagsModal, { onclose });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onclose).toHaveBeenCalledOnce();
    });

    it('backdrop click calls onclose', async () => {
        const onclose = vi.fn();
        const { container } = render(MergeTagsModal, { onclose });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(container.querySelector('.mt-backdrop') as HTMLElement);
        expect(onclose).toHaveBeenCalledOnce();
    });
});
