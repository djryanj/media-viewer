# Collections API

Endpoints for creating, browsing, updating, and ordering collections of media items.

Collections are ordered, folder-scoped groups of media. They are intended for curated image and video sets such as albums, review lists, or shortlists.

## Collection Rules

- Collection names are trimmed before validation and must not be empty.
- Collection names are unique case-insensitively.
- A collection is scoped to a single folder. Once a collection has a folder scope, items from another folder cannot be added.
- Empty collections may be created up front by providing only a name, or by providing a name plus an explicit `folderPath`.
- Create and add-item requests accept up to 500 paths per request.
- Membership lookups accept up to 1000 paths per request.

## List Collections

Return all collections with summary metadata.

```http
GET /api/collections
```

### Response

```json
[
    {
        "id": 12,
        "name": "Trip shortlist",
        "folderPath": "photos/2025/trip",
        "coverPath": "photos/2025/trip/day1/beach.jpg",
        "itemCount": 3,
        "createdAt": "2026-04-03T18:11:04Z",
        "updatedAt": "2026-04-03T18:25:19Z"
    }
]
```

## Create Collection

Create a new collection, optionally with initial items.

```http
POST /api/collections
```

### Request

```json
{
    "name": "Trip shortlist",
    "paths": ["photos/2025/trip/day1/beach.jpg", "photos/2025/trip/day1/sunset.jpg"],
    "folderPath": "photos/2025/trip"
}
```

### Fields

| Field        | Type            | Required | Description                                                        |
| ------------ | --------------- | -------- | ------------------------------------------------------------------ |
| `name`       | string          | Yes      | Collection name. Leading and trailing whitespace is trimmed.       |
| `paths`      | array of string | No       | Initial ordered item paths. Duplicate and empty paths are ignored. |
| `folderPath` | string or null  | No       | Explicit folder scope for an empty or newly created collection.    |

### Response

**Created (201):**

```json
{
    "id": 12,
    "name": "Trip shortlist",
    "folderPath": "photos/2025/trip",
    "coverPath": "photos/2025/trip/day1/beach.jpg",
    "itemCount": 2,
    "createdAt": "2026-04-03T18:11:04Z",
    "updatedAt": "2026-04-03T18:11:04Z"
}
```

**Invalid Request (400):**

Plain-text errors are returned for malformed JSON or missing name, for example:

```text
Name is required
```

**Conflict (409):**

```json
{
    "error": "Collection name is already in use. Choose a different name."
}
```

or

```json
{
    "error": "Collections can't span multiple folders."
}
```

## Get Collection Detail

Return a single collection together with its ordered items.

```http
GET /api/collections/{id}
```

### Parameters

| Parameter | Type  | Location | Description   |
| --------- | ----- | -------- | ------------- |
| `id`      | int64 | path     | Collection ID |

### Response

```json
{
    "id": 12,
    "name": "Trip shortlist",
    "folderPath": "photos/2025/trip",
    "coverPath": "photos/2025/trip/day1/beach.jpg",
    "itemCount": 2,
    "createdAt": "2026-04-03T18:11:04Z",
    "updatedAt": "2026-04-03T18:25:19Z",
    "items": [
        {
            "path": "photos/2025/trip/day1/beach.jpg",
            "name": "beach.jpg",
            "type": "image",
            "parentPath": "photos/2025/trip/day1"
        },
        {
            "path": "photos/2025/trip/day1/sunset.jpg",
            "name": "sunset.jpg",
            "type": "image",
            "parentPath": "photos/2025/trip/day1"
        }
    ]
}
```

**Not Found (404):**

```text
Collection not found
```

## Update Collection

Rename a collection and optionally update its cover image.

```http
PUT /api/collections/{id}
```

### Request

```json
{
    "name": "Trip final selects",
    "coverPath": "photos/2025/trip/day1/sunset.jpg"
}
```

### Response

```json
{
    "status": "ok"
}
```

### Notes

- `name` is required.
- `coverPath` may be omitted or set to an empty string to leave the cover unchanged.
- Duplicate names return a JSON `409 Conflict` response.

## Delete Collection

Delete a collection and its membership records.

```http
DELETE /api/collections/{id}
```

### Response

```json
{
    "status": "ok"
}
```

Deleting a collection does not delete the underlying media files.

## Add Items to a Collection

Append one or more items to an existing collection.

```http
POST /api/collections/{id}/items
```

### Request

```json
{
    "paths": ["photos/2025/trip/day1/beach.jpg", "photos/2025/trip/day1/sunset.jpg"]
}
```

### Response

```json
{
    "status": "ok"
}
```

### Notes

- `paths` is required and must not be empty.
- Duplicate and empty paths are ignored.
- If the collection has no cover yet, the first added path becomes the cover.
- Adding items from another folder returns a JSON `409 Conflict` response.

## Remove Items from a Collection

Remove one or more items from an existing collection.

```http
DELETE /api/collections/{id}/items
```

### Request

```json
{
    "paths": ["photos/2025/trip/day1/beach.jpg", "photos/2025/trip/day1/sunset.jpg"]
}
```

### Response

```json
{
    "status": "ok"
}
```

### Notes

- Removal is transactional.
- If the current cover is removed, the next item in collection order becomes the new cover.
- If the collection becomes empty, the cover is cleared.

## Reorder Collection Items

Replace the stored order for a collection.

```http
PUT /api/collections/{id}/order
```

### Request

```json
{
    "paths": ["photos/2025/trip/day1/sunset.jpg", "photos/2025/trip/day1/beach.jpg"]
}
```

### Response

```json
{
    "status": "ok"
}
```

### Notes

- `paths` is required and must not be empty.
- The order you send becomes the display order for the collection.
- The first path in the list becomes the collection cover.

## Batch Membership Lookup

Return collection membership IDs for a set of file paths. The frontend uses this to apply collection state efficiently in the gallery.

```http
POST /api/collections/memberships
```

### Request

```json
{
    "paths": ["photos/2025/trip/day1/beach.jpg", "photos/2025/trip/day1/sunset.jpg"]
}
```

### Response

```json
{
    "photos/2025/trip/day1/beach.jpg": [12, 15],
    "photos/2025/trip/day1/sunset.jpg": [12]
}
```

## Error Behavior

Collections endpoints currently use a mix of plain-text and JSON error responses:

- Validation errors such as malformed JSON, missing `name`, missing `paths`, or invalid collection IDs return plain-text `400` errors.
- Folder-scope conflicts and duplicate-name conflicts return JSON `409` responses with an `error` field.
- Successful mutation endpoints return a JSON status envelope:

```json
{
    "status": "ok"
}
```

For the exact schema surface, see the [OpenAPI specification](openapi.md).
