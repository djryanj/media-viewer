// e2e/specs/selection-e2e-performance.spec.js
/**
 * End-to-end performance tests for the selection + tagging workflow.
 *
 * Unlike the previous soak tests which measured only client-side JS
 * operations, these tests measure the FULL user-perceived latency
 * including server response times, network round trips, and the
 * sequential fetch loops in paste/merge operations.
 *
 * Server-side degradation is tracked by intercepting all API calls
 * and recording their response times across cycles.
 */

import { test, expect } from '../fixtures/index.js';

const MIN_ITEMS = 250;
const PER_ITEM_THRESHOLD_MS = 10;
const MAX_DEGRADATION = 4;

// ---------------------------------------------------------------------------
// API timing interceptor
// ---------------------------------------------------------------------------

/**
 * Set up a route interceptor that records timing for all /api/* calls.
 * Returns an object with methods to query the collected data.
 *
 * This runs at the Playwright level (not in-browser), so it captures
 * true network round-trip time including server processing.
 */
function createAPITimer(page) {
    const records = [];
    let recording = true;

    // Intercept at the browser level using Performance Observer
    // for fetch calls, which captures actual network timing
    const setupPromise = page.evaluate(() => {
        window.__apiTimings = [];
        window.__originalFetch = window.fetch;

        window.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

            // Only track /api/ calls
            if (!url.startsWith('/api/') && !url.startsWith('/api')) {
                return window.__originalFetch.apply(this, args);
            }

            const method =
                args[1]?.method?.toUpperCase() ||
                (typeof args[0] === 'object' ? args[0].method?.toUpperCase() : 'GET') ||
                'GET';

            const startTime = performance.now();

            try {
                const response = await window.__originalFetch.apply(this, args);
                const endTime = performance.now();
                const duration = endTime - startTime;

                // Parse the endpoint (strip query params for grouping)
                const endpoint = url.split('?')[0];

                window.__apiTimings.push({
                    endpoint,
                    method,
                    status: response.status,
                    duration,
                    timestamp: Date.now(),
                    ok: response.ok,
                });

                return response;
            } catch (error) {
                const endTime = performance.now();
                window.__apiTimings.push({
                    endpoint: url.split('?')[0],
                    method,
                    status: 0,
                    duration: endTime - startTime,
                    timestamp: Date.now(),
                    ok: false,
                    error: error.message,
                });
                throw error;
            }
        };
    });

    return {
        setupPromise,

        /** Get all recorded API timings and clear the buffer. */
        async flush(page) {
            const timings = await page.evaluate(() => {
                const data = [...window.__apiTimings];
                window.__apiTimings = [];
                return data;
            });
            records.push(...timings);
            return timings;
        },

        /** Get all records collected so far. */
        getAllRecords() {
            return records;
        },

        /** Get records grouped by endpoint. */
        getByEndpoint() {
            const grouped = {};
            for (const r of records) {
                const key = `${r.method} ${r.endpoint}`;
                if (!grouped[key]) {
                    grouped[key] = [];
                }
                grouped[key].push(r);
            }
            return grouped;
        },

        /** Get summary stats for each endpoint. */
        getSummary() {
            const grouped = this.getByEndpoint();
            const summary = {};
            for (const [key, timings] of Object.entries(grouped)) {
                const durations = timings.map((t) => t.duration);
                summary[key] = {
                    count: durations.length,
                    avg: durations.reduce((a, b) => a + b, 0) / durations.length,
                    max: Math.max(...durations),
                    min: Math.min(...durations),
                    p95: durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)],
                    total: durations.reduce((a, b) => a + b, 0),
                };
            }
            return summary;
        },

        /** Get records within a time window (for per-cycle analysis). */
        getRecordsSince(timestampMs) {
            return records.filter((r) => r.timestamp >= timestampMs);
        },

        /** Restore original fetch. */
        async teardown(page) {
            await page.evaluate(() => {
                if (window.__originalFetch) {
                    window.fetch = window.__originalFetch;
                    delete window.__originalFetch;
                }
            });
        },
    };
}

// ---------------------------------------------------------------------------
// Tag generation (same as soak tests)
// ---------------------------------------------------------------------------

function generateTags(cycle, count) {
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
    const existingCount = Math.max(1, Math.floor(count * 0.6));
    const freshCount = count - existingCount;

    const existing = [];
    for (let i = 0; i < existingCount; i++) {
        existing.push(existingPool[(cycle * 3 + i) % existingPool.length]);
    }

    const fresh = [];
    for (let i = 0; i < freshCount; i++) {
        fresh.push(`e2e-c${cycle}-t${i}-${Date.now().toString(36).slice(-4)}`);
    }

    return { existing, fresh, all: [...existing, ...fresh] };
}

function tagCountForCycle(cycle) {
    const pattern = [3, 5, 2, 8, 4, 12, 3, 7, 15, 2, 6, 10, 4, 9, 14, 3, 11, 5, 7, 13];
    return pattern[cycle % pattern.length];
}

function selectionPatternForCycle(cycle, itemCount) {
    const patterns = [
        () => [1, 20, 21, 22, 23, 24, 25, 30, 33, 50, 80, 120, 180, 240],
        () => {
            const step = Math.floor(itemCount / 12);
            return Array.from({ length: 12 }, (_, i) => i * step + 1);
        },
        () => [5, 6, 7, 8, 9, 10, ...Array.from({ length: 6 }, (_, i) => itemCount - 20 + i)],
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
        () => {
            const mid = Math.floor(itemCount / 2);
            return Array.from({ length: 15 }, (_, i) => mid - 7 + i);
        },
    ];
    return patterns[cycle % patterns.length]().filter((i) => i >= 0 && i < itemCount);
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
        if (!first) throw new Error('No gallery items');
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
 * Measure selection of indices with BOTH client-side timing AND
 * wall-clock timing (which includes any synchronous server calls
 * or GC pauses that page.evaluate captures).
 */
async function measureSelectionE2E(page, indices) {
    const wallStart = Date.now();

    const clientTimings = await page.evaluate((idxList) => {
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

    const wallEnd = Date.now();
    const wallDuration = wallEnd - wallStart;

    const durations = clientTimings.map((t) => t.duration);
    const clientTotal = durations.reduce((a, b) => a + b, 0);

    return {
        timings: clientTimings,
        clientAvg: clientTotal / durations.length,
        clientMax: Math.max(...durations),
        clientTotal,
        wallDuration,
        // Overhead = time spent outside of measured JS (IPC, GC, layout, etc.)
        overhead: wallDuration - clientTotal,
        count: durations.length,
    };
}

/**
 * Execute a full tag workflow cycle and measure EVERYTHING:
 * - Client-side selection timing
 * - Wall-clock time for each phase
 * - Server API response times (via the interceptor)
 *
 * This replicates the exact user workflow:
 *   1. Select a source item, add tags via the tag modal flow
 *   2. Copy tags to clipboard
 *   3. Select scattered destination items
 *   4. Paste tags (sequential server calls)
 *   5. Exit, re-enter, select more items
 *   6. Merge tags across selected items
 *   7. Final selection measurement
 */
async function executeFullCycle(page, apiTimer, cycle, itemCount) {
    const tagCount = tagCountForCycle(cycle);
    const { existing, fresh, all: allTags } = generateTags(cycle, tagCount);
    const selectPattern = selectionPatternForCycle(cycle, itemCount);

    const cycleStartTime = Date.now();
    const phases = {};

    // --- Phase 1: Add tags to source item (simulates tag modal) ---
    const sourceIndex = (cycle * 7) % Math.min(50, itemCount);

    let phaseStart = Date.now();
    await page.evaluate(
        async ({ idx, tags }) => {
            const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
            const item = items[idx];
            if (!item) return;
            const path = item.dataset.path;

            // Simulate the tag modal flow: loadFileTags, then addTag for each
            // This is what happens when a user opens the modal and types tags
            await fetch(`/api/tags/file?path=${encodeURIComponent(path)}`);

            for (const tag of tags) {
                // Add tag
                await fetch('/api/tags/file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path, tag }),
                });
                // Reload file tags (happens after each add in the real UI)
                await fetch(`/api/tags/file?path=${encodeURIComponent(path)}`);
            }

            // loadAllTags (happens after each add)
            await fetch('/api/tags');

            // Refresh gallery item
            if (typeof Tags !== 'undefined') {
                await Tags.refreshGalleryItemTags(path);
            }
        },
        { idx: sourceIndex, tags: allTags }
    );
    phases.addTags = { duration: Date.now() - phaseStart, tagCount: allTags.length };

    // --- Phase 2: Copy tags from source ---
    phaseStart = Date.now();
    await page.evaluate(async (idx) => {
        const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
        const item = items[idx];
        if (!item) return;
        await TagClipboard.copyTags(item.dataset.path, item.dataset.name);
    }, sourceIndex);
    phases.copyTags = { duration: Date.now() - phaseStart };

    // --- Phase 3: Select scattered items (THE KEY MEASUREMENT) ---
    await enterSelectionMode(page);
    const selectMeasurement = await measureSelectionE2E(page, selectPattern);
    phases.select = {
        ...selectMeasurement,
        indices: selectPattern,
    };

    // --- Phase 4: Paste tags (sequential server calls — potential bottleneck) ---
    phaseStart = Date.now();
    await page.evaluate(async () => {
        if (!TagClipboard.hasTags()) return;
        const paths = Array.from(ItemSelection.selectedPaths);
        const sourcePath = TagClipboard.sourcePath;
        const destPaths = paths.filter((p) => p !== sourcePath);
        if (destPaths.length === 0) return;

        // This is the exact flow from TagClipboard.executePaste():
        // Sequential fetch per tag
        for (const tag of TagClipboard.copiedTags) {
            await fetch('/api/tags/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: destPaths, tag }),
            });
        }

        // Then batch refresh + loadAllTags
        if (typeof Tags !== 'undefined') {
            await Tags.batchRefreshGalleryItemTags(destPaths);
            await Tags.loadAllTags();
        }
    });
    phases.paste = {
        duration: Date.now() - phaseStart,
        tagCount: allTags.length,
    };

    await exitSelectionMode(page);
    await page.waitForTimeout(100);

    // --- Phase 5: Re-enter selection, select different items ---
    const reselPattern = selectionPatternForCycle(cycle + 3, itemCount);
    await enterSelectionMode(page);
    const reselectMeasurement = await measureSelectionE2E(page, reselPattern);
    phases.reselect = {
        ...reselectMeasurement,
        indices: reselPattern,
    };

    // --- Phase 6: Merge tags across selected items ---
    phaseStart = Date.now();
    await page.evaluate(async () => {
        const taggable = Array.from(ItemSelection.selectedData.entries()).filter(
            ([, d]) => d.type !== 'folder'
        );
        if (taggable.length < 2) return;

        const paths = taggable.map(([p]) => p);

        // Read all tags (batch endpoint)
        const readResp = await fetch('/api/tags/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
        });
        if (!readResp.ok) return;
        const tagsByPath = await readResp.json();

        const allTags = new Set();
        for (const tags of Object.values(tagsByPath)) {
            tags.forEach((t) => allTags.add(t));
        }

        // Write merged tags (sequential per tag)
        for (const tag of allTags) {
            await fetch('/api/tags/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths, tag }),
            });
        }

        if (typeof Tags !== 'undefined') {
            await Tags.batchRefreshGalleryItemTags(paths);
            await Tags.loadAllTags();
        }
    });
    phases.merge = { duration: Date.now() - phaseStart };

    await exitSelectionMode(page);
    await page.waitForTimeout(100);

    // --- Phase 7: Final selection after everything ---
    const finalPattern = selectionPatternForCycle(cycle + 7, itemCount);
    await enterSelectionMode(page);
    const finalMeasurement = await measureSelectionE2E(page, finalPattern);
    phases.finalSelect = {
        ...finalMeasurement,
        indices: finalPattern,
    };
    await exitSelectionMode(page);

    // Flush API timings for this cycle
    const cycleAPITimings = await apiTimer.flush(page);

    phases.totalCycleDuration = Date.now() - cycleStartTime;

    return {
        cycle,
        tagCount,
        freshTagCount: fresh.length,
        existingTagCount: existing.length,
        phases,
        apiCallCount: cycleAPITimings.length,
        apiTimings: cycleAPITimings,
    };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printCycleSummary(result) {
    const p = result.phases;
    console.log(
        `  Tags: ${result.tagCount} (${result.existingTagCount} existing, ${result.freshTagCount} fresh)`
    );
    console.log(
        `  Add tags:     ${p.addTags.duration}ms (${p.addTags.tagCount} tags, ` +
            `~${(p.addTags.duration / Math.max(p.addTags.tagCount, 1)).toFixed(0)}ms/tag)`
    );
    console.log(`  Copy tags:    ${p.copyTags.duration}ms`);
    console.log(
        `  Select:       client avg=${p.select.clientAvg.toFixed(2)}ms, ` +
            `max=${p.select.clientMax.toFixed(2)}ms, ` +
            `wall=${p.select.wallDuration}ms, ` +
            `overhead=${p.select.overhead}ms`
    );
    console.log(
        `  Paste:        ${p.paste.duration}ms (${p.paste.tagCount} tags, ` +
            `~${(p.paste.duration / Math.max(p.paste.tagCount, 1)).toFixed(0)}ms/tag)`
    );
    console.log(
        `  Reselect:     client avg=${p.reselect.clientAvg.toFixed(2)}ms, ` +
            `max=${p.reselect.clientMax.toFixed(2)}ms, ` +
            `wall=${p.reselect.wallDuration}ms`
    );
    console.log(`  Merge:        ${p.merge.duration}ms`);
    console.log(
        `  Final select: client avg=${p.finalSelect.clientAvg.toFixed(2)}ms, ` +
            `max=${p.finalSelect.clientMax.toFixed(2)}ms, ` +
            `wall=${p.finalSelect.wallDuration}ms`
    );
    console.log(
        `  Total cycle:  ${p.totalCycleDuration}ms, ` + `API calls: ${result.apiCallCount}`
    );
}

function printAPIReport(apiTimer) {
    const summary = apiTimer.getSummary();

    console.log('\n=== API Endpoint Performance ===');
    console.log('Endpoint                          | Count | Avg     | P95     | Max     | Total');
    console.log(
        '----------------------------------|-------|---------|---------|---------|--------'
    );

    const sorted = Object.entries(summary).sort(([, a], [, b]) => b.total - a.total);

    for (const [endpoint, stats] of sorted) {
        console.log(
            `${endpoint.padEnd(34)}| ` +
                `${String(stats.count).padStart(5)} | ` +
                `${stats.avg.toFixed(1).padStart(6)}ms | ` +
                `${(stats.p95 || 0).toFixed(1).padStart(6)}ms | ` +
                `${stats.max.toFixed(1).padStart(6)}ms | ` +
                `${(stats.total / 1000).toFixed(1).padStart(5)}s`
        );
    }
}

function printServerDegradationReport(cycleResults) {
    // Track how server response times change across cycles
    // Focus on the most-called endpoints
    const keyEndpoints = [
        'POST /api/tags/bulk',
        'GET /api/tags/file',
        'POST /api/tags/file',
        'GET /api/tags',
        'POST /api/tags/batch',
    ];

    console.log('\n=== Server Response Time Trend ===');
    console.log(
        'Cycle | POST bulk avg | GET file avg | POST file avg | GET all avg | POST batch avg'
    );
    console.log(
        '------|---------------|--------------|---------------|-------------|---------------'
    );

    for (const result of cycleResults) {
        const byEndpoint = {};
        for (const timing of result.apiTimings) {
            const key = `${timing.method} ${timing.endpoint}`;
            if (!byEndpoint[key]) byEndpoint[key] = [];
            byEndpoint[key].push(timing.duration);
        }

        const avgs = keyEndpoints.map((ep) => {
            const timings = byEndpoint[ep];
            if (!timings || timings.length === 0) return '     N/A';
            const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
            return `${avg.toFixed(1).padStart(6)}ms`;
        });

        console.log(
            `${String(result.cycle + 1).padStart(5)} | ` +
                `${avgs[0].padStart(13)} | ` +
                `${avgs[1].padStart(12)} | ` +
                `${avgs[2].padStart(13)} | ` +
                `${avgs[3].padStart(11)} | ` +
                `${avgs[4].padStart(14)}`
        );
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('End-to-End Workflow Performance', () => {
    test.describe.configure({ mode: 'serial' });

    test('20-cycle E2E: full tag/copy/paste/merge with server timing', async ({
        page,
        loginHelpers,
    }) => {
        test.setTimeout(10 * 60 * 1000); // 10 minutes

        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need ${MIN_ITEMS} items, found ${itemCount}`);

        // Set up API timing interceptor
        const apiTimer = createAPITimer(page);
        await apiTimer.setupPromise;

        // --- Baseline ---
        console.log('\n=== Baseline (no prior tag operations) ===');
        await enterSelectionMode(page);
        const baselineIndices = selectionPatternForCycle(0, itemCount);
        const baseline = await measureSelectionE2E(page, baselineIndices);
        await exitSelectionMode(page);

        console.log(
            `  Baseline: client avg=${baseline.clientAvg.toFixed(2)}ms, ` +
                `wall=${baseline.wallDuration}ms`
        );

        // --- Run 20 cycles ---
        const cycleResults = [];
        const measurementCycles = [0, 4, 9, 14, 19]; // cycles 1, 5, 10, 15, 20

        for (let cycle = 0; cycle < 20; cycle++) {
            const isMeasurement = measurementCycles.includes(cycle);

            if (isMeasurement) {
                console.log(`\n=== Cycle ${cycle + 1}/20 (measurement) ===`);
            }

            const result = await executeFullCycle(page, apiTimer, cycle, itemCount);
            cycleResults.push(result);

            if (isMeasurement) {
                printCycleSummary(result);
            }
        }

        // --- Reports ---
        printAPIReport(apiTimer);
        printServerDegradationReport(cycleResults);

        // --- Assertions ---
        console.log('\n=== Assertions ===');

        // 1. Client-side selection should not degrade
        const firstCycle = cycleResults[0];
        const lastCycle = cycleResults[cycleResults.length - 1];

        const firstSelectAvg = firstCycle.phases.select.clientAvg;
        const lastSelectAvg = lastCycle.phases.finalSelect.clientAvg;

        if (firstSelectAvg > 0.001) {
            const clientRatio = lastSelectAvg / firstSelectAvg;
            console.log(
                `Client selection: first=${firstSelectAvg.toFixed(2)}ms → ` +
                    `last=${lastSelectAvg.toFixed(2)}ms (${clientRatio.toFixed(1)}×)`
            );
            expect(
                clientRatio,
                `Client-side selection degraded ${clientRatio.toFixed(1)}× ` + `over 20 cycles`
            ).toBeLessThan(MAX_DEGRADATION);
        }

        // 2. Wall-clock selection time should not degrade
        const firstWall = firstCycle.phases.select.wallDuration;
        const lastWall = lastCycle.phases.finalSelect.wallDuration;

        if (firstWall > 0) {
            const wallRatio = lastWall / Math.max(firstWall, 1);
            console.log(
                `Wall-clock selection: first=${firstWall}ms → ` +
                    `last=${lastWall}ms (${wallRatio.toFixed(1)}×)`
            );
            expect(
                wallRatio,
                `Wall-clock selection time degraded ${wallRatio.toFixed(1)}× ` + `over 20 cycles`
            ).toBeLessThan(MAX_DEGRADATION);
        }

        // 3. Server response times should not degrade significantly
        const apiSummary = apiTimer.getSummary();
        const bulkEndpoint = apiSummary['POST /api/tags/bulk'];

        if (bulkEndpoint) {
            // Compare first-cycle bulk calls vs last-cycle bulk calls
            const firstBulk = cycleResults[0].apiTimings.filter(
                (t) => t.method === 'POST' && t.endpoint === '/api/tags/bulk'
            );
            const lastBulk = cycleResults[cycleResults.length - 1].apiTimings.filter(
                (t) => t.method === 'POST' && t.endpoint === '/api/tags/bulk'
            );

            if (firstBulk.length > 0 && lastBulk.length > 0) {
                const firstBulkAvg =
                    firstBulk.reduce((s, t) => s + t.duration, 0) / firstBulk.length;
                const lastBulkAvg = lastBulk.reduce((s, t) => s + t.duration, 0) / lastBulk.length;

                if (firstBulkAvg > 1) {
                    const serverRatio = lastBulkAvg / firstBulkAvg;
                    console.log(
                        `Server POST /api/tags/bulk: first=${firstBulkAvg.toFixed(1)}ms → ` +
                            `last=${lastBulkAvg.toFixed(1)}ms (${serverRatio.toFixed(1)}×)`
                    );
                    expect(
                        serverRatio,
                        `Server bulk tag endpoint degraded ${serverRatio.toFixed(1)}× ` +
                            `over 20 cycles`
                    ).toBeLessThan(MAX_DEGRADATION);
                }
            }
        }

        // 4. Paste duration should not grow faster than tag count
        const pasteDurations = cycleResults.map((r) => ({
            duration: r.phases.paste.duration,
            tagCount: r.phases.paste.tagCount,
            perTag: r.phases.paste.duration / Math.max(r.phases.paste.tagCount, 1),
        }));

        const firstPerTag = pasteDurations[0].perTag;
        const lastPerTag = pasteDurations[pasteDurations.length - 1].perTag;

        if (firstPerTag > 1) {
            const pasteRatio = lastPerTag / firstPerTag;
            console.log(
                `Paste per-tag: first=${firstPerTag.toFixed(1)}ms → ` +
                    `last=${lastPerTag.toFixed(1)}ms (${pasteRatio.toFixed(1)}×)`
            );
            expect(
                pasteRatio,
                `Per-tag paste time degraded ${pasteRatio.toFixed(1)}× — ` +
                    `server may be slowing down`
            ).toBeLessThan(MAX_DEGRADATION);
        }

        // 5. No individual selection should exceed threshold
        for (const result of cycleResults) {
            for (const phase of ['select', 'reselect', 'finalSelect']) {
                const p = result.phases[phase];
                if (!p?.timings) continue;
                for (const t of p.timings) {
                    expect(
                        t.duration,
                        `Cycle ${result.cycle + 1} ${phase} item[${t.index}]: ` +
                            `${t.duration.toFixed(1)}ms exceeds ${PER_ITEM_THRESHOLD_MS}ms`
                    ).toBeLessThan(PER_ITEM_THRESHOLD_MS);
                }
            }
        }

        // Cleanup
        await apiTimer.teardown(page);
    });

    test('50-cycle E2E: long session with server degradation tracking', async ({
        page,
        loginHelpers,
    }) => {
        test.setTimeout(25 * 60 * 1000); // 25 minutes

        const itemCount = await setupGallery(page, loginHelpers);
        test.skip(itemCount < MIN_ITEMS, `Need ${MIN_ITEMS} items, found ${itemCount}`);

        const apiTimer = createAPITimer(page);
        await apiTimer.setupPromise;

        // Baseline
        await enterSelectionMode(page);
        const baselineIndices = selectionPatternForCycle(0, itemCount);
        const baseline = await measureSelectionE2E(page, baselineIndices);
        await exitSelectionMode(page);

        console.log(
            `\nBaseline: client avg=${baseline.clientAvg.toFixed(2)}ms, ` +
                `wall=${baseline.wallDuration}ms`
        );

        const cycleResults = [];
        const measurementCycles = [0, 9, 19, 29, 39, 49];

        for (let cycle = 0; cycle < 50; cycle++) {
            const isMeasurement = measurementCycles.includes(cycle);

            if (isMeasurement) {
                console.log(`\n=== Cycle ${cycle + 1}/50 ===`);
            }

            const result = await executeFullCycle(page, apiTimer, cycle, itemCount);
            cycleResults.push(result);

            if (isMeasurement) {
                printCycleSummary(result);

                const diag = await page.evaluate(() => {
                    const items = document.querySelectorAll('.gallery-item:not(.skeleton)');
                    let totalTagEls = 0;
                    items.forEach((item) => {
                        totalTagEls += item.querySelectorAll('.item-tag').length;
                    });
                    return {
                        domNodes: document.querySelectorAll('*').length,
                        tagElements: totalTagEls,
                        allTags: typeof Tags !== 'undefined' ? Tags.allTags.length : 0,
                        memory: performance.memory
                            ? (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1)
                            : 'N/A',
                    };
                });
                console.log(
                    `  DOM: ${diag.domNodes} nodes, ${diag.tagElements} tag els, ` +
                        `${diag.allTags} allTags, ${diag.memory}MB`
                );
            }
        }

        printAPIReport(apiTimer);
        printServerDegradationReport(cycleResults.filter((_, i) => measurementCycles.includes(i)));

        // Trend analysis: split into 5 buckets of 10 cycles
        console.log('\n=== 10-Cycle Bucket Trend ===');
        console.log('Bucket  | Select Avg | Paste/Tag | Cycle Time | API Calls');
        console.log('--------|------------|-----------|------------|----------');

        for (let bucket = 0; bucket < 5; bucket++) {
            const bucketResults = cycleResults.slice(bucket * 10, (bucket + 1) * 10);
            const avgSelect =
                bucketResults.reduce((s, r) => s + r.phases.select.clientAvg, 0) /
                bucketResults.length;
            const avgPastePerTag =
                bucketResults.reduce(
                    (s, r) => s + r.phases.paste.duration / Math.max(r.phases.paste.tagCount, 1),
                    0
                ) / bucketResults.length;
            const avgCycleTime =
                bucketResults.reduce((s, r) => s + r.phases.totalCycleDuration, 0) /
                bucketResults.length;
            const avgAPICalls =
                bucketResults.reduce((s, r) => s + r.apiCallCount, 0) / bucketResults.length;

            console.log(
                `${(bucket * 10 + 1 + '-' + (bucket + 1) * 10).padStart(7)} | ` +
                    `${avgSelect.toFixed(2).padStart(9)}ms | ` +
                    `${avgPastePerTag.toFixed(1).padStart(8)}ms | ` +
                    `${(avgCycleTime / 1000).toFixed(1).padStart(9)}s | ` +
                    `${avgAPICalls.toFixed(0).padStart(8)}`
            );
        }

        // Assertions
        const firstBucket = cycleResults.slice(0, 10);
        const lastBucket = cycleResults.slice(-10);

        const firstBucketSelectAvg =
            firstBucket.reduce((s, r) => s + r.phases.select.clientAvg, 0) / firstBucket.length;
        const lastBucketSelectAvg =
            lastBucket.reduce((s, r) => s + r.phases.select.clientAvg, 0) / lastBucket.length;

        if (firstBucketSelectAvg > 0.001) {
            const ratio = lastBucketSelectAvg / firstBucketSelectAvg;
            console.log(
                `\nSelection trend: first 10 avg=${firstBucketSelectAvg.toFixed(2)}ms, ` +
                    `last 10 avg=${lastBucketSelectAvg.toFixed(2)}ms (${ratio.toFixed(1)}×)`
            );
            expect(
                ratio,
                `Selection degraded ${ratio.toFixed(1)}× between first and last 10 cycles`
            ).toBeLessThan(MAX_DEGRADATION);
        }

        // Server trend
        const firstBucketPastePerTag =
            firstBucket.reduce(
                (s, r) => s + r.phases.paste.duration / Math.max(r.phases.paste.tagCount, 1),
                0
            ) / firstBucket.length;
        const lastBucketPastePerTag =
            lastBucket.reduce(
                (s, r) => s + r.phases.paste.duration / Math.max(r.phases.paste.tagCount, 1),
                0
            ) / lastBucket.length;

        if (firstBucketPastePerTag > 1) {
            const serverRatio = lastBucketPastePerTag / firstBucketPastePerTag;
            console.log(
                `Server paste/tag trend: first 10 avg=${firstBucketPastePerTag.toFixed(1)}ms, ` +
                    `last 10 avg=${lastBucketPastePerTag.toFixed(1)}ms (${serverRatio.toFixed(1)}×)`
            );
            expect(
                serverRatio,
                `Server per-tag paste time degraded ${serverRatio.toFixed(1)}× — ` +
                    `indicates server-side performance issue`
            ).toBeLessThan(MAX_DEGRADATION);
        }

        await apiTimer.teardown(page);
    });
});
