import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('WebAuthnManager', () => {
    let WebAuthnManager;
    let manager;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Mock browser APIs
        global.window = {
            isSecureContext: true,
            PublicKeyCredential: function () {},
        };
        window.PublicKeyCredential.isConditionalMediationAvailable = vi.fn(() =>
            Promise.resolve(true)
        );
        window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(() =>
            Promise.resolve(true)
        );

        // Make PublicKeyCredential available as a global (not just window.PublicKeyCredential)
        global.PublicKeyCredential = window.PublicKeyCredential;

        // Mock navigator
        global.navigator = {
            credentials: {
                create: vi.fn(),
                get: vi.fn(),
            },
        };

        // Mock console
        console.debug = vi.fn();
        console.error = vi.fn();

        // Mock fetch
        global.fetch = vi.fn();

        // Mock atob/btoa
        global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
        global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');

        // Load WebAuthnManager
        WebAuthnManager = await loadModuleForTesting('webauthn', 'WebAuthnManager');
    });

    describe('constructor and initialization', () => {
        it('should initialize with correct default values', async () => {
            manager = new WebAuthnManager();
            // Wait for async checkConditionalUISupport to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(manager.isSecureContext).toBe(true);
            expect(manager.supported).toBe(true);
            expect(manager.available).toBe(false);
        });

        it('should detect insecure context', () => {
            window.isSecureContext = false;
            manager = new WebAuthnManager();

            expect(manager.isSecureContext).toBe(false);
            expect(manager.supported).toBe(false);
        });

        it('should detect missing PublicKeyCredential support', () => {
            delete window.PublicKeyCredential;
            delete global.PublicKeyCredential;
            manager = new WebAuthnManager();

            expect(manager.supported).toBe(false);
        });

        it('should check conditional UI support', async () => {
            manager = new WebAuthnManager();
            // Wait for async checkConditionalUISupport to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(manager.conditionalUISupported).toBe(true);
        });

        it('should handle conditional UI check failure', async () => {
            window.PublicKeyCredential.isConditionalMediationAvailable = vi.fn(() =>
                Promise.reject(new Error('Test error'))
            );
            manager = new WebAuthnManager();
            // Wait for async checkConditionalUISupport to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(manager.conditionalUISupported).toBe(false);
        });
    });

    describe('isWebAuthnSupported()', () => {
        it('should return true when all requirements met', () => {
            manager = new WebAuthnManager();
            expect(manager.isWebAuthnSupported()).toBe(true);
        });

        it('should return false in insecure context', () => {
            window.isSecureContext = false;
            manager = new WebAuthnManager();
            expect(manager.isWebAuthnSupported()).toBe(false);
        });

        it('should return false without PublicKeyCredential', () => {
            delete window.PublicKeyCredential;
            delete global.PublicKeyCredential;
            manager = new WebAuthnManager();
            expect(manager.isWebAuthnSupported()).toBe(false);
        });
    });

    describe('checkAvailability()', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        it('should return false if not supported', async () => {
            manager.supported = false;
            const result = await manager.checkAvailability();
            expect(result).toBe(false);
        });

        it('should check with server and update available flag', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ available: true }),
            });

            const result = await manager.checkAvailability();

            expect(result).toBe(true);
            expect(manager.available).toBe(true);
            expect(fetch).toHaveBeenCalledWith('/api/auth/webauthn/available');
        });

        it('should return false on server error', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
            });

            const result = await manager.checkAvailability();

            expect(result).toBe(false);
        });

        it('should handle fetch errors', async () => {
            global.fetch.mockRejectedValue(new Error('Network error'));

            const result = await manager.checkAvailability();

            expect(result).toBe(false);
            expect(console.error).toHaveBeenCalled();
        });
    });

    describe('isPlatformAuthenticatorAvailable()', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            // Wait for async initialization to complete
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        it('should return false if not supported', async () => {
            manager.supported = false;
            const result = await manager.isPlatformAuthenticatorAvailable();
            expect(result).toBe(false);
        });

        it('should check platform authenticator availability', async () => {
            const result = await manager.isPlatformAuthenticatorAvailable();

            expect(result).toBe(true);
            expect(
                window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
            ).toHaveBeenCalled();
        });

        it('should handle errors gracefully', async () => {
            window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(() =>
                Promise.reject(new Error('Test error'))
            );

            const result = await manager.isPlatformAuthenticatorAvailable();

            expect(result).toBe(false);
        });
    });

    describe('abortConditionalUI()', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        it('should abort existing controller', () => {
            const mockController = {
                abort: vi.fn(),
            };
            manager.conditionalUIAbortController = mockController;

            manager.abortConditionalUI();

            expect(mockController.abort).toHaveBeenCalled();
            expect(manager.conditionalUIAbortController).toBeNull();
        });

        it('should handle no controller gracefully', () => {
            manager.conditionalUIAbortController = null;
            expect(() => manager.abortConditionalUI()).not.toThrow();
        });
    });

    describe('base64url encoding/decoding', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        describe('base64urlToBuffer()', () => {
            it('should convert base64url to ArrayBuffer', () => {
                const base64url = 'SGVsbG8gV29ybGQ';
                const buffer = manager.base64urlToBuffer(base64url);

                const decoder = new TextDecoder();
                const text = decoder.decode(buffer);

                expect(text).toBe('Hello World');
            });

            it('should handle URL-safe characters', () => {
                const base64url = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo-Pz8_Pw';
                const buffer = manager.base64urlToBuffer(base64url);

                expect(buffer).toBeInstanceOf(ArrayBuffer);
                expect(buffer.byteLength).toBeGreaterThan(0);
            });

            it('should handle empty string', () => {
                const buffer = manager.base64urlToBuffer('');
                expect(buffer.byteLength).toBe(0);
            });

            it('should handle null/undefined', () => {
                const buffer1 = manager.base64urlToBuffer(null);
                const buffer2 = manager.base64urlToBuffer(undefined);

                expect(buffer1.byteLength).toBe(0);
                expect(buffer2.byteLength).toBe(0);
            });
        });

        describe('bufferToBase64url()', () => {
            it('should convert ArrayBuffer to base64url', () => {
                const text = 'Hello World';
                const encoder = new TextEncoder();
                const buffer = encoder.encode(text).buffer;

                const base64url = manager.bufferToBase64url(buffer);

                expect(base64url).toBe('SGVsbG8gV29ybGQ');
            });

            it('should remove padding', () => {
                const encoder = new TextEncoder();
                const buffer = encoder.encode('a').buffer;

                const base64url = manager.bufferToBase64url(buffer);

                expect(base64url).not.toContain('=');
            });

            it('should use URL-safe characters', () => {
                const encoder = new TextEncoder();
                const buffer = encoder.encode('test+test/test=').buffer;

                const base64url = manager.bufferToBase64url(buffer);

                expect(base64url).not.toContain('+');
                expect(base64url).not.toContain('/');
                expect(base64url).not.toContain('=');
            });

            it('should handle empty buffer', () => {
                const buffer = new ArrayBuffer(0);
                const result = manager.bufferToBase64url(buffer);

                expect(result).toBe('');
            });

            it('should handle null/undefined', () => {
                const result1 = manager.bufferToBase64url(null);
                const result2 = manager.bufferToBase64url(undefined);

                expect(result1).toBe('');
                expect(result2).toBe('');
            });

            it('should roundtrip correctly', () => {
                const original = 'The quick brown fox jumps over the lazy dog';
                const encoder = new TextEncoder();
                const buffer = encoder.encode(original).buffer;

                const base64url = manager.bufferToBase64url(buffer);
                const decoded = manager.base64urlToBuffer(base64url);
                const decoder = new TextDecoder();
                const result = decoder.decode(decoded);

                expect(result).toBe(original);
            });
        });
    });

    describe('preparePublicKeyOptions()', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        it('should convert challenge and user.id to buffers', () => {
            const options = {
                challenge: 'Y2hhbGxlbmdl',
                user: {
                    id: 'dXNlcklk',
                    name: 'user@example.com',
                    displayName: 'User',
                },
                rp: { name: 'Test' },
                pubKeyCredParams: [],
            };

            const result = manager.preparePublicKeyOptions(options);

            expect(result.challenge).toBeInstanceOf(ArrayBuffer);
            expect(result.user.id).toBeInstanceOf(ArrayBuffer);
            expect(result.user.name).toBe('user@example.com');
            expect(result.rp).toEqual({ name: 'Test' });
        });

        it('should convert excludeCredentials if present', () => {
            const options = {
                challenge: 'Y2hhbGxlbmdl',
                user: {
                    id: 'dXNlcklk',
                    name: 'user@example.com',
                },
                excludeCredentials: [
                    {
                        id: 'Y3JlZElk',
                        type: 'public-key',
                    },
                ],
            };

            const result = manager.preparePublicKeyOptions(options);

            expect(result.excludeCredentials).toHaveLength(1);
            expect(result.excludeCredentials[0].id).toBeInstanceOf(ArrayBuffer);
            expect(result.excludeCredentials[0].type).toBe('public-key');
        });

        it('should handle empty excludeCredentials', () => {
            const options = {
                challenge: 'Y2hhbGxlbmdl',
                user: {
                    id: 'dXNlcklk',
                    name: 'user@example.com',
                },
                excludeCredentials: [],
            };

            const result = manager.preparePublicKeyOptions(options);

            expect(result.excludeCredentials).toHaveLength(0);
        });
    });

    describe('prepareGetOptions()', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        it('should convert challenge to buffer', () => {
            const options = {
                challenge: 'Y2hhbGxlbmdl',
                rpId: 'example.com',
                timeout: 60000,
            };

            const result = manager.prepareGetOptions(options);

            expect(result.challenge).toBeInstanceOf(ArrayBuffer);
            expect(result.rpId).toBe('example.com');
            expect(result.timeout).toBe(60000);
        });

        it('should convert allowCredentials if present', () => {
            const options = {
                challenge: 'Y2hhbGxlbmdl',
                allowCredentials: [
                    {
                        id: 'Y3JlZElk',
                        type: 'public-key',
                        transports: ['usb', 'nfc'],
                    },
                ],
            };

            const result = manager.prepareGetOptions(options);

            expect(result.allowCredentials).toHaveLength(1);
            expect(result.allowCredentials[0].id).toBeInstanceOf(ArrayBuffer);
            expect(result.allowCredentials[0].type).toBe('public-key');
            expect(result.allowCredentials[0].transports).toEqual(['usb', 'nfc']);
        });

        it('should handle empty allowCredentials', () => {
            const options = {
                challenge: 'Y2hhbGxlbmdl',
                allowCredentials: [],
            };

            const result = manager.prepareGetOptions(options);

            expect(result.allowCredentials).toHaveLength(0);
        });
    });

    describe('serializeCreationCredential()', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        it('should serialize creation credential', () => {
            const mockCredential = {
                id: 'credential-id',
                rawId: new Uint8Array([1, 2, 3, 4]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
                    attestationObject: new Uint8Array([9, 10, 11, 12]).buffer,
                },
            };

            const result = manager.serializeCreationCredential(mockCredential);

            expect(result.id).toBe('credential-id');
            expect(result.type).toBe('public-key');
            expect(typeof result.rawId).toBe('string');
            expect(typeof result.response.clientDataJSON).toBe('string');
            expect(typeof result.response.attestationObject).toBe('string');
        });

        it('should include transports if available', () => {
            const mockCredential = {
                id: 'credential-id',
                rawId: new Uint8Array([1, 2, 3, 4]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
                    attestationObject: new Uint8Array([9, 10, 11, 12]).buffer,
                    getTransports: () => ['usb', 'nfc'],
                },
            };

            const result = manager.serializeCreationCredential(mockCredential);

            expect(result.response.transports).toEqual(['usb', 'nfc']);
        });

        it('should include authenticatorAttachment if available', () => {
            const mockCredential = {
                id: 'credential-id',
                rawId: new Uint8Array([1, 2, 3, 4]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
                    attestationObject: new Uint8Array([9, 10, 11, 12]).buffer,
                },
                authenticatorAttachment: 'platform',
            };

            const result = manager.serializeCreationCredential(mockCredential);

            expect(result.authenticatorAttachment).toBe('platform');
        });

        it('should handle getTransports errors gracefully', () => {
            const mockCredential = {
                id: 'credential-id',
                rawId: new Uint8Array([1, 2, 3, 4]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
                    attestationObject: new Uint8Array([9, 10, 11, 12]).buffer,
                    getTransports: () => {
                        throw new Error('Not supported');
                    },
                },
            };

            const result = manager.serializeCreationCredential(mockCredential);

            expect(result.response.transports).toBeUndefined();
        });
    });

    describe('serializeGetCredential()', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        it('should serialize get credential', () => {
            const mockCredential = {
                id: 'credential-id',
                rawId: new Uint8Array([1, 2, 3, 4]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
                    authenticatorData: new Uint8Array([9, 10, 11, 12]).buffer,
                    signature: new Uint8Array([13, 14, 15, 16]).buffer,
                },
            };

            const result = manager.serializeGetCredential(mockCredential);

            expect(result.id).toBe('credential-id');
            expect(result.type).toBe('public-key');
            expect(typeof result.rawId).toBe('string');
            expect(typeof result.response.clientDataJSON).toBe('string');
            expect(typeof result.response.authenticatorData).toBe('string');
            expect(typeof result.response.signature).toBe('string');
        });

        it('should include userHandle if present', () => {
            const mockCredential = {
                id: 'credential-id',
                rawId: new Uint8Array([1, 2, 3, 4]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
                    authenticatorData: new Uint8Array([9, 10, 11, 12]).buffer,
                    signature: new Uint8Array([13, 14, 15, 16]).buffer,
                    userHandle: new Uint8Array([17, 18, 19, 20]).buffer,
                },
            };

            const result = manager.serializeGetCredential(mockCredential);

            expect(typeof result.response.userHandle).toBe('string');
        });

        it('should handle missing userHandle', () => {
            const mockCredential = {
                id: 'credential-id',
                rawId: new Uint8Array([1, 2, 3, 4]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
                    authenticatorData: new Uint8Array([9, 10, 11, 12]).buffer,
                    signature: new Uint8Array([13, 14, 15, 16]).buffer,
                },
            };

            const result = manager.serializeGetCredential(mockCredential);

            expect(result.response.userHandle).toBeUndefined();
        });
    });

    describe('listPasskeys()', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        it('should fetch and return passkeys list', async () => {
            const mockPasskeys = [
                { id: '1', name: 'My Phone', createdAt: '2024-01-01' },
                { id: '2', name: 'My Computer', createdAt: '2024-01-02' },
            ];

            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ passkeys: mockPasskeys }),
            });

            const result = await manager.listPasskeys();

            expect(result).toEqual(mockPasskeys);
            expect(fetch).toHaveBeenCalledWith('/api/auth/webauthn/passkeys');
        });

        it('should return empty array if no passkeys field', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({}),
            });

            const result = await manager.listPasskeys();

            expect(result).toEqual([]);
        });

        it('should throw on server error', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
            });

            await expect(manager.listPasskeys()).rejects.toThrow('Failed to list passkeys');
        });
    });

    describe('deletePasskey()', () => {
        beforeEach(async () => {
            manager = new WebAuthnManager();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        it('should delete passkey', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            });

            const result = await manager.deletePasskey('123');

            expect(result).toEqual({ success: true });
            expect(fetch).toHaveBeenCalledWith('/api/auth/webauthn/passkeys', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: '123' }),
            });
        });

        it('should throw on server error', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                text: () => Promise.resolve('Not found'),
            });

            await expect(manager.deletePasskey('123')).rejects.toThrow('Not found');
        });
    });
});
