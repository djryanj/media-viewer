/**
 * E2E tests for Settings functionality
 * Tests the current settings modal, tabs, and key controls.
 * @tags @settings @features @preferences @admin @clock
 */

import { test, expect } from '../../fixtures/index.js';

const SEL = {
    button: '#settings-btn',
    modal: '#settings-modal',
    close: '#settings-modal .modal-close',
    backdrop: '#settings-modal .modal-backdrop',
    tabs: '.settings-tab',
    securityPanel: '#settings-security',
    passkeysPanel: '#settings-passkeys',
    cachePanel: '#settings-cache',
    displayPanel: '#settings-display',
    tagsPanel: '#settings-tags',
    aboutPanel: '#settings-about',
};

async function openSettingsViaButton(page) {
    await expect(page.locator(SEL.button)).toBeAttached();
    await page.locator(SEL.button).dispatchEvent('click');
    await expect(page.locator(SEL.modal)).toBeVisible();
}

async function openSettings(page, tab = 'security') {
    await page.evaluate((tabName) => {
        window.settingsManager?.open(tabName);
    }, tab);
    await expect(page.locator(SEL.modal)).toBeVisible();
    await expectTabActive(page, tab);
}

async function expectTabActive(page, tab) {
    await expect(page.locator(`.settings-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
    await expect(page.locator(`#settings-${tab}`)).toHaveClass(/active/);
}

async function getStoredPreferences(page) {
    return page.evaluate(() => {
        const raw = window.localStorage.getItem('mediaViewerPreferences');
        return raw ? JSON.parse(raw) : null;
    });
}

async function resetPreferences(page) {
    await page.evaluate(() => {
        window.localStorage.removeItem('mediaViewerPreferences');
        window.Preferences?.reset?.();
        window.settingsManager?.loadDisplaySettings?.();
        window.Clock?.updateVisibility?.();
        window.Clock?.updateTime?.();
    });
}

async function setToggleSwitch(page, inputSelector, checked) {
    const input = page.locator(inputSelector);

    await expect(input).toBeAttached();

    await page.evaluate(
        ({ selector, nextChecked }) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLInputElement)) {
                throw new Error(`Toggle input not found: ${selector}`);
            }

            if (element.checked === nextChecked) {
                return;
            }

            element.checked = nextChecked;
            element.dispatchEvent(new Event('change', { bubbles: true }));
        },
        { selector: inputSelector, nextChecked: checked }
    );

    if (checked) {
        await expect(input).toBeChecked();
    } else {
        await expect(input).not.toBeChecked();
    }
}

test.describe('Settings - Modal and Navigation @settings @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
    });

    test('should open settings modal', async ({ page }) => {
        await openSettingsViaButton(page);
    });

    test('should close settings modal with close button', async ({ page }) => {
        await openSettings(page);
        await page.locator(SEL.close).dispatchEvent('click');
        await expect(page.locator(SEL.modal)).toHaveClass(/hidden/);
    });

    test('should close settings modal with Escape key @keyboard', async ({ page }) => {
        await openSettings(page);
        await page.evaluate(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await expect(page.locator(SEL.modal)).toHaveClass(/hidden/);
    });

    test('should close settings modal by clicking backdrop', async ({ page }) => {
        await openSettings(page);
        await page.locator(SEL.backdrop).dispatchEvent('click');
        await expect(page.locator(SEL.modal)).toHaveClass(/hidden/);
    });
});

test.describe('Settings - Tabs @settings @features @navigation', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await openSettings(page);
    });

    test('should expose the current settings tabs', async ({ page }) => {
        const tabs = page.locator(SEL.tabs);
        await expect(tabs).toHaveCount(6);
        await expect(page.locator('.settings-tab[data-tab="security"]')).toContainText('Security');
        await expect(page.locator('.settings-tab[data-tab="display"]')).toContainText('Display');
        await expect(page.locator('.settings-tab[data-tab="tags"]')).toContainText('Tags');
    });

    test('should switch between tabs and panels', async ({ page }) => {
        for (const tab of ['passkeys', 'cache', 'display', 'tags', 'about']) {
            await page.locator(`.settings-tab[data-tab="${tab}"]`).dispatchEvent('click');
            await expectTabActive(page, tab);
        }
    });

    test('should switch tabs with keyboard activation @keyboard @accessibility', async ({
        page,
    }) => {
        const tagsTab = page.locator('.settings-tab[data-tab="tags"]');

        await tagsTab.focus();
        await expect(tagsTab).toBeFocused();
        await page.keyboard.press('Enter');

        await expectTabActive(page, 'tags');
    });
});

test.describe('Settings - Security and Passkeys @settings @features @security', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
    });

    test('should show the password change form in the security tab', async ({ page }) => {
        await openSettings(page, 'security');

        await expect(page.locator(SEL.securityPanel)).toHaveClass(/active/);
        await expect(page.locator('#settings-password-form')).toBeVisible();
        await expect(page.locator('#settings-current-password')).toBeVisible();
        await expect(page.locator('#settings-new-password')).toBeVisible();
        await expect(page.locator('#settings-confirm-password')).toBeVisible();
    });

    test('should show passkey management controls', async ({ page }) => {
        await openSettings(page, 'passkeys');

        await expect(page.locator(SEL.passkeysPanel)).toBeVisible();
        await expect(page.locator('#passkeys-container')).toBeAttached();
        await expect
            .poll(async () => {
                return page.evaluate(() => {
                    const stateIds = [
                        'passkeys-loading',
                        'passkeys-list',
                        'passkeys-empty',
                        'passkeys-not-supported',
                        'passkeys-insecure-context',
                        'passkeys-not-enabled',
                    ];

                    return stateIds.some((id) => {
                        const element = document.getElementById(id);
                        if (!element || element.classList.contains('hidden')) {
                            return false;
                        }

                        return getComputedStyle(element).display !== 'none';
                    });
                });
            })
            .toBe(true);
    });
});

test.describe('Settings - Display, Cache, and Tags @settings @features @admin', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
    });

    test('should show display preference controls', async ({ page }) => {
        await openSettings(page, 'display');

        await expect(page.locator(SEL.displayPanel)).toBeVisible();
        await expect(page.locator('.settings-row:has(#clock-enabled-toggle)')).toBeVisible();
        await expect(page.locator('#clock-enabled-toggle')).toBeAttached();
        await expect(page.locator('#clock-format-select')).toBeVisible();
        await expect(page.locator('.settings-row:has(#clock-always-visible-toggle)')).toBeVisible();
        await expect(page.locator('#clock-always-visible-toggle')).toBeAttached();
        await expect(page.locator('#default-sort-field')).toBeVisible();
        await expect(page.locator('#default-sort-order')).toBeVisible();
    });

    test('should show cache management actions', async ({ page }) => {
        await openSettings(page, 'cache');

        await expect(page.locator(SEL.cachePanel)).toHaveClass(/active/);
        await expect(page.locator('#rebuild-thumbnails-btn')).toBeVisible();
        await expect(page.locator('#reindex-btn')).toBeVisible();
        await expect(page.locator('#clear-transcode-btn')).toBeVisible();
        await expect(page.locator('#run-autotagger-btn')).toBeVisible();
        await expect(page.locator('#thumbnail-cache-size')).toBeVisible();
        await expect(page.locator('#transcode-cache-size')).toBeVisible();
    });

    test('should trigger autotagger run and show success message', async ({ page }) => {
        // Intercept the API call so the test does not depend on a real running tagger.
        await page.route('/api/autotagger/run', (route) => {
            route.fulfill({
                status: 202,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, message: 'Auto-tagger run started' }),
            });
        });

        await openSettings(page, 'cache');

        await page.locator('#run-autotagger-btn').dispatchEvent('click');

        // Wait for the success element to become visible (loading state resolves).
        await expect(page.locator('#cache-success')).toBeVisible({ timeout: 5000 });
    });

    test('should show the tags manager controls', async ({ page }) => {
        await openSettings(page, 'tags');

        await expect(page.locator(SEL.tagsPanel)).toHaveClass(/active/);
        await expect(page.locator('#tag-search-input')).toBeVisible();
        await expect(page.locator('#show-unused-tags-btn')).toBeVisible();
        await expect(page.locator('#tag-list-body')).toBeVisible();
    });

    test('should show the about panel', async ({ page }) => {
        await openSettings(page, 'about');
        await expect(page.locator(SEL.aboutPanel)).toHaveClass(/active/);
    });

    test('should persist clock display preferences across reloads', async ({ page }) => {
        await resetPreferences(page);
        await openSettings(page, 'display');

        const clockToggle = page.locator('#clock-enabled-toggle');
        const clockFormatSelect = page.locator('#clock-format-select');
        const clockAlwaysVisibleToggle = page.locator('#clock-always-visible-toggle');
        const lightboxClock = page.locator('#lightbox-clock');
        const playlistClock = page.locator('#playlist-clock');

        await setToggleSwitch(page, '#clock-enabled-toggle', true);
        await setToggleSwitch(page, '#clock-always-visible-toggle', true);
        await expect(clockFormatSelect).toHaveValue('12');

        await clockFormatSelect.selectOption('24');
        await setToggleSwitch(page, '#clock-enabled-toggle', false);

        await expect(clockAlwaysVisibleToggle).toBeDisabled();
        await expect(clockAlwaysVisibleToggle).not.toBeChecked();
        await expect(lightboxClock).toHaveClass(/hidden/);
        await expect(playlistClock).toHaveClass(/hidden/);

        const storedBeforeReload = await getStoredPreferences(page);
        expect(storedBeforeReload?.clockEnabled).toBe(false);
        expect(storedBeforeReload?.clockFormat).toBe('24');
        expect(storedBeforeReload?.clockAlwaysVisible).toBe(false);

        await page.reload();
        await openSettings(page, 'display');

        await expect(clockToggle).not.toBeChecked();
        await expect(clockFormatSelect).toHaveValue('24');
        await expect(clockAlwaysVisibleToggle).toBeDisabled();
        await expect(clockAlwaysVisibleToggle).not.toBeChecked();
        await expect(lightboxClock).toHaveClass(/hidden/);
        await expect(playlistClock).toHaveClass(/hidden/);

        const storedAfterReload = await getStoredPreferences(page);
        expect(storedAfterReload?.clockEnabled).toBe(false);
        expect(storedAfterReload?.clockFormat).toBe('24');
        expect(storedAfterReload?.clockAlwaysVisible).toBe(false);
    });

    test('should persist default sort preferences across reloads', async ({ page }) => {
        await resetPreferences(page);
        await openSettings(page, 'display');

        const sortFieldSelect = page.locator('#default-sort-field');
        const sortOrderSelect = page.locator('#default-sort-order');
        const gallerySortSelect = page.locator('#sort-select');

        await sortFieldSelect.selectOption('date');
        await sortOrderSelect.selectOption('desc');

        await expect(gallerySortSelect).toHaveValue('date');
        await expect
            .poll(async () => {
                return page.evaluate(() => window.MediaApp?.state?.currentSort ?? null);
            })
            .toEqual({ field: 'date', order: 'desc' });

        const storedBeforeReload = await getStoredPreferences(page);
        expect(storedBeforeReload?.sortField).toBe('date');
        expect(storedBeforeReload?.sortOrder).toBe('desc');

        await page.reload();

        await expect(gallerySortSelect).toHaveValue('date');
        await expect
            .poll(async () => {
                return page.evaluate(() => window.MediaApp?.state?.currentSort ?? null);
            })
            .toEqual({ field: 'date', order: 'desc' });

        await openSettings(page, 'display');
        await expect(sortFieldSelect).toHaveValue('date');
        await expect(sortOrderSelect).toHaveValue('desc');

        const storedAfterReload = await getStoredPreferences(page);
        expect(storedAfterReload?.sortField).toBe('date');
        expect(storedAfterReload?.sortOrder).toBe('desc');
    });
});
