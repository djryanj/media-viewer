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

vi.mock('$lib/api/client', () => ({
    collections: {
        list: mocks.list,
        memberships: mocks.memberships,
        addItems: mocks.addItems,
        removeItems: mocks.removeItems,
        create: mocks.create
    }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));

function makeCollection(id: number, name: string, itemCount = 0): Collection {
    return { id, name, itemCount, createdAt: '', updatedAt: '' };
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
