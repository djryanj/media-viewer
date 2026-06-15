import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ToastContainer from '$lib/components/ui/ToastContainer.svelte';
import { toastStore } from '$lib/stores/toast.svelte';

// Clean up the singleton store state before and after each test so tests are
// independent regardless of run order.
function clearToasts() {
    [...toastStore.toasts].forEach((t) => toastStore.dismiss(t.id));
}

beforeEach(clearToasts);
afterEach(clearToasts);

describe('ToastContainer', () => {
    it('renders a live region with role="status"', () => {
        render(ToastContainer);
        const region = screen.getByRole('status');
        expect(region).toBeTruthy();
    });

    it('shows no toasts when the store is empty', () => {
        render(ToastContainer);
        const region = screen.getByRole('status');
        expect(region.querySelectorAll('.toast')).toHaveLength(0);
    });

    it('displays a toast message added before render', () => {
        toastStore.show('Hello from toast');
        render(ToastContainer);
        expect(screen.getByText('Hello from toast')).toBeTruthy();
    });

    it('shows multiple toasts', () => {
        toastStore.show('First');
        toastStore.show('Second');
        render(ToastContainer);
        expect(screen.getByText('First')).toBeTruthy();
        expect(screen.getByText('Second')).toBeTruthy();
    });

    it('applies the correct variant class to each toast', () => {
        toastStore.success('Saved!');
        toastStore.error('Failed!');
        render(ToastContainer);
        const { container } = render(ToastContainer);
        const successToast = container.querySelector('.toast--success');
        const errorToast = container.querySelector('.toast--error');
        expect(successToast).toBeTruthy();
        expect(errorToast).toBeTruthy();
    });

    it('each toast has a dismiss button', () => {
        toastStore.show('Dismissible');
        render(ToastContainer);
        const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
        expect(dismissBtn).toBeTruthy();
    });

    it('clicking dismiss removes the toast', async () => {
        toastStore.show('Remove me');
        render(ToastContainer);
        expect(screen.getByText('Remove me')).toBeTruthy();

        const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
        await fireEvent.click(dismissBtn);

        expect(screen.queryByText('Remove me')).toBeNull();
    });

    it('toastStore.success creates a success variant', () => {
        toastStore.success('All good');
        const toast = toastStore.toasts[0];
        expect(toast.variant).toBe('success');
        expect(toast.message).toBe('All good');
    });

    it('toastStore.error creates an error variant', () => {
        toastStore.error('Something broke');
        const toast = toastStore.toasts[0];
        expect(toast.variant).toBe('error');
        expect(toast.message).toBe('Something broke');
    });
});
