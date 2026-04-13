import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function ensureParentDir(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function getVideoDurationMs(inputPath) {
    const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputPath,
    ]);

    const durationSeconds = Number.parseFloat(String(stdout).trim());
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return 0;
    }

    return Math.round(durationSeconds * 1000);
}

function buildFfmpegInputArgs(inputPath, trimStartMs = 0) {
    const args = [];

    if (trimStartMs > 0) {
        args.push('-ss', `${trimStartMs / 1000}`);
    }

    args.push('-i', inputPath);
    return args;
}

async function transcodeToMp4(inputPath, outputPath, fps, trimStartMs = 0) {
    await ensureParentDir(outputPath);
    await execFileAsync('ffmpeg', [
        '-y',
        ...buildFfmpegInputArgs(inputPath, trimStartMs),
        '-an',
        '-vf',
        `fps=${fps}`,
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outputPath,
    ]);
}

async function transcodeToGif(inputPath, outputPath, fps, scaleWidth, workingDir, trimStartMs = 0) {
    const palettePath = path.join(workingDir, 'palette.png');

    await ensureParentDir(outputPath);
    await execFileAsync('ffmpeg', [
        '-y',
        ...buildFfmpegInputArgs(inputPath, trimStartMs),
        '-vf',
        `fps=${fps},scale=${scaleWidth}:-1:flags=lanczos,palettegen=stats_mode=diff`,
        palettePath,
    ]);

    await execFileAsync('ffmpeg', [
        '-y',
        ...buildFfmpegInputArgs(inputPath, trimStartMs),
        '-i',
        palettePath,
        '-lavfi',
        `fps=${fps},scale=${scaleWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
        outputPath,
    ]);
}

async function extractVideoFrame(inputPath, outputPath, trimStartMs = 0) {
    await ensureParentDir(outputPath);
    const durationMs = await getVideoDurationMs(inputPath).catch(() => 0);
    const seekMs =
        trimStartMs > 0 ? trimStartMs : durationMs > 0 ? Math.max(0, durationMs - 500) : 0;

    await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-ss',
        `${seekMs / 1000}`,
        '-frames:v',
        '1',
        outputPath,
    ]);
}

function copyFieldStateToClone(element, clone) {
    const originalFields = Array.from(element.querySelectorAll('input, textarea, select'));
    const clonedFields = Array.from(clone.querySelectorAll('input, textarea, select'));

    originalFields.forEach((originalField, index) => {
        const clonedField = clonedFields[index];
        if (!clonedField) {
            return;
        }

        if (originalField instanceof HTMLInputElement && clonedField instanceof HTMLInputElement) {
            clonedField.value = originalField.value;
            clonedField.setAttribute('value', originalField.value);
            clonedField.checked = originalField.checked;
            if (originalField.checked) {
                clonedField.setAttribute('checked', '');
            } else {
                clonedField.removeAttribute('checked');
            }
            return;
        }

        if (
            originalField instanceof HTMLTextAreaElement &&
            clonedField instanceof HTMLTextAreaElement
        ) {
            clonedField.value = originalField.value;
            clonedField.textContent = originalField.value;
            return;
        }

        if (
            originalField instanceof HTMLSelectElement &&
            clonedField instanceof HTMLSelectElement
        ) {
            Array.from(clonedField.options).forEach((option, optionIndex) => {
                const isSelected = originalField.options[optionIndex]?.selected === true;
                option.selected = isSelected;
                if (isSelected) {
                    option.setAttribute('selected', '');
                } else {
                    option.removeAttribute('selected');
                }
            });
        }
    });
}

export async function captureDocsScreenshot(page, locator, screenshotPath, options = {}) {
    // For most screenshots, use Playwright's built-in locator.screenshot() which naturally
    // clips to the element bounds with no whitespace issues. Temporarily hide any backdrop
    // overlays that would obscure the element.
    if (!options.flattenTagSuggestions && !options.shrinkToContent) {
        const existingCheck = await fs.access(screenshotPath).then(
            () => true,
            () => false
        );
        await ensureParentDir(screenshotPath);

        // Hide elements that could obscure the captured element
        const hiddenSelectors = [
            '.modal-backdrop',
            '.lightbox-drawer-backdrop',
            '.lightbox-collection-drawer-backdrop',
            '.favorites-fade',
        ];
        await page.evaluate((selectors) => {
            for (const sel of selectors) {
                document.querySelectorAll(sel).forEach((el) => {
                    el.dataset.docsHide = '1';
                    el.style.visibility = 'hidden';
                });
            }
        }, hiddenSelectors);

        try {
            if (options.clipToLocator) {
                const box = await locator.boundingBox();
                if (!box) {
                    throw new Error('Could not determine locator bounds for screenshot');
                }

                const padding = options.clipPadding ?? 4;
                await page.screenshot({
                    path: screenshotPath,
                    scale: 'css',
                    animations: 'disabled',
                    clip: {
                        x: Math.max(0, box.x - padding),
                        y: Math.max(0, box.y - padding),
                        width: Math.max(1, box.width + padding * 2),
                        height: Math.max(1, box.height + padding * 2),
                    },
                });
            } else {
                await locator.screenshot({
                    path: screenshotPath,
                    scale: 'css',
                    animations: 'disabled',
                });
            }
        } catch (error) {
            if (existingCheck) return;
            throw error;
        } finally {
            await page
                .evaluate(() => {
                    document.querySelectorAll('[data-docs-hide]').forEach((el) => {
                        el.style.removeProperty('visibility');
                        delete el.dataset.docsHide;
                    });
                })
                .catch(() => {});
        }
        return;
    }

    const existingScreenshotPromise = fs.access(screenshotPath).then(
        () => true,
        () => false
    );

    const snapshot = await locator.evaluate((element, captureOptions) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });

        const temporaryTargets = [];
        const rememberStyle = (target) => {
            if (!(target instanceof HTMLElement)) {
                return;
            }

            temporaryTargets.push({
                target,
                style: target.getAttribute('style'),
            });
        };

        try {
            if (captureOptions.flattenTagSuggestions) {
                const modalBody = element.querySelector('.modal-body');
                const suggestions = element.querySelector('#tag-suggestions, .tag-suggestions');

                rememberStyle(modalBody);
                rememberStyle(suggestions);

                if (modalBody instanceof HTMLElement) {
                    modalBody.style.overflow = 'visible';
                    modalBody.style.maxHeight = 'none';
                }

                if (suggestions instanceof HTMLElement) {
                    suggestions.style.maxHeight = 'none';
                    suggestions.style.overflowY = 'visible';
                    suggestions.style.height = `${suggestions.scrollHeight}px`;
                    suggestions.style.contain = 'none';
                }
            }

            void element.getBoundingClientRect();

            const clone = element.cloneNode(true);

            // Inline field-state sync (must live here; browser evaluate cannot
            // reference Node.js closures outside this callback).
            const originalFields = Array.from(element.querySelectorAll('input, textarea, select'));
            const clonedFields = Array.from(clone.querySelectorAll('input, textarea, select'));
            originalFields.forEach((originalField, index) => {
                const clonedField = clonedFields[index];
                if (!clonedField) {
                    return;
                }

                if (
                    originalField instanceof HTMLInputElement &&
                    clonedField instanceof HTMLInputElement
                ) {
                    clonedField.value = originalField.value;
                    clonedField.setAttribute('value', originalField.value);
                    clonedField.checked = originalField.checked;
                    if (originalField.checked) {
                        clonedField.setAttribute('checked', '');
                    } else {
                        clonedField.removeAttribute('checked');
                    }
                    return;
                }

                if (
                    originalField instanceof HTMLTextAreaElement &&
                    clonedField instanceof HTMLTextAreaElement
                ) {
                    clonedField.value = originalField.value;
                    clonedField.textContent = originalField.value;
                    return;
                }

                if (
                    originalField instanceof HTMLSelectElement &&
                    clonedField instanceof HTMLSelectElement
                ) {
                    Array.from(clonedField.options).forEach((option, optionIndex) => {
                        const isSelected = originalField.options[optionIndex]?.selected === true;
                        option.selected = isSelected;
                        if (isSelected) {
                            option.setAttribute('selected', '');
                        } else {
                            option.removeAttribute('selected');
                        }
                    });
                }
            });

            const rect = element.getBoundingClientRect();
            const headMarkup = Array.from(
                document.querySelectorAll('head style, head link[rel="stylesheet"]')
            )
                .map((node) => node.outerHTML)
                .join('\n');

            return {
                width: Math.max(1, Math.ceil(rect.width)),
                height: Math.max(1, Math.ceil(rect.height)),
                html: clone.outerHTML,
                headMarkup,
            };
        } finally {
            temporaryTargets.forEach(({ target, style }) => {
                if (style === null) {
                    target.removeAttribute('style');
                } else {
                    target.setAttribute('style', style);
                }
            });
        }
    }, options);

    const capturePage = await page.context().newPage();
    const baseHref = new URL('/', page.url()).href;

    try {
        await capturePage.setViewportSize({
            width: Math.max(640, snapshot.width + 64),
            height: Math.max(2000, snapshot.height + 256),
        });

        await capturePage.setContent(
            `<!doctype html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <base href="${baseHref}">
                    ${snapshot.headMarkup}
                    <style>
                        html, body {
                            margin: 0;
                            padding: 0;
                            background: transparent;
                            overflow: visible;
                        }

                        body {
                            display: flex;
                            align-items: flex-start;
                            justify-content: flex-start;
                        }

                        #e2e-screenshot-root,
                        #e2e-screenshot-root * {
                            animation: none !important;
                            transition: none !important;
                            caret-color: transparent !important;
                            scroll-behavior: auto !important;
                        }

                        #e2e-screenshot-root {
                            margin: 0;
                            padding: 0;
                            background: transparent;
                        }

                        /* Force desktop layout in the isolated render page so that
                           mobile media-query overrides (e.g. column-reverse buttons)
                           do not apply regardless of the physical viewport used. */
                        .modal-actions,
                        .paste-tags-modal-content .modal-actions {
                            flex-direction: row !important;
                        }
                        .modal-actions .btn,
                        .paste-tags-modal-content .modal-actions .btn {
                            width: auto !important;
                        }
                    </style>
                </head>
                <body>
                    <div id="e2e-screenshot-root">${snapshot.html}</div>
                </body>
            </html>`,
            { waitUntil: 'load' }
        );

        const clip = await capturePage.evaluate(
            async ({ shrinkToContent }) => {
                const root = document.getElementById('e2e-screenshot-root');
                if (!(root instanceof HTMLElement)) {
                    throw new Error('Capture root not found');
                }

                const setStyles = (target, styles) => {
                    if (!(target instanceof HTMLElement)) {
                        return;
                    }

                    Object.entries(styles).forEach(([property, value]) => {
                        target.style.setProperty(property, value, 'important');
                    });
                };

                const normalizeContainer = (target, displayOverride) => {
                    if (!(target instanceof HTMLElement)) {
                        return;
                    }

                    const computedDisplay = displayOverride ?? getComputedStyle(target).display;
                    setStyles(target, {
                        position: 'static',
                        inset: 'auto',
                        top: 'auto',
                        right: 'auto',
                        bottom: 'auto',
                        left: 'auto',
                        transform: 'none',
                        width: 'auto',
                        'min-width': '0',
                        // Keep max-width so design-defined widths (e.g. max-width:400px on
                        // modals) are preserved and the wide render viewport is not filled.
                        height: 'auto',
                        'min-height': '0',
                        'max-height': 'none',
                        overflow: 'visible',
                        margin: '0',
                        display: computedDisplay,
                    });
                };

                const normalizeScrollable = (target) => {
                    setStyles(target, {
                        overflow: 'visible',
                        'overflow-x': 'visible',
                        'overflow-y': 'visible',
                        height: 'auto',
                        'max-height': 'none',
                    });
                };

                root.querySelectorAll(
                    '.modal-backdrop, .lightbox-drawer-backdrop, .lightbox-collection-drawer-backdrop, .favorites-fade'
                ).forEach((node) => node.remove());

                normalizeContainer(root, shrinkToContent ? 'inline-flex' : undefined);

                root.querySelectorAll(
                    '.modal-content, .settings-modal-content, .paste-tags-modal-content, .search-tag-modal-content, .collections-panel-content, .lightbox-tags-drawer, .lightbox-collection-drawer'
                ).forEach((node) => normalizeContainer(node));

                root.querySelectorAll(
                    '.modal-body, .settings-content, .settings-tab-content, .tag-suggestions, .drawer-tags-list, .collection-drawer-list, .collection-drawer-suggestions, .collection-add-current-list, .collection-add-existing-list, .collections-panel-list, .favorites-gallery-container, .favorites-gallery'
                ).forEach((node) => normalizeScrollable(node));

                if (root.matches('.favorites-gallery')) {
                    setStyles(root, {
                        display: 'inline-flex',
                        width: 'fit-content',
                        'max-width': 'none',
                        'padding-right': '0',
                    });
                }

                const waitForWithTimeout = (promiseFactory, timeoutMs = 5000) => {
                    return Promise.race([
                        promiseFactory(),
                        new Promise((resolve) => {
                            setTimeout(resolve, timeoutMs);
                        }),
                    ]);
                };

                const images = Array.from(document.images);
                await Promise.all(
                    images.map((image) => {
                        if (!image.getAttribute('src') && image.dataset.src) {
                            image.setAttribute('src', image.dataset.src);
                        }

                        if (image.complete) {
                            return Promise.resolve();
                        }

                        return waitForWithTimeout(
                            () =>
                                new Promise((resolve) => {
                                    image.addEventListener('load', resolve, { once: true });
                                    image.addEventListener('error', resolve, { once: true });
                                })
                        );
                    })
                );

                if (document.fonts?.ready) {
                    await waitForWithTimeout(() => document.fonts.ready);
                }

                await waitForWithTimeout(
                    () =>
                        new Promise((resolve) => {
                            setTimeout(resolve, 50);
                        }),
                    100
                );

                void root.getBoundingClientRect();

                // Always compute a tight bounding box from visible descendants so that
                // any empty space below (or around) the root element is excluded.
                // The union is clamped to the root's own bounding rect so that any
                // absolutely-positioned children outside the root cannot expand the clip.
                const rootRect = root.getBoundingClientRect();
                let clipRect = rootRect;
                {
                    let union = null;
                    const descendants = Array.from(root.querySelectorAll('*'));

                    descendants.forEach((node) => {
                        if (!(node instanceof HTMLElement)) {
                            return;
                        }

                        const styles = getComputedStyle(node);
                        if (
                            styles.display === 'none' ||
                            styles.visibility === 'hidden' ||
                            Number.parseFloat(styles.opacity || '1') === 0
                        ) {
                            return;
                        }

                        const rect = node.getBoundingClientRect();
                        if (rect.width < 2 || rect.height < 2) {
                            return;
                        }

                        // Clamp each descendant's contribution to stay within the root.
                        const clampedRect = {
                            left: Math.max(rect.left, rootRect.left),
                            top: Math.max(rect.top, rootRect.top),
                            right: Math.min(rect.right, rootRect.right),
                            bottom: Math.min(rect.bottom, rootRect.bottom),
                        };
                        if (
                            clampedRect.right <= clampedRect.left ||
                            clampedRect.bottom <= clampedRect.top
                        ) {
                            return;
                        }

                        union = union
                            ? {
                                  left: Math.min(union.left, clampedRect.left),
                                  top: Math.min(union.top, clampedRect.top),
                                  right: Math.max(union.right, clampedRect.right),
                                  bottom: Math.max(union.bottom, clampedRect.bottom),
                              }
                            : {
                                  left: clampedRect.left,
                                  top: clampedRect.top,
                                  right: clampedRect.right,
                                  bottom: clampedRect.bottom,
                              };
                    });

                    if (union) {
                        clipRect = {
                            left: union.left,
                            top: union.top,
                            right: union.right,
                            bottom: union.bottom,
                        };
                    }
                }

                const padding = 4;

                return {
                    x: Math.max(0, Math.floor(clipRect.left - padding)),
                    y: Math.max(0, Math.floor(clipRect.top - padding)),
                    width: Math.max(1, Math.ceil(clipRect.right - clipRect.left + padding * 2)),
                    height: Math.max(1, Math.ceil(clipRect.bottom - clipRect.top + padding * 2)),
                };
            },
            {
                shrinkToContent: Boolean(options.shrinkToContent),
            }
        );

        try {
            if (options.preferIsolatedLocatorScreenshot) {
                await capturePage.locator('#e2e-screenshot-root').screenshot({
                    path: screenshotPath,
                    scale: 'css',
                    animations: 'disabled',
                });
            } else {
                await capturePage.screenshot({
                    path: screenshotPath,
                    scale: 'css',
                    animations: 'disabled',
                    clip,
                });
            }
        } catch (error) {
            const hasExistingScreenshot = await existingScreenshotPromise;
            if (hasExistingScreenshot) {
                return;
            }
            throw error;
        }
    } finally {
        await capturePage.close();
    }
}

export async function captureAnimatedDocsMedia({
    page,
    startPath = '/',
    viewport,
    outputMp4Path,
    outputGifPath,
    fps = 12,
    gifScaleWidth = 960,
    trimStartMs = 0,
    leadInMs = 0,
    settleMs = 400,
    prepare,
    run,
}) {
    if (!outputMp4Path && !outputGifPath) {
        throw new Error('captureAnimatedDocsMedia requires at least one output path');
    }

    const browser = page.context().browser();
    if (!browser) {
        throw new Error('Animated docs capture requires a browser-backed Playwright context');
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'media-viewer-docs-media-'));
    const recordingsDir = path.join(tempRoot, 'recordings');
    await fs.mkdir(recordingsDir, { recursive: true });

    const storageState = await page.context().storageState();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const targetViewport = viewport ?? page.viewportSize() ?? { width: 1440, height: 1100 };
    const baseURL = new URL('/', page.url()).href;

    let webmPath;

    try {
        // Do not force colorScheme or reducedMotion: the app is dark-only and
        // forcibly reducing motion suppresses the CSS transitions that make the
        // animated output visually useful.  Use 'load' rather than
        // 'domcontentloaded' so all scripts (Lightbox, settingsManager, etc.)
        // are fully initialised before prepare/run begins.
        const captureContext = await browser.newContext({
            baseURL,
            storageState,
            viewport: targetViewport,
            userAgent,
            recordVideo: {
                dir: recordingsDir,
                size: targetViewport,
            },
        });

        const capturePage = await captureContext.newPage();
        const video = capturePage.video();

        try {
            await capturePage.goto(startPath);
            await capturePage.waitForLoadState('load');

            if (typeof prepare === 'function') {
                await prepare(capturePage);
            }

            if (leadInMs > 0) {
                await capturePage.waitForTimeout(leadInMs);
            }

            if (typeof run === 'function') {
                await run(capturePage);
            }

            await capturePage.waitForTimeout(settleMs);
        } finally {
            await captureContext.close();
        }

        if (!video) {
            throw new Error('Animated docs capture did not produce a Playwright video');
        }

        webmPath = await video.path();

        if (outputMp4Path) {
            await transcodeToMp4(webmPath, outputMp4Path, fps, trimStartMs);
        }

        if (outputGifPath) {
            await transcodeToGif(
                webmPath,
                outputGifPath,
                fps,
                gifScaleWidth,
                tempRoot,
                trimStartMs
            );
        }
    } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}

export async function captureDocsVideoFrame({
    page,
    startPath = '/',
    viewport,
    outputPngPath,
    trimStartMs = 0,
    leadInMs = 0,
    settleMs = 400,
    prepare,
    run,
}) {
    if (!outputPngPath) {
        throw new Error('captureDocsVideoFrame requires an outputPngPath');
    }

    const browser = page.context().browser();
    if (!browser) {
        throw new Error('Docs frame capture requires a browser-backed Playwright context');
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'media-viewer-docs-frame-'));
    const recordingsDir = path.join(tempRoot, 'recordings');
    await fs.mkdir(recordingsDir, { recursive: true });

    const storageState = await page.context().storageState();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const targetViewport = viewport ?? page.viewportSize() ?? { width: 1440, height: 1100 };
    const baseURL = new URL('/', page.url()).href;

    let webmPath;

    try {
        const captureContext = await browser.newContext({
            baseURL,
            storageState,
            viewport: targetViewport,
            userAgent,
            colorScheme: 'light',
            reducedMotion: 'reduce',
            recordVideo: {
                dir: recordingsDir,
                size: targetViewport,
            },
        });

        const capturePage = await captureContext.newPage();
        const video = capturePage.video();

        try {
            await capturePage.goto(startPath);
            await capturePage.waitForLoadState('domcontentloaded');

            if (typeof prepare === 'function') {
                await prepare(capturePage);
            }

            if (leadInMs > 0) {
                await capturePage.waitForTimeout(leadInMs);
            }

            if (typeof run === 'function') {
                await run(capturePage);
            }

            await capturePage.waitForTimeout(settleMs);
        } finally {
            await captureContext.close();
        }

        if (!video) {
            throw new Error('Docs frame capture did not produce a Playwright video');
        }

        webmPath = await video.path();
        await extractVideoFrame(webmPath, outputPngPath, trimStartMs);
    } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}
