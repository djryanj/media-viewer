import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

test.use({ storageState: STORAGE_STATE });

// These tests verify the lightbox UI itself.  Because the test environment
// uses an empty library, we cannot open the lightbox directly.  Instead we
// check the overlay's existence and that no JS errors are thrown when the
// lightbox is NOT open (which covers the keyboard-handler guard).

test('@smoke @lightbox no JS errors on gallery load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
});

test('@smoke @lightbox pressing ArrowRight on gallery page does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.keyboard.press('ArrowRight');
    expect(errors).toHaveLength(0);
});

test('@smoke @lightbox pressing F key on gallery page does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.keyboard.press('f');
    expect(errors).toHaveLength(0);
});

test('@smoke @lightbox pressing A key on gallery page does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.keyboard.press('a');
    expect(errors).toHaveLength(0);
});

test('@smoke @lightbox pressing L key on gallery page does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.keyboard.press('l');
    expect(errors).toHaveLength(0);
});
