import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
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

// ── About tab ─────────────────────────────────────────────────────────────────

describe('SettingsModal — about tab', () => {
    it('loads and renders build info on tab activation', async () => {
        mocks.versionGet.mockResolvedValue({
            version: 'v1.2.3',
            commit: 'abc1234def',
            goVersion: 'go1.22',
            os: 'linux',
            arch: 'amd64'
        });

        render(SettingsModal);
        await clickTab('about');

        await waitFor(() => expect(screen.getByText('v1.2.3')).toBeTruthy());
        expect(screen.getByText('abc1234')).toBeTruthy();
        expect(screen.getByText(/go1\.22.*linux\/amd64/i)).toBeTruthy();
    });

    it('renders library stats when systemStatus is available', async () => {
        mocks.systemStatus.mockResolvedValue({
            library: {
                totalFiles: 1234,
                totalImages: 800,
                totalVideos: 200,
                totalFolders: 50,
                totalPlaylists: 3,
                totalTags: 42,
                totalFavorites: 7,
                thumbnailCacheFiles: 800,
                thumbnailCacheBytes: 0,
                transcodeCacheFiles: 0,
                transcodeCacheBytes: 0
            },
            indexer: { summary: { running: false, enabled: true }, metrics: { processedItems: 0 } },
            thumbnails: {
                summary: { running: false, enabled: true },
                metrics: { processedItems: 0 }
            },
            autotagger: {
                summary: { running: false, enabled: true },
                metrics: { processedItems: 0 }
            }
        });

        render(SettingsModal);
        await clickTab('about');

        await waitFor(() => expect(screen.getByText('1,234')).toBeTruthy());
        expect(screen.getByText('800')).toBeTruthy();
        expect(screen.getByText('200')).toBeTruthy();
        expect(screen.getByText('42')).toBeTruthy();
        expect(screen.getByText('7')).toBeTruthy();
    });

    it('shows "Loading…" while fetching build info', async () => {
        let resolve!: (v: object) => void;
        mocks.versionGet.mockReturnValue(new Promise((r) => (resolve = r)));

        render(SettingsModal);
        await clickTab('about');

        expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);

        resolve({ version: 'v0', commit: 'abc', goVersion: 'go1', os: 'linux', arch: 'amd64' });
    });

    it('does not re-fetch build info when switching back to the about tab', async () => {
        mocks.versionGet.mockResolvedValue({
            version: 'v1.0.0',
            commit: 'aaa',
            goVersion: 'go1',
            os: 'linux',
            arch: 'amd64'
        });

        render(SettingsModal);
        await clickTab('about');
        await waitFor(() => expect(screen.getByText('v1.0.0')).toBeTruthy());

        await clickTab('security');
        await clickTab('about');

        expect(mocks.versionGet).toHaveBeenCalledOnce();
    });
});
