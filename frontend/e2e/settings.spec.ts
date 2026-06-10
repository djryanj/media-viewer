import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

test.use({ storageState: STORAGE_STATE });

test('@smoke @settings settings button is visible in the header', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});

test('@smoke @settings clicking settings opens a dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.getByRole('button', { name: 'Settings' }).click({ force: true });
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('@smoke @settings settings dialog can be closed', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.getByRole('button', { name: 'Settings' }).click({ force: true });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Close via the close button inside the dialog
    await dialog.getByRole('button', { name: /close/i }).click({ force: true });
    await expect(dialog).not.toBeVisible();
});

test('@smoke @settings pressing Escape closes the settings dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.getByRole('button', { name: 'Settings' }).click({ force: true });
    await expect(page.getByRole('dialog')).toBeVisible();

    // Explicitly focus the dialog overlay so the onkeydown handler fires.
    // force:true click dispatches the event without moving focus.
    await page.getByRole('dialog').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
});
