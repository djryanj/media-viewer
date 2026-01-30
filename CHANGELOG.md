# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

# Changelog

## [Unreleased] - 2026-01-30

### Changed

#### Authentication System

- **Simplified to password-only authentication**: Removed username requirement for single-user application
    - Login now requires only a password
    - Initial setup creates a password without username
    - Session management remains token-based with 7-day expiration

#### Database Schema

- Removed `username` column from `users` table
- Updated all authentication queries to work with single-user model
- **Breaking Change**: Existing databases must be deleted and recreated

#### API Changes

- `POST /api/auth/login` - Now accepts `{ "password": "..." }` instead of `{ "username": "...", "password": "..." }`
- `POST /api/auth/setup` - Now accepts `{ "password": "..." }` instead of `{ "username": "...", "password": "..." }`
- `GET /api/auth/check` - Response `username` field now returns empty string
- `PUT /api/auth/password` - **New endpoint** for changing password (requires current password verification)

#### User Interface

##### Header

- Removed username display from header
- Added password change button (🔑) alongside existing cache clear and logout buttons
- Added password change modal with current password verification

##### Mobile Gallery (Breaking Visual Change)

- Redesigned gallery layout for mobile devices:
    - Compact 3-column grid with 2px gaps (was larger cards with more spacing)
    - Square aspect ratio thumbnails using `object-fit: cover`
    - Filename and tags now appear in gradient overlay at bottom of thumbnail
    - File size hidden on mobile (visible on desktop only)
    - 4 columns at 480px+, 5 columns at 600px+
- Desktop (900px+) retains card-style layout with info below thumbnail

##### Search Suggestions

- Added thumbnail previews to search dropdown suggestions
- Thumbnails load lazily with fallback to icons on error
- Responsive thumbnail sizes: 40px mobile, 48px tablet, 56px desktop

#### Frontend Architecture

- Renamed global `App` object to `MediaApp` to avoid conflict with built-in globals
- Updated all JavaScript files to reference `MediaApp` instead of `App`
- Added proper ESLint global declarations

#### CLI Tool (`usermgmt`)

- Simplified to two commands:
    - `reset` - Reset the password
    - `status` - Check if password is configured
- Removed `create`, `list`, `delete` commands (not needed for single-user)

### Fixed

- Fixed redirect loop on login caused by missing HTML element IDs
- Fixed element ID mismatches between HTML and JavaScript:
    - `search-close` → `search-results-close`
    - `ctx-favorite` → `ctx-add-favorite`
    - `ctx-unfavorite` → `ctx-remove-favorite`
    - `tag-modal-file` → `tag-modal-path`
    - `tag-add-btn` → `add-tag-btn`
    - `player-title` → `playlist-title`
    - `player-video` → `playlist-video`
    - `player-prev` → `prev-video`
    - `player-next` → `next-video`
- Added missing `history.js` script include

### Removed

- Username field from login and setup forms
- Username display in application header
- `GetUserByUsername()` database function
- `DeleteUser()` database function
- `DeleteUserSessions()` database function (replaced with `DeleteAllSessions()`)
- `ValidateUser()` database function (replaced with `ValidatePassword()`)

### Security

- Password changes require verification of current password
- All sessions invalidated when password is changed
- Maintained secure session token hashing (SHA-256)
- Maintained bcrypt password hashing

---

## Migration Guide

### For Existing Installations

1. **Backup any important data** (favorites, tags) if needed

2. **Delete the existing database**:

    ```bash
    rm /database/media.db
    ```

3. **Update all application files** (Go backend, JavaScript frontend, HTML, CSS)

4. **Rebuild the Go application**:

    ```bash
    go build -o media-viewer .
    go build -o resetpw ./cmd/resetpw
    ```

5. **Restart the application**

6. **Complete initial setup** by creating a new password when prompted

### API Migration

If you have external integrations calling the authentication API:

**Before:**

```json
POST /api/auth/login
{
  "username": "admin",
  "password": "secret123"
}
```

**After:**

```json
POST /api/auth/login
{
  "password": "secret123"
}
```

### Password Management

To reset a forgotten password using the CLI tool:

```bash
./resetpw reset
```

To check if a password is configured:

```bash
./resetpw status
```

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
