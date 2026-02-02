/**
 * Login Page Controller
 * Handles password authentication and passkey (WebAuthn) authentication
 */
(function () {
    'use strict';

    // DOM Elements - cached after DOM ready
    let loginForm;
    let setupForm;
    let loading;
    let loginError;
    let setupError;
    let passkeySection;
    let passkeyLoginBtn;
    let passwordInput;
    let loginSubmitBtn;
    let setupSubmitBtn;

    // Track if we're currently doing a passkey login
    let passkeyLoginInProgress = false;

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        loginForm = document.getElementById('login-form');
        setupForm = document.getElementById('setup-form');
        loading = document.getElementById('loading');
        loginError = document.getElementById('login-error');
        setupError = document.getElementById('setup-error');
        passkeySection = document.getElementById('passkey-section');
        passkeyLoginBtn = document.getElementById('passkey-login-btn');
        passwordInput = document.getElementById('password');
        loginSubmitBtn = document.getElementById('login-submit');
        setupSubmitBtn = document.getElementById('setup-submit');
    }

    /**
     * Initialize the login page
     */
    async function init() {
        cacheElements();

        // Initialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        // Ensure passkey section is hidden initially
        hidePasskeySection();

        // Setup password toggle buttons
        initPasswordToggles();

        // Setup form handlers
        initFormHandlers();

        // Check authentication state and setup requirements
        await checkInitialState();
    }

    /**
     * Explicitly hide the passkey section
     */
    function hidePasskeySection() {
        if (passkeySection) {
            passkeySection.classList.add('hidden');
            passkeySection.style.display = 'none';
        }
    }

    /**
     * Explicitly show the passkey section
     */
    function showPasskeySection() {
        if (passkeySection) {
            passkeySection.classList.remove('hidden');
            passkeySection.style.display = '';
        }
    }

    /**
     * Initialize password visibility toggle buttons
     */
    function initPasswordToggles() {
        document.querySelectorAll('.password-toggle').forEach((toggle) => {
            toggle.addEventListener('click', (e) => {
                e.preventDefault();

                const wrapper = toggle.closest('.password-input-wrapper');
                if (!wrapper) return;

                const input = wrapper.querySelector('input');
                if (!input) return;

                const eyeOpen = toggle.querySelector('.eye-open');
                const eyeClosed = toggle.querySelector('.eye-closed');

                if (input.type === 'password') {
                    input.type = 'text';
                    if (eyeOpen) eyeOpen.classList.add('hidden');
                    if (eyeClosed) eyeClosed.classList.remove('hidden');
                } else {
                    input.type = 'password';
                    if (eyeOpen) eyeOpen.classList.remove('hidden');
                    if (eyeClosed) eyeClosed.classList.add('hidden');
                }
            });
        });
    }

    /**
     * Initialize form submission handlers
     */
    function initFormHandlers() {
        if (loginForm) {
            loginForm.addEventListener('submit', handlePasswordLogin);
        }

        if (setupForm) {
            setupForm.addEventListener('submit', handleSetup);
        }

        if (passkeyLoginBtn) {
            passkeyLoginBtn.addEventListener('click', handlePasskeyLogin);
        }

        if (passwordInput) {
            passwordInput.addEventListener('input', () => {
                passwordInput.classList.remove('error');
                hideError(loginError);
            });

            // When user focuses password field, abort conditional UI
            // (they want to type a password instead)
            passwordInput.addEventListener('focus', () => {
                if (window.webAuthnManager) {
                    window.webAuthnManager.abortConditionalUI();
                }
            });
        }
    }

    /**
     * Check initial authentication state and determine which form to show
     */
    async function checkInitialState() {
        try {
            // Check if already authenticated
            if (await checkAuth()) {
                redirectToApp();
                return;
            }

            // Check if setup is required (first-time use)
            const needsSetup = await checkSetupRequired();

            hideLoading();

            if (needsSetup) {
                showSetupForm();
            } else {
                await showLoginForm();
            }
        } catch (err) {
            console.error('Failed to check initial state:', err);
            hideLoading();
            await showLoginForm();
        }
    }

    /**
     * Check if user is already authenticated
     */
    async function checkAuth() {
        try {
            const response = await fetch('/api/auth/check');
            const data = await response.json();
            return data.success === true;
        } catch (err) {
            console.error('Auth check failed:', err);
            return false;
        }
    }

    /**
     * Check if initial setup is required
     */
    async function checkSetupRequired() {
        try {
            const response = await fetch('/api/auth/setup-required');
            const data = await response.json();
            return data.needsSetup === true;
        } catch (err) {
            console.error('Setup check failed:', err);
            return false;
        }
    }

    /**
     * Show the login form and check for passkey availability
     */
    async function showLoginForm() {
        if (loginForm) loginForm.classList.remove('hidden');
        if (setupForm) setupForm.classList.add('hidden');

        // Ensure passkey section stays hidden until we confirm availability
        hidePasskeySection();

        // Check if passkeys are available
        const passkeysAvailable = await checkPasskeyAvailability();

        if (passkeysAvailable) {
            showPasskeySection();

            // Try to start Conditional UI (autofill) or auto-prompt
            await startAutoPasskeyLogin();
        } else {
            hidePasskeySection();
            // Focus password input if no passkeys
            if (passwordInput) {
                passwordInput.focus();
            }
        }
    }

    /**
     * Start automatic passkey login
     * This will either use Conditional UI (shows in autofill) or auto-prompt
     */
    async function startAutoPasskeyLogin() {
        if (!window.webAuthnManager || passkeyLoginInProgress) {
            return;
        }

        // Check if Conditional UI is supported
        if (window.webAuthnManager.conditionalUISupported) {
            // Start Conditional UI - passkeys will appear in autofill dropdown
            // This runs in the background and completes when user selects a passkey
            console.debug('Starting Conditional UI for passkey autofill...');

            try {
                const result = await window.webAuthnManager.startConditionalUI();

                if (result && result.success) {
                    console.debug('Conditional UI login successful');
                    redirectToApp();
                }
            } catch (err) {
                // Conditional UI failed or was aborted - that's okay
                console.debug('Conditional UI ended:', err?.message || 'aborted');
            }
        } else {
            // Conditional UI not supported - auto-prompt after a short delay
            // This gives the user a moment to see the page before the prompt appears
            console.debug('Conditional UI not supported, will auto-prompt...');

            setTimeout(async () => {
                // Only auto-prompt if user hasn't started typing
                if (passwordInput && passwordInput.value.length === 0 && !passkeyLoginInProgress) {
                    await handlePasskeyLogin(true); // true = auto-triggered
                }
            }, 500); // 500ms delay before auto-prompt
        }
    }

    /**
     * Show the setup form for first-time password creation
     */
    function showSetupForm() {
        if (setupForm) setupForm.classList.remove('hidden');
        if (loginForm) loginForm.classList.add('hidden');

        // Always hide passkey section during setup
        hidePasskeySection();

        const setupPasswordInput = document.getElementById('setup-password');
        if (setupPasswordInput) {
            setupPasswordInput.focus();
        }
    }

    /**
     * Hide the loading indicator
     */
    function hideLoading() {
        if (loading) {
            loading.classList.add('hidden');
        }
    }

    /**
     * Check if passkey login is available
     * Returns true only if WebAuthn is supported, enabled, AND passkeys are registered
     */
    async function checkPasskeyAvailability() {
        if (!passkeySection) {
            console.debug('Passkey: Section not found in DOM');
            return false;
        }

        if (typeof window.webAuthnManager === 'undefined') {
            console.debug('Passkey: webAuthnManager not loaded');
            return false;
        }

        if (!window.webAuthnManager.supported) {
            console.debug('Passkey: WebAuthn not supported by browser');
            return false;
        }

        try {
            const response = await fetch('/api/auth/webauthn/available');

            if (!response.ok) {
                console.debug('Passkey: Server returned error', response.status);
                return false;
            }

            const data = await response.json();
            console.debug('Passkey: Server response', data);

            const isAvailable = data.enabled === true && data.available === true;
            console.debug(
                'Passkey: enabled=' +
                    data.enabled +
                    ', available=' +
                    data.available +
                    ', showing=' +
                    isAvailable
            );

            return isAvailable;
        } catch (err) {
            console.error('Passkey: Availability check failed', err);
            return false;
        }
    }

    /**
     * Handle password login form submission
     */
    async function handlePasswordLogin(e) {
        e.preventDefault();
        hideError(loginError);

        // Abort any conditional UI
        if (window.webAuthnManager) {
            window.webAuthnManager.abortConditionalUI();
        }

        const password = passwordInput.value;

        if (!password) {
            showError(loginError, 'Please enter your password');
            return;
        }

        setButtonLoading(loginSubmitBtn, true, 'Logging in...');

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });

            if (response.ok) {
                redirectToApp();
            } else {
                const errorText = await response.text();
                showError(loginError, errorText || 'Invalid password');
                passwordInput.classList.add('error');
                passwordInput.focus();
                passwordInput.select();
            }
        } catch (err) {
            console.error('Login error:', err);
            showError(loginError, 'Connection error. Please try again.');
        } finally {
            setButtonLoading(loginSubmitBtn, false, 'Login');
        }
    }

    /**
     * Handle passkey login button click or auto-trigger
     * @param {boolean} autoTriggered - Whether this was auto-triggered (not user click)
     */
    async function handlePasskeyLogin(autoTriggered = false) {
        // If this is an event object (from click handler), extract the flag
        if (typeof autoTriggered === 'object') {
            autoTriggered = false;
        }

        hideError(loginError);

        if (!window.webAuthnManager) {
            if (!autoTriggered) {
                showError(loginError, 'Passkey authentication not available');
            }
            return;
        }

        // Prevent multiple simultaneous attempts
        if (passkeyLoginInProgress) {
            return;
        }

        passkeyLoginInProgress = true;
        setPasskeyButtonLoading(true);

        try {
            const result = await window.webAuthnManager.login();

            if (result.success) {
                redirectToApp();
            } else {
                if (!autoTriggered) {
                    showError(loginError, result.message || 'Passkey authentication failed');
                }
            }
        } catch (err) {
            console.error('Passkey login error:', err);

            // Only show errors for user-initiated attempts
            if (!autoTriggered) {
                let errorMessage = 'Passkey authentication failed';

                if (err.message) {
                    const msg = err.message.toLowerCase();

                    if (
                        msg.includes('cancelled') ||
                        msg.includes('notallowederror') ||
                        msg.includes('not allowed')
                    ) {
                        errorMessage = 'Authentication was cancelled';
                    } else if (
                        msg.includes('not found') ||
                        msg.includes('no passkeys') ||
                        msg.includes('no credentials')
                    ) {
                        errorMessage =
                            'No passkeys found. Please log in with your password, then add a passkey in Settings.';
                    } else if (msg.includes('timeout')) {
                        errorMessage = 'Authentication timed out. Please try again.';
                    } else if (msg.includes('not configured') || msg.includes('not enabled')) {
                        errorMessage = 'Passkey authentication is not configured.';
                    } else {
                        errorMessage = err.message;
                    }
                }

                showError(loginError, errorMessage);
            }
        } finally {
            passkeyLoginInProgress = false;
            setPasskeyButtonLoading(false);
        }
    }

    /**
     * Handle setup form submission
     */
    async function handleSetup(e) {
        e.preventDefault();
        hideError(setupError);

        const password = document.getElementById('setup-password').value;
        const confirm = document.getElementById('setup-confirm').value;

        if (password.length < 6) {
            showError(setupError, 'Password must be at least 6 characters');
            return;
        }

        if (password !== confirm) {
            showError(setupError, 'Passwords do not match');
            return;
        }

        setButtonLoading(setupSubmitBtn, true, 'Creating...');

        try {
            const setupResponse = await fetch('/api/auth/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });

            if (!setupResponse.ok) {
                const errorText = await setupResponse.text();
                showError(setupError, errorText || 'Failed to create password');
                return;
            }

            const loginResponse = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });

            if (loginResponse.ok) {
                redirectToApp();
            } else {
                if (setupForm) setupForm.classList.add('hidden');
                await showLoginForm();
            }
        } catch (err) {
            console.error('Setup error:', err);
            showError(setupError, 'Connection error. Please try again.');
        } finally {
            setButtonLoading(setupSubmitBtn, false, 'Create Password');
        }
    }

    /**
     * Redirect to the main application
     */
    function redirectToApp() {
        window.location.href = '/';
    }

    /**
     * Show an error message
     */
    function showError(element, message) {
        if (!element) return;

        const span = element.querySelector('span');
        if (span) {
            span.textContent = message;
        }
        element.classList.remove('hidden');
    }

    /**
     * Hide an error message
     */
    function hideError(element) {
        if (element) {
            element.classList.add('hidden');
        }
    }

    /**
     * Set button loading state
     */
    function setButtonLoading(button, isLoading, text) {
        if (!button) return;
        button.disabled = isLoading;
        button.textContent = text;
    }

    /**
     * Set passkey button loading state
     */
    function setPasskeyButtonLoading(isLoading) {
        if (!passkeyLoginBtn) return;

        passkeyLoginBtn.disabled = isLoading;

        const btnText = passkeyLoginBtn.querySelector('.btn-text');
        const icon = passkeyLoginBtn.querySelector('.passkey-icon');

        if (isLoading) {
            if (btnText) btnText.textContent = 'Authenticating...';
            if (icon) icon.style.display = 'none';

            let spinner = passkeyLoginBtn.querySelector('.spinner');
            if (!spinner) {
                spinner = document.createElement('div');
                spinner.className = 'spinner';
                spinner.style.width = '20px';
                spinner.style.height = '20px';
                passkeyLoginBtn.insertBefore(spinner, passkeyLoginBtn.firstChild);
            }
        } else {
            if (btnText) btnText.textContent = 'Sign in with Passkey';
            if (icon) icon.style.display = '';

            const spinner = passkeyLoginBtn.querySelector('.spinner');
            if (spinner) spinner.remove();
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
