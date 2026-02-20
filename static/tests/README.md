# Frontend Testing Guide

This directory contains tests for the frontend application.

## Overview

Tests are organized into two categories:

- **Unit Tests** - Test isolated code logic without external dependencies (no backend required)
- **Integration Tests** - Test frontend integration with the real backend APIs (backend required)
- **E2E Tests** - End-to-end browser tests with Playwright (backend required)

## Prerequisites

### For Unit Tests Only

No prerequisites - these tests run in isolation.

### For Integration and E2E Tests

**IMPORTANT**: You must have a running backend server for these tests to pass.

1. Start the backend server:

```bash
# From the project root
make dev

# Or manually with FTS5 support
go run -tags 'fts5' ./cmd/media-viewer
```

2. Install test dependencies (if not already installed):

```bash
cd static
npm install
```

## Running Tests

### All Tests (Unit + Integration + E2E)

```bash
npm test
# Or from project root: make frontend-test
```

### Unit Tests Only (No Backend Required)

```bash
npm run test:unit:only
# Or from project root: make frontend-test-unit
```

### Integration Tests Only (Backend Required)

```bash
npm run test:integration
# Or from project root: make frontend-test-integration
```

### E2E Tests Only (Backend Required)

```bash
npm run test:e2e
# Or from project root: make frontend-test-e2e
```

### Watch Mode (runs tests on file changes)

```bash
npm run test:unit:watch
```

### With Coverage

```bash
npm run test:unit:coverage
# Or from project root: make frontend-test-unit-coverage
```

### Interactive UI

```bash
npm run test:unit:ui
# Or from project root: make frontend-test-unit-ui
```

### Single Test File

```bash
npx vitest run tests/unit/preferences.test.js
npx vitest run tests/integration/session.test.js
```

## Test Structure

### Unit Tests (`tests/unit/`)

Tests for isolated code logic **without external dependencies**:

#### Core Features

- `history.test.js` - Navigation history management (path parsing, state stack)
- `preferences.test.js` - Client-side localStorage operations
- `selection.test.js` - Item selection state management (Set/Map operations)
- `session.test.js` - SessionManager activity tracking with mocks

#### Media Components

- `lightbox.test.js` - Lightbox navigation, zoom logic, swipe gestures
- `playlist.test.js` - Playlist navigation, path parsing, tag rendering
- `video-controls.test.js` - Video control utilities, volume persistence
- `video-player.test.js` - VideoPlayer class, time formatting, control visibility

#### UI Utilities

- `clock.test.js` - Clock display and time formatting (12/24hr)
- `infinite-scroll.test.js` - Gallery pagination logic, cache management
- `infinite-scroll-search.test.js` - Search result pagination
- `settings.test.js` - Settings manager utilities (date/byte formatting, tag filtering/sorting)
- `tag-clipboard.test.js` - Tag clipboard operations, sessionStorage
- `tag-tooltip.test.js` - Tag tooltip utilities, HTML escaping
- `wake-lock.test.js` - Wake Lock API management

**Total: 15 unit test files with 533+ test cases**

**These tests do NOT require the backend to be running.**

### Integration Tests (`tests/integration/`)

Tests that verify frontend integration **with the real backend APIs**:

- `app.test.js` - Core application APIs (health, stats, file listing)
- `favorites.test.js` - Favorites API operations (add, remove, query)
- `gallery.test.js` - File listing and favorites integration
- `search-tags.test.js` - Search and tag management integration
- `session.test.js` - Authentication API (login, logout, checkAuth)

**Total: 5 integration test files with 80+ test cases**

**These tests require the backend to be running at http://localhost:8080.**

## Configuration

### Test Configuration (`tests/test.config.js`)

Central configuration for all tests:

- `BASE_URL` - Backend server URL (default: http://localhost:8080)
- `TEST_USER` - Test credentials (password only)
- `TIMEOUTS` - Various timeout settings
- API endpoint paths

### Environment Variables

Override default settings:

```bash
TEST_BASE_URL=http://localhost:3000 npm run test:unit
```

## API Helpers (`tests/helpers/api-helpers.js`)

Helper functions for making real API calls:

- `login(password)` - Authenticate user
- `logout()` - End session
- `checkAuth()` - Check authentication status
- `listFiles(path)` - Get file listing
- `getAllTags()` - Get all tags
- `addTagToFile(path, tag)` - Add tag
- `ensureAuthenticated()` - Ensure logged in before tests

## Writing Tests

### Basic Test Example

```javascript
import { describe, it, expect, beforeAll } from 'vitest';
import { ensureAuthenticated, listFiles } from '../helpers/api-helpers.js';

describe('My Feature', () => {
    beforeAll(async () => {
        await ensureAuthenticated();
    });

    it('should get files', async () => {
        const result = await listFiles('');

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('files');
    });
});
```

### Best Practices

1. **Always authenticate** - Use `ensureAuthenticated()` in `beforeAll()` for tests that need auth
2. **Clean up** - Remove test data after tests (tags, favorites)
3. **Handle missing data** - Skip tests gracefully if no test files exist
4. **Use real paths** - Work with actual files from the backend
5. **Test idempotency** - Adding same tag twice should be safe

## Test Data

Tests expect some media files to be present in the backend's media directory. Place test files in:

- `sample-media/` directory (or your configured media path)
- At least one image file
- At least one video file
- At least one subdirectory

Sample structure:

```
media/
  ├── test-image.jpg
  ├── test-video.mp4
  └── test-folder/
      └── another-file.jpg
```

## Debugging

### Enable Verbose Logging

```bash
npm run test:unit -- --reporter=verbose
```

### Run in Watch Mode with UI

```bash
npm run test:unit:ui
```

### Debug Single Test

```bash
npx vitest run tests/unit/session.test.js --reporter=verbose
```

### Check Backend Connectivity

```bash
curl http://localhost:8080/health
```

## Common Issues

### "Connection refused" Errors

- **Cause**: Backend server not running
- **Solution**: Start the backend server with `go run -tags 'fts5' ./cmd/media-viewer`

### "401 Unauthorized" Errors

- **Cause**: Authentication failed or session expired
- **Solution**: Check TEST_USER credentials match backend password

### "No files available" Messages

- **Cause**: Media directory is empty
- **Solution**: Add some test files to your media directory

### Tests Pass Locally but Fail in CI

- **Cause**: Backend not started in CI, or different BASE_URL
- **Solution**: Ensure CI starts backend and sets TEST_BASE_URL

## VS Code Integration

1. Install "Vitest" extension
2. Tests will appear in the Test Explorer
3. Run/debug tests directly from editor
4. View coverage inline in source files

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
- name: Start Backend
  run: |
      go run -tags 'fts5' ./cmd/media-viewer &
      sleep 5  # Wait for server to start

- name: Run Frontend Tests
  working-directory: ./static
  run: |
      npm install
      npm run test:unit
```

## Coverage

Coverage reports are generated in:

- `static/coverage/` - Detailed HTML report
- Open `static/coverage/index.html` in browser

Target coverage thresholds (configured in vitest.config.js):

- Lines: 70%
- Functions: 70%
- Branches: 70%
- Statements: 70%

## Related Documentation

- [E2E Testing Guide](../e2e/README.md) - End-to-end browser tests
- [Main Testing Docs](../../TESTING.md) - Complete testing documentation
- [Vitest Documentation](https://vitest.dev/) - Test runner docs
