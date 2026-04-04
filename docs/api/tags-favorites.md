# Tags & Favorites API

Cross-reference page for the tag and favorites endpoints used by the gallery and selection workflows.

## Tags

Primary tags endpoints:

- `GET /api/tags`
- `GET /api/tags/stats`
- `GET /api/tags/unused`
- `GET /api/tags/file`
- `POST /api/tags/file`
- `DELETE /api/tags/file`
- `PUT /api/tags/file`
- `POST /api/tags/query`
- `POST /api/tags/suggestions`
- `POST /api/tags/bulk`
- `DELETE /api/tags/bulk`
- `GET /api/tags/{tag}`
- `DELETE /api/tags/{tag}`
- `PUT /api/tags/{tag}`

See [tags.md](tags.md) for request bodies and examples.

## Favorites

- `GET /api/favorites`
- `POST /api/favorites`
- `DELETE /api/favorites`
- `POST /api/favorites/bulk`
- `DELETE /api/favorites/bulk`
- `PUT /api/favorites/order`

See [favorites.md](favorites.md) for request bodies and examples.

## How They Fit Together

- Tags are reusable labels that can span the whole library.
- Favorites are a quick-access ordered strip for frequently revisited items.
- Both surfaces are used by the frontend selection and gallery tools and expose JSON APIs intended for direct client use.

For exact schemas, see the [OpenAPI specification](openapi.md).
