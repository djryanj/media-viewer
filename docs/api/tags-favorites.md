# Tags & Favorites API

Endpoints for managing tags and favorite files.

## API Reference

See the [OpenAPI Specification](openapi.md) for interactive documentation:

**Tags:**

- `GET /api/tags` - List all tags
- `GET /api/tags/file` - Get file tags
- `POST /api/tags/file` - Add tag to file
- `DELETE /api/tags/file` - Remove tag from file
- `POST /api/tags/file/set` - Set all tags for file
- `POST /api/tags/batch` - Get tags for multiple files
- `POST /api/tags/bulk` - Add tag to multiple files
- `DELETE /api/tags/bulk` - Remove tag from multiple files
- `GET /api/tags/{tag}` - Get files with tag
- `DELETE /api/tags/{tag}` - Delete tag globally
- `PUT /api/tags/{tag}` - Rename tag globally

**Favorites:**

- `GET /api/favorites` - List favorites
- `POST /api/favorites` - Add favorite
- `DELETE /api/favorites` - Remove favorite
- `POST /api/favorites/bulk` - Add multiple favorites
- `DELETE /api/favorites/bulk` - Remove multiple favorites
- `GET /api/favorites/check` - Check if favorited

Refer to the OpenAPI documentation for detailed request/response schemas and examples.
