# Authentication API

Password-based authentication endpoints for initial setup and session management.

## Overview

Media Viewer uses session-based authentication with an HTTP-only cookie. After a successful login, the server sets a cookie that must be included in later requests.

## Session Cookie

- Name: `media_viewer_session`
- `HttpOnly`: `true`
- `SameSite`: `Strict`
- Expiration: configurable server-side session duration
- Behavior: sliding expiration for authenticated API activity

## Initial Setup

Create the first password when the instance has no users yet.

```http
POST /api/auth/setup
```

### Request

```json
{
    "password": "your-password"
}
```

### Notes

- Only available before initial setup is complete.
- Passwords must be between 6 and 72 characters.

### Response

```json
{
    "success": true,
    "message": "Password configured successfully"
}
```

## Check Authentication State

Return both session state and setup state.

```http
GET /api/auth/check
```

### Response

Authenticated:

```json
{
    "authenticated": true,
    "setupRequired": false,
    "expiresIn": 86400
}
```

Not authenticated:

```json
{
    "authenticated": false,
    "setupRequired": false
}
```

Setup required:

```json
{
    "authenticated": false,
    "setupRequired": true
}
```

## Login

Authenticate with the configured password and receive a session cookie.

```http
POST /api/auth/login
```

### Request

```json
{
    "password": "your-password"
}
```

### Response

```json
{
    "success": true,
    "expiresIn": 86400
}
```

The response also sets a `Set-Cookie` header for `media_viewer_session`.

## Logout

Destroy the current session and clear the cookie.

```http
POST /api/auth/logout
```

### Response

```json
{
    "success": true,
    "message": "Logged out successfully"
}
```

## Change Password

Update the password for the instance.

```http
PUT /api/auth/password
```

### Request

```json
{
    "currentPassword": "current-password",
    "newPassword": "new-password"
}
```

### Notes

- `newPassword` must be between 6 and 72 characters.
- Invalid current password returns `401 Unauthorized`.

### Response

```json
{
    "success": true,
    "message": "Password updated successfully"
}
```

## Keep Session Alive

Refresh the current session explicitly.

```http
PUT /api/auth/keepalive
```

### Response

```json
{
    "success": true,
    "expiresIn": 86400
}
```

## Error Behavior

Authentication endpoints commonly return plain-text `400` and `401` responses for invalid request bodies, short passwords, missing sessions, or invalid credentials.

For WebAuthn-specific endpoints, see [webauthn.md](webauthn.md).
