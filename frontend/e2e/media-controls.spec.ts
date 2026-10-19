import { test, expect, type Page } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

// Needs a library with media (MEDIA_DIR=./sample-media locally; CI provides one).
// Tests skip themselves when the gallery has nothing to open.

test.use({
    storageState: STORAGE_STATE,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 }
});

// The ephemeral server indexes the library in the background, which can take a
// while on a cold start.
test.setTimeout(90_000);

async function openFirst(page: Page, type: 'image' | 'video'): Promise<boolean> {
    const item = page.locator(`[data-type="${type}"]`).first();
    for (let attempt = 0; attempt < 15; attempt++) {
        await page.goto('/');
        await page.waitForLoadState('load');
        if (await item.isVisible({ timeout: 2000 }).catch(() => false)) break;
        await page.waitForTimeout(2000);
    }
    if (!(await item.isVisible().catch(() => false))) return false;
    await item.tap();
    return await page
        .locator('.lightbox')
        .isVisible({ timeout: 8000 })
        .catch(() => false);
}

test('@smoke @lightbox a tap on an image dismisses the controls, and they stay dismissed', async ({
    page
}) => {
    if (!(await openFirst(page, 'image'))) test.skip();

    const lightbox = page.locator('.lightbox');
    await expect(lightbox).not.toHaveClass(/controls-hidden/);

    await page.locator('.lb-image').tap();
    await expect(lightbox).toHaveClass(/controls-hidden/);

    // Stepping to another item must not bring them back.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await expect(lightbox).toHaveClass(/controls-hidden/);

    // A tap restores them.
    const media = page.locator('.lb-image, .vp-video').first();
    await media.tap();
    await expect(lightbox).not.toHaveClass(/controls-hidden/);
});

test('@smoke @lightbox a tap on a video dismisses the player controls, even while paused', async ({
    page
}) => {
    if (!(await openFirst(page, 'video'))) test.skip();

    const player = page.locator('.vp').first();
    await expect(player).toBeVisible();
    const controls = player.locator('.vp-controls');

    // Tap an empty part of the surface: dead centre is the play/pause button.
    const box = (await player.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.3);
    await expect(controls).not.toHaveClass(/visible/);

    // ...and they stay dismissed when stepping to the next/previous item.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    await expect(page.locator('.lightbox')).toHaveClass(/controls-hidden/);
    const nextPlayer = page.locator('.vp .vp-controls').first();
    if (await nextPlayer.count()) await expect(nextPlayer).not.toHaveClass(/visible/);
});
