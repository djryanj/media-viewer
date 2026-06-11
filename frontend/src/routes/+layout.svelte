<script lang="ts">
    import '../app.css';
    import { onMount, onDestroy } from 'svelte';
    import { goto, beforeNavigate, afterNavigate } from '$app/navigation';
    import { page } from '$app/stores';
    import { authStore } from '$lib/stores/auth.svelte';
    import { sessionStore } from '$lib/stores/session.svelte';
    import { connectivityStore } from '$lib/stores/connectivity.svelte';
    import { toastStore } from '$lib/stores/toast.svelte';
    import { createBackButtonHandler } from '$lib/utils/backButton';
    import AppShell from '$lib/components/layout/AppShell.svelte';
    import Lightbox from '$lib/components/lightbox/Lightbox.svelte';
    import SettingsModal from '$lib/components/settings/SettingsModal.svelte';

    let { children } = $props();

    // ── Mobile back button: double-tap to log out ──────────────────────────────
    // Track how many SvelteKit forward navigations have happened so we can tell
    // when the user has pressed back to the app's entry point.  When depth reaches
    // 0 (or the target would be /login, which causes a redirect loop), we intercept
    // the popstate and require a second back press within 2 s to confirm logout.

    let inAppNavDepth = 0;

    const handleBack = createBackButtonHandler({
        showToast: (msg) => toastStore.show(msg),
        logout: () => authStore.logout(),
        navigate: (path) => goto(path)
    });

    afterNavigate(({ from, type }) => {
        if (!from) return; // initial page load — depth starts at 0
        if (type === 'popstate') {
            inAppNavDepth = Math.max(0, inAppNavDepth - 1);
        } else {
            inAppNavDepth++;
        }
    });

    beforeNavigate(async ({ type, to, willUnload, cancel }) => {
        // Only intercept browser back/forward gestures for authenticated users.
        // Skip when willUnload is true — cancel() is a no-op in that case and
        // the browser will navigate away regardless.
        if (type !== 'popstate' || !authStore.authenticated || willUnload) return;

        // Allow normal in-app back navigation unless:
        //   (a) depth is 0: user is at the entry point of the session, or
        //   (b) target is /login: navigating there would redirect-loop back to /
        if (inAppNavDepth > 0 && to?.url.pathname !== '/login') return;

        cancel();
        await handleBack();
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    onMount(async () => {
        await authStore.check();
        if (
            (!authStore.authenticated || authStore.setupRequired) &&
            $page.url.pathname !== '/login'
        ) {
            goto('/login');
        }
        if (authStore.authenticated) sessionStore.init();

        connectivityStore.start();
    });

    onDestroy(() => {
        connectivityStore.stop();
    });

    // Redirect to home once logged in
    $effect(() => {
        if (authStore.checked && authStore.authenticated && $page.url.pathname === '/login') {
            goto('/');
        }
    });
</script>

{#if !authStore.checked}
    <!-- Loading splash — shown briefly during auth check -->
    <div class="splash" role="status" aria-label="Loading">
        <img src="/icons/icon.svg" alt="Media Viewer" class="splash-logo" />
    </div>
{:else if authStore.authenticated || $page.url.pathname === '/login'}
    <AppShell>
        {@render children()}
    </AppShell>
    <Lightbox />
    <SettingsModal />
{:else}
    <!-- Auth confirmed but unauthenticated — redirect in flight, keep showing splash -->
    <div class="splash" role="status" aria-label="Loading">
        <img src="/icons/icon.svg" alt="Media Viewer" class="splash-logo" />
    </div>
{/if}

<style>
    .splash {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .splash-logo {
        width: 64px;
        height: 64px;
        opacity: 0.4;
        animation: pulse 1.2s ease-in-out infinite;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 0.4;
        }
        50% {
            opacity: 0.8;
        }
    }
</style>
