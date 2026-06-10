/** Convert base64url string → ArrayBuffer */
export function b64ToBuffer(b64url: string): ArrayBuffer {
    const padding = '='.repeat((4 - (b64url.length % 4)) % 4);
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + padding;
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}

/** Convert ArrayBuffer → base64url string */
export function bufToB64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Decode base64url challenge + allowCredentials ids from server options */
export function prepareGetOptions(opts: PublicKeyCredentialRequestOptions): PublicKeyCredentialRequestOptions {
    return {
        ...opts,
        challenge: b64ToBuffer(opts.challenge as unknown as string),
        allowCredentials: (opts.allowCredentials ?? []).map((c) => ({
            ...c,
            id: b64ToBuffer(c.id as unknown as string)
        }))
    };
}

/** Decode base64url challenge + user.id + excludeCredentials ids from server options */
export function prepareCreateOptions(opts: PublicKeyCredentialCreationOptions): PublicKeyCredentialCreationOptions {
    return {
        ...opts,
        challenge: b64ToBuffer(opts.challenge as unknown as string),
        user: {
            ...opts.user,
            id: b64ToBuffer(opts.user.id as unknown as string)
        },
        excludeCredentials: (opts.excludeCredentials ?? []).map((c) => ({
            ...c,
            id: b64ToBuffer(c.id as unknown as string)
        }))
    };
}

/** Serialize a PublicKeyCredential from navigator.credentials.get() for the server */
export function serializeGetCredential(cred: PublicKeyCredential): Record<string, unknown> {
    const resp = cred.response as AuthenticatorAssertionResponse;
    return {
        id: cred.id,
        rawId: bufToB64(cred.rawId),
        type: cred.type,
        response: {
            clientDataJSON: bufToB64(resp.clientDataJSON),
            authenticatorData: bufToB64(resp.authenticatorData),
            signature: bufToB64(resp.signature),
            userHandle: resp.userHandle ? bufToB64(resp.userHandle) : null
        }
    };
}

/** Serialize a PublicKeyCredential from navigator.credentials.create() for the server */
export function serializeCreateCredential(cred: PublicKeyCredential): Record<string, unknown> {
    const resp = cred.response as AuthenticatorAttestationResponse;
    const out: Record<string, unknown> = {
        id: cred.id,
        rawId: bufToB64(cred.rawId),
        type: cred.type,
        response: {
            clientDataJSON: bufToB64(resp.clientDataJSON),
            attestationObject: bufToB64(resp.attestationObject)
        }
    };
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transports = (resp as any).getTransports?.();
        if (transports) (out.response as Record<string, unknown>).transports = transports;
    } catch { /* optional */ }
    return out;
}

export function isWebAuthnSupported(): boolean {
    return (
        typeof window !== 'undefined' &&
        window.isSecureContext &&
        typeof window.PublicKeyCredential === 'function'
    );
}
