/**
 * E2E tests for authentication and login flow
 * Tests the complete login experience
 * @tags @auth @core @session @login
 */

import { test, expect } from '../../fixtures/index.js';

test.describe('Authentication @auth @core', () => {
    test.beforeEach(async ({ page }) => {
        // Clear any existing session
        await page.context().clearCookies();
    });

    test('should display login page', async ({ page }) => {
        await page.goto('/login.html');

        await expect(page.locator('input[name="password"]')).toBeVisible();
        await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('should show validation errors for empty fields', async ({ page }) => {
        await page.goto('/login.html');

        // Try to submit without filling fields
        await page.click('button[type="submit"]');

        // Should show HTML5 validation or custom error
        const passwordInput = page.locator('input[name="password"]');
        await expect(passwordInput).toHaveAttribute('required', '');
    });

    test('should successfully login with valid credentials', async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        // Should redirect to main page
        await expect(page).toHaveURL('/');

        // Should see gallery
        await expect(page.locator('.gallery, #gallery')).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
        await page.goto('/login.html');

        await page.fill('input[name="password"]', 'wrongpass');
        await page.click('button[type="submit"]');

        // Should show error message (adjust selector based on your implementation)
        await expect(page.locator('.error-message, .alert-error, [role="alert"]')).toBeVisible({
            timeout: 5000,
        });
    });

    test('should redirect to login when accessing protected page without auth', async ({
        page,
    }) => {
        // Clear cookies to ensure not authenticated
        await page.context().clearCookies();

        // Try to access main page
        await page.goto('/');

        // Should redirect to login
        await expect(page).toHaveURL(/login/);
    });

    test('should logout successfully', async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        // Find and click logout button
        const logoutButton = page.locator('button:has-text("Logout"), a:has-text("Logout")');
        await logoutButton.click();

        // Should redirect to login
        await expect(page).toHaveURL(/login/, { timeout: 5000 });
    });

    test('should remember session after page reload @session', async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        // Reload page
        await page.reload();

        // Should still be logged in
        await expect(page.locator('.gallery, #gallery')).toBeVisible();
    });

    test('should handle session expiration @session', async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        // Mock session expiration by clearing cookies
        await page.context().clearCookies();

        // Try to navigate or perform action
        await page.goto('/');

        // Should redirect to login
        await expect(page).toHaveURL(/login/);
    });

    test('should show/hide password toggle', async ({ page }) => {
        await page.goto('/login.html');

        const passwordInput = page.locator('input[name="password"]');
        const toggleButton = page.locator('button:has-text("Show"), [aria-label*="password"]');

        if ((await toggleButton.count()) > 0) {
            // Check initial type
            await expect(passwordInput).toHaveAttribute('type', 'password');

            // Click toggle
            await toggleButton.click();

            // Should change to text
            await expect(passwordInput).toHaveAttribute('type', 'text');

            // Click again to hide
            await toggleButton.click();

            // Should change back to password
            await expect(passwordInput).toHaveAttribute('type', 'password');
        }
    });

    test('should support keyboard navigation on login form', async ({ page }) => {
        await page.goto('/login.html');

        const passwordInput = page.locator('input[name="password"]');
        const submitButton = page.locator('button[type="submit"]');

        // Focus password field
        await passwordInput.focus();
        await expect(passwordInput).toBeFocused();

        // Tab to submit button
        await page.keyboard.press('Tab');
        await expect(submitButton).toBeFocused();
    });

    test('should prevent multiple simultaneous login attempts', async ({ page }) => {
        await page.goto('/login.html');

        await page.fill('input[name="password"]', 'testpass');

        // Click submit multiple times rapidly
        const submitButton = page.locator('button[type="submit"]');
        await submitButton.click();
        await submitButton.click();
        await submitButton.click();

        // Should handle gracefully (button might be disabled)
        // Wait a bit and check we're not in a broken state
        await page.waitForTimeout(1000);

        // Should either be logged in or still on login page with error
        const url = page.url();
        expect(url).toMatch(/\/(login|$)/);
    });
});

test.describe('WebAuthn Authentication @webauthn @auth @core', () => {
    test('should show WebAuthn option if supported', async ({ page, browserName }) => {
        // Skip on browsers that don't support WebAuthn well
        test.skip(browserName === 'webkit', 'WebAuthn support varies on WebKit');

        await page.goto('/login.html');

        // Check if WebAuthn button is present
        const webauthnButton = page.locator('button:has-text("WebAuthn"), [data-webauthn]');

        if ((await webauthnButton.count()) > 0) {
            await expect(webauthnButton).toBeVisible();
        }
    });
});
