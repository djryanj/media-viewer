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
const SEARCH_SEL = {
    input: '#search-input',
    results: '#search-results',
    resultsInput: '#search-results-input',
    resultsGallery: '#search-results-gallery',
};
const FIXTURE_BASENAME = FIXTURE_NAME.split('/').filter(Boolean).pop() || FIXTURE_NAME;

async function openSettings(page, tab = 'cache') {
    await page.goto('/');
    await expect(page.locator('#settings-btn')).toBeVisible();
    await page.evaluate((tabName) => {
        window.settingsManager?.open(tabName);
    }, tab);
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(page.locator(`.settings-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
    await expect(page.locator(`#settings-${tab}`)).toHaveClass(/active/);
}

async function triggerReindex(page) {
    await openSettings(page, 'cache');
    await page.evaluate(async () => {
        await window.settingsManager?.reindexMedia?.();
    });
    await expect(page.locator('#cache-success')).toBeVisible({ timeout: 10000 });
}

async function waitForFixtureIndexed(page, timeout = 120000) {
    await expect
        .poll(
            async () => {
                const response = await page.request.get(
                    '/api/media?path=&sort=name&order=asc&limit=0'
                );
                if (!response.ok()) {
                    return false;
                }

                const payload = await response.json();
                const items = payload?.items ?? payload?.data?.items ?? [];
                return items.some((item) => {
                    const itemPath = item?.path || '';
                    const itemName = item?.name || '';
                    return (
                        itemPath === FIXTURE_NAME ||
                        itemName === FIXTURE_BASENAME ||
                        itemPath.endsWith(`/${FIXTURE_NAME}`) ||
                        itemPath.endsWith(`/${FIXTURE_BASENAME}`)
                    );
                });
            },
            { timeout }
        )
        .toBe(true);
}

async function waitForAutoTaggedFile(page, timeout = 180000) {
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
            { timeout }
        )
        .toEqual(expectedTags);
}

async function performSearch(page, query) {
    const responsePromise = page.waitForResponse((response) => {
        if (!response.url().includes('/api/search?')) {
            return false;
        }

        const url = new URL(response.url());
        return url.searchParams.get('q') === query;
    });

    await page.locator(SEARCH_SEL.input).fill(query);
    await page.keyboard.press('Enter');
    await responsePromise;

    await expect(page.locator(SEARCH_SEL.results)).toBeVisible();
    await expect(page.locator(SEARCH_SEL.resultsInput)).toHaveValue(query);
}

async function waitForSearchHit(page, query, expectedPath, timeout = 120000) {
    await expect
        .poll(
            async () => {
                const response = await page.request.get(
                    `/api/search?q=${encodeURIComponent(query)}&page=1&pageSize=50`
                );
                if (!response.ok()) {
                    return false;
                }

                const payload = await response.json();
                const items = payload?.items ?? payload?.data?.items ?? [];
                return items.some((item) => item.path === expectedPath);
            },
            { timeout }
        )
        .toBe(true);
}

test.describe('Autotagger Runtime Smoke @autotagger @docker-runtime', () => {
    test('should extract metadata tags from the Docker runtime image and surface them in the UI', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        test.setTimeout(240000);
        test.skip(
            testInfo.project.name !== 'chromium',
            'Docker runtime smoke is covered in chromium only.'
        );

        await loginHelpers.login(page);
        await triggerReindex(page);
        await waitForFixtureIndexed(page);

        await openSettings(page, 'cache');
        await page.evaluate(async () => {
            await window.settingsManager?.runAutoTagger?.();
        });
        await expect(page.locator('#cache-success')).toBeVisible({ timeout: 10000 });

        await waitForAutoTaggedFile(page);
        await waitForSearchHit(page, `tag:${EXPECTED_TAGS[0]}`, FIXTURE_NAME);

        await page.goto('/');
        await performSearch(page, `tag:${EXPECTED_TAGS[0]}`);
        await expect(
            page.locator(
                `${SEARCH_SEL.resultsGallery} .gallery-item[data-path=${JSON.stringify(FIXTURE_NAME)}]`
            )
        ).toBeVisible({ timeout: 30000 });
    });
});
