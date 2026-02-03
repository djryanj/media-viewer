# Authentication API

Password-based authentication endpoints for session management.

## Overview

Media Viewer uses session-based authentication with HTTP-only cookies. After successful login, the server sets a session cookie that must be included in subsequent requests.

## Session Cookie

- **Name**: `session`
- **HttpOnly**: `true` (not accessible via JavaScript)
- **SameSite**: `Strict`
- **Duration**: Configurable via `SESSION_DURATION` (default: 24h)
- **Type**: Sliding expiration (extends on activity)

## Endpoints

### Check Setup Required

Check if initial password setup is needed.

```
GET /api/auth/check-setup
```

### Login

Authenticate and create a session.

```
POST /api/auth/login
```

### Request

```json
{
    "password": "your-password"
}
```

### Response

**Success (200):**

```json
{
    "success": true
}
```

A session cookie is set in the response headers.

**Failure (401):**

```json
{
    "success": false,
    "error": "Invalid password"
}
```

### Logout

End the current session.

```
POST /api/auth/logout
```

### Response

**Success (200):**

```json
{
    "success": true
}
```

The session cookie is cleared.

### Check Session

Verify if the current session is valid.

```
GET /api/auth/check
```

### Response

**Authenticated (200):**

```json
{
    "success": true
}
```

**Not Authenticated (401):**

```json
{
    "success": false
}
```

### Change Password

Update the application password.

```
PUT /api/auth/password
```

### Request

```json
{
    "currentPassword": "current-password",
    "newPassword": "new-password"
}
```

### Response

**Success (200):**

```json
{
    "success": true
}
```

**Invalid Current Password (401):**

```json
{
    "success": false,
    "error": "Current password is incorrect"
}
```

**Validation Error (400):**

```json
{
    "success": false,
    "error": "New password must be at least 6 characters"
}
```

## Session Keepalive

The application automatically sends keepalive requests to maintain active sessions. This is handled internally and does not require manual API calls.
