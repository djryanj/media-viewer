<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { version as versionApi, system } from '$lib/api/client';
    import type { BuildInfo, SystemStatus } from '$lib/api/types';
    import { galleryStore } from '$lib/stores/gallery.svelte';

    const itemCount = $derived(
        !galleryStore.loading && galleryStore.totalItems > 0
            ? galleryStore.totalItems
            : null
    );

    let buildInfo = $state<BuildInfo | null>(null);
    let status = $state<SystemStatus | null>(null);
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Derived: is any worker actively running?
    const anyRunning = $derived(
        !!status && (
            status.indexer.summary.running ||
            status.thumbnails.summary.running ||
            status.autotagger.summary.running
        )
    );

    async function fetchStatus() {
        try {
            status = await system.status();
        } catch { /* silently ignore */ }
    }

    function startPolling() {
        pollTimer = setInterval(fetchStatus, anyRunning ? 3000 : 15000);
    }

    // Re-schedule whenever running state changes so the interval adapts
    $effect(() => {
        const _running = anyRunning; // track reactively
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(fetchStatus, _running ? 3000 : 15000);
    });

    onMount(async () => {
        [buildInfo] = await Promise.allSettled([versionApi.get(), fetchStatus()])
            .then(([v]) => [v.status === 'fulfilled' ? v.value : null]);
        startPolling();
    });

    onDestroy(() => {
        if (pollTimer) clearInterval(pollTimer);
    });

    function workerLabel(name: string, w: SystemStatus['indexer']): string {
        if (!w.summary.running) return '';
        const pct = w.metrics.progressPercent;
        if (pct != null) return `${name} ${Math.round(pct)}%`;
        const processed = w.metrics.processedItems;
        if (processed) return `${name} (${processed} processed)`;
        return name;
    }

    const activeWorkers = $derived(
        status
            ? [
                  status.indexer.summary.running ? workerLabel('Indexing', status.indexer) : '',
                  status.thumbnails.summary.running ? workerLabel('Thumbnails', status.thumbnails) : '',
                  status.autotagger.summary.running ? workerLabel('Auto-tagging', status.autotagger) : ''
              ].filter(Boolean)
            : []
    );
</script>

<footer class="status-footer">
    <!-- Left: item count -->
    <span class="left">
        {#if itemCount != null}
            {itemCount} item{itemCount !== 1 ? 's' : ''}
        {/if}
    </span>

    <!-- Centre: active workers -->
    <span class="centre">
        {#if activeWorkers.length > 0}
            <span class="worker-dot" aria-hidden="true"></span>
            {activeWorkers.join(' · ')}
        {/if}
    </span>

    <!-- Right: version -->
    <span class="right">
        {#if buildInfo}
            v{buildInfo.version}
        {/if}
    </span>
</footer>

<style>
    .status-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-2) var(--spacing-4);
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        border-top: 1px solid var(--color-border);
        gap: var(--spacing-3);
        flex-shrink: 0;
        /* On mobile the fixed BottomNav sits on top, so pad below it */
        padding-bottom: calc(var(--spacing-2) + var(--nav-height) + var(--safe-area-inset-bottom));
        user-select: none;
    }

    /* On desktop there is no BottomNav, so no extra padding needed */
    @media (min-width: 1024px) {
        .status-footer {
            padding-bottom: var(--spacing-2);
        }
    }

    .left  { flex: 1; }
    .right { flex: 1; text-align: right; }
    .centre {
        flex: 2;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-1);
        color: var(--color-primary);
        font-weight: 500;
    }

    .worker-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-primary);
        flex-shrink: 0;
        animation: pulse 1.4s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: 0.4; transform: scale(0.75); }
    }
</style>
