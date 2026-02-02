/**
 * WebAuthn/Passkey support for Media Viewer
 */
class WebAuthnManager {
    constructor() {
        this.available = false;
        this.supported = this.isWebAuthnSupported();
        this.conditionalUISupported = false;
        this.conditionalUIAbortController = null;

        // Check for Conditional UI support
        this.checkConditionalUISupport();
    }

    /**
     * Check if WebAuthn is supported by the browser
     */
    isWebAuthnSupported() {
        return (
            window.PublicKeyCredential !== undefined &&
            typeof window.PublicKeyCredential === 'function'
        );
    }

    /**
     * Check if Conditional UI (autofill) is supported
     */
    async checkConditionalUISupport() {
        if (!this.supported) {
            this.conditionalUISupported = false;
            return;
        }

        try {
            // Check if the browser supports conditional mediation
            if (typeof PublicKeyCredential.isConditionalMediationAvailable === 'function') {
                this.conditionalUISupported =
                    await PublicKeyCredential.isConditionalMediationAvailable();
                console.debug('WebAuthn Conditional UI supported:', this.conditionalUISupported);
            } else {
                this.conditionalUISupported = false;
                console.debug('WebAuthn Conditional UI not available in this browser');
            }
        } catch (e) {
            console.debug('Error checking Conditional UI support:', e);
            this.conditionalUISupported = false;
        }
    }

    /**
     * Check if passkey login is available (credentials exist on server)
     */
    async checkAvailability() {
        if (!this.supported) {
            return false;
        }

        try {
            const response = await fetch('/api/auth/webauthn/available');
            if (!response.ok) {
                return false;
            }
            const data = await response.json();
            this.available = data.available === true;
            return this.available;
        } catch (e) {
            console.error('Failed to check WebAuthn availability:', e);
            return false;
        }
    }

    /**
     * Check if platform authenticator (Face ID, Touch ID, Windows Hello) is available
     */
    async isPlatformAuthenticatorAvailable() {
        if (!this.supported) {
            return false;
        }

        try {
            return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        } catch (e) {
            return false;
        }
    }

    /**
     * Start Conditional UI - allows passkeys to appear in autofill
     * Call this when the login page loads
     * Returns a promise that resolves when the user selects a passkey
     */
    async startConditionalUI() {
        if (!this.supported || !this.conditionalUISupported) {
            console.debug('Conditional UI not supported, skipping');
            return null;
        }

        // Check if passkeys are available on server
        const available = await this.checkAvailability();
        if (!available) {
            console.debug('No passkeys available, skipping Conditional UI');
            return null;
        }

        // Abort any existing conditional UI request
        this.abortConditionalUI();

        try {
            // Get authentication options from server
            const beginResponse = await fetch('/api/auth/webauthn/login/begin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });

            if (!beginResponse.ok) {
                console.debug('Failed to get WebAuthn options for Conditional UI');
                return null;
            }

            const { options, sessionId } = await beginResponse.json();

            // Prepare the options
            const publicKeyOptions = this.prepareGetOptions(options.publicKey);

            // Create abort controller for this request
            this.conditionalUIAbortController = new AbortController();

            // Start conditional UI - this will show passkeys in autofill
            // and wait for user to select one
            console.debug('Starting Conditional UI...');

            const credential = await navigator.credentials.get({
                publicKey: publicKeyOptions,
                mediation: 'conditional', // This is the key for Conditional UI
                signal: this.conditionalUIAbortController.signal,
            });

            // User selected a passkey - complete the login
            console.debug('Conditional UI: User selected a passkey');
            return await this.finishLogin(sessionId, credential);
        } catch (e) {
            if (e.name === 'AbortError') {
                console.debug('Conditional UI aborted');
                return null;
            }
            console.debug('Conditional UI error:', e);
            return null;
        }
    }

    /**
     * Abort any pending Conditional UI request
     */
    abortConditionalUI() {
        if (this.conditionalUIAbortController) {
            this.conditionalUIAbortController.abort();
            this.conditionalUIAbortController = null;
        }
    }

    /**
     * Start passkey registration (user must be logged in)
     */
    async registerPasskey(name = 'Passkey') {
        if (!this.supported) {
            throw new Error('WebAuthn is not supported in this browser');
        }

        // Step 1: Get registration options from server
        const beginResponse = await fetch('/api/auth/webauthn/register/begin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!beginResponse.ok) {
            const error = await beginResponse.text();
            throw new Error(error || 'Failed to start registration');
        }

        const { options, sessionId } = await beginResponse.json();

        // Step 2: Create credential using browser API
        const publicKeyOptions = this.preparePublicKeyOptions(options.publicKey);

        let credential;
        try {
            credential = await navigator.credentials.create({
                publicKey: publicKeyOptions,
            });
        } catch (e) {
            if (e.name === 'NotAllowedError') {
                throw new Error('Registration was cancelled or timed out');
            }
            if (e.name === 'InvalidStateError') {
                throw new Error('This authenticator is already registered');
            }
            throw e;
        }

        // Step 3: Send credential to server
        const credentialJSON = this.serializeCreationCredential(credential);

        const finishResponse = await fetch('/api/auth/webauthn/register/finish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: sessionId,
                name: name,
                credential: credentialJSON,
            }),
        });

        if (!finishResponse.ok) {
            const error = await finishResponse.text();
            throw new Error(error || 'Failed to complete registration');
        }

        return await finishResponse.json();
    }

    /**
     * Authenticate with passkey (modal/button triggered)
     */
    async login() {
        if (!this.supported) {
            throw new Error('WebAuthn is not supported in this browser');
        }

        // Abort any conditional UI that might be running
        this.abortConditionalUI();

        // Step 1: Get authentication options from server
        const beginResponse = await fetch('/api/auth/webauthn/login/begin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!beginResponse.ok) {
            if (beginResponse.status === 404) {
                throw new Error('No passkeys registered');
            }
            const error = await beginResponse.text();
            throw new Error(error || 'Failed to start login');
        }

        const { options, sessionId } = await beginResponse.json();

        // Step 2: Get credential using browser API
        const publicKeyOptions = this.prepareGetOptions(options.publicKey);

        let credential;
        try {
            credential = await navigator.credentials.get({
                publicKey: publicKeyOptions,
                // Note: no 'mediation' here - this is the modal flow
            });
        } catch (e) {
            if (e.name === 'NotAllowedError') {
                throw new Error('Authentication was cancelled or timed out');
            }
            throw e;
        }

        // Step 3: Complete login
        return await this.finishLogin(sessionId, credential);
    }

    /**
     * Complete the login process (shared by modal and conditional UI)
     */
    async finishLogin(sessionId, credential) {
        const credentialJSON = this.serializeGetCredential(credential);

        const finishResponse = await fetch('/api/auth/webauthn/login/finish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: sessionId,
                credential: credentialJSON,
            }),
        });

        if (!finishResponse.ok) {
            const error = await finishResponse.text();
            throw new Error(error || 'Authentication failed');
        }

        return await finishResponse.json();
    }

    /**
     * Get list of registered passkeys
     */
    async listPasskeys() {
        const response = await fetch('/api/auth/webauthn/passkeys');
        if (!response.ok) {
            throw new Error('Failed to list passkeys');
        }
        const data = await response.json();
        return data.passkeys || [];
    }

    /**
     * Delete a passkey
     */
    async deletePasskey(id) {
        const response = await fetch('/api/auth/webauthn/passkeys', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to delete passkey');
        }

        return await response.json();
    }

    /**
     * Prepare PublicKeyCredentialCreationOptions for navigator.credentials.create()
     */
    preparePublicKeyOptions(options) {
        const publicKeyOptions = {
            ...options,
            challenge: this.base64urlToBuffer(options.challenge),
            user: {
                ...options.user,
                id: this.base64urlToBuffer(options.user.id),
            },
        };

        // Convert excludeCredentials if present
        if (publicKeyOptions.excludeCredentials) {
            publicKeyOptions.excludeCredentials = publicKeyOptions.excludeCredentials.map(
                (cred) => ({
                    ...cred,
                    id: this.base64urlToBuffer(cred.id),
                })
            );
        }

        return publicKeyOptions;
    }

    /**
     * Prepare PublicKeyCredentialRequestOptions for navigator.credentials.get()
     */
    prepareGetOptions(options) {
        const publicKeyOptions = {
            ...options,
            challenge: this.base64urlToBuffer(options.challenge),
        };

        // Convert allowCredentials if present
        if (publicKeyOptions.allowCredentials) {
            publicKeyOptions.allowCredentials = publicKeyOptions.allowCredentials.map((cred) => ({
                ...cred,
                id: this.base64urlToBuffer(cred.id),
            }));
        }

        return publicKeyOptions;
    }

    /**
     * Serialize credential from navigator.credentials.create() for server
     */
    serializeCreationCredential(credential) {
        const json = {
            id: credential.id,
            rawId: this.bufferToBase64url(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: this.bufferToBase64url(credential.response.clientDataJSON),
                attestationObject: this.bufferToBase64url(credential.response.attestationObject),
            },
        };

        // Include transports if available (for better UX on future logins)
        if (credential.response.getTransports) {
            try {
                json.response.transports = credential.response.getTransports();
            } catch (e) {
                // Some browsers don't support this
            }
        }

        // Include authenticator attachment if available
        if (credential.authenticatorAttachment) {
            json.authenticatorAttachment = credential.authenticatorAttachment;
        }

        return json;
    }

    /**
     * Serialize credential from navigator.credentials.get() for server
     */
    serializeGetCredential(credential) {
        const json = {
            id: credential.id,
            rawId: this.bufferToBase64url(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: this.bufferToBase64url(credential.response.clientDataJSON),
                authenticatorData: this.bufferToBase64url(credential.response.authenticatorData),
                signature: this.bufferToBase64url(credential.response.signature),
            },
        };

        // Include userHandle if present (for resident keys)
        if (credential.response.userHandle) {
            json.response.userHandle = this.bufferToBase64url(credential.response.userHandle);
        }

        return json;
    }

    /**
     * Convert base64url string to ArrayBuffer
     */
    base64urlToBuffer(base64url) {
        if (!base64url) {
            return new ArrayBuffer(0);
        }

        // Add padding if needed
        const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
        const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + padding;

        const binary = atob(base64);
        const buffer = new ArrayBuffer(binary.length);
        const view = new Uint8Array(buffer);

        for (let i = 0; i < binary.length; i++) {
            view[i] = binary.charCodeAt(i);
        }

        return buffer;
    }

    /**
     * Convert ArrayBuffer to base64url string
     */
    bufferToBase64url(buffer) {
        if (!buffer || buffer.byteLength === 0) {
            return '';
        }

        const bytes = new Uint8Array(buffer);
        let binary = '';

        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }

        const base64 = btoa(binary);
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
}

// Create and export singleton instance
window.webAuthnManager = new WebAuthnManager();

// Log initialization status
if (window.webAuthnManager.supported) {
    console.debug('WebAuthn: Supported');
} else {
    console.debug('WebAuthn: Not supported in this browser');
}
