# Favorites API

Endpoints for managing favorite items.

## List Favorites

Get all favorited items.

```
GET /api/favorites
```

### Response

```json
[
    {
        "path": "photos/vacation/beach.jpg",
        "name": "beach.jpg",
        "type": "image",
        "addedAt": "2024-07-15T10:30:00Z"
    },
    {
        "path": "videos/highlights",
        "name": "highlights",
        "type": "folder",
        "addedAt": "2024-07-14T08:00:00Z"
    }
]
```

## Add Favorite

Add an item to favorites.

```
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

**Success (200):**

```json
{
    "success": true
}
```

**Already Exists (200):**

```json
{
    "success": true,
    "message": "Already a favorite"
}
```

## Remove Favorite

Remove an item from favorites.

```
DELETE /api/favorites
```

### Request

```json
{
    "path": "photos/vacation/beach.jpg"
}
```

### Response

**Success (200):**

```json
{
    "success": true
}
```

## Bulk Add Favorites

Add multiple items to favorites at once.

```
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
    "failed": 0
}
```
