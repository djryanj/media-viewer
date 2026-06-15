import { describe, it, expect, vi } from 'vitest';
import { createBackButtonHandler } from '$lib/utils/backButton';

describe('createBackButtonHandler', () => {
    function makeHandler(overrides?: {
        logout?: () => Promise<void>;
        navigate?: (p: string) => void;
    }) {
        let t = 0;
        const showToast = vi.fn();
        const logout = overrides?.logout ?? vi.fn().mockResolvedValue(undefined);
        const navigate = overrides?.navigate ?? vi.fn();
        const handler = createBackButtonHandler({
            showToast,
            logout,
            navigate,
            now: () => t
        });
        return {
            handler,
            showToast,
            logout,
            navigate,
            tick: (ms: number) => {
                t += ms;
            }
        };
    }

    it('shows a toast on the first press', async () => {
        const { handler, showToast, logout } = makeHandler();
        await handler();
        expect(showToast).toHaveBeenCalledOnce();
        expect(showToast).toHaveBeenCalledWith('Tap back again to log out');
        expect(logout).not.toHaveBeenCalled();
    });

    it('logs out and navigates on second press within 2 s', async () => {
        const { handler, logout, navigate, tick } = makeHandler();
        await handler(); // first press at t=0
        tick(1999);
        await handler(); // second press at t=1999 (< 2000 ms)
        expect(logout).toHaveBeenCalledOnce();
        expect(navigate).toHaveBeenCalledWith('/login');
    });

    it('shows a toast again when second press arrives after 2 s', async () => {
        const { handler, showToast, logout, tick } = makeHandler();
        await handler(); // first press at t=0
        tick(2000);
        await handler(); // second press at t=2000 (not < 2000 ms)
        expect(showToast).toHaveBeenCalledTimes(2);
        expect(logout).not.toHaveBeenCalled();
    });

    it('logs out on the very next press after exactly 1 ms past window boundary', async () => {
        const { handler, logout, tick } = makeHandler();
        await handler(); // first press at t=0
        tick(2001);
        await handler(); // still a miss — beyond 2 s, shows toast again
        expect(logout).not.toHaveBeenCalled();
        tick(500); // now within 2 s of the second toast
        await handler(); // third press — should logout
        expect(logout).toHaveBeenCalledOnce();
    });

    it('resets the timer after logout so a later double-tap requires two presses again', async () => {
        const { handler, showToast, logout, tick } = makeHandler();
        await handler(); // first press at t=0
        tick(1000);
        await handler(); // second press — logout
        expect(logout).toHaveBeenCalledOnce();

        // After logout, the timer is fully reset (sentinel -1). Even a press
        // that would have been "within the window" now only shows a toast.
        await handler(); // shows toast, does NOT logout again
        expect(logout).toHaveBeenCalledOnce(); // still only once
        expect(showToast).toHaveBeenCalledTimes(2); // first press + this press
    });

    it('awaits logout before navigating', async () => {
        const order: string[] = [];
        const logout = vi.fn().mockImplementation(async () => {
            order.push('logout');
        });
        const navigate = vi.fn().mockImplementation(() => {
            order.push('navigate');
        });
        const { handler, tick } = makeHandler({ logout, navigate });
        await handler(); // prime
        tick(100);
        await handler(); // trigger logout
        expect(order).toEqual(['logout', 'navigate']);
    });
});
