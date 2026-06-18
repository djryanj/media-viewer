import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import StatusFooter from '$lib/components/layout/StatusFooter.svelte';
import type { SystemStatus } from '$lib/api/types';

const mocks = vi.hoisted(() => ({
    versionGet: vi.fn(),
    systemStatus: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
    version: { get: mocks.versionGet },
    system: { status: mocks.systemStatus }
}));

const galleryState = vi.hoisted(() => ({ loading: false, totalItems: 0 }));

vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: galleryState
}));

function makeStatus(overrides: Partial<SystemStatus> = {}): SystemStatus {
    const idle = {
        summary: { enabled: true, running: false, state: 'idle' },
        metrics: { processedItems: 0 }
    };
    return {
        updatedAt: '2024-01-01T00:00:00Z',
        library: {
            totalFiles: 0,
            totalImages: 0,
            totalVideos: 0,
            totalFolders: 0,
            totalPlaylists: 0,
            totalTags: 0,
            totalFavorites: 0,
            thumbnailCacheFiles: 0,
            thumbnailCacheBytes: 0,
            transcodeCacheFiles: 0,
            transcodeCacheBytes: 0,
            lastIndexed: ''
        },
        indexer: idle,
        thumbnails: idle,
        autotagger: idle,
        ...overrides
    };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.clearAllMocks();
    galleryState.loading = false;
    galleryState.totalItems = 0;
    mocks.versionGet.mockResolvedValue(null);
    mocks.systemStatus.mockResolvedValue(makeStatus());
});

afterEach(() => {
    vi.useRealTimers();
});

// ── Version display ───────────────────────────────────────────────────────────

describe('StatusFooter — version display', () => {
    it('displays version unchanged when it already starts with "v"', async () => {
        mocks.versionGet.mockResolvedValue({
            version: 'v0.19.0',
            commit: 'abc',
            buildTime: '',
            goVersion: '',
            os: '',
            arch: ''
        });
        render(StatusFooter);
        await waitFor(() => expect(screen.getByText('v0.19.0')).toBeTruthy());
    });

    it('prepends "v" when version is a bare semver without prefix', async () => {
        mocks.versionGet.mockResolvedValue({
            version: '0.19.0',
            commit: 'abc',
            buildTime: '',
            goVersion: '',
            os: '',
            arch: ''
        });
        render(StatusFooter);
        await waitFor(() => expect(screen.getByText('v0.19.0')).toBeTruthy());
    });

    it('displays "dev" without adding "v" prefix', async () => {
        mocks.versionGet.mockResolvedValue({
            version: 'dev',
            commit: 'abc',
            buildTime: '',
            goVersion: '',
            os: '',
            arch: ''
        });
        render(StatusFooter);
        await waitFor(() => expect(screen.getByText('dev')).toBeTruthy());
    });

    it('shows nothing in the version slot while buildInfo has not loaded', () => {
        mocks.versionGet.mockReturnValue(new Promise(() => {})); // never resolves
        const { container } = render(StatusFooter);
        const right = container.querySelector('.right');
        expect(right?.textContent?.trim()).toBe('');
    });
});

// ── Item count ────────────────────────────────────────────────────────────────

describe('StatusFooter — item count', () => {
    it('shows "N items" when gallery has items and is not loading', async () => {
        galleryState.totalItems = 42;
        galleryState.loading = false;
        render(StatusFooter);
        await waitFor(() => expect(screen.getByText('42 items')).toBeTruthy());
    });

    it('uses singular "item" when there is exactly one item', async () => {
        galleryState.totalItems = 1;
        galleryState.loading = false;
        render(StatusFooter);
        await waitFor(() => expect(screen.getByText('1 item')).toBeTruthy());
    });

    it('shows nothing when the gallery is loading', () => {
        galleryState.totalItems = 100;
        galleryState.loading = true;
        const { container } = render(StatusFooter);
        const left = container.querySelector('.left');
        expect(left?.textContent?.trim()).toBe('');
    });

    it('shows nothing when totalItems is 0', () => {
        galleryState.totalItems = 0;
        galleryState.loading = false;
        const { container } = render(StatusFooter);
        const left = container.querySelector('.left');
        expect(left?.textContent?.trim()).toBe('');
    });
});

// ── Worker status labels ──────────────────────────────────────────────────────

describe('StatusFooter — worker labels', () => {
    it('shows nothing in the centre when all workers are idle', async () => {
        mocks.systemStatus.mockResolvedValue(makeStatus());
        const { container } = render(StatusFooter);
        await waitFor(() => expect(mocks.systemStatus).toHaveBeenCalled());
        const centre = container.querySelector('.centre');
        expect(centre?.textContent?.trim()).toBe('');
    });

    it('shows "Indexing" when indexer is running with no progress info', async () => {
        mocks.systemStatus.mockResolvedValue(
            makeStatus({
                indexer: {
                    summary: { enabled: true, running: true, state: 'running' },
                    metrics: { processedItems: 0 }
                }
            })
        );
        render(StatusFooter);
        await waitFor(() => expect(screen.getByText('Indexing')).toBeTruthy());
    });

    it('shows percentage when progressPercent is available', async () => {
        mocks.systemStatus.mockResolvedValue(
            makeStatus({
                indexer: {
                    summary: { enabled: true, running: true, state: 'running' },
                    metrics: { processedItems: 50, progressPercent: 42.6 }
                }
            })
        );
        render(StatusFooter);
        await waitFor(() => expect(screen.getByText('Indexing 43%')).toBeTruthy());
    });

    it('shows processed item count when progressPercent is absent', async () => {
        mocks.systemStatus.mockResolvedValue(
            makeStatus({
                thumbnails: {
                    summary: { enabled: true, running: true, state: 'running' },
                    metrics: { processedItems: 10 }
                }
            })
        );
        render(StatusFooter);
        await waitFor(() => expect(screen.getByText('Thumbnails (10 processed)')).toBeTruthy());
    });

    it('joins multiple active workers with " · "', async () => {
        mocks.systemStatus.mockResolvedValue(
            makeStatus({
                indexer: {
                    summary: { enabled: true, running: true, state: 'running' },
                    metrics: { processedItems: 0 }
                },
                thumbnails: {
                    summary: { enabled: true, running: true, state: 'running' },
                    metrics: { processedItems: 0 }
                }
            })
        );
        render(StatusFooter);
        await waitFor(() => expect(screen.getByText('Indexing · Thumbnails')).toBeTruthy());
    });
});

// ── Window events ─────────────────────────────────────────────────────────────

describe('StatusFooter — window events', () => {
    it('dispatches "indexer:running" when any worker is active', async () => {
        mocks.systemStatus.mockResolvedValue(
            makeStatus({
                indexer: {
                    summary: { enabled: true, running: true, state: 'running' },
                    metrics: { processedItems: 0 }
                }
            })
        );
        const handler = vi.fn();
        window.addEventListener('indexer:running', handler);
        render(StatusFooter);
        await waitFor(() => expect(handler).toHaveBeenCalled());
        window.removeEventListener('indexer:running', handler);
    });

    it('dispatches "indexer:complete" when workers transition from running to idle', async () => {
        mocks.systemStatus
            .mockResolvedValueOnce(
                makeStatus({
                    indexer: {
                        summary: { enabled: true, running: true, state: 'running' },
                        metrics: { processedItems: 0 }
                    }
                })
            )
            .mockResolvedValueOnce(makeStatus());

        const completeHandler = vi.fn();
        window.addEventListener('indexer:complete', completeHandler);

        render(StatusFooter);
        // Wait for the running state to register
        await waitFor(() => expect(mocks.systemStatus).toHaveBeenCalledOnce());
        // Advance 3 s to trigger the running-mode interval for the second poll
        await vi.advanceTimersByTimeAsync(3001);
        await waitFor(() => expect(completeHandler).toHaveBeenCalled());

        window.removeEventListener('indexer:complete', completeHandler);
    });
});
