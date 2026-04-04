# Files & Media API

Endpoints for browsing, retrieving, streaming, and thumbnailing media.

## Directory Listing

Browse a directory with pagination and filtering.

```http
GET /api/files
```

### Query Parameters

| Parameter  | Type    | Default | Description |
| ---------- | ------- | ------- | ----------- |
| `path`     | string  | `""`    | Directory path to browse. Empty string means the library root. |
| `sort`     | string  | `name`  | One of `name`, `date`, `size`, `type`. |
| `order`    | string  | `asc`   | `asc` or `desc`. |
| `type`     | string  | `all`   | One of `all`, `images`, `videos`, `playlists`. |
| `page`     | integer | `1`     | Page number. |
| `pageSize` | integer | `100`   | Number of items per page. |
| `offset`   | integer | `0`     | Optional offset for clients that want explicit offset control. |

### Response

```json
{
    "path": "photos/vacation",
    "name": "vacation",
    "parent": "photos",
    "breadcrumb": [
        { "name": "Home", "path": "" },
        { "name": "photos", "path": "photos" },
        { "name": "vacation", "path": "photos/vacation" }
    ],
    "items": [
        {
            "id": 101,
            "name": "beach.jpg",
            "path": "photos/vacation/beach.jpg",
            "parentPath": "photos/vacation",
            "type": "image",
            "size": 2458624,
            "modTime": "2026-04-03T18:25:19Z",
            "mimeType": "image/jpeg",
            "thumbnailUrl": "/api/thumbnails/photos/vacation/beach.jpg",
            "isFavorite": true,
            "tags": ["beach", "sunset"]
        }
    ],
    "favorites": [],
    "totalItems": 42,
    "page": 1,
    "pageSize": 100,
    "totalPages": 1
}
```

## Lightweight Path Listing

Return directory entries without the full metadata payload.

```http
GET /api/files/paths
```

This endpoint accepts `path`, `sort`, `order`, and `type` query parameters with the same meanings as `GET /api/files`.

## Fetch a File

Retrieve the original file bytes.

```http
GET /api/files/{path}
```

### Notes

- `path` is a URL-encoded path parameter.
- The server returns the underlying file content type.
- Video responses support range requests for seeking.

## List Media for Lightbox Navigation

Return only image and video entries from a directory.

```http
GET /api/media
```

### Query Parameters

| Parameter | Type    | Default | Description |
| --------- | ------- | ------- | ----------- |
| `path`    | string  | `""`    | Directory path. |
| `sort`    | string  | `name`  | One of `name`, `date`, `size`, `type`. |
| `order`   | string  | `asc`   | `asc` or `desc`. |
| `offset`  | integer | `0`     | Zero-based media offset. |
| `limit`   | integer | `500`   | Maximum items to return. |

### Response

```json
{
    "items": [
        {
            "id": 101,
            "name": "beach.jpg",
            "path": "photos/vacation/beach.jpg",
            "parentPath": "photos/vacation",
            "type": "image"
        }
    ],
    "total": 120,
    "offset": 0,
    "limit": 500
}
```

## Playlists

```http
GET /api/playlists
GET /api/playlists/{name}
```

- `GET /api/playlists` lists detected playlists.
- `GET /api/playlists/{name}` returns the ordered media items for a playlist.

## Streaming

```http
GET /api/stream/{path}
GET /api/stream-info/{path}
POST /api/hls/session
GET /api/hls/{sessionId}/playlist.m3u8
GET /api/hls/{sessionId}/seg{index}.ts
```

- `/api/stream/{path}` serves direct video streaming and supports `GET` and `HEAD`.
- `/api/stream-info/{path}` returns stream metadata, including whether transcoding is needed.
- The HLS endpoints create and serve segmented playback sessions.

## Thumbnails

```http
GET /api/thumbnails/{path}
DELETE /api/thumbnails/{path}
POST /api/thumbnails/invalidate
POST /api/thumbnails/rebuild
GET /api/thumbnails/status
```

- `GET /api/thumbnails/{path}` returns a generated or cached thumbnail.
- `DELETE /api/thumbnails/{path}` invalidates a single cached thumbnail.
- `POST /api/thumbnails/invalidate` clears the full thumbnail cache.
- `POST /api/thumbnails/rebuild` starts a background rebuild.
- `GET /api/thumbnails/status` reports rebuild progress.

For exact schemas and media-specific edge cases, see the [OpenAPI specification](openapi.md).
