import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SettingsModal from '$lib/components/settings/SettingsModal.svelte';

const mocks = vi.hoisted(() => ({
    listPasskeys: vi.fn(),
    changePassword: vi.fn(),
    deletePasskey: vi.fn(),
    renamePasskey: vi.fn(),
    tagsList: vi.fn(),
    tagsRename: vi.fn(),
    tagsDelete: vi.fn(),
    systemStatus: vi.fn(),
    systemReindex: vi.fn(),
    systemRebuildThumbnails: vi.fn(),
    systemClearTranscodeCache: vi.fn(),
    systemRunAutoTagger: vi.fn(),
    versionGet: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    gallerySetSort: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
    auth: {
        listPasskeys: mocks.listPasskeys,
        changePassword: mocks.changePassword,
        deletePasskey: mocks.deletePasskey,
        renamePasskey: mocks.renamePasskey
    },
    tags: { list: mocks.tagsList, rename: mocks.tagsRename, delete: mocks.tagsDelete },
    system: {
        status: mocks.systemStatus,
        reindex: mocks.systemReindex,
        rebuildThumbnails: mocks.systemRebuildThumbnails,
        clearTranscodeCache: mocks.systemClearTranscodeCache,
        runAutoTagger: mocks.systemRunAutoTagger
    },
    version: { get: mocks.versionGet }
}));

vi.mock('$lib/stores/settings.svelte', () => ({
    settingsStore: { open: true, hide: vi.fn() }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { success: mocks.toastSuccess, error: mocks.toastError }
}));
vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: { sort: 'name', order: 'asc', setSort: mocks.gallerySetSort }
}));
vi.mock('$lib/utils/webauthn', () => ({
    isWebAuthnSupported: () => true,
    prepareCreateOptions: vi.fn(),
    serializeCreateCredential: vi.fn()
}));

async function clickTab(name: string) {
    const tab = screen.getByRole('tab', { name: new RegExp(name, 'i') });
    await fireEvent.click(tab);
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.clearAllMocks();
    localStorage.clear();
    mocks.listPasskeys.mockResolvedValue([]);
    mocks.tagsList.mockResolvedValue([]);
    mocks.systemStatus.mockResolvedValue(null);
    mocks.versionGet.mockResolvedValue(null);
    mocks.changePassword.mockResolvedValue(undefined);
    mocks.tagsRename.mockResolvedValue(undefined);
    mocks.tagsDelete.mockResolvedValue(undefined);
    mocks.systemReindex.mockResolvedValue(undefined);
    mocks.systemRebuildThumbnails.mockResolvedValue(undefined);
    mocks.systemClearTranscodeCache.mockResolvedValue(undefined);
    mocks.systemRunAutoTagger.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
});

// ── Tags tab — read/display tests ─────────────────────────────────────────────

describe('SettingsModal — tags tab (display)', () => {
    it('loads tags when the tab is activated', async () => {
        mocks.tagsList.mockResolvedValue([
            { id: 1, name: 'nature', itemCount: 5, createdAt: '' },
            { id: 2, name: 'portrait', itemCount: 3, createdAt: '' }
        ]);

        render(SettingsModal);
        await clickTab('tags');

        await waitFor(() => {
            expect(screen.getByText('nature')).toBeTruthy();
            expect(screen.getByText('portrait')).toBeTruthy();
        });
        expect(mocks.tagsList).toHaveBeenCalledOnce();
    });

    it('shows "No tags yet." when the list is empty', async () => {
        render(SettingsModal);
        await clickTab('tags');

        await waitFor(() => expect(screen.getByText('No tags yet.')).toBeTruthy());
    });

    it('shows loading state while fetching tags', async () => {
        let resolve!: (v: never[]) => void;
        mocks.tagsList.mockReturnValue(new Promise((r) => (resolve = r)));

        render(SettingsModal);
        await clickTab('tags');

        expect(screen.getByText('Loading tags…')).toBeTruthy();

        resolve([]);
        await waitFor(() => expect(screen.queryByText('Loading tags…')).toBeNull());
    });

    it('renders tag file counts', async () => {
        mocks.tagsList.mockResolvedValue([{ id: 1, name: 'nature', itemCount: 42, createdAt: '' }]);

        render(SettingsModal);
        await clickTab('tags');

        await waitFor(() => expect(screen.getByText('nature')).toBeTruthy());
        expect(screen.getByText('42')).toBeTruthy();
    });

    it('filter input hides non-matching tags', async () => {
        mocks.tagsList.mockResolvedValue([
            { id: 1, name: 'nature', itemCount: 5, createdAt: '' },
            { id: 2, name: 'portrait', itemCount: 3, createdAt: '' }
        ]);

        render(SettingsModal);
        await clickTab('tags');
        await waitFor(() => expect(screen.getByText('nature')).toBeTruthy());

        await fireEvent.input(screen.getByPlaceholderText(/filter tags/i), {
            target: { value: 'nat' }
        });

        expect(screen.getByText('nature')).toBeTruthy();
        expect(screen.queryByText('portrait')).toBeNull();
    });

    it('shows "No tags match your search." when filter has no results', async () => {
        mocks.tagsList.mockResolvedValue([{ id: 1, name: 'nature', itemCount: 5, createdAt: '' }]);

        render(SettingsModal);
        await clickTab('tags');
        await waitFor(() => expect(screen.getByText('nature')).toBeTruthy());

        await fireEvent.input(screen.getByPlaceholderText(/filter tags/i), {
            target: { value: 'zzz' }
        });

        expect(screen.getByText('No tags match your search.')).toBeTruthy();
    });
});
