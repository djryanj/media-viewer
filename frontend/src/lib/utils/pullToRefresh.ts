/**
 * Pull-to-refresh gesture handler.
 *
 * Pure logic — no DOM access.  The caller owns event attachment and must pass
 * the scroll position via getScrollTop() so this module stays unit-testable.
 *
 * Usage:
 *   const ptr = createPullToRefresh({ getScrollTop: () => el.scrollTop, onRefresh });
 *   el.addEventListener('touchstart', e => ptr.onTouchStart(e.touches[0].clientY), { passive: true });
 *   el.addEventListener('touchmove',  e => { pulling = ptr.onTouchMove(e.touches[0].clientY); }, { passive: true });
 *   el.addEventListener('touchend',   () => { ptr.onTouchEnd(pulling); pulling = false; }, { passive: true });
 */
export interface PullToRefreshDeps {
    /** Returns the scroll position of the container (0 = at top). */
    getScrollTop: () => number;
    /** Called when a qualifying pull-down gesture completes. */
    onRefresh: () => void;
    /** Minimum downward drag distance (px) to trigger a refresh. Default: 70. */
    threshold?: number;
}

export interface PullToRefreshController {
    /** Call on touchstart with the initial touch clientY. */
    onTouchStart(clientY: number): void;
    /** Call on touchmove with the current touch clientY. Returns true when drag exceeds threshold. */
    onTouchMove(clientY: number): boolean;
    /** Call on touchend with the result of the last onTouchMove call. Fires onRefresh if true. */
    onTouchEnd(pulling: boolean): void;
    /** Reset internal state (e.g. on component unmount). */
    destroy(): void;
}

export function createPullToRefresh(deps: PullToRefreshDeps): PullToRefreshController {
    const { getScrollTop, onRefresh, threshold = 70 } = deps;
    let startY = 0;
    let active = false;

    return {
        onTouchStart(clientY: number) {
            if (getScrollTop() > 0) return;
            startY = clientY;
            active = true;
        },
        onTouchMove(clientY: number): boolean {
            if (!active) return false;
            return clientY - startY >= threshold;
        },
        onTouchEnd(pulling: boolean) {
            if (!active) return;
            active = false;
            startY = 0;
            if (pulling) onRefresh();
        },
        destroy() {
            active = false;
            startY = 0;
        }
    };
}
