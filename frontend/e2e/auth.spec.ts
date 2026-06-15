import { test, expect } from '@playwright/test';
import { TEST_PASSWORD, STORAGE_STATE } from './global-setup';

// ── Unauthenticated behaviour ────────────────────────────────────────────────

test('@smoke @auth redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/');
    // Auth check runs in onMount; wait until the redirect fires or splash clears.
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
});

test('@smoke @auth login page renders the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /media viewer/i })).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('@smoke @auth shows error for wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await page.getByLabel('Password').fill('wrong-password-xyz');
    await page.getByRole('button', { name: /sign in/i }).click({ force: true });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
});

test('@smoke @auth can log in with the correct password', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click({ force: true });
    await page.waitForURL('/');
    await expect(page).toHaveURL('/');
});

// ── Sign-out requires an established session ─────────────────────────────────

test.describe('authenticated — sign out', () => {
    // Log in fresh (not via the shared STORAGE_STATE) so that signing out
    // does NOT invalidate the session used by other spec files.
    test('@smoke @auth sign out redirects to /login', async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await page.getByLabel('Password').fill(TEST_PASSWORD);
        await page.getByRole('button', { name: /sign in/i }).click({ force: true });
        await page.waitForURL('/');
        await page.getByRole('button', { name: /sign out/i }).click({ force: true });
        await expect(page).toHaveURL(/\/login/);
    });
});
