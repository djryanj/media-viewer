# Tags API

Endpoints for managing tags on media files.

## List All Tags

Get all tags in the library with usage counts.

```http
GET /api/tags
```

### Response

```json
[
    {
        "id": 1,
        "name": "vacation",
        "color": "#3b82f6",
        "itemCount": 42,
        "createdAt": "2026-04-03T18:25:19Z"
    },
    {
        "id": 2,
        "name": "family",
        "itemCount": 128,
        "createdAt": "2026-04-03T18:25:19Z"
    }
]
```

## Get File Tags

Get tags assigned to a specific file.

```http
GET /api/tags/file?path={filePath}
```

### Parameters

| Parameter | Type   | Description           |
| --------- | ------ | --------------------- |
| path      | string | URL-encoded file path |

### Response

```json
["vacation", "beach", "2024"]
```

## Add Tag to File

Add a tag to a single file.

```http
POST /api/tags/file
```

### Request

```json
{
    "path": "photos/vacation/beach.jpg",
    "tag": "vacation"
}
```

### Response

```json
{
    "status": "ok"
}
```

## Remove Tag from File

Remove a tag from a single file.

```http
DELETE /api/tags/file
```

### Request

```json
{
    "path": "photos/vacation/beach.jpg",
    "tag": "vacation"
}
```

### Response

```json
{
    "status": "ok"
}
```

## Replace All Tags for a File

Replace the full tag set for a file.

```http
PUT /api/tags/file
```

### Request

```json
{
    "path": "photos/vacation/beach.jpg",
    "tags": ["vacation", "beach", "sunset"]
}
```

### Response

```json
{
    "status": "ok"
}
```

## Batch File Tag Lookup

Get tags for multiple files in one request.

```http
POST /api/tags/query
```

### Request

```json
{
    "paths": [
        "photos/vacation/beach.jpg",
        "photos/vacation/sunset.jpg"
    ]
}
```

### Response

```json
{
    "photos/vacation/beach.jpg": ["vacation", "beach"],
    "photos/vacation/sunset.jpg": ["vacation", "sunset"]
}
```

## Bulk Add Tag

Add a tag to multiple files at once.

```http
POST /api/tags/bulk
```

### Request

```json
{
    "paths": [
        "photos/vacation/beach.jpg",
        "photos/vacation/sunset.jpg",
        "photos/vacation/hotel.jpg"
    ],
    "tag": "vacation"
}
```

You can also send a `tags` array to apply multiple tags in one request.

### Response

```json
{
    "success": 3,
    "failed": 0,
    "errors": []
}
```

## Bulk Remove Tag

Remove a tag from multiple files at once.

```http
DELETE /api/tags/bulk
```

### Request

```json
{
    "paths": ["photos/vacation/beach.jpg", "photos/vacation/sunset.jpg"],
    "tag": "vacation"
}
```

Like bulk add, this endpoint also accepts a `tags` array.

### Response

```json
{
    "success": 2,
    "failed": 0,
    "errors": []
}
```

## Tag Management Endpoints

### Get All Tags with Counts

Get all tags with usage statistics.

```http
GET /api/tags/stats
```

### Response

```json
[
    {
        "name": "vacation",
        "color": "#3b82f6",
        "count": 42
    },
    {
        "name": "family",
        "color": "",
        "count": 28
    },
    {
        "name": "unused",
        "color": "#10b981",
        "count": 0
    }
]
```

Tags are sorted by count (descending), then name (alphabetically).

### Get Unused Tags

Get all tags that have no file associations.

```http
GET /api/tags/unused
```

### Response

```json
["unused", "orphan", "temp"]
```

### Rename Tag Everywhere

Rename a tag and update all file associations.

```http
PUT /api/tags/{tag}
```

### Parameters

| Parameter | Type   | Location | Description                    |
| --------- | ------ | -------- | ------------------------------ |
| tag       | string | path     | Current tag name (URL-encoded) |

### Request

```json
{
    "newName": "vacation"
}
```

### Response

```json
{
    "status": "ok"
}
```

**Special Cases:**

- If the new name already exists, tags are merged automatically
- Case-only changes are supported (e.g., "animal" → "Animal")
- Same name returns 0 affected files (no-op)

### Delete Tag Everywhere

Delete a tag from all file associations.

```http
DELETE /api/tags/{tag}
```

### Parameters

| Parameter | Type   | Location | Description            |
| --------- | ------ | -------- | ---------------------- |
| tag       | string | path     | Tag name (URL-encoded) |

### Response

```json
{
    "status": "ok"
}
```

## Get Files for a Tag

Return media files associated with a tag.

```http
GET /api/tags/{tag}
```

### Response

```json
{
    "files": [
        {
            "id": 101,
            "name": "beach.jpg",
            "path": "photos/vacation/beach.jpg",
            "parentPath": "photos/vacation",
            "type": "image"
        }
    ]
}
```

For exact schemas and limit details, see the [OpenAPI specification](openapi.md).
