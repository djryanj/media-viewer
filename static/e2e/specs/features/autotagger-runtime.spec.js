/**
 * Docker-backed smoke test for real runtime metadata extraction layered on top
 * of the normal Chromium smoke coverage.
 * @tags @autotagger @docker-runtime @features
 */

import { test, expect } from '../../fixtures/index.js';

const FIXTURE_NAME = process.env.AUTOTAGGER_RUNTIME_FIXTURE_NAME || 'autotag.webp';
const EXPECTED_TAGS = (process.env.AUTOTAGGER_RUNTIME_EXPECTED_TAGS || 'travel,mountains,landscape')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

async function openSettings(page, tab = 'cache') {
    await page.goto('/');
    await page.evaluate((tabName) => {
        window.settingsManager?.open(tabName);
    }, tab);
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(page.locator(`.settings-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
    await expect(page.locator(`#settings-${tab}`)).toHaveClass(/active/);
}

async function waitForFixtureItem(page) {
    const item = page.locator(`#gallery .gallery-item[data-name="${FIXTURE_NAME}"]`).first();
    await expect(item).toBeVisible({ timeout: 30000 });
    return item;
}

async function waitForAutoTaggedFile(page) {
    const expectedTags = [...EXPECTED_TAGS].sort();

    await expect
        .poll(
            async () => {
                const response = await page.request.get(
                    `/api/tags/file?path=${encodeURIComponent(FIXTURE_NAME)}`
                );
                if (!response.ok()) {
                    return [];
                }

                const tags = await response.json();
                return [...tags].sort();
            },
            { timeout: 60000 }
        )
        .toEqual(expectedTags);
}

async function openTagModalForItem(page, item) {
    await item.evaluate((element) => {
        if (typeof window.ItemSelection === 'undefined') {
            throw new Error('ItemSelection is not available');
        }

        window.ItemSelection.enterSelectionMode(element);
    });

    await expect
        .poll(async () => page.evaluate(() => window.ItemSelection?.selectedPaths?.size ?? 0))
        .toBe(1);

    await page.evaluate(() => {
        window.ItemSelection?.openBulkTagModal?.();
    });
    await expect(page.locator('#tag-modal')).toBeVisible();
}

test.describe('Autotagger Runtime Smoke @autotagger @docker-runtime', () => {
    test('should extract metadata tags from the Docker runtime image and surface them in the UI', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);
        await waitForFixtureItem(page);

        await openSettings(page, 'cache');
        await page.locator('#run-autotagger-btn').click();
        await expect(page.locator('#cache-success')).toBeVisible({ timeout: 10000 });

        await waitForAutoTaggedFile(page);

        await page.goto('/');
        const refreshedItem = await waitForFixtureItem(page);
        await openTagModalForItem(page, refreshedItem);

        for (const tag of EXPECTED_TAGS) {
            await expect(page.locator('#current-tags')).toContainText(tag);
        }
    });
});
