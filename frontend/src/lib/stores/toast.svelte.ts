/**
 * Toast notification store.
 */

type ToastVariant = 'success' | 'error' | 'info';

type Toast = {
    id: number;
    message: string;
    variant: ToastVariant;
};

function createToastStore() {
    let toasts = $state<Toast[]>([]);
    let nextId = 0;

    return {
        get toasts() {
            return toasts;
        },

        show(message: string, variant: ToastVariant = 'info', duration = 3500) {
            const id = ++nextId;
            toasts = [...toasts, { id, message, variant }];
            setTimeout(() => this.dismiss(id), duration);
        },

        success(message: string) {
            this.show(message, 'success');
        },

        error(message: string) {
            this.show(message, 'error', 5000);
        },

        dismiss(id: number) {
            toasts = toasts.filter((t) => t.id !== id);
        }
    };
}

export const toastStore = createToastStore();
