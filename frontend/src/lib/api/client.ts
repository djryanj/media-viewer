/**
 * Typed API client for the Media Viewer Go backend.
 * All methods throw ApiError on non-2xx responses.
 */

import type {
    BuildInfo,
    Collection,
    CollectionDetail,
    DirectoryListing,
    DirectorySummary,
    MediaFile,
    Playlist,
    SearchResult,
    SearchSuggestion,
    Tag,
    RelatedTagSuggestion,
    IndexStats,
    FavoriteRequest,
    BulkFavoriteItem,
    TagRequest,
    BulkTagRequest,
    SystemStatus
} from './types';

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        message: string
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        credentials: 'same-origin',
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...init?.headers
        }
    });
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        if (res.status === 401) {
            // Redirect to login on session expiry, unless we're already there
            if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
                window.location.href = '/login';
            }
        }
        throw new ApiError(res.status, text);
    }
    // 204 No Content
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

/** Serialise a WebAuthn credential for JSON transport (ArrayBuffers → base64url). */
function bufToBase64(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function serializeCredential(cred: PublicKeyCredential): Record<string, unknown> {
    const resp = cred.response;
    const out: Record<string, unknown> = {
        id: cred.id,
        rawId: bufToBase64(cred.rawId),
        type: cred.type
    };
    if (resp instanceof AuthenticatorAttestationResponse) {
        out.response = {
            attestationObject: bufToBase64(resp.attestationObject),
            clientDataJSON: bufToBase64(resp.clientDataJSON)
        };
    } else if (resp instanceof AuthenticatorAssertionResponse) {
        out.response = {
            authenticatorData: bufToBase64(resp.authenticatorData),
            clientDataJSON: bufToBase64(resp.clientDataJSON),
            signature: bufToBase64(resp.signature),
            userHandle: resp.userHandle ? bufToBase64(resp.userHandle) : null
        };
    }
    return out;
}

function json(body: unknown): RequestInit {
    return { body: JSON.stringify(body) };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
    login: (password: string) =>
        request<{ success: boolean }>('/api/auth/login', {
            method: 'POST',
            ...json({ password })
        }),
    logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
    // /api/auth/check always returns HTTP 200; auth state is in the JSON body
    status: () =>
        fetch('/api/auth/check', { credentials: 'same-origin' })
            .then(
                (res) => res.json() as Promise<{ authenticated: boolean; setupRequired: boolean }>
            )
            .then((body) => ({
                authenticated: body.authenticated,
                setupRequired: body.setupRequired,
                username: '' // CheckAuth doesn't return a username field
            })),
    setup: (password: string) =>
        request<{ success: boolean }>('/api/auth/setup', {
            method: 'POST',
            ...json({ password })
        }),
    changePassword: (currentPassword: string, newPassword: string) =>
        request<{ success: boolean; message: string }>('/api/auth/password', {
            method: 'PUT',
            ...json({ currentPassword, newPassword })
        }),

    keepalive: () => request<void>('/api/auth/keepalive', { method: 'PUT' }),

    // WebAuthn
    webauthnAvailable: () => request<{ available: boolean }>('/api/auth/webauthn/available'),
    webauthnRegisterBegin: () =>
        request<{ options: { publicKey: PublicKeyCredentialCreationOptions }; sessionId: string }>(
            '/api/auth/webauthn/register/begin',
            { method: 'POST' }
        ),
    webauthnRegisterFinish: (sessionId: string, credential: PublicKeyCredential) =>
        request<{ success: boolean }>('/api/auth/webauthn/register/finish', {
            method: 'POST',
            ...json({ sessionId, credential: serializeCredential(credential) })
        }),
    webauthnLoginBegin: () =>
        request<{ options: { publicKey: PublicKeyCredentialRequestOptions }; sessionId: string }>(
            '/api/auth/webauthn/login/begin',
            { method: 'POST' }
        ),
    webauthnLoginFinish: (sessionId: string, credential: PublicKeyCredential) =>
        request<{ success: boolean }>('/api/auth/webauthn/login/finish', {
            method: 'POST',
            ...json({ sessionId, credential: serializeCredential(credential) })
        }),
    listPasskeys: () =>
        request<{
            passkeys: Array<{ id: number; name: string; createdAt: string; lastUsedAt?: string }>;
        }>('/api/auth/webauthn/passkeys').then((r) => r.passkeys),
    deletePasskey: (id: number) =>
        request<void>('/api/auth/webauthn/passkeys', { method: 'DELETE', ...json({ id }) }),
    renamePasskey: (id: number, name: string) =>
        request<void>('/api/auth/webauthn/passkeys/rename', {
            method: 'PATCH',
            ...json({ id, name })
        })
};

// ─── Media / Directory ───────────────────────────────────────────────────────

export const media = {
    // list() calls /api/files which returns the full DirectoryListing including
    // folders (sorted first by the DB) and a root-level favorites strip.
    // Uses offset-based pagination so the scrubber can jump to any position.
    list: (path = '', offset = 0, pageSize = 500, sort = 'name', order = 'asc', type = '') => {
        const params = new URLSearchParams({
            path,
            offset: String(offset),
            pageSize: String(pageSize),
            sort,
            order
        });
        if (type && type !== 'all') params.set('type', type);
        return request<DirectoryListing>(`/api/files?${params}`);
    },

    summary: (path = '', sort = 'name', order = 'asc') =>
        request<DirectorySummary>(
            `/api/files/summary?path=${encodeURIComponent(path)}&sort=${sort}&order=${order}`
        ),

    get: (path: string) => request<MediaFile>(`/api/media/file?path=${encodeURIComponent(path)}`),

    search: (q: string, page = 1, pageSize = 50, sort = 'name', order = 'asc') =>
        request<SearchResult>(
            `/api/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}&sort=${sort}&order=${order}`
        ),

    suggest: (q: string) =>
        request<SearchSuggestion[]>(`/api/search/suggestions?q=${encodeURIComponent(q)}`),

    stats: () => request<IndexStats>('/api/stats')
};

// ─── Favorites ───────────────────────────────────────────────────────────────

export const favorites = {
    list: () => request<MediaFile[]>('/api/favorites'),

    add: (item: FavoriteRequest) =>
        request<void>('/api/favorites', { method: 'POST', ...json(item) }),

    remove: (path: string) =>
        request<void>('/api/favorites', { method: 'DELETE', ...json({ path }) }),

    bulkAdd: (items: BulkFavoriteItem[]) =>
        request<{ success: number; failed: number }>('/api/favorites/bulk', {
            method: 'POST',
            ...json({ items })
        }),

    bulkRemove: (paths: string[]) =>
        request<{ success: number; failed: number }>('/api/favorites/bulk', {
            method: 'DELETE',
            ...json({ paths })
        }),

    order: (paths: string[]) =>
        request<void>('/api/favorites/order', { method: 'PUT', ...json({ paths }) })
};

// ─── Tags ────────────────────────────────────────────────────────────────────

export const tags = {
    list: () => request<Tag[]>('/api/tags'),

    getForFile: (path: string) =>
        request<string[]>(`/api/tags/file?path=${encodeURIComponent(path)}`),

    getBatch: (paths: string[]) =>
        request<Record<string, string[]>>('/api/tags/batch', {
            method: 'POST',
            ...json({ paths })
        }),

    add: (req: TagRequest) => request<void>('/api/tags/file', { method: 'POST', ...json(req) }),

    remove: (req: TagRequest) =>
        request<void>('/api/tags/file', { method: 'DELETE', ...json(req) }),

    setForFile: (path: string, tagList: string[]) =>
        request<void>('/api/tags/file', { method: 'PUT', ...json({ path, tags: tagList }) }),

    bulkAdd: (req: BulkTagRequest) =>
        request<{ success: number; failed: number }>('/api/tags/bulk', {
            method: 'POST',
            ...json(req)
        }),

    bulkRemove: (req: BulkTagRequest) =>
        request<{ success: number; failed: number }>('/api/tags/bulk', {
            method: 'DELETE',
            ...json(req)
        }),

    rename: (oldName: string, newName: string) =>
        request<void>('/api/tags/rename', { method: 'PUT', ...json({ tag: oldName, newName }) }),

    delete: (name: string) =>
        request<void>(`/api/tags/${encodeURIComponent(name)}`, { method: 'DELETE' }),

    related: (currentTags: string[], exclude?: string[], limit = 10) =>
        request<RelatedTagSuggestion[]>('/api/tags/suggestions', {
            method: 'POST',
            ...json({ tags: currentTags, exclude, limit })
        })
};

// ─── Collections ─────────────────────────────────────────────────────────────

export const collections = {
    list: () => request<Collection[]>('/api/collections'),

    get: (id: number) => request<CollectionDetail>(`/api/collections/${id}`),

    create: (name: string, paths?: string[], coverPath?: string, folderPath?: string) =>
        request<Collection>('/api/collections', {
            method: 'POST',
            ...json({ name, paths, coverPath, folderPath })
        }),

    rename: (id: number, name: string) =>
        request<Collection>(`/api/collections/${id}`, {
            method: 'PUT',
            ...json({ name })
        }),

    delete: (id: number) => request<void>(`/api/collections/${id}`, { method: 'DELETE' }),

    addItems: (id: number, paths: string[]) =>
        request<void>(`/api/collections/${id}/items`, {
            method: 'POST',
            ...json({ paths })
        }),

    removeItems: (id: number, paths: string[]) =>
        request<void>(`/api/collections/${id}/items`, {
            method: 'DELETE',
            ...json({ paths })
        }),

    memberships: (paths: string[]) =>
        request<Record<string, number[]>>('/api/collections/memberships', {
            method: 'POST',
            ...json({ paths })
        }),

    reorder: (id: number, paths: string[]) =>
        request<void>(`/api/collections/${id}/order`, { method: 'PUT', ...json({ paths }) })
};

// ─── Playlists ───────────────────────────────────────────────────────────────

export const playlists = {
    list: () => request<MediaFile[]>('/api/playlists'),
    get: (name: string) => request<Playlist>(`/api/playlists/${encodeURIComponent(name)}`)
};

// ─── Version ────────────────────────────────────────────────────────────────

export const version = {
    get: () => request<BuildInfo>('/version')
};

// ─── System / Admin ──────────────────────────────────────────────────────────

export const system = {
    status: () => request<SystemStatus>('/api/system/status'),
    reindex: () => request<void>('/api/reindex', { method: 'POST' }),
    rebuildThumbnails: () => request<void>('/api/thumbnails/rebuild', { method: 'POST' }),
    clearTranscodeCache: () => request<void>('/api/transcode/clear', { method: 'POST' }),
    runAutoTagger: () => request<void>('/api/autotagger/run', { method: 'POST' })
};
