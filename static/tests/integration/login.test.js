import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Login Page', () => {
    let mockWebAuthnManager;

    beforeEach(() => {
        // Reset DOM with login page structure
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
                    <button class="password-toggle">
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

        // Mock WebAuthnManager
        mockWebAuthnManager = {
            isSecureContext: true,
            supported: true,
            conditionalUISupported: false,
            available: false,
            checkAvailability: vi.fn(() => Promise.resolve(true)),
            startConditionalUI: vi.fn(() => Promise.resolve(null)),
            login: vi.fn(() => Promise.resolve({ success: true })),
            abortConditionalUI: vi.fn(),
        };
        window.webAuthnManager = mockWebAuthnManager;

        // Mock lucide
        window.lucide = {
            createIcons: vi.fn(),
        };

        // Mock fetch
        global.fetch = vi.fn();

        // Mock location
        delete window.location;
        window.location = {
            href: 'http://localhost:3000/login.html',
            replace: vi.fn(),
            reload: vi.fn(),
        };

        // Mock sessionStorage
        global.sessionStorage = {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        };

        // Mock console
        console.debug = vi.fn();
        console.error = vi.fn();

        // Mock document.readyState as writable
        let mockReadyState = 'loading';
        Object.defineProperty(document, 'readyState', {
            configurable: true,
            get() {
                return mockReadyState;
            },
            set(value) {
                mockReadyState = value;
            },
        });

        // Don't auto-initialize on load
        document.readyState = 'complete';
    });

    describe('Password Toggle', () => {
        it('should toggle password visibility', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            // Load login.js
            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            const toggle = document.querySelector('.password-toggle');
            const input = document.getElementById('password');
            const eyeOpen = toggle.querySelector('.eye-open');
            const eyeClosed = toggle.querySelector('.eye-closed');

            // Ensure input type is mutable (happy-dom quirk)
            let inputType = 'password';
            Object.defineProperty(input, 'type', {
                configurable: true,
                get() {
                    return inputType;
                },
                set(value) {
                    inputType = value;
                },
            });

            // Initially password is hidden
            expect(input.type).toBe('password');
            expect(eyeOpen.classList.contains('hidden')).toBe(false);
            expect(eyeClosed.classList.contains('hidden')).toBe(true);

            // Click to show password
            toggle.click();

            expect(input.type).toBe('text');
            expect(eyeOpen.classList.contains('hidden')).toBe(true);
            expect(eyeClosed.classList.contains('hidden')).toBe(false);

            // Click again to hide
            toggle.click();

            expect(input.type).toBe('password');
            expect(eyeOpen.classList.contains('hidden')).toBe(false);
            expect(eyeClosed.classList.contains('hidden')).toBe(true);
        });
    });

    describe('Initial State Check', () => {
        it('should redirect to app if already authenticated', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ authenticated: true }),
            });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            // Wait for checkInitialState to complete
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(fetch).toHaveBeenCalledWith('/api/auth/check', expect.any(Object));
            expect(window.location.href).toBe('/');
        });

        it('should show setup form when setup required', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ authenticated: false, setupRequired: true }),
            });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const setupForm = document.getElementById('setup-form');
            const loginForm = document.getElementById('login-form');
            const loading = document.getElementById('loading');

            expect(setupForm.classList.contains('hidden')).toBe(false);
            expect(loginForm.classList.contains('hidden')).toBe(true);
            expect(loading.classList.contains('hidden')).toBe(true);
        });

        it('should show login form when auth not required', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
            });

            // Mock passkey availability check
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () =>
                    Promise.resolve({
                        enabled: false,
                        available: false,
                        hasCredentials: false,
                    }),
            });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const loginForm = document.getElementById('login-form');
            const setupForm = document.getElementById('setup-form');

            expect(loginForm.classList.contains('hidden')).toBe(false);
            expect(setupForm.classList.contains('hidden')).toBe(true);
        });

        it('should handle server offline error', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch.mockRejectedValueOnce(new TypeError('Network error'));

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const loginForm = document.getElementById('login-form');
            const loginError = document.getElementById('login-error');

            expect(loginForm.classList.contains('hidden')).toBe(false);
            expect(loginError.classList.contains('hidden')).toBe(false);
        });
    });

    describe('Password Login', () => {
        it('should submit password and redirect on success', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            // Setup fetch mocks
            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: false,
                            available: false,
                            hasCredentials: false,
                        }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const form = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');

            passwordInput.value = 'test-password';
            form.dispatchEvent(new Event('submit'));

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(fetch).toHaveBeenCalledWith(
                '/api/auth/login',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ password: 'test-password' }),
                })
            );
            expect(window.location.href).toBe('/');
        });

        it('should show error on invalid password', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: false,
                            available: false,
                            hasCredentials: false,
                        }),
                })
                .mockResolvedValueOnce({
                    ok: false,
                    text: () => Promise.resolve('Invalid password'),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const form = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');
            const loginError = document.getElementById('login-error');

            passwordInput.value = 'wrong-password';
            form.dispatchEvent(new Event('submit'));

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toBe('Invalid password');
            expect(passwordInput.classList.contains('error')).toBe(true);
        });

        it('should require password to be entered', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: false,
                            available: false,
                            hasCredentials: false,
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const form = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');
            const loginError = document.getElementById('login-error');

            passwordInput.value = '';
            form.dispatchEvent(new Event('submit'));

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toBe('Please enter your password');
        });

        it('should handle network timeout', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: false,
                            available: false,
                            hasCredentials: false,
                        }),
                })
                .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const form = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');
            const loginError = document.getElementById('login-error');

            passwordInput.value = 'test';
            form.dispatchEvent(new Event('submit'));

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toContain('timeout');
        });
    });

    describe('Setup Form', () => {
        it('should validate password length', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ authenticated: false, setupRequired: true }),
            });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const form = document.getElementById('setup-form');
            const passwordInput = document.getElementById('setup-password');
            const confirmInput = document.getElementById('setup-confirm');
            const setupError = document.getElementById('setup-error');

            passwordInput.value = '12345'; // Too short
            confirmInput.value = '12345';
            form.dispatchEvent(new Event('submit'));

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(setupError.classList.contains('hidden')).toBe(false);
            expect(setupError.querySelector('span').textContent).toBe(
                'Password must be at least 6 characters'
            );
        });

        it('should validate password confirmation', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ authenticated: false, setupRequired: true }),
            });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const form = document.getElementById('setup-form');
            const passwordInput = document.getElementById('setup-password');
            const confirmInput = document.getElementById('setup-confirm');
            const setupError = document.getElementById('setup-error');

            passwordInput.value = 'password123';
            confirmInput.value = 'different123';
            form.dispatchEvent(new Event('submit'));

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(setupError.classList.contains('hidden')).toBe(false);
            expect(setupError.querySelector('span').textContent).toBe('Passwords do not match');
        });

        it('should create password and redirect on success', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: true }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                })
                .mockResolvedValueOnce({
                    ok: true,
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const form = document.getElementById('setup-form');
            const passwordInput = document.getElementById('setup-password');
            const confirmInput = document.getElementById('setup-confirm');

            passwordInput.value = 'newpassword123';
            confirmInput.value = 'newpassword123';
            form.dispatchEvent(new Event('submit'));

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(fetch).toHaveBeenCalledWith(
                '/api/auth/setup',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ password: 'newpassword123' }),
                })
            );
            expect(window.location.href).toBe('/');
        });
    });

    describe('Passkey Section Visibility', () => {
        it('should show passkey section when credentials exist', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: true,
                            available: true,
                            hasCredentials: true,
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const passkeySection = document.getElementById('passkey-section');
            expect(passkeySection.classList.contains('hidden')).toBe(false);
        });

        it('should hide passkey section when no credentials', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: true,
                            available: false,
                            hasCredentials: false,
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const passkeySection = document.getElementById('passkey-section');
            expect(passkeySection.classList.contains('hidden')).toBe(true);
        });

        it('should show insecure context error', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            mockWebAuthnManager.isSecureContext = false;

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: true,
                            available: true,
                            hasCredentials: true,
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const insecureError = document.getElementById('passkey-insecure-error');
            expect(insecureError.classList.contains('hidden')).toBe(false);
        });

        it('should show config error when misconfigured', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: true,
                            available: false,
                            hasCredentials: true,
                            configError: 'Invalid configuration',
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const configError = document.getElementById('passkey-config-error');
            expect(configError.classList.contains('hidden')).toBe(false);
            expect(configError.querySelector('span').innerHTML).toContain('Invalid configuration');
        });
    });

    describe('Passkey Login', () => {
        it('should handle successful passkey login', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: true,
                            available: true,
                            hasCredentials: true,
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const passkeyBtn = document.getElementById('passkey-login-btn');
            passkeyBtn.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockWebAuthnManager.login).toHaveBeenCalled();
            expect(window.location.href).toBe('/');
        });

        it('should handle passkey cancellation', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            mockWebAuthnManager.login.mockRejectedValue(new Error('Authentication was cancelled'));

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: true,
                            available: true,
                            hasCredentials: true,
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const passkeyBtn = document.getElementById('passkey-login-btn');
            const loginError = document.getElementById('login-error');

            passkeyBtn.click();

            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(loginError.classList.contains('hidden')).toBe(false);
            expect(loginError.querySelector('span').textContent).toBe(
                'Authentication was cancelled'
            );
        });

        it('should skip auto passkey after logout', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            mockWebAuthnManager.conditionalUISupported = true;
            sessionStorage.getItem.mockReturnValue(Date.now().toString());

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: true,
                            available: true,
                            hasCredentials: true,
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            // Conditional UI should not have started
            expect(mockWebAuthnManager.startConditionalUI).not.toHaveBeenCalled();
        });
    });

    describe('Password Input Interaction', () => {
        it('should clear error when user types in password field', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: false,
                            available: false,
                            hasCredentials: false,
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const passwordInput = document.getElementById('password');
            const loginError = document.getElementById('login-error');

            // Simulate error state
            loginError.classList.remove('hidden');
            passwordInput.classList.add('error');

            // Type in password
            passwordInput.dispatchEvent(new Event('input'));

            expect(passwordInput.classList.contains('error')).toBe(false);
            expect(loginError.classList.contains('hidden')).toBe(true);
        });

        it('should abort conditional UI when password field focused', async () => {
            // Reset all modules to ensure fresh imports
            vi.resetModules();

            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false, setupRequired: false }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: true,
                            available: true,
                            hasCredentials: true,
                        }),
                });

            const LoginForm = await loadModuleForTesting('login', 'LoginForm');
            await LoginForm.init();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const passwordInput = document.getElementById('password');

            passwordInput.dispatchEvent(new Event('focus'));

            expect(mockWebAuthnManager.abortConditionalUI).toHaveBeenCalled();
        });
    });
});
