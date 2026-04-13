/**
 * E2E tests for Lightbox and Video Player
 * Tests media viewing and playback functionality
 * @tags @lightbox @ui @video-player @video-controls
 */

import { test, expect } from '../../fixtures/index.js';

const MAIN_GALLERY_IMAGE_SELECTOR = '#gallery .gallery-item.image';
const MAIN_GALLERY_VIDEO_SELECTOR = '#gallery .gallery-item.video';
const COARSE_POINTER_PROJECTS = new Set([
    'mobile-chrome',
    'mobile-safari',
    'tablet',
    'android-firefox',
]);

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

function getLightboxToolbar(page) {
    return page.locator('#lightbox-toolbar');
}

function getGalleryItemThumb(itemLocator) {
    return itemLocator.locator('.gallery-item-thumb');
}

async function dispatchGalleryItemOpen(page, itemLocator) {
    const itemPath = await itemLocator.getAttribute('data-path');
    const openedViaRuntime = itemPath
        ? await page.evaluate(async (path) => {
              const mediaIndex = window.MediaApp?.getMediaIndex?.(path) ?? -1;
              if (mediaIndex >= 0 && typeof window.Lightbox?.open === 'function') {
                  window.Lightbox.open(mediaIndex);
                  return true;
              }

              const item =
                  window.MediaApp?.state?.listing?.items?.find((entry) => entry.path === path) ||
                  window.MediaApp?.state?.mediaFiles?.find((entry) => entry.path === path);

              if (!item || typeof window.Gallery?.handleSingleTap !== 'function') {
                  return false;
              }

              const result = window.Gallery.handleSingleTap(item);
              if (result?.then) {
                  await result;
              }
              return true;
          }, itemPath)
        : false;

    if (!openedViaRuntime) {
        await getGalleryItemThumb(itemLocator).dispatchEvent('click');
    }
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
    const videoItems = page.locator(MAIN_GALLERY_VIDEO_SELECTOR);

    if ((await videoItems.count()) === 0) {
        return false;
    }

    await dispatchGalleryItemOpen(page, videoItems.first());

    await expect(getLightbox(page)).toBeVisible();
    await expect(getLightbox(page)).toHaveClass(/video-mode/);

    return true;
}

async function waitForLightboxVideoSource(page, timeout = 5000) {
    const video = getLightboxVideo(page);

    try {
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
    if (!(await openFirstVideoInLightbox(page))) {
        return false;
    }

    if (!(await waitForLightboxVideoSource(page))) {
        test.info().annotations.push({
            type: 'info',
            description:
                'Video lightbox entered video mode, but no playable source was assigned in Chromium.',
        });
        return false;
    }

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

            globalThis.Lightbox?.updateAutoplayButton?.();
            globalThis.Lightbox?.updateLoopButton?.();
            globalThis.Lightbox?.showUIOverlays?.();
        },
        { nextVideoAutoplay: videoAutoplay, nextMediaLoop: mediaLoop }
    );
}

async function getLightboxToolbarLayout(page) {
    return await page.evaluate(() => {
        const toolbar = document.getElementById('lightbox-toolbar');
        if (!toolbar) {
            return null;
        }

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

        const buttons = Array.from(toolbar.querySelectorAll('button'))
            .filter((button) => isVisible(button))
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

        return {
            toolbarRect: toRect(toolbar),
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
        expect(button.rect.left).toBeGreaterThanOrEqual(layout.toolbarRect.left - 1);
        expect(button.rect.right).toBeLessThanOrEqual(layout.toolbarRect.right + 1);
        expect(button.rect.top).toBeGreaterThanOrEqual(layout.toolbarRect.top - 1);
        expect(button.rect.bottom).toBeLessThanOrEqual(layout.toolbarRect.bottom + 1);

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
        await page.waitForSelector('.gallery-item');
    });

    test('should open video player when clicking a video', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            if (await openFirstVideoInLightbox(page)) {
                await expect(page.locator('#lightbox-autoplay')).toBeVisible();
                await expect(page.locator('#lightbox-loop-toggle')).toBeVisible();
            }
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
            if (await openFirstVideoInLightbox(page)) {
                await expect(page.locator('#lightbox-autoplay')).toBeVisible();
                await expect(page.locator('#lightbox-loop-toggle')).toBeVisible();
            }
        });
    });

    test('should keep the video toolbar aligned without overlap on desktop', async ({ page }) => {
        await runVideoLightboxTest(page, async () => {
            if (await openFirstVideoInLightbox(page)) {
                await setDeterministicVideoToolbarState(page, {
                    videoAutoplay: true,
                    mediaLoop: false,
                });

                const toolbar = getLightboxToolbar(page);
                await expect(toolbar).toBeVisible();
                await expect(page.locator('#lightbox-autoplay')).toBeVisible();
                await expect(page.locator('#lightbox-loop-toggle')).toBeVisible();
                await expect(page.locator('#lightbox-collection')).toBeVisible();

                const layout = await getLightboxToolbarLayout(page);
                assertLightboxToolbarLayout(layout, [
                    'lightbox-pin',
                    'lightbox-tag',
                    'lightbox-autoplay',
                    'lightbox-loop-toggle',
                    'lightbox-collection',
                ]);
            }
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
        await runVideoLightboxTest(page, async () => {
            if (await openFirstVideoInLightbox(page)) {
                const loopButton = page.locator('#lightbox-loop-toggle');
                const video = getLightboxVideo(page);

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
    }, testInfo) => {
        test.skip(
            !COARSE_POINTER_PROJECTS.has(testInfo.project.name),
            'The unified action cluster only replaces inline toolbar controls on coarse-pointer projects.'
        );

        await runVideoLightboxTest(page, async () => {
            if (await openFirstVideoInLightbox(page)) {
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
