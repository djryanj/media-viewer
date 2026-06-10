import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

test.use({ storageState: STORAGE_STATE });

test('@smoke @search search page loads with correct title', async ({ page }) => {
    await page.goto('/search');
    await expect(page).toHaveTitle(/Search/);
});

test('@smoke @search shows prompt when no query is given', async ({ page }) => {
    await page.goto('/search');
    await expect(page.getByText('Enter a search term above.')).toBeVisible();
});

test('@smoke @search search heading is visible', async ({ page }) => {
    await page.goto('/search');
    await expect(page.getByRole('heading', { name: /search/i })).toBeVisible();
});

test('@smoke @search submitting a query updates the URL', async ({ page }) => {
    await page.goto('/search');

    // The search bar sits in the header; toggle it on mobile if needed
    const searchInput = page.getByRole('combobox');
    // On desktop the search bar is always visible; on mobile it needs the toggle
    const isVisible = await searchInput.isVisible();
    if (!isVisible) {
        await page.getByRole('button', { name: 'Toggle search' }).click({ force: true });
    }

    await searchInput.fill('vacation');
    await searchInput.press('Enter');

    await expect(page).toHaveURL(/\/search\?q=vacation/);
});

test('@smoke @search shows no-results message for an unknown query', async ({ page }) => {
    await page.goto('/search?q=zzz_no_match_xyz');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/no results found/i)).toBeVisible();
});

test('@smoke @search title updates to reflect the active query', async ({ page }) => {
    await page.goto('/search?q=nature');
    await expect(page).toHaveTitle(/nature/i);
});
