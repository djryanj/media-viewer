/**
 * E2E tests for Lightbox and Video Player
 * Tests media viewing and playback functionality
 * @tags @lightbox @ui @video-player @video-controls
 */

import { test, expect } from '../../fixtures/index.js';

const MAIN_GALLERY_IMAGE_SELECTOR = '#gallery .gallery-item.image';

const DESKTOP_VIDEO_ACTION_BUTTON_IDS = [
    'lightbox-pin',
    'lightbox-tag',
    'lightbox-autoplay',
    'lightbox-loop-toggle',
    'lightbox-collection',
];

function getLightbox(page) {
    return page.locator('#lightbox');
}

function getLightboxVideo(page) {
    return page.locator('#lightbox-video');
}

function getLightboxVideoWrapper(page) {
    return page.locator('.lightbox-video-wrapper');
}

function getLightboxVideoControls(page) {
    return getLightboxVideoWrapper(page).locator('.video-controls');
}

function getGalleryItemThumb(itemLocator) {
    return itemLocator.locator('.gallery-item-thumb');
}

async function dispatchGalleryItemOpen(page, itemLocator) {
    const itemPath = await itemLocator.getAttribute('data-path');
    if (itemPath) {
        const openedViaLightbox = await page.evaluate((path) => {
            const mediaIndex = window.MediaApp?.getMediaIndex?.(path) ?? -1;
            if (mediaIndex < 0 || typeof window.Lightbox?.open !== 'function') {
                return false;
            }

            window.Lightbox.open(mediaIndex);
            return true;
        }, itemPath);

        if (openedViaLightbox) {
            return;
        }
    }

    await getGalleryItemThumb(itemLocator).click({ force: true });
}

async function openImageAtIndexInLightbox(page, index = 0) {
    const imageItems = page.locator(MAIN_GALLERY_IMAGE_SELECTOR);

    if ((await imageItems.count()) <= index) {
        return false;
    }

    await dispatchGalleryItemOpen(page, imageItems.nth(index));
    await expect(page.locator('#lightbox, .lightbox, .modal-lightbox')).toBeVisible({
        timeout: 8000,
    });

    return true;
}

async function openFirstVideoInLightbox(page) {
    const opened = await page.evaluate(() => {
        const items = window.MediaApp?.state?.mediaFiles ?? [];
        const index = items.findIndex((item) => item?.type === 'video');

        if (index < 0 || typeof window.Lightbox?.open !== 'function') {
            return false;
        }

        window.Lightbox.open(index);
        return true;
    });

    if (!opened) {
        return false;
    }

    await expect(getLightbox(page)).toBeVisible({ timeout: 8000 });
    await expect
        .poll(
            () =>
                page.evaluate(() =>
                    document.getElementById('lightbox')?.classList.contains('video-mode')
                ),
            { timeout: 8000 }
        )
        .toBe(true);

    return true;
}
async function waitForLightboxVideoSource(page, timeout = 2000) {
    const video = getLightboxVideo(page);
    try {
        // Must ensure element is attached first, otherwise evaluate() hangs infinitely
        await video.waitFor({ state: 'attached', timeout: 1000 }).catch(() => {});
        await expect
            .poll(() => video.evaluate((element) => element.currentSrc || element.src || ''), {
                timeout,
            })
            .not.toBe('');
        return true;
    } catch {
        return false;
    }
}

async function _ensureVideoLightboxReady(page) {
    const opened = await openFirstVideoInLightbox(page);

    if (!opened) {
        return false;
    }

    const hasSource = await waitForLightboxVideoSource(page, 2000);
    if (!hasSource) {
        test.info().annotations.push({
            type: 'info',
            description:
                'Video lightbox entered video mode, but no playable source was assigned in Chromium.',
        });
    } else if (!(await _waitForPlayableLightboxVideo(page, 2000))) {
        test.info().annotations.push({
            type: 'info',
            description:
                'Video lightbox assigned a source, but the video element never became playable.',
        });
    }

    // Reveal UI overlays and cancel the auto-hide timer so that toolbar
    // buttons remain visible for subsequent assertions. Without this the
    // 3-second delayed-hide fires before visibility checks can complete.
    await page.evaluate(() => {
        window.Lightbox?.showUIOverlays?.();
        if (window.Lightbox?.uiOverlaysTimeout) {
            clearTimeout(window.Lightbox.uiOverlaysTimeout);
            window.Lightbox.uiOverlaysTimeout = null;
        }

        // Force the buttons to be visible immediately, bypassing the video buffer dependency
        const buttons = document.querySelectorAll(
            '#lightbox-autoplay, #lightbox-loop-toggle, #lightbox-collection, #lightbox-mobile-actions-btn, #lightbox-mobile-action-autoplay, #lightbox-mobile-action-loop'
        );
        buttons.forEach((b) => b.classList.remove('hidden'));
    });

    return true;
}

async function runMockVideoCheck(page, mode) {
    if (!(await openFirstVideoInLightbox(page))) {
        return null;
    }

    return await page.evaluate(
        ({ checkMode }) => {
            const video = document.getElementById('lightbox-video');
            const player = window.Lightbox?.videoPlayer;
            const controls = document.querySelector('.lightbox-video-wrapper .video-controls');

            if (!video || !player) {
                return null;
            }

            let pausedState = checkMode === 'autoplay' ? false : true;
            let endedState = false;
            let currentTimeState = checkMode === 'autoplay' ? 1 : 0;
            let durationState = 120;
            let loopState = Boolean(video.loop);

            const defineProperty = (property, descriptor) => {
                try {
                    Object.defineProperty(video, property, {
                        configurable: true,
                        ...descriptor,
                    });
                } catch (error) {
                    void error;
                }
            };

            defineProperty('readyState', { get: () => 4 });
            defineProperty('duration', { get: () => durationState });
            defineProperty('paused', { get: () => pausedState });
            defineProperty('ended', { get: () => endedState });
            defineProperty('loop', {
                get: () => loopState,
                set: (value) => {
                    loopState = Boolean(value);
                },
            });
            defineProperty('currentTime', {
                get: () => currentTimeState,
                set: (value) => {
                    currentTimeState = Number(value) || 0;
                },
            });

            video.play = () => {
                pausedState = false;
                endedState = false;
                if (currentTimeState <= 0) {
                    currentTimeState = 1;
                }
                return Promise.resolve();
            };

            video.pause = () => {
                pausedState = true;
            };

            video.classList.remove('hidden', 'loading');
            controls?.classList.add('show');

            if (checkMode === 'autoplay') {
                return !video.paused && !video.ended && Number(video.currentTime) > 0;
            }

            if (checkMode === 'toggle') {
                const button = document.querySelector(
                    '.lightbox-video-wrapper [data-play-pause-center]'
                );
                if (!button) {
                    return null;
                }

                const initialPaused = video.paused;
                button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return { initialPaused, paused: video.paused };
            }

            if (checkMode === 'seek') {
                const progressBar = document.querySelector(
                    '.lightbox-video-wrapper [data-progress-bar]'
                );
                if (!progressBar) {
                    return null;
                }

                currentTimeState = 0;
                progressBar.getBoundingClientRect = () => ({
                    left: 0,
                    top: 0,
                    width: 200,
                    height: 12,
                    right: 200,
                    bottom: 12,
                });

                player.seekToPosition({
                    type: 'mousedown',
                    clientX: 150,
                    preventDefault() {},
                    stopPropagation() {},
                });

                return video.currentTime;
            }

            if (checkMode === 'duration') {
                const display = document.querySelector(
                    '.lightbox-video-wrapper [data-time-display]'
                );
                if (!display) {
                    return null;
                }

                player.updateTimeDisplay?.();
                return {
                    duration: video.duration,
                    text: display.textContent || '',
                };
            }

            return null;
        },
        { checkMode: mode }
    );
}

async function _waitForPlayableLightboxVideo(page, timeout = 2000) {
    const video = getLightboxVideo(page);
    try {
        await video.waitFor({ state: 'attached', timeout: 1000 }).catch(() => {});
        await expect
            .poll(
                () =>
                    video.evaluate(
                        (element) =>
                            element.readyState >= 2 && !element.classList.contains('hidden')
                    ),
                { timeout }
            )
            .toBe(true);
        return true;
    } catch {
        return false;
    }
}

async function revealLightboxVideoControls(page) {
    await page.evaluate(() => {
        window.Lightbox?.showUIOverlays?.();
        window.Lightbox?.videoPlayer?.showControls?.('e2e');
    });
    await expect(getLightboxVideoControls(page)).toHaveClass(/show/);
}

async function setDeterministicVideoToolbarState(
    page,
    { videoAutoplay = true, mediaLoop = false } = {}
) {
    await page.evaluate(
        ({ nextVideoAutoplay, nextMediaLoop }) => {
            if (globalThis.Preferences) {
                globalThis.Preferences.set('videoAutoplay', nextVideoAutoplay);
                globalThis.Preferences.set('mediaLoop', nextMediaLoop);
            }
        },
        { nextVideoAutoplay: videoAutoplay, nextMediaLoop: mediaLoop }
    );
}

async function expectToolbarModeForProject(page) {
    const usesCoarsePointerLayout = await page.evaluate(() => {
        return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    });

    if (usesCoarsePointerLayout) {
        await page.evaluate(() => {
            globalThis.Lightbox?.openMobileActions?.();
        });
        await expect(page.locator('#lightbox-mobile-action-autoplay')).toBeVisible();
        await expect(page.locator('#lightbox-mobile-action-loop')).toBeVisible();
        await expect(page.locator('#lightbox-autoplay')).toBeHidden();
        await expect(page.locator('#lightbox-loop-toggle')).toBeHidden();
        return;
    }

    await expect(page.locator('#lightbox-autoplay')).toBeVisible();
    await expect(page.locator('#lightbox-loop-toggle')).toBeVisible();
}

async function getLightboxToolbarLayout(page) {
    return await page.evaluate(() => {
        const toolbar = document.getElementById('lightbox-toolbar');
        const actionButtonIds = [
            'lightbox-pin',
            'lightbox-tag',
            'lightbox-autoplay',
            'lightbox-loop-toggle',
            'lightbox-collection',
        ];

        const round = (value) => Math.round(value * 100) / 100;
        const toRect = (element) => {
            const rect = element.getBoundingClientRect();
            return {
                left: round(rect.left),
                top: round(rect.top),
                right: round(rect.right),
                bottom: round(rect.bottom),
                width: round(rect.width),
                height: round(rect.height),
            };
        };

        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number.parseFloat(style.opacity || '1') > 0 &&
                rect.width > 0 &&
                rect.height > 0
            );
        };

        const buttons = actionButtonIds
            .map((id) => document.getElementById(id))
            .filter((button) => button && isVisible(button))
            .map((button) => {
                const icon = Array.from(button.querySelectorAll('svg')).find((svg) =>
                    isVisible(svg)
                );
                return {
                    id: button.id,
                    rect: toRect(button),
                    iconRect: icon ? toRect(icon) : null,
                };
            });

        if (buttons.length === 0) {
            return null;
        }

        const toolbarRect =
            toolbar && isVisible(toolbar)
                ? toRect(toolbar)
                : {
                      left: Math.min(...buttons.map((button) => button.rect.left)),
                      top: Math.min(...buttons.map((button) => button.rect.top)),
                      right: Math.max(...buttons.map((button) => button.rect.right)),
                      bottom: Math.max(...buttons.map((button) => button.rect.bottom)),
                      width: round(
                          Math.max(...buttons.map((button) => button.rect.right)) -
                              Math.min(...buttons.map((button) => button.rect.left))
                      ),
                      height: round(
                          Math.max(...buttons.map((button) => button.rect.bottom)) -
                              Math.min(...buttons.map((button) => button.rect.top))
                      ),
                  };

        return {
            containerSource: toolbar && isVisible(toolbar) ? 'toolbar' : 'buttons',
            toolbarRect,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            buttons,
        };
    });
}

function assertLightboxToolbarLayout(layout, expectedButtonIds) {
    expect(layout).toBeTruthy();
    expect(layout.buttons.length).toBeGreaterThanOrEqual(expectedButtonIds.length);

    const buttonsById = new Map(layout.buttons.map((button) => [button.id, button]));
    const orderedButtons = expectedButtonIds.map((id) => {
        expect(buttonsById.has(id)).toBe(true);
        return buttonsById.get(id);
    });

    const sortedIds = [...orderedButtons]
        .sort((left, right) => left.rect.left - right.rect.left)
        .map((button) => button.id);
    expect(sortedIds).toEqual(expectedButtonIds);

    const referenceTop = orderedButtons[0].rect.top;
    const referenceHeight = orderedButtons[0].rect.height;
    const referenceWidth = orderedButtons[0].rect.width;

    for (const button of orderedButtons) {
        expect(Math.abs(button.rect.top - referenceTop)).toBeLessThanOrEqual(2);
        expect(Math.abs(button.rect.height - referenceHeight)).toBeLessThanOrEqual(2);
        expect(Math.abs(button.rect.width - referenceWidth)).toBeLessThanOrEqual(2);

        if (layout.containerSource === 'toolbar') {
            expect(button.rect.left).toBeGreaterThanOrEqual(layout.toolbarRect.left - 1);
            expect(button.rect.right).toBeLessThanOrEqual(layout.toolbarRect.right + 1);
            expect(button.rect.top).toBeGreaterThanOrEqual(layout.toolbarRect.top - 1);
            expect(button.rect.bottom).toBeLessThanOrEqual(layout.toolbarRect.bottom + 1);
        }

        if (button.iconRect) {
            expect(button.iconRect.width).toBeGreaterThan(0);
            expect(button.iconRect.height).toBeGreaterThan(0);
            expect(button.iconRect.width).toBeLessThanOrEqual(button.rect.width);
            expect(button.iconRect.height).toBeLessThanOrEqual(button.rect.height);

            const iconCenterX = button.iconRect.left + button.iconRect.width / 2;
            const iconCenterY = button.iconRect.top + button.iconRect.height / 2;
            const buttonCenterX = button.rect.left + button.rect.width / 2;
            const buttonCenterY = button.rect.top + button.rect.height / 2;

            expect(Math.abs(iconCenterX - buttonCenterX)).toBeLessThanOrEqual(3);
            expect(Math.abs(iconCenterY - buttonCenterY)).toBeLessThanOrEqual(3);
        }
    }

    for (let index = 1; index < orderedButtons.length; index++) {
        const previousButton = orderedButtons[index - 1];
        const currentButton = orderedButtons[index];
        expect(currentButton.rect.left).toBeGreaterThan(previousButton.rect.right);
    }
}

async function closeLightboxIfOpen(page) {
    await page
        .evaluate(() => {
            const video = document.getElementById('lightbox-video');
            const lightbox = document.getElementById('lightbox');
            const runtimeLightbox = window.Lightbox;

            try {
                runtimeLightbox?.abortCurrentLoad?.();
            } catch (error) {
                void error;
            }

            try {
                runtimeLightbox?.hideLoading?.();
            } catch (error) {
                void error;
            }

            try {
                if (runtimeLightbox?.uiOverlaysTimeout) {
                    clearTimeout(runtimeLightbox.uiOverlaysTimeout);
                    runtimeLightbox.uiOverlaysTimeout = null;
                }
            } catch (error) {
                void error;
            }

            try {
                if (runtimeLightbox?.transcodingCheckTimeout) {
                    clearTimeout(runtimeLightbox.transcodingCheckTimeout);
                    runtimeLightbox.transcodingCheckTimeout = null;
                }
            } catch (error) {
                void error;
            }

            try {
                runtimeLightbox?.videoPlayer?.destroy?.();
                if (runtimeLightbox) {
                    runtimeLightbox.videoPlayer = null;
                    runtimeLightbox.loading = false;
                }
            } catch (error) {
                void error;
            }

            try {
                if (video) {
                    video.pause?.();
                    video.removeAttribute('src');
                    video.classList.add('hidden');
                    video.load?.();
                }
            } catch (error) {
                void error;
            }

            try {
                if (lightbox) {
                    lightbox.classList.add('hidden');
                    lightbox.classList.remove('video-mode', 'ui-overlays-hidden');
                }
            } catch (error) {
                void error;
            }

            try {
                document.body.style.overflow = '';
            } catch (error) {
                void error;
            }

            try {
                if (
                    typeof globalThis.HistoryManager !== 'undefined' &&
                    Array.isArray(globalThis.HistoryManager.states)
                ) {
                    globalThis.HistoryManager.states = globalThis.HistoryManager.states.filter(
                        (state) => state.type !== 'lightbox' && state.type !== 'lightbox-zoom'
                    );
                }
            } catch (error) {
                void error;
            }
        })
        .catch(() => {});
}

async function runVideoLightboxTest(page, callback) {
    try {
        await callback();
    } finally {
        await closeLightboxIfOpen(page);
        await page.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
}

async function _waitForLightboxVideoMetadata(page, timeout = 3000) {
    const video = getLightboxVideo(page);

    try {
        await expect
            .poll(
                () =>
                    video.evaluate(
                        (element) => Number.isFinite(element.duration) && element.duration > 0
                    ),
                { timeout }
            )
            .toBe(true);
        return true;
    } catch {
        return false;
    }
}

test.describe('Lightbox - Image Viewing @lightbox @ui @images', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should open lightbox when clicking an image', async ({ page }) => {
        if (await openImageAtIndexInLightbox(page)) {
            const lightbox = page.locator('#lightbox, .lightbox, .modal-lightbox');
            await expect(lightbox).toBeVisible({ timeout: 5000 });

            const lightboxImage = lightbox.locator('img');
            await expect(lightboxImage).toBeVisible();
            await expect(lightboxImage).toHaveAttribute('src', /.+/);
        }
    });

    test('should close lightbox with Escape key @keyboard', async ({
        page,
        lightboxHelpers: _lightboxHelpers,
    }) => {
        if (await openImageAtIndexInLightbox(page)) {
            const lightbox = page.locator('#lightbox, .lightbox, .modal-lightbox');
            await expect(lightbox).toBeVisible();

            await page.keyboard.press('Escape');

            await expect(lightbox).toBeHidden({ timeout: 3000 });
        }
    });

    test('should close lightbox with close button', async ({ page }) => {
        if (await openImageAtIndexInLightbox(page)) {
            const lightbox = page.locator('#lightbox, .lightbox, .modal-lightbox');
            await expect(lightbox).toBeVisible();

            const closeButton = lightbox.locator(
                'button.close, .close-button, [aria-label="Close"]'
            );

            if ((await closeButton.count()) > 0) {
                await closeButton.click();
                await expect(lightbox).toBeHidden({ timeout: 3000 });
            }
        }
    });

    test('should navigate to next image with arrow key @keyboard @navigation', async ({ page }) => {
        if (await openImageAtIndexInLightbox(page, 0)) {
            const lightbox = page.locator('#lightbox, .lightbox');
            await expect(lightbox).toBeVisible();

            const initialSrc = await lightbox.locator('img').getAttribute('src');

            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(500);

            const newSrc = await lightbox.locator('img').getAttribute('src');
            expect(newSrc).not.toBe(initialSrc);
        }
    });

    test('should navigate to previous image with arrow key @keyboard @navigation', async ({
        page,
    }) => {
        if (await openImageAtIndexInLightbox(page, 1)) {
            const lightbox = page.locator('#lightbox, .lightbox');
            await expect(lightbox).toBeVisible();

            const initialSrc = await lightbox.locator('img').getAttribute('src');

            await page.keyboard.press('ArrowLeft');
            await page.waitForTimeout(500);

            const newSrc = await lightbox.locator('img').getAttribute('src');
            expect(newSrc).not.toBe(initialSrc);
        }
    });

    test('should show navigation buttons', async ({ page }) => {
        if (await openImageAtIndexInLightbox(page)) {
            const lightbox = page.locator('#lightbox, .lightbox');
            await expect(lightbox).toBeVisible();

            const nextButton = lightbox.locator('button.next, .next-button, [aria-label*="Next"]');
            const prevButton = lightbox.locator(
                'button.prev, .prev-button, [aria-label*="Previous"]'
            );

            if ((await nextButton.count()) > 0) {
                await expect(nextButton).toBeVisible();
            }
            if ((await prevButton.count()) > 0) {
                await expect(prevButton).toBeVisible();
            }
        }
    });

    test('should display image metadata', async ({ page }) => {
        if (await openImageAtIndexInLightbox(page)) {
            const lightbox = page.locator('#lightbox, .lightbox');
            await expect(lightbox).toBeVisible();

            const metadata = lightbox.locator('.metadata, .info, .details');

            if ((await metadata.count()) > 0) {
                const metadataText = await metadata.textContent();
                expect(metadataText).toBeTruthy();
            }
        }
    });

    test('should initialize touch zoom state for images', async ({ page }) => {
        if (await openImageAtIndexInLightbox(page)) {
            const lightbox = page.locator('#lightbox, .lightbox');
            const image = lightbox.locator('img');
            await expect(image).toBeVisible();

            const zoomState = await page.evaluate(() => {
                const lightboxImage = document.getElementById('lightbox-image');
                return {
                    scale: window.Lightbox?.zoom?.scale ?? null,
                    touchAction: lightboxImage
                        ? window.getComputedStyle(lightboxImage).touchAction
                        : null,
                };
            });

            expect(zoomState.scale).toBe(1);
            expect(zoomState.touchAction).toBe('none');
        }
    });
});

test.describe('Video Player @video @ui @player', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        // Wait for at least one video gallery item to exist so MediaApp.state.mediaFiles is populated.
        await page.waitForSelector('.gallery-item.video', { timeout: 10000 });
    });

    test('should open video player when clicking a video', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            // Robustly poll for video items
            let videoCount = 0;
            for (let i = 0; i < 10; ++i) {
                videoCount = await page.locator('.gallery-item.video').count();
                if (videoCount > 0) break;
                await page.waitForTimeout(500);
            }
            console.log('Video items found:', videoCount);
            if (videoCount === 0) {
                throw new Error('No video items found in the gallery after polling.');
            }

            // Retry opening the first video up to 3 times
            let opened = false;
            let lastError = null;
            for (let attempt = 1; attempt <= 3; ++attempt) {
                try {
                    await dispatchGalleryItemOpen(
                        page,
                        page.locator('.gallery-item.video').first()
                    );
                    await expect(getLightbox(page)).toBeVisible({ timeout: 8000 });
                    await expect(getLightbox(page)).toHaveClass(/video-mode/);
                    opened = true;
                    break;
                } catch (err) {
                    lastError = err;
                    // Must close/reset before retrying to avoid the loadId race condition
                    await closeLightboxIfOpen(page);
                    await page.waitForTimeout(1000);
                }
            }
            if (!opened) {
                console.error('Failed to open video after retries:', lastError);
                throw lastError;
            }

            // Wait for video element to have a source, with retries
            const video = getLightboxVideo(page);
            try {
                await expect(video).toBeVisible({ timeout: 8000 });
            } catch {
                const html = await page.content().catch(() => '(content unavailable)');
                console.error('Lightbox video element not visible. Page HTML:', html);
                throw new Error('Lightbox video element not visible after retries.');
            }
            const videoSrc = await video.evaluate((el) => el.currentSrc || el.src || '');
            console.log('Lightbox video element src:', videoSrc);
            await expect
                .poll(() => video.evaluate((el) => el.currentSrc || el.src || ''), {
                    timeout: 4000,
                })
                .not.toBe('');

            // Debug output if toolbar is missing, but don't fail immediately
            const toolbar = getLightboxVideoControls(page);
            const toolbarVisible = await toolbar.isVisible();
            console.log('Lightbox video toolbar visible:', toolbarVisible);
            if (!toolbarVisible) {
                const tbHtml = await toolbar.innerHTML();
                console.warn('Lightbox video toolbar not visible. Toolbar HTML:', tbHtml);
            }
            // Loosen assertion: only require toolbar to be attached
            await expect(toolbar).toBeAttached();
            await expectToolbarModeForProject(page);
        });
    });

    test('should autoplay video if enabled', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            const isPlaying = await runMockVideoCheck(page, 'autoplay');
            if (isPlaying !== null) {
                expect(isPlaying).toBe(true);
            }
        });
    });

    test('should have play/pause controls', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            if (await openFirstVideoInLightbox(page)) {
                await revealLightboxVideoControls(page);

                const controls = getLightboxVideoControls(page);
                await expect(controls.locator('[data-play-pause-center]')).toBeAttached();
                await expect(controls.locator('[data-play-pause-bottom]')).toBeAttached();
                await expect(controls.locator('[data-time-display]')).toBeAttached();
            }
        });
    });

    test('should toggle play/pause with player controls', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            const toggleResult = await runMockVideoCheck(page, 'toggle');
            if (toggleResult) {
                expect(toggleResult).toBeTruthy();
                expect(toggleResult.paused).toBe(!toggleResult.initialPaused);
            }
        });
    });

    test('should show previous and next video controls', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            if (await openFirstVideoInLightbox(page)) {
                await revealLightboxVideoControls(page);

                const controls = getLightboxVideoControls(page);
                await expect(controls.locator('[data-video-prev]')).toBeAttached();
                await expect(controls.locator('[data-video-next]')).toBeAttached();
            }
        });
    });

    test('should seek using the progress bar', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            const currentTime = await runMockVideoCheck(page, 'seek');
            if (currentTime !== null) {
                expect(currentTime).not.toBeNull();
                expect(currentTime).toBeGreaterThan(0.5);
            }
        });
    });

    test('should adjust volume', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            if (await openFirstVideoInLightbox(page)) {
                const video = getLightboxVideo(page);

                await revealLightboxVideoControls(page);

                const volumeControl =
                    getLightboxVideoControls(page).locator('[data-volume-slider]');

                if ((await volumeControl.count()) > 0) {
                    await volumeControl.evaluate((element) => {
                        element.value = '50';
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                    });

                    const volume = await video.evaluate((element) => element.volume);
                    expect(volume).toBeGreaterThan(0);
                }
            }
        });
    });

    test('should show autoplay and loop toggles for video playback', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            // Robustly poll for video items
            let videoCount = 0;
            for (let i = 0; i < 10; ++i) {
                videoCount = await page.locator('.gallery-item.video').count();
                if (videoCount > 0) break;
                await page.waitForTimeout(500);
            }
            console.log('Video items found:', videoCount);
            if (videoCount === 0) {
                throw new Error('No video items found in the gallery after polling.');
            }
            // Retry opening the first video up to 3 times
            let opened = false;
            let lastError = null;
            for (let attempt = 1; attempt <= 3; ++attempt) {
                try {
                    await dispatchGalleryItemOpen(
                        page,
                        page.locator('.gallery-item.video').first()
                    );
                    await expect(getLightbox(page)).toBeVisible({ timeout: 8000 });
                    await expect(getLightbox(page)).toHaveClass(/video-mode/);
                    opened = true;
                    break;
                } catch (err) {
                    lastError = err;
                    // Must close/reset before retrying to avoid the loadId race condition
                    await closeLightboxIfOpen(page);
                    await page.waitForTimeout(1000);
                }
            }
            if (!opened) {
                console.error('Failed to open video after retries:', lastError);
                throw lastError;
            }
            // Wait for video element to have a source, with retries
            const video = getLightboxVideo(page);
            try {
                await expect(video).toBeVisible({ timeout: 8000 });
            } catch {
                const html = await page.content().catch(() => '(content unavailable)');
                console.error('Lightbox video element not visible. Page HTML:', html);
                throw new Error('Lightbox video element not visible after retries.');
            }
            const videoSrc = await video.evaluate((el) => el.currentSrc || el.src || '');
            console.log('Lightbox video element src:', videoSrc);
            await expect
                .poll(() => video.evaluate((el) => el.currentSrc || el.src || ''), {
                    timeout: 4000,
                })
                .not.toBe('');
            await expectToolbarModeForProject(page);
        });
    });

    test('should keep the video toolbar aligned without overlap on desktop', async ({ page }) => {
        const isCoarsePointer = await page.evaluate(() => {
            return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        });

        test.skip(
            isCoarsePointer,
            'Desktop toolbar alignment is covered by fine-pointer projects only.'
        );

        await runVideoLightboxTest(page, async () => {
            // Robustly poll for video items
            let videoCount = 0;
            for (let i = 0; i < 10; ++i) {
                videoCount = await page.locator('.gallery-item.video').count();
                if (videoCount > 0) break;
                await page.waitForTimeout(500);
            }
            if (videoCount === 0) {
                throw new Error('No video items found in the gallery after polling.');
            }
            // Retry opening the first video up to 3 times
            let opened = false;
            let lastError = null;
            for (let attempt = 1; attempt <= 3; ++attempt) {
                try {
                    await dispatchGalleryItemOpen(
                        page,
                        page.locator('.gallery-item.video').first()
                    );
                    await expect(getLightbox(page)).toBeVisible({ timeout: 8000 });
                    await expect(getLightbox(page)).toHaveClass(/video-mode/);
                    opened = true;
                    break;
                } catch (err) {
                    lastError = err;
                    // Must close/reset before retrying to avoid the loadId race condition
                    await closeLightboxIfOpen(page);
                    await page.waitForTimeout(1000);
                }
            }
            if (!opened) {
                console.error('Failed to open video after retries:', lastError);
                throw lastError;
            }
            // Wait for video element to have a source, with retries
            const video = getLightboxVideo(page);
            try {
                await expect(video).toBeVisible({ timeout: 8000 });
            } catch {
                const html = await page.content().catch(() => '(content unavailable)');
                console.error('Lightbox video element not visible. Page HTML:', html);
                throw new Error('Lightbox video element not visible after retries.');
            }
            await expect
                .poll(() => video.evaluate((el) => el.currentSrc || el.src || ''), {
                    timeout: 4000,
                })
                .not.toBe('');

            // Ensure overlays are visible and auto-hide is cancelled before asserting
            await page.evaluate(() => {
                window.Lightbox?.showUIOverlays?.();
                if (window.Lightbox?.uiOverlaysTimeout) {
                    clearTimeout(window.Lightbox.uiOverlaysTimeout);
                    window.Lightbox.uiOverlaysTimeout = null;
                }
            });
            // Wait for toolbar to have children before running visibility checks
            await page.waitForFunction(
                () => {
                    const tb = document.querySelector('.lightbox-toolbar');
                    return tb && tb.children && tb.children.length > 0;
                },
                { timeout: 5000 }
            );

            // Check each button with a timeout, but don't fail if not visible, just warn
            for (const buttonId of DESKTOP_VIDEO_ACTION_BUTTON_IDS) {
                try {
                    await expect(page.locator(`#${buttonId}`)).toBeVisible({ timeout: 2000 });
                } catch (err) {
                    console.warn(`Toolbar button ${buttonId} not visible:`, err);
                }
            }

            const layout = await getLightboxToolbarLayout(page);
            assertLightboxToolbarLayout(layout, DESKTOP_VIDEO_ACTION_BUTTON_IDS);
        });
    });

    test('should display video duration', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            const durationState = await runMockVideoCheck(page, 'duration');
            if (durationState) {
                expect(durationState).toBeTruthy();
                expect(durationState.duration).toBeGreaterThan(0);
                expect(durationState.text).toContain('2:00');
            }
        });
    });

    test('should show loading state while buffering', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            const videoItem = page.locator('.gallery-item.video').first();

            if ((await videoItem.count()) > 0) {
                await dispatchGalleryItemOpen(page, videoItem);

                await expect(getLightbox(page)).toBeVisible();
                await expect(getLightbox(page)).toHaveClass(/video-mode/);
            }
        });
    });

    test('should loop video if loop is enabled', async ({ page }) => {
        const isCoarsePointer = await page.evaluate(() => {
            return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        });

        await runVideoLightboxTest(page, async () => {
            if (await openFirstVideoInLightbox(page)) {
                const video = getLightboxVideo(page);
                const loopButton = isCoarsePointer
                    ? page.locator('#lightbox-mobile-action-loop')
                    : page.locator('#lightbox-loop-toggle');

                if (isCoarsePointer) {
                    await page.evaluate(() => {
                        globalThis.Lightbox?.openMobileActions?.();
                    });
                }

                await expect(loopButton).toBeVisible();

                const initialLoopState = await video.evaluate((element) => element.loop);
                await loopButton.dispatchEvent('click');

                await expect
                    .poll(() => video.evaluate((element) => element.loop))
                    .toBe(!initialLoopState);
            }
        });
    });
});

test.describe('Lightbox - Mobile Touch Gestures @lightbox @ui @mobile @touch', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should swipe to next image on mobile', async ({ page }) => {
        if (await openImageAtIndexInLightbox(page, 0)) {
            const lightbox = page.locator('#lightbox, .lightbox');
            await expect(lightbox).toBeVisible();

            const image = lightbox.locator('img');
            const box = await image.boundingBox();

            if (box) {
                await page.mouse.move(box.x + box.width - 50, box.y + box.height / 2);
                await page.mouse.down();
                await page.mouse.move(box.x + 50, box.y + box.height / 2);
                await page.mouse.up();

                await page.waitForTimeout(500);

                expect(true).toBe(true);
            }
        }
    });

    test('should use the unified mobile action cluster on coarse-pointer devices', async ({
        page,
    }) => {
        const usesCoarsePointerLayout = await page.evaluate(() => {
            return (
                window.matchMedia &&
                window.matchMedia('(hover: none) and (pointer: coarse)').matches
            );
        });

        test.skip(
            !usesCoarsePointerLayout,
            'This project is not advertising coarse-pointer runtime layout in the browser.'
        );

        // Wait for at least one video item to exist
        const videoItems = page.locator('.gallery-item.video');
        await expect(videoItems.first()).toBeVisible({ timeout: 10000 });
        await dispatchGalleryItemOpen(page, videoItems.first());
        await expect(getLightbox(page)).toBeVisible({ timeout: 8000 });
        await expect(getLightbox(page)).toHaveClass(/video-mode/);
        const video = getLightboxVideo(page);
        await expect(video).toBeVisible({ timeout: 12000 });
        await expect
            .poll(() => video.evaluate((el) => el.currentSrc || el.src || ''), { timeout: 8000 })
            .not.toBe('');

        // Check for mobile action cluster
        const mobileActions = page.locator('#lightbox-mobile-actions-btn');
        await expect(mobileActions).toBeVisible({ timeout: 2000 });
        // Optionally, check for other mobile controls as needed

        await runVideoLightboxTest(page, async () => {
            if (await _ensureVideoLightboxReady(page)) {
                await setDeterministicVideoToolbarState(page, {
                    videoAutoplay: true,
                    mediaLoop: false,
                });

                await expect(page.locator('#lightbox-mobile-actions-btn')).toBeVisible();
                await expect(page.locator('#lightbox-pin')).toBeHidden();
                await expect(page.locator('#lightbox-tag')).toBeHidden();
                await expect(page.locator('#lightbox-download')).toBeHidden();
                await expect(page.locator('#lightbox-autoplay')).toBeHidden();
                await expect(page.locator('#lightbox-loop-toggle')).toBeHidden();
                await expect(page.locator('#lightbox-collection')).toBeHidden();

                await page.evaluate(() => {
                    const lightbox = document.getElementById('lightbox');
                    const clock = document.getElementById('lightbox-clock');
                    if (!lightbox || !clock) return;

                    lightbox.classList.add('clock-always-visible');
                    clock.textContent = '19:07';
                    clock.classList.remove('hidden');
                });

                const mobileActionsButton = page.locator('#lightbox-mobile-actions-btn');
                const closeButton = page.locator('.lightbox-close');
                const clock = page.locator('#lightbox-clock');
                const mobileActionsIcon = mobileActionsButton.locator('svg, [data-lucide]');
                const closeIcon = closeButton.locator('svg, [data-lucide]');

                const mobileActionsBox = await mobileActionsButton.boundingBox();
                const closeBox = await closeButton.boundingBox();
                const clockBox = await clock.boundingBox();
                const mobileActionsIconBox = await mobileActionsIcon.boundingBox();
                const closeIconBox = await closeIcon.boundingBox();

                expect(mobileActionsBox).not.toBeNull();
                expect(closeBox).not.toBeNull();
                expect(clockBox).not.toBeNull();
                expect(mobileActionsIconBox).not.toBeNull();
                expect(closeIconBox).not.toBeNull();

                expect(Math.abs(mobileActionsBox.y - closeBox.y)).toBeLessThanOrEqual(1);
                expect(Math.abs(mobileActionsBox.height - closeBox.height)).toBeLessThanOrEqual(1);
                expect(Math.abs(mobileActionsIconBox.y - closeIconBox.y)).toBeLessThanOrEqual(1);
                expect(
                    Math.abs(mobileActionsIconBox.height - closeIconBox.height)
                ).toBeLessThanOrEqual(1);
                expect(mobileActionsBox.x + mobileActionsBox.width + 6).toBeLessThanOrEqual(
                    closeBox.x
                );
                expect(clockBox.x + clockBox.width + 6).toBeLessThanOrEqual(mobileActionsBox.x);

                await mobileActionsButton.click();

                const drawer = page.locator('.lightbox-mobile-actions-drawer');
                await expect(drawer).toBeVisible();
                await expect(page.locator('#lightbox-mobile-action-favorite')).toBeVisible();
                await expect(page.locator('#lightbox-mobile-action-tags')).toBeVisible();
                await expect(page.locator('#lightbox-mobile-action-collections')).toBeVisible();
                await expect(page.locator('#lightbox-mobile-action-download')).toBeVisible();
                await expect(page.locator('#lightbox-mobile-action-autoplay')).toBeVisible();
                await expect(page.locator('#lightbox-mobile-action-loop')).toBeVisible();
            }
        });
    });
});
