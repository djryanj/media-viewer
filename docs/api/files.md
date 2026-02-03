# Files & Media API

Endpoints for browsing, retrieving, and streaming media files.

## API Reference

See the [OpenAPI Specification](openapi.md) for interactive documentation of all file-related endpoints:

- `GET /api/files` - List files and folders
- `GET /api/file/{path}` - Get a file
- `GET /api/thumbnail/{path}` - Get thumbnail
- `GET /api/stream/{path}` - Stream video
- `GET /api/stream-info/{path}` - Get stream info
- `GET /api/playlists` - List playlists
- `GET /api/playlist/{name}` - Get playlist contents

Refer to the OpenAPI documentation for detailed request/response schemas and examples.

## List Directory

Get contents of a directory with pagination and filtering.

```
GET /api/files
```

### Parameters

| Parameter | Type   | Default | Description                            |
| --------- | ------ | ------- | -------------------------------------- |
| path      | string | ""      | Directory path (empty for root)        |
| sort      | string | "name"  | Sort field: name, date, size, type     |
| order     | string | "asc"   | Sort order: asc, desc                  |
| type      | string | ""      | Filter by type: image, video, playlist |
| page      | number | 1       | Page number                            |
| pageSize  | number | 100     | Items per page                         |

### Response

```json
{
    "path": "photos/vacation",
    "breadcrumb": [
        { "name": "Home", "path": "" },
        { "name": "photos", "path": "photos" },
        { "name": "vacation", "path": "photos/vacation" }
    ],
    "items": [
        {
            "name": "beach.jpg",
            "path": "photos/vacation/beach.jpg",
            "type": "image",
            "size": 2458624,
            "modified": "2024-07-15T10:30:00Z",
            "tags": ["beach", "sunset"],
            "isFavorite": true
        }
    ],
    "page": 1,
    "pageSize": 100,
    "totalItems": 42,
    "totalPages": 1
}
```

## List Media Files

Get all media files in a directory for lightbox navigation.

```
GET /api/media
```

### Parameters

| Parameter | Type   | Default | Description    |
| --------- | ------ | ------- | -------------- |
| path      | string | ""      | Directory path |
| sort      | string | "name"  | Sort field     |
| order     | string | "asc"   | Sort order     |

### Response

```json
[
    {
        "name": "beach.jpg",
        "path": "photos/vacation/beach.jpg",
        "type": "image",
        "tags": ["beach", "sunset"]
    },
    {
        "name": "video.mp4",
        "path": "photos/vacation/video.mp4",
        "type": "video",
        "tags": []
    }
]
```

## Get Thumbnail

Get a thumbnail image for a file.

```
GET /api/thumbnail/{path}
```

### Parameters

| Parameter | Type   | Description           |
| --------- | ------ | --------------------- |
| path      | string | URL-encoded file path |

### Response

Returns the thumbnail image with appropriate content type.

**Not Found (404):** If the file doesn't exist or thumbnail generation fails.

## Get Original File

Get the original file for viewing.

```
GET /api/file/{path}
```

### Parameters

| Parameter | Type   | Description           |
| --------- | ------ | --------------------- |
| path      | string | URL-encoded file path |

### Response

Returns the file with appropriate content type and support for range requests (video seeking).

## Search

Search for files by name or tag.

```
GET /api/search
```

### Parameters

| Parameter | Type   | Description               |
| --------- | ------ | ------------------------- |
| q         | string | Search query              |
| type      | string | Filter by type (optional) |
| page      | number | Page number               |
| pageSize  | number | Items per page            |

### Query Syntax

- `sunset` - Search filenames containing "sunset"
- `tag:vacation` - Search for files with "vacation" tag

### Response

Same format as List Directory response.
