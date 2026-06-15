import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import CollectionsPanel from '$lib/components/lightbox/CollectionsPanel.svelte';
import type { Collection } from '$lib/api/types';

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    memberships: vi.fn(),
    addItems: vi.fn(),
    removeItems: vi.fn(),
    create: vi.fn()
}));

vi.mock('$lib/api/client', async (importOriginal) => {
    const { ApiError } = await importOriginal<typeof import('$lib/api/client')>();
    return {
        ApiError,
        collections: {
            list: mocks.list,
            memberships: mocks.memberships,
            addItems: mocks.addItems,
            removeItems: mocks.removeItems,
            create: mocks.create
        }
    };
});

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));

import { ApiError } from '$lib/api/client';
import { toastStore } from '$lib/stores/toast.svelte';

function makeCollection(id: number, name: string, itemCount = 0): Collection {
    return { id, name, itemCount, createdAt: '', updatedAt: '' };
}

function makeCollectionInFolder(id: number, name: string, folderPath: string): Collection {
    return { id, name, itemCount: 0, createdAt: '', updatedAt: '', folderPath };
}

const col1 = makeCollection(1, 'Vacation', 3);
const col2 = makeCollection(2, 'Family', 10);

describe('CollectionsPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.list.mockResolvedValue([col1, col2]);
        mocks.memberships.mockResolvedValue({});
        mocks.addItems.mockResolvedValue(undefined);
        mocks.removeItems.mockResolvedValue(undefined);
        mocks.create.mockResolvedValue({
            id: 3,
            name: 'New',
            itemCount: 1,
            createdAt: '',
            updatedAt: ''
        });
    });

    it('renders a dialog with the title "Collections" for a single item', async () => {
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByRole('dialog', { name: /collections/i })).toBeTruthy();
    });

    it('renders bulk title when multiple paths are given', async () => {
        render(CollectionsPanel, { itemPaths: ['/a.jpg', '/b.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByText(/collections.*2 items/i)).toBeTruthy();
    });

    it('shows a collection list after loading', async () => {
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => {
            expect(screen.getByText('Vacation')).toBeTruthy();
            expect(screen.getByText('Family')).toBeTruthy();
        });
    });

    it('shows "No collections yet." when list is empty', async () => {
        mocks.list.mockResolvedValue([]);
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.getByText('No collections yet.')).toBeTruthy());
    });

    it('close button calls onclose', async () => {
        const onclose = vi.fn();
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onclose).toHaveBeenCalledOnce();
    });

    it('backdrop click calls onclose', async () => {
        const onclose = vi.fn();
        const { container } = render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const backdrop = container.querySelector('.cp-backdrop') as HTMLElement;
        await fireEvent.click(backdrop);
        expect(onclose).toHaveBeenCalledOnce();
    });

    it('pressing Escape calls onclose', async () => {
        const onclose = vi.fn();
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        await fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(onclose).toHaveBeenCalledOnce();
    });

    it('clicking a non-member collection calls addItems', async () => {
        mocks.memberships.mockResolvedValue({ '/photo.jpg': [] });
        const { container } = render(CollectionsPanel, {
            itemPaths: ['/photo.jpg'],
            onclose: vi.fn()
        });
        await waitFor(() => expect(screen.getByText('Vacation')).toBeTruthy());
        await fireEvent.click(container.querySelector('.cp-item') as HTMLElement);
        await waitFor(() => expect(mocks.addItems).toHaveBeenCalledWith(1, ['/photo.jpg']));
    });

    it('clicking a full-member collection calls removeItems', async () => {
        mocks.memberships.mockResolvedValue({ '/photo.jpg': [1] });
        const { container } = render(CollectionsPanel, {
            itemPaths: ['/photo.jpg'],
            onclose: vi.fn()
        });
        await waitFor(() => expect(screen.getByText('Vacation')).toBeTruthy());
        await fireEvent.click(container.querySelector('.cp-item') as HTMLElement);
        await waitFor(() => expect(mocks.removeItems).toHaveBeenCalledWith(1, ['/photo.jpg']));
    });

    it('bulk: shows partial state when some but not all paths are members', async () => {
        mocks.memberships.mockResolvedValue({ '/a.jpg': [1], '/b.jpg': [] });
        const { container } = render(CollectionsPanel, {
            itemPaths: ['/a.jpg', '/b.jpg'],
            onclose: vi.fn()
        });
        await waitFor(() => expect(screen.getByText('Vacation')).toBeTruthy());
        expect(container.querySelector('.cp-item.partial')).toBeTruthy();
    });

    it('bulk: shows full-member state when all paths are members', async () => {
        mocks.memberships.mockResolvedValue({ '/a.jpg': [1], '/b.jpg': [1] });
        const { container } = render(CollectionsPanel, {
            itemPaths: ['/a.jpg', '/b.jpg'],
            onclose: vi.fn()
        });
        await waitFor(() => expect(screen.getByText('Vacation')).toBeTruthy());
        expect(container.querySelector('.cp-item.member')).toBeTruthy();
    });

    it('always renders the create-collection footer input', async () => {
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByPlaceholderText('New collection…')).toBeTruthy();
        expect(screen.getByRole('button', { name: /create collection/i })).toBeTruthy();
    });

    it('Create button is disabled when the input is empty', async () => {
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const btn = screen.getByRole('button', { name: /create collection/i });
        expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    it('typing a name enables the Create button', async () => {
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const input = screen.getByPlaceholderText('New collection…');
        await fireEvent.input(input, { target: { value: 'My Album' } });
        const btn = screen.getByRole('button', { name: /create collection/i });
        expect((btn as HTMLButtonElement).disabled).toBe(false);
    });

    it('clicking Create calls collectionsApi.create with name and itemPaths', async () => {
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const input = screen.getByPlaceholderText('New collection…');
        await fireEvent.input(input, { target: { value: 'Summer' } });
        await fireEvent.click(screen.getByRole('button', { name: /create collection/i }));
        await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('Summer', ['/photo.jpg']));
    });

    it('after creation the list reloads and the input is cleared', async () => {
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const callsBefore = mocks.list.mock.calls.length;
        const input = screen.getByPlaceholderText('New collection…');
        await fireEvent.input(input, { target: { value: 'Family' } });
        await fireEvent.click(screen.getByRole('button', { name: /create collection/i }));
        await waitFor(() => expect(mocks.list.mock.calls.length).toBeGreaterThan(callsBefore));
        expect((input as HTMLInputElement).value).toBe('');
    });

    it('pressing Enter in the input creates the collection', async () => {
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const input = screen.getByPlaceholderText('New collection…');
        await fireEvent.input(input, { target: { value: 'Road Trip' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('Road Trip', ['/photo.jpg']));
    });
});

describe('CollectionsPanel — folder filtering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.memberships.mockResolvedValue({});
    });

    it('shows collections with no folderPath for any item folder', async () => {
        mocks.list.mockResolvedValue([makeCollection(1, 'Global')]);
        render(CollectionsPanel, { itemPaths: ['/vacation/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.getByText('Global')).toBeTruthy());
    });

    it('shows collections whose folderPath matches the item folder', async () => {
        mocks.list.mockResolvedValue([makeCollectionInFolder(1, 'Vacation Album', '/vacation')]);
        render(CollectionsPanel, { itemPaths: ['/vacation/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.getByText('Vacation Album')).toBeTruthy());
    });

    it('hides collections whose folderPath does not match the item folder', async () => {
        mocks.list.mockResolvedValue([makeCollectionInFolder(1, 'Events', '/events')]);
        render(CollectionsPanel, { itemPaths: ['/vacation/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.queryByText('Events')).toBeNull();
    });

    it('hides root-scoped collections (folderPath="") when viewing items in a subfolder', async () => {
        // Root-scoped collections have folderPath='' — must not be treated as unconstrained
        mocks.list.mockResolvedValue([{ ...makeCollection(1, 'Root Album'), folderPath: '' }]);
        render(CollectionsPanel, { itemPaths: ['/vacation/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.queryByText('Root Album')).toBeNull();
    });

    it('shows root-scoped collections when viewing root-level items', async () => {
        mocks.list.mockResolvedValue([{ ...makeCollection(1, 'Root Album'), folderPath: '' }]);
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.getByText('Root Album')).toBeTruthy());
    });

    it('shows "No collections in this folder." when all collections are from other folders', async () => {
        mocks.list.mockResolvedValue([makeCollectionInFolder(1, 'Events', '/events')]);
        render(CollectionsPanel, { itemPaths: ['/vacation/photo.jpg'], onclose: vi.fn() });
        await waitFor(() =>
            expect(screen.getByText('No collections in this folder.')).toBeTruthy()
        );
        expect(screen.queryByText('No collections yet.')).toBeNull();
    });

    it('non-member items render no checkbox indicator', async () => {
        mocks.list.mockResolvedValue([makeCollection(1, 'Vacation')]);
        const { container } = render(CollectionsPanel, {
            itemPaths: ['/vacation/photo.jpg'],
            onclose: vi.fn()
        });
        await waitFor(() => expect(screen.getByText('Vacation')).toBeTruthy());
        expect(container.querySelector('.cp-empty-check')).toBeNull();
    });
});

describe('CollectionsPanel — error messages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.list.mockResolvedValue([col1, col2]);
        mocks.memberships.mockResolvedValue({ '/photo.jpg': [] });
        mocks.addItems.mockResolvedValue(undefined);
        mocks.removeItems.mockResolvedValue(undefined);
        mocks.create.mockResolvedValue({
            id: 3,
            name: 'New',
            itemCount: 1,
            createdAt: '',
            updatedAt: ''
        });
    });

    it('shows specific backend error from ApiError JSON body when addItems fails', async () => {
        mocks.addItems.mockRejectedValue(
            new ApiError(400, JSON.stringify({ error: "Collections can't span multiple folders." }))
        );
        const { container } = render(CollectionsPanel, {
            itemPaths: ['/photo.jpg'],
            onclose: vi.fn()
        });
        await waitFor(() => expect(screen.getByText('Vacation')).toBeTruthy());
        await fireEvent.click(container.querySelector('.cp-item') as HTMLElement);
        await waitFor(() =>
            expect(toastStore.error).toHaveBeenCalledWith(
                "Collections can't span multiple folders."
            )
        );
    });

    it('falls back to generic error when ApiError body is not JSON', async () => {
        mocks.addItems.mockRejectedValue(new ApiError(500, 'Internal Server Error'));
        const { container } = render(CollectionsPanel, {
            itemPaths: ['/photo.jpg'],
            onclose: vi.fn()
        });
        await waitFor(() => expect(screen.getByText('Vacation')).toBeTruthy());
        await fireEvent.click(container.querySelector('.cp-item') as HTMLElement);
        await waitFor(() =>
            expect(toastStore.error).toHaveBeenCalledWith('Failed to add to "Vacation"')
        );
    });

    it('shows specific backend error when createCollection fails with ApiError', async () => {
        mocks.create.mockRejectedValue(
            new ApiError(
                409,
                JSON.stringify({ error: 'A collection with that name already exists.' })
            )
        );
        render(CollectionsPanel, { itemPaths: ['/photo.jpg'], onclose: vi.fn() });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const input = screen.getByPlaceholderText('New collection…');
        await fireEvent.input(input, { target: { value: 'Vacation' } });
        await fireEvent.click(screen.getByRole('button', { name: /create collection/i }));
        await waitFor(() =>
            expect(toastStore.error).toHaveBeenCalledWith(
                'A collection with that name already exists.'
            )
        );
    });
});
