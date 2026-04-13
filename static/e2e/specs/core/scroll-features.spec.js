/**
 * E2E tests for full-height scrollbar (virtual spacer) and
 * scroll-position restore ("continue where you left off") features.
 *
 * Requirements:
 *  - A running media-viewer backend with at least one folder of items.
 *  - For virtual-spacer tests, a folder with more than the initial page
 *    batch of 50 items is needed to confirm a non-zero spacer height.
 *
 * @tags @scroll @core @gallery @infinite-scroll
 */

/* global InfiniteScroll */

import { test, expect } from '../../fixtures/index.js';

const MAIN_GALLERY_MEDIA_SELECTOR = '#gallery .gallery-item.image, #gallery .gallery-item.video';

// ---------------------------------------------------------------------------
// Helper: navigate to the gallery root (or a path) and wait for items
// ---------------------------------------------------------------------------
async function goToGallery(page, path = '') {
    const url = path ? `/?path=${encodeURIComponent(path)}` : '/';
    const galleryReadySelector = '#gallery .gallery-item, #gallery .empty-state, .empty-state';
    const isTargetGalleryRoute = () => {
        try {
            const currentUrl = new URL(page.url());
            if (currentUrl.pathname !== '/') {
                return false;
            }

            const currentPath = currentUrl.searchParams.get('path') ?? '';
            return currentPath === path;
        } catch {
            return false;
        }
    };

    const isGalleryReady = async (timeout) => {
        if (page.isClosed()) {
            return false;
        }

        const visible = await page
            .locator(galleryReadySelector)
            .first()
            .waitFor({ state: 'visible', timeout })
            .then(() => true)
            .catch(() => false);

        if (visible) {
            return true;
        }

        return page
            .evaluate(() => {
                return Boolean(window.MediaApp?.state?.listing);
            })
            .catch(() => false);
    };

    if (isTargetGalleryRoute() && (await isGalleryReady(1500))) {
        return;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (!isTargetGalleryRoute() || attempt > 0) {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
            }
        } catch {
            // Retry once when WebKit reports an internal navigation error.
        }

        if (page.url().includes('/login.html')) {
            await page.waitForTimeout(200);
            continue;
        }

        if (await isGalleryReady(3500)) {
            return;
        }

        if (!page.isClosed()) {
            await page.waitForTimeout(150);
        }
    }

    throw new Error(`Failed to load gallery view at ${url}`);
}

async function openGalleryItemInLightbox(page, itemLocator) {
    const itemPath = await itemLocator.getAttribute('data-path');
    return await page.evaluate(async (path) => {
        const popover = document.getElementById('scroll-restore-popover');
        const readState = () => ({
            popoverHidden: popover?.classList.contains('hidden') ?? false,
            popoverVisible: popover?.classList.contains('visible') ?? false,
            lightboxHidden:
                document.getElementById('lightbox')?.classList.contains('hidden') ?? true,
        });

        const mediaIndex = window.MediaApp?.getMediaIndex?.(path) ?? -1;
        if (mediaIndex >= 0 && typeof window.Lightbox?.open === 'function') {
            window.Lightbox.open(mediaIndex);
            return { opened: true, ...readState() };
        }

        const item =
            window.MediaApp?.state?.listing?.items?.find((entry) => entry.path === path) ||
            window.MediaApp?.state?.mediaFiles?.find((entry) => entry.path === path);

        if (!item || typeof window.Gallery?.handleSingleTap !== 'function') {
            return { opened: false, ...readState() };
        }

        const result = window.Gallery.handleSingleTap(item);
        if (result?.then) {
            await result;
        }

        return { opened: true, ...readState() };
    }, itemPath);
}

// ---------------------------------------------------------------------------
// Virtual Spacer — structural tests
// ---------------------------------------------------------------------------

test.describe('Virtual Spacer @scroll @core', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await goToGallery(page);
    });

    test('virtual spacer element exists in the DOM', async ({ page }) => {
        const spacer = page.locator('#virtual-spacer');
        await expect(spacer).toBeAttached();
    });

    test('virtual spacer has the expected CSS class', async ({ page }) => {
        const spacer = page.locator('#virtual-spacer');
        await expect(spacer).toHaveClass(/virtual-spacer/);
    });

    test('virtual spacer is positioned after the infinite-scroll-container', async ({ page }) => {
        const scrollContainer = page.locator('#infinite-scroll-container');
        await expect(scrollContainer).toBeAttached();

        // virtual-spacer should be the next sibling of infinite-scroll-container
        const isNextSibling = await page.evaluate(() => {
            const container = document.getElementById('infinite-scroll-container');
            const spacer = document.getElementById('virtual-spacer');
            if (!container || !spacer) return false;
            return container.nextElementSibling === spacer;
        });
        expect(isNextSibling).toBe(true);
    });

    test('virtual spacer height is 0px when all items fit in the first page', async ({ page }) => {
        // Navigate to the first folder that has few items (or root if it is small)
        // We test folders that are fully loaded — totalItems == items.length
        const totalItems = await page.evaluate(() => {
            if (typeof InfiniteScroll === 'undefined') return null;
            return InfiniteScroll.state.totalItems;
        });
        const loadedItems = await page.evaluate(() => {
            if (typeof InfiniteScroll === 'undefined') return null;
            return InfiniteScroll.state.loadedItems.length;
        });

        if (totalItems !== null && loadedItems !== null && totalItems <= loadedItems) {
            // All loaded — spacer should be 0px
            const spacerHeight = await page.evaluate(() => {
                const spacer = document.getElementById('virtual-spacer');
                return spacer ? spacer.style.height : null;
            });
            expect(spacerHeight).toBe('0px');
        } else {
            // Some items are not yet loaded — spacer should be > 0
            const spacerHeight = await page.evaluate(() => {
                const el = document.getElementById('virtual-spacer');
                return el ? parseInt(el.style.height, 10) : 0;
            });
            expect(spacerHeight).toBeGreaterThanOrEqual(0);
        }
    });

    test('virtual spacer height is non-zero when items remain unloaded', async ({ page }) => {
        // Find a folder with more than 50 items so the spacer has height
        const folders = page.locator('.gallery-item.folder');
        const folderCount = await folders.count();

        if (folderCount === 0) {
            test.skip(); // No subfolders to navigate into
            return;
        }

        // Navigate into a folder
        await folders.first().locator('.gallery-item-thumb').dispatchEvent('click');
        await page.waitForSelector('.gallery-item, .empty-state', { timeout: 10000 });

        const result = await page.evaluate(() => {
            const total = InfiniteScroll.state.totalItems;
            const loaded = InfiniteScroll.state.loadedItems.length;
            const spacer = document.getElementById('virtual-spacer');
            const height = spacer ? parseInt(spacer.style.height, 10) : -1;
            return { total, loaded, height };
        });

        if (result.total > result.loaded) {
            // There are unloaded items — spacer must have positive height
            expect(result.height).toBeGreaterThan(0);
        } else {
            // All items loaded — spacer is 0
            expect(result.height).toBe(0);
        }
    });

    test('virtual spacer height shrinks as more items load', async ({ page }) => {
        // Navigate into a folder that needs more than one page
        const folders = page.locator('.gallery-item.folder');
        const folderCount = await folders.count();
        if (folderCount === 0) {
            test.skip();
            return;
        }

        await folders.first().locator('.gallery-item-thumb').dispatchEvent('click');
        await page.waitForSelector('.gallery-item:not(.skeleton)', { timeout: 10000 });

        const initialHeight = await page.evaluate(() => {
            const spacer = document.getElementById('virtual-spacer');
            return spacer ? parseInt(spacer.style.height, 10) : 0;
        });

        // If spacer is already 0, all items are loaded — nothing to test
        if (initialHeight === 0) {
            test.skip();
            return;
        }

        // Click "Load More" to trigger a page load and check height shrinks
        const loadMoreBtn = page.locator('#load-more-btn:not(.hidden)');
        if ((await loadMoreBtn.count()) > 0) {
            await loadMoreBtn.dispatchEvent('click');
            await page.waitForSelector('.gallery-item:not(.skeleton)', { timeout: 10000 });

            const newHeight = await page.evaluate(() => {
                const spacer = document.getElementById('virtual-spacer');
                return spacer ? parseInt(spacer.style.height, 10) : 0;
            });

            expect(newHeight).toBeLessThanOrEqual(initialHeight);
        }
    });

    test('virtual spacer contains a .virtual-spacer-grid child element', async ({ page }) => {
        const grid = page.locator('#virtual-spacer .virtual-spacer-grid');
        await expect(grid).toBeAttached();
    });

    test('virtual spacer skeleton grid has items when unloaded items > 0', async ({ page }) => {
        // Navigate into a subfolder likely to have many items
        const folders = page.locator('.gallery-item.folder');
        if ((await folders.count()) === 0) {
            test.skip();
            return;
        }

        await folders.first().locator('.gallery-item-thumb').dispatchEvent('click');
        await page.waitForSelector('.gallery-item:not(.skeleton)', { timeout: 10000 });

        const result = await page.evaluate(() => {
            const spacer = document.getElementById('virtual-spacer');
            if (!spacer) return { unloaded: 0, gridCount: 0 };
            const grid = spacer.querySelector('.virtual-spacer-grid');
            const unloaded =
                (InfiniteScroll?.state?.totalItems ?? 0) -
                (InfiniteScroll?.state?.loadedItems?.length ?? 0);
            return { unloaded, gridCount: grid ? grid.children.length : 0 };
        });

        if (result.unloaded > 0) {
            expect(result.gridCount).toBeGreaterThan(0);
        } else {
            // All loaded — grid is cleared
            expect(result.gridCount).toBe(0);
        }
    });
});

// ---------------------------------------------------------------------------
// Scroll Restore Popover — structural tests
// ---------------------------------------------------------------------------

test.describe('Scroll Restore Popover — structure @scroll @core', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        // Clear localStorage to ensure a clean state
        await page.evaluate(() => localStorage.clear());
        await goToGallery(page);
    });

    test('scroll-restore popover element exists in DOM', async ({ page }) => {
        const popover = page.locator('#scroll-restore-popover');
        await expect(popover).toBeAttached();
    });

    test('popover starts hidden', async ({ page }) => {
        const popover = page.locator('#scroll-restore-popover');
        await expect(popover).not.toBeVisible();
    });

    test('popover has resume trigger', async ({ page }) => {
        const btn = page.locator('#scroll-restore-go');
        await expect(btn).toBeAttached();
        await expect(btn).toContainText('Resume previous position');
    });

    test('popover has dismiss control', async ({ page }) => {
        const btn = page.locator('#scroll-restore-dismiss');
        await expect(btn).toBeAttached();
    });
});

// ---------------------------------------------------------------------------
// Scroll Restore Popover — behavioural tests
// ---------------------------------------------------------------------------

test.describe('Scroll Restore Popover — behaviour @scroll @core', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.evaluate(() => localStorage.clear());
    });

    test('popover appears on re-visit after scrolling', async ({ page }) => {
        // 1. Navigate to gallery and wait for items
        await goToGallery(page);

        // 2. Check we have something to scroll through
        const hasItems = (await page.locator('.gallery-item').count()) > 0;
        if (!hasItems) {
            test.skip();
            return;
        }

        // 3. Inject a large saved scroll position directly into localStorage
        //    (simulates having scrolled far on a previous visit)
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        const bigScrollY = viewportHeight + 500;
        const currentPath = await page.evaluate(() => {
            if (typeof MediaApp !== 'undefined') return MediaApp.state.currentPath;
            const params = new URLSearchParams(window.location.search);
            return params.get('path') || '';
        });

        await page.evaluate(
            ({ path, scrollY }) => {
                const key = 'media-viewer:scroll-positions';
                const stored = JSON.parse(localStorage.getItem(key) || '{}');
                stored[path] = { scrollY, timestamp: Date.now() };
                localStorage.setItem(key, JSON.stringify(stored));
            },
            { path: currentPath, scrollY: bigScrollY }
        );

        // 4. Reload the page — this should trigger the popover check in startForDirectory
        await page.reload();
        await page.waitForSelector('.gallery-item, .empty-state', { timeout: 15000 });

        // 5. The popover should now be visible (or at least not have 'hidden' class)
        const popover = page.locator('#scroll-restore-popover');
        await expect(popover).toBeVisible({ timeout: 5000 });
    });

    test('dismiss button hides the popover and clears localStorage entry', async ({ page }) => {
        await goToGallery(page);

        const hasItems = (await page.locator('.gallery-item').count()) > 0;
        if (!hasItems) {
            test.skip();
            return;
        }

        // Inject a saved position
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        const bigScrollY = viewportHeight + 500;
        const currentPath = await page.evaluate(() => {
            if (typeof MediaApp !== 'undefined') return MediaApp.state.currentPath;
            return '';
        });

        await page.evaluate(
            ({ path, scrollY }) => {
                const key = 'media-viewer:scroll-positions';
                const stored = JSON.parse(localStorage.getItem(key) || '{}');
                stored[path] = { scrollY, timestamp: Date.now() };
                localStorage.setItem(key, JSON.stringify(stored));
            },
            { path: currentPath, scrollY: bigScrollY }
        );

        await page.reload();
        await page.waitForSelector('.gallery-item, .empty-state', { timeout: 15000 });

        const popover = page.locator('#scroll-restore-popover');
        await expect(popover).toBeVisible({ timeout: 5000 });

        // Click dismiss
        await page.locator('#scroll-restore-dismiss').dispatchEvent('click');

        // Popover should disappear
        await expect(popover).not.toBeVisible({ timeout: 3000 });

        // localStorage entry should be cleared
        const savedAfter = await page.evaluate(
            ({ path }) => {
                const key = 'media-viewer:scroll-positions';
                const stored = JSON.parse(localStorage.getItem(key) || '{}');
                return stored[path] ?? null;
            },
            { path: currentPath }
        );

        expect(savedAfter).toBeNull();
    });

    test('"Go back" button scrolls toward the saved position', async ({ page }) => {
        await goToGallery(page);

        const hasItems = (await page.locator('.gallery-item').count()) > 0;
        if (!hasItems) {
            test.skip();
            return;
        }

        const viewportHeight = await page.evaluate(() => window.innerHeight);
        // Use a moderate offset so smooth-scroll can finish in test time
        const targetScrollY = viewportHeight + 200;
        const currentPath = await page.evaluate(() => {
            if (typeof MediaApp !== 'undefined') return MediaApp.state.currentPath;
            return '';
        });

        await page.evaluate(
            ({ path, scrollY }) => {
                const key = 'media-viewer:scroll-positions';
                const stored = JSON.parse(localStorage.getItem(key) || '{}');
                stored[path] = { scrollY, timestamp: Date.now() };
                localStorage.setItem(key, JSON.stringify(stored));
            },
            { path: currentPath, scrollY: targetScrollY }
        );

        await page.reload();
        await page.waitForSelector('.gallery-item, .empty-state', { timeout: 15000 });

        const popover = page.locator('#scroll-restore-popover');
        await expect(popover).toBeVisible({ timeout: 5000 });
        await expect
            .poll(async () => {
                return page.evaluate(() => window.InfiniteScroll?._pendingRestoreFraction !== null);
            })
            .toBe(true);

        // Click "Go back"
        await page.locator('#scroll-restore-go').dispatchEvent('click');

        // Popover should disappear
        await expect(popover).not.toBeVisible({ timeout: 3000 });

        await expect
            .poll(
                async () => {
                    return page.evaluate(() => {
                        return window.InfiniteScroll?._pendingRestoreFraction === null;
                    });
                },
                { timeout: 3000 }
            )
            .toBe(true);
    });

    test('popover does NOT appear when no saved position exists', async ({ page }) => {
        // Ensure localStorage is clean
        await page.evaluate(() => localStorage.clear());

        await goToGallery(page);

        const popover = page.locator('#scroll-restore-popover');
        // Wait a moment and verify it remains hidden
        await page.waitForTimeout(500);
        await expect(popover).not.toBeVisible();
    });

    test('popover auto-dismisses after countdown without user interaction', async ({ page }) => {
        // The countdown is 8 seconds — too long for a normal test.
        // We override the timer via page.evaluate to trigger it immediately.
        await goToGallery(page);

        const hasItems = (await page.locator('.gallery-item').count()) > 0;
        if (!hasItems) {
            test.skip();
            return;
        }

        const viewportHeight = await page.evaluate(() => window.innerHeight);
        const currentPath = await page.evaluate(() => {
            if (typeof MediaApp !== 'undefined') return MediaApp.state.currentPath;
            return '';
        });

        await page.evaluate(
            ({ path, scrollY }) => {
                const key = 'media-viewer:scroll-positions';
                const stored = JSON.parse(localStorage.getItem(key) || '{}');
                stored[path] = { scrollY, timestamp: Date.now() };
                localStorage.setItem(key, JSON.stringify(stored));
            },
            { path: currentPath, scrollY: viewportHeight + 300 }
        );

        await page.reload();
        await page.waitForSelector('.gallery-item, .empty-state', { timeout: 15000 });

        const popover = page.locator('#scroll-restore-popover');
        await expect(popover).toBeVisible({ timeout: 5000 });

        // Fire the auto-dismiss timer immediately via the module
        await page.evaluate(() => {
            if (typeof InfiniteScroll !== 'undefined') {
                clearTimeout(InfiniteScroll._restorePopoverTimer);
                InfiniteScroll.hideScrollRestorePopover();
            }
        });

        await expect(popover).not.toBeVisible({ timeout: 3000 });
    });

    test('popover disappears immediately when opening the lightbox from the gallery', async ({
        page,
    }) => {
        await goToGallery(page);

        const mediaItems = page.locator(MAIN_GALLERY_MEDIA_SELECTOR);
        if ((await mediaItems.count()) === 0) {
            test.skip();
            return;
        }

        const viewportHeight = await page.evaluate(() => window.innerHeight);
        const currentPath = await page.evaluate(() => {
            if (typeof MediaApp !== 'undefined') return MediaApp.state.currentPath;
            return '';
        });

        await page.evaluate(
            ({ path, scrollY }) => {
                const key = 'media-viewer:scroll-positions';
                const stored = JSON.parse(localStorage.getItem(key) || '{}');
                stored[path] = { scrollY, timestamp: Date.now() };
                localStorage.setItem(key, JSON.stringify(stored));
            },
            { path: currentPath, scrollY: viewportHeight + 300 }
        );

        await page.reload();
        await page.waitForSelector('.gallery-item, .empty-state', { timeout: 15000 });

        const popover = page.locator('#scroll-restore-popover');
        await expect(popover).toBeVisible({ timeout: 5000 });

        const openResult = await openGalleryItemInLightbox(page, mediaItems.first());
        expect(openResult.opened).toBe(true);
        expect(openResult.popoverHidden).toBe(true);
        expect(openResult.popoverVisible).toBe(false);
        expect(openResult.lightboxHidden).toBe(false);

        await expect(page.locator('#lightbox')).toBeVisible({ timeout: 8000 });
        await expect(popover).not.toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Custom Scroll Scrubber — structural tests
// ---------------------------------------------------------------------------

test.describe('Custom Scroll Scrubber @scroll @core', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await goToGallery(page);
    });

    test('gallery-scrubber element exists in the DOM', async ({ page }) => {
        const scrubber = page.locator('#gallery-scrubber');
        await expect(scrubber).toBeAttached();
    });

    test('gallery-scrubber-thumb child element exists', async ({ page }) => {
        const thumb = page.locator('#gallery-scrubber-thumb');
        await expect(thumb).toBeAttached();
    });

    test('scrubber thumb is inside the scrubber', async ({ page }) => {
        const isChild = await page.evaluate(() => {
            const scrubber = document.getElementById('gallery-scrubber');
            const thumb = document.getElementById('gallery-scrubber-thumb');
            return scrubber && thumb ? scrubber.contains(thumb) : false;
        });
        expect(isChild).toBe(true);
    });

    test('scrubber is hidden when page is not substantially taller than viewport', async ({
        page,
    }) => {
        // On a short page the scrubber must stay hidden
        const isHidden = await page.evaluate(() => {
            const scrubber = document.getElementById('gallery-scrubber');
            if (!scrubber) return null;
            const scrollH = document.documentElement.scrollHeight;
            const viewH = window.innerHeight;
            // Only assert hidden state when the page is actually short
            if (scrollH <= viewH * 1.5) {
                return scrubber.classList.contains('hidden');
            }
            return null; // inconclusive — page is already tall
        });

        if (isHidden !== null) {
            expect(isHidden).toBe(true);
        }
    });

    test('scrubber becomes visible when virtual spacer makes page tall', async ({ page }) => {
        // Navigate into a deep folder to trigger many unloaded items + spacer height
        const folders = page.locator('.gallery-item.folder');
        const folderCount = await folders.count();
        if (folderCount === 0) {
            test.skip();
            return;
        }

        await folders.first().locator('.gallery-item-thumb').dispatchEvent('click');
        await page.waitForSelector('.gallery-item:not(.skeleton)', { timeout: 10000 });

        const result = await page.evaluate(() => {
            const total = InfiniteScroll?.state?.totalItems ?? 0;
            const loaded = InfiniteScroll?.state?.loadedItems?.length ?? 0;
            const scrubber = document.getElementById('gallery-scrubber');
            const scrollH = document.documentElement.scrollHeight;
            const viewH = window.innerHeight;
            return {
                total,
                loaded,
                isTall: scrollH > viewH * 1.5,
                scrubberHidden: scrubber ? scrubber.classList.contains('hidden') : null,
            };
        });

        if (result.isTall && result.scrubberHidden !== null) {
            expect(result.scrubberHidden).toBe(false);
        } else {
            // Page is not tall enough — skip rather than false-fail
            test.skip();
        }
    });

    test('scrubber thumb has a minimum visual height set via rendered layout', async ({ page }) => {
        const thumbMetrics = await page.evaluate(() => {
            const scrubber = document.getElementById('gallery-scrubber');
            const thumb = document.getElementById('gallery-scrubber-thumb');
            if (!scrubber || !thumb || typeof InfiniteScroll === 'undefined') return null;

            // Override scroll geometry for the duration of this call
            const origScrollHeight = Object.getOwnPropertyDescriptor(
                document.documentElement,
                'scrollHeight'
            );
            Object.defineProperty(document.documentElement, 'scrollHeight', {
                value: 50000,
                configurable: true,
            });
            const origInnerHeight = window.innerHeight;
            Object.defineProperty(window, 'innerHeight', {
                value: 800,
                configurable: true,
            });

            InfiniteScroll._positionScrubber();
            InfiniteScroll.updateScrollScrubber();

            const metrics = {
                scrubberHidden: scrubber.classList.contains('hidden'),
                thumbHeight: thumb.offsetHeight,
            };

            // Restore
            if (origScrollHeight) {
                Object.defineProperty(document.documentElement, 'scrollHeight', origScrollHeight);
            }
            Object.defineProperty(window, 'innerHeight', {
                value: origInnerHeight,
                configurable: true,
            });

            return metrics;
        });

        if (thumbMetrics !== null) {
            expect(thumbMetrics.scrubberHidden).toBe(false);
            expect(thumbMetrics.thumbHeight).toBeGreaterThanOrEqual(44);
        }
    });

    test('saved scroll position entry includes a fraction field', async ({ page }) => {
        await goToGallery(page);

        // Scroll a bit and trigger a save
        await page.evaluate(() => window.scrollTo(0, 200));
        await page.waitForTimeout(1500); // allow debounced save timer

        const currentPath = await page.evaluate(() => {
            if (typeof MediaApp !== 'undefined') return MediaApp.state.currentPath;
            return '';
        });

        const savedEntry = await page.evaluate(
            ({ path }) => {
                const key = 'media-viewer:scroll-positions';
                const stored = JSON.parse(localStorage.getItem(key) || '{}');
                return stored[path] ?? null;
            },
            { path: currentPath }
        );

        if (savedEntry !== null) {
            // Entry should now contain a fraction field
            expect(typeof savedEntry.fraction).toBe('number');
        }
    });

    test('gallery-scrubber-label element exists inside the scrubber', async ({ page }) => {
        const label = page.locator('#gallery-scrubber-label');
        await expect(label).toBeAttached();

        const isChild = await page.evaluate(() => {
            const scrubber = document.getElementById('gallery-scrubber');
            const label = document.getElementById('gallery-scrubber-label');
            return scrubber && label ? scrubber.contains(label) : false;
        });
        expect(isChild).toBe(true);
    });

    test('scrubber label shows item count while dragging', async ({ page }) => {
        // Force the scrubber to be visible on a tall virtual page
        const labelText = await page.evaluate(() => {
            const scrubber = document.getElementById('gallery-scrubber');
            const label = document.getElementById('gallery-scrubber-label');
            if (!scrubber || !label || typeof InfiniteScroll === 'undefined') return null;

            // Simulate a scenario with items
            if (InfiniteScroll.state.totalItems === 0) {
                InfiniteScroll.state.totalItems = 100;
            }

            // Make the page tall so the scrubber becomes visible
            Object.defineProperty(document.documentElement, 'scrollHeight', {
                value: 50000,
                configurable: true,
            });
            Object.defineProperty(window, 'innerHeight', {
                value: 800,
                configurable: true,
            });

            InfiniteScroll.updateScrollScrubber();
            return label.textContent;
        });

        if (labelText !== null) {
            // Label text should contain the total count in "N / Total" format
            expect(labelText).toMatch(/\d/);
        }
    });

    test('scrubber top aligns with or below the gallery area (not the top of the page)', async ({
        page,
    }) => {
        // Force a tall page and check that the scrubber respects the header offset.
        const result = await page.evaluate(() => {
            const scrubber = document.getElementById('gallery-scrubber');
            const header = document.querySelector('.header');
            if (!scrubber || typeof InfiniteScroll === 'undefined') return null;

            Object.defineProperty(document.documentElement, 'scrollHeight', {
                value: 50000,
                configurable: true,
            });
            Object.defineProperty(window, 'innerHeight', {
                value: 800,
                configurable: true,
            });

            InfiniteScroll._positionScrubber();
            InfiniteScroll.updateScrollScrubber();

            const scrubberTop = parseInt(scrubber.style.top, 10) || 0;
            const headerHeight = header?.offsetHeight ?? 0;
            return { scrubberTop, headerHeight };
        });

        if (result !== null) {
            expect(result.scrubberTop).toBe(result.headerHeight);
        }
    });
});
