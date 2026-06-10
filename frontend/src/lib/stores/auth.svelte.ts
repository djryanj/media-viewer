/**
 * Auth store — tracks authentication state.
 * Loaded once on app boot from /auth/status.
 */

import { auth as authApi, ApiError } from '$lib/api/client';

type AuthState = {
    checked: boolean;
    authenticated: boolean;
    setupRequired: boolean;
    username: string;
};

function createAuthStore() {
    let state = $state<AuthState>({
        checked: false,
        authenticated: false,
        setupRequired: false,
        username: ''
    });

    return {
        get checked() {
            return state.checked;
        },
        get authenticated() {
            return state.authenticated;
        },
        get setupRequired() {
            return state.setupRequired;
        },
        get username() {
            return state.username;
        },

        async check() {
            try {
                const res = await authApi.status();
                state = {
                    checked: true,
                    authenticated: res.authenticated,
                    setupRequired: res.setupRequired,
                    username: res.username ?? ''
                };
            } catch {
                state = { checked: true, authenticated: false, setupRequired: false, username: '' };
            }
        },

        async setup(password: string): Promise<void> {
            await authApi.setup(password);
            // After setup, log in immediately
            await authApi.login(password);
            state = { checked: true, authenticated: true, setupRequired: false, username: '' };
        },

        async login(password: string): Promise<boolean> {
            try {
                await authApi.login(password);
                state = { checked: true, authenticated: true, setupRequired: false, username: '' };
                return true;
            } catch (e) {
                if (e instanceof ApiError) throw e;
                return false;
            }
        },

        async logout() {
            await authApi.logout().catch(() => undefined);
            state = { checked: true, authenticated: false, setupRequired: false, username: '' };
        }
    };
}

export const authStore = createAuthStore();
