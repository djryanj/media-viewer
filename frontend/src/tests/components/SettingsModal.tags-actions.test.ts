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
    vi.unstubAllGlobals();
});

// ── Tags tab — rename/delete action tests ─────────────────────────────────────

describe('SettingsModal — tags tab (actions)', () => {
    it('clicking Rename shows the rename input', async () => {
        mocks.tagsList.mockResolvedValue([{ id: 1, name: 'nature', itemCount: 5, createdAt: '' }]);

        render(SettingsModal);
        await clickTab('tags');
        await waitFor(() => expect(screen.getByText('nature')).toBeTruthy());

        await fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));

        expect(screen.getByRole('textbox', { name: '' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^cancel$/i })).toBeTruthy();
    });

    it('committing a rename calls tagsApi.rename and reloads tags', async () => {
        mocks.tagsList.mockResolvedValue([{ id: 1, name: 'nature', itemCount: 5, createdAt: '' }]);

        render(SettingsModal);
        await clickTab('tags');
        await waitFor(() => expect(screen.getByText('nature')).toBeTruthy());

        await fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));

        const input = screen.getByRole('textbox', { name: '' });
        await fireEvent.input(input, { target: { value: 'landscape' } });
        await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        await waitFor(() => expect(mocks.tagsRename).toHaveBeenCalledWith('nature', 'landscape'));
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Tag renamed to "landscape"');
        expect(mocks.tagsList).toHaveBeenCalledTimes(2);
    });

    it('cancelling a rename restores the tag chip', async () => {
        mocks.tagsList.mockResolvedValue([{ id: 1, name: 'nature', itemCount: 5, createdAt: '' }]);

        render(SettingsModal);
        await clickTab('tags');
        await waitFor(() => expect(screen.getByText('nature')).toBeTruthy());

        await fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
        await fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

        expect(screen.getByText('nature')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
    });

    it('deleting a tag removes it from the list', async () => {
        mocks.tagsList.mockResolvedValue([{ id: 1, name: 'nature', itemCount: 5, createdAt: '' }]);
        // happy-dom doesn't provide window.confirm — stub it globally.
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

        render(SettingsModal);
        await clickTab('tags');
        await waitFor(() => expect(screen.getByText('nature')).toBeTruthy());

        await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

        await waitFor(() => expect(mocks.tagsDelete).toHaveBeenCalledWith('nature'));
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Tag "nature" deleted');
        await waitFor(() => expect(screen.queryByText('nature')).toBeNull());
    });

    it('delete is skipped when the user cancels the confirm dialog', async () => {
        mocks.tagsList.mockResolvedValue([{ id: 1, name: 'nature', itemCount: 5, createdAt: '' }]);
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));

        render(SettingsModal);
        await clickTab('tags');
        await waitFor(() => expect(screen.getByText('nature')).toBeTruthy());

        await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

        expect(mocks.tagsDelete).not.toHaveBeenCalled();
        expect(screen.getByText('nature')).toBeTruthy();
    });
});
