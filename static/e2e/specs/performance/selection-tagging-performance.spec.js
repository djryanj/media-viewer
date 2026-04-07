// e2e/specs/performance/selection-tagging-performance.spec.js
/**
 * Performance tests for the realistic selection + tagging workflow.
 *
 * These tests replicate the exact user workflow where slowdown was
 * reported: selecting items, applying/copying/pasting tags, then
 * selecting more items. The slowdown manifests during the selection
 * phase that follows tag operations.
 *
 * The tests measure selection performance at each stage of the workflow
 * to identify whether performance degrades as tag state accumulates.
 */

import { test, expect } from '../../fixtures/index.js';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const PER_ITEM_THRESHOLD_MS = 8;
const DEGRADATION_FACTOR = 3;
const MIN_ITEMS = 250;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Log in and load at least MIN_ITEMS into the gallery via InfiniteScroll.
 */
async function setupGallery(page, loginHelpers) {
    await loginHelpers.login(page);
    await page.waitForSelector('.gallery-item:not(.skeleton)', {
        state: 'visible',
        timeout: 30_000,
    });
    await page.waitForTimeout(500);

    const finalCount = await page.evaluate(async (minItems) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        if (typeof InfiniteScroll === 'undefined') {
            return document.querySelectorAll('.gallery-item:not(.skeleton)').length;
        }

        for (let attempt = 0; attempt < 20; attempt++) {
            const loaded = InfiniteScroll.state.loadedItems.length;
            if (loaded >= minItems || !InfiniteScroll.state.hasMore) break;

            while (InfiniteScroll.state.isLoading) {
                await sleep(100);
            }

            await InfiniteScroll.loadMore();
            await sleep(200);
        }

        while (InfiniteScroll.state.isLoading) {
            await sleep(100);
        }

        return document.querySelectorAll('.gallery-item:not(.skeleton)').length;
    }, MIN_ITEMS);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);

    return finalCount;
}

/**
 * Enter selection mode on the first gallery item.
 */
async function enterSelectionMode(page) {
    await page.evaluate(() => {
        const first = document.querySelector('.gallery-item:not(.skeleton)');
        if (!first) throw new Error('No gallery items found');
        ItemSelection.enterSelectionMode(first);
    });

    await expect
        .poll(async () => {
            return page.evaluate(() => {
                const selection = window.ItemSelection;

                return selection?.isActive === true && selection.selectedPaths?.size === 1;
            });
        })
        .toBe(true);

    await page.evaluate(() => {
        const selection = window.ItemSelection;
        selection?.updateToolbar?.();
        selection?.elements?.toolbar?.classList.remove('hidden');
    });

    await expect(page.locator('#selection-toolbar')).toBeVisible({ timeout: 3000 });
}

/**
 * Exit selection mode cleanly.
 */
async function exitSelectionMode(page) {
    await page.evaluate(() => {
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionMode();
        }
    });
    // Let any pending RAF callbacks and DOM updates settle
    await page.waitForTimeout(100);
}

/**
 * Select items by indices and return per-item timings.
 * Measures inside the browser to exclude IPC overhead.
 */
async function timedSelectByIndices(page, indices) {
    return page.evaluate((idxList) => {
        const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
        const timings = [];

        for (const idx of idxList) {
            const item = items[idx];
            if (!item) continue;

            const start = performance.now();
            ItemSelection.toggleItem(item);
            const end = performance.now();

            timings.push({
                index: idx,
                duration: end - start,
                totalSelected: ItemSelection.selectedPaths.size,
            });
        }

        return timings;
    }, indices);
}

/**
 * Measure a baseline selection of scattered items.
 * Returns { timings, avgDuration, maxDuration }.
 */
async function measureBaselineSelection(page, indices) {
    const timings = await timedSelectByIndices(page, indices);
    const avgDuration = timings.reduce((s, t) => s + t.duration, 0) / timings.length;
    const maxDuration = Math.max(...timings.map((t) => t.duration));
    return { timings, avgDuration, maxDuration };
}

/**
 * Add a tag to a file via the API (bypasses UI for speed/reliability).
 */
async function addTagViaAPI(page, filePath, tagName) {
    return page.evaluate(
        async ({ path, tag }) => {
            const response = await fetch('/api/tags/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, tag }),
            });
            return response.ok;
        },
        { path: filePath, tag: tagName }
    );
}

/**
 * Copy tags from a file to the TagClipboard via the API + clipboard.
 */
async function copyTagsFromItem(page, itemIndex) {
    return page.evaluate(async (idx) => {
        const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
        const item = items[idx];
        if (!item) throw new Error(`No item at index ${idx}`);

        const path = item.dataset.path;
        const name = item.dataset.name || path.split('/').pop();

        await TagClipboard.copyTags(path, name);

        return {
            path,
            name,
            copiedCount: TagClipboard.copiedTags.length,
        };
    }, itemIndex);
}

/**
 * Paste tags to selected items via TagClipboard (programmatic, bypasses
 * the confirmation modal for test speed).
 */
async function pasteTagsToSelected(page) {
    return page.evaluate(async () => {
        if (!TagClipboard.hasTags()) {
            return { success: false, reason: 'no tags' };
        }

        const paths = Array.from(ItemSelection.selectedPaths);
        const sourcePath = TagClipboard.sourcePath;
        const destPaths = paths.filter((p) => p !== sourcePath);

        if (destPaths.length === 0) {
            return { success: false, reason: 'no destinations' };
        }

        // Apply tags directly via API (same as confirmPaste but without modal)
        let applied = 0;
        for (const tag of TagClipboard.copiedTags) {
            try {
                const response = await fetch('/api/tags/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paths: destPaths, tag }),
                });
                if (response.ok) applied++;
            } catch {
                // continue
            }
        }

        // Refresh gallery item tags in DOM (same as real paste flow)
        if (typeof Tags !== 'undefined') {
            await Tags.batchRefreshGalleryItemTags(destPaths);
            await Tags.loadAllTags();
        }

        return {
            success: true,
            tagsApplied: applied,
            destinationCount: destPaths.length,
        };
    });
}

/**
 * Get the file path of a gallery item by index.
 */
async function getItemPath(page, index) {
    return page.evaluate((idx) => {
        const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
        return items[idx]?.dataset.path || null;
    }, index);
}

/**
 * Collect a detailed performance profile of a selection sequence.
 * Measures not just toggleItem but also the cost of individual
 * sub-operations to pinpoint bottlenecks.
 */
async function profiledSelect(page, indices) {
    return page.evaluate((idxList) => {
        const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
        const results = [];

        for (const idx of idxList) {
            const item = items[idx];
            if (!item) continue;

            const path = item.dataset.path;
            const isAlreadySelected = ItemSelection.selectedPaths.has(path);

            // Measure the full toggleItem
            const t0 = performance.now();
            ItemSelection.toggleItem(item);
            const t1 = performance.now();

            // Measure a standalone updateToolbar call to see its cost
            // at this point in the selection
            const t2 = performance.now();
            ItemSelection.updateToolbar();
            const t3 = performance.now();

            results.push({
                index: idx,
                toggleDuration: t1 - t0,
                toolbarDuration: t3 - t2,
                totalSelected: ItemSelection.selectedPaths.size,
                wasDeselect: isAlreadySelected,
            });
        }

        return results;
    }, indices);
}

// ---------------------------------------------------------------------------
// Scattered index generators
// ---------------------------------------------------------------------------

/**
 * Generate indices matching the reported bug pattern:
 * "item 1, then items 20-25, then item 30, 33, and 50"
 * Scaled to the gallery size.
 */
function bugReportPattern(itemCount) {
    return [
        1,
        // Small cluster
        20, 21, 22, 23, 24, 25,
        // Scattered
        30, 33, 50,
        // Farther out
        80, 100, 130, 170, 200, 240,
    ].filter((i) => i < itemCount);
}

/**
 * Generate widely scattered indices across the full gallery.
 */
function widelyScatteredPattern(itemCount, count = 15) {
    const step = Math.floor(itemCount / count);
    return Array.from({ length: count }, (_, i) =>
        Math.min(i * step + Math.floor(step / 2), itemCount - 1)
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Selection + Tagging Workflow Performance @selection @tags @performance @slow', () => {
    test.describe.configure({ mode: 'serial' });

    test('full workflow: tag → copy → select → paste → select again', async ({
        page,
        loginHelpers,
    }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        // ---------------------------------------------------------------
        // Phase 0: Baseline — measure selection before any tag operations
        // ---------------------------------------------------------------
        console.log('\n=== Phase 0: Baseline selection (no prior tag ops) ===');
        await enterSelectionMode(page);

        const baselineIndices = bugReportPattern(itemCount);
        const baseline = await measureBaselineSelection(page, baselineIndices);

        console.log(
            `  Baseline: avg=${baseline.avgDuration.toFixed(2)}ms, ` +
                `max=${baseline.maxDuration.toFixed(2)}ms ` +
                `(${baselineIndices.length} items)`
        );

        await exitSelectionMode(page);

        // ---------------------------------------------------------------
        // Phase 1: Add tags to a source item via API
        // ---------------------------------------------------------------
        console.log('\n=== Phase 1: Adding tags to source item ===');
        const sourceItemPath = await getItemPath(page, 0);
        const testTags = ['perf-test-tag-1', 'perf-test-tag-2', 'perf-test-tag-3'];

        for (const tag of testTags) {
            await addTagViaAPI(page, sourceItemPath, tag);
        }

        // Refresh the gallery item's tag display
        await page.evaluate(async (path) => {
            if (typeof Tags !== 'undefined') {
                await Tags.refreshGalleryItemTags(path);
            }
        }, sourceItemPath);

        console.log(`  Added ${testTags.length} tags to item[0]`);

        // ---------------------------------------------------------------
        // Phase 2: Copy tags from the source item
        // ---------------------------------------------------------------
        console.log('\n=== Phase 2: Copy tags to clipboard ===');
        const copyResult = await copyTagsFromItem(page, 0);
        console.log(`  Copied ${copyResult.copiedCount} tags from "${copyResult.name}"`);

        // ---------------------------------------------------------------
        // Phase 3: Select scattered items and measure performance
        //          (TagClipboard now has state — this affects updateToolbar)
        // ---------------------------------------------------------------
        console.log('\n=== Phase 3: Selection with clipboard populated ===');
        await enterSelectionMode(page);

        const phase3Indices = bugReportPattern(itemCount);
        const phase3 = await measureBaselineSelection(page, phase3Indices);

        console.log(
            `  With clipboard: avg=${phase3.avgDuration.toFixed(2)}ms, ` +
                `max=${phase3.maxDuration.toFixed(2)}ms`
        );

        // ---------------------------------------------------------------
        // Phase 4: Paste tags to selected items
        // ---------------------------------------------------------------
        console.log('\n=== Phase 4: Paste tags ===');
        const pasteResult = await pasteTagsToSelected(page);
        console.log(`  Paste result: ${JSON.stringify(pasteResult)}`);

        await exitSelectionMode(page);

        // Let DOM updates from tag refresh settle
        await page.waitForTimeout(500);

        // ---------------------------------------------------------------
        // Phase 5: Select MORE items after paste (the reported slow path)
        //          Gallery items now have tags in their DOM, clipboard
        //          has state, and we've been through multiple selection
        //          sessions.
        // ---------------------------------------------------------------
        console.log('\n=== Phase 5: Selection AFTER paste (reported slow path) ===');
        await enterSelectionMode(page);

        const phase5Indices = widelyScatteredPattern(itemCount, 15);
        const phase5 = await profiledSelect(page, phase5Indices);

        const phase5Avg = phase5.reduce((s, t) => s + t.toggleDuration, 0) / phase5.length;
        const phase5Max = Math.max(...phase5.map((t) => t.toggleDuration));
        const phase5ToolbarAvg = phase5.reduce((s, t) => s + t.toolbarDuration, 0) / phase5.length;

        console.log(
            `  Post-paste selection: avg=${phase5Avg.toFixed(2)}ms, ` +
                `max=${phase5Max.toFixed(2)}ms, ` +
                `toolbar avg=${phase5ToolbarAvg.toFixed(2)}ms`
        );

        for (const t of phase5) {
            console.log(
                `    item[${t.index}]: toggle=${t.toggleDuration.toFixed(2)}ms, ` +
                    `toolbar=${t.toolbarDuration.toFixed(2)}ms, ` +
                    `selected=${t.totalSelected}`
            );
        }

        await exitSelectionMode(page);

        // ---------------------------------------------------------------
        // Phase 6: Do it all again — second paste cycle
        // ---------------------------------------------------------------
        console.log('\n=== Phase 6: Second tag-paste cycle ===');

        // Copy tags from a different item that now has tags (from paste)
        await copyTagsFromItem(page, 20);

        await enterSelectionMode(page);

        // Select a different set of scattered items
        const phase6SelectIndices = [5, 15, 35, 55, 75, 95, 115, 145, 175, 210, 235].filter(
            (i) => i < itemCount
        );
        const phase6Select = await timedSelectByIndices(page, phase6SelectIndices);

        // Paste
        const paste2Result = await pasteTagsToSelected(page);
        console.log(`  Second paste: ${JSON.stringify(paste2Result)}`);

        await exitSelectionMode(page);
        await page.waitForTimeout(500);

        // ---------------------------------------------------------------
        // Phase 7: Final selection after two paste cycles
        // ---------------------------------------------------------------
        console.log('\n=== Phase 7: Selection after TWO paste cycles ===');
        await enterSelectionMode(page);

        const phase7Indices = widelyScatteredPattern(itemCount, 20);
        const phase7 = await profiledSelect(page, phase7Indices);

        const phase7Avg = phase7.reduce((s, t) => s + t.toggleDuration, 0) / phase7.length;
        const phase7Max = Math.max(...phase7.map((t) => t.toggleDuration));
        const phase7ToolbarAvg = phase7.reduce((s, t) => s + t.toolbarDuration, 0) / phase7.length;

        console.log(
            `  Final selection: avg=${phase7Avg.toFixed(2)}ms, ` +
                `max=${phase7Max.toFixed(2)}ms, ` +
                `toolbar avg=${phase7ToolbarAvg.toFixed(2)}ms`
        );

        for (const t of phase7) {
            console.log(
                `    item[${t.index}]: toggle=${t.toggleDuration.toFixed(2)}ms, ` +
                    `toolbar=${t.toolbarDuration.toFixed(2)}ms, ` +
                    `selected=${t.totalSelected}`
            );
        }

        await exitSelectionMode(page);

        // ---------------------------------------------------------------
        // Assertions
        // ---------------------------------------------------------------
        console.log('\n=== Summary ===');
        console.log(`  Baseline avg:       ${baseline.avgDuration.toFixed(2)}ms`);
        console.log(`  Post-clipboard avg: ${phase3.avgDuration.toFixed(2)}ms`);
        console.log(`  Post-paste avg:     ${phase5Avg.toFixed(2)}ms`);
        console.log(`  Post-2nd-paste avg: ${phase7Avg.toFixed(2)}ms`);

        // 1. No individual selection should exceed threshold at any phase
        const allTimings = [
            ...phase3.timings.map((t) => ({ ...t, phase: 'post-clipboard' })),
            ...phase5.map((t) => ({
                index: t.index,
                duration: t.toggleDuration,
                phase: 'post-paste',
            })),
            ...phase6Select.map((t) => ({ ...t, phase: 'second-cycle-select' })),
            ...phase7.map((t) => ({
                index: t.index,
                duration: t.toggleDuration,
                phase: 'post-2nd-paste',
            })),
        ];

        for (const t of allTimings) {
            expect(
                t.duration,
                `[${t.phase}] item[${t.index}]: ${t.duration.toFixed(1)}ms ` +
                    `exceeds ${PER_ITEM_THRESHOLD_MS}ms`
            ).toBeLessThan(PER_ITEM_THRESHOLD_MS);
        }

        // 2. Post-paste selection should not be significantly slower than baseline
        if (baseline.avgDuration > 0.01) {
            const pasteRatio = phase5Avg / baseline.avgDuration;
            console.log(`  Degradation after paste: ${pasteRatio.toFixed(1)}×`);
            expect(
                pasteRatio,
                `Post-paste avg (${phase5Avg.toFixed(1)}ms) is ` +
                    `${pasteRatio.toFixed(1)}× slower than baseline ` +
                    `(${baseline.avgDuration.toFixed(1)}ms)`
            ).toBeLessThan(DEGRADATION_FACTOR);
        }

        // 3. Second paste cycle should not compound the degradation
        if (phase5Avg > 0.01) {
            const compoundRatio = phase7Avg / phase5Avg;
            console.log(`  Compound degradation (2nd vs 1st paste): ${compoundRatio.toFixed(1)}×`);
            expect(
                compoundRatio,
                `Post-2nd-paste avg (${phase7Avg.toFixed(1)}ms) is ` +
                    `${compoundRatio.toFixed(1)}× slower than post-1st-paste ` +
                    `(${phase5Avg.toFixed(1)}ms) — suggests accumulating cost`
            ).toBeLessThan(DEGRADATION_FACTOR);
        }

        // 4. updateToolbar should remain fast throughout
        expect(
            phase7ToolbarAvg,
            `Final toolbar avg: ${phase7ToolbarAvg.toFixed(2)}ms (limit: 2ms)`
        ).toBeLessThan(2);
    });

    test('selection performance after many items have tags in DOM', async ({
        page,
        loginHelpers,
    }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        // ---------------------------------------------------------------
        // Baseline: selection with no tags in DOM
        // ---------------------------------------------------------------
        console.log('\n=== Baseline: no tags in DOM ===');
        await enterSelectionMode(page);

        const indices = widelyScatteredPattern(itemCount, 15);
        const baseline = await profiledSelect(page, indices);
        const baselineAvg = baseline.reduce((s, t) => s + t.toggleDuration, 0) / baseline.length;

        console.log(`  Baseline avg: ${baselineAvg.toFixed(2)}ms`);
        await exitSelectionMode(page);

        // ---------------------------------------------------------------
        // Add tags to MANY items via bulk API (simulates a heavily-tagged
        // gallery — the real-world scenario)
        // ---------------------------------------------------------------
        console.log('\n=== Adding tags to 100 items via bulk API ===');

        const taggedCount = await page.evaluate(async () => {
            const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
            const paths = [];
            for (let i = 0; i < Math.min(100, items.length); i++) {
                const path = items[i].dataset.path;
                const type = items[i].dataset.type;
                // Only tag non-folder items
                if (type !== 'folder') {
                    paths.push(path);
                }
            }

            // Apply 3 tags to all of them in bulk
            const tags = ['bulk-tag-a', 'bulk-tag-b', 'bulk-tag-c'];
            for (const tag of tags) {
                try {
                    await fetch('/api/tags/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ paths, tag }),
                    });
                } catch {
                    // continue
                }
            }

            // Refresh all gallery item tags in DOM
            if (typeof Tags !== 'undefined') {
                await Tags.batchRefreshGalleryItemTags(paths);
            }

            return paths.length;
        });

        console.log(`  Tagged ${taggedCount} items with 3 tags each`);

        // Let DOM settle after tag refresh
        await page.waitForTimeout(500);

        // ---------------------------------------------------------------
        // Measure DOM complexity after tagging
        // ---------------------------------------------------------------
        const domStats = await page.evaluate(() => {
            const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
            let totalChildren = 0;
            let maxChildren = 0;
            let itemsWithTags = 0;

            items.forEach((item) => {
                const childCount = item.querySelectorAll('*').length;
                totalChildren += childCount;
                if (childCount > maxChildren) maxChildren = childCount;
                if (item.querySelector('.gallery-item-tags .item-tag')) {
                    itemsWithTags++;
                }
            });

            return {
                itemCount: items.length,
                avgChildren: (totalChildren / items.length).toFixed(1),
                maxChildren,
                itemsWithTags,
            };
        });

        console.log(
            `  DOM stats: ${domStats.itemCount} items, ` +
                `avg ${domStats.avgChildren} children/item, ` +
                `max ${domStats.maxChildren}, ` +
                `${domStats.itemsWithTags} with tags`
        );

        // ---------------------------------------------------------------
        // Post-tagging selection measurement
        // ---------------------------------------------------------------
        console.log('\n=== Post-tagging: selection with heavy DOM ===');
        await enterSelectionMode(page);

        const postTagIndices = widelyScatteredPattern(itemCount, 15);
        const postTag = await profiledSelect(page, postTagIndices);
        const postTagAvg = postTag.reduce((s, t) => s + t.toggleDuration, 0) / postTag.length;
        const postTagToolbarAvg =
            postTag.reduce((s, t) => s + t.toolbarDuration, 0) / postTag.length;

        console.log(
            `  Post-tag avg: ${postTagAvg.toFixed(2)}ms, ` +
                `toolbar avg: ${postTagToolbarAvg.toFixed(2)}ms`
        );

        for (const t of postTag) {
            console.log(
                `    item[${t.index}]: toggle=${t.toggleDuration.toFixed(2)}ms, ` +
                    `toolbar=${t.toolbarDuration.toFixed(2)}ms, ` +
                    `selected=${t.totalSelected}`
            );
        }

        await exitSelectionMode(page);

        // ---------------------------------------------------------------
        // Assertions
        // ---------------------------------------------------------------
        console.log('\n=== Summary ===');
        console.log(`  Baseline avg: ${baselineAvg.toFixed(2)}ms`);
        console.log(`  Post-tag avg: ${postTagAvg.toFixed(2)}ms`);

        if (baselineAvg > 0.01) {
            const ratio = postTagAvg / baselineAvg;
            console.log(`  Degradation: ${ratio.toFixed(1)}×`);

            expect(
                ratio,
                `Post-tagging selection (${postTagAvg.toFixed(1)}ms) is ` +
                    `${ratio.toFixed(1)}× slower than baseline ` +
                    `(${baselineAvg.toFixed(1)}ms) — DOM weight causing slowdown`
            ).toBeLessThan(DEGRADATION_FACTOR);
        }

        for (const t of postTag) {
            expect(
                t.toggleDuration,
                `item[${t.index}]: ${t.toggleDuration.toFixed(1)}ms ` +
                    `exceeds ${PER_ITEM_THRESHOLD_MS}ms`
            ).toBeLessThan(PER_ITEM_THRESHOLD_MS);
        }

        expect(
            postTagToolbarAvg,
            `Toolbar avg: ${postTagToolbarAvg.toFixed(2)}ms (limit: 2ms)`
        ).toBeLessThan(2);
    });

    test('profiled breakdown: identify where time is spent during selection', async ({
        page,
        loginHelpers,
    }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        // Set up tags and clipboard state to match the real workflow
        const sourceItemPath = await getItemPath(page, 0);
        for (const tag of ['profile-tag-1', 'profile-tag-2', 'profile-tag-3']) {
            await addTagViaAPI(page, sourceItemPath, tag);
        }
        await copyTagsFromItem(page, 0);

        // Tag a bunch of items to make the DOM heavier
        await page.evaluate(async () => {
            const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
            const paths = [];
            for (let i = 0; i < Math.min(80, items.length); i++) {
                if (items[i].dataset.type !== 'folder') {
                    paths.push(items[i].dataset.path);
                }
            }
            for (const tag of ['profile-a', 'profile-b']) {
                try {
                    await fetch('/api/tags/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ paths, tag }),
                    });
                } catch {
                    // continue
                }
            }
            if (typeof Tags !== 'undefined') {
                await Tags.batchRefreshGalleryItemTags(paths);
            }
        });

        await page.waitForTimeout(500);

        // Now do a detailed profiled selection
        console.log('\n=== Profiled selection breakdown ===');
        await enterSelectionMode(page);

        const indices = widelyScatteredPattern(itemCount, 20);

        // Detailed breakdown: measure each sub-operation
        const profile = await page.evaluate((idxList) => {
            const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
            const results = [];

            for (const idx of idxList) {
                const item = items[idx];
                if (!item) continue;

                const path = item.dataset.path;
                const type = item.dataset.type;
                const name = item.dataset.name || path.split('/').pop();

                // --- Measure individual operations ---

                // 1. Set.has check
                const t0 = performance.now();
                const alreadySelected = ItemSelection.selectedPaths.has(path);
                const t1 = performance.now();

                // 2. Set.add + Map.set
                const t2 = performance.now();
                if (!alreadySelected) {
                    ItemSelection.selectedPaths.add(path);
                    ItemSelection.selectedData.set(path, { name, type });
                    if (typeof ItemSelection._adjustTaggableCount === 'function') {
                        ItemSelection._adjustTaggableCount(type, 1);
                    }
                }
                const t3 = performance.now();

                // 3. scheduleDOMUpdate
                const t4 = performance.now();
                ItemSelection.scheduleDOMUpdate(path, true);
                const t5 = performance.now();

                // 4. scheduleToolbarUpdate (or updateToolbar if not debounced)
                const t6 = performance.now();
                if (typeof ItemSelection.scheduleToolbarUpdate === 'function') {
                    ItemSelection.scheduleToolbarUpdate();
                } else {
                    ItemSelection.updateToolbar();
                }
                const t7 = performance.now();

                // 5. Standalone updateToolbar measurement
                const t8 = performance.now();
                ItemSelection.updateToolbar();
                const t9 = performance.now();

                // 6. DOM query cost (what querySelector costs at this DOM size)
                const t10 = performance.now();
                document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
                const t11 = performance.now();

                results.push({
                    index: idx,
                    totalSelected: ItemSelection.selectedPaths.size,
                    setCheck: t1 - t0,
                    setAdd: t3 - t2,
                    scheduleDOMUpdate: t5 - t4,
                    scheduleToolbar: t7 - t6,
                    updateToolbar: t9 - t8,
                    domQuery: t11 - t10,
                    total: t7 - t0,
                });
            }

            return results;
        }, indices);

        // Print detailed breakdown
        console.log('idx  | total    | setChk | setAdd | domUpd | toolbar | updTB  | domQ');
        console.log('-----|----------|--------|--------|--------|---------|--------|------');
        for (const p of profile) {
            console.log(
                `${String(p.index).padStart(4)} | ` +
                    `${p.total.toFixed(3).padStart(7)}ms | ` +
                    `${p.setCheck.toFixed(3).padStart(5)}ms | ` +
                    `${p.setAdd.toFixed(3).padStart(5)}ms | ` +
                    `${p.scheduleDOMUpdate.toFixed(3).padStart(5)}ms | ` +
                    `${p.scheduleToolbar.toFixed(3).padStart(6)}ms | ` +
                    `${p.updateToolbar.toFixed(3).padStart(5)}ms | ` +
                    `${p.domQuery.toFixed(3).padStart(4)}ms`
            );
        }

        // Compute averages
        const avg = (arr, key) => arr.reduce((s, p) => s + p[key], 0) / arr.length;

        console.log('\nAverages:');
        console.log(`  Set check:          ${avg(profile, 'setCheck').toFixed(3)}ms`);
        console.log(`  Set add + map:      ${avg(profile, 'setAdd').toFixed(3)}ms`);
        console.log(`  scheduleDOMUpdate:  ${avg(profile, 'scheduleDOMUpdate').toFixed(3)}ms`);
        console.log(`  scheduleToolbar:    ${avg(profile, 'scheduleToolbar').toFixed(3)}ms`);
        console.log(`  updateToolbar:      ${avg(profile, 'updateToolbar').toFixed(3)}ms`);
        console.log(`  DOM query:          ${avg(profile, 'domQuery').toFixed(3)}ms`);
        console.log(`  Total:              ${avg(profile, 'total').toFixed(3)}ms`);

        // Check for the specific pattern: does updateToolbar get slower
        // as more items are selected?
        const firstFive = profile.slice(0, 5);
        const lastFive = profile.slice(-5);
        const tbFirst = avg(firstFive, 'updateToolbar');
        const tbLast = avg(lastFive, 'updateToolbar');

        console.log(`\n  Toolbar first 5 avg: ${tbFirst.toFixed(3)}ms`);
        console.log(`  Toolbar last 5 avg:  ${tbLast.toFixed(3)}ms`);

        if (tbFirst > 0.001) {
            const tbRatio = tbLast / tbFirst;
            console.log(`  Toolbar degradation: ${tbRatio.toFixed(1)}×`);

            expect(
                tbRatio,
                `updateToolbar degraded ${tbRatio.toFixed(1)}× from first 5 ` +
                    `(${tbFirst.toFixed(3)}ms) to last 5 (${tbLast.toFixed(3)}ms)`
            ).toBeLessThan(DEGRADATION_FACTOR);
        }

        await exitSelectionMode(page);

        // Overall assertion
        for (const p of profile) {
            expect(
                p.total,
                `item[${p.index}]: total ${p.total.toFixed(1)}ms ` +
                    `exceeds ${PER_ITEM_THRESHOLD_MS}ms`
            ).toBeLessThan(PER_ITEM_THRESHOLD_MS);
        }
    });
});
