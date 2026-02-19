# Testing Guide for Media Viewer Frontend

This guide covers testing practices, setup, and usage for the Media Viewer frontend application.

## Table of Contents

- [Overview](#overview)
- [Testing Stack](#testing-stack)
- [Installation](#installation)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Test Structure](#test-structure)
- [Best Practices](#best-practices)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)

## Overview

The Media Viewer frontend uses a comprehensive testing approach with three types of tests:

1. **Unit Tests** - Test individual functions and modules in isolation
2. **Integration Tests** - Test how multiple modules work together
3. **E2E Tests** - Test complete user workflows in a real browser

## Testing Stack

### Unit & Integration Testing

- **[Vitest](https://vitest.dev/)** - Fast, modern test runner with native ES modules support
- **[happy-dom](https://github.com/capricorn86/happy-dom)** - Lightweight DOM implementation for tests
- **[@testing-library/dom](https://testing-library.com/)** - Utilities for DOM testing
- **[MSW](https://mswjs.io/)** - Mock Service Worker for API mocking

### E2E Testing

- **[Playwright](https://playwright.dev/)** - Cross-browser end-to-end testing
- Multi-browser support (Chromium, Firefox, WebKit)
- Mobile viewport testing
- Visual regression testing

## Installation

The testing dependencies are already included in `package.json`. To install:

```bash
cd static
npm install
```

For Playwright browsers (first time only):

```bash
npx playwright install
```

## Running Tests

### Unit & Integration Tests

```bash
# Run all unit tests once
npm run test:unit

# Run tests in watch mode (re-runs on file changes)
npm run test:unit:watch

# Run tests with UI (interactive browser interface)
npm run test:unit:ui

# Run tests with coverage report
npm run test:unit:coverage
```

### E2E Tests

```bash
# Run all E2E tests (headless)
npm run test:e2e

# Run tests with visible browser
npm run test:e2e:headed

# Run tests with interactive UI
npm run test:e2e:ui

# Run tests in debug mode (step through)
npm run test:e2e:debug

# View last test results
npm run test:e2e:report

# Generate new tests using codegen
npm run test:e2e:codegen
```

### Run All Tests

```bash
npm test
```

## Test Structure

```
static/
├── tests/                      # Unit & Integration tests
│   ├── unit/                   # Unit tests
│   │   ├── app.test.js
│   │   ├── session.test.js
│   │   ├── preferences.test.js
│   │   └── ...
│   ├── integration/            # Integration tests
│   │   ├── gallery.test.js
│   │   ├── search-tags.test.js
│   │   └── ...
│   └── helpers/                # Test utilities
│       ├── setup.js            # Global setup
│       ├── dom-setup.js        # DOM utilities
│       ├── mock-data.js        # Mock data
│       └── test-utils.js       # Helper functions
├── e2e/                        # E2E tests
│   ├── specs/                  # Test specifications
│   │   ├── login.spec.js
│   │   ├── gallery.spec.js
│   │   ├── lightbox-video.spec.js
│   │   ├── tags-favorites.spec.js
│   │   └── ...
│   ├── fixtures/               # Test fixtures and helpers
│   │   └── index.js
│   └── playwright-report/      # Test reports (generated)
├── vitest.config.js            # Vitest configuration
└── playwright.config.js        # Playwright configuration
```

## Writing Tests

### Unit Tests

Unit tests focus on testing individual functions or modules in isolation.

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('MyModule', () => {
    beforeEach(() => {
        // Setup before each test
    });

    it('should do something', () => {
        // Arrange
        const input = 'test';

        // Act
        const result = myFunction(input);

        // Assert
        expect(result).toBe('expected');
    });

    it('should handle errors', () => {
        expect(() => myFunction(null)).toThrow();
    });
});
```

### Integration Tests

Integration tests verify how multiple modules work together.

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { createAppStructure } from '../helpers/dom-setup.js';
import { mockMediaItems } from '../helpers/mock-data.js';

describe('Gallery Integration', () => {
    beforeEach(async () => {
        createAppStructure();
        // Load required modules
        // ...
    });

    it('should render gallery items', () => {
        Gallery.render(mockMediaItems);

        const items = document.querySelectorAll('.gallery-item');
        expect(items.length).toBe(mockMediaItems.length);
    });
});
```

### E2E Tests

E2E tests simulate real user interactions in a browser.

```javascript
import { test, expect } from '../fixtures/index.js';

test.describe('Feature Name', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
    });

    test('should perform user action', async ({ page }) => {
        // Navigate
        await page.goto('/');

        // Interact
        await page.click('.some-button');

        // Assert
        await expect(page.locator('.result')).toBeVisible();
    });
});
```

## Best Practices

### General

1. **Test behavior, not implementation** - Focus on what the code does, not how
2. **Keep tests isolated** - Each test should run independently
3. **Use descriptive test names** - Clearly state what is being tested
4. **Follow AAA pattern** - Arrange, Act, Assert
5. **Don't test external libraries** - Trust that they work

### Unit Tests

- Test pure functions thoroughly
- Mock external dependencies (fetch, localStorage, etc.)
- Test edge cases and error conditions
- Keep tests fast (< 100ms each)

### Integration Tests

- Test common user workflows
- Verify module interactions
- Use realistic mock data
- Test DOM manipulation results

### E2E Tests

- Test critical user paths
- Be resilient to minor UI changes
- Use data attributes for stable selectors
- Run in multiple browsers and viewports
- Keep tests focused (one scenario per test)

## Mock Data and Utilities

### Using Mock Data

```javascript
import { mockMediaItems, mockTags, createMockFetch } from '../helpers/mock-data.js';

// Mock fetch responses
global.fetch = vi.fn(
    createMockFetch({
        '/api/files': mockDirectoryListing,
        '/api/tags': { tags: mockTags },
    })
);
```

### DOM Setup Helpers

```javascript
import { createAppStructure, createGalleryItem, click } from '../helpers/dom-setup.js';

// Create basic app structure
const { gallery, lightbox } = createAppStructure();

// Create and insert a gallery item
const item = createGalleryItem({
    type: 'image',
    name: 'test.jpg',
    path: '/test/test.jpg',
});
gallery.appendChild(item);

// Simulate click
click(item);
```

### Test Utilities

```javascript
import { waitFor, sleep } from '../helpers/test-utils.js';

// Wait for condition
await waitFor(() => element.textContent === 'Done', 3000);

// Simple delay
await sleep(500);
```

## Coverage Reports

View coverage reports after running:

```bash
npm run test:unit:coverage
```

Reports are generated in:

- `static/coverage/index.html` - HTML report (open in browser)
- `static/coverage/lcov.info` - LCOV format (for CI)

### Coverage Thresholds

Current thresholds (configured in `vitest.config.js`):

- Lines: 70%
- Functions: 70%
- Branches: 70%
- Statements: 70%

## Playwright Test Fixtures

We provide custom fixtures for common operations:

```javascript
import { test, expect } from '../fixtures/index.js';

test('example', async ({ page, loginHelpers, galleryHelpers }) => {
    // Login helper
    await loginHelpers.login(page);

    // Gallery helpers
    await galleryHelpers.navigateToPath(page, '/photos');
    const items = galleryHelpers.getItems(page);
    await galleryHelpers.clickItem(page, 'photo.jpg');
});
```

Available fixtures:

- `loginHelpers` - Authentication helpers
- `galleryHelpers` - Gallery navigation
- `lightboxHelpers` - Lightbox operations
- `videoHelpers` - Video player controls

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
    test:
        runs-on: ubuntu-latest

        steps:
            - uses: actions/checkout@v3

            - name: Setup Node.js
              uses: actions/setup-node@v3
              with:
                  node-version: '20'

            - name: Install dependencies
              working-directory: ./static
              run: npm ci

            - name: Run unit tests
              working-directory: ./static
              run: npm run test:unit:coverage

            - name: Install Playwright browsers
              working-directory: ./static
              run: npx playwright install --with-deps

            - name: Run E2E tests
              working-directory: ./static
              run: npm run test:e2e

            - name: Upload test results
              if: always()
              uses: actions/upload-artifact@v3
              with:
                  name: test-results
                  path: static/e2e/test-results/
```

## Troubleshooting

### Tests are slow

- Use `happy-dom` instead of `jsdom` (already configured)
- Mock network requests
- Avoid unnecessary `waitForTimeout` in E2E tests
- Run tests in parallel (Vitest does this by default)

### Flaky E2E tests

- Use Playwright's auto-waiting features
- Avoid hardcoded timeouts
- Use `toBeVisible()` instead of checking DOM directly
- Increase timeout for slow operations: `{ timeout: 10000 }`

### Module loading errors in unit tests

- Ensure modules are evaluated in correct order
- Check that global objects are properly defined
- Use `beforeEach` to reset state

### E2E tests fail in CI but pass locally

- Ensure server is running in CI
- Check viewport sizes match
- Use `--headed` locally to see what's happening
- Check CI logs for errors

### Coverage not including all files

- Check `coverage.include` in `vitest.config.js`
- Ensure files are in correct format (ESM)
- Files must be imported somewhere in tests

## Debugging

### Debug Unit Tests

```bash
# Run with UI for visual debugging
npm run test:unit:ui

# Run specific test file
npx vitest run tests/unit/app.test.js

# Run in watch mode with filter
npx vitest --watch --grep="should initialize"
```

### Debug E2E Tests

```bash
# Debug mode (step through)
npm run test:e2e:debug

# Run specific test file
npx playwright test e2e/specs/login.spec.js

# Run with visible browser
npm run test:e2e:headed

# View trace for failed test
npx playwright show-trace e2e/test-results/.../trace.zip
```

### VS Code Debugging

Add to `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "node",
            "request": "launch",
            "name": "Debug Unit Tests",
            "cwd": "${workspaceFolder}/static",
            "runtimeExecutable": "npm",
            "runtimeArgs": ["run", "test:unit"],
            "console": "integratedTerminal"
        },
        {
            "type": "node",
            "request": "launch",
            "name": "Debug E2E Tests",
            "cwd": "${workspaceFolder}/static",
            "program": "${workspaceFolder}/static/node_modules/@playwright/test/cli.js",
            "args": ["test", "--debug"]
        }
    ]
}
```

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Library Guides](https://testing-library.com/docs/)
- [MSW Documentation](https://mswjs.io/docs/)

## Contributing

When adding new features:

1. Write tests first (TDD approach recommended)
2. Ensure all tests pass before committing
3. Maintain or improve code coverage
4. Add E2E tests for user-facing features
5. Update this documentation if needed

## Questions?

If you have questions about testing:

1. Check existing test examples in the codebase
2. Review this documentation
3. Consult tool documentation (links above)
4. Ask in project discussions/issues
