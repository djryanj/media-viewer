import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toastStore } from '$lib/stores/toast.svelte';

describe('toastStore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Dismiss any lingering toasts from previous tests
        for (const t of [...toastStore.toasts]) {
            toastStore.dismiss(t.id);
        }
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts with an empty toasts array', () => {
        expect(toastStore.toasts).toHaveLength(0);
    });

    it('show() adds a toast with the correct message and variant', () => {
        toastStore.show('Hello', 'info');
        expect(toastStore.toasts).toHaveLength(1);
        expect(toastStore.toasts[0].message).toBe('Hello');
        expect(toastStore.toasts[0].variant).toBe('info');
    });

    it('show() defaults variant to info', () => {
        toastStore.show('Default');
        expect(toastStore.toasts[0].variant).toBe('info');
    });

    it('success() adds a toast with success variant', () => {
        toastStore.success('It worked!');
        expect(toastStore.toasts).toHaveLength(1);
        expect(toastStore.toasts[0].variant).toBe('success');
        expect(toastStore.toasts[0].message).toBe('It worked!');
    });

    it('error() adds a toast with error variant', () => {
        toastStore.error('Something broke');
        expect(toastStore.toasts).toHaveLength(1);
        expect(toastStore.toasts[0].variant).toBe('error');
        expect(toastStore.toasts[0].message).toBe('Something broke');
    });

    it('dismiss() removes a toast by id', () => {
        toastStore.show('A', 'info');
        toastStore.show('B', 'success');
        const id = toastStore.toasts[0].id;
        toastStore.dismiss(id);
        expect(toastStore.toasts).toHaveLength(1);
        expect(toastStore.toasts[0].message).toBe('B');
    });

    it('auto-dismisses after the default duration', () => {
        toastStore.show('Auto', 'info', 3500);
        expect(toastStore.toasts).toHaveLength(1);
        vi.advanceTimersByTime(3500);
        expect(toastStore.toasts).toHaveLength(0);
    });

    it('does not auto-dismiss before the duration elapses', () => {
        toastStore.show('NotYet', 'info', 3500);
        vi.advanceTimersByTime(3499);
        expect(toastStore.toasts).toHaveLength(1);
    });

    it('error() uses a longer auto-dismiss duration (5000ms)', () => {
        toastStore.error('Err');
        vi.advanceTimersByTime(4999);
        expect(toastStore.toasts).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(toastStore.toasts).toHaveLength(0);
    });

    it('multiple toasts get unique ids', () => {
        toastStore.show('A', 'info');
        toastStore.show('B', 'info');
        toastStore.show('C', 'info');
        const ids = toastStore.toasts.map((t) => t.id);
        const unique = new Set(ids);
        expect(unique.size).toBe(3);
    });

    it('dismiss() on a non-existent id does nothing', () => {
        toastStore.show('X', 'info');
        toastStore.dismiss(99999);
        expect(toastStore.toasts).toHaveLength(1);
    });
});
