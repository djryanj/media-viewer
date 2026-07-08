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

    // The header search bar (role="combobox") is always visible at desktop widths.
    // Scope to .search-wrap to avoid any ambiguity with other combobox elements.
    const searchInput = page.locator('.search-wrap').getByRole('combobox');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
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

// ── Selection (Ctrl+A / Escape) on search results ────────────────────────────

const SEARCH_TWO_ITEMS = JSON.stringify({
    items: [
        { id: 1, name: 'a.jpg', path: '/a.jpg', parentPath: '/', type: 'image', size: 0, modTime: '' },
        { id: 2, name: 'b.jpg', path: '/b.jpg', parentPath: '/', type: 'image', size: 0, modTime: '' }
    ],
    totalItems: 2
});

test('@smoke @search Ctrl+A selects all items on the search results page', async ({ page }) => {
    await page.route('**/api/search**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: SEARCH_TWO_ITEMS })
    );

    await page.goto('/search?q=test');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.gallery-item')).toHaveCount(2, { timeout: 5000 });

    // SearchBar auto-focuses its input on mount; blur it so the Ctrl+A
    // shortcut fires on the page (not inside an input where it selects text).
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+a');
    await expect(page.locator('.gallery-item.selected')).toHaveCount(2, { timeout: 2000 });
});

test('@smoke @search Escape clears selection on the search results page', async ({ page }) => {
    await page.route('**/api/search**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: SEARCH_TWO_ITEMS })
    );

    await page.goto('/search?q=test');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.gallery-item')).toHaveCount(2, { timeout: 5000 });

    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+a');
    await expect(page.locator('.gallery-item.selected')).toHaveCount(2, { timeout: 2000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('.gallery-item.selected')).toHaveCount(0, { timeout: 2000 });
});

// ── Sort ──────────────────────────────────────────────────────────────────────

const SEARCH_THREE_ITEMS = JSON.stringify({
    items: [
        { id: 1, name: 'alpha.jpg', path: '/alpha.jpg', parentPath: '/', type: 'image', size: 100, modTime: '2024-01-01T00:00:00Z' },
        { id: 2, name: 'beta.jpg',  path: '/beta.jpg',  parentPath: '/', type: 'image', size: 200, modTime: '2024-01-02T00:00:00Z' },
        { id: 3, name: 'gamma.jpg', path: '/gamma.jpg', parentPath: '/', type: 'image', size: 300, modTime: '2024-01-03T00:00:00Z' }
    ],
    totalItems: 3
});

test('@smoke @search sort dropdown is visible on search results', async ({ page }) => {
    await page.route('**/api/search**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: SEARCH_THREE_ITEMS })
    );
    await page.goto('/search?q=test');
    await page.waitForLoadState('networkidle');

    // The sort button label should be visible
    await expect(page.getByRole('button', { name: /Name \(A–Z\)|Name \(Z–A\)|Newest|Oldest|Largest|Smallest|Sort/i }).first()).toBeVisible({ timeout: 5000 });
});

test('@search changing sort option triggers a new API call with sort params', async ({ page }) => {
    const requests: string[] = [];
    await page.route('**/api/search**', (route) => {
        requests.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'application/json', body: SEARCH_THREE_ITEMS });
    });

    await page.goto('/search?q=test');
    await page.waitForLoadState('networkidle');

    // Clear collected requests from initial load
    requests.length = 0;

    // Open sort dropdown and click "Newest first"
    await page.getByRole('button', { name: /Name \(A–Z\)|Sort/i }).first().click();
    await page.getByRole('button', { name: 'Newest first' }).click();

    // Wait for a new API call with sort=date&order=desc
    await expect.poll(() => requests.some(u => u.includes('sort=date') && u.includes('order=desc')), {
        timeout: 5000
    }).toBe(true);
});

test('@search sort request includes correct sort and order params', async ({ page }) => {
    const captured: URL[] = [];
    await page.route('**/api/search**', (route) => {
        captured.push(new URL(route.request().url()));
        return route.fulfill({ status: 200, contentType: 'application/json', body: SEARCH_THREE_ITEMS });
    });

    await page.goto('/search?q=test');
    await page.waitForLoadState('networkidle');
    captured.length = 0;

    // Select "Largest first" (sort=size, order=desc)
    await page.getByRole('button', { name: /Name \(A–Z\)|Sort/i }).first().click();
    await page.getByRole('button', { name: 'Largest first' }).click();

    await expect.poll(() => captured.length > 0, { timeout: 5000 }).toBe(true);
    const url = captured[0];
    expect(url.searchParams.get('sort')).toBe('size');
    expect(url.searchParams.get('order')).toBe('desc');
});

// ── Status bar ────────────────────────────────────────────────────────────────

test('@smoke @search status bar shows correct item count from search results', async ({ page }) => {
    const body = JSON.stringify({
        items: [
            { id: 1, name: 'photo.jpg', path: '/photo.jpg', parentPath: '/', type: 'image', size: 100, modTime: '2024-01-01T00:00:00Z' }
        ],
        totalItems: 42
    });
    await page.route('**/api/search**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body })
    );

    await page.goto('/search?q=test');
    await page.waitForLoadState('networkidle');

    // Status footer should show "42 items" — the totalItems from the search
    // result, not a stale directory count.
    await expect(page.locator('.status-footer')).toContainText('42 items', { timeout: 5000 });
});

// ── Suggestions on search page (mobile) ───────────────────────────────────────

const SUGGEST_ONE = JSON.stringify([
    { path: '/nature.jpg', name: 'nature', type: 'image', highlight: 'nature' }
]);

test('@smoke @search mobile: search page shows suggestions while typing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/search/suggestions**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: SUGGEST_ONE })
    );

    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // At mobile widths the header SearchBar is hidden; only the page input is visible.
    const input = page.locator('.search-query-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('nat');

    await expect(page.locator('.page-suggestions')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.page-sug-name').first()).toContainText('nature');
});

test('@smoke @search mobile: clicking a suggestion navigates to the correct URL', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/search/suggestions**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: SUGGEST_ONE })
    );

    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const input = page.locator('.search-query-input');
    await input.fill('nat');
    await expect(page.locator('.page-suggestions')).toBeVisible({ timeout: 2000 });
    await page.locator('.page-sug-item').first().click();

    await expect(page).toHaveURL(/\/search\?q=nature/);
});

// ── GalleryToolbar ────────────────────────────────────────────────────────────

test('@search GalleryToolbar renders on the search page when in selection mode', async ({ page }) => {
    await page.route('**/api/search**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: SEARCH_TWO_ITEMS })
    );

    await page.goto('/search?q=test');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.gallery-item')).toHaveCount(2, { timeout: 5000 });

    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+a');
    // In selection mode the toolbar shows the item count and bulk-action buttons
    await expect(page.getByText(/2 selected/i)).toBeVisible({ timeout: 2000 });
});
