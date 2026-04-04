# Search API

Full-text search and suggestions endpoints.

## Search Media

Search indexed media by name and related indexed fields.

```http
GET /api/search
```

### Query Parameters

| Parameter  | Type    | Default | Description |
| ---------- | ------- | ------- | ----------- |
| `q`        | string  | none    | Search query. If empty, the API returns an empty result set. |
| `page`     | integer | `1`     | Page number. Invalid or non-positive values fall back to `1`. |
| `pageSize` | integer | `100`   | Results per page. Invalid or non-positive values fall back to `100`. |
| `type`     | string  | `""`    | Optional filter: `image`, `video`, `folder`, or `playlist`. |

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
	"query": "beach",
	"totalItems": 1,
	"page": 1,
	"pageSize": 100,
	"totalPages": 1
}
```

### Notes

- Empty queries return an empty `items` array instead of an error.
- On backend search failures, the handler degrades gracefully and still returns an empty result object.

## Search Suggestions

Return autocomplete suggestions for a search query.

```http
GET /api/search/suggestions
```

### Query Parameters

| Parameter | Type    | Default | Description |
| --------- | ------- | ------- | ----------- |
| `q`       | string  | none    | Partial search text. |
| `limit`   | integer | `10`    | Maximum suggestions. Invalid or non-positive values fall back to `10`. |

### Response

```json
[
	{
		"path": "photos/vacation/beach.jpg",
		"name": "beach.jpg",
		"type": "image",
		"highlight": "beach"
	}
]
```

For exact schemas and edge cases, see the [OpenAPI specification](openapi.md).
