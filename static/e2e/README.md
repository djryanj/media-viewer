# End-to-End Tests (Legacy — Vanilla JS Frontend)

> **⚠️ This directory targets the legacy vanilla JS frontend in `static/`.**
>
> The active SvelteKit frontend (`frontend/`) has its own Playwright E2E suite in
> `frontend/e2e/`. The specs in this directory rely on `window.MediaApp`,
> `window.Lightbox`, `window.Gallery`, and other global objects that no longer
> exist in the SvelteKit app. They are preserved for historical reference but are
> **not run in CI** against the current application.
>
> For active E2E tests, see:
> - `frontend/e2e/` — Playwright specs for the SvelteKit app
> - `frontend/playwright.config.ts` — Playwright configuration
> - `make frontend-test-e2e-smoke-auto` — CI smoke lane

This directory contains legacy E2E tests written with Playwright for testing the original vanilla JS frontend.

## Quick Start

```bash
# Install Playwright browsers (first time only)
npx playwright install

# Run all E2E tests
npm run test:e2e

# Run every regular E2E spec plus the opt-in docs screenshot workflow
npm run test:e2e:all

# Run the stable Chromium smoke suite used on pull requests
npm run test:e2e:smoke

# Run the Docker-backed Chromium smoke suite (auth, gallery, autotagger runtime)
npm run test:e2e:runtime-smoke

# Run visual regression checks against committed JSON baselines
npm run test:e2e:visual

# Refresh visual snapshot baselines after intentional UI changes
npm run test:e2e:visual:baselines

# Run the fast performance baseline suite
npm run test:e2e:performance:smoke

# Run the non-soak performance suite in Chromium
npm run test:e2e:performance

# Run the long-running soak suite in Chromium
npm run test:e2e:performance:soak

# Target a different backend
TEST_BASE_URL=http://localhost:3000 npm run test:e2e

# Generate documentation screenshots for tagging suggestions
npm run test:e2e:docs-screenshots

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

Playwright reads `TEST_BASE_URL` for the backend URL. `BASE_URL` is still accepted as a legacy alias for local compatibility, but new commands and docs should use `TEST_BASE_URL`.

`npm run test:e2e` excludes `@performance` specs and `@docs-screenshots` specs by default. Performance coverage is opt-in through the dedicated `test:e2e:performance:*` commands, and docs screenshot generation is opt-in through `npm run test:e2e:docs-screenshots`, so the regular developer and PR path stays stable.

The regular pull request workflow runs `npm run test:e2e:smoke`, which currently covers the canonical auth, gallery, and lightbox/video specs in Chromium.

The Docker runtime smoke lane extends that Chromium smoke coverage with a real container-backed autotagger assertion, so image/runtime regressions can surface even when the regular host-backed smoke suite is green.

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
│   ├── visual/                     # Visual snapshot regression tests
│   │   └── tagging-visual-regression.spec.js # Compares committed JSON baselines
│   └── workflows/                  # Full user journey and docs-capture tests
│       └── tagging-docs-screenshots.spec.js # Writes screenshots to docs/images/
├── fixtures/                       # Custom test fixtures and helpers
│   └── index.js                   # Shared fixtures (loginHelpers, galleryHelpers, etc.)
│   └── visual-regression.js       # DOM/style snapshot capture and comparison helpers
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

**Performance Tags:**

- `@performance` - Any benchmark or performance-focused E2E spec
- `@perf-smoke` - Fast baseline performance coverage suitable for routine local checks
- `@slow` - Longer-running performance or workflow coverage
- `@soak` - Extended stress or degradation runs intended for manual/nightly use

## Documentation Screenshots

The repository includes a dedicated Playwright workflow for generating polished documentation media for the published docs site and root README.

```bash
npm run test:e2e:docs-screenshots
```

This workflow:

- Runs in `chromium` only
- Seeds deterministic tag data through the API
- Seeds deterministic collections and favorites state through the API
- Uses stable selection-toolbar interactions instead of brittle context-menu paths
- Writes screenshots and animated docs media directly into `../docs/images/`

Current outputs:

- `docs/images/collections-lightbox-drawer.png`
- `docs/images/collections-modal.png`
- `docs/images/collections-panel.png`
- `docs/images/collections-workflow.gif`
- `docs/images/collections-workflow.mp4`
- `docs/images/favorites-strip.png`
- `docs/images/lightbox-video-toolbar.png`
- `docs/images/tagging-bulk-modal.png`
- `docs/images/tagging-paste-modal.png`
- `docs/images/tagging-merge-modal.png`
- `docs/images/tagging-lightbox-drawer.png`
- `docs/images/tagging-search-filter-modal.png`
- `docs/images/tagging-manager-settings.png`
- `docs/images/tagging-suggestions-empty.png`
- `docs/images/tagging-suggestions-typed.png`

Covered flows include single-item tagging suggestions, bulk tagging, paste and merge flows, the lightbox tag drawer, the video lightbox toolbar, search-result tag filtering, the settings tag manager, the favorites strip, collection management surfaces, and an animated collections workflow capture.

Animated assets are generated from the same Playwright lane. The workflow records a Chromium session, then transcodes the captured WebM into documentation-ready `mp4` and `gif` outputs with `ffmpeg`.

Treat this spec as a reusable pattern for future documentation capture work.

## Visual Snapshot Regression

The repository also includes a separate Playwright lane for visual regression that does not generate screenshots for the docs site.

```bash
npm run test:e2e:visual
npm run test:e2e:visual:baselines
```

This workflow:

- Runs in `chromium` only
- Captures deterministic DOM/style snapshots for selected UI states
- Compares those snapshots against committed JSON baselines in `e2e/baselines/tagging/`
- Uses `npm run test:e2e:visual:baselines` only when an intentional UI change requires baseline updates

Keep this lane separate from docs screenshot generation: the visual suite protects against unintended UI drift, while the docs screenshot suite refreshes published PNG assets in `docs/images/`.

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

# Run only performance tests
npx playwright test --grep @performance --project=chromium

# Run only the fast performance baseline tier
npx playwright test --grep @perf-smoke --project=chromium

# Run only soak tests
npx playwright test --grep @soak --project=chromium
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
