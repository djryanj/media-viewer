# WebAuthn (Passkey) Authentication User Guide

## For End Users

### Registering a Passkey

1. **Log in** with your password
2. **Open Settings** (⚙️ icon in top-right)
3. **Navigate to "Passkeys" tab**
4. **Click "Add Passkey"**
5. **Name your passkey** (e.g., "MacBook Pro", "iPhone 14", "YubiKey")
6. **Complete authentication**:
    - Touch ID/Face ID prompt on Apple devices
    - Windows Hello prompt on Windows
    - Fingerprint prompt on Android
    - Insert and tap security key if using external authenticator

### Logging In with a Passkey

**Method 1: Auto-prompt (Firefox and older browsers)**

1. Navigate to login page
2. Wait for passkey prompt to appear automatically
3. Complete biometric authentication or tap security key

**Method 2: Autofill (Chrome, Safari, Edge)**

1. Navigate to login page
2. Click or tap in the password field
3. Select your passkey from the autofill dropdown
4. Complete biometric authentication

**Method 3: Manual button**

1. Navigate to login page
2. Click "Sign in with Passkey" button
3. Complete biometric authentication or tap security key

**Fallback: Password**

- You can always use your password if passkeys fail
- Password field remains available even with passkeys registered

### Managing Passkeys

**View registered passkeys**:

- Settings → Passkeys tab
- See device names, creation dates, and last used dates

**Delete a passkey**:

- Click trash icon next to the passkey
- Confirm deletion
- The device/key will no longer be able to sign in

**Best practices**:

- Register passkeys on devices you frequently use
- Use descriptive names ("Work MacBook", "Personal iPhone")
- Remove passkeys for lost or sold devices immediately
- Keep at least one backup authentication method

## For Administrators

### Initial Setup

1. **Enable HTTPS** on your server (required for production)
2. **Set environment variables** (see Configuration section)
3. **Restart the application**
4. **Verify configuration** in application logs:
