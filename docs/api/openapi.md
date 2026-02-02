# OpenAPI Specification

Interactive API documentation powered by Swagger UI.

!!! info "Authentication Required"
Most endpoints require authentication. You'll need to authenticate first via the `/api/auth/login` endpoint before testing other endpoints.

## Interactive API Explorer

<swagger-ui src="https://raw.githubusercontent.com/djryanj/media-viewer/main/docs/swagger.json"/>

## Download Specification

Download the OpenAPI specification file:

- [swagger.json](https://raw.githubusercontent.com/djryanj/media-viewer/main/docs/swagger.json) - OpenAPI 3.0 JSON format

## Using the Specification

You can use this specification with various tools:

### Import into Postman

1. Open Postman
2. Click **Import**
3. Select **Link** tab
4. Paste: `https://djryanj.github.io/media-viewer/swagger.json`

### Generate Client SDKs

Use [OpenAPI Generator](https://openapi-generator.tech/) to generate client libraries:

```bash
# JavaScript/TypeScript
openapi-generator-cli generate -i swagger.json -g typescript-axios -o ./client

# Python
openapi-generator-cli generate -i swagger.json -g python -o ./client

# Go
openapi-generator-cli generate -i swagger.json -g go -o ./client
```

### Test with cURL

Each endpoint in the Swagger UI can be tested directly, or you can copy the cURL commands.

Example login request:

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"your-password"}' \
  -c cookies.txt

# Use the session cookie for subsequent requests
curl http://localhost:8080/api/files \
  -b cookies.txt
```
