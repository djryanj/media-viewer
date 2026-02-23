# End-to-End Tests

This directory contains E2E tests using Playwright for testing complete user workflows in real browsers.

## Quick Start

```bash
# Install Playwright browsers (first time only)
npx playwright install

# Run all E2E tests
npm run test:e2e

# Run with visible browser
npm run test:e2e:headed

# Run with interactive UI
npm run test:e2e:ui

# Debug tests
npm run test:e2e:debug

# Run specific module by tag
npx playwright test --grep @gallery
npx playwright test --grep @search
npx playwright test --grep @video

# Run specific spec file
npx playwright test specs/core/auth.spec.js
npx playwright test specs/ui/gallery.spec.js
```

## Directory Structure

```
e2e/
├── specs/                          # Test specifications (organized by type)
│   ├── core/                       # Core functionality tests
│   │   └── auth.spec.js           # Authentication & session (@auth @core @session)
│   ├── features/                   # Feature module tests
│   │   └── tags-favorites.spec.js # Tags & favorites (@tags @favorites @features)
│   ├── ui/                         # UI component tests
│   │   ├── gallery.spec.js        # Gallery navigation (@gallery @ui @navigation)
│   │   └── lightbox-video.spec.js # Media viewing (@lightbox @video @ui @player)
│   └── workflows/                  # Full user journey tests (coming soon)
├── fixtures/                       # Custom test fixtures and helpers
│   └── index.js                   # Shared fixtures (loginHelpers, galleryHelpers, etc.)
├── playwright-report/              # HTML test reports (generated)
└── test-results/                   # Test artifacts (screenshots, videos, traces)
```

### Test Tags

Tests are organized with tags for easy filtering:

**Core Tags:**

- `@auth` - Authentication tests
- `@core` - Core functionality
- `@session` - Session management

**UI Tags:**

- `@ui` - UI component tests
- `@gallery` - Gallery functionality
- `@lightbox` - Lightbox viewer
- `@video` - Video player
- `@navigation` - Navigation features
- `@responsive` - Responsive behavior
- `@mobile` - Mobile-specific tests

**Feature Tags:**

- `@features` - Feature modules
- `@tags` - Tagging functionality
- `@favorites` - Favorites management
- `@search` - Search features
- `@settings` - Settings management
- `@playlist` - Playlist features

**Interaction Tags:**

- `@keyboard` - Keyboard interactions
- `@touch` - Touch gestures
- `@accessibility` - Accessibility features

## Writing Tests

Create tests in the appropriate `specs/` subdirectory:

- `specs/core/` - Authentication, session, core functionality
- `specs/features/` - Feature modules (search, tags, settings, etc.)
- `specs/ui/` - UI components (gallery, lightbox, video player, etc.)
- `specs/workflows/` - Complete user journeys

Add appropriate tags to `test.describe()` blocks:

```javascript
import { test, expect } from '../../fixtures/index.js';

test.describe('Feature Name @feature @tag1 @tag2', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
    });

    test('should do something', async ({ page }) => {
        await page.goto('/');
        await page.click('.button');
        await expect(page.locator('.result')).toBeVisible();
    });
});
```

### Tag Guidelines

- Add module tag (e.g., `@search`, `@gallery`)
- Add category tag (e.g., `@ui`, `@features`, `@core`)
- Add interaction tags if relevant (e.g., `@keyboard`, `@mobile`)
- Use tags to enable filtering and selective test runs

## Available Fixtures

Custom fixtures provided in `fixtures/index.js`:

- `loginHelpers` - Login, logout, session management
- `galleryHelpers` - Gallery navigation and item interaction
- `lightboxHelpers` - Lightbox controls and navigation
- `videoHelpers` - Video player controls

## Test Reports

After running tests, view the report:

```bash
npm run test:e2e:report
```

Reports include:

- Test results and timing
- Screenshots on failure
- Videos of failed tests
- Execution traces for debugging

## Running Specific Tests

### By Tag

```bash
# Run all gallery tests
npx playwright test --grep @gallery

# Run all mobile tests
npx playwright test --grep @mobile

# Run auth and session tests
npx playwright test --grep "@auth|@session"

# Exclude slow tests
npx playwright test --grep-invert @slow
```

### By Module

```bash
# Run all core tests
npx playwright test specs/core/

# Run all feature tests
npx playwright test specs/features/

# Run specific spec file
npx playwright test specs/ui/gallery.spec.js
```

### By Browser

```bash
# Run on specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=mobile-chrome

# Run on desktop browsers only
npx playwright test --project=chromium --project=firefox --project=webkit
```

## Multi-Browser Testing

Tests run on multiple browsers by default:

- Chromium (Chrome/Edge)
- Firefox
- WebKit (Safari)
- Mobile Chrome (Pixel 5)
- Mobile Safari (iPhone 12)
- Tablet (iPad Pro)
- Android Firefox (Galaxy S20)

Configure in `playwright.config.js`.

## Debugging

### Debug Mode

```bash
npm run test:e2e:debug
```

Opens Playwright Inspector to step through tests.

### View Trace

For failed tests, view the trace:

```bash
npx playwright show-trace test-results/.../trace.zip
```

### Codegen

Generate tests by recording interactions:

```bash
npm run test:e2e:codegen
```

## Tips

1. **Use fixtures** - Leverage custom helpers for common operations
2. **Wait automatically** - Playwright auto-waits for elements
3. **Stable selectors** - Use `data-testid` or semantic selectors
4. **Isolate tests** - Each test should be independent
5. **Test critical paths** - Focus on important user journeys
6. **Tag consistently** - Use tags for easy filtering and organization
7. **Organize by module** - Place tests in appropriate subdirectories

## Systematic Testing Approach

### Testing by Module

The test suite is organized to support systematic, module-by-module testing:

1. **Core Tests** (`specs/core/`) - Test authentication, session management, and core functionality first
2. **UI Tests** (`specs/ui/`) - Test individual UI components (gallery, lightbox, video player)
3. **Feature Tests** (`specs/features/`) - Test feature modules (tags, favorites, search, settings)
4. **Workflow Tests** (`specs/workflows/`) - Test complete user journeys end-to-end

### Tracking Coverage

To track E2E test coverage by module:

```bash
# Generate coverage reports (Markdown, JSON, HTML)
npm run test:e2e:coverage

# View reports
open e2e/coverage-reports/e2e-coverage.html
open e2e/coverage-reports/e2e-coverage.md

# Generate JSON report
CI=1 npx playwright test --reporter=json

# View comprehensive HTML report
npm run test:e2e:report

# Test specific module systematically
npx playwright test --grep @search    # Search module
npx playwright test --grep @settings  # Settings module
npx playwright test --grep @playlist  # Playlist module
```

The coverage report shows:

- Module-by-module coverage status
- Test counts per module
- Spec files organized by category
- Uncovered modules with recommendations
- Overall coverage percentage

### Coverage Gaps

Current E2E coverage status:

✅ **Covered:**

- Authentication & Session (`@auth @session`)
- Gallery Navigation (`@gallery @navigation`)
- Lightbox & Image Viewing (`@lightbox`)
- Video Player (`@video @player`)
- Tags Management (`@tags`)
- Favorites (`@favorites`)
- Keyboard Shortcuts (`@keyboard`)

🔄 **Partial Coverage:**

- Search (basic filtering only)
- Responsive behavior
- Selection mode

❌ **Missing Coverage:**

- Settings management (`@settings`)
- Playlist features (`@playlist`)
- Infinite scroll (`@infinite-scroll`)
- History navigation
- Preferences management
- Advanced search features

## More Information

See [TESTING.md](../TESTING.md) for complete documentation.
