import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import { ApiError } from '$lib/api/client';
import LoginPage from '../../routes/login/+page.svelte';

const mocks = vi.hoisted(() => ({
    webauthnAvailable: vi.fn(),
    webauthnLoginBegin: vi.fn(),
    webauthnLoginFinish: vi.fn(),
    authCheck: vi.fn(),
    isWebAuthnSupported: vi.fn(),
    prepareGetOptions: vi.fn(),
    credentialsGet: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/api/client', () => ({
    auth: {
        webauthnAvailable: mocks.webauthnAvailable,
        webauthnLoginBegin: mocks.webauthnLoginBegin,
        webauthnLoginFinish: mocks.webauthnLoginFinish,
        login: vi.fn(),
        setup: vi.fn()
    },
    ApiError: class ApiError extends Error {
        status: number;
        constructor(status: number, message: string) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
        }
    }
}));

vi.mock('$lib/stores/auth.svelte', () => ({
    authStore: { setupRequired: false, check: mocks.authCheck, login: vi.fn(), setup: vi.fn() }
}));

vi.mock('$lib/utils/webauthn', () => ({
    isWebAuthnSupported: mocks.isWebAuthnSupported,
    prepareGetOptions: mocks.prepareGetOptions
}));

const fakeBeginResponse = {
    options: { publicKey: { challenge: 'abc123', timeout: 60000 } },
    sessionId: 'test-session-id'
};

const fakeCredential = {
    id: 'cred-abc',
    type: 'public-key',
    rawId: new ArrayBuffer(8)
} as unknown as PublicKeyCredential;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isWebAuthnSupported.mockReturnValue(true);
    mocks.prepareGetOptions.mockImplementation((opts: unknown) => opts);
    mocks.webauthnAvailable.mockResolvedValue({ available: false });
    mocks.webauthnLoginBegin.mockResolvedValue(fakeBeginResponse);
    mocks.credentialsGet.mockResolvedValue(null);
    mocks.webauthnLoginFinish.mockResolvedValue(undefined);
    mocks.authCheck.mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'credentials', {
        value: { get: mocks.credentialsGet },
        configurable: true,
        writable: true
    });
    Object.defineProperty(window, 'PublicKeyCredential', {
        value: { isConditionalMediationAvailable: vi.fn().mockResolvedValue(false) },
        configurable: true,
        writable: true
    });
});

describe('Login page — passkey auto-trigger', () => {
    it('does not check for passkeys or render the passkey button when WebAuthn is unsupported', async () => {
        mocks.isWebAuthnSupported.mockReturnValue(false);
        render(LoginPage);
        await new Promise((r) => setTimeout(r, 20));
        expect(mocks.webauthnAvailable).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /sign in with a passkey/i })).toBeNull();
    });

    it('does not auto-trigger or show the passkey button when no passkeys are registered', async () => {
        mocks.webauthnAvailable.mockResolvedValue({ available: false });
        render(LoginPage);
        await waitFor(() => expect(mocks.webauthnAvailable).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: /sign in with a passkey/i })).toBeNull();
        expect(mocks.webauthnLoginBegin).not.toHaveBeenCalled();
    });

    it('immediately calls credentials.get without conditional mediation when passkeys are available', async () => {
        mocks.webauthnAvailable.mockResolvedValue({ available: true });
        mocks.credentialsGet.mockReturnValue(new Promise(() => {}));
        render(LoginPage);
        await waitFor(() => expect(mocks.credentialsGet).toHaveBeenCalled());
        const callArg = mocks.credentialsGet.mock.calls[0][0] as CredentialRequestOptions;
        expect(callArg.mediation).toBeUndefined();
        expect(callArg.publicKey).toBeDefined();
    });

    it('shows the passkey button in a disabled loading state while the auto-trigger is pending', async () => {
        mocks.webauthnAvailable.mockResolvedValue({ available: true });
        mocks.credentialsGet.mockReturnValue(new Promise(() => {}));
        render(LoginPage);
        await waitFor(() => expect(mocks.credentialsGet).toHaveBeenCalled());
        const btn = screen.getByRole('button', {
            name: /sign in with a passkey/i
        }) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('completes login and navigates to "/" when auto-triggered passkey authentication succeeds', async () => {
        mocks.webauthnAvailable.mockResolvedValue({ available: true });
        mocks.credentialsGet.mockResolvedValue(fakeCredential);
        render(LoginPage);
        await waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
        expect(mocks.webauthnLoginFinish).toHaveBeenCalledWith(
            fakeBeginResponse.sessionId,
            fakeCredential
        );
        expect(mocks.authCheck).toHaveBeenCalled();
    });

    it('shows no error and re-enables the button when the auto-triggered prompt is dismissed', async () => {
        mocks.webauthnAvailable.mockResolvedValue({ available: true });
        const cancelled = Object.assign(new Error('Not allowed'), { name: 'NotAllowedError' });
        mocks.credentialsGet.mockRejectedValue(cancelled);
        render(LoginPage);
        await waitFor(() => {
            expect(
                (
                    screen.getByRole('button', {
                        name: /sign in with a passkey/i
                    }) as HTMLButtonElement
                ).disabled
            ).toBe(false);
        });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows an error message when the auto-trigger finish step fails with an API error', async () => {
        mocks.webauthnAvailable.mockResolvedValue({ available: true });
        mocks.credentialsGet.mockResolvedValue(fakeCredential);
        mocks.webauthnLoginFinish.mockRejectedValue(new ApiError(500, 'Server error'));
        render(LoginPage);
        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
        expect(screen.getByRole('alert').textContent).toContain('Server error');
    });

    it('shows a cancellation error when the user dismisses the manual passkey prompt', async () => {
        mocks.webauthnAvailable.mockResolvedValue({ available: true });
        const cancelled = Object.assign(new Error('Not allowed'), { name: 'NotAllowedError' });
        mocks.credentialsGet.mockRejectedValue(cancelled);
        render(LoginPage);

        // Wait for auto-trigger to fail silently and re-enable the button
        await waitFor(() => {
            expect(
                (
                    screen.getByRole('button', {
                        name: /sign in with a passkey/i
                    }) as HTMLButtonElement
                ).disabled
            ).toBe(false);
        });

        await fireEvent.click(screen.getByRole('button', { name: /sign in with a passkey/i }));

        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain(
                'Passkey authentication was cancelled'
            );
        });
    });
});
