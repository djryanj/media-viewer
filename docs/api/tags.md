# Tags API

Endpoints for managing tags on media files.

## List All Tags

Get all tags in the library with usage counts.

```
GET /api/tags
```

### Response

```json
[
    {
        "name": "vacation",
        "itemCount": 42
    },
    {
        "name": "family",
        "itemCount": 128
    }
]
```

## Get File Tags

Get tags assigned to a specific file.

```
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

```
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

**Success (200):**

```json
{
    "success": true
}
```

## Remove Tag from File

Remove a tag from a single file.

```
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

**Success (200):**

```json
{
    "success": true
}
```

## Bulk Add Tag

Add a tag to multiple files at once.

```
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

### Response

```json
{
    "success": 3,
    "failed": 0
}
```

## Bulk Remove Tag

Remove a tag from multiple files at once.

```
DELETE /api/tags/bulk
```

### Request

```json
{
    "paths": ["photos/vacation/beach.jpg", "photos/vacation/sunset.jpg"],
    "tag": "vacation"
}
```

### Response

```json
{
    "success": 2,
    "failed": 0
}
```

## Tag Management Endpoints

### Get All Tags with Counts

Get all tags with usage statistics.

```
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

```
GET /api/tags/unused
```

### Response

```json
["unused", "orphan", "temp"]
```

### Rename Tag Everywhere

Rename a tag and update all file associations.

```
POST /api/tags/{tag}/rename
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
    "status": "ok",
    "affectedFiles": 42,
    "oldName": "vacaton",
    "newName": "vacation"
}
```

**Special Cases:**

- If the new name already exists, tags are merged automatically
- Case-only changes are supported (e.g., "animal" → "Animal")
- Same name returns 0 affected files (no-op)

### Delete Tag Everywhere

Delete a tag from all file associations.

```
DELETE /api/tags/{tag}/delete
```

### Parameters

| Parameter | Type   | Location | Description            |
| --------- | ------ | -------- | ---------------------- |
| tag       | string | path     | Tag name (URL-encoded) |

### Response

```json
{
    "status": "ok",
    "affectedFiles": 42,
    "tagName": "vacation"
}
```

The tag and all its file associations are removed in a single transaction.
