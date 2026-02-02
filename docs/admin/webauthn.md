# WebAuthn (Passkey) Authentication

Media Viewer supports passwordless authentication using passkeys (WebAuthn/FIDO2), allowing users to sign in with biometrics or security keys instead of passwords.

## Overview

Passkeys provide a more secure and convenient authentication method compared to traditional passwords:

- **No passwords to remember** - Use your device's biometrics or security key
- **Phishing-resistant** - Passkeys are cryptographically bound to your domain
- **Multi-device support** - Register passkeys on multiple devices
- **Privacy-focused** - No personal data leaves your device during authentication

## Supported Authentication Methods

### Platform Authenticators (Built-in)

- **Windows Hello** - Face recognition, fingerprint, or PIN on Windows devices
- **Touch ID / Face ID** - Biometric authentication on Apple devices
- **Android Biometrics** - Fingerprint, face unlock, or pattern on Android devices

### Security Keys (External)

- **YubiKey** - USB, NFC, or Lightning security keys
- **Google Titan** - USB and Bluetooth security keys
- **Any FIDO2-compliant key** - Supports the WebAuthn standard

## Browser Compatibility

| Browser          | Version | Platform Auth | Security Keys | Conditional UI | Notes                                    |
| ---------------- | ------- | ------------- | ------------- | -------------- | ---------------------------------------- |
| Chrome           | 108+    | ✅            | ✅            | ✅             | Full support including autofill          |
| Edge             | 108+    | ✅            | ✅            | ✅             | Full support including autofill          |
| Safari           | 16+     | ✅            | ✅            | ✅             | Requires macOS Ventura or iOS 16+        |
| Firefox          | 119+    | ✅            | ✅            | ❌             | No autofill support, uses modal prompt   |
| Chrome Android   | 108+    | ✅            | ✅            | ✅             | Supports biometrics and USB-C keys       |
| Safari iOS       | 16+     | ✅            | ✅            | ✅             | Face ID, Touch ID, external keys via NFC |
| Samsung Internet | 23+     | ✅            | ✅            | ✅             | Full support on Samsung devices          |

### Feature Descriptions

- **Platform Auth**: Built-in biometric authentication (Touch ID, Face ID, Windows Hello)
- **Security Keys**: External FIDO2 security keys (YubiKey, Titan, etc.)
- **Conditional UI**: Passkeys appear in password field autofill dropdown

## Configuration

### Environment Variables

WebAuthn requires specific configuration to work properly:

```yaml
environment:
    - WEBAUTHN_ENABLED=true # Enable passkey authentication
    - WEBAUTHN_RP_ID=example.com # Your domain name
    - WEBAUTHN_RP_NAME=Media Viewer # Display name in prompts
    - WEBAUTHN_ORIGINS=https://example.com # Allowed origins (comma-separated)
```

### Relying Party ID (RP ID)

The `WEBAUTHN_RP_ID` must match your domain:

```yaml
# ✅ Correct configurations
WEBAUTHN_RP_ID=example.com
WEBAUTHN_ORIGINS=https://example.com

WEBAUTHN_RP_ID=example.com
WEBAUTHN_ORIGINS=https://media.example.com

# ❌ Incorrect configurations
WEBAUTHN_RP_ID=media.example.com
WEBAUTHN_ORIGINS=https://example.com              # RP ID not a suffix of origin

WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGINS=https://example.com              # Mismatch

WEBAUTHN_RP_ID=192.168.1.50                       # IP addresses not allowed
```

**Rules**:

1. RP ID must be a valid domain (not an IP address)
2. RP ID must be a suffix of the origin domain
3. RP ID should match the effective domain (usually top-level domain)

### Multiple Origins

To support multiple subdomains or origins:

```yaml
WEBAUTHN_RP_ID=example.com
WEBAUTHN_ORIGINS=https://example.com,https://media.example.com,https://photos.example.com
```

### Docker Compose Example

```yaml
version: '3.8'

services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        ports:
            - '443:8080'
        environment:
            - WEBAUTHN_ENABLED=true
            - WEBAUTHN_RP_ID=media.example.com
            - WEBAUTHN_RP_NAME=My Media Library
            - WEBAUTHN_ORIGINS=https://media.example.com
        volumes:
            - /path/to/media:/media:ro
            - media-database:/database
        restart: unless-stopped

volumes:
    media-database:
```

### Kubernetes Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
    name: media-viewer
spec:
    template:
        spec:
            containers:
                - name: media-viewer
                  image: ghcr.io/djryanj/media-viewer:latest
                  env:
                      - name: WEBAUTHN_ENABLED
                        value: 'true'
                      - name: WEBAUTHN_RP_ID
                        value: media.example.com
                      - name: WEBAUTHN_RP_NAME
                        value: Media Viewer
                      - name: WEBAUTHN_ORIGINS
                        value: https://media.example.com
```

## Secure Context Requirement

WebAuthn **requires HTTPS** (or `http://localhost` for development):

| Context                         | WebAuthn Support | Use Case           |
| ------------------------------- | ---------------- | ------------------ |
| `https://example.com`           | ✅               | Production         |
| `http://localhost:8080`         | ✅               | Local development  |
| `http://192.168.1.50:8080`      | ❌               | Won't work         |
| `http://example.com`            | ❌               | Must use HTTPS     |
| `https://abc123.ngrok-free.app` | ✅               | Development tunnel |

### Why HTTPS is Required

WebAuthn is a powerful authentication API that generates cryptographic keys. Browsers restrict it to secure contexts to prevent:

- **Man-in-the-middle attacks** - HTTPS ensures credentials can't be intercepted
- **Credential theft** - Prevents malicious sites from stealing authentication data
- **Domain spoofing** - Ensures users authenticate to the correct site

### Development Exceptions

Browsers allow `http://localhost` for development convenience, but this exception does **not** extend to:

- IP addresses (`http://127.0.0.1` or `http://192.168.x.x`)
- Custom local domains without certificates
- Any non-localhost hostname over HTTP
