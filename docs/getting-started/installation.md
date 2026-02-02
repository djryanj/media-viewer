# Installation

Media Viewer can be deployed using Docker (recommended) or run directly with Node.js.

## Docker Installation

Docker is the recommended installation method as it handles all dependencies automatically.

### Using Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
    media-viewer:
        image: djryanj/media-viewer:latest
        container_name: media-viewer
        ports:
            - '8080:8080'
        volumes:
            - /path/to/your/media:/media:ro
            - media-viewer-data:/app/data
        environment:
            - PASSWORD=your-secure-password
            - SESSION_DURATION=3600000
        restart: unless-stopped

volumes:
    media-viewer-data:
```

Start the application:

```bash
docker-compose up -d
```

### Using Docker Run

```bash
docker run -d \
  --name media-viewer \
  -p 8080:8080 \
  -v /path/to/your/media:/media:ro \
  -v media-viewer-data:/app/data \
  -e PASSWORD=your-secure-password \
  djryanj/media-viewer:latest
```

## Manual Installation

For development or non-Docker deployments:

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Steps

1. Clone the repository:

    ```bash
    git clone https://github.com/djryanj/media-viewer.git
    cd media-viewer
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Configure environment variables (see [Configuration](configuration.md))

4. Start the server:

    ```bash
    npm start
    ```

## Verifying Installation

Once running, access Media Viewer at `http://localhost:8080` (or your configured port). You should see the login page.

## Next Steps

- [Configure your installation](configuration.md)
- [Follow the Quick Start guide](quick-start.md)
