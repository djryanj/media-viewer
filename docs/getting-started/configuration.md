# Configuration

Media Viewer is configured through environment variables. This page documents all available options.

## Optional Settings

### SESSION_DURATION

Duration of user sessions in milliseconds. Users will need to re-authenticate after this period of inactivity.

```bash
SESSION_DURATION=3600000  # 1 hour (default)
```

Common values:

| Duration   | Value    |
| ---------- | -------- |
| 30 minutes | 1800000  |
| 1 hour     | 3600000  |
| 4 hours    | 14400000 |
| 24 hours   | 86400000 |

### MEDIA_PATH

Path to your media directory inside the container. Defaults to `/media`.

```bash
MEDIA_PATH=/media
```

### PORT

Port the application listens on. Defaults to `8080`.

```bash
PORT=8080
```

### DATA_PATH

Path where application data (database, thumbnails) is stored. Defaults to `/app/data`.

```bash
DATA_PATH=/app/data
```

## Volume Mounts

### Media Directory

Mount your media library as read-only for security:

```bash
-v /path/to/media:/media:ro
```

### Data Directory

Persist application data (thumbnails, database) between container restarts:

```bash
-v media-viewer-data:/app/data
```

## Example Configurations

### Minimal Configuration

```yaml
services:
    media-viewer:
        image: djryanj/media-viewer:latest
        ports:
            - '8080:8080'
        volumes:
            - /photos:/media:ro
            - data:/app/data
        environment:
            - PASSWORD=changeme
```

### Production Configuration

```yaml
services:
    media-viewer:
        image: djryanj/media-viewer:latest
        ports:
            - '8080:8080'
        volumes:
            - /mnt/storage/media:/media:ro
            - /var/lib/media-viewer:/app/data
        environment:
            - PASSWORD=${MEDIA_VIEWER_PASSWORD}
            - SESSION_DURATION=14400000
        restart: unless-stopped
        healthcheck:
            test: ['CMD', 'curl', '-f', 'http://localhost:8080/health']
            interval: 30s
            timeout: 10s
            retries: 3
```

## Reverse Proxy Setup

When running behind a reverse proxy (nginx, Traefik, Caddy), ensure WebSocket connections are properly forwarded for optimal performance.

### Nginx Example

```nginx
location / {
    proxy_pass http://localhost:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
