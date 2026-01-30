document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const setupForm = document.getElementById('setup-form');
    const loading = document.getElementById('loading');
    const loginError = document.getElementById('login-error');
    const setupError = document.getElementById('setup-error');

    // Check if setup is required
    checkSetupRequired();

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

    function showError(element, message) {
        element.textContent = message;
        element.classList.remove('hidden');
    }

    function hideError(element) {
        element.classList.add('hidden');
    }

    // Login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError(loginError);

        const password = document.getElementById('login-password').value;

        if (!password) {
            showError(loginError, 'Please enter your password');
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
                showError(loginError, errorText || 'Invalid password');
            }
        } catch (error) {
            console.error('Login error:', error);
            showError(loginError, 'An error occurred. Please try again.');
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
            showError(setupError, 'Password must be at least 6 characters');
            return;
        }

        if (password !== confirm) {
            showError(setupError, 'Passwords do not match');
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
                showError(setupError, errorText || 'Failed to create password');
            }
        } catch (error) {
            console.error('Setup error:', error);
            showError(setupError, 'An error occurred. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Password';
        }
    });
});
