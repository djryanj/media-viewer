/* global loadModuleForTesting */
/**
 * Integration tests for WebAuthnManager
 * Tests complete passkey registration and authentication workflows
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('WebAuthnManager Integration Tests', () => {
    let manager;
    let mockFetch;
    let mockCredentialsCreate;
    let mockCredentialsGet;
    let WebAuthnManager;

    // Helper to create new manager instance
    const createManager = () => new WebAuthnManager();

    beforeEach(async () => {
        // Reset modules to ensure fresh imports
        vi.resetModules();

        // Mock PublicKeyCredential
        const MockPublicKeyCredential = function () {};
        MockPublicKeyCredential.isConditionalMediationAvailable = vi.fn(() =>
            Promise.resolve(true)
        );
        MockPublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(() =>
            Promise.resolve(true)
        );

        global.window = {
            isSecureContext: true,
            PublicKeyCredential: MockPublicKeyCredential,
        };
        global.PublicKeyCredential = MockPublicKeyCredential;

        // Mock navigator.credentials
        mockCredentialsCreate = vi.fn();
        mockCredentialsGet = vi.fn();
        global.navigator = {
            credentials: {
                create: mockCredentialsCreate,
                get: mockCredentialsGet,
            },
        };

        // Mock fetch
        mockFetch = vi.fn();
        global.fetch = mockFetch;

        // Mock atob/btoa for base64url encoding
        global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
        global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');

        // Mock console
        console.debug = vi.fn();
        console.error = vi.fn();

        // Load module and capture the WebAuthnManager class
        WebAuthnManager = await loadModuleForTesting('webauthn', 'WebAuthnManager');

        // Wait for conditional UI check to complete
        await new Promise((resolve) => setTimeout(resolve, 50));
    });

    describe('Complete Registration Workflow', () => {
        it('should complete full passkey registration flow', async () => {
            manager = createManager();

            // Mock server responses
            const mockChallenge = 'test-challenge';
            const mockUserId = 'user-123';
            const mockSessionId = 'session-456';

            // Step 1: Begin registration
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: mockSessionId,
                    options: {
                        publicKey: {
                            challenge: mockChallenge,
                            rp: { name: 'Test RP', id: 'localhost' },
                            user: {
                                id: mockUserId,
                                name: 'testuser',
                                displayName: 'Test User',
                            },
                            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
                            timeout: 60000,
                            attestation: 'none',
                            authenticatorSelection: {
                                userVerification: 'preferred',
                            },
                        },
                    },
                }),
            });

            // Step 2: Browser creates credential
            const mockCredential = {
                id: 'cred-id-123',
                rawId: new ArrayBuffer(16),
                type: 'public-key',
                response: {
                    clientDataJSON: new ArrayBuffer(32),
                    attestationObject: new ArrayBuffer(64),
                    getTransports: () => ['internal'],
                },
                authenticatorAttachment: 'platform',
            };
            mockCredentialsCreate.mockResolvedValueOnce(mockCredential);

            // Step 3: Server verifies registration
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    credentialId: 'cred-id-123',
                }),
            });

            // Execute registration
            const result = await manager.registerPasskey('My Phone');

            // Verify the flow
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch).toHaveBeenNthCalledWith(
                1,
                '/api/auth/webauthn/register/begin',
                expect.objectContaining({ method: 'POST' })
            );

            expect(mockCredentialsCreate).toHaveBeenCalledWith({
                publicKey: expect.objectContaining({
                    challenge: expect.any(ArrayBuffer),
                    user: expect.objectContaining({
                        id: expect.any(ArrayBuffer),
                    }),
                }),
            });

            expect(mockFetch).toHaveBeenNthCalledWith(
                2,
                '/api/auth/webauthn/register/finish',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('My Phone'),
                })
            );

            expect(result).toEqual({ success: true, credentialId: 'cred-id-123' });
        });

        it('should handle registration cancellation', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge',
                            rp: { name: 'Test' },
                            user: { id: 'user-123', name: 'test', displayName: 'Test' },
                            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
                        },
                    },
                }),
            });

            const cancelError = new Error('User cancelled');
            cancelError.name = 'NotAllowedError';
            mockCredentialsCreate.mockRejectedValueOnce(cancelError);

            await expect(manager.registerPasskey()).rejects.toThrow(
                'Registration was cancelled or timed out'
            );
        });

        it('should handle already registered authenticator', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge',
                            rp: { name: 'Test' },
                            user: { id: 'user-123', name: 'test', displayName: 'Test' },
                            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
                        },
                    },
                }),
            });

            const duplicateError = new Error('Already registered');
            duplicateError.name = 'InvalidStateError';
            mockCredentialsCreate.mockRejectedValueOnce(duplicateError);

            await expect(manager.registerPasskey()).rejects.toThrow(
                'This authenticator is already registered'
            );
        });

        it('should handle server verification failure', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge',
                            rp: { name: 'Test' },
                            user: { id: 'user-123', name: 'test', displayName: 'Test' },
                            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
                        },
                    },
                }),
            });

            mockCredentialsCreate.mockResolvedValueOnce({
                id: 'cred-id',
                rawId: new ArrayBuffer(16),
                type: 'public-key',
                response: {
                    clientDataJSON: new ArrayBuffer(32),
                    attestationObject: new ArrayBuffer(64),
                },
            });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                text: async () => 'Verification failed',
            });

            await expect(manager.registerPasskey()).rejects.toThrow('Verification failed');
        });

        it('should reject in insecure context', async () => {
            // Create manager with insecure context - this makes supported = false
            global.window.isSecureContext = false;
            const insecureManager = new WebAuthnManager();

            // Expect "not supported" error since isSecureContext=false makes supported=false
            await expect(insecureManager.registerPasskey()).rejects.toThrow(
                'WebAuthn is not supported in this browser'
            );
        });
    });

    describe('Modal Login Workflow', () => {
        it('should complete full modal login flow', async () => {
            manager = createManager();

            const mockSessionId = 'session-789';
            const mockChallenge = 'login-challenge';

            // Step 1: Begin login
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: mockSessionId,
                    options: {
                        publicKey: {
                            challenge: mockChallenge,
                            timeout: 60000,
                            rpId: 'localhost',
                            allowCredentials: [
                                {
                                    id: 'cred-id-base64',
                                    type: 'public-key',
                                    transports: ['internal'],
                                },
                            ],
                            userVerification: 'preferred',
                        },
                    },
                }),
            });

            // Step 2: Browser gets credential
            const mockCredential = {
                id: 'cred-id-123',
                rawId: new ArrayBuffer(16),
                type: 'public-key',
                response: {
                    clientDataJSON: new ArrayBuffer(32),
                    authenticatorData: new ArrayBuffer(37),
                    signature: new ArrayBuffer(64),
                    userHandle: new ArrayBuffer(16),
                },
            };
            mockCredentialsGet.mockResolvedValueOnce(mockCredential);

            // Step 3: Server verifies authentication
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    username: 'testuser',
                }),
            });

            // Execute login
            const result = await manager.login();

            // Verify the flow
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch).toHaveBeenNthCalledWith(
                1,
                '/api/auth/webauthn/login/begin',
                expect.objectContaining({ method: 'POST' })
            );

            expect(mockCredentialsGet).toHaveBeenCalledWith({
                publicKey: expect.objectContaining({
                    challenge: expect.any(ArrayBuffer),
                    allowCredentials: expect.arrayContaining([
                        expect.objectContaining({
                            id: expect.any(ArrayBuffer),
                        }),
                    ]),
                }),
            });

            expect(mockFetch).toHaveBeenNthCalledWith(
                2,
                '/api/auth/webauthn/login/finish',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining(mockSessionId),
                })
            );

            expect(result).toEqual({ success: true, username: 'testuser' });
        });

        it('should handle no passkeys registered', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                text: async () => 'No passkeys found',
            });

            await expect(manager.login()).rejects.toThrow('No passkeys registered');
        });

        it('should handle authentication cancellation', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge',
                            allowCredentials: [],
                        },
                    },
                }),
            });

            const cancelError = new Error('User cancelled');
            cancelError.name = 'NotAllowedError';
            mockCredentialsGet.mockRejectedValueOnce(cancelError);

            await expect(manager.login()).rejects.toThrow(
                'Authentication was cancelled or timed out'
            );
        });

        it('should handle authentication verification failure', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge',
                            allowCredentials: [],
                        },
                    },
                }),
            });

            mockCredentialsGet.mockResolvedValueOnce({
                id: 'cred-id',
                rawId: new ArrayBuffer(16),
                type: 'public-key',
                response: {
                    clientDataJSON: new ArrayBuffer(32),
                    authenticatorData: new ArrayBuffer(37),
                    signature: new ArrayBuffer(64),
                },
            });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                text: async () => 'Invalid signature',
            });

            await expect(manager.login()).rejects.toThrow('Invalid signature');
        });
    });

    describe('Conditional UI Login Workflow', () => {
        it('should complete full conditional UI flow', async () => {
            manager = createManager();
            // Ensure conditional UI is marked as supported for this test
            manager.conditionalUISupported = true;

            const mockSessionId = 'session-cond-123';

            // Check availability
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ available: true }),
            });

            // Begin login
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: mockSessionId,
                    options: {
                        publicKey: {
                            challenge: 'cond-challenge',
                            allowCredentials: [],
                        },
                    },
                }),
            });

            // User selects credential from autofill
            const mockCredential = {
                id: 'cond-cred-id',
                rawId: new ArrayBuffer(16),
                type: 'public-key',
                response: {
                    clientDataJSON: new ArrayBuffer(32),
                    authenticatorData: new ArrayBuffer(37),
                    signature: new ArrayBuffer(64),
                },
            };
            mockCredentialsGet.mockResolvedValueOnce(mockCredential);

            // Server verifies
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    username: 'conditional-user',
                }),
            });

            const result = await manager.startConditionalUI();

            // Verify mediation was set to 'conditional'
            expect(mockCredentialsGet).toHaveBeenCalledWith(
                expect.objectContaining({
                    mediation: 'conditional',
                    signal: expect.any(AbortSignal),
                })
            );

            expect(result).toEqual({ success: true, username: 'conditional-user' });
        });

        it('should skip conditional UI when not supported', async () => {
            manager = createManager();
            manager.conditionalUISupported = false;

            const result = await manager.startConditionalUI();

            expect(result).toBeNull();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should skip conditional UI when no passkeys available', async () => {
            manager = createManager();
            // Ensure conditional UI is marked as supported for this test
            manager.conditionalUISupported = true;

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ available: false }),
            });

            const result = await manager.startConditionalUI();

            expect(result).toBeNull();
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should handle conditional UI abort', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ available: true }),
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge',
                            allowCredentials: [],
                        },
                    },
                }),
            });

            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            mockCredentialsGet.mockRejectedValueOnce(abortError);

            const result = await manager.startConditionalUI();

            expect(result).toBeNull();
        });

        it('should abort existing conditional UI when starting new one', async () => {
            manager = createManager();
            manager.conditionalUISupported = true;

            // Mock check availability
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ available: true }),
            });

            // Mock begin login for first call
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge-1',
                            allowCredentials: [],
                        },
                    },
                }),
            });

            // Make credentials.get wait indefinitely
            mockCredentialsGet.mockImplementation(
                () => new Promise((resolve) => setTimeout(() => resolve(null), 10000))
            );

            // Start first conditional UI
            const promise1 = manager.startConditionalUI();

            // Wait for first call to set up abort controller
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Verify abort controller exists
            expect(manager.conditionalUIAbortController).not.toBeNull();
            const firstController = manager.conditionalUIAbortController;
            const abortSpy = vi.spyOn(firstController, 'abort');

            // Mock second availability check
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ available: true }),
            });

            // Mock second begin login
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-456',
                    options: {
                        publicKey: {
                            challenge: 'challenge-2',
                            allowCredentials: [],
                        },
                    },
                }),
            });

            // Start second conditional UI (should abort first)
            const promise2 = manager.startConditionalUI();

            // Wait for abort to be called
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(abortSpy).toHaveBeenCalled();

            // Clean up
            manager.abortConditionalUI();
            await Promise.race([
                promise1,
                promise2,
                new Promise((resolve) => setTimeout(resolve, 100)),
            ]);
        });

        it('should abort conditional UI during modal login', async () => {
            manager = createManager();

            // Setup conditional UI
            manager.conditionalUIAbortController = new AbortController();
            const abortSpy = vi.spyOn(manager.conditionalUIAbortController, 'abort');

            // Start modal login
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge',
                            allowCredentials: [],
                        },
                    },
                }),
            });

            mockCredentialsGet.mockResolvedValueOnce({
                id: 'cred-id',
                rawId: new ArrayBuffer(16),
                type: 'public-key',
                response: {
                    clientDataJSON: new ArrayBuffer(32),
                    authenticatorData: new ArrayBuffer(37),
                    signature: new ArrayBuffer(64),
                },
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await manager.login();

            expect(abortSpy).toHaveBeenCalled();
        });
    });

    describe('Passkey Management Workflow', () => {
        it('should list all registered passkeys', async () => {
            manager = createManager();

            const mockPasskeys = [
                {
                    id: 'pk1',
                    name: 'My Phone',
                    createdAt: '2024-01-01T00:00:00Z',
                    lastUsed: '2024-01-15T12:00:00Z',
                },
                {
                    id: 'pk2',
                    name: 'My Laptop',
                    createdAt: '2024-01-02T00:00:00Z',
                    lastUsed: null,
                },
            ];

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ passkeys: mockPasskeys }),
            });

            const passkeys = await manager.listPasskeys();

            expect(mockFetch).toHaveBeenCalledWith('/api/auth/webauthn/passkeys');
            expect(passkeys).toEqual(mockPasskeys);
        });

        it('should handle empty passkey list', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({}),
            });

            const passkeys = await manager.listPasskeys();

            expect(passkeys).toEqual([]);
        });

        it('should delete a passkey', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, deleted: 'pk1' }),
            });

            const result = await manager.deletePasskey('pk1');

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/auth/webauthn/passkeys',
                expect.objectContaining({
                    method: 'DELETE',
                    body: expect.stringContaining('"id":"pk1"'),
                })
            );
            expect(result).toEqual({ success: true, deleted: 'pk1' });
        });

        it('should handle passkey deletion failure', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: false,
                text: async () => 'Passkey not found',
            });

            await expect(manager.deletePasskey('invalid-id')).rejects.toThrow('Passkey not found');
        });

        it('should handle server error when listing passkeys', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: false,
                text: async () => 'Server error',
            });

            await expect(manager.listPasskeys()).rejects.toThrow('Failed to list passkeys');
        });
    });

    describe('Base64url Encoding/Decoding', () => {
        it('should correctly encode and decode ArrayBuffers', () => {
            manager = createManager();

            const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
            const buffer = testData.buffer;

            const encoded = manager.bufferToBase64url(buffer);
            expect(typeof encoded).toBe('string');
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');

            const decoded = manager.base64urlToBuffer(encoded);
            expect(new Uint8Array(decoded)).toEqual(testData);
        });

        it('should handle empty buffers', () => {
            manager = createManager();

            const emptyBuffer = new ArrayBuffer(0);
            const encoded = manager.bufferToBase64url(emptyBuffer);
            expect(encoded).toBe('');

            const decoded = manager.base64urlToBuffer('');
            expect(decoded.byteLength).toBe(0);
        });

        it('should handle various padding scenarios', () => {
            manager = createManager();

            // Test with data that would need different padding amounts
            const tests = [
                new Uint8Array([1]),
                new Uint8Array([1, 2]),
                new Uint8Array([1, 2, 3]),
                new Uint8Array([1, 2, 3, 4]),
            ];

            tests.forEach((testData) => {
                const encoded = manager.bufferToBase64url(testData.buffer);
                const decoded = manager.base64urlToBuffer(encoded);
                expect(new Uint8Array(decoded)).toEqual(testData);
            });
        });
    });

    describe('Credential Serialization', () => {
        it('should serialize creation credential correctly', () => {
            manager = createManager();

            const mockCredential = {
                id: 'test-id',
                rawId: new Uint8Array([1, 2, 3, 4]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
                    attestationObject: new Uint8Array([9, 10, 11, 12]).buffer,
                    getTransports: () => ['usb', 'nfc'],
                },
                authenticatorAttachment: 'cross-platform',
            };

            const serialized = manager.serializeCreationCredential(mockCredential);

            expect(serialized).toHaveProperty('id', 'test-id');
            expect(serialized).toHaveProperty('rawId');
            expect(serialized).toHaveProperty('type', 'public-key');
            expect(serialized.response).toHaveProperty('clientDataJSON');
            expect(serialized.response).toHaveProperty('attestationObject');
            expect(serialized.response).toHaveProperty('transports', ['usb', 'nfc']);
            expect(serialized).toHaveProperty('authenticatorAttachment', 'cross-platform');
        });

        it('should serialize get credential correctly', () => {
            manager = createManager();

            const mockCredential = {
                id: 'test-get-id',
                rawId: new Uint8Array([1, 2, 3, 4]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
                    authenticatorData: new Uint8Array([9, 10, 11, 12]).buffer,
                    signature: new Uint8Array([13, 14, 15, 16]).buffer,
                    userHandle: new Uint8Array([17, 18, 19, 20]).buffer,
                },
            };

            const serialized = manager.serializeGetCredential(mockCredential);

            expect(serialized).toHaveProperty('id', 'test-get-id');
            expect(serialized).toHaveProperty('rawId');
            expect(serialized).toHaveProperty('type', 'public-key');
            expect(serialized.response).toHaveProperty('clientDataJSON');
            expect(serialized.response).toHaveProperty('authenticatorData');
            expect(serialized.response).toHaveProperty('signature');
            expect(serialized.response).toHaveProperty('userHandle');
        });

        it('should handle credential without optional properties', () => {
            manager = createManager();

            const minimalCredential = {
                id: 'minimal-id',
                rawId: new Uint8Array([1, 2]).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new Uint8Array([3, 4]).buffer,
                    attestationObject: new Uint8Array([5, 6]).buffer,
                },
            };

            const serialized = manager.serializeCreationCredential(minimalCredential);

            expect(serialized).toHaveProperty('id');
            expect(serialized).not.toHaveProperty('authenticatorAttachment');
        });
    });

    describe('Platform Authenticator Availability', () => {
        it('should check if platform authenticator is available', async () => {
            manager = createManager();

            window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(() =>
                Promise.resolve(true)
            );

            const available = await manager.isPlatformAuthenticatorAvailable();

            expect(available).toBe(true);
            expect(
                window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
            ).toHaveBeenCalled();
        });

        it('should return false when not available', async () => {
            manager = createManager();

            window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(() =>
                Promise.resolve(false)
            );

            const available = await manager.isPlatformAuthenticatorAvailable();

            expect(available).toBe(false);
        });

        it('should handle errors gracefully', async () => {
            manager = createManager();

            window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(() =>
                Promise.reject(new Error('Not supported'))
            );

            const available = await manager.isPlatformAuthenticatorAvailable();

            expect(available).toBe(false);
        });
    });

    describe('Error Handling Edge Cases', () => {
        it('should reject registration when not supported', async () => {
            manager = createManager();
            manager.supported = false;

            await expect(manager.registerPasskey()).rejects.toThrow('not supported');
        });

        it('should reject login when not supported', async () => {
            manager = createManager();
            manager.supported = false;

            await expect(manager.login()).rejects.toThrow('not supported');
        });

        it('should handle network errors during registration', async () => {
            manager = createManager();

            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            await expect(manager.registerPasskey()).rejects.toThrow('Network error');
        });

        it('should handle network errors during login', async () => {
            manager = createManager();

            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            await expect(manager.login()).rejects.toThrow('Network error');
        });

        it('should handle unknown browser errors during registration', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge',
                            rp: { name: 'Test' },
                            user: { id: 'user-123', name: 'test', displayName: 'Test' },
                            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
                        },
                    },
                }),
            });

            const unknownError = new Error('Unknown error');
            unknownError.name = 'UnknownError';
            mockCredentialsCreate.mockRejectedValueOnce(unknownError);

            await expect(manager.registerPasskey()).rejects.toThrow('Unknown error');
        });

        it('should handle unknown browser errors during login', async () => {
            manager = createManager();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionId: 'session-123',
                    options: {
                        publicKey: {
                            challenge: 'challenge',
                            allowCredentials: [],
                        },
                    },
                }),
            });

            const unknownError = new Error('Unknown error');
            unknownError.name = 'UnknownError';
            mockCredentialsGet.mockRejectedValueOnce(unknownError);

            await expect(manager.login()).rejects.toThrow('Unknown error');
        });
    });

    describe('Option Preparation', () => {
        it('should prepare registration options with excludeCredentials', () => {
            manager = createManager();

            const options = {
                challenge: 'dGVzdC1jaGFsbGVuZ2U',
                rp: { name: 'Test' },
                user: {
                    id: 'dXNlci1pZA',
                    name: 'test',
                    displayName: 'Test',
                },
                pubKeyCredParams: [],
                excludeCredentials: [{ id: 'Y3JlZC1pZA', type: 'public-key' }],
            };

            const prepared = manager.preparePublicKeyOptions(options);

            expect(prepared.challenge).toBeInstanceOf(ArrayBuffer);
            expect(prepared.user.id).toBeInstanceOf(ArrayBuffer);
            expect(prepared.excludeCredentials[0].id).toBeInstanceOf(ArrayBuffer);
        });

        it('should prepare login options with allowCredentials', () => {
            manager = createManager();

            const options = {
                challenge: 'dGVzdC1jaGFsbGVuZ2U',
                allowCredentials: [{ id: 'Y3JlZC1pZA', type: 'public-key' }],
            };

            const prepared = manager.prepareGetOptions(options);

            expect(prepared.challenge).toBeInstanceOf(ArrayBuffer);
            expect(prepared.allowCredentials[0].id).toBeInstanceOf(ArrayBuffer);
        });

        it('should handle options without optional credential lists', () => {
            manager = createManager();

            const registrationOptions = {
                challenge: 'dGVzdA',
                rp: { name: 'Test' },
                user: { id: 'dXNlcg', name: 'test', displayName: 'Test' },
                pubKeyCredParams: [],
            };

            const loginOptions = {
                challenge: 'dGVzdA',
            };

            const preparedReg = manager.preparePublicKeyOptions(registrationOptions);
            const preparedLogin = manager.prepareGetOptions(loginOptions);

            expect(preparedReg.excludeCredentials).toBeUndefined();
            expect(preparedLogin.allowCredentials).toBeUndefined();
        });
    });
});
