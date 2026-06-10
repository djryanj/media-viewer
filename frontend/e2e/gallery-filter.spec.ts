import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

test.use({ storageState: STORAGE_STATE });

test('@smoke @gallery type filter chips are visible in the toolbar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    const typeFilter = page.getByRole('group', { name: /filter by type/i });
    await expect(typeFilter.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await expect(typeFilter.getByRole('button', { name: 'Images', exact: true })).toBeVisible();
    await expect(typeFilter.getByRole('button', { name: 'Videos', exact: true })).toBeVisible();
    await expect(typeFilter.getByRole('button', { name: 'Folders', exact: true })).toBeVisible();
    await expect(typeFilter.getByRole('button', { name: 'Playlists', exact: true })).toBeVisible();
});

test('@smoke @gallery "All" filter chip is active by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    const allChip = page.getByRole('group', { name: /filter by type/i }).getByRole('button', { name: 'All', exact: true });
    await expect(allChip).toHaveAttribute('aria-pressed', 'true');
});

test('@smoke @gallery clicking a type filter chip activates it', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    const typeFilter = page.getByRole('group', { name: /filter by type/i });
    const imagesChip = typeFilter.getByRole('button', { name: 'Images', exact: true });
    const allChip = typeFilter.getByRole('button', { name: 'All', exact: true });
    await imagesChip.click({ force: true });
    await expect(imagesChip).toHaveAttribute('aria-pressed', 'true');
    // "All" is now inactive
    await expect(allChip).toHaveAttribute('aria-pressed', 'false');
});

test('@smoke @gallery clicking "All" after a filter restores all-active state', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    const typeFilter = page.getByRole('group', { name: /filter by type/i });
    await typeFilter.getByRole('button', { name: 'Videos', exact: true }).click({ force: true });
    await typeFilter.getByRole('button', { name: 'All', exact: true }).click({ force: true });
    await expect(typeFilter.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('@smoke @gallery filter chips have accessible group label', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await expect(page.getByRole('group', { name: /filter by type/i })).toBeVisible();
});
