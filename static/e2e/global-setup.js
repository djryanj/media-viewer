/**
 * Playwright global setup
 *
 * Runs once before any browser is launched.  Ensures the ephemeral test
 * server (started by run-with-test-server.sh, or any other means) has its
 * initial password configured so that loginHelpers.login() succeeds.
 *
 * This mirrors what the vitest integration tests do via ensureAuthenticated()
 * in beforeAll() hooks, but at the global level so every Playwright invocation
 * benefits — regardless of whether the shell wrapper was used.
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'testpass123';

export default async function globalSetup() {
    // ── 1. Check whether setup is required ──────────────────────────────────
    let setupRequired = false;
    try {
        const res = await fetch(`${BASE_URL}/api/auth/check`);
        if (res.ok) {
            const body = await res.json();
            setupRequired = body.setupRequired === true;
        }
    } catch (err) {
        throw new Error(
            `[global-setup] Could not reach server at ${BASE_URL}/api/auth/check: ${err.message}\n` +
                'Ensure the backend is running before starting Playwright.'
        );
    }

    if (!setupRequired) {
        // Password already configured — nothing to do.
        return;
    }

    // ── 2. Configure the initial password ───────────────────────────────────
    const res = await fetch(`${BASE_URL}/api/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: TEST_PASSWORD }),
    });

    if (res.status === 200) {
        // Successfully configured.
        return;
    }

    if (res.status === 403) {
        // Another process beat us to it (e.g. the shell wrapper also called
        // /api/auth/setup).  That is fine — the password is already set.
        return;
    }

    const body = await res.text();
    throw new Error(`[global-setup] POST /api/auth/setup failed with HTTP ${res.status}: ${body}`);
}
