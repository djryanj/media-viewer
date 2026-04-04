# API Overview

Media Viewer exposes a RESTful API for programmatic access to all features. The API is used internally by the web frontend and can also be used for custom integrations.

## Base URL

All API endpoints are prefixed with `/api/` (except authentication, health, and version endpoints).

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

Most responses are JSON, but response envelopes vary by endpoint.

- Collection, file, tag, and favorites listing endpoints commonly return arrays or typed objects directly.
- Many mutation endpoints return a small status envelope such as:

```json
{
    "status": "ok"
}
```

- Some validation failures still return plain-text `400 Bad Request` responses.
- Conflict responses for newer endpoints such as Collections use JSON error payloads:

```json
{
    "error": "Error message"
}
```

For exact request and response schemas, use the [OpenAPI specification](openapi.md).

## Endpoints Summary

### Authentication

| Method | Endpoint             | Description          |
| ------ | -------------------- | -------------------- |
| POST   | `/api/auth/login`    | Log in               |
| POST   | `/api/auth/logout`   | Log out              |
| GET    | `/api/auth/check`    | Check session status |
| PUT    | `/api/auth/password` | Change password      |

### Files

| Method | Endpoint                  | Description                            |
| ------ | ------------------------- | -------------------------------------- |
| GET    | `/api/files`              | List directory contents                |
| GET    | `/api/files/paths`        | List lightweight path entries          |
| GET    | `/api/files/{path}`       | Get original file                      |
| GET    | `/api/media`              | List media files for lightbox          |
| GET    | `/api/playlists`          | List playlists                         |
| GET    | `/api/playlists/{name}`   | Get playlist contents                  |
| GET    | `/api/stream/{path}`      | Stream video                           |
| GET    | `/api/stream-info/{path}` | Get stream metadata                    |
| POST   | `/api/hls/session`        | Create or reuse an HLS session         |
| GET    | `/api/thumbnails/{path}`  | Get thumbnail                          |
| DELETE | `/api/thumbnails/{path}`  | Invalidate a single cached thumbnail   |
| POST   | `/api/thumbnails/rebuild` | Trigger thumbnail rebuild              |
| GET    | `/api/thumbnails/status`  | Get thumbnail generation status        |

### Tags

| Method | Endpoint           | Description                          |
| ------ | ------------------ | ------------------------------------ |
| GET    | `/api/tags`        | List all tags                        |
| GET    | `/api/tags/stats`  | List tags with usage counts          |
| GET    | `/api/tags/unused` | List unused tag names                |
| GET    | `/api/tags/file`   | Get tags for a file                  |
| POST   | `/api/tags/file`   | Add tag to file                      |
| DELETE | `/api/tags/file`   | Remove tag from file                 |
| PUT    | `/api/tags/file`   | Replace all tags for a file          |
| POST   | `/api/tags/query`  | Get tags for multiple files          |
| POST   | `/api/tags/bulk`   | Add one or more tags to many files   |
| DELETE | `/api/tags/bulk`   | Remove one or more tags from files   |
| GET    | `/api/tags/{tag}`  | Get files with a tag                 |
| PUT    | `/api/tags/{tag}`  | Rename a tag globally                |
| DELETE | `/api/tags/{tag}`  | Delete a tag globally                |

### Favorites

| Method | Endpoint               | Description               |
| ------ | ---------------------- | ------------------------- |
| GET    | `/api/favorites`       | List favorites            |
| POST   | `/api/favorites`       | Add favorite              |
| DELETE | `/api/favorites`       | Remove favorite           |
| POST   | `/api/favorites/bulk`  | Add multiple favorites    |
| DELETE | `/api/favorites/bulk`  | Remove multiple favorites |
| PUT    | `/api/favorites/order` | Reorder favorites         |

### Collections

| Method | Endpoint                        | Description                                 |
| ------ | ------------------------------- | ------------------------------------------- |
| GET    | `/api/collections`              | List all collections                        |
| POST   | `/api/collections`              | Create a collection                         |
| POST   | `/api/collections/memberships`  | Look up memberships for multiple file paths |
| GET    | `/api/collections/{id}`         | Get a collection with its ordered items     |
| PUT    | `/api/collections/{id}`         | Rename a collection or update its cover     |
| DELETE | `/api/collections/{id}`         | Delete a collection                         |
| POST   | `/api/collections/{id}/items`   | Add items to a collection                   |
| DELETE | `/api/collections/{id}/items`   | Remove items from a collection              |
| PUT    | `/api/collections/{id}/order`   | Replace collection item order               |

Collections are folder-scoped and ordered. See the dedicated [Collections API](collections.md) page for request and conflict details.

### Search

| Method | Endpoint                  | Description              |
| ------ | ------------------------- | ------------------------ |
| GET    | `/api/search`             | Search media             |
| GET    | `/api/search/suggestions` | Get autocomplete results |

### System

| Method | Endpoint               | Description                  |
| ------ | ---------------------- | ---------------------------- |
| GET    | `/api/stats`           | Get library statistics       |
| POST   | `/api/reindex`         | Trigger a background reindex |
| POST   | `/api/transcode/clear` | Clear transcode cache        |
| GET    | `/health`              | Health check                 |
| GET    | `/healthz`             | Health check alias           |
| GET    | `/livez`               | Liveness probe               |
| GET    | `/readyz`              | Readiness probe              |
| GET    | `/version`             | Version information          |
