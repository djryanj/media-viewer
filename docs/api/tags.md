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
