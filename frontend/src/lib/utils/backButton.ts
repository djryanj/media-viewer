/**
 * Double-tap-to-act guard for the mobile back button.
 *
 * First invocation shows a confirmation toast; second invocation within
 * windowMs calls action(). The timer resets after a successful action so
 * a subsequent double-tap requires two presses again.
 */
export interface BackButtonDeps {
    showToast: (message: string) => void;
    logout: () => Promise<void>;
    navigate: (path: string) => void;
    /** Injected for testing; defaults to Date.now. */
    now?: () => number;
}

export function createBackButtonHandler(deps: BackButtonDeps): () => Promise<void> {
    const { showToast, logout, navigate, now = () => Date.now() } = deps;
    const WINDOW_MS = 2000;
    let lastBackAt = -1;

    return async function handleBack(): Promise<void> {
        const t = now();
        if (lastBackAt >= 0 && t - lastBackAt < WINDOW_MS) {
            lastBackAt = -1;
            await logout();
            navigate('/login');
        } else {
            lastBackAt = t;
            showToast('Tap back again to log out');
        }
    };
}
