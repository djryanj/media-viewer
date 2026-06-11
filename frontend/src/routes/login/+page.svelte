<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { authStore } from '$lib/stores/auth.svelte';
    import { goto } from '$app/navigation';
    import { auth as authApi, ApiError } from '$lib/api/client';
    import { isWebAuthnSupported, prepareGetOptions } from '$lib/utils/webauthn';

    let password = $state('');
    let confirmPassword = $state('');
    let error = $state('');
    let loading = $state(false);
    let passkeyLoading = $state(false);
    let passkeyAvailable = $state(false);
    let passwordInput = $state<HTMLInputElement | null>(null);

    const isSetup = $derived(authStore.setupRequired);
    const webauthnSupported = isWebAuthnSupported();

    // ── Password login ────────────────────────────────────────────────────────
    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (loading) return;
        error = '';

        if (isSetup && password !== confirmPassword) {
            error = 'Passwords do not match';
            return;
        }
        if (isSetup && password.length < 6) {
            error = 'Password must be at least 6 characters';
            return;
        }

        loading = true;
        try {
            if (isSetup) {
                await authStore.setup(password);
            } else {
                await authStore.login(password);
            }
            goto('/');
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                error = 'Incorrect password';
            } else if (err instanceof ApiError && err.status === 400) {
                error = err.message || 'Invalid password';
            } else {
                error = isSetup
                    ? 'Setup failed. Please try again.'
                    : 'Login failed. Please try again.';
            }
        } finally {
            loading = false;
        }
    }

    // ── WebAuthn ──────────────────────────────────────────────────────────────
    let conditionalUIAbort: AbortController | null = null;

    async function loginWithPasskey() {
        if (passkeyLoading || !webauthnSupported) return;
        conditionalUIAbort?.abort();
        conditionalUIAbort = null;
        error = '';
        passkeyLoading = true;
        try {
            const { options, sessionId } = await authApi.webauthnLoginBegin();
            const publicKey = prepareGetOptions(options.publicKey);
            const credential = (await navigator.credentials.get({
                publicKey
            })) as PublicKeyCredential | null;
            if (!credential) return;
            await authApi.webauthnLoginFinish(sessionId, credential);
            // Re-check auth status to update store, then navigate
            await authStore.check();
            goto('/');
        } catch (err) {
            if ((err as Error)?.name === 'NotAllowedError') {
                error = 'Passkey authentication was cancelled';
            } else if (err instanceof ApiError) {
                error = err.message || 'Passkey authentication failed';
            } else {
                error = 'Passkey authentication failed';
            }
        } finally {
            passkeyLoading = false;
        }
    }

    async function startConditionalUI() {
        if (!webauthnSupported) return;
        // Check if conditional mediation is supported
        const supported =
            typeof PublicKeyCredential.isConditionalMediationAvailable === 'function' &&
            (await PublicKeyCredential.isConditionalMediationAvailable().catch(() => false));
        if (!supported || !passkeyAvailable) return;

        try {
            const { options, sessionId } = await authApi.webauthnLoginBegin();
            const publicKey = prepareGetOptions(options.publicKey);
            conditionalUIAbort = new AbortController();
            const credential = (await navigator.credentials.get({
                publicKey,
                mediation: 'conditional' as CredentialMediationRequirement,
                signal: conditionalUIAbort.signal
            })) as PublicKeyCredential | null;
            if (!credential) return;
            await authApi.webauthnLoginFinish(sessionId, credential);
            await authStore.check();
            goto('/');
        } catch (err) {
            if ((err as Error)?.name !== 'AbortError') {
                console.debug('Conditional UI error:', err);
            }
        }
    }

    onMount(async () => {
        passwordInput?.focus();
        if (webauthnSupported && !isSetup) {
            try {
                const { available } = await authApi.webauthnAvailable();
                passkeyAvailable = available;
                if (available) startConditionalUI();
            } catch {
                /* ignore */
            }
        }
    });

    onDestroy(() => {
        conditionalUIAbort?.abort();
        conditionalUIAbort = null;
    });
</script>

<svelte:head>
    <title>{isSetup ? 'Set up' : 'Sign in'} — Media Viewer</title>
</svelte:head>

<div class="login-page">
    <div class="login-card">
        <div class="login-header">
            <img src="/icons/icon.svg" alt="" class="login-logo" aria-hidden="true" />
            <h1 class="login-title">Media Viewer</h1>
            {#if isSetup}
                <p class="login-subtitle">Create a password to get started</p>
            {:else}
                <p class="login-subtitle">Sign in to continue</p>
            {/if}
        </div>

        <form class="login-form" onsubmit={handleSubmit} novalidate>
            <div class="field">
                <label for="password" class="field-label">Password</label>
                <input
                    id="password"
                    type="password"
                    bind:value={password}
                    bind:this={passwordInput}
                    autocomplete={isSetup ? 'new-password' : 'current-password webauthn'}
                    required
                    disabled={loading}
                    class="field-input"
                    placeholder={isSetup ? 'Choose a password' : 'Enter password'}
                />
            </div>

            {#if isSetup}
                <div class="field">
                    <label for="confirm-password" class="field-label">Confirm password</label>
                    <input
                        id="confirm-password"
                        type="password"
                        bind:value={confirmPassword}
                        autocomplete="new-password"
                        required
                        disabled={loading}
                        class="field-input"
                        placeholder="Confirm password"
                    />
                </div>
            {/if}

            {#if error}
                <p class="login-error" role="alert">{error}</p>
            {/if}

            <button
                type="submit"
                class="login-btn"
                disabled={loading || !password || (isSetup && !confirmPassword)}
            >
                {#if loading}
                    <span class="btn-spinner" aria-hidden="true"></span>
                    {isSetup ? 'Setting up…' : 'Signing in…'}
                {:else}
                    {isSetup ? 'Set password & sign in' : 'Sign in'}
                {/if}
            </button>
        </form>

        {#if !isSetup && webauthnSupported && passkeyAvailable}
            <div class="divider">
                <span>or</span>
            </div>

            <button
                class="passkey-btn"
                onclick={loginWithPasskey}
                disabled={passkeyLoading}
                aria-label="Sign in with a passkey"
            >
                {#if passkeyLoading}
                    <span class="btn-spinner dark" aria-hidden="true"></span>
                    Waiting for passkey…
                {:else}
                    <!-- Passkey icon (FIDO key) -->
                    <svg
                        class="passkey-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                    >
                        <circle cx="8" cy="15" r="4" />
                        <path d="m12 15 5-5" />
                        <path d="m17 10 2-2" />
                        <path d="m15 12 2 2" />
                    </svg>
                    Sign in with passkey
                {/if}
            </button>
        {/if}
    </div>
</div>

<style>
    .login-page {
        min-height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-6);
        background: var(--color-bg);
    }

    .login-card {
        width: 100%;
        max-width: 380px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--spacing-8);
        box-shadow: var(--shadow-lg);
    }

    .login-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        margin-bottom: var(--spacing-8);
        gap: var(--spacing-2);
    }

    .login-logo {
        width: 56px;
        height: 56px;
    }

    .login-title {
        font-size: var(--text-xl);
        font-weight: 700;
        color: var(--color-text);
    }

    .login-subtitle {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
    }

    .login-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-4);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-1);
    }

    .field-label {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
        font-weight: 500;
    }

    .field-input {
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text);
        font-size: var(--text-base);
        padding: var(--spacing-3) var(--spacing-3);
        transition: border-color var(--transition-fast);
        width: 100%;
    }

    .field-input:focus {
        outline: none;
        border-color: var(--color-primary);
    }

    .field-input:disabled {
        opacity: 0.5;
    }

    .login-error {
        font-size: var(--text-sm);
        color: var(--color-danger);
        text-align: center;
    }

    .login-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-2);
        background: var(--color-primary);
        color: #000;
        border: none;
        border-radius: var(--radius-md);
        font-size: var(--text-base);
        font-weight: 600;
        padding: var(--spacing-3);
        cursor: pointer;
        transition:
            background var(--transition-fast),
            opacity var(--transition-fast);
        width: 100%;
        margin-top: var(--spacing-2);
    }

    .login-btn:hover:not(:disabled) {
        background: var(--color-primary-hover);
    }

    .login-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* Passkey */
    .divider {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        margin: var(--spacing-5) 0 var(--spacing-4);
        color: var(--color-text-muted);
        font-size: var(--text-sm);
    }

    .divider::before,
    .divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--color-border);
    }

    .passkey-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-2);
        width: 100%;
        padding: var(--spacing-3);
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text);
        font-size: var(--text-base);
        font-weight: 500;
        cursor: pointer;
        transition:
            background var(--transition-fast),
            border-color var(--transition-fast);
    }

    .passkey-btn:hover:not(:disabled) {
        background: var(--color-surface-3);
        border-color: var(--color-primary);
    }

    .passkey-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .passkey-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
    }

    /* Spinner */
    .btn-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(0, 0, 0, 0.3);
        border-top-color: #000;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
        flex-shrink: 0;
    }

    .btn-spinner.dark {
        border-color: rgba(255, 255, 255, 0.3);
        border-top-color: var(--color-text);
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
