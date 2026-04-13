import path from 'node:path';

import { devices } from '@playwright/test';

import { test, expect } from '../../fixtures/index.js';
import {
    assertMatchesReferenceImage,
    captureVisualSnapshot,
    writeVisualSnapshot,
} from '../../fixtures/visual-regression.js';

const VISUAL_BASELINE_DIR = path.resolve(process.cwd(), 'e2e', 'baselines', 'gallery');
const MAIN_GALLERY_IMAGE_SELECTOR = '#gallery .gallery-item.image';
const SCROLL_RESTORE_REFERENCE_SELECTOR = '#visual-scroll-restore-reference';
const { defaultBrowserType: _unusedDefaultBrowserType, ...PIXEL_5_CONTEXT } = devices['Pixel 5'];

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

async function waitForReferenceItem(page, index = 0) {
    const item = page.locator(MAIN_GALLERY_IMAGE_SELECTOR).nth(index);
    await expect(item).toBeVisible();
    await item.evaluate((element) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });

        const image = element.querySelector('.gallery-item-thumb img');
        if (!(image instanceof HTMLImageElement)) {
            return;
        }

        const deferredSrc = image.dataset.src;
        if (deferredSrc && image.getAttribute('src') !== deferredSrc) {
            image.src = deferredSrc;
            delete image.dataset.src;
        }
    });
    await expect
        .poll(async () => {
            return item.evaluate((element) => {
                const image = element.querySelector('.gallery-item-thumb img');
                const fallbackIcon = element.querySelector('.gallery-item-icon');
                if (!(image instanceof HTMLImageElement)) {
                    return fallbackIcon instanceof HTMLElement;
                }

                return image.classList.contains('loaded');
            });
        })
        .toBe(true);

    return item;
}

async function movePointerToItemThumb(page, item) {
    const thumb = item.locator('.gallery-item-thumb');
    await expect(thumb).toBeVisible();

    const box = await thumb.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(1, 1);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
}

async function enterSelectionModeForReference(page, item) {
    await item.evaluate((element) => {
        window.ItemSelection?.enterSelectionMode?.(element);
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
            const selectionState = await page.evaluate(() => {
                const toolbar = document.getElementById('selection-toolbar');
                return {
                    active: window.ItemSelection?.isActive ?? false,
                    selectedCount: window.ItemSelection?.selectedPaths?.size ?? 0,
                    toolbarHidden: toolbar?.classList.contains('hidden') ?? true,
                };
            });

            const itemState = await item.evaluate((element) => {
                const checkbox = element.querySelector('.selection-checkbox');
                return {
                    selected: element.classList.contains('selected'),
                    checkboxOpacity:
                        checkbox instanceof HTMLElement
                            ? window.getComputedStyle(checkbox).opacity
                            : '0',
                };
            });

            return {
                ...selectionState,
                ...itemState,
            };
        })
        .toEqual({
            active: true,
            selectedCount: 1,
            toolbarHidden: false,
            selected: true,
            checkboxOpacity: '1',
        });
}

async function normalizeReferenceItem(item) {
    await item.evaluate((element) => {
        element.classList.remove('selected', 'is-favorite', 'in-collection');
        element.style.zIndex = '';

        const collectionButton = element.querySelector('.collection-button');
        if (collectionButton instanceof HTMLElement) {
            collectionButton.classList.remove('has-collections');
            collectionButton.title = 'Add to collection';
            collectionButton.setAttribute('aria-label', 'Add to collection');
        }
    });
}

async function clearScrollRestoreReference(page) {
    await page.evaluate(() => {
        document.getElementById('visual-scroll-restore-reference')?.remove();
        window.InfiniteScroll?.dismissScrollRestorePopoverImmediately?.();
        window.localStorage.removeItem('media-viewer:scroll-positions');
    });
}

async function prepareScrollRestoreReference(page, fraction = 0.58) {
    await clearScrollRestoreReference(page);

    const prepared = await page.evaluate((restoreFraction) => {
        const scroll = window.InfiniteScroll;
        const popover = document.getElementById('scroll-restore-popover');
        const scrubber = document.getElementById('gallery-scrubber');
        const spacer = document.getElementById('virtual-spacer');

        if (
            !scroll ||
            !(popover instanceof HTMLElement) ||
            !(scrubber instanceof HTMLElement) ||
            !(spacer instanceof HTMLElement)
        ) {
            return false;
        }

        const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollableHeight <= window.innerHeight * 0.5) {
            spacer.style.height = `${Math.max(window.innerHeight, 960)}px`;
        }

        scroll.updateScrollScrubber();
        scrubber.classList.remove('hidden');
        document.documentElement.classList.add('custom-scrubber-active');
        scroll.showScrollRestorePopover(restoreFraction);
        clearTimeout(scroll._restorePopoverTimer);
        clearTimeout(scroll._restorePopoverHideTimer);
        scroll._restorePopoverTimer = null;
        scroll._restorePopoverHideTimer = null;

        popover.classList.add('visible');

        const marker = scrubber.querySelector('.scroll-restore-marker');
        if (!marker) {
            return false;
        }

        const popoverRect = popover.getBoundingClientRect();
        const scrubberRect = scrubber.getBoundingClientRect();
        const bounds = {
            left: Math.floor(Math.min(popoverRect.left, scrubberRect.left) - 16),
            top: Math.floor(Math.min(popoverRect.top, scrubberRect.top) - 16),
            right: Math.ceil(Math.max(popoverRect.right, scrubberRect.right) + 16),
            bottom: Math.ceil(Math.max(popoverRect.bottom, scrubberRect.bottom) + 16),
        };

        document.getElementById('visual-scroll-restore-reference')?.remove();

        const reference = document.createElement('div');
        reference.id = 'visual-scroll-restore-reference';
        reference.setAttribute('aria-hidden', 'true');
        reference.style.position = 'fixed';
        reference.style.left = '24px';
        reference.style.top = '24px';
        reference.style.width = `${Math.max(1, bounds.right - bounds.left)}px`;
        reference.style.height = `${Math.max(1, bounds.bottom - bounds.top)}px`;
        reference.style.pointerEvents = 'none';
        reference.style.overflow = 'hidden';
        reference.style.zIndex = '9999';

        const scrubberClone = scrubber.cloneNode(true);
        if (scrubberClone instanceof HTMLElement) {
            scrubberClone.classList.remove('hidden', 'dragging');
            scrubberClone.style.position = 'absolute';
            scrubberClone.style.left = `${scrubberRect.left - bounds.left}px`;
            scrubberClone.style.top = `${scrubberRect.top - bounds.top}px`;
            scrubberClone.style.right = 'auto';
            scrubberClone.style.bottom = 'auto';
            scrubberClone.style.height = `${Math.round(scrubberRect.height)}px`;
            scrubberClone.style.transition = 'none';
        }

        const popoverClone = popover.cloneNode(true);
        if (popoverClone instanceof HTMLElement) {
            popoverClone.classList.remove('hidden');
            popoverClone.classList.add('visible', 'scrubber-anchored');
            popoverClone.style.position = 'absolute';
            popoverClone.style.left = `${popoverRect.left - bounds.left}px`;
            popoverClone.style.top = `${popoverRect.top - bounds.top}px`;
            popoverClone.style.right = 'auto';
            popoverClone.style.bottom = 'auto';
            popoverClone.style.opacity = '1';
            popoverClone.style.transform = 'none';
            popoverClone.style.transition = 'none';
            popoverClone.style.pointerEvents = 'none';
        }

        reference.append(scrubberClone, popoverClone);
        document.body.appendChild(reference);
        return true;
    }, fraction);

    expect(prepared).toBe(true);
    await page.waitForTimeout(50);
    await expect(page.locator(SCROLL_RESTORE_REFERENCE_SELECTOR)).toBeVisible();
}

async function assertMatchesReference(page, locator, referenceName, testInfo, options = {}) {
    const snapshotName = referenceName.replace(/\.png$/, '.json');
    const actualPath = testInfo.outputPath(snapshotName);
    const referencePath = path.join(VISUAL_BASELINE_DIR, snapshotName);
    const snapshot = await captureVisualSnapshot(page, locator, options.snapshotOptions);

    await writeVisualSnapshot(snapshot, actualPath);
    await assertMatchesReferenceImage(snapshot, referencePath, options.compareOptions);
}

test.describe('Gallery Visual Regression @visual @gallery', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page, loginHelpers }, testInfo) => {
        test.skip(
            testInfo.project.name !== 'chromium',
            'Visual regression snapshots run in chromium only'
        );

        await loginHelpers.login(page);
        await page.waitForSelector(MAIN_GALLERY_IMAGE_SELECTOR);
        await clearSelection(page);
    });

    test.afterEach(async ({ page }) => {
        await clearSelection(page);
        await clearScrollRestoreReference(page);
    });

    test.describe('Desktop Gallery Card', () => {
        test.use({ viewport: { width: 1440, height: 1100 } });

        test('matches default card reference', async ({ page }, testInfo) => {
            const item = await waitForReferenceItem(page, 0);
            await normalizeReferenceItem(item);

            await assertMatchesReference(page, item, 'gallery-desktop-card-default.png', testInfo, {
                snapshotOptions: { maxNodes: 40 },
            });
        });

        test('matches hover control reference', async ({ page }, testInfo) => {
            const item = await waitForReferenceItem(page, 0);
            await normalizeReferenceItem(item);
            await movePointerToItemThumb(page, item);

            await expect(item.locator('.collection-button')).toBeVisible();
            await expect(item.locator('.selection-checkbox')).toBeVisible();

            await assertMatchesReference(page, item, 'gallery-desktop-card-hover.png', testInfo, {
                snapshotOptions: { maxNodes: 48 },
            });
        });
    });

    test.describe('Mobile Gallery Card', () => {
        test.use(PIXEL_5_CONTEXT);

        test('matches default touch card reference', async ({ page }, testInfo) => {
            const item = await waitForReferenceItem(page, 0);
            await normalizeReferenceItem(item);

            await expect
                .poll(async () => {
                    return item.evaluate((element) => {
                        const collectionButton = element.querySelector('.collection-button');
                        const selectionCheckbox = element.querySelector('.selection-checkbox');
                        const collectionDisplay =
                            collectionButton instanceof HTMLElement
                                ? window.getComputedStyle(collectionButton).display
                                : 'none';
                        const checkboxOpacity =
                            selectionCheckbox instanceof HTMLElement
                                ? window.getComputedStyle(selectionCheckbox).opacity
                                : '0';

                        return { collectionDisplay, checkboxOpacity };
                    });
                })
                .toEqual({ collectionDisplay: 'none', checkboxOpacity: '0' });

            await assertMatchesReference(page, item, 'gallery-mobile-card-default.png', testInfo, {
                snapshotOptions: { maxNodes: 32 },
            });
        });

        test('matches selected touch card reference', async ({ page }, testInfo) => {
            const item = await waitForReferenceItem(page, 0);
            await normalizeReferenceItem(item);

            await enterSelectionModeForReference(page, item);

            await expect(page.locator('#selection-toolbar')).toBeVisible();
            await expect(item).toHaveClass(/selected/);
            await expect(item.locator('.selection-checkbox')).toBeVisible();

            await assertMatchesReference(page, item, 'gallery-mobile-card-selected.png', testInfo, {
                snapshotOptions: { maxNodes: 40 },
            });
        });

        test('matches selection toolbar reference', async ({ page }, testInfo) => {
            const item = await waitForReferenceItem(page, 0);
            await normalizeReferenceItem(item);

            await enterSelectionModeForReference(page, item);

            const toolbar = page.locator('#selection-toolbar');
            await expect(toolbar).toBeVisible();
            await expect(toolbar).toContainText('1 selected');
            await expect(page.locator('#selection-collection-btn')).toBeVisible();

            await assertMatchesReference(
                page,
                toolbar,
                'gallery-mobile-selection-toolbar.png',
                testInfo,
                {
                    snapshotOptions: { maxNodes: 80 },
                }
            );
        });
    });

    test.describe('Scroll Restore Prompt', () => {
        test('matches desktop anchored prompt reference', async ({ page }, testInfo) => {
            await prepareScrollRestoreReference(page, 0.58);

            await assertMatchesReference(
                page,
                page.locator(SCROLL_RESTORE_REFERENCE_SELECTOR),
                'gallery-scroll-restore-desktop.png',
                testInfo,
                { snapshotOptions: { maxNodes: 80 } }
            );
        });
    });

    test.describe('Mobile Scroll Restore Prompt', () => {
        test.use(PIXEL_5_CONTEXT);

        test('matches narrow anchored prompt reference', async ({ page }, testInfo) => {
            await prepareScrollRestoreReference(page, 0.58);

            await assertMatchesReference(
                page,
                page.locator(SCROLL_RESTORE_REFERENCE_SELECTOR),
                'gallery-scroll-restore-mobile.png',
                testInfo,
                { snapshotOptions: { maxNodes: 80 } }
            );
        });
    });
});
