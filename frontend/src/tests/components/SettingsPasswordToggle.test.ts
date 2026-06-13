import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SettingsModal from '$lib/components/settings/SettingsModal.svelte';

const { listPasskeysMock, renamePasskeyMock } = vi.hoisted(() => ({
    listPasskeysMock: vi.fn().mockResolvedValue([]),
    renamePasskeyMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/api/client', () => ({
    auth: {
        changePassword: vi.fn(),
        webauthnAvailable: vi.fn().mockResolvedValue({ available: true }),
        listPasskeys: listPasskeysMock,
        renamePasskey: renamePasskeyMock
    },
    tags: { list: vi.fn().mockResolvedValue([]), rename: vi.fn(), delete: vi.fn() },
    system: {
        status: vi.fn().mockResolvedValue(null),
        reindex: vi.fn(),
        rebuildThumbnails: vi.fn(),
        clearTranscodeCache: vi.fn()
    },
    version: vi.fn().mockResolvedValue({ version: '1.0.0', commit: 'abc' })
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));

vi.mock('$lib/stores/settings.svelte', () => ({
    settingsStore: {
        open: true,
        hide: vi.fn(),
        subscribe: (fn: (v: boolean) => void) => {
            fn(true);
            return () => {};
        }
    }
}));

vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: { sort: 'name', order: 'asc', path: '/' }
}));

vi.mock('$lib/utils/webauthn', () => ({
    isWebAuthnSupported: vi.fn().mockReturnValue(true),
    prepareCreateOptions: vi.fn(),
    serializeCreateCredential: vi.fn()
}));

describe('Settings modal — password visibility toggles', () => {
    beforeEach(() => vi.clearAllMocks());

    it('password fields are masked by default', () => {
        const { container } = render(SettingsModal);
        const inputs = container.querySelectorAll('input[type="password"]');
        // Three password fields: current, new, confirm
        expect(inputs.length).toBe(3);
    });

    it('clicking Show password on current-pw field reveals it', async () => {
        const { container } = render(SettingsModal);
        const toggleBtns = container.querySelectorAll<HTMLButtonElement>('.pw-toggle');
        expect(toggleBtns.length).toBeGreaterThanOrEqual(3);
        await fireEvent.click(toggleBtns[0]);
        const currentPwInput = container.querySelector('#current-pw') as HTMLInputElement;
        expect(currentPwInput.type).toBe('text');
    });

    it('clicking Show password on new-pw field reveals it', async () => {
        const { container } = render(SettingsModal);
        const toggleBtns = container.querySelectorAll<HTMLButtonElement>('.pw-toggle');
        await fireEvent.click(toggleBtns[1]);
        const input = container.querySelector('#new-pw') as HTMLInputElement;
        expect(input.type).toBe('text');
    });

    it('clicking Show password on confirm-pw field reveals it', async () => {
        const { container } = render(SettingsModal);
        const toggleBtns = container.querySelectorAll<HTMLButtonElement>('.pw-toggle');
        await fireEvent.click(toggleBtns[2]);
        const input = container.querySelector('#confirm-pw') as HTMLInputElement;
        expect(input.type).toBe('text');
    });

    it('toggling Show a second time re-masks the field', async () => {
        const { container } = render(SettingsModal);
        const toggle = container.querySelectorAll<HTMLButtonElement>('.pw-toggle')[0];
        await fireEvent.click(toggle); // reveal
        await fireEvent.click(toggle); // mask again
        const input = container.querySelector('#current-pw') as HTMLInputElement;
        expect(input.type).toBe('password');
    });

    it('each toggle button has accessible label', () => {
        const { container } = render(SettingsModal);
        const toggleBtns = container.querySelectorAll<HTMLButtonElement>('.pw-toggle');
        for (const btn of toggleBtns) {
            expect(btn.getAttribute('aria-label')).toBeTruthy();
        }
    });
});

describe('Settings modal — passkey rename', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listPasskeysMock.mockResolvedValue([
            { id: 1, name: 'MacBook', createdAt: new Date().toISOString() }
        ]);
        renamePasskeyMock.mockResolvedValue(undefined);
    });

    it('shows a Rename button per passkey when passkeys are loaded', async () => {
        render(SettingsModal);
        const passkeyTab = screen.getByRole('tab', { name: 'Passkeys' });
        await fireEvent.click(passkeyTab);
        await waitFor(() => screen.getByText('MacBook'));
        expect(screen.getByRole('button', { name: /Rename/i })).toBeTruthy();
    });

    it('clicking Rename shows an inline input pre-filled with the passkey name', async () => {
        const { container } = render(SettingsModal);
        const passkeyTab = screen.getByRole('tab', { name: 'Passkeys' });
        await fireEvent.click(passkeyTab);
        await waitFor(() => screen.getByRole('button', { name: /Rename MacBook/i }));
        await fireEvent.click(screen.getByRole('button', { name: /Rename MacBook/i }));
        const input = container.querySelector('.rename-input') as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(input.value).toBe('MacBook');
    });

    it('submitting the rename form calls auth.renamePasskey', async () => {
        const { container } = render(SettingsModal);
        const passkeyTab = screen.getByRole('tab', { name: 'Passkeys' });
        await fireEvent.click(passkeyTab);
        await waitFor(() => screen.getByRole('button', { name: /Rename MacBook/i }));
        await fireEvent.click(screen.getByRole('button', { name: /Rename MacBook/i }));
        const input = container.querySelector('.rename-input') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'My Mac' } });
        await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(renamePasskeyMock).toHaveBeenCalledWith(1, 'My Mac'));
    });

    it('cancel hides the rename form without calling rename', async () => {
        const { container } = render(SettingsModal);
        const passkeyTab = screen.getByRole('tab', { name: 'Passkeys' });
        await fireEvent.click(passkeyTab);
        await waitFor(() => screen.getByRole('button', { name: /Rename MacBook/i }));
        await fireEvent.click(screen.getByRole('button', { name: /Rename MacBook/i }));
        await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(container.querySelector('.rename-input')).toBeNull();
        expect(renamePasskeyMock).not.toHaveBeenCalled();
    });
});
