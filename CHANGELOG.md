# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial media browsing with folder navigation
- Thumbnail generation for images and videos
- Video transcoding for browser compatibility
- Full-text search with FTS5
- Tag management system
- Favorites system
- User authentication with sessions
- Docker container support
- Automatic media library indexing
- Real-time file system watching
- Playlist support (WPL format)
- Responsive web interface

### Security
- Secure password hashing with bcrypt
- Session-based authentication
- Path validation to prevent directory traversal

## How to Release

1. Update this CHANGELOG with the new version and date
2. Create a git tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
3. Push the tag: `git push origin v1.0.0`
4. GitHub Actions will automatically build and publish Docker images

[Unreleased]: https://github.com/djryanj/media-viewer/compare/v1.0.0...HEAD
