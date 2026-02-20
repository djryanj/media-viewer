/**
 * Unit tests for Login Page Controller
 * Tests individual functions and behaviors in isolation
 */
/* global loadModuleForTesting */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('LoginForm Unit Tests', () => {
    let LoginForm;

    beforeEach(async () => {
        // Reset modules to ensure fresh imports
        vi.resetModules();

        // Setup basic DOM structure
        document.body.innerHTML = `
            <div id="loading" class="hidden"></div>

            <form id="login-form" class="hidden">
                <button type="submit" id="login-submit">Login</button>
                <div id="login-error" class="hidden"><span></span></div>

                <div id="passkey-section" class="hidden">
                    <button type="button" id="passkey-login-btn">
                        <span class="passkey-icon"></span>
                        <span class="btn-text">Sign in with Passkey</span>
                    </button>
                </div>

                <div id="passkey-config-error" class="hidden"><span></span></div>
                <div id="passkey-insecure-error" class="hidden"></div>
                <div id="passkey-browser-error" class="hidden"></div>

                <div class="password-input-wrapper">
                    <input type="password" id="password" />
                    <button class="password-toggle" type="button">
                        <span class="eye-open"></span>
                        <span class="eye-closed hidden"></span>
                    </button>
                </div>
            </form>

            <form id="setup-form" class="hidden">
                <input type="password" id="setup-password" />
                <input type="password" id="setup-confirm" />
                <button type="submit" id="setup-submit">Create Password</button>
                <div id="setup-error" class="hidden"><span></span></div>
            </form>
        `;

        // Mock global dependencies
        global.fetch = vi.fn();
        global.sessionStorage = {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        };
        global.console.debug = vi.fn();
        global.console.error = vi.fn();

        // Mock lucide icons
        global.lucide = {
            createIcons: vi.fn(),
        };

        // Mock window.location
        delete window.location;
        window.location = {
            href: '',
            reload: vi.fn(),
        };

        // Mock webAuthnManager
        window.webAuthnManager = {
            isSecureContext: true,
            supported: true,
            conditionalUISupported: false,
            checkAvailability: vi.fn(() => Promise.resolve(true)),
            startConditionalUI: vi.fn(() => Promise.resolve(null)),
            login: vi.fn(() => Promise.resolve({ success: true })),
            abortConditionalUI: vi.fn(),
        };

        // Load the module
        LoginForm = await loadModuleForTesting('login', 'LoginForm');
    });

    describe('DOM Element Caching', () => {
        it('should cache all required DOM elements', () => {
            LoginForm.cacheElements();

            // Verify elements can be accessed (they're private but cache should work)
            expect(document.getElementById('login-form')).toBeTruthy();
            expect(document.getElementById('setup-form')).toBeTruthy();
            expect(document.getElementById('loading')).toBeTruthy();
            expect(document.getElementById('login-error')).toBeTruthy();
            expect(document.getElementById('setup-error')).toBeTruthy();
            expect(document.getElementById('passkey-section')).toBeTruthy();
            expect(document.getElementById('passkey-login-btn')).toBeTruthy();
            expect(document.getElementById('password')).toBeTruthy();
            expect(document.getElementById('login-submit')).toBeTruthy();
            expect(document.getElementById('setup-submit')).toBeTruthy();
        });

        it('should handle missing elements gracefully', () => {
            document.body.innerHTML = '<div></div>';

            expect(() => LoginForm.cacheElements()).not.toThrow();
        });
    });

    describe('Password Toggle Functionality', () => {
        it('should toggle password visibility on button click', async () => {
            // Mock authenticated response to prevent redirects
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            // Mock passkey availability check
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const passwordInput = document.getElementById('password');
            const toggleButton = document.querySelector('.password-toggle');
            const eyeOpen = toggleButton.querySelector('.eye-open');
            const eyeClosed = toggleButton.querySelector('.eye-closed');

            expect(passwordInput.type).toBe('password');
            expect(eyeOpen.classList.contains('hidden')).toBe(false);
            expect(eyeClosed.classList.contains('hidden')).toBe(true);

            // Click to show password
            toggleButton.click();

            expect(passwordInput.type).toBe('text');
            expect(eyeOpen.classList.contains('hidden')).toBe(true);
            expect(eyeClosed.classList.contains('hidden')).toBe(false);

            // Click to hide password
            toggleButton.click();

            expect(passwordInput.type).toBe('password');
            expect(eyeOpen.classList.contains('hidden')).toBe(false);
            expect(eyeClosed.classList.contains('hidden')).toBe(true);
        });

        it('should handle missing parent wrapper gracefully', async () => {
            document.body.innerHTML = `
                <button class="password-toggle" type="button">
                    <span class="eye-open"></span>
                    <span class="eye-closed hidden"></span>
                </button>
            `;

            // Mock authenticated response
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            // Mock passkey availability check
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const toggleButton = document.querySelector('.password-toggle');

            // Should not throw
            expect(() => toggleButton.click()).not.toThrow();
        });

        it('should handle missing input gracefully', async () => {
            document.body.innerHTML = `
                <div class="password-input-wrapper">
                    <button class="password-toggle" type="button">
                        <span class="eye-open"></span>
                        <span class="eye-closed hidden"></span>
                    </button>
                </div>
            `;

            // Mock authenticated response
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            await LoginForm.init();

            const toggleButton = document.querySelector('.password-toggle');

            // Should not throw
            expect(() => toggleButton.click()).not.toThrow();
        });
    });

    describe('Initial State Check', () => {
        it('should redirect if already authenticated', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: true }),
            });

            await LoginForm.init();

            expect(window.location.href).toBe('/');
        });

        it('should show setup form when setup is required', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: true }),
            });

            await LoginForm.init();

            const setupForm = document.getElementById('setup-form');
            const loginForm = document.getElementById('login-form');

            expect(setupForm.classList.contains('hidden')).toBe(false);
            expect(loginForm.classList.contains('hidden')).toBe(true);
        });

        it('should show login form when setup not required', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            // Mock passkey availability check
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const setupForm = document.getElementById('setup-form');
            const loginForm = document.getElementById('login-form');

            expect(setupForm.classList.contains('hidden')).toBe(true);
            expect(loginForm.classList.contains('hidden')).toBe(false);
        });

        it('should handle auth check failure gracefully', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            // Mock passkey availability check
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            // Should still show login form
            const loginForm = document.getElementById('login-form');
            expect(loginForm.classList.contains('hidden')).toBe(false);
            expect(console.error).toHaveBeenCalled();
        });

        it('should handle network timeout', async () => {
            fetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

            await LoginForm.init();

            // Should show server offline error
            const loginError = document.getElementById('login-error');
            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').innerHTML).toContain(
                'Unable to connect to server'
            );
        });

        it('should handle network error', async () => {
            fetch.mockRejectedValueOnce(new TypeError('Network error'));

            await LoginForm.init();

            // Should show server offline error
            const loginError = document.getElementById('login-error');
            expect(loginError.classList.contains('hidden')).toBe(false);
        });

        it('should handle request timeout with AbortController', async () => {
            // Mock fetch to reject with AbortError (what happens on timeout)
            const abortError = new DOMException('The operation was aborted', 'AbortError');
            fetch.mockRejectedValueOnce(abortError);

            await LoginForm.init();

            // Should show server offline error
            const loginError = document.getElementById('login-error');
            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').innerHTML).toContain(
                'Unable to connect to server'
            );
        });
    });

    describe('Passkey Availability Check', () => {
        it('should return false when passkey section is missing', async () => {
            document.getElementById('passkey-section').remove();

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            await LoginForm.init();

            // Passkey section should not be shown
            expect(console.debug).toHaveBeenCalledWith('Passkey: Section not found in DOM');
        });

        it('should return false when webAuthnManager is not loaded', async () => {
            delete window.webAuthnManager;

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: true, hasCredentials: true, available: true }),
            });

            await LoginForm.init();

            expect(console.debug).toHaveBeenCalledWith('Passkey: webAuthnManager not loaded');
        });

        it('should return false when server is not enabled', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const passkeySection = document.getElementById('passkey-section');
            expect(passkeySection.classList.contains('hidden')).toBe(true);
            expect(console.debug).toHaveBeenCalledWith('Passkey: Server not enabled');
        });

        it('should show config error when credentials exist but misconfigured', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    configError: 'HTTPS required',
                }),
            });

            await LoginForm.init();

            const configError = document.getElementById('passkey-config-error');
            expect(configError.classList.contains('hidden')).toBe(false);
            expect(configError.querySelector('span').innerHTML).toContain('HTTPS required');
        });

        it('should return false when no credentials registered', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: true, hasCredentials: false }),
            });

            await LoginForm.init();

            const passkeySection = document.getElementById('passkey-section');
            expect(passkeySection.classList.contains('hidden')).toBe(true);
            expect(console.debug).toHaveBeenCalledWith('Passkey: No credentials registered yet');
        });

        it('should show insecure context error', async () => {
            window.webAuthnManager.isSecureContext = false;

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            await LoginForm.init();

            const insecureError = document.getElementById('passkey-insecure-error');
            expect(insecureError.classList.contains('hidden')).toBe(false);
        });

        it('should show browser not supported error', async () => {
            window.webAuthnManager.supported = false;

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            await LoginForm.init();

            const browserError = document.getElementById('passkey-browser-error');
            expect(browserError.classList.contains('hidden')).toBe(false);
        });

        it('should handle server error gracefully', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            await LoginForm.init();

            // Should hide passkey section
            const passkeySection = document.getElementById('passkey-section');
            expect(passkeySection.classList.contains('hidden')).toBe(true);
        });

        it('should handle fetch exception gracefully', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockRejectedValueOnce(new Error('Network error'));

            await LoginForm.init();

            // Should hide passkey section
            const passkeySection = document.getElementById('passkey-section');
            expect(passkeySection.classList.contains('hidden')).toBe(true);
            expect(console.error).toHaveBeenCalled();
        });

        it('should return true when all checks pass', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            await LoginForm.init();

            const passkeySection = document.getElementById('passkey-section');
            expect(passkeySection.classList.contains('hidden')).toBe(false);
            expect(console.debug).toHaveBeenCalledWith('Passkey: Available and ready');
        });
    });

    describe('Password Input Interaction', () => {
        it('should clear error when user types in password field', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const passwordInput = document.getElementById('password');
            const loginError = document.getElementById('login-error');

            // Show an error
            loginError.classList.remove('hidden');
            passwordInput.classList.add('error');

            // Simulate user typing
            passwordInput.value = 'test';
            passwordInput.dispatchEvent(new Event('input'));

            expect(passwordInput.classList.contains('error')).toBe(false);
            expect(loginError.classList.contains('hidden')).toBe(true);
        });

        it('should abort conditional UI when password field is focused', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const passwordInput = document.getElementById('password');

            passwordInput.dispatchEvent(new Event('focus'));

            expect(window.webAuthnManager.abortConditionalUI).toHaveBeenCalled();
        });

        it('should handle missing webAuthnManager gracefully on focus', async () => {
            delete window.webAuthnManager;

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const passwordInput = document.getElementById('password');

            // Should not throw
            expect(() => passwordInput.dispatchEvent(new Event('focus'))).not.toThrow();
        });
    });

    describe('Automatic Passkey Login', () => {
        it('should skip auto passkey after recent logout', async () => {
            vi.useFakeTimers();
            const now = Date.now();
            sessionStorage.getItem.mockReturnValue(String(now - 1000)); // 1 second ago

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            await LoginForm.init();

            expect(console.debug).toHaveBeenCalledWith(
                'Skipping auto passkey login (recent logout)'
            );
            expect(window.webAuthnManager.startConditionalUI).not.toHaveBeenCalled();

            vi.useRealTimers();
        });

        it('should clear old skipAutoPasskey flag', async () => {
            const oldTimestamp = Date.now() - 5000; // 5 seconds ago
            sessionStorage.getItem.mockReturnValue(String(oldTimestamp));

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            await LoginForm.init();

            expect(sessionStorage.removeItem).toHaveBeenCalledWith('skipAutoPasskey');
        });

        it('should start conditional UI when supported', async () => {
            window.webAuthnManager.conditionalUISupported = true;

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            await LoginForm.init();

            expect(window.webAuthnManager.startConditionalUI).toHaveBeenCalled();
        });

        it('should redirect on successful conditional UI login', async () => {
            window.webAuthnManager.conditionalUISupported = true;
            window.webAuthnManager.startConditionalUI.mockResolvedValueOnce({ success: true });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            await LoginForm.init();

            // Wait for async operations
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(window.location.href).toBe('/');
        });

        it('should handle conditional UI errors gracefully', async () => {
            window.webAuthnManager.conditionalUISupported = true;
            window.webAuthnManager.startConditionalUI.mockRejectedValueOnce(
                new Error('User cancelled')
            );

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            await LoginForm.init();

            // Wait for async operations
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Should handle gracefully
            expect(console.debug).toHaveBeenCalledWith('Conditional UI ended:', 'User cancelled');
        });
    });

    describe('Error Display Functions', () => {
        it('should show error message', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginForm = document.getElementById('login-form');

            // Submit form without password to trigger error
            loginForm.dispatchEvent(new Event('submit'));

            const loginError = document.getElementById('login-error');
            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toBe('Please enter your password');
        });

        it('should hide error message', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginError = document.getElementById('login-error');
            loginError.classList.remove('hidden');

            const passwordInput = document.getElementById('password');
            passwordInput.value = 'test';
            passwordInput.dispatchEvent(new Event('input'));

            expect(loginError.classList.contains('hidden')).toBe(true);
        });

        it('should handle missing error element gracefully', async () => {
            document.getElementById('login-error').remove();

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginForm = document.getElementById('login-form');

            // Should not throw
            expect(() => loginForm.dispatchEvent(new Event('submit'))).not.toThrow();
        });
    });

    describe('Loading States', () => {
        it('should hide loading indicator', async () => {
            const loading = document.getElementById('loading');
            loading.classList.remove('hidden');

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            expect(loading.classList.contains('hidden')).toBe(true);
        });

        it('should set button loading state correctly', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginForm = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');
            const loginSubmitBtn = document.getElementById('login-submit');

            passwordInput.value = 'testpassword';

            // Mock login fetch to be pending long enough to check loading state
            let resolveFetch;
            fetch.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFetch = resolve;
                    })
            );

            // Dispatch submit event
            loginForm.dispatchEvent(new Event('submit'));

            // Wait for next tick to ensure async handler has started
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Check button state while request is pending
            expect(loginSubmitBtn.disabled).toBe(true);
            expect(loginSubmitBtn.textContent).toBe('Logging in...');

            // Resolve the fetch to clean up
            resolveFetch({ ok: true });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    });

    describe('Lucide Icons Initialization', () => {
        it('should initialize lucide icons if available', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            expect(lucide.createIcons).toHaveBeenCalled();
        });

        it('should handle missing lucide gracefully', async () => {
            delete window.lucide;

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            // Should not throw
            await expect(LoginForm.init()).resolves.not.toThrow();
        });
    });

    describe('Password Login Handler', () => {
        it('should validate empty password', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginForm = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');
            const loginError = document.getElementById('login-error');

            passwordInput.value = '';

            loginForm.dispatchEvent(new Event('submit'));

            // Should not call fetch
            expect(fetch).toHaveBeenCalledTimes(2); // Only init calls
            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toBe('Please enter your password');
        });

        it('should handle successful login', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginForm = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');

            passwordInput.value = 'testpassword';

            // Mock successful login
            fetch.mockResolvedValueOnce({
                ok: true,
            });

            const submitEvent = new Event('submit');
            loginForm.dispatchEvent(submitEvent);

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(window.location.href).toBe('/');
        });

        it('should handle invalid password error', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginForm = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');
            const loginError = document.getElementById('login-error');

            passwordInput.value = 'wrongpassword';

            // Mock failed login
            fetch.mockResolvedValueOnce({
                ok: false,
                text: async () => 'Invalid password',
            });

            const submitEvent = new Event('submit');
            loginForm.dispatchEvent(submitEvent);

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toBe('Invalid password');
            expect(passwordInput.classList.contains('error')).toBe(true);
        });

        it('should handle login timeout', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginForm = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');
            const loginError = document.getElementById('login-error');

            passwordInput.value = 'testpassword';

            // Mock timeout error
            const abortError = new DOMException('The operation was aborted', 'AbortError');
            fetch.mockRejectedValueOnce(abortError);

            const submitEvent = new Event('submit');
            loginForm.dispatchEvent(submitEvent);

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toContain('Connection timeout');
        });

        it('should handle network error', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginForm = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');
            const loginError = document.getElementById('login-error');

            passwordInput.value = 'testpassword';

            // Mock network error
            fetch.mockRejectedValueOnce(new TypeError('Network error'));

            const submitEvent = new Event('submit');
            loginForm.dispatchEvent(submitEvent);

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toContain(
                'Unable to connect to server'
            );
        });

        it('should abort conditional UI on password login', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            const loginForm = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');

            passwordInput.value = 'testpassword';

            // Mock successful login
            fetch.mockResolvedValueOnce({
                ok: true,
            });

            const submitEvent = new Event('submit');
            loginForm.dispatchEvent(submitEvent);

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(window.webAuthnManager.abortConditionalUI).toHaveBeenCalled();
        });
    });

    describe('Setup Form Handler', () => {
        it('should validate password length', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: true }),
            });

            await LoginForm.init();

            const setupForm = document.getElementById('setup-form');
            const setupPassword = document.getElementById('setup-password');
            const setupConfirm = document.getElementById('setup-confirm');
            const setupError = document.getElementById('setup-error');

            setupPassword.value = '12345'; // Only 5 characters
            setupConfirm.value = '12345';

            setupForm.dispatchEvent(new Event('submit'));

            // Should not call fetch
            expect(fetch).toHaveBeenCalledTimes(1); // Only init call
            expect(setupError.classList.contains('hidden')).toBe(false);
            expect(setupError.querySelector('span').textContent).toBe(
                'Password must be at least 6 characters'
            );
        });

        it('should validate password confirmation match', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: true }),
            });

            await LoginForm.init();

            const setupForm = document.getElementById('setup-form');
            const setupPassword = document.getElementById('setup-password');
            const setupConfirm = document.getElementById('setup-confirm');
            const setupError = document.getElementById('setup-error');

            setupPassword.value = 'password123';
            setupConfirm.value = 'password456'; // Doesn't match

            setupForm.dispatchEvent(new Event('submit'));

            expect(setupError.classList.contains('hidden')).toBe(false);
            expect(setupError.querySelector('span').textContent).toBe('Passwords do not match');
        });

        it('should handle successful setup and login', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: true }),
            });

            await LoginForm.init();

            const setupForm = document.getElementById('setup-form');
            const setupPassword = document.getElementById('setup-password');
            const setupConfirm = document.getElementById('setup-confirm');

            setupPassword.value = 'password123';
            setupConfirm.value = 'password123';

            // Mock successful setup
            fetch.mockResolvedValueOnce({
                ok: true,
            });

            // Mock automatic login after setup
            fetch.mockResolvedValueOnce({
                ok: true,
            });

            const submitEvent = new Event('submit');
            setupForm.dispatchEvent(submitEvent);

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(window.location.href).toBe('/');
        });

        it('should handle setup failure', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: true }),
            });

            await LoginForm.init();

            const setupForm = document.getElementById('setup-form');
            const setupPassword = document.getElementById('setup-password');
            const setupConfirm = document.getElementById('setup-confirm');
            const setupError = document.getElementById('setup-error');

            setupPassword.value = 'password123';
            setupConfirm.value = 'password123';

            // Mock failed setup
            fetch.mockResolvedValueOnce({
                ok: false,
                text: async () => 'Setup failed',
            });

            const submitEvent = new Event('submit');
            setupForm.dispatchEvent(submitEvent);

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(setupError.classList.contains('hidden')).toBe(false);
            expect(setupError.querySelector('span').textContent).toBe('Setup failed');
        });

        it('should handle setup timeout', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: true }),
            });

            await LoginForm.init();

            const setupForm = document.getElementById('setup-form');
            const setupPassword = document.getElementById('setup-password');
            const setupConfirm = document.getElementById('setup-confirm');
            const setupError = document.getElementById('setup-error');

            setupPassword.value = 'password123';
            setupConfirm.value = 'password123';

            // Mock timeout error
            const abortError = new DOMException('The operation was aborted', 'AbortError');
            fetch.mockRejectedValueOnce(abortError);

            const submitEvent = new Event('submit');
            setupForm.dispatchEvent(submitEvent);

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(setupError.classList.contains('hidden')).toBe(false);
            expect(setupError.querySelector('span').textContent).toContain('Connection timeout');
        });
    });

    describe('Passkey Login Handler', () => {
        it('should handle successful passkey login', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            window.webAuthnManager.login.mockResolvedValueOnce({ success: true });

            await LoginForm.init();

            const passkeyLoginBtn = document.getElementById('passkey-login-btn');

            passkeyLoginBtn.click();

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(window.webAuthnManager.login).toHaveBeenCalled();
            expect(window.location.href).toBe('/');
        });

        it('should handle passkey cancellation (user-initiated)', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            const cancelError = new Error('The operation was cancelled');
            cancelError.name = 'NotAllowedError';
            window.webAuthnManager.login.mockRejectedValueOnce(cancelError);

            await LoginForm.init();

            const passkeyLoginBtn = document.getElementById('passkey-login-btn');
            const loginError = document.getElementById('login-error');

            passkeyLoginBtn.click();

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toContain(
                'Authentication was cancelled'
            );
        });

        it('should not show error for auto-triggered cancellation', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            const cancelError = new Error('The operation was cancelled');
            window.webAuthnManager.login.mockRejectedValueOnce(cancelError);

            await LoginForm.init();

            const loginError = document.getElementById('login-error');

            // Simulate auto-triggered login (happens during init)
            // The auto login should have been triggered but failed silently
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Error should stay hidden for auto-triggered attempts
            expect(loginError.classList.contains('hidden')).toBe(true);
        });

        it('should handle missing webAuthnManager gracefully', async () => {
            delete window.webAuthnManager;

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ enabled: false, hasCredentials: false }),
            });

            await LoginForm.init();

            // Manually create button since passkey section would be hidden
            document.body.innerHTML += `<button id="test-passkey-btn"></button>`;
            const testBtn = document.getElementById('test-passkey-btn');

            // Should not throw when clicked
            expect(() => testBtn.click()).not.toThrow();
        });
    });

    describe('Passkey Button Loading States', () => {
        it('should set passkey button to loading state', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            let resolveLogin;
            window.webAuthnManager.login.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveLogin = resolve;
                    })
            );

            await LoginForm.init();

            const passkeyLoginBtn = document.getElementById('passkey-login-btn');
            const btnText = passkeyLoginBtn.querySelector('.btn-text');
            const icon = passkeyLoginBtn.querySelector('.passkey-icon');

            passkeyLoginBtn.click();

            // Wait for async handler to start
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Check loading state
            expect(passkeyLoginBtn.disabled).toBe(true);
            expect(btnText.textContent).toBe('Authenticating...');
            expect(icon.style.display).toBe('none');
            expect(passkeyLoginBtn.querySelector('.spinner')).toBeTruthy();

            // Resolve to restore state
            resolveLogin({ success: true });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        it('should restore button state after completion', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authenticated: false, setupRequired: false }),
            });

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    enabled: true,
                    hasCredentials: true,
                    available: true,
                }),
            });

            const loginError = new Error('Login failed');
            window.webAuthnManager.login.mockRejectedValueOnce(loginError);

            await LoginForm.init();

            const passkeyLoginBtn = document.getElementById('passkey-login-btn');
            const btnText = passkeyLoginBtn.querySelector('.btn-text');
            const icon = passkeyLoginBtn.querySelector('.passkey-icon');

            passkeyLoginBtn.click();

            // Wait for async handler to complete
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Check restored state
            expect(passkeyLoginBtn.disabled).toBe(false);
            expect(btnText.textContent).toBe('Sign in with Passkey');
            expect(icon.style.display).toBe('');
            expect(passkeyLoginBtn.querySelector('.spinner')).toBeNull();
        });
    });
});
