import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { connectivityStore } from '$lib/stores/connectivity.svelte';

// Mock the toast store so we can assert on it without side-effects.
const toastMocks = vi.hoisted(() => ({
    error: vi.fn(),
    success: vi.fn()
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: toastMocks
}));

// Flush pending microtasks without advancing any timers.
// check() is a plain async function (not a timer), so its promise chain
// resolves through the microtask queue.
async function flushMicrotasks() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

const okResponse = () =>
    vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
const failResponse = () =>
    vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

// connectivityStore is a singleton whose isOffline state persists across tests.
// Tests are ordered so each one sees the state left by the previous test.
// beforeEach only stops the poll interval; it does NOT reset isOffline.
describe('connectivityStore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        connectivityStore.stop();
        vi.clearAllMocks();
    });

    afterEach(() => {
        connectivityStore.stop();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    // --- tests that require isOffline === false (must run before offline tests) ---

    it('isOffline is false before polling starts', () => {
        expect(connectivityStore.isOffline).toBe(false);
    });

    it('does not show a success toast on the first successful poll (already online)', async () => {
        vi.stubGlobal('fetch', okResponse());
        connectivityStore.start();
        await flushMicrotasks();
        expect(toastMocks.success).not.toHaveBeenCalled();
        expect(connectivityStore.isOffline).toBe(false);
    });

    it('start() is idempotent — does not register multiple poll intervals', async () => {
        vi.stubGlobal('fetch', okResponse());
        connectivityStore.start();
        connectivityStore.start(); // second call must be a no-op
        await flushMicrotasks();
        // fetch should have been called exactly once (from the immediate check in start())
        expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    });

    // --- tests that transition to and from offline state ---

    it('becomes offline and shows an error toast when /livez fails', async () => {
        vi.stubGlobal('fetch', failResponse());
        connectivityStore.start();
        await flushMicrotasks();
        expect(connectivityStore.isOffline).toBe(true);
        expect(toastMocks.error).toHaveBeenCalledWith('Connection lost — retrying…');
        expect(toastMocks.error).toHaveBeenCalledOnce();
    });

    it('does not show a repeated error toast on consecutive poll failures', async () => {
        vi.stubGlobal('fetch', failResponse());
        connectivityStore.start();
        await flushMicrotasks(); // first check — isOffline becomes true
        vi.clearAllMocks();

        // Advance to the next poll interval and flush the resulting check() call
        vi.advanceTimersByTime(15_000);
        await flushMicrotasks();

        expect(toastMocks.error).not.toHaveBeenCalled();
        expect(connectivityStore.isOffline).toBe(true);
    });

    it('recovers: isOffline becomes false and shows a success toast', async () => {
        // Enter offline state
        vi.stubGlobal('fetch', failResponse());
        connectivityStore.start();
        await flushMicrotasks();
        expect(connectivityStore.isOffline).toBe(true);

        // Switch to a successful response for the next poll
        vi.stubGlobal('fetch', okResponse());
        vi.advanceTimersByTime(15_000);
        await flushMicrotasks();

        expect(connectivityStore.isOffline).toBe(false);
        expect(toastMocks.success).toHaveBeenCalledWith('Connection restored');
    });

    it('dispatches a connectivity:restored window event on recovery', async () => {
        const eventSpy = vi.fn();
        window.addEventListener('connectivity:restored', eventSpy);

        vi.stubGlobal('fetch', failResponse());
        connectivityStore.start();
        await flushMicrotasks();

        vi.stubGlobal('fetch', okResponse());
        vi.advanceTimersByTime(15_000);
        await flushMicrotasks();

        window.removeEventListener('connectivity:restored', eventSpy);
        expect(eventSpy).toHaveBeenCalledOnce();
    });

    it('stop() prevents further polling', async () => {
        vi.stubGlobal('fetch', failResponse());
        connectivityStore.start();
        await flushMicrotasks();
        connectivityStore.stop();
        vi.clearAllMocks();

        // Advance past the poll interval — the interval was cleared, so no more fetches
        vi.advanceTimersByTime(15_000);
        await flushMicrotasks();

        expect(vi.mocked(fetch).mock.calls).toHaveLength(0);
    });

});
