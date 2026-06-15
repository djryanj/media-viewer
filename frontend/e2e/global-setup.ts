import { request, type FullConfig } from '@playwright/test';
import { mkdir } from 'fs/promises';

export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'testpass123';
export const STORAGE_STATE = 'e2e/.auth/user.json';

export default async function globalSetup(config: FullConfig) {
    // Resolve backend base URL: prefer TEST_BASE_URL (set by run-with-test-server.sh),
    // then fall back to the first project's baseURL, then localhost:5173.
    const baseURL =
        process.env.TEST_BASE_URL ?? config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';

    // If setup is required (fresh database), create the initial user account.
    const checkRes = await fetch(`${baseURL}/api/auth/check`);
    if (!checkRes.ok) {
        throw new Error(
            `Auth check failed: HTTP ${checkRes.status} — is the backend running at ${baseURL}?`
        );
    }
    const { setupRequired } = (await checkRes.json()) as {
        authenticated: boolean;
        setupRequired: boolean;
    };

    if (setupRequired) {
        const setupRes = await fetch(`${baseURL}/api/auth/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: TEST_PASSWORD })
        });
        if (!setupRes.ok) {
            throw new Error(`Initial user setup failed: HTTP ${setupRes.status}`);
        }
    }

    // Log in via the API and save the resulting session cookie to storage state.
    // Using the API request context (not a browser) avoids any UI rendering/stability
    // issues that can occur in headless Chromium in WSL2/container environments.
    await mkdir('e2e/.auth', { recursive: true });

    const apiContext = await request.newContext({ baseURL });
    const loginRes = await apiContext.post('/api/auth/login', {
        data: { password: TEST_PASSWORD }
    });
    if (!loginRes.ok()) {
        throw new Error(`Login failed: HTTP ${loginRes.status()} ${await loginRes.text()}`);
    }

    await apiContext.storageState({ path: STORAGE_STATE });
    await apiContext.dispose();
}
