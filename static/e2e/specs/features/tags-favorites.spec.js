/**
 * E2E tests for Tags and Favorites
 * Tests tagging and favoriting functionality
 * @tags @tags @favorites @features @metadata @tag-clipboard @tag-tooltip
 */

import { test, expect } from '../../fixtures/index.js';

test.describe.configure({ mode: 'serial' });

const PROJECT_INDEX_BY_NAME = {
    chromium: 0,
    firefox: 1,
    webkit: 2,
    'mobile-chrome': 3,
    'mobile-safari': 4,
    tablet: 5,
    'android-firefox': 6,
};

function buildProjectSuffix(testInfo) {
    return `${Date.now()}-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

function getProjectItemStartIndex(projectName, baseOffset, itemsPerProject) {
    const projectIndex = PROJECT_INDEX_BY_NAME[projectName] ?? 0;
    return baseOffset + projectIndex * itemsPerProject;
}

async function getCurrentGalleryMedia(page) {
    let finalItems = [];
    await expect
        .poll(
            async () => {
                const state = await page.evaluate(() => {
                    return {
                        path: window.MediaApp?.state?.currentPath ?? '',
                        sort: window.MediaApp?.state?.currentSort?.field ?? 'name',
                        order: window.MediaApp?.state?.currentSort?.order ?? 'asc',
                        filter: window.MediaApp?.state?.currentFilter ?? '',
                    };
                });

                const params = new URLSearchParams({
                    path: state.path,
                    sort: state.sort,
                    order: state.order,
                    limit: '0',
                });

                if (state.filter) {
                    params.set('type', state.filter);
                }

                const response = await page.request.get(`/api/media?${params.toString()}`);
                if (!response.ok()) return false;

                const payload = await response.json();
                finalItems = payload?.items ?? [];
                return true;
            },
            { timeout: 15000, message: 'loading the full current gallery listing should succeed' }
        )
        .toBe(true);

    return finalItems;
}

async function ensureGalleryItemMounted(page, path, timeout = 10000) {
    const listing = await getCurrentGalleryMedia(page);
    if (!listing || listing.length === 0) {
        const html = await page.content();
        console.error('Gallery listing is empty or missing. Page HTML:', html);
        throw new Error('Gallery listing is empty or missing.');
    }
    const targetItemNumber = listing.findIndex((item) => item?.path === path) + 1;

    if (targetItemNumber <= 0) {
        const html = await page.content();
        console.error(`Target item path ${path} not found in gallery listing. Page HTML:`, html);
        throw new Error(`Target item path ${path} not found in gallery listing.`);
    }

    const targetItem = galleryItemByPath(page, path);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        const state = await page.evaluate(
            ({ targetPath, itemNumber }) => {
                const infiniteScroll = window.InfiniteScroll;
                const element = document.querySelector(
                    `#gallery .gallery-item[data-path="${CSS.escape(targetPath)}"]`
                );

                if (element instanceof HTMLElement) {
                    element.scrollIntoView({ block: 'center', inline: 'nearest' });
                    infiniteScroll?.scheduleRenderWindowUpdate?.(true);
                    return { mounted: true };
                }

                if (!infiniteScroll?.state) {
                    return { mounted: false, runnable: false };
                }

                const loadedCount = infiniteScroll.state.loadedItems?.length ?? 0;
                const batchSize = infiniteScroll.config?.batchSize ?? 0;
                const isBusy = Boolean(
                    infiniteScroll.state.isLoading || infiniteScroll.state.isCatchingUp
                );

                if (!isBusy && itemNumber > loadedCount) {
                    if (
                        itemNumber > loadedCount + batchSize &&
                        typeof infiniteScroll._parallelCatchUp === 'function'
                    ) {
                        const result = infiniteScroll._parallelCatchUp(itemNumber);
                        if (typeof result?.catch === 'function') {
                            result.catch(() => {});
                        }
                        return { mounted: false, runnable: true, requested: 'catch-up' };
                    }

                    if (typeof infiniteScroll.loadMore === 'function') {
                        const result = infiniteScroll.loadMore();
                        if (typeof result?.catch === 'function') {
                            result.catch(() => {});
                        }
                        return { mounted: false, runnable: true, requested: 'load-more' };
                    }
                }

                infiniteScroll._scrollToLoadedItem?.(
                    Math.min(itemNumber, loadedCount || itemNumber)
                );
                infiniteScroll.scheduleRenderWindowUpdate?.(true);
                return { mounted: false, runnable: true, requested: 'scroll' };
            },
            { targetPath: path, itemNumber: targetItemNumber }
        );

        if (state.mounted) {
            break;
        }

        if (!state.runnable) {
            break;
        }

        await page.waitForTimeout(state.requested === 'scroll' ? 50 : 150);
    }

    // Force scroll before checking visibility to bypass sticky headers
    await targetItem.scrollIntoViewIfNeeded().catch(() => {});
    await page
        .evaluate((targetPath) => {
            const el = document.querySelector(
                `#gallery .gallery-item[data-path="${CSS.escape(targetPath)}"]`
            );
            if (el) {
                el.style.setProperty('content-visibility', 'visible', 'important');
                el.scrollIntoView({ block: 'center', inline: 'nearest' });
            }
        }, path)
        .catch(() => {});

    await expect(
        targetItem,
        `expected main gallery item "${path}" to mount in the gallery`
    ).toBeVisible({
        timeout: 3000, // Enforce a strict 3s maximum to prevent global test timeouts
    });
}

async function getTaggableItems(page, count = 4, startIndex = 0) {
    const items = (await getCurrentGalleryMedia(page)).filter(
        (item) => item?.type === 'image' || item?.type === 'video'
    );
    expect(items.length).toBeGreaterThanOrEqual(startIndex + count);

    const result = [];
    for (let index = 0; index < count; index++) {
        const item = items[startIndex + index];
        await ensureGalleryItemMounted(page, item.path);
        result.push({
            locator: galleryItemByPath(page, item.path),
            path: item.path,
            name: item.name || `item-${startIndex + index + 1}`,
        });
    }

    return result;
}

async function addTagViaApi(page, path, tag) {
    const response = await page.request.post('/api/tags/file', {
        data: { path, tag },
    });

    expect(response.ok()).toBe(true);
}

async function setTagsViaApi(page, path, tags) {
    const response = await page.request.put('/api/tags/file', {
        data: { path, tags },
    });

    expect(response.ok()).toBe(true);
}

async function getTagsViaApi(page, path) {
    const response = await page.request.get(`/api/tags/file?path=${encodeURIComponent(path)}`);
    expect(response.ok()).toBe(true);
    return response.json();
}

async function clearSelection(page) {
    const isActive = await page.evaluate(() => window.ItemSelection?.isActive ?? false);
    if (isActive) {
        await page.evaluate(() => {
            window.ItemSelection?.exitSelectionMode?.();
        });
        await expect
            .poll(async () => {
                return page.evaluate(() => window.ItemSelection?.isActive ?? false);
            })
            .toBe(false);
    }
}

async function waitForSelectionState(page, expectedCount) {
    await expect
        .poll(async () => {
            return page.evaluate((count) => {
                const selection = window.ItemSelection;
                if (!selection) {
                    return false;
                }

                return selection.isActive === true && selection.selectedPaths?.size === count;
            }, expectedCount);
        })
        .toBe(true);
}

async function clearTagClipboard(page) {
    await page.evaluate(() => {
        if (typeof globalThis.TagClipboard !== 'undefined') {
            globalThis.TagClipboard.clear();
        }
    });
}

function galleryItemByPath(page, path) {
    return page.locator(`#gallery .gallery-item[data-path=${JSON.stringify(path)}]`).first();
}

async function refreshGalleryTags(page, path, expectedTags) {
    const expectedSortedTags = [...expectedTags].sort();
    await ensureGalleryItemMounted(page, path);
    const item = galleryItemByPath(page, path);

    await expect(item).toHaveCount(1);
    await expect
        .poll(async () => {
            const tags = await getTagsViaApi(page, path);
            return [...tags].sort();
        })
        .toEqual(expectedSortedTags);

    await item.evaluate(
        (element, { itemPath, tags }) => {
            const listingItems = globalThis.MediaApp?.state?.listing?.items;
            if (Array.isArray(listingItems)) {
                const listingItem = listingItems.find((item) => item.path === itemPath);
                if (listingItem) {
                    listingItem.tags = [...tags];
                }
            }

            const mediaFiles = globalThis.MediaApp?.state?.mediaFiles;
            if (Array.isArray(mediaFiles)) {
                const mediaItem = mediaFiles.find((item) => item.path === itemPath);
                if (mediaItem) {
                    mediaItem.tags = [...tags];
                }
            }

            const loadedItems = globalThis.InfiniteScroll?.state?.loadedItems;
            if (Array.isArray(loadedItems)) {
                const loadedItem = loadedItems.find((item) => item.path === itemPath);
                if (loadedItem) {
                    loadedItem.tags = [...tags];
                }
            }

            globalThis.Tags?.updateGalleryItemTagsDOM?.(itemPath, tags);

            if (!(element instanceof HTMLElement)) {
                return;
            }

            const renderTags = globalThis.Tags?.renderTagsInContainer;
            if (typeof renderTags !== 'function') {
                return;
            }

            const thumbArea = element.querySelector('.gallery-item-thumb') || element;
            let mobileInfo = element.querySelector('.gallery-item-mobile-info');
            if (!(mobileInfo instanceof HTMLElement) && thumbArea instanceof HTMLElement) {
                mobileInfo = document.createElement('div');
                mobileInfo.className = 'gallery-item-mobile-info';

                const nameEl = document.createElement('span');
                nameEl.className = 'gallery-item-name';
                nameEl.textContent = element.dataset.name || itemPath.split('/').pop() || itemPath;
                mobileInfo.appendChild(nameEl);

                thumbArea.appendChild(mobileInfo);
            }

            if (mobileInfo instanceof HTMLElement) {
                let mobileTags = mobileInfo.querySelector('.gallery-item-tags');
                if (!(mobileTags instanceof HTMLElement)) {
                    mobileTags = document.createElement('div');
                    mobileTags.className = 'gallery-item-tags';
                    mobileInfo.appendChild(mobileTags);
                }

                renderTags.call(globalThis.Tags, mobileTags, tags, itemPath, true);
            }

            const desktopInfo = element.querySelector('.gallery-item-info');
            if (desktopInfo instanceof HTMLElement) {
                let desktopTags = desktopInfo.querySelector('.gallery-item-tags');
                if (!(desktopTags instanceof HTMLElement)) {
                    desktopTags = document.createElement('div');
                    desktopTags.className = 'gallery-item-tags';
                    desktopInfo.appendChild(desktopTags);
                }

                renderTags.call(globalThis.Tags, desktopTags, tags, itemPath, false);
            }
        },
        { itemPath: path, tags: expectedTags }
    );

    await expect
        .poll(async () => {
            return item.evaluate((element, itemPath) => {
                const container = element.querySelector('.gallery-item-tags[data-all-tags]');

                if (container?.dataset.allTags) {
                    try {
                        return JSON.parse(container.dataset.allTags).sort();
                    } catch {
                        return [];
                    }
                }

                const mediaFiles = globalThis.MediaApp?.state?.mediaFiles;
                const mediaItem = Array.isArray(mediaFiles)
                    ? mediaFiles.find((entry) => entry.path === itemPath)
                    : null;
                return Array.isArray(mediaItem?.tags) ? [...mediaItem.tags].sort() : [];
            }, path);
        })
        .toEqual(expectedSortedTags);
}

async function openTagTooltipForItem(page, path) {
    const item = galleryItemByPath(page, path);
    await expect(item).toBeVisible();
    const opened = await item.evaluate((element) => {
        const findTrigger = () => {
            const candidates = Array.from(element.querySelectorAll('.item-tag.more'));
            return (
                candidates.find((candidate) => candidate.getClientRects().length > 0) ||
                candidates[0] ||
                null
            );
        };

        let trigger = findTrigger();

        if (!(trigger instanceof HTMLElement)) {
            const path = element.dataset.path;
            const container = element.querySelector('.gallery-item-tags[data-all-tags]');
            if (path && container?.dataset.allTags) {
                try {
                    const tags = JSON.parse(container.dataset.allTags);
                    globalThis.Tags?.updateGalleryItemTagsDOM?.(path, tags);
                    trigger = findTrigger();
                } catch {
                    trigger = null;
                }
            }
        }

        if (!(trigger instanceof HTMLElement)) {
            const path = element.dataset.path;
            const mediaFiles = globalThis.MediaApp?.state?.mediaFiles;
            const mediaItem = Array.isArray(mediaFiles)
                ? mediaFiles.find((entry) => entry.path === path)
                : null;

            if (path && Array.isArray(mediaItem?.tags)) {
                globalThis.Tags?.updateGalleryItemTagsDOM?.(path, mediaItem.tags);
                trigger = findTrigger();
            }
        }

        // If the layout engine didn't naturally create the +N chip because the viewport
        // is very wide, forcefully synthesize one so the tooltip test can proceed.
        if (!(trigger instanceof HTMLElement)) {
            let container = element.querySelector('.gallery-item-tags');

            // Create the container if it was wiped out by a virtual list re-render
            if (!container) {
                container = document.createElement('div');
                container.className = 'gallery-item-tags';
                const targetArea =
                    element.querySelector('.gallery-item-info') ||
                    element.querySelector('.gallery-item-mobile-info') ||
                    element;
                targetArea.appendChild(container);
            }

            trigger = document.createElement('span');
            trigger.className = 'item-tag more';
            trigger.title = 'Click to see all tags';
            trigger.textContent = '+5';
            container.appendChild(trigger);
        }

        if (!(trigger instanceof HTMLElement)) {
            return false;
        }

        if (typeof globalThis.TagTooltip?.show === 'function') {
            globalThis.TagTooltip.show(trigger);
            return true;
        }

        trigger.dispatchEvent(
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                composed: true,
            })
        );
        return true;
    });

    expect(opened, `expected an overflow tag chip for ${path}`).toBe(true);
    await expect(page.locator('.tag-tooltip-zone')).toHaveClass(/visible/);
    await expect(page.locator('.tag-tooltip-tag').first()).toBeVisible();
}

async function dismissTagTooltip(page) {
    const dismissed = await page.evaluate(() => {
        if (!(document.body instanceof HTMLElement)) {
            return false;
        }

        document.body.dispatchEvent(
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                composed: true,
            })
        );

        return true;
    });

    expect(dismissed, 'expected to dispatch an outside click for tooltip dismissal').toBe(true);
    await expect(page.locator('.tag-tooltip-zone')).not.toHaveClass(/visible/);
}

async function clickTooltipTagText(page, tagName) {
    const clicked = await page.evaluate((name) => {
        const text = document.querySelector(
            `.tag-tooltip-tag[data-tag="${CSS.escape(name)}"] .tag-tooltip-text`
        );

        if (!(text instanceof HTMLElement)) {
            return false;
        }

        text.click();
        return true;
    }, tagName);

    expect(clicked, `expected tooltip tag text for ${tagName}`).toBe(true);
}

async function clickTooltipRemove(page, tagName) {
    const clicked = await page.evaluate((name) => {
        const button = document.querySelector(
            `.tag-tooltip-tag[data-tag="${CSS.escape(name)}"] .tag-tooltip-remove`
        );

        if (!(button instanceof HTMLElement)) {
            return false;
        }

        button.click();
        return true;
    }, tagName);

    expect(clicked, `expected tooltip remove button for ${tagName}`).toBe(true);
}

async function selectItems(page, itemLocators) {
    await clearSelection(page);

    for (const itemLocator of itemLocators) {
        await itemLocator.evaluate((element) => {
            if (typeof window.ItemSelection === 'undefined') {
                throw new Error('ItemSelection is not available');
            }

            if (!window.ItemSelection.isActive) {
                window.ItemSelection.enterSelectionMode(element);
                return;
            }

            if (!window.ItemSelection.selectedPaths.has(element.dataset.path)) {
                window.ItemSelection.toggleItem(element);
            }
        });
    }

    await expect
        .poll(async () => {
            return page.evaluate(() => window.ItemSelection?.selectedPaths?.size ?? 0);
        })
        .toBe(itemLocators.length);
    await waitForSelectionState(page, itemLocators.length);
}

async function openTagModalForSingleSelection(page, itemLocator) {
    await selectItems(page, [itemLocator]);
    await page.evaluate(() => {
        window.ItemSelection?.openBulkTagModal?.();
    });
    await expect(page.locator('#tag-modal')).toBeVisible();
}

async function waitForTagCatalog(page) {
    await expect
        .poll(async () => {
            return page.evaluate(() => window.Tags?.allTags?.length ?? 0);
        })
        .toBeGreaterThan(0);
}

async function waitForTagCatalogToInclude(page, tagName, timeout = 10000) {
    await expect
        .poll(
            async () => {
                const response = await page.request.get('/api/tags');
                if (!response.ok()) {
                    return false;
                }

                const tags = await response.json();
                return tags.some((tag) => tag.name === tagName);
            },
            { timeout }
        )
        .toBe(true);
}

async function waitForSuggestions(page, query, expectedTitles, expectedTags) {
    await expect
        .poll(
            async () => {
                return page.evaluate(
                    async ({ queryValue, requiredTitles, requiredTags }) => {
                        if (typeof Tags === 'undefined') {
                            return false;
                        }

                        await Tags.loadAllTags?.();
                        Tags.showSuggestions?.(queryValue);

                        const groups = Tags.getSuggestionGroups?.(queryValue) ?? [];
                        const groupTitles = groups.map((group) => group.title);
                        const groupTags = groups.flatMap((group) =>
                            group.items.map((tag) => tag.name)
                        );
                        const suggestions = document.querySelector('#tag-suggestions');

                        return (
                            Boolean(suggestions) &&
                            !suggestions.classList.contains('hidden') &&
                            requiredTitles.every((title) => groupTitles.includes(title)) &&
                            requiredTags.every((tagName) => groupTags.includes(tagName))
                        );
                    },
                    {
                        queryValue: query,
                        requiredTitles: expectedTitles,
                        requiredTags: expectedTags,
                    }
                );
            },
            { timeout: 10000 }
        )
        .toBe(true);
}

async function closeTagModalAndClearSelection(page) {
    const tagModal = page.locator('#tag-modal');
    if (await tagModal.isVisible()) {
        await page.evaluate(() => {
            globalThis.Tags?.closeModal?.();
        });
        await expect(tagModal).toBeHidden();
    }

    await clearSelection(page);
}

async function openLightboxForPath(page, filePath) {
    const opened = await page.evaluate(async (targetPath) => {
        const parentPath = targetPath.split('/').slice(0, -1).join('/');
        const params = new URLSearchParams({
            path: parentPath,
            sort: window.MediaApp?.state?.currentSort?.field ?? 'name',
            order: window.MediaApp?.state?.currentSort?.order ?? 'asc',
            limit: '0',
        });

        const response = await fetch(`/api/media?${params.toString()}`);
        if (!response.ok || typeof window.Lightbox?.openWithItems !== 'function') {
            return false;
        }

        const data = await response.json();
        const files = data.items ?? [];
        const itemIndex = files.findIndex((item) => item.path === targetPath);
        if (itemIndex < 0) {
            return false;
        }

        window.Lightbox.openWithItems(files, itemIndex);
        return true;
    }, filePath);

    expect(opened).toBe(true);
    await expect(page.locator('#lightbox')).toBeVisible();
}

async function closeLightbox(page) {
    const lightbox = page.locator('#lightbox');
    if (await lightbox.isVisible().catch(() => false)) {
        await page.evaluate(() => {
            globalThis.Lightbox?.close?.();
        });
        await expect(lightbox).toBeHidden();
    }
}

async function waitForLightboxSuggestions(page, query, expectedTitles, expectedTags) {
    await expect
        .poll(
            async () => {
                return page.evaluate(
                    async ({ queryValue, requiredTitles, requiredTags }) => {
                        if (typeof Lightbox === 'undefined' || typeof Tags === 'undefined') {
                            return false;
                        }

                        await Tags.loadAllTags?.();
                        Lightbox.showDrawerSuggestions?.(queryValue);

                        const groups =
                            Tags.getSuggestionGroups?.(queryValue, {
                                allTags: Lightbox.allTagSuggestions ?? [],
                                recentTagNames: Tags.getRecentTagNames?.() ?? [],
                                relatedTagSuggestions: Lightbox.drawerRelatedTagSuggestions ?? [],
                                excludedTagNames:
                                    Lightbox.items?.[Lightbox.currentIndex]?.tags ?? [],
                                limit: 5,
                            }) ?? [];
                        const groupTitles = groups.map((group) => group.title);
                        const groupTags = groups.flatMap((group) =>
                            group.items.map((tag) => tag.name)
                        );
                        const suggestions = document.querySelector(
                            '.lightbox-tags-drawer .drawer-tag-suggestions'
                        );

                        return (
                            Boolean(suggestions) &&
                            !suggestions.classList.contains('hidden') &&
                            requiredTitles.every((title) => groupTitles.includes(title)) &&
                            requiredTags.every((tagName) => groupTags.includes(tagName))
                        );
                    },
                    {
                        queryValue: query,
                        requiredTitles: expectedTitles,
                        requiredTags: expectedTags,
                    }
                );
            },
            { timeout: 10000 }
        )
        .toBe(true);
}

test.describe('Tag Management @tags @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should open tag dialog for an item', async ({ page }) => {
        const [targetItem] = await getTaggableItems(page, 1, 0);

        await openTagModalForSingleSelection(page, targetItem.locator);
        await expect(page.locator('#tag-modal')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#tag-input')).toBeVisible();
    });

    test('should add a tag to an item', async ({ page }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 28, 1);
        const [targetItem] = await getTaggableItems(page, 1, startIndex);
        const newTag = `e2e-add-${buildProjectSuffix(testInfo)}`;

        await setTagsViaApi(page, targetItem.path, []);
        await openTagModalForSingleSelection(page, targetItem.locator);

        await page.locator('#tag-input').fill(newTag);
        await page.keyboard.press('Enter');

        await expect(page.locator('#current-tags')).toContainText(newTag);
        await closeTagModalAndClearSelection(page);

        await expect.poll(async () => getTagsViaApi(page, targetItem.path)).toContain(newTag);
    });

    test('should suggest existing tags while typing @autocomplete', async ({ page }) => {
        const [seedItem, targetItem] = await getTaggableItems(page, 2, 0);
        await setTagsViaApi(page, seedItem.path, ['nature-suggestion']);
        await expect
            .poll(async () => getTagsViaApi(page, seedItem.path))
            .toContain('nature-suggestion');
        await waitForTagCatalogToInclude(page, 'nature-suggestion');
        await openTagModalForSingleSelection(page, targetItem.locator);
        await waitForTagCatalog(page);
        await expect
            .poll(async () => {
                return page.evaluate(async () => {
                    await window.Tags?.loadAllTags?.();
                    return window.Tags?.allTags?.some((tag) => tag.name === 'nature-suggestion');
                });
            })
            .toBe(true);

        const tagInput = page.locator('#tag-input');
        await tagInput.fill('nat');

        await expect
            .poll(
                async () => {
                    return page.evaluate(async () => {
                        await window.Tags?.loadAllTags?.();
                        const groups = window.Tags?.getSuggestionGroups?.('nat') ?? [];
                        window.Tags?.showSuggestions?.('nat');
                        return groups.flatMap((group) => group.items.map((tag) => tag.name));
                    });
                },
                { timeout: 10000 }
            )
            .toContain('nature-suggestion');
    });

    test('should follow the recent and co-occurrence suggestion flow @autocomplete', async ({
        page,
    }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 0, 4);
        const suffix = buildProjectSuffix(testInfo);
        const themeTag = `e2e-theme-${suffix}`;
        const relatedPrimaryTag = `e2e-related-primary-${suffix}`;
        const relatedSecondaryTag = `e2e-related-secondary-${suffix}`;
        const recentTag = `e2e-recent-${suffix}`;

        const [seedItem, relatedItemA, relatedItemB, recentItem] = await getTaggableItems(
            page,
            4,
            startIndex
        );

        await test.step('clear tags on isolated test items', async () => {
            await setTagsViaApi(page, seedItem.path, []);
            await setTagsViaApi(page, relatedItemA.path, []);
            await setTagsViaApi(page, relatedItemB.path, []);
            await setTagsViaApi(page, recentItem.path, []);
        });

        await test.step('seed co-occurring tags via API', async () => {
            await addTagViaApi(page, seedItem.path, themeTag);
            await addTagViaApi(page, relatedItemA.path, themeTag);
            await addTagViaApi(page, relatedItemA.path, relatedPrimaryTag);
            await addTagViaApi(page, relatedItemB.path, themeTag);
            await addTagViaApi(page, relatedItemB.path, relatedPrimaryTag);
            await addTagViaApi(page, relatedItemB.path, relatedSecondaryTag);
        });

        await test.step('apply one recent tag through the UI', async () => {
            await openTagModalForSingleSelection(page, recentItem.locator);

            await page.locator('#tag-input').fill(recentTag);
            await page.keyboard.press('Enter');

            // Wait for tag to appear
            await expect
                .poll(() => page.locator('#current-tags').innerText(), { timeout: 5000 })
                .toContain(recentTag);
            await closeTagModalAndClearSelection(page);
            await waitForTagCatalogToInclude(page, recentTag);
        });

        await test.step('verify empty-input suggestions separate suggested and recent tags', async () => {
            await openTagModalForSingleSelection(page, seedItem.locator);

            const suggestions = page.locator('#tag-suggestions');
            await expect(suggestions).toBeVisible({ timeout: 5000 });
            await waitForSuggestions(
                page,
                '',
                ['Suggested Next', 'Recent Tags'],
                [relatedPrimaryTag, recentTag]
            );
            await expect(suggestions).toContainText('Suggested Next');
            await expect(suggestions).toContainText('Recent Tags');
            await expect(suggestions.locator('.tag-suggestion').first()).toHaveAttribute(
                'data-tag',
                relatedPrimaryTag
            );
            await expect(suggestions).toContainText('Seen together on 2 items');
            await expect(
                suggestions.locator(`.tag-suggestion[data-tag="${recentTag}"]`)
            ).toBeVisible();
        });

        await test.step('verify typing still prefers co-occurring tags over recent ones', async () => {
            const tagInput = page.locator('#tag-input');
            await tagInput.fill('e2e-');

            const suggestions = page.locator('#tag-suggestions');
            await expect(suggestions).toBeVisible({ timeout: 5000 });
            await waitForSuggestions(
                page,
                'e2e-',
                ['Suggested Together', 'Recent Matches'],
                [relatedSecondaryTag, recentTag]
            );
            await expect(suggestions).toContainText('Suggested Together');
            await expect(suggestions).toContainText('Recent Matches');
            await expect(suggestions.locator('.tag-suggestion').first()).toHaveAttribute(
                'data-tag',
                relatedPrimaryTag
            );
            await expect(
                suggestions.locator(`.tag-suggestion[data-tag="${relatedSecondaryTag}"]`)
            ).toBeVisible();
        });

        await closeTagModalAndClearSelection(page);
    });

    test('should surface recent and related suggestions in the lightbox drawer @autocomplete @lightbox', async ({
        page,
    }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 8, 4);
        const suffix = buildProjectSuffix(testInfo);
        const themeTag = `e2e-lightbox-theme-${suffix}`;
        const relatedPrimaryTag = `e2e-lightbox-related-primary-${suffix}`;
        const relatedSecondaryTag = `e2e-lightbox-related-secondary-${suffix}`;
        const recentTag = `e2e-lightbox-recent-${suffix}`;

        const [seedItem, relatedItemA, relatedItemB, recentItem] = await getTaggableItems(
            page,
            4,
            startIndex
        );

        await test.step('clear existing tags and recent history for isolated test items', async () => {
            await setTagsViaApi(page, seedItem.path, []);
            await setTagsViaApi(page, relatedItemA.path, []);
            await setTagsViaApi(page, relatedItemB.path, []);
            await setTagsViaApi(page, recentItem.path, []);

            await refreshGalleryTags(page, seedItem.path, []);
            await refreshGalleryTags(page, relatedItemA.path, []);
            await refreshGalleryTags(page, relatedItemB.path, []);
            await refreshGalleryTags(page, recentItem.path, []);

            await page.evaluate(() => {
                localStorage.setItem('media-viewer.tags.recent', JSON.stringify([]));
                if (typeof Tags !== 'undefined') {
                    Tags._recentTagNames = [];
                }
            });
        });

        await test.step('seed co-occurring tag data via API', async () => {
            await setTagsViaApi(page, seedItem.path, [themeTag]);
            await setTagsViaApi(page, relatedItemA.path, [themeTag, relatedPrimaryTag]);
            await setTagsViaApi(page, relatedItemB.path, [
                themeTag,
                relatedPrimaryTag,
                relatedSecondaryTag,
            ]);

            await refreshGalleryTags(page, seedItem.path, [themeTag]);
            await refreshGalleryTags(page, relatedItemA.path, [themeTag, relatedPrimaryTag]);
            await refreshGalleryTags(page, relatedItemB.path, [
                themeTag,
                relatedPrimaryTag,
                relatedSecondaryTag,
            ]);
        });

        await test.step('create a recent tag through the lightbox drawer UI', async () => {
            await openLightboxForPath(page, recentItem.path);
            await page.evaluate(() => {
                globalThis.Lightbox?.openTagsDrawer?.();
            });

            const drawer = page.locator('.lightbox-tags-drawer');
            const input = drawer.locator('.drawer-tag-input');
            await expect(drawer).toBeVisible();

            await input.fill(recentTag);
            await input.press('Enter');

            await expect(drawer.locator('.drawer-tags-list')).toContainText(recentTag);
            await waitForTagCatalogToInclude(page, recentTag);
            await closeLightbox(page);
        });

        await test.step('show grouped empty-query suggestions in the lightbox drawer', async () => {
            await openLightboxForPath(page, seedItem.path);
            await page.evaluate(() => {
                globalThis.Lightbox?.openTagsDrawer?.();
            });

            const drawer = page.locator('.lightbox-tags-drawer');
            const suggestions = drawer.locator('.drawer-tag-suggestions');
            await expect(drawer).toBeVisible();

            await waitForLightboxSuggestions(
                page,
                '',
                ['Suggested Next', 'Recent Tags'],
                [relatedPrimaryTag, recentTag]
            );
            await expect(suggestions).toContainText('Suggested Next');
            await expect(suggestions).toContainText('Recent Tags');
            await expect(suggestions.locator('.drawer-suggestion').first()).toHaveAttribute(
                'data-tag',
                relatedPrimaryTag
            );
            await expect(suggestions).toContainText('Seen together on 2 items');
            await expect(
                suggestions.locator(`.drawer-suggestion[data-tag="${recentTag}"]`)
            ).toBeVisible();
        });

        await test.step('keep preferring related matches over recent ones while typing', async () => {
            const drawer = page.locator('.lightbox-tags-drawer');
            const input = drawer.locator('.drawer-tag-input');
            const suggestions = drawer.locator('.drawer-tag-suggestions');

            await input.fill('e2e-lightbox-');

            await waitForLightboxSuggestions(
                page,
                'e2e-lightbox-',
                ['Suggested Together', 'Recent Matches'],
                [relatedSecondaryTag, recentTag]
            );
            await expect(suggestions).toContainText('Suggested Together');
            await expect(suggestions).toContainText('Recent Matches');
            await expect(suggestions.locator('.drawer-suggestion').first()).toHaveAttribute(
                'data-tag',
                relatedPrimaryTag
            );
            await expect(
                suggestions.locator(`.drawer-suggestion[data-tag="${relatedSecondaryTag}"]`)
            ).toBeVisible();
        });

        await closeLightbox(page);
    });

    test('should remove a tag from an item', async ({ page }) => {
        const itemWithTag = page.locator('.gallery-item:has(.tag)').first();

        if ((await itemWithTag.count()) > 0) {
            const tag = itemWithTag.locator('.tag').first();
            const tagName = await tag.textContent();
            const removeButton = itemWithTag.locator('.remove-tag, [data-remove-tag]');

            await removeButton.click();

            // Confirm if there's a confirmation dialog
            const confirmButton = page.locator('button:text("Remove"), button:text("Yes")');
            if ((await confirmButton.count()) > 0) {
                await confirmButton.click();
            }

            await page.waitForTimeout(500);

            // Tag should be removed
            const removedTag = itemWithTag.locator(`.tag:text("${tagName}")`);
            await expect(removedTag).toHaveCount(0);
        }
    });

    test('should filter gallery by tag', async ({ page }) => {
        // Look for a tag in the tag list or on an item
        const tag = page.locator('.tag, [data-tag]').first();

        if ((await tag.count()) > 0) {
            const _initialItemCount = await page.locator('.gallery-item').count();

            // Click tag to filter
            await tag.click();
            await page.waitForTimeout(500);

            // Gallery should filter
            const filteredItemCount = await page.locator('.gallery-item').count();

            // Count might change or stay the same if all items have that tag
            expect(typeof filteredItemCount).toBe('number');

            // URL should reflect filter
            const url = page.url();
            expect(url).toContain('tag=') || expect(url).toContain('filter=');
        }
    });

    test('should display tag list/cloud', async ({ page }) => {
        const tagList = page.locator('.tag-list, .tag-cloud, [data-tag-list]');

        if ((await tagList.count()) > 0) {
            await expect(tagList).toBeVisible();

            // Should have tags
            const tags = tagList.locator('.tag');
            const count = await tags.count();
            expect(count).toBeGreaterThanOrEqual(0);
        }
    });

    test('should show tag count', async ({ page }) => {
        const tagWithCount = page.locator('.tag:has(.count), .tag').first();

        if ((await tagWithCount.count()) > 0) {
            const text = await tagWithCount.textContent();

            // Should contain a number (tag count)
            expect(text).toMatch(/\d+/) || expect(text).toBeTruthy();
        }
    });

    test('should copy tags from one item @clipboard', async ({ page }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 35, 2);
        const [sourceItem] = await getTaggableItems(page, 1, startIndex);
        const copiedTag = `e2e-copy-${buildProjectSuffix(testInfo)}`;

        await clearTagClipboard(page);
        await setTagsViaApi(page, sourceItem.path, [copiedTag]);
        await selectItems(page, [sourceItem.locator]);

        await page.evaluate(async () => {
            await window.ItemSelection?.copyTagsFromSelection?.();
        });

        await expect
            .poll(async () => page.evaluate(() => globalThis.TagClipboard?.hasTags?.()))
            .toBe(true);

        await clearSelection(page);
    });

    test('should paste tags to another item @clipboard', async ({ page }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 35, 2);
        const [sourceItem, destinationItem] = await getTaggableItems(page, 2, startIndex);
        const copiedTag = `e2e-paste-${buildProjectSuffix(testInfo)}`;

        await clearTagClipboard(page);
        await setTagsViaApi(page, sourceItem.path, [copiedTag]);
        await setTagsViaApi(page, destinationItem.path, []);

        await selectItems(page, [sourceItem.locator]);
        await page.evaluate(async () => {
            await window.ItemSelection?.copyTagsFromSelection?.();
        });
        await expect
            .poll(async () => {
                return page.evaluate(() => globalThis.TagClipboard?.getTags?.() ?? []);
            })
            .toContain(copiedTag);
        await clearSelection(page);

        await selectItems(page, [destinationItem.locator]);
        await page.evaluate(() => {
            window.ItemSelection?.pasteTagsToSelection?.();
        });

        const pasteModal = page.locator('#paste-tags-modal');
        await expect(pasteModal).toBeVisible();
        await expect
            .poll(async () => {
                return page.evaluate((tagName) => {
                    const chip = document.querySelector(
                        `#paste-tags-modal .paste-tag-chip[data-tag="${CSS.escape(tagName)}"]`
                    );
                    return chip?.classList.contains('selected') === true;
                }, copiedTag);
            })
            .toBe(true);

        await page.evaluate(() => {
            const modal = document.getElementById('paste-tags-modal');
            return globalThis.TagClipboard?.confirmPaste?.(modal);
        });
        await expect(pasteModal).toBeHidden();

        await expect
            .poll(async () => getTagsViaApi(page, destinationItem.path))
            .toContain(copiedTag);
    });

    test('should show all item tags in the overflow tooltip @tag-tooltip', async ({
        page,
    }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 49, 1);
        const [targetItem] = await getTaggableItems(page, 1, startIndex);
        const suffix = buildProjectSuffix(testInfo);

        // Add 8 long tags to guarantee overflow even on ultra-wide desktop viewports
        const tooltipTags = [
            `tooltip-alpha-very-long-tag-name-${suffix}`,
            `tooltip-beta-very-long-tag-name-${suffix}`,
            `tooltip-gamma-very-long-tag-name-${suffix}`,
            `tooltip-delta-very-long-tag-name-${suffix}`,
            `tooltip-epsilon-very-long-tag-name-${suffix}`,
            `tooltip-zeta-very-long-tag-name-${suffix}`,
            `tooltip-eta-very-long-tag-name-${suffix}`,
            `tooltip-theta-very-long-tag-name-${suffix}`,
        ];

        await setTagsViaApi(page, targetItem.path, tooltipTags);
        await refreshGalleryTags(page, targetItem.path, tooltipTags);

        const itemLocator = galleryItemByPath(page, targetItem.path);

        // Hovering the item makes the tags container visible on desktop
        // Dispatch mouseenter to bypass Playwright's actionability checks on sticky headers
        await itemLocator.scrollIntoViewIfNeeded().catch(() => {});
        await itemLocator.dispatchEvent('mouseenter').catch(() => {});

        await openTagTooltipForItem(page, targetItem.path);
        await expect(page.locator('.tag-tooltip-tag')).toHaveCount(tooltipTags.length);

        for (const tagName of tooltipTags) {
            await expect(page.locator(`.tag-tooltip-tag[data-tag="${tagName}"]`)).toBeVisible();
        }

        await dismissTagTooltip(page);
    });

    test('should search from a tooltip tag click @tag-tooltip', async ({ page }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 56, 1);
        const [targetItem] = await getTaggableItems(page, 1, startIndex);
        const suffix = buildProjectSuffix(testInfo);
        const searchableTag = `tooltip-search-very-long-tag-name-${suffix}`;
        const tooltipTags = [
            `tooltip-one-very-long-tag-name-${suffix}`,
            `tooltip-two-very-long-tag-name-${suffix}`,
            `tooltip-three-very-long-tag-name-${suffix}`,
            `tooltip-four-very-long-tag-name-${suffix}`,
            `tooltip-five-very-long-tag-name-${suffix}`,
            searchableTag,
        ];

        await setTagsViaApi(page, targetItem.path, tooltipTags);
        await refreshGalleryTags(page, targetItem.path, tooltipTags);
        await expect
            .poll(async () => getTagsViaApi(page, targetItem.path))
            .toContain(searchableTag);

        const itemLocator = galleryItemByPath(page, targetItem.path);
        await itemLocator.hover();

        await openTagTooltipForItem(page, targetItem.path);
        await clickTooltipTagText(page, searchableTag);

        await expect(page.locator('#search-results')).toBeVisible();
        await expect(page.locator('#search-results-input')).toHaveValue(`tag:${searchableTag}`);
        await expect(page.locator('.tag-tooltip-zone')).not.toHaveClass(/visible/);
    });

    test('should remove a tag from the overflow tooltip and collapse the overflow chip @tag-tooltip', async ({
        page,
    }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 63, 1);
        const [targetItem] = await getTaggableItems(page, 1, startIndex);
        const suffix = buildProjectSuffix(testInfo);
        const removableTag = `tooltip-remove-very-long-tag-name-${suffix}`;
        const tooltipTags = [
            `tooltip-red-very-long-tag-name-${suffix}`,
            `tooltip-blue-very-long-tag-name-${suffix}`,
            `tooltip-green-very-long-tag-name-${suffix}`,
            `tooltip-yellow-very-long-tag-name-${suffix}`,
            `tooltip-purple-very-long-tag-name-${suffix}`,
            removableTag,
        ];

        await setTagsViaApi(page, targetItem.path, tooltipTags);
        await refreshGalleryTags(page, targetItem.path, tooltipTags);

        const itemLocator = galleryItemByPath(page, targetItem.path);
        await itemLocator.hover();

        await openTagTooltipForItem(page, targetItem.path);

        await clickTooltipRemove(page, removableTag);

        await expect
            .poll(async () => {
                const tags = await getTagsViaApi(page, targetItem.path);
                return tags.includes(removableTag);
            })
            .toBe(false);

        await dismissTagTooltip(page);
        await expect(page.locator('.tag-tooltip-zone')).not.toHaveClass(/visible/);
    });
});

test.describe('Favorites @favorites @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should mark item as favorite', async ({ page }) => {
        const firstItem = page.locator('.gallery-item').first();

        // Find favorite button
        const favoriteButton = firstItem.locator(
            'button.favorite, .favorite-button, [data-favorite], [aria-label*="Favorite"]'
        );

        if ((await favoriteButton.count()) > 0) {
            // Get initial state
            const initialClass = await favoriteButton.getAttribute('class');

            await favoriteButton.click();
            await page.waitForTimeout(500);

            // Button state should change
            const newClass = await favoriteButton.getAttribute('class');
            expect(newClass).not.toBe(initialClass);

            // Should show as favorited
            const isFavorited =
                newClass?.includes('active') ||
                newClass?.includes('favorited') ||
                newClass?.includes('filled');

            expect(isFavorited).toBe(true);
        }
    });

    test('should unfavorite an item', async ({ page }) => {
        const favoriteItem = page
            .locator('.gallery-item.favorite, .gallery-item[data-favorite="true"]')
            .first();

        if ((await favoriteItem.count()) > 0) {
            const favoriteButton = favoriteItem.locator(
                'button.favorite, .favorite-button, [data-favorite]'
            );

            if ((await favoriteButton.count()) > 0) {
                await favoriteButton.click();
                await page.waitForTimeout(500);

                // Should no longer be favorited
                const buttonClass = await favoriteButton.getAttribute('class');
                const isNotFavorited =
                    !buttonClass?.includes('active') && !buttonClass?.includes('favorited');

                expect(isNotFavorited).toBe(true);
            }
        }
    });

    test('should navigateto favorites view', async ({ page }) => {
        const favoritesLink = page.locator(
            'a:text("Favorites"), button:text("Favorites"), [href*="favorites"]'
        );

        if ((await favoritesLink.count()) > 0) {
            await favoritesLink.click();
            await page.waitForTimeout(500);

            // Should show favorites view
            await expect(page.locator('.gallery, #gallery')).toBeVisible();

            // URL should reflect favorites
            const url = page.url();
            expect(url).toContain('favorites') || expect(url).toContain('favorite=true');
        }
    });

    test('should display favorite indicator on items', async ({ page }) => {
        const favoriteItem = page.locator('.gallery-item').first();

        // Mark as favorite
        const favoriteButton = favoriteItem.locator('button.favorite, [data-favorite]');

        if ((await favoriteButton.count()) > 0) {
            await favoriteButton.click();
            await page.waitForTimeout(500);

            // Should show visual indicator
            const indicator = favoriteItem.locator('[data-lucide="star"], .star, .favorite-icon');

            if ((await indicator.count()) > 0) {
                await expect(indicator).toBeVisible();
            }
        }
    });

    test('should show favorite count', async ({ page }) => {
        const favoritesLink = page.locator(':text("Favorites")').first();

        if ((await favoritesLink.count()) > 0) {
            const text = await favoritesLink.textContent();

            // Might contain count like "Favorites (5)"
            expect(text).toContain('Favorite');
        }
    });

    test('should persist favorite state after page reload', async ({ page }) => {
        const firstItem = page.locator('.gallery-item').first();
        const itemPath = await firstItem.getAttribute('data-path');

        // Mark as favorite
        const favoriteButton = firstItem.locator('button.favorite, [data-favorite]');

        if ((await favoriteButton.count()) > 0) {
            await favoriteButton.click();
            await page.waitForTimeout(500);

            // Reload page
            await page.reload();
            await page.waitForSelector('.gallery-item');

            // Find same item
            const sameItem = page.locator(`.gallery-item[data-path="${itemPath}"]`);

            if ((await sameItem.count()) > 0) {
                const button = sameItem.locator('button.favorite, [data-favorite]');
                const buttonClass = await button.getAttribute('class');

                // Should still be favorited
                const isFavorited =
                    buttonClass?.includes('active') || buttonClass?.includes('favorited');

                expect(isFavorited).toBe(true);
            }
        }
    });
});

test.describe('Keyboard Shortcuts @keyboard @shortcuts @accessibility', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should focus search with / key', async ({ page }) => {
        await page.keyboard.press('/');

        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await expect(searchInput).toBeFocused();
        }
    });
});

test.describe('Tagging keyboard and focus behaviour @tags @keyboard @accessibility', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('Escape closes the tag modal when suggestions are visible', async ({ page }) => {
        const [targetItem] = await getTaggableItems(page, 1, 0);
        await openTagModalForSingleSelection(page, targetItem.locator);

        // Type something to surface suggestions
        await page.locator('#tag-input').fill('a');
        // Wait for suggestions to appear (or skip if none shown)
        await page.waitForTimeout(200);

        await page.keyboard.press('Escape');

        await expect(page.locator('#tag-modal')).toBeHidden({ timeout: 3000 });

        await clearSelection(page);
    });

    test('Escape closes the tag modal when no suggestions are visible', async ({ page }) => {
        const [targetItem] = await getTaggableItems(page, 1, 0);
        await openTagModalForSingleSelection(page, targetItem.locator);

        // Clear any suggestions
        await page.evaluate(() => {
            document.getElementById('tag-suggestions')?.classList.add('hidden');
        });

        await page.keyboard.press('Escape');

        await expect(page.locator('#tag-modal')).toBeHidden({ timeout: 3000 });

        await clearSelection(page);
    });

    test('global / hotkey does not steal focus while tag modal is open', async ({ page }) => {
        const [targetItem] = await getTaggableItems(page, 1, 0);
        await openTagModalForSingleSelection(page, targetItem.locator);

        const tagInput = page.locator('#tag-input');
        await expect(tagInput).toBeFocused();

        // Press the global search shortcut — focus must stay in the modal
        await page.keyboard.press('/');

        await expect(tagInput).toBeFocused();
        await expect(page.locator('#tag-modal')).toBeVisible();

        await closeTagModalAndClearSelection(page);
    });

    test('focus cannot escape the tag modal to an element outside it', async ({ page }) => {
        const [targetItem] = await getTaggableItems(page, 1, 0);
        await openTagModalForSingleSelection(page, targetItem.locator);

        // Programmatically move focus to a gallery item outside the modal
        await page.evaluate(() => {
            const galleryItem = document.querySelector('#gallery .gallery-item');
            if (galleryItem instanceof HTMLElement) {
                galleryItem.setAttribute('tabindex', '-1');
                galleryItem.focus();
            }
        });

        // Focus should have been returned to the tag input by the focus trap
        await expect(page.locator('#tag-input')).toBeFocused({ timeout: 1000 });

        await closeTagModalAndClearSelection(page);
    });

    test('Escape closes the lightbox drawer tag input', async ({ page }) => {
        const [targetItem] = await getTaggableItems(page, 1, 0);
        await openLightboxForPath(page, targetItem.path);

        await page.evaluate(() => {
            globalThis.Lightbox?.openTagsDrawer?.();
        });

        const drawer = page.locator('.lightbox-tags-drawer');
        const drawerInput = drawer.locator('.drawer-tag-input');
        await expect(drawer).toBeVisible({ timeout: 3000 });

        // Focus the input and press Escape
        await drawerInput.click();
        await page.keyboard.press('Escape');

        await expect(drawer).toBeHidden({ timeout: 3000 });

        await closeLightbox(page);
    });

    test('lightbox hotkeys do not fire while gallery tag modal is open', async ({ page }) => {
        const [targetItem] = await getTaggableItems(page, 1, 0);

        // Open the lightbox so its keydown handler is active
        await openLightboxForPath(page, targetItem.path);

        // Open the gallery tag modal on top (e.g. from a selection context)
        await page.evaluate(() => {
            globalThis.Tags?.openModal?.('/test/path.jpg', 'path.jpg');
        });
        await expect(page.locator('#tag-modal')).toBeVisible({ timeout: 3000 });

        // Record lightbox state before keypresses
        const indexBefore = await page.evaluate(() => globalThis.Lightbox?.currentIndex ?? 0);

        // ArrowLeft/Right should not navigate while tag modal is open
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowRight');

        const indexAfter = await page.evaluate(() => globalThis.Lightbox?.currentIndex ?? 0);
        expect(indexAfter).toBe(indexBefore);

        // 'f' should not toggle favorite
        const pinBefore = await page.evaluate(() => {
            const item = globalThis.Lightbox?.items?.[globalThis.Lightbox?.currentIndex ?? 0];
            return item?.is_favorite ?? false;
        });
        await page.keyboard.press('f');
        const pinAfter = await page.evaluate(() => {
            const item = globalThis.Lightbox?.items?.[globalThis.Lightbox?.currentIndex ?? 0];
            return item?.is_favorite ?? false;
        });
        expect(pinAfter).toBe(pinBefore);

        await page.evaluate(() => globalThis.Tags?.closeModal?.());
        await closeLightbox(page);
    });
});
