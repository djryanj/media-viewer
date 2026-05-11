import { test, expect } from '../../fixtures/index.js';

const BASELINE_ITEM_COUNT = 120;
const BASELINE_TARGET_INDEX = 80;
const DEEP_ITEM_COUNT = 4000;
const DEEP_TARGET_INDEX = 3200;
const SELECTION_SIZE = 3;
const DEGRADATION_FACTOR = 4;
const DURATION_RATIO_FLOOR_MS = 0.25;
const SUGGESTION_RATIO_FLOOR_MS = 16;
const NEW_BULK_TAG = 'perf-bulk-added-tag';
const SUGGESTION_QUERY = 'sug';
const COARSE_POINTER_PROJECTS = new Set([
    'mobile-chrome',
    'mobile-safari',
    'tablet',
    'android-firefox',
]);
const THUMBNAIL_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0KkAAAAASUVORK5CYII=';
const CATALOG_TAGS = [
    'common-tag',
    'seed-tag',
    'focus-tag',
    'suggested-alpha',
    'suggested-beta',
    'suggested-gamma',
    NEW_BULK_TAG,
];
const RELATED_SUGGESTIONS = [
    { name: 'suggested-alpha', itemCount: 8, relatedCount: 4 },
    { name: 'suggested-beta', itemCount: 6, relatedCount: 3 },
    { name: 'suggested-gamma', itemCount: 5, relatedCount: 2 },
];

function syntheticPath(scenarioId, index) {
    return `/__perf__/${scenarioId}/item-${index}.jpg`;
}

function createSyntheticApiState() {
    return {
        catalogTags: [...CATALOG_TAGS],
        relatedSuggestions: [...RELATED_SUGGESTIONS],
        tagsByPath: new Map(),
    };
}

function parseRouteJson(route) {
    const payload = route.request().postData();
    return payload ? JSON.parse(payload) : {};
}

function buildScenario(id, totalItems, targetIndex) {
    return {
        id,
        totalItems,
        targetIndex,
        selectionIndices: Array.from(
            { length: SELECTION_SIZE },
            (_, offset) => targetIndex + offset
        ),
    };
}

function primeScenarioTagState(apiState, scenario) {
    apiState.catalogTags = [...CATALOG_TAGS];
    apiState.relatedSuggestions = [...RELATED_SUGGESTIONS];
    apiState.tagsByPath = new Map();

    for (const [offset, index] of scenario.selectionIndices.entries()) {
        const tags = ['common-tag'];
        if (offset < 2) {
            tags.push('seed-tag');
        }
        if (offset === 0) {
            tags.push('focus-tag');
        }
        apiState.tagsByPath.set(syntheticPath(scenario.id, index), tags);
    }
}

async function getSeedMediaItem(page) {
    const response = await page.request.get('/api/media?path=&sort=name&order=asc');
    expect(response.ok(), 'loading root media for synthetic perf seed should succeed').toBe(true);

    const payload = await response.json();
    const items = payload?.items || [];
    const item = items.find((entry) => entry?.type === 'image' || entry?.type === 'video');

    expect(
        item,
        'expected at least one media item for synthetic performance fixtures'
    ).toBeTruthy();
    return item;
}

async function installSyntheticTagApiMocks(page, apiState) {
    await page.route(/\/api\/thumbnails\/.*__perf__\//, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from(THUMBNAIL_PNG_BASE64, 'base64'),
        });
    });

    await page.route(/\/api\/tags(?:\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') {
            await route.fallback();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                apiState.catalogTags.map((name, index) => ({
                    name,
                    itemCount: Math.max(1, apiState.catalogTags.length - index),
                }))
            ),
        });
    });

    await page.route('**/api/tags/query', async (route) => {
        const { paths = [] } = parseRouteJson(route);
        const isSyntheticRequest =
            Array.isArray(paths) && paths.every((path) => path.includes('/__perf__/'));
        if (!isSyntheticRequest) {
            await route.fallback();
            return;
        }

        const payload = {};
        for (const path of paths) {
            payload[path] = [...(apiState.tagsByPath.get(path) || [])];
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(payload),
        });
    });

    await page.route('**/api/tags/suggestions', async (route) => {
        const { exclude = [] } = parseRouteJson(route);
        const excluded = new Set(exclude);
        const suggestions = apiState.relatedSuggestions.filter((tag) => !excluded.has(tag.name));

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(suggestions),
        });
    });

    await page.route('**/api/tags/bulk', async (route) => {
        const request = route.request();
        const { paths = [], tag } = parseRouteJson(route);
        const isSyntheticRequest =
            Array.isArray(paths) && paths.every((path) => path.includes('/__perf__/'));
        if (!isSyntheticRequest) {
            await route.fallback();
            return;
        }

        const tagsByPath = {};
        for (const path of paths) {
            const nextTags = new Set(apiState.tagsByPath.get(path) || []);
            if (request.method() === 'POST' && tag) {
                nextTags.add(tag);
            }
            if (request.method() === 'DELETE' && tag) {
                nextTags.delete(tag);
            }

            const finalized = [...nextTags].sort();
            apiState.tagsByPath.set(path, finalized);
            tagsByPath[path] = finalized;
        }

        if (request.method() === 'POST' && tag && !apiState.catalogTags.includes(tag)) {
            apiState.catalogTags = [...apiState.catalogTags, tag];
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: paths.length,
                tagsByPath,
            }),
        });
    });
}

async function prepareSyntheticGallery(page, seedItem, scenario) {
    return page.evaluate(
        async ({ item, scenarioConfig }) => {
            const waitFrames = async (count = 2) => {
                for (let index = 0; index < count; index++) {
                    await new Promise((resolve) => requestAnimationFrame(resolve));
                }
            };

            const syntheticItems = Array.from(
                { length: scenarioConfig.totalItems },
                (_, index) => ({
                    ...item,
                    path: `/__perf__/${scenarioConfig.id}/item-${index}.jpg`,
                    name: `${scenarioConfig.id}-item-${index}.jpg`,
                    isFavorite: false,
                    tags: [],
                })
            );

            if (
                typeof Tags !== 'undefined' &&
                !Tags.elements?.tagModal?.classList.contains('hidden')
            ) {
                Tags.closeModal();
            }
            if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
                ItemSelection.exitSelectionMode();
            }

            InfiniteScroll.resetState();
            MediaApp.state.mediaFiles = syntheticItems;
            InfiniteScroll.state.totalItems = syntheticItems.length;
            InfiniteScroll.state.loadedItems = syntheticItems;
            InfiniteScroll.state.hasMore = false;
            InfiniteScroll.state.currentPage = Math.ceil(
                syntheticItems.length / InfiniteScroll.config.batchSize
            );

            InfiniteScroll.renderItems(syntheticItems, false);
            InfiniteScroll.updateStats();
            InfiniteScroll.updateVirtualSpacer();
            InfiniteScroll.updateScrollScrubber();
            window.scrollTo({ top: 0, behavior: 'instant' });
            await waitFrames(2);

            InfiniteScroll._scrollToLoadedItem(scenarioConfig.targetIndex + 1);
            InfiniteScroll.scheduleRenderWindowUpdate(true);
            await waitFrames(3);

            const mountedItems = document.querySelectorAll(
                '#gallery .gallery-item:not(.skeleton)'
            ).length;
            const selectionPaths = scenarioConfig.selectionIndices.map(
                (index) => syntheticItems[index].path
            );

            return {
                totalItems: syntheticItems.length,
                mountedItems,
                windowed: mountedItems < syntheticItems.length,
                selectionPaths,
            };
        },
        { item: seedItem, scenarioConfig: scenario }
    );
}

async function measureBulkTagModalFlow(page, scenario) {
    return page.evaluate(
        async ({ scenarioConfig, newTag, suggestionQuery }) => {
            const waitFrames = async (count = 2) => {
                for (let index = 0; index < count; index++) {
                    await new Promise((resolve) => requestAnimationFrame(resolve));
                }
            };

            const waitUntil = async (predicate, timeoutMs = 5000) => {
                const startedAt = performance.now();
                while (performance.now() - startedAt < timeoutMs) {
                    if (predicate()) {
                        return;
                    }
                    await waitFrames(1);
                }
                throw new Error('Timed out waiting for tag modal state');
            };

            const selectionPaths = scenarioConfig.selectionIndices.map(
                (index) => `/__perf__/${scenarioConfig.id}/item-${index}.jpg`
            );

            if (typeof Tags === 'undefined' || typeof ItemSelection === 'undefined') {
                throw new Error('Tags or ItemSelection module is not available');
            }

            await Tags.loadAllTags();
            await waitFrames(2);

            const elements = selectionPaths.map((path) => {
                const element =
                    InfiniteScroll._galleryItemsByPath?.get(path) ||
                    document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
                if (!element) {
                    throw new Error(`Expected mounted gallery item for ${path}`);
                }
                return element;
            });

            if (ItemSelection.isActive) {
                ItemSelection.exitSelectionMode();
                await waitFrames(2);
            }

            ItemSelection.enterSelectionMode(elements[0]);
            for (const element of elements.slice(1)) {
                ItemSelection.toggleItem(element);
            }
            ItemSelection.updateToolbar();
            ItemSelection.elements?.toolbar?.classList.remove('hidden');

            const openStartedAt = performance.now();
            ItemSelection.openBulkTagModal();
            await waitUntil(() => {
                return (
                    !Tags.elements.tagModal.classList.contains('hidden') &&
                    Tags.elements.currentTags.querySelectorAll('.tag-chip').length > 0
                );
            });
            await waitFrames(2);
            const openDuration = performance.now() - openStartedAt;

            Tags.elements.tagInput.value = suggestionQuery;
            const suggestionStartedAt = performance.now();
            Tags.showSuggestions(suggestionQuery);
            await waitFrames(1);
            const suggestionDuration = performance.now() - suggestionStartedAt;

            const suggestionCount =
                Tags.elements.tagSuggestions.querySelectorAll('.tag-suggestion').length;

            Tags.elements.tagInput.value = newTag;
            const addStartedAt = performance.now();
            await Tags.addTagFromInput();
            await waitFrames(2);
            const addDuration = performance.now() - addStartedAt;

            const currentTagCount = Tags.elements.currentTags.querySelectorAll('.tag-chip').length;
            const mountedItems = document.querySelectorAll(
                '#gallery .gallery-item:not(.skeleton)'
            ).length;
            const selectedCount = ItemSelection.selectedPaths.size;
            const addedToAll = selectionPaths.every((path) => {
                const currentTag = Tags.tagSources?.get(newTag);
                return Array.isArray(currentTag)
                    ? currentTag.length === selectionPaths.length
                    : false;
            });

            Tags.closeModal();
            ItemSelection.exitSelectionMode();

            return {
                openDuration,
                suggestionDuration,
                addDuration,
                suggestionCount,
                currentTagCount,
                mountedItems,
                selectedCount,
                addedToAll,
            };
        },
        {
            scenarioConfig: scenario,
            newTag: NEW_BULK_TAG,
            suggestionQuery: SUGGESTION_QUERY,
        }
    );
}

function safeRatio(numerator, denominator, floorMs = DURATION_RATIO_FLOOR_MS) {
    return numerator / Math.max(denominator, floorMs);
}

test.describe('Tag Modal Performance @tags @performance @slow', () => {
    test.describe.configure({ mode: 'serial' });

    test('bulk tag modal remains responsive deep in a large loaded gallery', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        test.skip(
            COARSE_POINTER_PROJECTS.has(testInfo.project.name),
            'Loaded-item windowing is intentionally disabled on coarse-pointer projects; this regression is covered by fine-pointer browsers only'
        );

        await loginHelpers.login(page);

        const apiState = createSyntheticApiState();
        await installSyntheticTagApiMocks(page, apiState);

        const seedItem = await getSeedMediaItem(page);
        const baselineScenario = buildScenario(
            'baseline',
            BASELINE_ITEM_COUNT,
            BASELINE_TARGET_INDEX
        );
        const deepScenario = buildScenario('deep', DEEP_ITEM_COUNT, DEEP_TARGET_INDEX);

        primeScenarioTagState(apiState, baselineScenario);
        const baselineGallery = await prepareSyntheticGallery(page, seedItem, baselineScenario);
        const baselineMetrics = await measureBulkTagModalFlow(page, baselineScenario);

        primeScenarioTagState(apiState, deepScenario);
        const deepGallery = await prepareSyntheticGallery(page, seedItem, deepScenario);
        const deepMetrics = await measureBulkTagModalFlow(page, deepScenario);

        console.log('Tag modal performance baseline:', {
            gallery: baselineGallery,
            metrics: baselineMetrics,
        });
        console.log('Tag modal performance deep gallery:', {
            gallery: deepGallery,
            metrics: deepMetrics,
        });

        expect(baselineGallery.windowed).toBe(false);
        expect(deepGallery.windowed).toBe(true);
        expect(deepGallery.mountedItems).toBeLessThan(deepGallery.totalItems);
        expect(baselineMetrics.selectedCount).toBe(SELECTION_SIZE);
        expect(deepMetrics.selectedCount).toBe(SELECTION_SIZE);
        expect(baselineMetrics.suggestionCount).toBeGreaterThan(0);
        expect(deepMetrics.suggestionCount).toBeGreaterThan(0);
        expect(deepMetrics.currentTagCount).toBeGreaterThan(0);
        expect(deepMetrics.addedToAll).toBe(true);

        const openRatio = safeRatio(deepMetrics.openDuration, baselineMetrics.openDuration);
        const suggestionRatio = safeRatio(
            deepMetrics.suggestionDuration,
            baselineMetrics.suggestionDuration,
            SUGGESTION_RATIO_FLOOR_MS
        );
        const addRatio = safeRatio(deepMetrics.addDuration, baselineMetrics.addDuration);

        console.log('Tag modal performance ratios:', {
            openRatio,
            suggestionRatio,
            addRatio,
        });

        expect(
            openRatio,
            `deep-gallery modal open degraded ${openRatio.toFixed(2)}x versus baseline`
        ).toBeLessThan(DEGRADATION_FACTOR);
        expect(
            suggestionRatio,
            `deep-gallery suggestion render degraded ${suggestionRatio.toFixed(2)}x versus baseline`
        ).toBeLessThan(DEGRADATION_FACTOR);
        expect(
            addRatio,
            `deep-gallery bulk add degraded ${addRatio.toFixed(2)}x versus baseline`
        ).toBeLessThan(DEGRADATION_FACTOR);
    });
});
