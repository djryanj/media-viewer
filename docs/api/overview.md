# API Overview

Media Viewer provides a REST API for all functionality. This documentation covers the available endpoints.

## Base URL

All API endpoints are relative to your Media Viewer installation:

```
https://your-server.com/api/
```

## Authentication

Most endpoints require authentication via session cookie. Obtain a session by logging in through the `/api/auth/login` endpoint.

### Session Cookie

After successful login, a session cookie is set automatically. Include this cookie in subsequent requests.

### Unauthenticated Requests

Unauthenticated requests to protected endpoints return:

```
HTTP/1.1 401 Unauthorized
```

## Response Format

All responses are JSON unless otherwise noted.

### Success Response

```json
{
    "success": true,
    "data": {}
}
```

### Error Response

```json
{
    "success": false,
    "error": "Error message"
}
```

## Endpoints Summary

### Authentication

| Method | Endpoint             | Description          |
| ------ | -------------------- | -------------------- |
| POST   | `/api/auth/login`    | Log in               |
| POST   | `/api/auth/logout`   | Log out              |
| GET    | `/api/auth/check`    | Check session status |
| PUT    | `/api/auth/password` | Change password      |

### Files

| Method | Endpoint                | Description                   |
| ------ | ----------------------- | ----------------------------- |
| GET    | `/api/files`            | List directory contents       |
| GET    | `/api/media`            | List media files for lightbox |
| GET    | `/api/thumbnail/{path}` | Get thumbnail                 |
| GET    | `/api/file/{path}`      | Get original file             |

### Tags

| Method | Endpoint         | Description                    |
| ------ | ---------------- | ------------------------------ |
| GET    | `/api/tags`      | List all tags                  |
| GET    | `/api/tags/file` | Get tags for a file            |
| POST   | `/api/tags/file` | Add tag to file                |
| DELETE | `/api/tags/file` | Remove tag from file           |
| POST   | `/api/tags/bulk` | Add tag to multiple files      |
| DELETE | `/api/tags/bulk` | Remove tag from multiple files |

### Favorites

| Method | Endpoint              | Description            |
| ------ | --------------------- | ---------------------- |
| GET    | `/api/favorites`      | List favorites         |
| POST   | `/api/favorites`      | Add favorite           |
| DELETE | `/api/favorites`      | Remove favorite        |
| POST   | `/api/favorites/bulk` | Add multiple favorites |

### Search

| Method | Endpoint      | Description  |
| ------ | ------------- | ------------ |
| GET    | `/api/search` | Search media |

### System

| Method | Endpoint                  | Description                  |
| ------ | ------------------------- | ---------------------------- |
| GET    | `/api/stats`              | Get library statistics       |
| GET    | `/health`                 | Health check                 |
| GET    | `/version`                | Version information          |
| POST   | `/api/thumbnails/rebuild` | Clear and rebuild thumbnails |
