// e2e/specs/selection-performance.spec.js
/**
 * Performance tests for gallery item selection.
 *
 * These tests verify that selecting multiple gallery items remains
 * performant regardless of the number of items selected, their distance
 * apart in the gallery, or the selection pattern (individual taps,
 * contiguous ranges, or a realistic mix of both).
 *
 * Timing is measured inside the browser via performance.now() to exclude
 * Playwright IPC overhead and focus purely on the JS/DOM cost.
 *
 * Minimum gallery size: 250 items (matches the smallest test dataset).
 */

import { test, expect } from '../fixtures/index.js';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Maximum ms a single toggleItem() call should ever take. */
const PER_ITEM_THRESHOLD_MS = 5;

/** Maximum total ms for an entire range/batch selection. */
const BATCH_THRESHOLD_MS = 100;

/**
 * Maximum ratio between the slowest and fastest individual selection in a
 * sequence.  A value of 3 means the last selection may be at most 3×
 * slower than the first — anything higher indicates O(n²) degradation.
 */
const DEGRADATION_FACTOR = 3;

/** Minimum number of gallery items required to run these tests. */
const MIN_ITEMS = 250;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Log in and wait for the gallery to be fully populated with at least
 * MIN_ITEMS items.
 *
 * The gallery uses infinite scroll with a batch size of 50, so the
 * initial page load only renders ~50 items. Rather than simulating
 * scroll events (which is unreliable across viewports, especially on
 * mobile), we call InfiniteScroll.loadMore() directly until we have
 * enough items or the server runs out.
 *
 * Returns the number of selectable (non-skeleton) gallery items.
 */
async function setupGallery(page, loginHelpers) {
    await loginHelpers.login(page);
    await page.waitForSelector('.gallery-item:not(.skeleton)', {
        state: 'visible',
        timeout: 30_000,
    });

    // Wait for the initial batch to fully render
    await page.waitForTimeout(500);

    // Programmatically load more items until we reach MIN_ITEMS or exhaust
    // the server's data. This is deterministic and viewport-independent.
    const finalCount = await page.evaluate(async (minItems) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        if (typeof InfiniteScroll === 'undefined') {
            // No infinite scroll — return whatever we have
            return document.querySelectorAll('.gallery-item:not(.skeleton)').length;
        }

        // Keep loading batches until we have enough or there are no more
        for (let attempt = 0; attempt < 20; attempt++) {
            const loaded = InfiniteScroll.state.loadedItems.length;
            const hasMore = InfiniteScroll.state.hasMore;

            if (loaded >= minItems || !hasMore) break;

            // Wait for any in-progress load to finish first
            while (InfiniteScroll.state.isLoading) {
                await sleep(100);
            }

            // Trigger the next batch
            await InfiniteScroll.loadMore();

            // Small pause to let the DOM update
            await sleep(200);
        }

        // Wait for any final pending load
        while (InfiniteScroll.state.isLoading) {
            await sleep(100);
        }

        return document.querySelectorAll('.gallery-item:not(.skeleton)').length;
    }, MIN_ITEMS);

    // Scroll back to top so tests start from a consistent position
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);

    return finalCount;
}

/**
 * Enter selection mode programmatically on the first gallery item.
 * Avoids flaky long-press timing in tests.
 */
async function enterSelectionMode(page) {
    await page.evaluate(() => {
        const first = document.querySelector('.gallery-item:not(.skeleton)');
        if (!first) throw new Error('No gallery items found');
        if (typeof ItemSelection === 'undefined') {
            throw new Error('ItemSelection not loaded');
        }
        ItemSelection.enterSelectionMode(first);
    });
    await expect(page.locator('#selection-toolbar')).toBeVisible({ timeout: 3000 });
}

/**
 * Exit selection mode and reset state for the next test scenario.
 */
async function exitSelectionMode(page) {
    await page.evaluate(() => {
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionMode();
        }
    });
}

/**
 * Select gallery items by index and return per-item timing.
 * Timing is measured inside the browser to exclude IPC overhead.
 *
 * @returns {{ index: number, duration: number, totalSelected: number }[]}
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
 * Simulate range selection (the drag-selection code path) between two
 * indices and return the wall-clock time in ms.
 */
async function timedRangeSelect(page, startIndex, endIndex) {
    return page.evaluate(
        ({ start, end }) => {
            const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
            const startEl = items[start];
            const endEl = items[end];
            if (!startEl || !endEl) {
                throw new Error(`Invalid range: ${start}..${end} (${items.length} items)`);
            }

            // Set up drag state exactly as the real code path does
            ItemSelection.dragCachedItems = Array.from(document.querySelectorAll('.gallery-item'));
            ItemSelection.dragStartIndex = ItemSelection.dragCachedItems.indexOf(startEl);

            const t0 = performance.now();
            ItemSelection.selectRectangularRegion(startEl, endEl);
            const t1 = performance.now();

            // Clean up drag state
            ItemSelection.dragCachedItems = null;
            ItemSelection.dragStartIndex = -1;

            return {
                duration: t1 - t0,
                selectedCount: ItemSelection.selectedPaths.size,
            };
        },
        { start: startIndex, end: endIndex }
    );
}

/**
 * Measure updateToolbar() in isolation, called `iterations` times.
 * Returns { avg, max, min, timings }.
 */
async function benchmarkUpdateToolbar(page, iterations = 20) {
    return page.evaluate((n) => {
        const timings = [];
        for (let i = 0; i < n; i++) {
            const start = performance.now();
            ItemSelection.updateToolbar();
            const end = performance.now();
            timings.push(end - start);
        }
        const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
        const max = Math.max(...timings);
        const min = Math.min(...timings);
        return { avg, max, min, timings };
    }, iterations);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Selection Performance', () => {
    // Run serially — each test manipulates shared selection state
    test.describe.configure({ mode: 'serial' });

    /**
     * Realistic mixed-selection scenario:
     * Tap item 0, then items 20-25 individually, then 30, 33, 50, 80,
     * 120, 180, 240.  This mirrors the pattern described in the bug
     * report: scattered individual taps with some clusters.
     */
    test('realistic mixed selection pattern should remain fast', async ({ page, loginHelpers }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        await enterSelectionMode(page);

        // Build the realistic selection pattern:
        // item 0 is already selected by enterSelectionMode
        const indices = [
            // Cluster: 20-25
            20, 21, 22, 23, 24, 25,
            // Scattered singles
            30, 33, 50, 80, 120, 180, 240,
        ].filter((i) => i < itemCount);

        const timings = await timedSelectByIndices(page, indices);

        // Log for debugging
        console.log('Mixed selection timings:');
        for (const t of timings) {
            console.log(
                `  item[${t.index}]: ${t.duration.toFixed(2)}ms (${t.totalSelected} selected)`
            );
        }

        // 1. No single tap should exceed the per-item threshold
        for (const t of timings) {
            expect(
                t.duration,
                `Selecting item ${t.index} took ${t.duration.toFixed(1)}ms ` +
                    `(limit: ${PER_ITEM_THRESHOLD_MS}ms, ` +
                    `${t.totalSelected} items selected)`
            ).toBeLessThan(PER_ITEM_THRESHOLD_MS);
        }

        // 2. No degradation: last selection must not be much slower than first
        const first = timings[0].duration;
        const last = timings[timings.length - 1].duration;
        if (first > 0.01) {
            const ratio = last / first;
            expect(
                ratio,
                `Degradation: last (${last.toFixed(1)}ms) is ${ratio.toFixed(1)}× ` +
                    `slower than first (${first.toFixed(1)}ms)`
            ).toBeLessThan(DEGRADATION_FACTOR);
        }

        // 3. Total time for all selections should be reasonable
        const totalTime = timings.reduce((sum, t) => sum + t.duration, 0);
        expect(
            totalTime,
            `Total selection time: ${totalTime.toFixed(1)}ms for ${timings.length} items`
        ).toBeLessThan(BATCH_THRESHOLD_MS);

        // 4. Correct count: enterSelectionMode selected 1 + our indices
        const expectedCount = 1 + indices.length;
        const actualCount = await page.evaluate(() => ItemSelection.selectedPaths.size);
        expect(actualCount).toBe(expectedCount);

        await exitSelectionMode(page);
    });

    /**
     * Worst-case individual selection: tap every 10th item across the
     * entire gallery (25+ selections spread across 250+ items).
     * This maximises the number of updateToolbar() calls with a growing
     * selection set — the exact pattern that triggers O(n²).
     */
    test('selecting every 10th item across 250+ items should not degrade', async ({
        page,
        loginHelpers,
    }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        await enterSelectionMode(page);

        // Every 10th item, starting from 1 (0 is already selected)
        const indices = [];
        for (let i = 10; i < itemCount; i += 10) {
            indices.push(i);
        }

        const timings = await timedSelectByIndices(page, indices);

        console.log(
            `Every-10th-item selection: ${timings.length} items, ` +
                `first=${timings[0]?.duration.toFixed(2)}ms, ` +
                `last=${timings[timings.length - 1]?.duration.toFixed(2)}ms`
        );

        // Check degradation across the full sequence
        // Compare the average of the first 5 vs last 5 selections
        const firstFive = timings.slice(0, 5);
        const lastFive = timings.slice(-5);
        const avgFirst = firstFive.reduce((s, t) => s + t.duration, 0) / firstFive.length;
        const avgLast = lastFive.reduce((s, t) => s + t.duration, 0) / lastFive.length;

        console.log(`  avg first 5: ${avgFirst.toFixed(2)}ms, avg last 5: ${avgLast.toFixed(2)}ms`);

        if (avgFirst > 0.01) {
            const ratio = avgLast / avgFirst;
            expect(
                ratio,
                `Degradation: last 5 avg (${avgLast.toFixed(1)}ms) is ` +
                    `${ratio.toFixed(1)}× slower than first 5 avg ` +
                    `(${avgFirst.toFixed(1)}ms)`
            ).toBeLessThan(DEGRADATION_FACTOR);
        }

        // No individual selection should exceed threshold
        for (const t of timings) {
            expect(
                t.duration,
                `item[${t.index}]: ${t.duration.toFixed(1)}ms ` +
                    `(limit: ${PER_ITEM_THRESHOLD_MS}ms)`
            ).toBeLessThan(PER_ITEM_THRESHOLD_MS);
        }

        await exitSelectionMode(page);
    });

    /**
     * Range (drag) selection of a contiguous block of 50 items.
     * Pre-fix, this calls selectItem() → updateToolbar() 50 times.
     */
    test('range-selecting 50 contiguous items should complete in one batch', async ({
        page,
        loginHelpers,
    }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        await enterSelectionMode(page);

        const rangeEnd = Math.min(49, itemCount - 1);
        const result = await timedRangeSelect(page, 0, rangeEnd);

        console.log(
            `Range select 0..${rangeEnd}: ${result.duration.toFixed(1)}ms, ` +
                `${result.selectedCount} selected`
        );

        expect(
            result.duration,
            `Range selection of ${rangeEnd + 1} items took ` +
                `${result.duration.toFixed(1)}ms (limit: ${BATCH_THRESHOLD_MS}ms)`
        ).toBeLessThan(BATCH_THRESHOLD_MS);

        // Should have selected the range + the initial item from enterSelectionMode
        expect(result.selectedCount).toBeGreaterThanOrEqual(rangeEnd + 1);

        await exitSelectionMode(page);
    });

    /**
     * Large range selection: 150 items.
     * Ensures the batch path scales linearly.
     */
    test('range-selecting 150 contiguous items should scale linearly', async ({
        page,
        loginHelpers,
    }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        await enterSelectionMode(page);

        // First measure a small range (25 items) as baseline
        const smallEnd = 24;
        const smallResult = await timedRangeSelect(page, 0, smallEnd);

        // Reset selection for the large range
        await page.evaluate(() => ItemSelection.deselectAll());

        // Now measure a large range (150 items)
        const largeEnd = Math.min(149, itemCount - 1);
        const largeResult = await timedRangeSelect(page, 0, largeEnd);

        const sizeRatio = (largeEnd + 1) / (smallEnd + 1); // ~6×
        const timeRatio = largeResult.duration / Math.max(smallResult.duration, 0.01);

        console.log(
            `Small range (0..${smallEnd}): ${smallResult.duration.toFixed(2)}ms\n` +
                `Large range (0..${largeEnd}): ${largeResult.duration.toFixed(2)}ms\n` +
                `Size ratio: ${sizeRatio.toFixed(1)}×, Time ratio: ${timeRatio.toFixed(1)}×`
        );

        // Time should scale roughly linearly with size.
        // Allow up to 2× the size ratio (generous margin for GC, JIT, etc.)
        // but definitely not quadratic (which would be sizeRatio²).
        expect(
            timeRatio,
            `Time grew ${timeRatio.toFixed(1)}× for ${sizeRatio.toFixed(1)}× more items — ` +
                `suggests super-linear scaling`
        ).toBeLessThan(sizeRatio * 2);

        await exitSelectionMode(page);
    });

    /**
     * Scattered vs adjacent selections should take similar time.
     * If scattered is much slower, it suggests DOM traversal or layout
     * thrashing proportional to element distance.
     */
    test('scattered selections should not be slower than adjacent ones', async ({
        page,
        loginHelpers,
    }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        // --- Adjacent selections ---
        await enterSelectionMode(page);
        const adjacentIndices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const adjacentTimings = await timedSelectByIndices(page, adjacentIndices);
        const adjacentTotal = adjacentTimings.reduce((s, t) => s + t.duration, 0);
        await exitSelectionMode(page);

        // --- Scattered selections (same count, spread across gallery) ---
        await enterSelectionMode(page);
        const step = Math.floor(itemCount / 10);
        const scatteredIndices = Array.from({ length: 10 }, (_, i) =>
            Math.min((i + 1) * step, itemCount - 1)
        );
        const scatteredTimings = await timedSelectByIndices(page, scatteredIndices);
        const scatteredTotal = scatteredTimings.reduce((s, t) => s + t.duration, 0);
        await exitSelectionMode(page);

        console.log(
            `Adjacent (${adjacentIndices.length} items): ${adjacentTotal.toFixed(2)}ms total\n` +
                `Scattered (${scatteredIndices.length} items): ${scatteredTotal.toFixed(2)}ms total`
        );

        const ratio = scatteredTotal / Math.max(adjacentTotal, 0.01);
        expect(
            ratio,
            `Scattered (${scatteredTotal.toFixed(1)}ms) is ${ratio.toFixed(1)}× ` +
                `slower than adjacent (${adjacentTotal.toFixed(1)}ms)`
        ).toBeLessThan(DEGRADATION_FACTOR);
    });

    /**
     * updateToolbar() in isolation with a large selection set.
     * Pre-fix, this iterates all selected items 3× per call.
     */
    test('updateToolbar should be O(1) even with 200+ selected items', async ({
        page,
        loginHelpers,
    }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        await enterSelectionMode(page);

        // Bulk-populate the selection set without measuring (simulates
        // having selected 200 items via "Select All")
        const populatedCount = await page.evaluate((count) => {
            const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
            let added = 0;
            for (let i = 0; i < Math.min(count, items.length); i++) {
                const item = items[i];
                const path = item.dataset.path;
                const name = item.dataset.name || path.split('/').pop();
                const type = item.dataset.type;

                if (!ItemSelection.selectedPaths.has(path)) {
                    ItemSelection.selectedPaths.add(path);
                    ItemSelection.selectedData.set(path, { name, type });
                    if (type !== 'folder') {
                        ItemSelection._taggableCount = (ItemSelection._taggableCount || 0) + 1;
                    }
                    item.classList.add('selected');
                    added++;
                }
            }
            return ItemSelection.selectedPaths.size;
        }, 200);

        console.log(`Populated selection with ${populatedCount} items`);

        // Benchmark updateToolbar() — 50 iterations
        const bench = await benchmarkUpdateToolbar(page, 50);

        console.log(
            `updateToolbar() with ${populatedCount} items:\n` +
                `  avg: ${bench.avg.toFixed(3)}ms\n` +
                `  max: ${bench.max.toFixed(3)}ms\n` +
                `  min: ${bench.min.toFixed(3)}ms`
        );

        // Should complete well under 2ms per call (O(1) operations only)
        expect(
            bench.avg,
            `Average updateToolbar: ${bench.avg.toFixed(3)}ms (limit: 2ms)`
        ).toBeLessThan(2);

        expect(
            bench.max,
            `Worst-case updateToolbar: ${bench.max.toFixed(3)}ms (limit: 5ms)`
        ).toBeLessThan(5);

        await exitSelectionMode(page);
    });

    /**
     * Rapid sequential selections simulating fast finger tapping.
     * Verifies no individual selection causes a frame drop (>16ms).
     */
    test('rapid sequential selections should not cause jank', async ({ page, loginHelpers }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        await enterSelectionMode(page);

        // Rapidly select 30 items (simulates fast tapping)
        const count = Math.min(30, itemCount - 1);
        const indices = Array.from({ length: count }, (_, i) => i + 1);

        const result = await page.evaluate((idxList) => {
            const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
            const totalStart = performance.now();
            let maxSingle = 0;
            let worstIndex = -1;

            for (const idx of idxList) {
                const item = items[idx];
                if (!item) continue;

                const start = performance.now();
                ItemSelection.toggleItem(item);
                const elapsed = performance.now() - start;

                if (elapsed > maxSingle) {
                    maxSingle = elapsed;
                    worstIndex = idx;
                }
            }

            const totalEnd = performance.now();
            return {
                total: totalEnd - totalStart,
                maxSingle,
                worstIndex,
                count: idxList.length,
                selectedCount: ItemSelection.selectedPaths.size,
            };
        }, indices);

        console.log(
            `Rapid selection of ${result.count} items:\n` +
                `  total: ${result.total.toFixed(1)}ms\n` +
                `  worst: ${result.maxSingle.toFixed(2)}ms (item ${result.worstIndex})\n` +
                `  selected: ${result.selectedCount}`
        );

        // Total time for 30 selections should be well under 150ms
        expect(
            result.total,
            `Total: ${result.total.toFixed(1)}ms for ${result.count} selections ` + `(limit: 150ms)`
        ).toBeLessThan(150);

        // No single selection should cause a frame drop (16.67ms = 1 frame at 60fps)
        expect(
            result.maxSingle,
            `Worst single selection at item[${result.worstIndex}]: ` +
                `${result.maxSingle.toFixed(2)}ms (limit: 16ms)`
        ).toBeLessThan(16);

        await exitSelectionMode(page);
    });

    /**
     * Mixed pattern: individual taps + small range + more taps.
     * This is the exact scenario from the bug report:
     * "item 1, then items 20-25, then item 30, 33, and 50"
     * but scaled up for a 250+ item gallery.
     */
    test('bug report scenario: tap, range, tap pattern at scale', async ({
        page,
        loginHelpers,
    }) => {
        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need at least ${MIN_ITEMS} items, found ${itemCount}`);

        await enterSelectionMode(page);
        // enterSelectionMode already selected item 0

        // Phase 1: Individual taps on scattered items
        const phase1Indices = [10, 15];
        const phase1 = await timedSelectByIndices(page, phase1Indices);

        // Phase 2: Range select items 20-25 (simulates drag)
        const phase2 = await timedRangeSelect(page, 20, 25);

        // Phase 3: More scattered individual taps
        const phase3Indices = [30, 33, 50, 80, 100, 130, 170, 200, 240].filter(
            (i) => i < itemCount
        );
        const phase3 = await timedSelectByIndices(page, phase3Indices);

        // Phase 4: Another small range
        const phase4Start = Math.min(150, itemCount - 11);
        const phase4 = await timedRangeSelect(page, phase4Start, phase4Start + 10);

        // Phase 5: Final scattered taps while many items are selected
        const phase5Indices = [5, 45, 90, 135, 185, 230].filter((i) => i < itemCount);
        const phase5 = await timedSelectByIndices(page, phase5Indices);

        // Log all phases
        console.log('Bug report scenario timings:');
        console.log(
            `  Phase 1 (scattered taps): ${phase1.map((t) => t.duration.toFixed(2) + 'ms').join(', ')}`
        );
        console.log(`  Phase 2 (range 20-25): ${phase2.duration.toFixed(2)}ms`);
        console.log(
            `  Phase 3 (scattered taps): ${phase3.map((t) => t.duration.toFixed(2) + 'ms').join(', ')}`
        );
        console.log(
            `  Phase 4 (range ${phase4Start}-${phase4Start + 10}): ${phase4.duration.toFixed(2)}ms`
        );
        console.log(
            `  Phase 5 (final taps): ${phase5.map((t) => t.duration.toFixed(2) + 'ms').join(', ')}`
        );

        const totalSelected = await page.evaluate(() => ItemSelection.selectedPaths.size);
        console.log(`  Total selected: ${totalSelected}`);

        // Key assertion: Phase 5 taps (with many items already selected)
        // should not be significantly slower than Phase 1 taps (few selected)
        const avgPhase1 = phase1.reduce((s, t) => s + t.duration, 0) / phase1.length;
        const avgPhase5 = phase5.reduce((s, t) => s + t.duration, 0) / phase5.length;

        if (avgPhase1 > 0.01) {
            const ratio = avgPhase5 / avgPhase1;
            console.log(
                `  Phase 1 avg: ${avgPhase1.toFixed(2)}ms, ` +
                    `Phase 5 avg: ${avgPhase5.toFixed(2)}ms, ` +
                    `ratio: ${ratio.toFixed(1)}×`
            );
            expect(
                ratio,
                `Phase 5 (${avgPhase5.toFixed(1)}ms avg, ${totalSelected} selected) ` +
                    `is ${ratio.toFixed(1)}× slower than Phase 1 ` +
                    `(${avgPhase1.toFixed(1)}ms avg) — indicates degradation`
            ).toBeLessThan(DEGRADATION_FACTOR);
        }

        // No individual operation should exceed thresholds
        for (const t of [...phase1, ...phase3, ...phase5]) {
            expect(
                t.duration,
                `item[${t.index}]: ${t.duration.toFixed(1)}ms exceeds ${PER_ITEM_THRESHOLD_MS}ms`
            ).toBeLessThan(PER_ITEM_THRESHOLD_MS);
        }

        expect(phase2.duration).toBeLessThan(BATCH_THRESHOLD_MS);
        expect(phase4.duration).toBeLessThan(BATCH_THRESHOLD_MS);

        await exitSelectionMode(page);
    });
});
