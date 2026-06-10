<script lang="ts">
    import { toastStore } from '$lib/stores/toast.svelte';
</script>

<div class="toast-container" role="status" aria-live="polite" aria-atomic="false">
    {#each toastStore.toasts as toast (toast.id)}
        <div class="toast toast--{toast.variant}">
            <span>{toast.message}</span>
            <button
                class="toast-close"
                onclick={() => toastStore.dismiss(toast.id)}
                aria-label="Dismiss"
            >×</button>
        </div>
    {/each}
</div>

<style>
    .toast-container {
        position: fixed;
        bottom: calc(var(--nav-height) + var(--safe-area-inset-bottom) + var(--spacing-4));
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
        z-index: 500;
        pointer-events: none;
        width: min(360px, calc(100vw - 32px));
    }

    @media (min-width: 1024px) {
        .toast-container {
            bottom: var(--spacing-6);
        }
    }

    .toast {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-3);
        padding: var(--spacing-3) var(--spacing-4);
        border-radius: var(--radius-lg);
        font-size: var(--text-sm);
        box-shadow: var(--shadow-md);
        pointer-events: all;
        animation: slideUp 160ms ease;
    }

    .toast--success {
        background: var(--color-success);
        color: #000;
    }

    .toast--error {
        background: var(--color-danger);
        color: #fff;
    }

    .toast--info {
        background: var(--color-surface-3);
        color: var(--color-text);
        border: 1px solid var(--color-border);
    }

    .toast-close {
        background: none;
        border: none;
        cursor: pointer;
        font-size: var(--text-lg);
        line-height: 1;
        padding: 0;
        color: inherit;
        opacity: 0.7;
        flex-shrink: 0;
    }

    @keyframes slideUp {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
</style>
