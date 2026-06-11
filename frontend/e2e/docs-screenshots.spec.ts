/**
 * Documentation screenshot tests for the SvelteKit frontend.
 *
 * Each test captures a PNG directly to docs/images/ so the image is
 * immediately ready for the documentation site without any post-processing step.
 *
 * Run:   make frontend-test-e2e-docs-screenshots
 *        (or: cd frontend && npm run test:e2e:docs-screenshots)
 *
 * All tests are tagged @docs-screenshots.  They run in Chromium only and expect
 * a backend with sample media already indexed (use the standard test server).
 *
 * IMPORTANT: Screenshots written here replace the committed docs/images/ PNGs
 * that are shown in the MkDocs documentation site.  Always review the captured
 * output visually before committing.
 *
 * Tab name mapping from old vanilla-JS frontend → new SvelteKit frontend:
 *   security  → security   (unchanged)
 *   passkeys  → passkeys   (unchanged)
 *   cache     → system     (worker status, cache maintenance → Settings → System)
 *   display   → library    (sort order, clock, playback → Settings → Library)
 *   tags      → tags       (unchanged)
 *   about     → about      (unchanged)
 *   (new)     → system     (added in SvelteKit frontend)
 */

import path from 'path';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

// Resolved relative to the frontend/ working directory (where Playwright runs).
const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');

// ── Static API stubs ──────────────────────────────────────────────────────────

/** Returned by the stubbed /api/system/status route.
 *  Workers are all idle so no .worker-dot animation is rendered and the
 *  status-footer polling interval backs off to 15 s, giving a long quiet window.
 *  Library counts are realistic so the About tab shows meaningful stats. */
const IDLE_WORKER = {
    summary: { enabled: true, running: false, state: 'idle' },
    metrics: { processedItems: 0 }
};

const STATIC_STATUS = {
    updatedAt: '2026-01-15T10:30:05Z',
    indexer: IDLE_WORKER,
    thumbnails: IDLE_WORKER,
    autotagger: IDLE_WORKER,
    library: {
        totalFiles: 42,
        totalImages: 25,
        totalVideos: 12,
        totalFolders: 5,
        totalPlaylists: 0,
        totalTags: 8,
        totalFavorites: 3,
        thumbnailCacheFiles: 25,
        thumbnailCacheBytes: 10485760,
        transcodeCacheFiles: 0,
        transcodeCacheBytes: 0,
        lastIndexed: '2026-01-15T10:30:00Z'
    }
};

/** Returned by the stubbed /api/files route used by settings-tab tests.
 *  An empty gallery means zero <img> compositing layers — the root cause of
 *  page.screenshot() taking 30 + seconds under --disable-gpu software rendering. */
const EMPTY_FILES = {
    path: '',
    name: '',
    breadcrumb: [],
    items: [],
    favorites: [],
    totalItems: 0,
    page: 0,
    pageSize: 500,
    totalPages: 0
};

/**
 * Route background APIs so the page reaches networkidle quickly and all
 * settings-tab panels load cleanly.  Call at the start of every test that
 * needs a settings-modal screenshot.  Previous routes are cleared first
 * (serial tests share the same page).
 */
async function stubSettingsApis(page: Page): Promise<void> {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/api/system/status', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(STATIC_STATUS)
        })
    );
    // The gallery fetches /api/files (listing) and /api/files/summary (scrubber).
    await page.route('**/api/files**', (route) => {
        const url = route.request().url();
        if (url.includes('/api/files/summary')) {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ sort: 'name', order: 'asc', total: 0, groups: [] })
            });
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(EMPTY_FILES)
        });
    });
    // Passkeys tab: return a non-empty list wrapped in the {passkeys:[…]} envelope
    // that the backend returns and listPasskeys() unwraps.  id is an int64 (number).
    await page.route('**/api/auth/webauthn/passkeys', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                passkeys: [
                    {
                        id: 1,
                        name: 'Example Passkey',
                        createdAt: '2026-01-15T10:00:00Z',
                        lastUsedAt: '2026-01-15T10:30:00Z'
                    }
                ]
            })
        })
    );
    // Tags tab: same pattern — return non-empty list to prevent the $effect from
    // re-triggering loadTags() whenever allTags.length === 0 && !tagsLoading.
    await page.route('**/api/tags', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    id: 1,
                    name: 'landscape',
                    color: null,
                    itemCount: 3,
                    createdAt: '2026-01-01T00:00:00Z'
                },
                {
                    id: 2,
                    name: 'vacation',
                    color: null,
                    itemCount: 5,
                    createdAt: '2026-01-01T00:00:00Z'
                }
            ])
        })
    );
}

/**
 * Route only the status API (keep real media data for tests that need content).
 */
async function stubStatusApi(page: Page): Promise<void> {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/api/system/status', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(STATIC_STATUS)
        })
    );
}

/**
 * Wait (via direct HTTP, bypassing route stubs) until the backend indexer has
 * completed at least one full scan.  We wait for library.totalFiles > 0 first
 * (so we don't return early on the idle-before-first-scan state) and then wait
 * for the indexer to stop running.
 */
async function waitForIndexer(page: Page, timeout = 30000): Promise<void> {
    const deadline = Date.now() + timeout;
    // Phase 1: wait until the library has at least one file (indexer has started).
    while (Date.now() < deadline) {
        try {
            const res = await page.request.get('/api/system/status');
            if (res.ok()) {
                const s = (await res.json()) as {
                    indexer?: { summary?: { running?: boolean } };
                    library?: { totalFiles?: number };
                };
                if ((s.library?.totalFiles ?? 0) > 0) break;
            }
        } catch { /* ignore transient errors */ }
        await page.waitForTimeout(500);
    }
    // Phase 2: wait for the indexer to finish its current run.
    while (Date.now() < deadline) {
        try {
            const res = await page.request.get('/api/system/status');
            if (res.ok()) {
                const s = (await res.json()) as { indexer?: { summary?: { running?: boolean } } };
                if (!s.indexer?.summary?.running) return;
            }
        } catch { /* ignore transient errors */ }
        await page.waitForTimeout(500);
    }
}

/**
 * Wait for at least one .gallery-item to be present in the DOM.
 * Used after page load to confirm content has rendered.
 */
async function waitForGalleryItems(page: Page, timeout = 15000): Promise<void> {
    await page.waitForFunction(
        () => document.querySelectorAll('.gallery-item').length > 0,
        { timeout }
    );
}

// ── Screenshot helper ─────────────────────────────────────────────────────────

/**
 * Capture a clipped PNG of `locator` and write it to docs/images/.
 *
 * Uses locator.screenshot() which captures only the element's bounding box.
 * animations: 'disabled' freezes CSS transitions/animations so the frame is
 * visually stable at capture time.
 */
async function saveScreenshot(page: Page, locator: Locator, filename: string): Promise<void> {
    mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
    await page.waitForLoadState('networkidle', { timeout: 8000 });
    const buffer = await locator.screenshot({ type: 'png', animations: 'disabled' });
    writeFileSync(path.join(DOCS_IMAGE_DIR, filename), buffer);
}

// ── Settings-tab helper ───────────────────────────────────────────────────────

/** Open the Settings modal and switch to the given tab, then return `.modal`. */
async function openSettingsTab(page: Page, tabLabel: string): Promise<Locator> {
    await stubSettingsApis(page);

    await page.goto('/');
    await page.waitForLoadState('load', { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Settings' }).click({ force: true });
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 8000 });

    const tab = modal.getByRole('tab', { name: tabLabel });
    if (await tab.isVisible()) {
        const alreadyActive = (await tab.getAttribute('aria-selected')) === 'true';
        if (!alreadyActive) {
            await tab.click();
        }
    }

    return modal;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('@docs-screenshots Documentation Screenshots', () => {
    test.use({ storageState: STORAGE_STATE });
    test.use({ viewport: { width: 1440, height: 1100 } });

    // Run serially — tests share a page and write to the same docs/images/ dir.
    test.describe.configure({ mode: 'serial' });

    test.setTimeout(60_000);

    // Wait for the indexer to complete its initial scan before any test starts.
    // Without this, tests that depend on indexed media (images, videos, playlists)
    // can race and see an empty gallery when the server has just started.
    test.beforeAll(async ({ request }) => {
        const deadline = Date.now() + 60000;
        // Phase 1: wait until the library has at least one file (indexer has started).
        while (Date.now() < deadline) {
            try {
                const res = await request.get('/api/system/status');
                if (res.ok()) {
                    const s = await res.json() as {
                        indexer?: { summary?: { running?: boolean } };
                        library?: { totalFiles?: number };
                    };
                    if ((s.library?.totalFiles ?? 0) > 0) break;
                }
            } catch { /* ignore */ }
            await new Promise(r => setTimeout(r, 500));
        }
        // Phase 2: wait for the indexer to finish its current run.
        while (Date.now() < deadline) {
            try {
                const res = await request.get('/api/system/status');
                if (res.ok()) {
                    const s = await res.json() as { indexer?: { summary?: { running?: boolean } } };
                    if (!s.indexer?.summary?.running) return;
                }
            } catch { /* ignore */ }
            await new Promise(r => setTimeout(r, 500));
        }
    });

    // Ensure reduced-motion is active per-page so CSS animations complete in ~0ms,
    // giving a visually stable frame for the screenshot.  The global config already
    // sets reducedMotion: 'reduce'; this call is a belt-and-suspenders guard for
    // any per-page state that might override it in serial mode.
    test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
    });

    // ── Settings tabs ─────────────────────────────────────────────────────────

    test('@docs-screenshots settings security tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'Security');
        await expect(modal.getByRole('tab', { name: 'Security' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        await saveScreenshot(page, modal, 'settings-tab-security.png');
    });

    test('@docs-screenshots settings passkeys tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'Passkeys');
        await expect(modal.getByRole('tab', { name: 'Passkeys' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        await expect(page.getByText('Loading passkeys')).not.toBeVisible({ timeout: 8000 });
        await saveScreenshot(page, modal, 'settings-tab-passkeys.png');
    });

    test('@docs-screenshots settings library tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'Library');
        await expect(modal.getByRole('tab', { name: 'Library' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        await saveScreenshot(page, modal, 'settings-tab-library.png');
    });

    test('@docs-screenshots settings system tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'System');
        await expect(modal.getByRole('tab', { name: 'System' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        await saveScreenshot(page, modal, 'settings-tab-system.png');
    });

    test('@docs-screenshots settings tags tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'Tags');
        await expect(modal.getByRole('tab', { name: 'Tags' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        await expect(page.getByText('Loading tags')).not.toBeVisible({ timeout: 8000 });
        await saveScreenshot(page, modal, 'settings-tab-tags.png');
    });

    test('@docs-screenshots settings about tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'About');
        await expect(modal.getByRole('tab', { name: 'About' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        await expect(modal.locator('.muted').filter({ hasText: 'Loading' })).toHaveCount(0, {
            timeout: 8000
        });
        await saveScreenshot(page, modal, 'settings-tab-about.png');
    });

    // ── Favorites strip ───────────────────────────────────────────────────────

    test('@docs-screenshots favorites strip', async ({ page }) => {
        await stubStatusApi(page);

        const mediaRes = await page.request.get('/api/media?limit=1&sort=name&order=asc');
        if (mediaRes.ok()) {
            const data = (await mediaRes.json()) as {
                items?: { path: string; name: string; type: string }[];
            };
            const first = data.items?.[0];
            if (first) {
                await page.request.post('/api/favorites', {
                    data: { path: first.path, name: first.name, type: first.type }
                });
            }
        }

        await page.goto('/');
        await page.waitForLoadState('load', { timeout: 10000 });
        await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 });

        const strip = page.locator('.favorites-strip');
        if (!(await strip.isVisible().catch(() => false))) {
            test.skip();
            return;
        }

        await expect(strip).toBeVisible({ timeout: 10000 });
        await saveScreenshot(page, strip, 'favorites-strip.png');
    });

    // ── Stats bar ─────────────────────────────────────────────────────────────

    test('@docs-screenshots stats bar / status footer', async ({ page }) => {
        await stubStatusApi(page);

        await page.goto('/');
        await page.waitForLoadState('load', { timeout: 10000 });
        await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 });

        const candidates = [
            '.status-footer',
            '.stats-bar',
            '.system-status',
            '[data-testid="stats"]'
        ];
        let found = false;
        for (const sel of candidates) {
            const loc = page.locator(sel);
            if (await loc.isVisible().catch(() => false)) {
                await saveScreenshot(page, loc, 'stats-bar.png');
                found = true;
                break;
            }
        }

        if (!found) {
            const header = page.locator('header');
            if (await header.isVisible().catch(() => false)) {
                await saveScreenshot(page, header, 'stats-bar.png');
            }
        }
    });

    // ── Lightbox ──────────────────────────────────────────────────────────────

    test('@docs-screenshots lightbox top toolbar', async ({ page }) => {
        await stubStatusApi(page);

        await page.goto('/');
        await page.waitForLoadState('load', { timeout: 10000 });
        await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 });

        // Only click on image/video items — folders navigate instead of opening lightbox.
        const firstMedia = page.locator('[data-type="image"], [data-type="video"]').first();

        if (!(await firstMedia.isVisible().catch(() => false))) {
            test.skip();
            return;
        }

        await firstMedia.click();

        const lightbox = page.locator('.lightbox');
        if (!(await lightbox.isVisible({ timeout: 8000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await page.mouse.move(720, 550);

        const topbar = lightbox.locator('.lightbox-topbar');
        await expect(topbar).toBeVisible({ timeout: 5000 });
        await saveScreenshot(page, topbar, 'lightbox-video-toolbar.png');
    });

    // ── Home / gallery ────────────────────────────────────────────────────────

    test('@docs-screenshots home page gallery — desktop', async ({ page }) => {
        // Wait for indexer to finish before navigating so the gallery isn't empty.
        // page.request bypasses route stubs so this hits the real status endpoint.
        await waitForIndexer(page);
        await stubStatusApi(page);

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await waitForGalleryItems(page);

        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        const buffer = await page.screenshot({ type: 'png', animations: 'disabled' });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'basics-desktop.png'), buffer);
    });

    test('@docs-screenshots home page gallery — mobile', async ({ page }) => {
        await waitForIndexer(page);
        await stubStatusApi(page);
        await page.setViewportSize({ width: 390, height: 844 });

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await waitForGalleryItems(page);

        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        const buffer = await page.screenshot({ type: 'png', animations: 'disabled' });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'basics-mobile.png'), buffer);
    });

    // ── Search ────────────────────────────────────────────────────────────────

    test('@docs-screenshots search page — desktop', async ({ page }) => {
        await stubStatusApi(page);

        // Drive search via the URL param — the page reads q from searchParams,
        // not from the input value, so filling the input alone shows no results.
        await page.goto('/search?q=photo');
        await page.waitForLoadState('networkidle', { timeout: 10000 });

        // Wait for gallery items or the empty-state message to confirm the search
        // response has been rendered before capturing.
        await page.waitForFunction(
            () => {
                const items = document.querySelectorAll('.gallery-item');
                const msg = document.querySelector('.state-msg');
                return items.length > 0 || msg !== null;
            },
            { timeout: 8000 }
        );

        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        const buffer = await page.screenshot({ type: 'png', animations: 'disabled' });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'search-desktop.png'), buffer);
    });

    // ── Collections ───────────────────────────────────────────────────────────

    test('@docs-screenshots collections workflow — gallery collect button', async ({ page }) => {
        // Pre-create a collection so the CollectionsPanel shows meaningful content.
        const mediaRes = await page.request.get('/api/media?limit=2&sort=name&order=asc');
        const mediaPaths: string[] = [];
        if (mediaRes.ok()) {
            const d = (await mediaRes.json()) as { items?: { path: string }[] };
            mediaPaths.push(...(d.items ?? []).map((m) => m.path));
        }
        let collectionId: number | null = null;
        if (mediaPaths.length > 0) {
            const res = await page.request.post('/api/collections', {
                data: { name: 'Summer 2024', paths: mediaPaths }
            });
            if (res.ok()) {
                const col = (await res.json()) as { id?: number };
                collectionId = col.id ?? null;
            }
        }

        await stubStatusApi(page);
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await waitForGalleryItems(page);

        // Hover over the first non-folder item to reveal the .collections-btn, then click.
        const firstItem = page.locator('[data-type="image"], [data-type="video"]').first();
        if (!(await firstItem.isVisible().catch(() => false))) { test.skip(); return; }
        await firstItem.hover();
        const collectBtn = firstItem.locator('.collections-btn');
        if (!(await collectBtn.isVisible({ timeout: 3000 }).catch(() => false))) { test.skip(); return; }
        await collectBtn.click();

        // The CollectionsPanel (.cp) renders as an overlay near the item.
        const panel = page.locator('.cp');
        try {
            await panel.waitFor({ state: 'visible', timeout: 6000 });
        } catch {
            test.skip(); return;
        }

        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        const buffer = await page.screenshot({ type: 'png', animations: 'disabled' });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'collections-workflow.png'), buffer);

        // Clean up.
        if (collectionId !== null) {
            await page.request.delete(`/api/collections/${collectionId}`).catch(() => {});
        }
    });

    test('@docs-screenshots lightbox — collections drawer', async ({ page }) => {
        await stubStatusApi(page);

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });

        const firstMedia = page.locator('[data-type="image"], [data-type="video"]').first();
        if (!(await firstMedia.isVisible().catch(() => false))) { test.skip(); return; }
        await firstMedia.click();

        const lightbox = page.locator('.lightbox');
        if (!(await lightbox.isVisible({ timeout: 8000 }).catch(() => false))) { test.skip(); return; }

        await page.mouse.move(720, 550);
        await page.getByRole('button', { name: 'Collections' }).click();

        const panel = page.locator('.cp');
        if (!(await panel.isVisible({ timeout: 5000 }).catch(() => false))) { test.skip(); return; }

        await saveScreenshot(page, panel, 'collections-lightbox-drawer.png');
        // Also save as collections-modal.png (same panel opened from item context)
        writeFileSync(
            path.join(DOCS_IMAGE_DIR, 'collections-modal.png'),
            readFileSync(path.join(DOCS_IMAGE_DIR, 'collections-lightbox-drawer.png'))
        );
    });

    // ── Selection mode ────────────────────────────────────────────────────────

    test('@docs-screenshots selection mode toolbar — mobile', async ({ page }) => {
        await waitForIndexer(page);
        await stubStatusApi(page);
        await page.setViewportSize({ width: 390, height: 844 });

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await waitForGalleryItems(page);

        // Enter selection mode by force-clicking the checkbox on a non-folder item.
        // Folders don't have checkboxes; hover doesn't work on mobile viewport.
        const firstItem = page.locator('[data-type="image"], [data-type="video"]').first();
        if (!(await firstItem.isVisible({ timeout: 8000 }).catch(() => false))) { test.skip(); return; }
        const checkbox = firstItem.locator('.checkbox');
        await checkbox.click({ force: true });

        const selBar = page.locator('.selection-bar');
        if (!(await selBar.isVisible({ timeout: 5000 }).catch(() => false))) { test.skip(); return; }

        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        const buffer = await page.screenshot({ type: 'png', animations: 'disabled' });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'selection-mobile-toolbar.png'), buffer);
    });

    test('@docs-screenshots bulk tag modal — mobile', async ({ page }) => {
        await waitForIndexer(page);
        await stubStatusApi(page);
        await page.setViewportSize({ width: 390, height: 844 });

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await waitForGalleryItems(page);

        // Select the first non-folder item then open the bulk tag modal.
        const firstItem = page.locator('[data-type="image"], [data-type="video"]').first();
        if (!(await firstItem.isVisible({ timeout: 8000 }).catch(() => false))) { test.skip(); return; }
        const checkbox = firstItem.locator('.checkbox');
        await checkbox.click({ force: true });
        await expect(page.locator('.selection-bar')).toBeVisible({ timeout: 5000 });

        // Tag button in the selection toolbar
        const tagBtn = page.locator('.selection-bar').getByRole('button', { name: /tag/i });
        if (!(await tagBtn.isVisible({ timeout: 3000 }).catch(() => false))) { test.skip(); return; }
        await tagBtn.click();

        const tagModal = page.locator('.tag-modal');
        if (!(await tagModal.isVisible({ timeout: 5000 }).catch(() => false))) { test.skip(); return; }

        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        const buffer = await page.screenshot({ type: 'png', animations: 'disabled' });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'bulk-tagging-mobile.png'), buffer);
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'tagging-bulk-modal.png'),
            readFileSync(path.join(DOCS_IMAGE_DIR, 'bulk-tagging-mobile.png')));
    });

    // ── Lightbox ──────────────────────────────────────────────────────────────

    test('@docs-screenshots lightbox — mobile top controls', async ({ page }) => {
        await stubStatusApi(page);
        await page.setViewportSize({ width: 390, height: 844 });

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });

        const firstMedia = page.locator('[data-type="image"], [data-type="video"]').first();
        if (!(await firstMedia.isVisible().catch(() => false))) { test.skip(); return; }
        await firstMedia.click();

        const lightbox = page.locator('.lightbox');
        if (!(await lightbox.isVisible({ timeout: 8000 }).catch(() => false))) { test.skip(); return; }

        await page.mouse.move(195, 400);

        const topbar = lightbox.locator('.lightbox-topbar');
        await expect(topbar).toBeVisible({ timeout: 5000 });
        await saveScreenshot(page, topbar, 'lightbox-mobile-top-controls.png');
    });

    test('@docs-screenshots lightbox — tag editor row', async ({ page }) => {
        await stubStatusApi(page);

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });

        const firstMedia = page.locator('[data-type="image"], [data-type="video"]').first();
        if (!(await firstMedia.isVisible().catch(() => false))) { test.skip(); return; }
        await firstMedia.click();

        const lightbox = page.locator('.lightbox');
        if (!(await lightbox.isVisible({ timeout: 8000 }).catch(() => false))) { test.skip(); return; }

        const infoBar = lightbox.locator('.lb-info');
        if (!(await infoBar.isVisible({ timeout: 5000 }).catch(() => false))) { test.skip(); return; }

        await saveScreenshot(page, infoBar, 'tagging-lightbox-drawer.png');
    });

    test('@docs-screenshots tag suggestions — empty input', async ({ page }) => {
        // Seed tags on two items so the TagEditor can show related suggestions.
        // Item 1 gets landscape+nature; item 2 gets landscape+nature+vacation.
        // This creates co-occurrence: opening item 1 → "vacation" is suggested.
        const mediaRes = await page.request.get('/api/media?limit=3&sort=name&order=asc');
        const items: { path: string }[] = [];
        if (mediaRes.ok()) {
            const d = (await mediaRes.json()) as { items?: { path: string }[] };
            items.push(...(d.items ?? []));
        }
        const baseTags = ['landscape', 'nature'];
        const secondTags = ['landscape', 'nature', 'vacation', 'sunset'];
        if (items[0]) {
            await page.request.put('/api/tags/file', { data: { path: items[0].path, tags: baseTags } });
        }
        if (items[1]) {
            await page.request.put('/api/tags/file', { data: { path: items[1].path, tags: secondTags } });
        }

        await stubStatusApi(page);
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });

        const firstMedia = page.locator('[data-type="image"], [data-type="video"]').first();
        if (!(await firstMedia.isVisible().catch(() => false))) { test.skip(); return; }
        await firstMedia.click();

        const lightbox = page.locator('.lightbox');
        if (!(await lightbox.isVisible({ timeout: 8000 }).catch(() => false))) { test.skip(); return; }

        // Click into the tag input to trigger empty suggestions.
        // The TagEditor loads knownTags from /api/tags and relatedSuggestions from
        // /api/tags/suggestions based on the current item's tags.
        const tagInput = lightbox.locator('.tag-input');
        if (!(await tagInput.isVisible({ timeout: 5000 }).catch(() => false))) { test.skip(); return; }
        await tagInput.click();
        // Give the related suggestions API call time to resolve.
        await page.waitForTimeout(600);

        const tagEditor = lightbox.locator('.tag-editor');
        await saveScreenshot(page, tagEditor, 'tagging-suggestions-empty.png');
    });

    test('@docs-screenshots tag suggestions — typed', async ({ page }) => {
        // Tags were seeded in the previous test; just open the lightbox and type.
        await stubStatusApi(page);
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });

        const firstMedia = page.locator('[data-type="image"], [data-type="video"]').first();
        if (!(await firstMedia.isVisible().catch(() => false))) { test.skip(); return; }
        await firstMedia.click();

        const lightbox = page.locator('.lightbox');
        if (!(await lightbox.isVisible({ timeout: 8000 }).catch(() => false))) { test.skip(); return; }

        const tagInput = lightbox.locator('.tag-input');
        if (!(await tagInput.isVisible({ timeout: 5000 }).catch(() => false))) { test.skip(); return; }
        await tagInput.click();
        // 'a' matches landscape, nature, vacation, sunset — all seeded above.
        await tagInput.fill('a');
        await page.waitForTimeout(300);

        const tagEditor = lightbox.locator('.tag-editor');
        await saveScreenshot(page, tagEditor, 'tagging-suggestions-typed.png');
    });

    // ── Settings — tags manager ───────────────────────────────────────────────

    test('@docs-screenshots settings tags tab (also saved as tagging-manager-settings)', async ({ page }) => {
        const modal = await openSettingsTab(page, 'Tags');
        await expect(modal.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByText('Loading tags')).not.toBeVisible({ timeout: 8000 });

        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        await page.waitForLoadState('networkidle', { timeout: 8000 });
        const buffer = await modal.screenshot({ type: 'png', animations: 'disabled' });
        // tagging-manager-settings.png is the same screenshot — settings tags manager
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'tagging-manager-settings.png'), buffer);
        // Also overwrite the canonical settings-tab-tags.png
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'settings-tab-tags.png'), buffer);
    });

    // ── Passkeys — mobile ─────────────────────────────────────────────────────

    test('@docs-screenshots settings passkeys tab — mobile', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const modal = await openSettingsTab(page, 'Passkeys');
        await expect(modal.getByRole('tab', { name: 'Passkeys' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByText('Loading passkeys')).not.toBeVisible({ timeout: 8000 });
        await saveScreenshot(page, modal, 'passkeys-mobile.png');
    });

    // ── Playlist ──────────────────────────────────────────────────────────────

    test('@docs-screenshots playlist page', async ({ page }) => {
        // Verify the playlist API is reachable before navigating.
        // The playlist page immediately calls goto('/') when the API returns 404.
        const plRes = await page.request.get('/api/playlists/sample-playlist').catch(() => null);
        if (!plRes || !plRes.ok()) { test.skip(); return; }

        await stubStatusApi(page);

        // sample-playlist.wpl is created by ensure-test-playlist.sh
        await page.goto('/playlists/sample-playlist');

        // Wait for SvelteKit to mount and render .player-page (JS-rendered, not in SSR HTML).
        // isVisible() does not retry; waitFor({ state: 'visible' }) does.
        const playerPage = page.locator('.player-page');
        try {
            await playerPage.waitFor({ state: 'visible', timeout: 10000 });
        } catch {
            test.skip(); return;
        }

        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        const buffer = await page.screenshot({ type: 'png', animations: 'disabled' });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'playlist-theater-mode.png'), buffer);
    });

    // ── Search tag filter ─────────────────────────────────────────────────────

    test('@docs-screenshots search bar — tag filter suggestions', async ({ page }) => {
        await stubStatusApi(page);

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 8000 });

        // The search bar is always visible on desktop via the header's CSS media query.
        // On mobile it requires a toggle click — detect which situation we're in.
        const input = page.locator('.search-input').first();
        if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) {
            // Mobile: click toggle button to reveal the search bar.
            const toggleBtn = page.getByRole('button', { name: 'Toggle search' });
            if (!(await toggleBtn.isVisible({ timeout: 3000 }).catch(() => false))) { test.skip(); return; }
            await toggleBtn.click();
            if (!(await input.isVisible({ timeout: 3000 }).catch(() => false))) { test.skip(); return; }
        }
        await input.fill('#');
        await page.waitForTimeout(400);

        const searchBar = page.locator('.search-bar');
        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        const buffer = await searchBar.screenshot({ type: 'png', animations: 'disabled' });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'tagging-search-filter-modal.png'), buffer);
    });

    // ── Collections panel (manager view from gallery toolbar) ────────────────

    test('@docs-screenshots collections manager panel', async ({ page }) => {
        // Pre-create collections so the panel shows real content.
        const mediaRes = await page.request.get('/api/media?limit=4&sort=name&order=asc');
        const mediaPaths: string[] = [];
        if (mediaRes.ok()) {
            const d = (await mediaRes.json()) as { items?: { path: string }[] };
            mediaPaths.push(...(d.items ?? []).map((m) => m.path));
        }
        const collectionIds: number[] = [];
        for (const name of ['Summer 2024', 'Road Trip']) {
            const res = await page.request.post('/api/collections', {
                data: { name, paths: mediaPaths.slice(0, 2) }
            });
            if (res.ok()) {
                const col = (await res.json()) as { id?: number };
                if (col.id) collectionIds.push(col.id);
            }
        }

        await stubStatusApi(page);
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await waitForGalleryItems(page);

        // Open the CollectionsPanel via the gallery item's collect button.
        const firstItem = page.locator('[data-type="image"], [data-type="video"]').first();
        if (!(await firstItem.isVisible().catch(() => false))) { test.skip(); return; }
        await firstItem.hover();
        const collectBtn = firstItem.locator('.collections-btn');
        if (!(await collectBtn.isVisible({ timeout: 3000 }).catch(() => false))) { test.skip(); return; }
        await collectBtn.click();

        const panel = page.locator('.cp');
        try {
            await panel.waitFor({ state: 'visible', timeout: 6000 });
        } catch {
            test.skip(); return;
        }

        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        const buf = await panel.screenshot({ type: 'png', animations: 'disabled' });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'collections-panel.png'), buf);

        // Clean up.
        for (const id of collectionIds) {
            await page.request.delete(`/api/collections/${id}`).catch(() => {});
        }
    });

    // ── Scroll restore (gallery scrubber shown as visual anchor) ─────────────

    test('@docs-screenshots gallery scrubber', async ({ page }) => {
        await waitForIndexer(page);
        await stubStatusApi(page);

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await waitForGalleryItems(page);

        const scrubber = page.locator('.scrubber');
        if (!(await scrubber.isVisible({ timeout: 5000 }).catch(() => false))) { test.skip(); return; }

        await saveScreenshot(page, scrubber, 'scroll-restore-prompt.png');
    });
});
