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

// ── Library tab ───────────────────────────────────────────────────────────────

describe('SettingsModal — library tab', () => {
    it('renders the sort field and order selects', async () => {
        render(SettingsModal);
        await clickTab('library');

        expect(screen.getByLabelText(/sort by/i)).toBeTruthy();
        expect(screen.getByLabelText(/direction/i)).toBeTruthy();
    });

    it('renders the autoplay and loop toggles', async () => {
        render(SettingsModal);
        await clickTab('library');

        expect(screen.getByLabelText(/autoplay videos/i)).toBeTruthy();
        expect(screen.getByLabelText(/loop media/i)).toBeTruthy();
    });

    it('renders the clock enable toggle', async () => {
        render(SettingsModal);
        await clickTab('library');

        expect(screen.getByLabelText(/show clock in lightbox/i)).toBeTruthy();
    });

    it('clock format select is hidden when clock is disabled', async () => {
        localStorage.setItem('mediaViewerPreferences', JSON.stringify({ clockEnabled: false }));
        render(SettingsModal);
        await clickTab('library');

        expect(screen.queryByLabelText(/format/i)).toBeNull();
    });

    it('clock format select is visible when clock is enabled', async () => {
        localStorage.setItem('mediaViewerPreferences', JSON.stringify({ clockEnabled: true }));
        render(SettingsModal);
        await clickTab('library');

        await waitFor(() => expect(screen.getByLabelText(/format/i)).toBeTruthy());
    });

    it('Save preferences calls galleryStore.setSort and shows success toast', async () => {
        render(SettingsModal);
        await clickTab('library');

        await fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

        expect(mocks.gallerySetSort).toHaveBeenCalled();
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Preferences saved');
    });

    it('Save preferences persists sort field to localStorage', async () => {
        // Pre-populate so the component initialises prefSortField = 'date'.
        localStorage.setItem('mediaViewerPreferences', JSON.stringify({ sortField: 'date' }));
        render(SettingsModal);
        await clickTab('library');

        await fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

        const stored = JSON.parse(localStorage.getItem('mediaViewerPreferences') ?? '{}');
        expect(stored.sortField).toBe('date');
    });

    it('Save preferences persists clock format to localStorage', async () => {
        localStorage.setItem(
            'mediaViewerPreferences',
            JSON.stringify({ clockEnabled: true, clockFormat: '24' })
        );
        render(SettingsModal);
        await clickTab('library');

        await waitFor(() => expect(screen.getByLabelText(/format/i)).toBeTruthy());
        await fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

        const stored = JSON.parse(localStorage.getItem('mediaViewerPreferences') ?? '{}');
        expect(stored.clockFormat).toBe('24');
    });
});
