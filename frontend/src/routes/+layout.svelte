<script lang="ts">
    import '../app.css';
    import { onMount, onDestroy } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';
    import { authStore } from '$lib/stores/auth.svelte';
    import { sessionStore } from '$lib/stores/session.svelte';
    import { connectivityStore } from '$lib/stores/connectivity.svelte';
    import AppShell from '$lib/components/layout/AppShell.svelte';
    import Lightbox from '$lib/components/lightbox/Lightbox.svelte';
    import SettingsModal from '$lib/components/settings/SettingsModal.svelte';

    let { children } = $props();

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
