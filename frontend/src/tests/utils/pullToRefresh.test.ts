import { describe, it, expect, vi } from 'vitest';
import { createPullToRefresh } from '$lib/utils/pullToRefresh';

describe('createPullToRefresh', () => {
    function make(opts: { scrollTop?: number; threshold?: number } = {}) {
        const { scrollTop = 0, threshold } = opts;
        const onRefresh = vi.fn();
        const ptr = createPullToRefresh({
            getScrollTop: () => scrollTop,
            onRefresh,
            ...(threshold !== undefined ? { threshold } : {})
        });
        return { ptr, onRefresh };
    }

    it('triggers refresh when pulled down beyond threshold', () => {
        const { ptr, onRefresh } = make();
        ptr.onTouchStart(0);
        const pulling = ptr.onTouchMove(80); // 80 >= 70 (default)
        ptr.onTouchEnd(pulling);
        expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('does not trigger when pulled below threshold', () => {
        const { ptr, onRefresh } = make();
        ptr.onTouchStart(0);
        const pulling = ptr.onTouchMove(50); // 50 < 70
        ptr.onTouchEnd(pulling);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('triggers at exactly the threshold boundary', () => {
        const { ptr, onRefresh } = make({ threshold: 70 });
        ptr.onTouchStart(0);
        const pulling = ptr.onTouchMove(70); // exactly 70 = threshold
        ptr.onTouchEnd(pulling);
        expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('respects a custom threshold', () => {
        const { ptr, onRefresh } = make({ threshold: 100 });
        ptr.onTouchStart(0);
        expect(ptr.onTouchMove(80)).toBe(false); // below custom threshold
        expect(ptr.onTouchMove(100)).toBe(true); // at custom threshold
        ptr.onTouchEnd(true);
        expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('does not start gesture when scrollTop > 0', () => {
        const { ptr, onRefresh } = make({ scrollTop: 100 });
        ptr.onTouchStart(0);
        const pulling = ptr.onTouchMove(200); // large delta but container is scrolled down
        ptr.onTouchEnd(pulling);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('does not re-trigger on duplicate onTouchEnd without a new onTouchStart', () => {
        const { ptr, onRefresh } = make();
        ptr.onTouchStart(0);
        const pulling = ptr.onTouchMove(100);
        ptr.onTouchEnd(pulling);
        ptr.onTouchEnd(true); // second end without a new touchstart
        expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('allows a second pull after the first completes', () => {
        const { ptr, onRefresh } = make();
        // First pull
        ptr.onTouchStart(0);
        ptr.onTouchEnd(ptr.onTouchMove(100));
        // Second pull
        ptr.onTouchStart(0);
        ptr.onTouchEnd(ptr.onTouchMove(100));
        expect(onRefresh).toHaveBeenCalledTimes(2);
    });

    it('destroy() prevents a subsequent onTouchEnd from firing refresh', () => {
        const { ptr, onRefresh } = make();
        ptr.onTouchStart(0);
        ptr.destroy(); // cancel before releasing
        ptr.onTouchEnd(ptr.onTouchMove(200)); // active was cleared by destroy
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('onTouchMove returns false when no gesture is in progress', () => {
        const { ptr } = make();
        // Never called onTouchStart
        expect(ptr.onTouchMove(999)).toBe(false);
    });

    it('measures drag from the actual start position, not from 0', () => {
        const { ptr, onRefresh } = make();
        ptr.onTouchStart(200); // start at y=200
        expect(ptr.onTouchMove(260)).toBe(false); // delta 60 < 70
        expect(ptr.onTouchMove(270)).toBe(true); // delta 70 >= 70
        ptr.onTouchEnd(true);
        expect(onRefresh).toHaveBeenCalledOnce();
    });
});
