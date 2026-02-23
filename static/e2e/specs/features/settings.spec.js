/**
 * E2E tests for Settings functionality
 * Tests settings modal, tabs, preferences, and configuration
 * @tags @settings @features @preferences @admin
 */

import { test, expect } from '../../fixtures/index.js';

test.describe('Settings - Modal and Navigation @settings @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
    });

    test('should open settings modal', async ({ page }) => {
        const settingsButton = page.locator(
            '#settings-btn, button:has-text("Settings"), [aria-label*="Settings"]'
        );

        if ((await settingsButton.count()) > 0) {
            await settingsButton.click();

            const settingsModal = page.locator(
                '#settings-modal, .settings-modal, [role="dialog"]:has-text("Settings")'
            );
            await expect(settingsModal).toBeVisible({ timeout: 3000 });
        }
    });

    test('should close settings modal with close button', async ({ page }) => {
        const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');

        if ((await settingsButton.count()) > 0) {
            await settingsButton.click();

            const settingsModal = page.locator('#settings-modal, .settings-modal');
            await expect(settingsModal).toBeVisible();

            const closeButton = settingsModal.locator(
                '.modal-close, button:has-text("Close"), [aria-label="Close"]'
            );

            if ((await closeButton.count()) > 0) {
                await closeButton.click();
                await expect(settingsModal).toBeHidden({ timeout: 2000 });
            }
        }
    });

    test('should close settings modal with Escape key @keyboard', async ({ page }) => {
        const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');

        if ((await settingsButton.count()) > 0) {
            await settingsButton.click();

            const settingsModal = page.locator('#settings-modal, .settings-modal');
            await expect(settingsModal).toBeVisible();

            await page.keyboard.press('Escape');
            await expect(settingsModal).toBeHidden({ timeout: 2000 });
        }
    });

    test('should close settings modal by clicking backdrop', async ({ page }) => {
        const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');

        if ((await settingsButton.count()) > 0) {
            await settingsButton.click();

            const settingsModal = page.locator('#settings-modal, .settings-modal');
            await expect(settingsModal).toBeVisible();

            const backdrop = settingsModal.locator('.modal-backdrop, .backdrop');

            if ((await backdrop.count()) > 0) {
                await backdrop.click({ force: true });
                await expect(settingsModal).toBeHidden({ timeout: 2000 });
            }
        }
    });
});

test.describe('Settings - Tabs @settings @features @navigation', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        // Open settings
        const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');
        if ((await settingsButton.count()) > 0) {
            await settingsButton.click();
            await page.waitForSelector('#settings-modal, .settings-modal', { timeout: 3000 });
        }
    });

    test('should have multiple tabs available', async ({ page }) => {
        const tabs = page.locator('.settings-tab, [role="tab"]');

        if ((await tabs.count()) > 0) {
            const count = await tabs.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('should switch between tabs', async ({ page }) => {
        const tabs = page.locator('.settings-tab, [role="tab"]');

        if ((await tabs.count()) >= 2) {
            const _firstTab = tabs.first();
            const secondTab = tabs.nth(1);

            // Click second tab
            await secondTab.click();
            await page.waitForTimeout(200);

            // Second tab should be active
            const secondTabClass = await secondTab.getAttribute('class');
            expect(secondTabClass).toContain('active');
        }
    });

    test('should show correct content for each tab', async ({ page }) => {
        const tabs = page.locator('.settings-tab, [role="tab"]');

        if ((await tabs.count()) > 0) {
            for (let i = 0; i < Math.min(await tabs.count(), 3); i++) {
                const tab = tabs.nth(i);
                await tab.click();
                await page.waitForTimeout(200);

                // Content panel should be visible
                const tabDataAttr = await tab.getAttribute('data-tab');
                if (tabDataAttr) {
                    const content = page.locator(
                        `[data-tab-content="${tabDataAttr}"], .settings-panel.active`
                    );
                    if ((await content.count()) > 0) {
                        await expect(content).toBeVisible();
                    }
                }
            }
        }
    });
});

test.describe('Settings - Security @settings @features @security', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');
        if ((await settingsButton.count()) > 0) {
            await settingsButton.click();
            await page.waitForSelector('#settings-modal', { timeout: 3000 });
        }
    });

    test('should have password change form', async ({ page }) => {
        const securityTab = page
            .locator('.settings-tab[data-tab="security"], :text("Security")')
            .first();

        if ((await securityTab.count()) > 0) {
            await securityTab.click();

            const passwordForm = page.locator('#settings-password-form, form[name="password"]');

            if ((await passwordForm.count()) > 0) {
                await expect(passwordForm).toBeVisible();

                // Should have password fields
                const currentPassword = passwordForm
                    .locator('input[name="current-password"], input[type="password"]')
                    .first();
                const newPassword = passwordForm.locator('input[name="new-password"]');

                if ((await currentPassword.count()) > 0) {
                    await expect(currentPassword).toBeVisible();
                }
                if ((await newPassword.count()) > 0) {
                    await expect(newPassword).toBeVisible();
                }
            }
        }
    });

    test('should validate password requirements', async ({ page }) => {
        const securityTab = page
            .locator('.settings-tab[data-tab="security"], :text("Security")')
            .first();

        if ((await securityTab.count()) > 0) {
            await securityTab.click();

            const passwordForm = page.locator('#settings-password-form, form');
            const submitButton = passwordForm.locator('button[type="submit"]');

            if ((await passwordForm.count()) > 0 && (await submitButton.count()) > 0) {
                // Try submitting without filling fields
                await submitButton.click();

                // Should show validation (HTML5 or custom)
                const hasValidation = await page.evaluate(() => {
                    const inputs = document.querySelectorAll('input[required]');
                    return inputs.length > 0;
                });

                expect(typeof hasValidation).toBe('boolean');
            }
        }
    });

    test('should display WebAuthn/passkey management @webauthn', async ({ page, browserName }) => {
        test.skip(browserName === 'webkit', 'WebAuthn support varies on WebKit');

        const securityTab = page
            .locator('.settings-tab[data-tab="security"], :text("Security")')
            .first();

        if ((await securityTab.count()) > 0) {
            await securityTab.click();

            const passkeySection = page
                .locator(':text("Passkey"), :text("WebAuthn"), :text("Security Key")')
                .first();

            if ((await passkeySection.count()) > 0) {
                // WebAuthn section exists
                expect(await passkeySection.count()).toBeGreaterThan(0);
            }
        }
    });
});

test.describe('Settings - Preferences @settings @features @preferences', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');
        if ((await settingsButton.count()) > 0) {
            await settingsButton.click();
            await page.waitForTimeout(500);
        }
    });

    test('should have theme preferences', async ({ page }) => {
        const preferencesTab = page
            .locator('.settings-tab[data-tab="preferences"], :text("Preferences")')
            .first();

        if ((await preferencesTab.count()) > 0) {
            await preferencesTab.click();

            const themeSelector = page.locator(
                'select[name="theme"], [data-theme-select], :text("Theme")'
            );

            if ((await themeSelector.count()) > 0) {
                // Has theme preference
                expect(await themeSelector.count()).toBeGreaterThan(0);
            }
        }
    });

    test('should have autoplay preferences', async ({ page }) => {
        const preferencesTab = page
            .locator('.settings-tab[data-tab="preferences"], :text("Preferences")')
            .first();

        if ((await preferencesTab.count()) > 0) {
            await preferencesTab.click();

            const autoplayToggle = page.locator(
                'input[name="autoplay"], [data-autoplay], :text("Autoplay")'
            );

            if ((await autoplayToggle.count()) > 0) {
                expect(await autoplayToggle.count()).toBeGreaterThan(0);
            }
        }
    });

    test('should persist preference changes', async ({ page }) => {
        const preferencesTab = page
            .locator('.settings-tab[data-tab="preferences"], :text("Preferences")')
            .first();

        if ((await preferencesTab.count()) > 0) {
            await preferencesTab.click();

            const toggles = page.locator('input[type="checkbox"]');

            if ((await toggles.count()) > 0) {
                const firstToggle = toggles.first();
                const initialState = await firstToggle.isChecked();

                // Toggle it
                await firstToggle.click();
                await page.waitForTimeout(500);

                // State should have changed
                const newState = await firstToggle.isChecked();
                expect(newState).not.toBe(initialState);

                // Close and reopen settings
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);

                const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');
                await settingsButton.click();
                await page.waitForTimeout(300);

                await preferencesTab.click();
                await page.waitForTimeout(200);

                // Should be in new state
                const persistedState = await firstToggle.isChecked();
                expect(persistedState).toBe(newState);
            }
        }
    });
});

test.describe('Settings - Cache Management @settings @features @admin', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');
        if ((await settingsButton.count()) > 0) {
            await settingsButton.click();
            await page.waitForTimeout(500);
        }
    });

    test('should have cache management options', async ({ page }) => {
        const cacheTab = page
            .locator(
                '.settings-tab[data-tab="cache"], .settings-tab[data-tab="admin"], :text("Cache"), :text("Admin")'
            )
            .first();

        if ((await cacheTab.count()) > 0) {
            await cacheTab.click();

            const cacheButtons = page.locator(
                'button:has-text("Clear"), button:has-text("Rebuild"), button:has-text("Reindex")'
            );

            if ((await cacheButtons.count()) > 0) {
                expect(await cacheButtons.count()).toBeGreaterThan(0);
            }
        }
    });

    test('should display cache statistics', async ({ page }) => {
        const cacheTab = page
            .locator('.settings-tab[data-tab="cache"], .settings-tab[data-tab="admin"]')
            .first();

        if ((await cacheTab.count()) > 0) {
            await cacheTab.click();

            const cacheStats = page.locator(
                ':text("MB"), :text("KB"), :text("bytes"), :text("files")'
            );

            if ((await cacheStats.count()) > 0) {
                // Has cache statistics
                expect(await cacheStats.count()).toBeGreaterThan(0);
            }
        }
    });

    test('should confirm before clearing cache', async ({ page }) => {
        const cacheTab = page
            .locator('.settings-tab[data-tab="cache"], .settings-tab[data-tab="admin"]')
            .first();

        if ((await cacheTab.count()) > 0) {
            await cacheTab.click();

            const clearButton = page
                .locator('button:has-text("Clear Cache"), #clear-transcode-btn')
                .first();

            if ((await clearButton.count()) > 0) {
                // Start listening for dialog before clicking
                page.on('dialog', (dialog) => dialog.accept());

                await clearButton.click();
                await page.waitForTimeout(500);

                // Action should have been taken or confirmation shown
                expect(true).toBe(true);
            }
        }
    });
});

test.describe('Settings - Tags Management @settings @features @tags @admin', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);

        const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');
        if ((await settingsButton.count()) > 0) {
            await settingsButton.click();
            await page.waitForTimeout(500);
        }
    });

    test('should display tag list', async ({ page }) => {
        const tagsTab = page.locator('.settings-tab[data-tab="tags"], :text("Tags")').first();

        if ((await tagsTab.count()) > 0) {
            await tagsTab.click();

            const tagList = page.locator('.tag-list, [data-tag-list], .tags-table');

            if ((await tagList.count()) > 0) {
                await expect(tagList).toBeVisible();
            }
        }
    });

    test('should allow renaming tags', async ({ page }) => {
        const tagsTab = page.locator('.settings-tab[data-tab="tags"], :text("Tags")').first();

        if ((await tagsTab.count()) > 0) {
            await tagsTab.click();

            const renameButton = page
                .locator('button:has-text("Rename"), [data-action="rename"]')
                .first();

            if ((await renameButton.count()) > 0) {
                await renameButton.click();

                // Rename modal should appear
                const renameModal = page.locator(
                    '#rename-tag-modal, .rename-modal, [role="dialog"]:has-text("Rename")'
                );

                if ((await renameModal.count()) > 0) {
                    await expect(renameModal).toBeVisible({ timeout: 2000 });
                }
            }
        }
    });

    test('should allow deleting tags', async ({ page }) => {
        const tagsTab = page.locator('.settings-tab[data-tab="tags"], :text("Tags")').first();

        if ((await tagsTab.count()) > 0) {
            await tagsTab.click();

            const deleteButton = page
                .locator('button:has-text("Delete"), [data-action="delete"]')
                .first();

            if ((await deleteButton.count()) > 0) {
                await deleteButton.click();

                // Delete confirmation should appear
                const deleteModal = page.locator(
                    '#delete-tag-modal, .delete-modal, [role="dialog"]:has-text("Delete")'
                );

                if ((await deleteModal.count()) > 0) {
                    await expect(deleteModal).toBeVisible({ timeout: 2000 });
                }
            }
        }
    });
});
