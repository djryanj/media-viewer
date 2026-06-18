import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import VideoPlayer from '$lib/components/lightbox/VideoPlayer.svelte';

// Hls.isSupported is made configurable so tests can route through loadViaHls
// (where the component awaits the HLS session fetch) instead of loadDirect
// (where happy-dom fires durationchange synchronously on src assignment,
// clearing loading state before we can assert on it).
const hlsMocks = vi.hoisted(() => ({
    isSupported: vi.fn(() => false)
}));

vi.mock('hls.js', () => ({
    default: class Hls {
        static isSupported() {
            return hlsMocks.isSupported();
        }
        destroy() {}
    }
}));

// Mock $app/navigation (not used by VideoPlayer but imported transitively)
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

function mockStreamInfoFetch(response: object = {}) {
    return vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(response)
    });
}

// Resolves stream-info immediately with `response`; stalls any subsequent fetch
// (the HLS session endpoint) so the component stays suspended after it sets
// `loading = true` and `transcoding = true`, letting us assert on those states.
function mockStreamInfoThenStall(response: object) {
    return vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('/api/stream-info/')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(response) });
        }
        return new Promise(() => {});
    });
}

describe('VideoPlayer', () => {
    beforeEach(() => {
        hlsMocks.isSupported.mockReturnValue(false);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('calls onEnded when the video ended event fires and loop is false', async () => {
        vi.stubGlobal('fetch', mockStreamInfoFetch({ needsTranscode: false }));

        const onEnded = vi.fn();
        const { container } = render(VideoPlayer, {
            props: { path: 'test.mp4', loop: false, autoplay: false, onEnded }
        });

        const video = container.querySelector('video')!;
        expect(video).toBeTruthy();

        // Wait for the $effect-driven loadSource to run and set video.src
        await vi.waitFor(() => {
            expect(video.src).toContain('/api/stream/');
        });

        video.dispatchEvent(new Event('ended'));
        expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('calls onEnded even when loop is true — advance takes priority over loop', async () => {
        // When an explicit onEnded callback is provided it always fires.
        // loop=true only prevents the video from re-starting on its own (via
        // videoEl.loop for native or the HLS handler) — it does not suppress onEnded.
        vi.stubGlobal('fetch', mockStreamInfoFetch({ needsTranscode: false }));

        const onEnded = vi.fn();
        const { container } = render(VideoPlayer, {
            props: { path: 'test.mp4', loop: true, autoplay: false, onEnded }
        });

        const video = container.querySelector('video')!;

        await vi.waitFor(() => {
            expect(video.src).toContain('/api/stream/');
        });

        video.dispatchEvent(new Event('ended'));
        expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('does not throw when onEnded is not provided and ended fires', async () => {
        vi.stubGlobal('fetch', mockStreamInfoFetch({ needsTranscode: false }));

        const { container } = render(VideoPlayer, {
            props: { path: 'test.mp4', loop: false, autoplay: false }
        });

        const video = container.querySelector('video')!;

        await vi.waitFor(() => {
            expect(video.src).toContain('/api/stream/');
        });

        expect(() => video.dispatchEvent(new Event('ended'))).not.toThrow();
    });
});

// ── Loading indicator ─────────────────────────────────────────────────────────
//
// happy-dom fires `durationchange` synchronously when video.src is assigned,
// which would immediately clear `loading` before we can assert on it.  The
// solution for tests that need the spinner to stay visible is to route the
// component through loadViaHls (Hls.isSupported=true) where it awaits the HLS
// session fetch — stalled by mockStreamInfoThenStall — keeping loading=true.

describe('VideoPlayer — loading indicator', () => {
    beforeEach(() => {
        hlsMocks.isSupported.mockReturnValue(false);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('shows a loading spinner immediately while the source is being fetched', async () => {
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {}))); // never resolves
        const { container } = render(VideoPlayer, { props: { path: 'test.mp4', autoplay: false } });
        await waitFor(() => expect(container.querySelector('.vp-loading')).toBeTruthy());
        expect(container.querySelector('.vp-spinner')).toBeTruthy();
    });

    it('does not show the "Transcoding video…" label while stream-info is still loading', async () => {
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
        const { container } = render(VideoPlayer, { props: { path: 'test.mp4', autoplay: false } });
        await waitFor(() => expect(container.querySelector('.vp-loading')).toBeTruthy());
        expect(container.querySelector('.vp-loading-label')).toBeNull();
    });

    it('shows "Transcoding video…" label after stream-info reports needsTranscode', async () => {
        // isSupported=true routes into loadViaHls; the stalled session fetch keeps
        // the component suspended with loading=true and transcoding=true.
        hlsMocks.isSupported.mockReturnValue(true);
        vi.stubGlobal('fetch', mockStreamInfoThenStall({ needsTranscode: true }));
        const { container } = render(VideoPlayer, { props: { path: 'test.mp4', autoplay: false } });
        await waitFor(() =>
            expect(container.querySelector('.vp-loading-label')?.textContent).toContain(
                'Transcoding'
            )
        );
    });

    it('does not show "Transcoding video…" when needsTranscode is false', async () => {
        vi.stubGlobal('fetch', mockStreamInfoFetch({ needsTranscode: false }));
        const { container } = render(VideoPlayer, { props: { path: 'test.mp4', autoplay: false } });
        // Wait for stream-info to resolve; transcoding was never set so the label
        // must never appear regardless of whether the spinner itself is still visible.
        await vi.waitFor(() =>
            expect(container.querySelector('video')!.src).toContain('/api/stream/')
        );
        expect(container.querySelector('.vp-loading-label')).toBeNull();
    });

    it('hides the spinner when the video fires a play event', async () => {
        hlsMocks.isSupported.mockReturnValue(true);
        vi.stubGlobal('fetch', mockStreamInfoThenStall({ needsTranscode: true }));
        const { container } = render(VideoPlayer, { props: { path: 'test.mp4', autoplay: false } });
        const video = container.querySelector('video')!;
        await waitFor(() => expect(container.querySelector('.vp-loading')).toBeTruthy());

        video.dispatchEvent(new Event('play'));
        await tick();

        expect(container.querySelector('.vp-loading')).toBeNull();
    });

    it('hides the spinner when the video fires a durationchange event', async () => {
        hlsMocks.isSupported.mockReturnValue(true);
        vi.stubGlobal('fetch', mockStreamInfoThenStall({ needsTranscode: true }));
        const { container } = render(VideoPlayer, { props: { path: 'test.mp4', autoplay: false } });
        const video = container.querySelector('video')!;
        await waitFor(() => expect(container.querySelector('.vp-loading')).toBeTruthy());

        video.dispatchEvent(new Event('durationchange'));
        await tick();

        expect(container.querySelector('.vp-loading')).toBeNull();
    });

    it('hides the spinner when the video encounters an error', async () => {
        hlsMocks.isSupported.mockReturnValue(true);
        vi.stubGlobal('fetch', mockStreamInfoThenStall({ needsTranscode: true }));
        const { container } = render(VideoPlayer, { props: { path: 'test.mp4', autoplay: false } });
        const video = container.querySelector('video')!;
        await waitFor(() => expect(container.querySelector('.vp-loading')).toBeTruthy());

        video.dispatchEvent(new Event('error'));
        await tick();

        expect(container.querySelector('.vp-loading')).toBeNull();
    });

    it('clears the transcoding label when the video starts playing', async () => {
        hlsMocks.isSupported.mockReturnValue(true);
        vi.stubGlobal('fetch', mockStreamInfoThenStall({ needsTranscode: true }));
        const { container } = render(VideoPlayer, { props: { path: 'test.mp4', autoplay: false } });
        const video = container.querySelector('video')!;
        await waitFor(() =>
            expect(container.querySelector('.vp-loading-label')?.textContent).toContain(
                'Transcoding'
            )
        );

        video.dispatchEvent(new Event('play'));
        await tick();

        expect(container.querySelector('.vp-loading')).toBeNull();
        expect(container.querySelector('.vp-loading-label')).toBeNull();
    });
});
