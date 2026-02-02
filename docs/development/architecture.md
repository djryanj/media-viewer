# Architecture

This document describes the technical architecture of Media Viewer.

## Overview

Media Viewer is a client-server application with:

- **Frontend**: Single-page application (SPA) using vanilla JavaScript
- **Backend**: Node.js server with Express
- **Database**: SQLite for metadata storage
- **Storage**: File system for media and thumbnails

## Frontend Architecture

### Module Structure

The frontend is organized into independent modules:

| Module         | File                 | Purpose                            |
| -------------- | -------------------- | ---------------------------------- |
| MediaApp       | `app.js`             | Main application controller        |
| Gallery        | `gallery.js`         | Gallery rendering and interactions |
| Lightbox       | `lightbox.js`        | Full-screen media viewer           |
| Search         | `search.js`          | Search functionality               |
| Tags           | `tags.js`            | Tag management                     |
| Favorites      | `favorites.js`       | Favorites management               |
| ItemSelection  | `selection.js`       | Multi-select mode                  |
| TagClipboard   | `tag-clipboard.js`   | Tag copy/paste                     |
| Player         | `player.js`          | Playlist player                    |
| HistoryManager | `history.js`         | Browser history management         |
| InfiniteScroll | `infinite-scroll.js` | Pagination handling                |

### State Management

Application state is managed in `MediaApp.state`:

```javascript
{
  currentPath: '',      // Current directory
  listing: null,        // Current directory listing
  mediaFiles: [],       // Media files for lightbox
  currentSort: { field: 'name', order: 'asc' },
  currentFilter: '',
  currentPage: 1,
  pageSize: 100
}
```

### Event Flow

1. User interaction triggers event handler
2. Handler updates state and/or calls API
3. API response updates state
4. UI re-renders affected components

### History Management

Browser history is managed for:

- Directory navigation (URL changes)
- Overlay states (lightbox, modals)

The `HistoryManager` module handles back/forward navigation and escape key behavior.

## Backend Architecture

### Server Structure

```
src/
├── server.js         # Express server setup
├── routes/           # API route handlers
├── services/         # Business logic
├── database/         # Database operations
└── utils/            # Utility functions
```

### API Design

RESTful API with JSON responses:

- `GET` for retrieval
- `POST` for creation
- `PUT` for updates
- `DELETE` for removal

### Authentication

Session-based authentication:

1. User submits password
2. Server validates and creates session
3. Session ID stored in cookie
4. Subsequent requests include cookie
5. Server validates session on each request

### File Handling

Media files are served with:

- Range request support (video seeking)
- Appropriate MIME types
- Caching headers

Thumbnails are:

- Generated on-demand
- Cached to disk
- Served with long cache headers

## Database Schema

### Files Table

Stores indexed file metadata:

| Column   | Type    | Description       |
| -------- | ------- | ----------------- |
| path     | TEXT    | Unique file path  |
| name     | TEXT    | File name         |
| type     | TEXT    | File type         |
| size     | INTEGER | File size         |
| modified | TEXT    | Modification date |

### Tags Table

Stores tag definitions:

| Column | Type    | Description |
| ------ | ------- | ----------- |
| id     | INTEGER | Primary key |
| name   | TEXT    | Tag name    |

### File Tags Table

Associates files with tags:

| Column    | Type    | Description |
| --------- | ------- | ----------- |
| file_path | TEXT    | File path   |
| tag_id    | INTEGER | Tag ID      |

### Favorites Table

Stores favorite items:

| Column   | Type | Description |
| -------- | ---- | ----------- |
| path     | TEXT | Item path   |
| name     | TEXT | Item name   |
| type     | TEXT | Item type   |
| added_at | TEXT | Timestamp   |

## Performance Considerations

### Frontend

- Infinite scroll reduces initial load
- Thumbnail lazy loading
- Batched DOM updates in selection mode
- Service worker caching

### Backend

- SQLite indexes on frequently queried columns
- Thumbnail caching
- Efficient file system operations

### Caching Strategy

| Resource      | Cache Duration | Strategy          |
| ------------- | -------------- | ----------------- |
| Static assets | Long           | Service worker    |
| Thumbnails    | Long           | Disk + HTTP cache |
| API responses | None           | Fresh data        |
