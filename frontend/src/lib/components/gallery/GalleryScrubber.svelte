<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import { galleryStore } from '$lib/stores/gallery.svelte';
    import { media as mediaApi } from '$lib/api/client';
    import type { SummaryGroup } from '$lib/api/types';

    // ── Scroll tracking ──────────────────────────────────────────────────────
    let scrubberEl: HTMLElement | undefined = $state();
    let scrollContainer: HTMLElement | null = null;
    /** Thumb position as 0–1 fraction of the full dataset. Imperative state:
     *  only updated from updateScroll() or after a jumpTo, never from reactive
     *  store changes, so appending items doesn't cause the thumb to jump. */
    let thumbFrac = $state(0);
    let isDragging = $state(false);
    let hoverFraction = $state<number | null>(null);

    // Only render when there's enough content to warrant a scrubber
    const visible = $derived(galleryStore.totalItems > 100);

    // Fraction of the full dataset that is currently loaded — used only for
    // the track highlight, not for the thumb.
    const loadedStart = $derived(
        galleryStore.totalItems > 0 ? galleryStore.loadOffset / galleryStore.totalItems : 0
    );
    const loadedEnd = $derived(
        galleryStore.totalItems > 0
            ? Math.min(
                  1,
                  (galleryStore.loadOffset + galleryStore.items.length) / galleryStore.totalItems
              )
            : 1
    );

    function updateScroll() {
        if (!scrollContainer) return;
        // Suppress during load operations to avoid the thumb jumping when new
        // items are appended/prepended and scrollHeight changes.
        if (galleryStore.loadingMore || galleryStore.loadingPrev || galleryStore.loading) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        const max = scrollHeight - clientHeight;
        if (max <= 0 || galleryStore.totalItems === 0) return;
        const sf = Math.max(0, Math.min(1, scrollTop / max));
        thumbFrac = Math.max(
            0,
            Math.min(
                1,
                (galleryStore.loadOffset + sf * galleryStore.items.length) / galleryStore.totalItems
            )
        );
    }

    // ── Server-side summary (full-dataset label groups) ──────────────────────
    let summaryGroups: SummaryGroup[] = $state([]);
    let summaryTotal = $state(0);

    async function fetchSummary(path: string, sort: string, order: string) {
        if (galleryStore.totalItems < 2) return;
        try {
            const s = await mediaApi.summary(path, sort, order);
            summaryGroups = s.groups ?? [];
            summaryTotal = s.total;
        } catch {
            summaryGroups = [];
        }
    }

    // Fetch whenever path or sort changes (reactive to galleryStore state).
    let lastSummaryKey = '';
    $effect(() => {
        const key = `${galleryStore.path}|${galleryStore.sort}|${galleryStore.order}|${galleryStore.totalItems}`;
        if (key !== lastSummaryKey && galleryStore.totalItems > 100) {
            lastSummaryKey = key;
            fetchSummary(galleryStore.path, galleryStore.sort, galleryStore.order);
        }
    });

    // ── Ticks from summary groups ────────────────────────────────────────────
    type Tick = { fraction: number; label: string };

    const ticks = $derived<Tick[]>(
        summaryTotal > 0
            ? summaryGroups.map((g) => ({
                  fraction: g.offset / summaryTotal,
                  label: g.label
              }))
            : []
    );

    // ── Tooltip label from summary groups ────────────────────────────────────
    function labelFromSummary(fraction: number): string {
        if (summaryTotal === 0 || summaryGroups.length === 0) return '';
        const targetOffset = Math.floor(fraction * summaryTotal);
        // Find the last group whose offset is ≤ targetOffset
        let best: SummaryGroup | null = null;
        for (const g of summaryGroups) {
            if (g.offset <= targetOffset) best = g;
            else break;
        }
        return best?.label ?? '';
    }

    const tooltipLabel = $derived(hoverFraction !== null ? labelFromSummary(hoverFraction) : '');

    // ── Jump logic ───────────────────────────────────────────────────────────
    /** Incremented on every out-of-window fetch. Stale completions bail early. */
    let jumpGen = 0;
    /** Pending fraction for the debounced out-of-window fetch. */
    let pendingFrac = 0;
    let fetchTimer: ReturnType<typeof setTimeout> | null = null;

    function doInWindowScroll(f: number) {
        if (!scrollContainer) return;
        const relFrac = loadedEnd > loadedStart ? (f - loadedStart) / (loadedEnd - loadedStart) : 0;
        const { scrollHeight, clientHeight } = scrollContainer;
        scrollContainer.scrollTop = relFrac * Math.max(0, scrollHeight - clientHeight);
    }

    async function doOutOfWindowJump(f: number) {
        const myGen = ++jumpGen;
        const targetOffset = Math.floor(f * galleryStore.totalItems);
        const relIdx = await galleryStore.jumpTo(targetOffset);
        // Bail if a newer jump has superseded this one.
        if (myGen !== jumpGen) return;
        await tick();
        if (myGen !== jumpGen) return;
        if (scrollContainer && galleryStore.items.length > 0) {
            const itemFrac = relIdx / galleryStore.items.length;
            const { scrollHeight, clientHeight } = scrollContainer;
            scrollContainer.scrollTop = itemFrac * Math.max(0, scrollHeight - clientHeight);
        }
        await tick();
        if (myGen !== jumpGen) return;
        updateScroll();
    }

    async function jumpToFraction(fraction: number) {
        const f = Math.max(0, Math.min(1, fraction));
        thumbFrac = f; // Always update thumb immediately for visual feedback.
        if (f >= loadedStart && f <= loadedEnd) {
            doInWindowScroll(f);
            return;
        }
        await doOutOfWindowJump(f);
    }

    // ── Pointer events ───────────────────────────────────────────────────────
    function fractionFromPointer(e: PointerEvent): number {
        if (!scrubberEl) return 0;
        const rect = scrubberEl.getBoundingClientRect();
        return (e.clientY - rect.top) / rect.height;
    }

    function handlePointerDown(e: PointerEvent) {
        e.preventDefault();
        isDragging = true;
        scrubberEl?.setPointerCapture(e.pointerId);
        jumpToFraction(fractionFromPointer(e));
    }

    function handlePointerMove(e: PointerEvent) {
        const f = fractionFromPointer(e);
        hoverFraction = Math.max(0, Math.min(1, f));
        if (!isDragging) return;

        const clamped = Math.max(0, Math.min(1, f));
        thumbFrac = clamped; // Thumb follows finger immediately.

        if (clamped >= loadedStart && clamped <= loadedEnd) {
            // In-window: scroll DOM synchronously, cancel any stale out-of-window fetch.
            if (fetchTimer !== null) {
                clearTimeout(fetchTimer);
                fetchTimer = null;
            }
            doInWindowScroll(clamped);
            return;
        }

        // Out-of-window: debounce the API fetch so rapid scrubbing doesn't fire
        // dozens of overlapping requests and cause the gallery to flicker.
        pendingFrac = clamped;
        if (fetchTimer !== null) clearTimeout(fetchTimer);
        fetchTimer = setTimeout(() => {
            fetchTimer = null;
            doOutOfWindowJump(pendingFrac);
        }, 60);
    }

    function handlePointerUp(e: PointerEvent) {
        if (isDragging) {
            // Cancel the debounce and do a final authoritative jump to the exact
            // release position so the loaded window always matches where the thumb rests.
            if (fetchTimer !== null) {
                clearTimeout(fetchTimer);
                fetchTimer = null;
            }
            jumpToFraction(fractionFromPointer(e));
            isDragging = false;
        }
    }

    function handlePointerLeave() {
        if (!isDragging) hoverFraction = null;
    }

    onMount(() => {
        scrollContainer = document.getElementById('main-content');
        scrollContainer?.addEventListener('scroll', updateScroll, { passive: true });
    });

    onDestroy(() => {
        scrollContainer?.removeEventListener('scroll', updateScroll);
    });
</script>

{#if visible}
    <div
        class="scrubber"
        bind:this={scrubberEl}
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointerleave={handlePointerLeave}
        role="scrollbar"
        tabindex="0"
        aria-controls="main-content"
        aria-label="Gallery position"
        aria-orientation="vertical"
        aria-valuenow={Math.round(thumbFrac * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
    >
        <!-- Tick labels (hidden on mobile) -->
        <div class="ticks" aria-hidden="true">
            {#each ticks as tick (tick.label + tick.fraction)}
                <div class="tick" style:top="{tick.fraction * 100}%">
                    <span class="tick-label">{tick.label}</span>
                    <span class="tick-dash"></span>
                </div>
            {/each}
        </div>

        <!-- Track -->
        <div class="track">
            <!-- Loaded region (bright highlight) -->
            <div
                class="region loaded"
                style:top="{loadedStart * 100}%"
                style:height="{Math.max(0, loadedEnd - loadedStart) * 100}%"
            ></div>

            <!-- Thumb -->
            <div class="thumb" class:dragging={isDragging} style:top="{thumbFrac * 100}%"></div>

            <!-- Hover line -->
            {#if hoverFraction !== null}
                <div class="hover-line" style:top="{hoverFraction * 100}%"></div>
            {/if}
        </div>

        <!-- Hover tooltip -->
        {#if hoverFraction !== null && tooltipLabel}
            <div class="tooltip" style:top="{Math.min(hoverFraction * 100, 92)}%">
                {tooltipLabel}
            </div>
        {/if}
    </div>
{/if}

<style>
    .scrubber {
        position: fixed;
        right: 0;
        top: var(--header-height, 56px);
        bottom: calc(var(--nav-height, 0px) + 40px);
        width: 32px;
        z-index: 60;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
    }

    /* On mobile: narrower, labels hidden */
    @media (max-width: 1023px) {
        .scrubber {
            bottom: calc(var(--nav-height, 60px) + var(--safe-area-inset-bottom, 0px) + 44px);
            width: 18px;
        }
    }

    /* ── Tick labels ── */
    .ticks {
        flex: 1;
        position: relative;
        pointer-events: none;
    }

    .tick {
        position: absolute;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 2px;
        transform: translateY(-50%);
        white-space: nowrap;
    }

    .tick-label {
        font-size: 9px;
        font-weight: 600;
        color: var(--color-text-muted);
        line-height: 1;
        opacity: 0.7;
    }

    .tick-dash {
        width: 3px;
        height: 1px;
        background: var(--color-text-muted);
        opacity: 0.5;
        flex-shrink: 0;
    }

    /* Hide labels on mobile */
    @media (max-width: 1023px) {
        .ticks {
            display: none;
        }
    }

    /* ── Track ── */
    .track {
        width: 4px;
        flex-shrink: 0;
        position: relative;
        background: var(--color-surface-3);
        border-radius: 2px;
        margin: 4px 4px 4px 0;
        overflow: visible;
    }

    .region {
        position: absolute;
        left: 0;
        right: 0;
        border-radius: 2px;
    }

    .loaded {
        background: var(--color-primary);
        opacity: 0.45;
    }

    /* ── Thumb ── */
    .thumb {
        position: absolute;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-bg);
        transition:
            width var(--transition-fast),
            height var(--transition-fast);
        pointer-events: none;
    }

    .thumb.dragging {
        width: 14px;
        height: 14px;
    }

    .scrubber:hover .thumb {
        width: 12px;
        height: 12px;
    }

    /* ── Hover line ── */
    .hover-line {
        position: absolute;
        left: -2px;
        right: -2px;
        height: 1px;
        background: var(--color-text-muted);
        opacity: 0.5;
        pointer-events: none;
        transform: translateY(-50%);
    }

    /* ── Tooltip ── */
    .tooltip {
        position: absolute;
        right: calc(100% + 6px);
        transform: translateY(-50%);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 2px 6px;
        font-size: var(--text-xs);
        font-weight: 600;
        color: var(--color-text);
        white-space: nowrap;
        pointer-events: none;
        box-shadow: var(--shadow-md);
    }
</style>
