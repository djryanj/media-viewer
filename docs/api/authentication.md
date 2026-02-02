# Authentication API

Endpoints for authentication and session management.

## Login

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

## Logout

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

## Check Session

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

## Change Password

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
