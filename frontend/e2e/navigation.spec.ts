import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

test.use({ storageState: STORAGE_STATE });

// Each test navigates directly so it isn't sensitive to whether the bottom
// nav or desktop nav is rendered at the test viewport width.

test('@smoke @navigation favorites page is reachable', async ({ page }) => {
    await page.goto('/favorites');
    await expect(page).toHaveURL('/favorites');
    await expect(page).toHaveTitle(/Favorites/);
});

test('@smoke @navigation search page is reachable', async ({ page }) => {
    await page.goto('/search');
    await expect(page).toHaveURL('/search');
    await expect(page).toHaveTitle(/Search/);
});

test('@smoke @navigation collections page is reachable', async ({ page }) => {
    await page.goto('/collections');
    await expect(page).toHaveURL('/collections');
    await expect(page).toHaveTitle(/Collections|Albums/i);
});

test('@smoke @navigation logo button navigates to library root', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await page.getByRole('button', { name: 'Go to library root' }).click({ force: true });
    await expect(page).toHaveURL('/');
});

test('@smoke @navigation bottom-nav Library tab navigates to /', async ({ page }) => {
    // Force mobile viewport so the bottom nav is visible
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/search');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    // Use exact match to avoid partial hits on the logo ("Go to library root")
    await page.getByRole('button', { name: 'Library', exact: true }).click({ force: true });
    await expect(page).toHaveURL('/');
});

test('@smoke @navigation bottom-nav Favorites tab navigates to /favorites', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    // Use exact match to avoid partial hits on gallery "Add to favorites" buttons
    await page.getByRole('button', { name: 'Favorites', exact: true }).click({ force: true });
    await expect(page).toHaveURL('/favorites');
});

test('@smoke @navigation bottom-nav Search tab navigates to /search', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    // Use exact match to avoid partial hits on the "Toggle search" header button
    await page.getByRole('button', { name: 'Search', exact: true }).click({ force: true });
    await expect(page).toHaveURL('/search');
});

test('@smoke @navigation bottom-nav Albums tab navigates to /collections', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await page.getByRole('button', { name: 'Albums', exact: true }).click({ force: true });
    await expect(page).toHaveURL('/collections');
});
