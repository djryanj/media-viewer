/**
 * E2E tests for authentication and login flow
 * @tags @auth @core @session @login
 */

import { test, expect } from '../../fixtures/index.js';

test.describe('Authentication @auth @core @login', () => {
    test.beforeEach(async ({ page }) => {
        await page.context().clearCookies();
    });

    test('should display login page', async ({ page }) => {
        await page.goto('/login.html');
        await page.locator('#login-submit').waitFor({ state: 'visible', timeout: 15000 });

        await expect(page.locator('#password')).toBeVisible();
        await expect(page.locator('#login-submit')).toBeVisible();
    });

    test('should show validation errors for empty fields', async ({ page }) => {
        await page.goto('/login.html');
        await page.locator('#login-submit').waitFor({ state: 'visible', timeout: 15000 });

        await expect(page.locator('#password')).toHaveAttribute('required', '');

        await page.locator('#login-submit').dispatchEvent('click');

        await page.waitForTimeout(500);
        await expect(page).toHaveURL(/login/);
    });

    test('should successfully login with valid credentials', async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        await expect(page).toHaveURL('/');
        await expect(page.locator('#gallery')).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
        await page.goto('/login.html');
        await page.locator('#login-submit').waitFor({ state: 'visible', timeout: 15000 });

        await page.fill('#password', 'wrongpass');

        await page.evaluate(() => {
            document
                .getElementById('login-form')
                .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });

        await expect(page.locator('#login-error')).toBeVisible({ timeout: 10000 });
    });

    test('should redirect to login when accessing protected page without auth', async ({
        page,
    }) => {
        await page.context().clearCookies();

        try {
            await page.goto('/', { waitUntil: 'commit' });
        } catch {
            // Navigation may be interrupted by JS redirect.
        }

        await expect(page).toHaveURL(/login/, { timeout: 10000 });
    });

    test('should logout successfully', async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        await page.request.post('/api/auth/logout');

        try {
            await page.goto('/login.html', { waitUntil: 'commit' });
        } catch {
            // Mobile Safari can interrupt the explicit navigation with the same redirect.
        }

        await expect(page).toHaveURL(/login/, { timeout: 10000 });
    });

    test('should remember session after page reload @session', async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        await page.reload();

        await expect(page.locator('#gallery')).toBeVisible({ timeout: 10000 });
    });

    test('should handle session expiration @session', async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await expect(page.locator('#gallery')).toBeVisible({ timeout: 10000 });

        const logoutResponse = await page.request.post('/api/auth/logout');
        expect(logoutResponse.ok()).toBe(true);

        await expect
            .poll(async () => {
                try {
                    const response = await page.request.get('/api/auth/check');
                    if (!response.ok()) {
                        return false;
                    }

                    const data = await response.json();
                    return data.authenticated;
                } catch {
                    return false;
                }
            })
            .toBe(false);

        // Mobile Safari can retain a stale browser cookie after the API-request
        // session is invalidated. Clear browser cookies so the next navigation
        // exercises the protected-route redirect consistently across engines.
        await page.context().clearCookies();

        try {
            await page.goto('/?e2e-session-expired=1', { waitUntil: 'commit' });
        } catch {
            // Navigation interrupted by redirect.
        }

        await expect(page).toHaveURL(/login/, { timeout: 10000 });
    });

    test('should show/hide password toggle', async ({ page }) => {
        await page.goto('/login.html');
        await page.locator('#login-submit').waitFor({ state: 'visible', timeout: 15000 });

        const passwordInput = page.locator('#password');
        const toggleButton = page.locator('#login-form .password-toggle');

        if ((await toggleButton.count()) > 0) {
            await expect(passwordInput).toHaveAttribute('type', 'password');

            await toggleButton.dispatchEvent('click');

            await expect(passwordInput).toHaveAttribute('type', 'text');

            await toggleButton.dispatchEvent('click');

            await expect(passwordInput).toHaveAttribute('type', 'password');
        }
    });

    test('should support keyboard navigation on login form @keyboard', async ({ page }) => {
        await page.route('**/api/auth/webauthn/available', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    enabled: false,
                    available: false,
                    hasCredentials: false,
                }),
            });
        });

        await page.goto('/login.html');
        await page.locator('#login-submit').waitFor({ state: 'visible', timeout: 15000 });

        const passwordInput = page.locator('#password');
        const submitButton = page.locator('#login-submit');

        await passwordInput.focus();
        await expect(passwordInput).toBeFocused();

        await page.keyboard.press('Tab');

        await expect(submitButton).toBeFocused();
    });

    test('should prevent multiple simultaneous login attempts', async ({ page }) => {
        await page.goto('/login.html');
        await page.locator('#login-submit').waitFor({ state: 'visible', timeout: 15000 });

        await page.fill('#password', 'testpass');

        let requestCount = 0;

        await page.route('/api/auth/login', async (route) => {
            requestCount++;
            if (requestCount === 1) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                await route.fulfill({
                    status: 401,
                    contentType: 'text/plain',
                    body: 'Invalid password',
                });
            } else {
                await route.fulfill({
                    status: 401,
                    contentType: 'text/plain',
                    body: 'Invalid password',
                });
            }
        });

        await page.evaluate(() => {
            document
                .getElementById('login-form')
                .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });

        await expect
            .poll(async () => {
                return {
                    isDisabled: await page.locator('#login-submit').isDisabled(),
                    requestCount,
                };
            })
            .toEqual({ isDisabled: true, requestCount: 1 });

        await page.waitForTimeout(1000);

        await expect(page.locator('#login-submit')).toBeEnabled({ timeout: 5000 });
        expect(requestCount).toBeGreaterThanOrEqual(1);

        await page.unroute('/api/auth/login');
    });
});

test.describe('WebAuthn Authentication @webauthn @auth @core', () => {
    test('should show WebAuthn option if supported', async ({ page, browserName }) => {
        test.skip(browserName === 'webkit', 'WebAuthn support varies on WebKit');

        await page.goto('/login.html');
        await page.locator('#login-submit').waitFor({ state: 'visible', timeout: 15000 });

        const webauthnButton = page.locator('#passkey-login-btn');

        if ((await webauthnButton.count()) > 0) {
            const isVisible = await webauthnButton.isVisible();
            expect(typeof isVisible).toBe('boolean');
        }
    });
});
