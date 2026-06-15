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

// ── Passkeys tab ──────────────────────────────────────────────────────────────

describe('SettingsModal — passkeys tab', () => {
    it('loads and renders passkeys when the tab is activated', async () => {
        mocks.listPasskeys.mockResolvedValue([
            { id: 1, name: 'MacBook', createdAt: '2024-01-01T00:00:00Z' },
            { id: 2, name: 'iPhone', createdAt: '2024-06-01T00:00:00Z' }
        ]);

        render(SettingsModal);
        await clickTab('passkeys');

        await waitFor(() => {
            expect(screen.getByText('MacBook')).toBeTruthy();
            expect(screen.getByText('iPhone')).toBeTruthy();
        });
        expect(mocks.listPasskeys).toHaveBeenCalledOnce();
    });

    it('shows empty-state copy when the server returns no passkeys', async () => {
        render(SettingsModal);
        await clickTab('passkeys');

        await waitFor(() => {
            expect(screen.getByText('No passkeys registered yet.')).toBeTruthy();
        });
    });

    it('does not re-fetch when switching away from and back to the passkeys tab', async () => {
        render(SettingsModal);
        await clickTab('passkeys');
        await waitFor(() => expect(screen.getByText('No passkeys registered yet.')).toBeTruthy());

        await clickTab('security');
        await clickTab('passkeys');

        expect(mocks.listPasskeys).toHaveBeenCalledOnce();
    });

    it('blocks registration and shows an error when the name field is empty', async () => {
        render(SettingsModal);
        await clickTab('passkeys');
        await waitFor(() => expect(screen.getByText('No passkeys registered yet.')).toBeTruthy());

        const nameInput = screen.getByLabelText(/passkey name/i);
        await fireEvent.input(nameInput, { target: { value: '' } });
        await fireEvent.click(screen.getByRole('button', { name: /add passkey/i }));

        expect(mocks.toastError).toHaveBeenCalledWith('Please enter a name for this passkey');
    });

    it('shows "Loading passkeys…" while the request is in-flight', async () => {
        let resolve!: (v: never[]) => void;
        mocks.listPasskeys.mockReturnValue(new Promise((r) => (resolve = r)));

        render(SettingsModal);
        await clickTab('passkeys');

        expect(screen.getByText('Loading passkeys…')).toBeTruthy();

        resolve([]);
        await waitFor(() => expect(screen.queryByText('Loading passkeys…')).toBeNull());
    });
});

// ── Security tab ──────────────────────────────────────────────────────────────

describe('SettingsModal — security tab', () => {
    it('renders the password change form on the default (security) tab', () => {
        render(SettingsModal);
        expect(screen.getByLabelText('Current password')).toBeTruthy();
        expect(screen.getByLabelText('New password')).toBeTruthy();
        expect(screen.getByLabelText('Confirm new password')).toBeTruthy();
        expect(screen.getByRole('button', { name: /change password/i })).toBeTruthy();
    });

    it('shows an error when new passwords do not match', async () => {
        render(SettingsModal);
        await fireEvent.input(screen.getByLabelText('Current password'), {
            target: { value: 'oldpass' }
        });
        await fireEvent.input(screen.getByLabelText('New password'), {
            target: { value: 'newpass1' }
        });
        await fireEvent.input(screen.getByLabelText('Confirm new password'), {
            target: { value: 'different' }
        });
        await fireEvent.submit(
            screen.getByRole('button', { name: /change password/i }).closest('form')!
        );

        expect(mocks.toastError).toHaveBeenCalledWith('New passwords do not match');
        expect(mocks.changePassword).not.toHaveBeenCalled();
    });

    it('shows an error when new password is fewer than 6 characters', async () => {
        render(SettingsModal);
        await fireEvent.input(screen.getByLabelText('Current password'), {
            target: { value: 'oldpass' }
        });
        await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'abc' } });
        await fireEvent.input(screen.getByLabelText('Confirm new password'), {
            target: { value: 'abc' }
        });
        await fireEvent.submit(
            screen.getByRole('button', { name: /change password/i }).closest('form')!
        );

        expect(mocks.toastError).toHaveBeenCalledWith('New password must be at least 6 characters');
        expect(mocks.changePassword).not.toHaveBeenCalled();
    });

    it('calls changePassword and shows a success toast on valid submission', async () => {
        render(SettingsModal);
        await fireEvent.input(screen.getByLabelText('Current password'), {
            target: { value: 'oldpass' }
        });
        await fireEvent.input(screen.getByLabelText('New password'), {
            target: { value: 'newpassword' }
        });
        await fireEvent.input(screen.getByLabelText('Confirm new password'), {
            target: { value: 'newpassword' }
        });
        await fireEvent.submit(
            screen.getByRole('button', { name: /change password/i }).closest('form')!
        );

        await waitFor(() =>
            expect(mocks.changePassword).toHaveBeenCalledWith('oldpass', 'newpassword')
        );
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Password updated');
    });

    it('shows an error toast when the password change API fails', async () => {
        mocks.changePassword.mockRejectedValueOnce(new Error('Wrong password'));
        render(SettingsModal);
        await fireEvent.input(screen.getByLabelText('Current password'), {
            target: { value: 'wrong' }
        });
        await fireEvent.input(screen.getByLabelText('New password'), {
            target: { value: 'newpassword' }
        });
        await fireEvent.input(screen.getByLabelText('Confirm new password'), {
            target: { value: 'newpassword' }
        });
        await fireEvent.submit(
            screen.getByRole('button', { name: /change password/i }).closest('form')!
        );

        await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Wrong password'));
    });
});
