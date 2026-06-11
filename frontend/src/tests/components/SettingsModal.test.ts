import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SettingsModal from '$lib/components/settings/SettingsModal.svelte';

// Hoist mock refs so they are accessible inside vi.mock factories.
const mocks = vi.hoisted(() => ({
    listPasskeys: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
    auth: {
        listPasskeys: mocks.listPasskeys,
        changePassword: vi.fn()
    },
    tags: { list: vi.fn().mockResolvedValue([]) },
    system: {
        status: vi.fn().mockResolvedValue(null),
        reindex: vi.fn(),
        rebuildThumbnails: vi.fn(),
        clearTranscodeCache: vi.fn(),
        runAutoTagger: vi.fn()
    },
    version: { get: vi.fn().mockResolvedValue(null) }
}));

// The modal renders only when settingsStore.open is true.
vi.mock('$lib/stores/settings.svelte', () => ({
    settingsStore: { open: true, hide: vi.fn() }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { success: mocks.toastSuccess, error: mocks.toastError }
}));

vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: { sort: 'name', order: 'asc', setSort: vi.fn() }
}));

vi.mock('$lib/utils/webauthn', () => ({
    isWebAuthnSupported: () => true,
    prepareCreateOptions: vi.fn(),
    serializeCreateCredential: vi.fn()
}));

async function clickPasskeysTab() {
    const tab = screen.getByRole('tab', { name: /passkeys/i });
    await fireEvent.click(tab);
}

describe('SettingsModal — passkeys tab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('loads and renders passkeys when the tab is activated', async () => {
        mocks.listPasskeys.mockResolvedValue([
            { id: 1, name: 'MacBook', createdAt: '2024-01-01T00:00:00Z' },
            { id: 2, name: 'iPhone', createdAt: '2024-06-01T00:00:00Z' }
        ]);

        render(SettingsModal);
        await clickPasskeysTab();

        await waitFor(() => {
            expect(screen.getByText('MacBook')).toBeTruthy();
            expect(screen.getByText('iPhone')).toBeTruthy();
        });
        expect(mocks.listPasskeys).toHaveBeenCalledOnce();
    });

    it('shows empty-state copy when the server returns no passkeys', async () => {
        mocks.listPasskeys.mockResolvedValue([]);

        render(SettingsModal);
        await clickPasskeysTab();

        await waitFor(() => {
            expect(screen.getByText('No passkeys registered yet.')).toBeTruthy();
        });
    });

    it('does not re-fetch when switching away from and back to the passkeys tab', async () => {
        mocks.listPasskeys.mockResolvedValue([]);

        render(SettingsModal);
        await clickPasskeysTab();
        await waitFor(() => expect(screen.getByText('No passkeys registered yet.')).toBeTruthy());

        // Navigate away then back.
        await fireEvent.click(screen.getByRole('tab', { name: /security/i }));
        await fireEvent.click(screen.getByRole('tab', { name: /passkeys/i }));

        // passkeysHaveBeenLoaded is still true — must not call again.
        expect(mocks.listPasskeys).toHaveBeenCalledOnce();
    });

    it('blocks registration and shows an error when the name field is empty', async () => {
        mocks.listPasskeys.mockResolvedValue([]);

        render(SettingsModal);
        await clickPasskeysTab();
        await waitFor(() => expect(screen.getByText('No passkeys registered yet.')).toBeTruthy());

        // Clear the pre-filled name.
        const nameInput = screen.getByLabelText(/passkey name/i);
        await fireEvent.input(nameInput, { target: { value: '' } });

        await fireEvent.click(screen.getByRole('button', { name: /add passkey/i }));

        expect(mocks.toastError).toHaveBeenCalledWith('Please enter a name for this passkey');
    });

    it('shows "Loading passkeys…" while the request is in-flight', async () => {
        // Delay the resolution so we can observe the loading state.
        let resolve!: (v: never[]) => void;
        mocks.listPasskeys.mockReturnValue(new Promise((r) => (resolve = r)));

        render(SettingsModal);
        await clickPasskeysTab();

        expect(screen.getByText('Loading passkeys…')).toBeTruthy();

        // Unblock and confirm loading text disappears.
        resolve([]);
        await waitFor(() =>
            expect(screen.queryByText('Loading passkeys…')).toBeNull()
        );
    });
});
