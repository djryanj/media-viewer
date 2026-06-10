<script lang="ts">
    import { page } from '$app/stores';
    import Header from './Header.svelte';
    import BottomNav from './BottomNav.svelte';
    import StatusFooter from './StatusFooter.svelte';
    import ToastContainer from '../ui/ToastContainer.svelte';

    let { children } = $props();

    // Hide the bottom nav in the lightbox (full-screen) context
    const isLogin = $derived($page.url.pathname === '/login');
</script>

<div class="app-shell" class:login={isLogin}>
    {#if !isLogin}
        <Header />
    {/if}

    <main class="main-content" id="main-content">
        <div class="content-wrap">
            {@render children()}
        </div>
    </main>

    {#if !isLogin}
        <StatusFooter />
        <BottomNav />
    {/if}

    <ToastContainer />
</div>

<style>
    .app-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        /* Account for iOS safe area */
        padding-top: var(--safe-area-inset-top);
    }

    .main-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        /* Hardware-accelerated scroll on mobile */
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
    }

    .content-wrap {
        width: 100%;
        min-height: 100%;
    }

    @media (min-width: 1024px) {
        .content-wrap {
            max-width: 1600px;
            margin-inline: auto;
            padding-inline: var(--spacing-5);
        }
    }

    @media (min-width: 1440px) {
        .content-wrap {
            padding-inline: var(--spacing-6);
        }
    }

    .app-shell.login .main-content {
        padding-bottom: 0;
    }
</style>
