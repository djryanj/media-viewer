import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import VideoPlayer from '$lib/components/lightbox/VideoPlayer.svelte';
import { controlsStore } from '$lib/stores/controls.svelte';

vi.mock('hls.js', () => ({
    default: class Hls {
        static isSupported() {
            return false;
        }
        destroy() {}
    }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const realMatchMedia = window.matchMedia;

function stubPointer(coarse: boolean) {
    window.matchMedia = ((query: string) => ({
        matches: query.includes('pointer: coarse') ? coarse : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn()
    })) as unknown as typeof window.matchMedia;
}

function renderPlayer(props: Record<string, unknown> = {}) {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    );
    const result = render(VideoPlayer, { path: '/v.mp4', autoplay: false, ...props });
    const video = result.container.querySelector('video') as HTMLVideoElement;
    const controls = () => result.container.querySelector('.vp-controls') as HTMLElement;
    return { ...result, video, controls };
}

describe('VideoPlayer — dismissing the controls', () => {
    beforeEach(() => {
        controlsStore.reset();
        stubPointer(true);
    });

    afterEach(() => {
        window.matchMedia = realMatchMedia;
        vi.unstubAllGlobals();
    });

    it('shows the controls while paused by default', () => {
        const { controls } = renderPlayer();
        expect(controls().classList.contains('visible')).toBe(true);
    });

    it('a tap on the video hides the controls even while paused', async () => {
        const { video, controls } = renderPlayer();
        await fireEvent.click(video);
        await tick();
        expect(controls().classList.contains('visible')).toBe(false);
        expect(controlsStore.dismissed).toBe(true);
    });

    it('a touch tap does not toggle playback', async () => {
        const { video } = renderPlayer();
        const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);
        await fireEvent.click(video);
        expect(play).not.toHaveBeenCalled();
    });

    it('tapping again brings the controls back', async () => {
        const { video, controls } = renderPlayer();
        await fireEvent.click(video);
        await fireEvent.click(video);
        await tick();
        expect(controls().classList.contains('visible')).toBe(true);
        expect(controlsStore.dismissed).toBe(false);
    });

    it('a touch on the dismissed player does not bring the controls back by itself', async () => {
        const { container, controls } = renderPlayer();
        controlsStore.dismiss();
        await tick();
        await fireEvent.touchStart(container.querySelector('.vp') as Element);
        await tick();
        expect(controls().classList.contains('visible')).toBe(false);
    });

    it('a newly mounted player (next/previous video) stays dismissed', async () => {
        controlsStore.dismiss();
        const { controls } = renderPlayer();
        await tick();
        expect(controls().classList.contains('visible')).toBe(false);
    });

    it('does not re-show dismissed controls when playback starts', async () => {
        controlsStore.dismiss();
        const { video, controls } = renderPlayer();
        await fireEvent.play(video);
        await tick();
        expect(controls().classList.contains('visible')).toBe(false);
    });
});

describe('VideoPlayer — mouse behaviour is unchanged', () => {
    beforeEach(() => {
        controlsStore.reset();
        stubPointer(false);
    });

    afterEach(() => {
        window.matchMedia = realMatchMedia;
        vi.unstubAllGlobals();
    });

    it('a mouse click on the video still toggles playback', async () => {
        const { video } = renderPlayer();
        const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);
        await fireEvent.click(video);
        await waitFor(() => expect(play).toHaveBeenCalled());
    });

    it('a mouse click does not dismiss the controls', async () => {
        const { video } = renderPlayer();
        vi.spyOn(video, 'play').mockResolvedValue(undefined);
        await fireEvent.click(video);
        expect(controlsStore.dismissed).toBe(false);
    });
});
