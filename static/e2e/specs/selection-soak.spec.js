// e2e/specs/selection-soak.spec.js
/**
 * Soak / stress tests for the selection + tagging workflow.
 *
 * These tests simulate a user working in the app for an extended session,
 * repeating the tag → copy → select → paste → merge cycle many times.
 * Performance is measured at regular intervals to detect gradual
 * degradation that only manifests after sustained use.
 *
 * Three intensity levels are tested:
 *   - 10 cycles  (~2 min)  — catches fast-accumulating issues
 *   - 20 cycles  (~4 min)  — catches moderate accumulation
 *   - 50 cycles  (~10 min) — catches slow leaks and GC pressure
 *
 * Each cycle uses a different number of tags (2–15) and a different
 * selection pattern to exercise varied code paths.
 */

import { test, expect } from '../fixtures/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MIN_ITEMS = 250;

/** Max ms for a single toggleItem call. */
const PER_ITEM_THRESHOLD_MS = 10;

/**
 * Max ratio between the slowest measurement interval and the baseline.
 * Anything above this indicates accumulating degradation.
 */
const MAX_DEGRADATION = 4;

/**
 * How often (in cycles) to take a performance measurement.
 * E.g., every 5 cycles for the 50-cycle test.
 */
const MEASUREMENT_INTERVAL_SHORT = 2; // for 10-cycle test
const MEASUREMENT_INTERVAL_MEDIUM = 5; // for 20-cycle test
const MEASUREMENT_INTERVAL_LONG = 10; // for 50-cycle test

// ---------------------------------------------------------------------------
// Tag generation
// ---------------------------------------------------------------------------

/**
 * Generate a list of tag names for a given cycle.
 * Mixes "existing" tags (reused across cycles) and "new" tags (unique
 * per cycle) to simulate real usage where users both reuse and create tags.
 *
 * @param {number} cycle - Current cycle number (0-based)
 * @param {number} count - Number of tags to generate (2–15)
 * @returns {{ existing: string[], fresh: string[] }}
 */
function generateTags(cycle, count) {
    // Pool of "existing" tags that get reused across cycles
    const existingPool = [
        'landscape',
        'portrait',
        'family',
        'vacation',
        'work',
        'screenshot',
        'meme',
        'art',
        'nature',
        'urban',
        'food',
        'pet',
        'event',
        'archive',
        'favorite',
    ];

    // Split roughly 60/40 between existing and fresh
    const existingCount = Math.max(1, Math.floor(count * 0.6));
    const freshCount = count - existingCount;

    // Pick existing tags (rotate through the pool based on cycle)
    const existing = [];
    for (let i = 0; i < existingCount; i++) {
        existing.push(existingPool[(cycle * 3 + i) % existingPool.length]);
    }

    // Generate unique fresh tags for this cycle
    const fresh = [];
    for (let i = 0; i < freshCount; i++) {
        fresh.push(`soak-c${cycle}-t${i}-${Date.now().toString(36).slice(-4)}`);
    }

    return { existing, fresh };
}

/**
 * Determine how many tags to use for a given cycle.
 * Varies between 2 and 15, with a distribution that exercises
 * both small and large tag sets.
 */
function tagCountForCycle(cycle) {
    // Pattern: 3, 5, 2, 8, 4, 12, 3, 7, 15, 2, 6, 10, ...
    const pattern = [3, 5, 2, 8, 4, 12, 3, 7, 15, 2, 6, 10, 4, 9, 14, 3, 11, 5, 7, 13];
    return pattern[cycle % pattern.length];
}

// ---------------------------------------------------------------------------
// Selection pattern generation
// ---------------------------------------------------------------------------

/**
 * Generate a selection pattern for a given cycle.
 * Each cycle uses a different pattern to exercise varied code paths.
 */
function selectionPatternForCycle(cycle, itemCount) {
    const patterns = [
        // Pattern 0: Bug report pattern — cluster + scattered
        () => [1, 20, 21, 22, 23, 24, 25, 30, 33, 50, 80, 120, 180, 240],

        // Pattern 1: Every Nth item (wide scatter)
        () => {
            const step = Math.floor(itemCount / 12);
            return Array.from({ length: 12 }, (_, i) => i * step + 1);
        },

        // Pattern 2: Two clusters far apart
        () => [5, 6, 7, 8, 9, 10, ...Array.from({ length: 6 }, (_, i) => itemCount - 20 + i)],

        // Pattern 3: Fibonacci-ish spacing
        () => {
            const indices = [1];
            let a = 1,
                b = 2;
            while (b < itemCount && indices.length < 15) {
                indices.push(b);
                [a, b] = [b, a + b];
            }
            return indices;
        },

        // Pattern 4: Dense cluster in the middle
        () => {
            const mid = Math.floor(itemCount / 2);
            return Array.from({ length: 15 }, (_, i) => mid - 7 + i);
        },

        // Pattern 5: Alternating near/far
        () => {
            const result = [];
            for (let i = 0; i < 8; i++) {
                result.push(i * 2 + 1); // near: 1, 3, 5, 7, 9, 11, 13, 15
                result.push(itemCount - 1 - i * 3); // far end
            }
            return result;
        },

        // Pattern 6: Random-ish but deterministic (based on cycle)
        () => {
            const seed = cycle * 7 + 13;
            const result = [];
            for (let i = 0; i < 12; i++) {
                result.push(((seed * (i + 1) * 31) % (itemCount - 1)) + 1);
            }
            return [...new Set(result)]; // deduplicate
        },

        // Pattern 7: First N items (worst case for checkbox rendering)
        () => Array.from({ length: 20 }, (_, i) => i + 1),

        // Pattern 8: Last N items (tests items loaded via infinite scroll)
        () => Array.from({ length: 15 }, (_, i) => itemCount - 16 + i),

        // Pattern 9: Three small clusters spread across gallery
        () => {
            const third = Math.floor(itemCount / 3);
            return [
                ...Array.from({ length: 4 }, (_, i) => 10 + i),
                ...Array.from({ length: 4 }, (_, i) => third + 10 + i),
                ...Array.from({ length: 4 }, (_, i) => third * 2 + 10 + i),
            ];
        },
    ];

    const pattern = patterns[cycle % patterns.length]();
    return pattern.filter((i) => i >= 0 && i < itemCount);
}

/**
 * Generate a second selection pattern (for paste destinations)
 * that doesn't overlap with the first.
 */
function pasteDestinationPattern(cycle, itemCount, sourceIndices) {
    const sourceSet = new Set(sourceIndices);
    const step = Math.floor(itemCount / 10);
    const candidates = [];

    for (let i = 2; i < itemCount; i += step) {
        if (!sourceSet.has(i)) {
            candidates.push(i);
        }
    }

    // Add some extras to get at least 8 destinations
    for (let i = 1; candidates.length < 8 && i < itemCount; i++) {
        if (!sourceSet.has(i) && !candidates.includes(i)) {
            candidates.push(i);
        }
    }

    return candidates.slice(0, Math.min(12, candidates.length));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
            while (InfiniteScroll.state.isLoading) await sleep(100);
            await InfiniteScroll.loadMore();
            await sleep(200);
        }
        while (InfiniteScroll.state.isLoading) await sleep(100);
        return document.querySelectorAll('.gallery-item:not(.skeleton)').length;
    }, MIN_ITEMS);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    return finalCount;
}

async function enterSelectionMode(page) {
    await page.evaluate(() => {
        const first = document.querySelector('.gallery-item:not(.skeleton)');
        if (!first) throw new Error('No gallery items found');
        ItemSelection.enterSelectionMode(first);
    });
    await expect(page.locator('#selection-toolbar')).toBeVisible({ timeout: 3000 });
}

async function exitSelectionMode(page) {
    await page.evaluate(() => {
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionMode();
        }
    });
    await page.waitForTimeout(50);
}

/**
 * Measure selection of a set of indices. Returns per-item timings
 * and aggregates.
 */
async function measureSelection(page, indices) {
    const timings = await page.evaluate((idxList) => {
        const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
        const results = [];
        for (const idx of idxList) {
            const item = items[idx];
            if (!item) continue;
            const start = performance.now();
            ItemSelection.toggleItem(item);
            const duration = performance.now() - start;
            results.push({
                index: idx,
                duration,
                totalSelected: ItemSelection.selectedPaths.size,
            });
        }
        return results;
    }, indices);

    const durations = timings.map((t) => t.duration);
    return {
        timings,
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        max: Math.max(...durations),
        min: Math.min(...durations),
        count: durations.length,
    };
}

/**
 * Collect diagnostic information about the current page state.
 */
async function collectDiagnostics(page) {
    return page.evaluate(() => {
        const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
        let totalElements = 0;
        let totalTagElements = 0;
        let maxItemDepth = 0;

        items.forEach((item) => {
            const descendants = item.querySelectorAll('*').length;
            totalElements += descendants;
            if (descendants > maxItemDepth) maxItemDepth = descendants;
            totalTagElements += item.querySelectorAll('.item-tag').length;
        });

        // Count all event listeners if possible (Chrome DevTools protocol)
        // Falls back to DOM element count as proxy
        const totalDOMNodes = document.querySelectorAll('*').length;

        // Check memory if available
        let memoryMB = null;
        if (performance.memory) {
            memoryMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
        }

        // Tag clipboard state
        const clipboardTags =
            typeof TagClipboard !== 'undefined' ? TagClipboard.copiedTags.length : 0;

        // Tags.allTags size
        const allTagsCount = typeof Tags !== 'undefined' ? Tags.allTags.length : 0;

        return {
            galleryItems: items.length,
            totalDOMNodes,
            avgElementsPerItem: (totalElements / Math.max(items.length, 1)).toFixed(1),
            maxItemDepth,
            totalTagElements,
            memoryMB,
            clipboardTags,
            allTagsCount,
        };
    });
}

/**
 * Execute a single workflow cycle:
 *   1. Select a source item and add tags to it
 *   2. Copy tags from that item to clipboard
 *   3. Enter selection mode, select scattered items
 *   4. Paste tags to selected items
 *   5. Exit selection, re-enter, select different items
 *   6. Merge tags across selected items
 *   7. Exit selection mode
 *
 * Returns timing data for the selection phases only.
 */
async function executeWorkflowCycle(page, cycle, itemCount) {
    const tagCount = tagCountForCycle(cycle);
    const { existing, fresh } = generateTags(cycle, tagCount);
    const allTags = [...existing, ...fresh];
    const selectPattern = selectionPatternForCycle(cycle, itemCount);
    const pastePattern = pasteDestinationPattern(cycle, itemCount, selectPattern);

    // --- Step 1: Add tags to a source item ---
    const sourceIndex = (cycle * 7) % Math.min(50, itemCount);
    await page.evaluate(
        async ({ idx, tags }) => {
            const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
            const item = items[idx];
            if (!item) return;
            const path = item.dataset.path;

            for (const tag of tags) {
                try {
                    await fetch('/api/tags/file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path, tag }),
                    });
                } catch {
                    /* continue */
                }
            }

            if (typeof Tags !== 'undefined') {
                await Tags.refreshGalleryItemTags(path);
            }
        },
        { idx: sourceIndex, tags: allTags }
    );

    // --- Step 2: Copy tags from source ---
    await page.evaluate(async (idx) => {
        const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
        const item = items[idx];
        if (!item) return;
        const path = item.dataset.path;
        const name = item.dataset.name || path.split('/').pop();
        await TagClipboard.copyTags(path, name);
    }, sourceIndex);

    // --- Step 3: Select scattered items and measure ---
    await enterSelectionMode(page);
    const selectMeasurement = await measureSelection(page, selectPattern);

    // --- Step 4: Paste tags to selected items ---
    await page.evaluate(async () => {
        if (!TagClipboard.hasTags()) return;
        const paths = Array.from(ItemSelection.selectedPaths);
        const sourcePath = TagClipboard.sourcePath;
        const destPaths = paths.filter((p) => p !== sourcePath);
        if (destPaths.length === 0) return;

        for (const tag of TagClipboard.copiedTags) {
            try {
                await fetch('/api/tags/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paths: destPaths, tag }),
                });
            } catch {
                /* continue */
            }
        }

        if (typeof Tags !== 'undefined') {
            await Tags.batchRefreshGalleryItemTags(destPaths);
            await Tags.loadAllTags();
        }
    });

    await exitSelectionMode(page);
    await page.waitForTimeout(100);

    // --- Step 5: Re-enter selection, select paste destinations, measure ---
    await enterSelectionMode(page);
    const pasteMeasurement = await measureSelection(page, pastePattern);

    // --- Step 6: Merge tags (if we have ≥2 taggable items selected) ---
    await page.evaluate(async () => {
        const taggable = Array.from(ItemSelection.selectedData.entries()).filter(
            ([, d]) => d.type !== 'folder'
        );
        if (taggable.length < 2) return;

        // Collect all unique tags from selected items
        const paths = taggable.map(([p]) => p);
        try {
            const response = await fetch('/api/tags/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths }),
            });
            if (!response.ok) return;
            const tagsByPath = await response.json();

            const allTags = new Set();
            for (const tags of Object.values(tagsByPath)) {
                tags.forEach((t) => allTags.add(t));
            }

            // Apply all unique tags to all items (merge)
            for (const tag of allTags) {
                try {
                    await fetch('/api/tags/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ paths, tag }),
                    });
                } catch {
                    /* continue */
                }
            }

            if (typeof Tags !== 'undefined') {
                await Tags.batchRefreshGalleryItemTags(paths);
                await Tags.loadAllTags();
            }
        } catch {
            /* continue */
        }
    });

    await exitSelectionMode(page);
    await page.waitForTimeout(100);

    // --- Step 7: One more select cycle to measure post-merge ---
    const postMergePattern = selectionPatternForCycle(cycle + 5, itemCount);
    await enterSelectionMode(page);
    const postMergeMeasurement = await measureSelection(page, postMergePattern);
    await exitSelectionMode(page);
    await page.waitForTimeout(50);

    return {
        cycle,
        tagCount,
        freshTagCount: fresh.length,
        existingTagCount: existing.length,
        select: {
            avg: selectMeasurement.avg,
            max: selectMeasurement.max,
            count: selectMeasurement.count,
        },
        paste: {
            avg: pasteMeasurement.avg,
            max: pasteMeasurement.max,
            count: pasteMeasurement.count,
        },
        postMerge: {
            avg: postMergeMeasurement.avg,
            max: postMergeMeasurement.max,
            count: postMergeMeasurement.count,
        },
    };
}

/**
 * Run the full soak test for a given number of cycles.
 * Takes measurements at regular intervals and checks for degradation.
 */
async function runSoakTest(page, loginHelpers, totalCycles, measurementInterval) {
    const itemCount = await setupGallery(page, loginHelpers);

    if (itemCount < MIN_ITEMS) {
        return { skipped: true, reason: `Need ${MIN_ITEMS} items, found ${itemCount}` };
    }

    // --- Baseline measurement (before any tag operations) ---
    console.log('\n=== Baseline (cycle 0, no prior tag operations) ===');
    await enterSelectionMode(page);
    const baselineIndices = selectionPatternForCycle(0, itemCount);
    const baseline = await measureSelection(page, baselineIndices);
    await exitSelectionMode(page);

    const baselineDiag = await collectDiagnostics(page);

    console.log(
        `  Selection: avg=${baseline.avg.toFixed(3)}ms, ` +
            `max=${baseline.max.toFixed(3)}ms (${baseline.count} items)`
    );
    console.log(`  DOM: ${JSON.stringify(baselineDiag)}`);

    // --- Run cycles ---
    const measurements = [
        {
            cycle: 0,
            label: 'baseline',
            selectAvg: baseline.avg,
            selectMax: baseline.max,
            diagnostics: baselineDiag,
        },
    ];

    const allCycleResults = [];

    for (let cycle = 0; cycle < totalCycles; cycle++) {
        const isMeasurementCycle =
            cycle === 0 || (cycle + 1) % measurementInterval === 0 || cycle === totalCycles - 1;

        if (isMeasurementCycle) {
            console.log(`\n=== Cycle ${cycle + 1}/${totalCycles} (measurement) ===`);
        }

        const result = await executeWorkflowCycle(page, cycle, itemCount);
        allCycleResults.push(result);

        if (isMeasurementCycle) {
            const diag = await collectDiagnostics(page);

            measurements.push({
                cycle: cycle + 1,
                label: `cycle-${cycle + 1}`,
                selectAvg: result.select.avg,
                selectMax: result.select.max,
                pasteSelectAvg: result.paste.avg,
                postMergeAvg: result.postMerge.avg,
                tagCount: result.tagCount,
                diagnostics: diag,
            });

            console.log(
                `  Tags: ${result.tagCount} (${result.existingTagCount} existing, ${result.freshTagCount} fresh)`
            );
            console.log(
                `  Select:     avg=${result.select.avg.toFixed(3)}ms, max=${result.select.max.toFixed(3)}ms`
            );
            console.log(
                `  Post-paste: avg=${result.paste.avg.toFixed(3)}ms, max=${result.paste.max.toFixed(3)}ms`
            );
            console.log(
                `  Post-merge: avg=${result.postMerge.avg.toFixed(3)}ms, max=${result.postMerge.max.toFixed(3)}ms`
            );
            console.log(
                `  DOM: nodes=${diag.totalDOMNodes}, tags=${diag.totalTagElements}, ` +
                    `avg/item=${diag.avgElementsPerItem}, allTags=${diag.allTagsCount}` +
                    (diag.memoryMB ? `, memory=${diag.memoryMB}MB` : '')
            );
        }
    }

    return { measurements, allCycleResults, baseline, itemCount };
}

/**
 * Assert that measurements don't show degradation.
 */
function assertNoDegradation(measurements, totalCycles) {
    const baselineAvg = measurements[0].selectAvg;

    console.log('\n=== Degradation Analysis ===');
    console.log('Cycle | Select Avg | vs Baseline | DOM Nodes | Tag Elements | allTags');
    console.log('------|------------|-------------|-----------|--------------|--------');

    for (const m of measurements) {
        const ratio = baselineAvg > 0.001 ? m.selectAvg / baselineAvg : 1;
        console.log(
            `${String(m.cycle).padStart(5)} | ` +
                `${m.selectAvg.toFixed(3).padStart(10)}ms | ` +
                `${ratio.toFixed(1).padStart(11)}× | ` +
                `${String(m.diagnostics.totalDOMNodes).padStart(9)} | ` +
                `${String(m.diagnostics.totalTagElements).padStart(12)} | ` +
                `${String(m.diagnostics.allTagsCount).padStart(6)}`
        );
    }

    // Check: last measurement vs baseline
    const lastMeasurement = measurements[measurements.length - 1];
    if (baselineAvg > 0.001) {
        const finalRatio = lastMeasurement.selectAvg / baselineAvg;
        console.log(`\nFinal degradation after ${totalCycles} cycles: ${finalRatio.toFixed(1)}×`);

        expect(
            finalRatio,
            `Selection avg after ${totalCycles} cycles ` +
                `(${lastMeasurement.selectAvg.toFixed(2)}ms) is ` +
                `${finalRatio.toFixed(1)}× slower than baseline ` +
                `(${baselineAvg.toFixed(2)}ms)`
        ).toBeLessThan(MAX_DEGRADATION);
    }

    // Check: no individual selection exceeds threshold at any measurement point
    for (const m of measurements) {
        expect(
            m.selectMax,
            `Cycle ${m.cycle}: max selection ${m.selectMax.toFixed(1)}ms ` +
                `exceeds ${PER_ITEM_THRESHOLD_MS}ms`
        ).toBeLessThan(PER_ITEM_THRESHOLD_MS);
    }

    // Check: trend — is it getting worse over time?
    // Compare first third vs last third of measurements
    if (measurements.length >= 6) {
        const third = Math.floor(measurements.length / 3);
        const firstThird = measurements.slice(0, third);
        const lastThird = measurements.slice(-third);

        const avgFirst = firstThird.reduce((s, m) => s + m.selectAvg, 0) / firstThird.length;
        const avgLast = lastThird.reduce((s, m) => s + m.selectAvg, 0) / lastThird.length;

        if (avgFirst > 0.001) {
            const trendRatio = avgLast / avgFirst;
            console.log(
                `Trend: first third avg=${avgFirst.toFixed(3)}ms, ` +
                    `last third avg=${avgLast.toFixed(3)}ms, ` +
                    `ratio=${trendRatio.toFixed(1)}×`
            );

            expect(
                trendRatio,
                `Performance trending worse: last third ` +
                    `(${avgLast.toFixed(2)}ms) is ${trendRatio.toFixed(1)}× ` +
                    `slower than first third (${avgFirst.toFixed(2)}ms)`
            ).toBeLessThan(MAX_DEGRADATION);
        }
    }

    // Check: DOM growth — tag elements shouldn't grow unboundedly
    const baselineTags = measurements[0].diagnostics.totalTagElements;
    const finalTags = lastMeasurement.diagnostics.totalTagElements;
    console.log(`\nDOM tag elements: baseline=${baselineTags}, final=${finalTags}`);

    // Check: allTags count growth
    const baselineAllTags = measurements[0].diagnostics.allTagsCount;
    const finalAllTags = lastMeasurement.diagnostics.allTagsCount;
    console.log(`allTags array: baseline=${baselineAllTags}, final=${finalAllTags}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Selection Soak Tests', () => {
    // These are long-running — increase timeout
    test.describe.configure({ mode: 'serial' });

    test('10-cycle soak: tag/copy/paste/merge workflow', async ({ page, loginHelpers }) => {
        test.setTimeout(3 * 60 * 1000); // 3 minutes

        const result = await runSoakTest(page, loginHelpers, 10, MEASUREMENT_INTERVAL_SHORT);

        if (result.skipped) {
            test.skip(true, result.reason);
            return;
        }

        assertNoDegradation(result.measurements, 10);
    });

    test('20-cycle soak: tag/copy/paste/merge workflow', async ({ page, loginHelpers }) => {
        test.setTimeout(6 * 60 * 1000); // 6 minutes

        const result = await runSoakTest(page, loginHelpers, 20, MEASUREMENT_INTERVAL_MEDIUM);

        if (result.skipped) {
            test.skip(true, result.reason);
            return;
        }

        assertNoDegradation(result.measurements, 20);
    });

    test('50-cycle soak: tag/copy/paste/merge workflow', async ({ page, loginHelpers }) => {
        test.setTimeout(15 * 60 * 1000); // 15 minutes

        const result = await runSoakTest(page, loginHelpers, 50, MEASUREMENT_INTERVAL_LONG);

        if (result.skipped) {
            test.skip(true, result.reason);
            return;
        }

        assertNoDegradation(result.measurements, 50);

        // Additional assertion for the 50-cycle test:
        // Check that the LAST cycle's post-merge selection is still fast
        const lastCycle = result.allCycleResults[result.allCycleResults.length - 1];
        console.log(
            `\nFinal cycle post-merge: avg=${lastCycle.postMerge.avg.toFixed(3)}ms, ` +
                `max=${lastCycle.postMerge.max.toFixed(3)}ms`
        );

        expect(
            lastCycle.postMerge.avg,
            `Final cycle post-merge avg ${lastCycle.postMerge.avg.toFixed(1)}ms ` +
                `exceeds ${PER_ITEM_THRESHOLD_MS}ms`
        ).toBeLessThan(PER_ITEM_THRESHOLD_MS);
    });

    test('diagnostic: profile selection at 0, 10, 25, 50 cycles', async ({
        page,
        loginHelpers,
    }) => {
        test.setTimeout(15 * 60 * 1000); // 15 minutes

        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need ${MIN_ITEMS} items, found ${itemCount}`);

        const profilePoints = [0, 10, 25, 50];
        const profiles = [];
        let cyclesDone = 0;

        for (const targetCycle of profilePoints) {
            // Run cycles to reach the target
            while (cyclesDone < targetCycle) {
                await executeWorkflowCycle(page, cyclesDone, itemCount);
                cyclesDone++;
            }

            // Take a detailed profile at this point
            console.log(`\n=== Detailed profile at cycle ${targetCycle} ===`);

            const diag = await collectDiagnostics(page);
            console.log(`  DOM: ${JSON.stringify(diag)}`);

            await enterSelectionMode(page);

            const indices = selectionPatternForCycle(targetCycle, itemCount);

            const profile = await page.evaluate((idxList) => {
                const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
                const results = [];

                for (const idx of idxList) {
                    const item = items[idx];
                    if (!item) continue;
                    const path = item.dataset.path;

                    // Full toggleItem
                    const t0 = performance.now();
                    ItemSelection.toggleItem(item);
                    const t1 = performance.now();

                    // Isolated updateToolbar
                    const t2 = performance.now();
                    ItemSelection.updateToolbar();
                    const t3 = performance.now();

                    // DOM query cost
                    const t4 = performance.now();
                    document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
                    const t5 = performance.now();

                    // querySelectorAll cost (proxy for DOM weight)
                    const t6 = performance.now();
                    document.querySelectorAll('.gallery-item:not(.skeleton)');
                    const t7 = performance.now();

                    results.push({
                        index: idx,
                        toggle: t1 - t0,
                        toolbar: t3 - t2,
                        querySelector: t5 - t4,
                        querySelectorAll: t7 - t6,
                        selected: ItemSelection.selectedPaths.size,
                    });
                }

                return results;
            }, indices);

            await exitSelectionMode(page);

            const avgToggle = profile.reduce((s, p) => s + p.toggle, 0) / profile.length;
            const avgToolbar = profile.reduce((s, p) => s + p.toolbar, 0) / profile.length;
            const avgQS = profile.reduce((s, p) => s + p.querySelector, 0) / profile.length;
            const avgQSA = profile.reduce((s, p) => s + p.querySelectorAll, 0) / profile.length;

            console.log(
                `  Averages: toggle=${avgToggle.toFixed(3)}ms, ` +
                    `toolbar=${avgToolbar.toFixed(3)}ms, ` +
                    `querySelector=${avgQS.toFixed(3)}ms, ` +
                    `querySelectorAll=${avgQSA.toFixed(3)}ms`
            );

            profiles.push({
                cycle: targetCycle,
                avgToggle,
                avgToolbar,
                avgQS,
                avgQSA,
                diagnostics: diag,
            });
        }

        // Print comparison table
        console.log('\n=== Profile Comparison ===');
        console.log(
            'Cycle | toggle   | toolbar  | qS       | qSA      | DOM nodes | tags  | allTags | memory'
        );
        console.log(
            '------|----------|----------|----------|----------|-----------|-------|---------|-------'
        );

        for (const p of profiles) {
            console.log(
                `${String(p.cycle).padStart(5)} | ` +
                    `${p.avgToggle.toFixed(3).padStart(7)}ms | ` +
                    `${p.avgToolbar.toFixed(3).padStart(7)}ms | ` +
                    `${p.avgQS.toFixed(3).padStart(7)}ms | ` +
                    `${p.avgQSA.toFixed(3).padStart(7)}ms | ` +
                    `${String(p.diagnostics.totalDOMNodes).padStart(9)} | ` +
                    `${String(p.diagnostics.totalTagElements).padStart(5)} | ` +
                    `${String(p.diagnostics.allTagsCount).padStart(7)} | ` +
                    `${(p.diagnostics.memoryMB || 'N/A').toString().padStart(5)}MB`
            );
        }

        // Assert: toggle time at cycle 50 should not be dramatically
        // worse than cycle 0
        const first = profiles[0];
        const last = profiles[profiles.length - 1];

        if (first.avgToggle > 0.001) {
            const ratio = last.avgToggle / first.avgToggle;
            console.log(`\nToggle degradation (cycle 0 → ${last.cycle}): ${ratio.toFixed(1)}×`);
            expect(
                ratio,
                `Toggle time grew ${ratio.toFixed(1)}× from cycle 0 ` +
                    `(${first.avgToggle.toFixed(3)}ms) to cycle ${last.cycle} ` +
                    `(${last.avgToggle.toFixed(3)}ms)`
            ).toBeLessThan(MAX_DEGRADATION);
        }

        // Assert: querySelector cost shouldn't grow significantly
        // (this would indicate DOM weight is the bottleneck)
        if (first.avgQS > 0.001) {
            const qsRatio = last.avgQS / first.avgQS;
            console.log(`querySelector degradation: ${qsRatio.toFixed(1)}×`);
            expect(
                qsRatio,
                `querySelector cost grew ${qsRatio.toFixed(1)}× — ` +
                    `DOM weight may be the bottleneck`
            ).toBeLessThan(MAX_DEGRADATION);
        }
    });
});
