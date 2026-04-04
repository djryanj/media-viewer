# Favorites API

Endpoints for managing favorite items.

## List Favorites

Get all favorited items.

```http
GET /api/favorites
```

### Response

```json
[
    {
        "id": 5,
        "path": "photos/vacation/beach.jpg",
        "name": "beach.jpg",
        "type": "image",
        "parentPath": "photos/vacation",
        "createdAt": "2026-04-03T18:25:19Z"
    },
    {
        "path": "videos/highlights",
        "name": "highlights",
        "type": "folder"
    }
]
```

## Add Favorite

Add an item to favorites.

```http
POST /api/favorites
```

### Request

```json
{
    "path": "photos/vacation/beach.jpg",
    "name": "beach.jpg",
    "type": "image"
}
```

### Response

```json
{
    "status": "ok"
}
```

## Remove Favorite

Remove an item from favorites.

```http
DELETE /api/favorites
```

### Request

```json
{
    "path": "photos/vacation/beach.jpg"
}
```

### Response

```json
{
    "status": "ok"
}
```

## Bulk Add Favorites

Add multiple items to favorites at once.

```http
POST /api/favorites/bulk
```

### Request

```json
{
    "items": [
        {
            "path": "photos/vacation/beach.jpg",
            "name": "beach.jpg",
            "type": "image"
        },
        {
            "path": "photos/vacation/sunset.jpg",
            "name": "sunset.jpg",
            "type": "image"
        }
    ]
}
```

### Response

```json
{
    "success": 2,
    "failed": 0,
    "errors": []
}
```

### Notes

- Up to 100 items are processed per request.
- Empty paths are ignored.
- Error lists are truncated to avoid oversized responses.

## Bulk Remove Favorites

Remove multiple favorites at once.

```http
DELETE /api/favorites/bulk
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
    "success": 2,
    "failed": 0,
    "errors": []
}
```

## Reorder Favorites

Replace the display order of the favorites strip.

```http
PUT /api/favorites/order
```

### Request

```json
{
    "paths": [
        "photos/vacation/sunset.jpg",
        "photos/vacation/beach.jpg"
    ]
}
```

### Response

```json
{
    "status": "ok"
}
```

For exact request and response schemas, see the [OpenAPI specification](openapi.md).
