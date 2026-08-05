<script lang="ts">
    import '../app.css';
    import { onMount, onDestroy } from 'svelte';
    import { goto, beforeNavigate, afterNavigate } from '$app/navigation';
    import { page } from '$app/stores';
    import { authStore } from '$lib/stores/auth.svelte';
    import { sessionStore } from '$lib/stores/session.svelte';
    import { connectivityStore } from '$lib/stores/connectivity.svelte';
    import { toastStore } from '$lib/stores/toast.svelte';
    import { galleryStore } from '$lib/stores/gallery.svelte';
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
    // True while a synthesised "up a level" navigation is running. A second back
    // press landing mid-flight must not start another one — two of them would
    // both replace the same history entry and leave inAppNavDepth too high.
    let upNavInFlight = false;

    const handleBack = createBackButtonHandler({
        showToast: (msg) => toastStore.show(msg),
        logout: () => authStore.logout(),
        navigate: (path) => goto(path)
    });

    /**
     * URL one level up from `url` within the app, or null when there is nowhere
     * left to go (the root gallery). Used when the history stack has no in-app
     * entry to pop to — e.g. after a reload or a PWA launch inside a subfolder.
     */
    function parentUrl(url: URL): string | null {
        if (url.pathname !== '/') return '/';
        const p = url.searchParams.get('path');
        if (!p) return null;
        const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
        return parent ? `/?path=${encodeURIComponent(parent)}` : '/';
    }

    /** Resolves once the history.go() that cancel() issues has landed. */
    function historyRestored(): Promise<void> {
        return new Promise((resolve) => {
            let timer: ReturnType<typeof setTimeout>;
            const done = () => {
                clearTimeout(timer);
                window.removeEventListener('popstate', done);
                resolve();
            };
            timer = setTimeout(done, 100);
            window.addEventListener('popstate', done);
        });
    }

    afterNavigate(({ from, type, to }) => {
        if (!from) return; // initial page load — depth starts at 0
        // Only forward navigations are counted here. popstate decrements happen
        // in beforeNavigate — see the comment there.
        if (type !== 'popstate') {
            inAppNavDepth++;
        }
        // Clear multi-select state when entering the collections area so selected
        // items from the gallery don't carry over into a different context.
        if (to?.url.pathname.startsWith('/collections')) {
            galleryStore.clearSelection();
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
        if (inAppNavDepth > 0 && to?.url.pathname !== '/login') {
            // Decrement here rather than in afterNavigate. A second back press can
            // arrive while this navigation is still in flight; if the depth were
            // still stale it would pass this guard too and traverse past the app's
            // own entry, dropping the user out of the app entirely.
            inAppNavDepth--;
            return;
        }

        cancel();

        // The history stack has nothing useful to pop to, but the user may still
        // be deep in the tree — a reload or PWA launch inside a subfolder starts
        // at depth 0. Going up a level is what they asked for; only treat back as
        // "leave the app" once there's genuinely nowhere left to go.
        const up = parentUrl($page.url);
        if (up) {
            if (upNavInFlight) return;
            upNavInFlight = true;
            try {
                // cancel() counteracts the popstate with history.go(), which lands
                // asynchronously — wait for it before replacing the entry, or we'd
                // rewrite the wrong one.
                await historyRestored();
                const depthBefore = inAppNavDepth;
                // replaceState: this stands in for the back press, so it must not
                // deepen the stack. SvelteKit runs afterNavigate synchronously
                // before goto() resolves, so restoring the depth afterwards undoes
                // the increment that handler just made.
                await goto(up, { replaceState: true });
                inAppNavDepth = depthBefore;
            } catch {
                // goto() rejects if another navigation supersedes it — nothing to do.
            } finally {
                upNavInFlight = false;
            }
            return;
        }

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
