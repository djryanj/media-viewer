import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { auth } from '$lib/api/client';

// Helpers to build a minimal fetch mock that returns a JSON body.
function mockFetchOk(body: unknown) {
    return vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    );
}

describe('auth.listPasskeys', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns the passkeys array unwrapped from the {passkeys:[…]} envelope', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetchOk({
                passkeys: [
                    { id: 1, name: 'MacBook', createdAt: '2024-01-01T00:00:00Z' },
                    { id: 2, name: 'iPhone', createdAt: '2024-02-01T00:00:00Z' }
                ]
            })
        );

        const result = await auth.listPasskeys();

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe('MacBook');
        expect(result[1].name).toBe('iPhone');
    });

    it('returns an empty array when the server has no passkeys', async () => {
        vi.stubGlobal('fetch', mockFetchOk({ passkeys: [] }));

        const result = await auth.listPasskeys();

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(0);
    });

    it('calls /api/auth/webauthn/passkeys with GET', async () => {
        const fetchMock = mockFetchOk({ passkeys: [] });
        vi.stubGlobal('fetch', fetchMock);

        await auth.listPasskeys();

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/auth/webauthn/passkeys');
        expect((init as RequestInit).method).toBeUndefined(); // default GET
    });
});
