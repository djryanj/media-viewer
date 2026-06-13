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

// ── System tab ────────────────────────────────────────────────────────────────

describe('SettingsModal — system tab', () => {
    it('renders worker status rows', async () => {
        render(SettingsModal);
        await clickTab('system');

        expect(screen.getByText('Indexer')).toBeTruthy();
        expect(screen.getByText('Thumbnails')).toBeTruthy();
        expect(screen.getByText('Auto-tagger')).toBeTruthy();
    });

    it('renders library maintenance action buttons', async () => {
        render(SettingsModal);
        await clickTab('system');

        // Actions are labelled "Run now" / "Rebuild" / "Clear cache" in the buttons;
        // the descriptive text ("Reindex library", "Run auto-tagger") is in adjacent spans.
        const runNowBtns = screen.getAllByRole('button', { name: /run now/i });
        expect(runNowBtns.length).toBeGreaterThanOrEqual(2);
        expect(screen.getByRole('button', { name: /^rebuild$/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /clear cache/i })).toBeTruthy();
        expect(screen.getByText(/reindex library/i)).toBeTruthy();
        expect(screen.getByText(/run auto-tagger/i)).toBeTruthy();
    });

    it('"Run now" reindex button calls system.reindex', async () => {
        render(SettingsModal);
        await clickTab('system');

        // First "Run now" button is the reindex action.
        const runNowBtns = screen.getAllByRole('button', { name: /run now/i });
        await fireEvent.click(runNowBtns[0]);

        await waitFor(() => expect(mocks.systemReindex).toHaveBeenCalledOnce());
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Reindex started');
    });

    it('"Rebuild" button calls system.rebuildThumbnails', async () => {
        render(SettingsModal);
        await clickTab('system');

        await fireEvent.click(screen.getByRole('button', { name: /^rebuild$/i }));

        await waitFor(() => expect(mocks.systemRebuildThumbnails).toHaveBeenCalledOnce());
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Thumbnail rebuild started');
    });

    it('"Clear cache" button calls system.clearTranscodeCache', async () => {
        render(SettingsModal);
        await clickTab('system');

        await fireEvent.click(screen.getByRole('button', { name: /clear cache/i }));

        await waitFor(() => expect(mocks.systemClearTranscodeCache).toHaveBeenCalledOnce());
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Transcode cache cleared');
    });

    it('"Run now" auto-tagger button calls system.runAutoTagger', async () => {
        render(SettingsModal);
        await clickTab('system');

        // Two "Run now" buttons exist: reindex and autotagger. Click the last one.
        const runNowBtns = screen.getAllByRole('button', { name: /run now/i });
        await fireEvent.click(runNowBtns[runNowBtns.length - 1]);

        await waitFor(() => expect(mocks.systemRunAutoTagger).toHaveBeenCalledOnce());
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Auto-tagger started');
    });

    it('shows an error toast when a system action fails', async () => {
        mocks.systemReindex.mockRejectedValueOnce(new Error('Server error'));
        render(SettingsModal);
        await clickTab('system');

        const runNowBtns = screen.getAllByRole('button', { name: /run now/i });
        await fireEvent.click(runNowBtns[0]);

        await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Server error'));
    });

    it('shows cache sizes when systemStatus is available', async () => {
        mocks.systemStatus.mockResolvedValue({
            library: {
                totalFiles: 100, totalImages: 80, totalVideos: 20,
                totalFolders: 5, totalPlaylists: 0, totalTags: 10,
                totalFavorites: 3,
                thumbnailCacheFiles: 80, thumbnailCacheBytes: 1048576,
                transcodeCacheFiles: 2, transcodeCacheBytes: 2097152
            },
            indexer:    { summary: { running: false, enabled: true }, metrics: { processedItems: 0 } },
            thumbnails: { summary: { running: false, enabled: true }, metrics: { processedItems: 0 } },
            autotagger: { summary: { running: false, enabled: true }, metrics: { processedItems: 0 } }
        });

        render(SettingsModal);
        await clickTab('system');

        await waitFor(() => expect(screen.getByText(/1\.0 MB/i)).toBeTruthy());
    });
});
