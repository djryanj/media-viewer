/**
 * Connectivity store — polls /livez to detect and recover from network loss.
 */

import { toastStore } from './toast.svelte';

function createConnectivityStore() {
    let isOffline = $state(false);
    let _intervalId: ReturnType<typeof setInterval> | null = null;

    async function check() {
        try {
            const res = await fetch('/livez', { method: 'HEAD', cache: 'no-store' });
            if (res.ok && isOffline) {
                isOffline = false;
                toastStore.success('Connection restored');
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('connectivity:restored'));
                }
            }
        } catch {
            if (!isOffline) {
                isOffline = true;
                toastStore.error('Connection lost — retrying…');
            }
        }
    }

    return {
        get isOffline() {
            return isOffline;
        },

        start() {
            if (_intervalId !== null) return;
            check();
            _intervalId = setInterval(check, 15_000);
        },

        stop() {
            if (_intervalId !== null) {
                clearInterval(_intervalId);
                _intervalId = null;
            }
        }
    };
}

export const connectivityStore = createConnectivityStore();
