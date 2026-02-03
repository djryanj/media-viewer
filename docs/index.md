# Media Viewer

<div align="center">
  <img src="https://raw.githubusercontent.com/djryanj/media-viewer/main/static/icons/icon-192x192.png" alt="Media Viewer Icon" width="192" height="192">
</div>

<br>

Media Viewer is a self-hosted web application for browsing, organizing, and viewing your personal media collection. It provides a responsive gallery interface that works seamlessly across desktop and mobile devices, with support for images, videos, and playlists.

## Key Features

- **Gallery Browsing**: Navigate your media library with an intuitive grid-based interface
- **Infinite Scroll**: Seamlessly browse large libraries with automatic pagination
- **Tagging System**: Organize media with custom tags for easy categorization and retrieval
- **Favorites**: Mark frequently accessed items for quick access
- **Search**: Full-text fuzzy search by name, tag, or file type with suggestions
- **Playlists**: Create and play video playlists
- **Progressive Web App**: Install on mobile devices for a native app experience
- **Responsive Design**: Optimized for desktop, tablet, and mobile viewing
- **Video Transcoding**: Automatic transcoding for browser compatibility
- **Thumbnail Generation**: Fast thumbnail generation with incremental updates

## Quick Links

- [Installation Guide](getting-started/installation.md) - Get Media Viewer running on your server
- [Quick Start](getting-started/quick-start.md) - Learn the basics in five minutes
- [User Guide](user-guide/overview.md) - Comprehensive usage documentation
- [Admin Guide](admin/overview.md) - Server administration and monitoring
- [Metrics & Monitoring](admin/metrics.md) - Prometheus metrics and performance tuning
- [Keyboard Shortcuts](user-guide/keyboard-shortcuts.md) - Speed up your workflow

## System Requirements

### Production (Docker - Recommended)

- Docker and Docker Compose
- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- Sufficient storage for media files and thumbnail cache

### Production (From Source)

- Go 1.21 or later
- FFmpeg (for video transcoding and thumbnail generation)
- GCC (for SQLite CGO compilation)
- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- Sufficient storage for media files and thumbnail cache

### Development

- All production requirements (from source)
- Node.js 18+ (for frontend tooling: linting, formatting, live reload)
- Make (optional, for build automation)

**Note**: Node.js is **only** required for development. The frontend is static HTML/CSS/JavaScript and does not require a Node.js runtime in production.

## Support

For bug reports and feature requests, visit the [GitHub Issues](https://github.com/djryanj/media-viewer/issues) page.
