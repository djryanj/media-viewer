/**
 * Session store — activity-tracked keepalive + expiry redirect.
 *
 * - Sends PUT /api/auth/keepalive every 2 min while the user is active.
 * - Considers the user inactive after 4 min of no input/video.
 * - Skips keepalive when inactive (avoids false-positive activity for idle tabs).
 * - Global 401 redirect is already handled in client.ts request(); this store
 *   handles proactive keepalive so sessions don't expire unexpectedly.
 */

import { auth as authApi } from '$lib/api/client';

const KEEPALIVE_INTERVAL_MS = 2 * 60 * 1000; // 2 min
const INACTIVITY_THRESHOLD_MS = 4 * 60 * 1000; // 4 min: skip keepalive if idle longer
const ACTIVITY_THROTTLE_MS = 1000;

function createSessionStore() {
    let lastActivity = Date.now();
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    let activityThrottle: ReturnType<typeof setTimeout> | null = null;
    let initialized = false;

    function recordActivity() {
        if (activityThrottle) return;
        activityThrottle = setTimeout(() => {
            activityThrottle = null;
        }, ACTIVITY_THROTTLE_MS);
        lastActivity = Date.now();
    }

    async function sendKeepalive() {
        const idle = Date.now() - lastActivity;
        if (idle > INACTIVITY_THRESHOLD_MS) return; // user inactive — skip
        try {
            await authApi.keepalive();
        } catch {
            // 401 is already handled globally in client.ts (redirect to login)
        }
    }

    return {
        init() {
            if (initialized || typeof document === 'undefined') return;
            initialized = true;

            const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll', 'pointerdown'];
            activityEvents.forEach((ev) =>
                document.addEventListener(ev, recordActivity, { passive: true })
            );

            // Count video playback as activity
            document.addEventListener(
                'playing',
                (e) => {
                    if ((e.target as HTMLElement).tagName === 'VIDEO') recordActivity();
                },
                true
            );
            document.addEventListener(
                'timeupdate',
                (e) => {
                    const video = e.target as HTMLVideoElement;
                    if (video.tagName === 'VIDEO' && !video.paused) {
                        if (Date.now() - lastActivity > 30_000) recordActivity();
                    }
                },
                true
            );

            keepaliveTimer = setInterval(sendKeepalive, KEEPALIVE_INTERVAL_MS);
        },

        destroy() {
            if (keepaliveTimer) clearInterval(keepaliveTimer);
            keepaliveTimer = null;
            initialized = false;
        }
    };
}

export const sessionStore = createSessionStore();
