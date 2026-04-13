import path from 'node:path';

import { devices } from '@playwright/test';

import { test, expect } from '../../fixtures/index.js';
import { captureDocsScreenshot } from './docs-media-utils.js';

const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');
const SCREENSHOTS = {
    mobileSelectionToolbar: path.join(DOCS_IMAGE_DIR, 'selection-mobile-toolbar.png'),
};
const MAIN_GALLERY_MEDIA_SELECTOR = '#gallery .gallery-item.image, #gallery .gallery-item.video';
const { defaultBrowserType: _unusedDefaultBrowserType, ...PIXEL_5_CONTEXT } = devices['Pixel 5'];

async function waitForGallery(page) {
    await page.waitForSelector(`${MAIN_GALLERY_MEDIA_SELECTOR}:not(.skeleton)`, { timeout: 15000 });
}

async function clearSelection(page) {
    const isActive = await page.evaluate(() => window.ItemSelection?.isActive ?? false);
    if (!isActive) {
        return;
    }

    await page.evaluate(() => {
        window.ItemSelection?.exitSelectionMode?.();
    });

    await expect
        .poll(async () => page.evaluate(() => window.ItemSelection?.isActive ?? false))
        .toBe(false);
}

async function enterSelectionModeForScreenshot(page, firstItem, secondItem) {
    await firstItem.evaluate((element) => {
        window.ItemSelection?.enterSelectionMode?.(element);
    });

    await secondItem.evaluate((element) => {
        window.ItemSelection?.toggleItem?.(element);
    });

    await page.evaluate(() => {
        const selection = window.ItemSelection;
        if (!selection?.isActive) {
            return;
        }

        selection.elements?.toolbar?.classList.remove('hidden');
        selection.elements?.gallery?.classList.add('selection-mode');
        selection.updateToolbar?.();
        selection.applySelectionStateToVisibleItems?.();

        if (!selection._cbStyleEl) {
            const styleEl = document.createElement('style');
            styleEl.id = 'selection-checkboxes-visible';
            styleEl.textContent = '.selection-checkbox { opacity: 1; pointer-events: auto }';
            document.head.appendChild(styleEl);
            selection._cbStyleEl = styleEl;
        } else {
            selection._cbStyleEl.disabled = false;
        }
    });

    await expect
        .poll(async () => {
            const toolbarState = await page.evaluate(() => {
                const toolbar = document.getElementById('selection-toolbar');
                return {
                    active: window.ItemSelection?.isActive ?? false,
                    selectedCount: window.ItemSelection?.selectedPaths?.size ?? 0,
                    toolbarHidden: toolbar?.classList.contains('hidden') ?? true,
                };
            });

            return toolbarState;
        })
        .toEqual({
            active: true,
            selectedCount: 2,
            toolbarHidden: false,
        });
}

test.describe('Selection Docs Screenshots @docs @screenshots @docs-screenshots @workflows', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(90_000);
    test.use(PIXEL_5_CONTEXT);

    test.beforeEach(async ({ page, loginHelpers }, testInfo) => {
        test.skip(
            testInfo.project.name !== 'chromium',
            'Documentation screenshots are captured in chromium only'
        );

        await loginHelpers.login(page);
        await waitForGallery(page);
        await clearSelection(page);
    });

    test.afterEach(async ({ page }) => {
        await clearSelection(page);
    });

    test('captures mobile selection toolbar screenshot', async ({ page }) => {
        const items = page.locator(MAIN_GALLERY_MEDIA_SELECTOR);

        await expect(items.nth(1)).toBeVisible();

        await enterSelectionModeForScreenshot(page, items.first(), items.nth(1));

        const toolbar = page.locator('#selection-toolbar');
        await expect(toolbar).toBeVisible();
        await expect(toolbar).toContainText('2 selected');
        await expect(page.locator('#selection-tag-btn')).toBeVisible();
        await expect(page.locator('#selection-collection-btn')).toBeVisible();

        await captureDocsScreenshot(page, toolbar, SCREENSHOTS.mobileSelectionToolbar);
    });
});
