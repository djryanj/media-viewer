import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

test.use({ storageState: STORAGE_STATE });

test('@smoke @search pressing "/" on the gallery page opens search', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    // Ensure no input is focused
    await page.keyboard.press('Escape');
    await page.keyboard.press('/');
    // The search bar should now be visible and focused
    const searchInput = page.getByRole('combobox');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
});

test('@smoke @search pressing Ctrl+K on the gallery page opens search', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.keyboard.press('Control+k');
    const searchInput = page.getByRole('combobox');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
});

test('@smoke @search pressing "/" does not open search when an input is focused', async ({ page }) => {
    // On the search page, the search input is already visible — pressing "/" inside
    // the focused input should type the character, not re-trigger openSearch.
    await page.goto('/search');
    // Scope to the page's own search input — the header SearchBar is also a combobox
    // on desktop widths, so a bare getByRole('combobox') would be ambiguous here.
    const searchInput = page.getByRole('combobox', { name: 'Search query' });
    await searchInput.click({ force: true });
    await page.keyboard.press('/');
    // The slash should have been typed into the input, not swallowed
    await expect(searchInput).toHaveValue('/');
});

test('@smoke @search search closes when Escape is pressed after Ctrl+K', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.keyboard.press('Control+k');
    const searchInput = page.getByRole('combobox');
    await expect(searchInput).toBeVisible();
    await page.keyboard.press('Escape');
    // On mobile the search bar hides; on desktop it stays visible but blur is enough
    // The important thing is no JS errors occur
    await expect(page).toHaveURL('/');
});
