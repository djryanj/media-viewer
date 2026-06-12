import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import VideoPlayer from '$lib/components/lightbox/VideoPlayer.svelte';

// Mock hls.js — not needed for the ended-event path
vi.mock('hls.js', () => ({
    default: class Hls {
        static isSupported() {
            return false;
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

describe('VideoPlayer', () => {
    let restoreFetch: () => void;

    beforeEach(() => {
        const original = globalThis.fetch;
        restoreFetch = () => {
            globalThis.fetch = original;
        };
    });

    afterEach(() => {
        restoreFetch();
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
