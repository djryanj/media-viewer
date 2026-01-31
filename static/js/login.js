document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const setupForm = document.getElementById('setup-form');
    const loading = document.getElementById('loading');
    const loginError = document.getElementById('login-error');
    const loginErrorText = document.getElementById('login-error-text');
    const setupError = document.getElementById('setup-error');
    const setupErrorText = document.getElementById('setup-error-text');

    // Setup password visibility toggles
    setupPasswordToggles();

    // Check if setup is required
    checkSetupRequired();

    /**
     * Setup password visibility toggle buttons
     */
    function setupPasswordToggles() {
        const toggles = document.querySelectorAll('.password-toggle');

        toggles.forEach((toggle) => {
            toggle.addEventListener('click', () => {
                const wrapper = toggle.closest('.password-input-wrapper');
                const input = wrapper.querySelector('input');
                const eyeIcon = toggle.querySelector('.icon-eye');
                const eyeOffIcon = toggle.querySelector('.icon-eye-off');

                if (input.type === 'password') {
                    input.type = 'text';
                    eyeIcon.style.display = 'none';
                    eyeOffIcon.style.display = 'block';
                    toggle.setAttribute('aria-label', 'Hide password');
                } else {
                    input.type = 'password';
                    eyeIcon.style.display = 'block';
                    eyeOffIcon.style.display = 'none';
                    toggle.setAttribute('aria-label', 'Show password');
                }

                // Keep focus on the input for better UX
                input.focus();
            });
        });
    }

    async function checkSetupRequired() {
        showLoading();
        try {
            // First check if already authenticated
            const authResponse = await fetch('/api/auth/check');
            const authData = await authResponse.json();

            if (authData.success) {
                // Already logged in, redirect to main page
                window.location.href = '/';
                return;
            }

            // Check if setup is needed
            const setupResponse = await fetch('/api/auth/setup-required');
            const setupData = await setupResponse.json();

            hideLoading();

            if (setupData.needsSetup) {
                showSetupForm();
            } else {
                showLoginForm();
            }
        } catch (error) {
            console.error('Error checking setup status:', error);
            hideLoading();
            showLoginForm();
        }
    }

    function showLoading() {
        loading.classList.remove('hidden');
        loginForm.classList.add('hidden');
        setupForm.classList.add('hidden');
    }

    function hideLoading() {
        loading.classList.add('hidden');
    }

    function showLoginForm() {
        loginForm.classList.remove('hidden');
        setupForm.classList.add('hidden');
        document.getElementById('login-password').focus();
    }

    function showSetupForm() {
        setupForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        document.getElementById('setup-password').focus();
    }

    function showError(errorElement, textElement, message) {
        textElement.textContent = message;
        errorElement.classList.remove('hidden');

        // Add shake animation to the relevant input(s)
        const form = errorElement.closest('form');
        const inputs = form.querySelectorAll('input');
        inputs.forEach((input) => {
            input.classList.add('error');
            setTimeout(() => input.classList.remove('error'), 400);
        });
    }

    function hideError(errorElement) {
        errorElement.classList.add('hidden');
    }

    function selectPasswordText(inputId) {
        const input = document.getElementById(inputId);
        if (input) {
            input.focus();
            input.select();
        }
    }

    // Login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError(loginError);

        const passwordInput = document.getElementById('login-password');
        const password = passwordInput.value;

        if (!password) {
            showError(loginError, loginErrorText, 'Please enter your password');
            passwordInput.focus();
            return;
        }

        const submitBtn = loginForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Logging in...';

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });

            if (response.ok) {
                window.location.href = '/';
            } else {
                const errorText = await response.text();
                showError(loginError, loginErrorText, errorText || 'Invalid password');
                // Select the password text so user can easily retype or see it
                selectPasswordText('login-password');
            }
        } catch (error) {
            console.error('Login error:', error);
            showError(loginError, loginErrorText, 'An error occurred. Please try again.');
            selectPasswordText('login-password');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Login';
        }
    });

    // Setup form submission
    setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError(setupError);

        const password = document.getElementById('setup-password').value;
        const confirm = document.getElementById('setup-confirm').value;

        // Validation
        if (password.length < 6) {
            showError(setupError, setupErrorText, 'Password must be at least 6 characters');
            selectPasswordText('setup-password');
            return;
        }

        if (password !== confirm) {
            showError(setupError, setupErrorText, 'Passwords do not match');
            selectPasswordText('setup-confirm');
            return;
        }

        const submitBtn = setupForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating password...';

        try {
            const response = await fetch('/api/auth/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });

            if (response.ok) {
                // Password created, now log in
                const loginResponse = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                });

                if (loginResponse.ok) {
                    window.location.href = '/';
                } else {
                    // Password created but login failed, show login form
                    showLoginForm();
                }
            } else {
                const errorText = await response.text();
                showError(setupError, setupErrorText, errorText || 'Failed to create password');
            }
        } catch (error) {
            console.error('Setup error:', error);
            showError(setupError, setupErrorText, 'An error occurred. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Password';
        }
    });

    // Clear error when user starts typing
    document.getElementById('login-password').addEventListener('input', () => {
        hideError(loginError);
    });

    document.getElementById('setup-password').addEventListener('input', () => {
        hideError(setupError);
    });

    document.getElementById('setup-confirm').addEventListener('input', () => {
        hideError(setupError);
    });
});
