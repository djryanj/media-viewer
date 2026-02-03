# Environment Variables

Complete reference for all environment variables supported by Media Viewer.

## Authentication

### PASSWORD

All users share this single password. Choose a strong, unique password.

### SESSION_DURATION

Session timeout in milliseconds.

```bash
SESSION_DURATION=3600000
```

- Default: `3600000` (1 hour)
- Minimum recommended: `300000` (5 minutes)
- Maximum recommended: `86400000` (24 hours)

Users must re-authenticate after this period of inactivity. Active usage resets the timer.

## Paths

### MEDIA_PATH

Path to the media directory inside the container.

```bash
MEDIA_PATH=/media
```

- Default: `/media`
- Should match your volume mount

### DATA_PATH

Path where application data is stored.

```bash
DATA_PATH=/app/data
```

- Default: `/app/data`
- Must be writable
- Should be persisted via volume mount

## Network

### PORT

Port the application listens on.

```bash
PORT=8080
```

- Default: `8080`
- Change if running multiple instances or if port conflicts exist

## Example Configurations

### Standard

```bash
SESSION_DURATION=5m
```

### Custom Paths

```bash
MEDIA_PATH=/data/photos
DATA_PATH=/var/lib/media-viewer
PORT=3000
```

### Docker Compose

```yaml
environment:
    - SESSION_DURATION=5m
    - MEDIA_PATH=/media
    - DATA_PATH=/app/data
    - PORT=8080
```

Using environment file:

```yaml
env_file:
    - .env
```

`.env` file:

```bash
SESSION_DURATION=5m
```
