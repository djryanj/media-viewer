# Testing Guide

This guide covers testing practices, tools, and procedures for the Media Viewer project.

## Overview

The project has two test suites:

- **Backend Tests** - Go tests for the backend server
- **Frontend Tests** - JavaScript tests for the web frontend (unit, integration, and E2E)

## Frontend Testing

The frontend (SvelteKit app in `frontend/`) has two types of tests:

- **Unit Tests** — Vitest tests for components and utilities, no backend required
- **E2E Tests** — Playwright browser tests against a running backend

### Quick Start (Frontend)

```bash
# Unit tests only (no backend required)
make frontend-test-unit

# E2E tests (requires backend)
make dev  # Terminal 1: Start backend
make frontend-test-e2e  # Terminal 2

# Stable Chromium smoke lane used by CI
make frontend-test-e2e-smoke-auto  # auto-manages backend

# Visual regression checks against committed PNG baselines in frontend/e2e/snapshots/
make frontend-test-e2e-visual

# Regenerate visual baselines after intentional UI changes
make frontend-test-e2e-visual-baselines

# Generate docs screenshots written to docs/images/
make frontend-test-e2e-docs-screenshots-auto

# All frontend tests
make frontend-test
```

### Running Frontend Tests

#### Unit Tests (No Backend Required)

Unit tests use **Vitest** and **@testing-library/svelte** with Happy DOM.

```bash
# Run all unit tests
make frontend-test-unit
cd frontend && npm run test:unit

# Watch mode (reruns on file changes)
make frontend-test-unit-watch
cd frontend && npm run test:unit:watch

# With coverage
make frontend-test-unit-coverage
cd frontend && npm run test:unit:coverage
```

Test files live in `frontend/src/tests/`. Coverage includes component rendering, store logic, API client utilities, and format helpers.

#### E2E Tests (Backend Required)

End-to-end browser tests using **Playwright** in `frontend/e2e/`. Tests are tagged `@smoke`, `@visual`, or `@docs-screenshots` so lanes run independently.

The default E2E selection (`npm run test:e2e`) excludes `@performance` and `@docs-screenshots` specs so routine runs stay fast. Visual regression compares Playwright screenshots against committed PNG baselines in `frontend/e2e/snapshots/`.

**Prerequisites:**

1. Start the backend server:

```bash
make dev
```

2. Run E2E tests:

```bash
# Run all E2E tests (excludes @performance and @docs-screenshots)
make frontend-test-e2e
cd frontend && npm run test:e2e

# Stable Chromium smoke lane used by CI
make frontend-test-e2e-smoke-auto  # auto-manages backend

# Scheduled performance lanes
make frontend-test-e2e-performance-smoke-auto
make frontend-test-e2e-performance-soak-auto

# Visual regression against committed PNG baselines
make frontend-test-e2e-visual
cd frontend && npm run test:e2e:visual

# Regenerate visual baselines after intentional UI changes
make frontend-test-e2e-visual-baselines
cd frontend && npm run test:e2e:visual:baselines

# Generate docs screenshots (writes PNGs to docs/images/)
make frontend-test-e2e-docs-screenshots-auto
cd frontend && npm run test:e2e:docs-screenshots

# Run with browser visible
cd frontend && npm run test:e2e:headed

# Debug mode
cd frontend && npm run test:e2e:debug
```

#### All Frontend Tests

Run the complete frontend test suite (unit + E2E):

```bash
make frontend-test
cd frontend && npm test
```

E2E tests require the backend to be running. Use the `*-auto` Make targets to auto-manage the backend lifecycle (same path as CI).

### Frontend Test Configuration

#### Environment Variables

Override default settings:

```bash
# Use a different backend URL
TEST_BASE_URL=http://localhost:3000 npm run test:integration

# For E2E tests
TEST_BASE_URL=http://localhost:3000 npm run test:e2e
```

#### Test Configuration

Playwright config: `frontend/playwright.config.ts`

- `TEST_BASE_URL` — Override backend URL (default: `http://localhost:5173`)
- `TEST_PASSWORD` — Override test account password (default: `testpass123`)
- Auth state is saved to `frontend/e2e/.auth/user.json` by `global-setup.ts`
- Visual baselines stored in `frontend/e2e/snapshots/`

Vitest config: `frontend/vitest.config.ts`

### Frontend CI/CD

Frontend tests run automatically in GitHub Actions:

1. **ESLint + Prettier + svelte-check** — Static checks; all three are required
2. **Unit tests** — Run first without backend (fast, Vitest)
3. **Playwright smoke tests** — Chromium smoke lane with auto-managed backend on PRs and release tags
4. **Scheduled performance tests** — Separate weekly/monthly workflow
5. **Coverage upload** — Coverage reports uploaded as artifacts

Visual regression and docs screenshot generation are intentionally separate from the default PR lane. Run them locally when you are validating intentional UI changes or refreshing documentation assets.

Release tags now repeat the Chromium smoke lane before container publishing. Performance and soak coverage remain out of the default PR and release paths so they can run on a scheduled or manual cadence without slowing routine validation.

The PR, release, and scheduled performance workflows now reuse the same `make ...-auto` targets that local developers use, so CI and local smoke/performance runs share one backend startup path instead of maintaining separate shell logic.

**Frontend CI steps:** ESLint → Prettier → svelte-check → Vitest unit → Playwright smoke

See [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) for workflow details.

### Frontend Test Structure

```
frontend/
├── src/tests/                # Vitest unit tests
│   ├── components/           # Component rendering tests
│   │   └── GalleryItem.test.ts
│   ├── format.test.ts        # Date/size formatting utilities
│   └── ...
├── e2e/                      # Playwright E2E tests
│   ├── global-setup.ts       # Auth setup (saves e2e/.auth/user.json)
│   ├── auth.spec.ts          # Auth flow (@smoke)
│   ├── gallery.spec.ts       # Gallery page (@smoke)
│   ├── gallery-filter.spec.ts
│   ├── lightbox.spec.ts
│   ├── navigation.spec.ts
│   ├── search.spec.ts
│   ├── search-shortcut.spec.ts
│   ├── settings.spec.ts
│   ├── visual-regression.spec.ts  # (@visual) PNG baselines in e2e/snapshots/
│   └── docs-screenshots.spec.ts   # (@docs-screenshots) writes docs/images/
├── e2e/snapshots/            # Committed visual regression PNG baselines
└── playwright.config.ts      # Playwright configuration
```

### Troubleshooting Frontend Tests

#### Backend Connection Issues

```bash
# Verify backend is running
curl http://localhost:8080/health

# Check backend logs for errors
make dev
```

#### Test Timeouts

If tests timeout, increase the timeout in vitest.config.js or the specific test:

```javascript
it('slow test', async () => {
    // test code
}, 20000); // 20 second timeout
```

#### E2E Test Failures

```bash
# Run with visible browser to see what's happening
cd frontend && npm run test:e2e:headed

# Debug mode (pause on failure)
cd frontend && npm run test:e2e:debug
```

#### Clear Test State

```bash
# Reset authentication by restarting backend
# Cookies are reset between test files automatically
```

---

## Backend Testing

This section covers testing for the backend Go code.

### Quick Start (Backend)

```bash
# Run all tests
make test

# Run tests with coverage report
make test-coverage

# Run tests for a specific package
make test-package PKG=handlers
```

### Running Backend Tests

### All Tests

```bash
make test
```

This runs the complete test suite across all packages.

### Short Mode

Skip long-running tests with short mode:

```bash
make test-short
```

### Package-Specific Tests

Test individual packages using short package names or full paths:

```bash
# Test a specific package (short name)
make test-package PKG=indexer

# Test with a filter for specific test names
make test-package PKG=indexer TESTARGS="-run=TestNew"

# Test another package
make test-package PKG=handlers TESTARGS="-run=TestHealth"

# Full paths also work
make test-package PKG=./internal/indexer

# Set a custom timeout
make test-package PKG=indexer TESTTIMEOUT=5m

# Run specific tests with verbose output
make test-package PKG=database TESTARGS="-run=TestUser -v"
```

**Available packages**: `database`, `handlers`, `indexer`, `logging`, `media`, `mediatypes`, `memory`, `metrics`, `middleware`, `playlist`, `startup`, `streaming`, `transcoder`, `workers`

### Coverage Reports

#### HTML Report

Generate an interactive HTML coverage report:

```bash
# Coverage for all packages
make test-coverage

# Coverage for a specific package (short name)
make test-coverage PKG=indexer

# Coverage with test filtering
make test-coverage PKG=handlers TESTARGS="-run=TestHealth"

# Full paths also work
make test-coverage PKG=./internal/indexer
```

The report is saved as `coverage.html` and the total coverage percentage is displayed.

#### Text Summary

View coverage as a text summary:

```bash
make test-coverage-report
```

### Race Detection

Run tests with the race detector to identify data races:

```bash
make test-race
```

### Benchmarks

Run performance benchmarks:

```bash
make test-bench
```

### Cleanup

Remove test artifacts and coverage reports:

```bash
make test-clean
```

## Test Organization

Tests follow Go conventions with `_test.go` files colocated with source code.

### Current Coverage by Package

#### Command Line Tools

- **`cmd/media-viewer`** - Main application entry point
    - Server configuration and routing
    - Graceful shutdown handling

#### Core Packages

- **`internal/mediatypes`** - File type detection
    - MIME type mapping
    - File extension classification
- **`internal/memory`** - Memory management
    - Configuration validation
    - Resource limits
- **`internal/startup`** - Application bootstrap
    - Configuration loading
    - Environment variable parsing
- **`internal/logging`** - Structured logging
    - Log levels and formatting
- **`internal/workers`** - Worker pools
    - CPU/IO task optimization
    - Dynamic worker scaling

#### HTTP Layer

- **`internal/middleware`** (200 lines, 8 tests) - HTTP middleware
    - Logging middleware
    - Compression (gzip, brotli)
    - Response writer wrappers
- **`internal/handlers`** (2,320+ lines, 96+ tests) - HTTP handlers
    - Health checks and version endpoints
    - Media file serving with security validation
    - Playlist handlers
    - Search and query handlers
    - Tag management (single, batch, bulk operations)
    - Transcode cache management
    - WebAuthn/passkey authentication flows

#### Data Layer

- **`internal/database`** (73 tests + 2 benchmarks) - Database operations
    - **Core Operations** (31 tests)
        - Transaction management
        - CRUD operations
        - Directory listing with pagination/filtering/sorting
        - Full-text search with FTS5
        - Thumbnail tracking and statistics
        - Concurrent access testing
    - **Favorites Module** (8 tests)
        - Add/remove favorites
        - Query and count operations
    - **Tags Module** (13 tests)
        - Tag creation and management
        - File tagging operations
        - Tag queries and pagination
    - **Metadata Module** (8 tests)
        - Get/set metadata
        - Special characters and large values
    - **WebAuthn Module** (13 tests)
        - Credential management
        - Session handling
        - User interface
    - **Coverage**: ~40%

- **`internal/media`** (12 tests + 1 benchmark) - Media processing
    - Type detection and helpers
    - Image loading and processing
    - Thumbnail generation pipeline
    - Worker pool batch processing
    - **Coverage**: ~60-65%

#### Background Services

- **`internal/indexer`** (31 tests + 5 benchmarks) - Media indexing
    - Configuration validation
    - Parallel directory walking
    - Progress tracking and statistics
    - Incremental indexing
    - Error handling

- **`internal/metrics`** - Prometheus metrics
    - HTTP request metrics
    - Database operation metrics
    - Indexer and thumbnail metrics

#### Media Processing

- **`internal/streaming`** - Stream handling
    - Timeout-protected writers
    - Backpressure management

- **`internal/transcoder`** - Video transcoding
    - Configuration validation
    - Codec detection
    - Cache management

#### Features

- **`internal/playlist`** - Playlist support
    - Windows Playlist (WPL) parsing
    - Path resolution

**Total**: 190+ tests across all packages

## Writing Tests

### Test Structure

Use table-driven tests for multiple scenarios:

```go
func TestFeature(t *testing.T) {
    t.Parallel() // Enable parallel execution

    tests := []struct {
        name     string
        input    string
        expected string
        wantErr  bool
    }{
        {
            name:     "valid input",
            input:    "test",
            expected: "test",
            wantErr:  false,
        },
        {
            name:     "empty input",
            input:    "",
            expected: "",
            wantErr:  true,
        },
        // More test cases...
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // Enable parallel subtests

            got, err := Feature(tt.input)
            if (err != nil) != tt.wantErr {
                t.Errorf("Feature() error = %v, wantErr %v", err, tt.wantErr)
                return
            }
            if got != tt.expected {
                t.Errorf("Feature() = %v, want %v", got, tt.expected)
            }
        })
    }
}
```

### Best Practices

1. **Clear Test Names**
    - Use descriptive names with `Test` prefix
    - Name subtests to describe the scenario being tested

2. **Table-Driven Tests**
    - Group related test cases
    - Reduce code duplication
    - Make adding new cases easy

3. **Test Coverage**
    - Test happy paths (success cases)
    - Test edge cases (boundaries, limits)
    - Test error conditions
    - Test concurrent access where applicable

4. **Test Independence**
    - Each test should be independent
    - Use `t.Parallel()` for concurrent execution
    - Clean up resources with `t.Cleanup()`

5. **Use Test Helpers**
    - Extract common setup into helper functions
    - Create mock implementations for dependencies
    - Use interfaces to enable testing

6. **Document Intent**
    - Add comments for complex test logic
    - Explain why a test exists, not just what it does

### HTTP Handler Testing

Example of testing HTTP handlers with mocks:

```go
func TestHandler(t *testing.T) {
    t.Parallel()

    // Create mock dependencies
    mockDB := &mockDatabase{
        getUserFunc: func(id int64) (*User, error) {
            return &User{ID: id, Name: "test"}, nil
        },
    }

    h := &Handlers{db: mockDB}

    // Create test request
    req := httptest.NewRequest(http.MethodGet, "/api/user/1", nil)
    w := httptest.NewRecorder()

    // Call handler
    h.GetUser(w, req)

    // Assert response
    if w.Code != http.StatusOK {
        t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
    }

    // Parse and validate JSON response
    var resp map[string]interface{}
    if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
        t.Fatalf("failed to decode response: %v", err)
    }

    if resp["name"] != "test" {
        t.Errorf("name = %v, want %v", resp["name"], "test")
    }
}
```

### Integration Testing

Integration tests interact with real components (database, filesystem):

```go
func TestDatabaseIntegration(t *testing.T) {
    // Skip in short mode
    if testing.Short() {
        t.Skip("skipping integration test in short mode")
    }

    // Create temporary database
    db, cleanup := setupTestDB(t)
    defer cleanup()

    // Run test operations
    err := db.UpsertFile(context.Background(), &File{
        Path: "/test.jpg",
        Type: "image",
    })
    if err != nil {
        t.Fatalf("UpsertFile() error = %v", err)
    }

    // Verify results
    file, err := db.GetFileByPath(context.Background(), "/test.jpg")
    if err != nil {
        t.Fatalf("GetFileByPath() error = %v", err)
    }
    if file.Type != "image" {
        t.Errorf("Type = %v, want %v", file.Type, "image")
    }
}
```

### Frontend Testing Patterns

#### Unit Test Pattern (Vitest + @testing-library/svelte)

```typescript
import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import GalleryItem from '$lib/components/gallery/GalleryItem.svelte';

describe('GalleryItem', () => {
    test('renders image thumbnail', () => {
        const { getByRole } = render(GalleryItem, {
            props: { item: { path: 'photo.jpg', name: 'photo.jpg', type: 'image', size: 1024 } }
        });
        expect(getByRole('img')).toBeTruthy();
    });
});
```

#### E2E Test Pattern (Playwright)

```typescript
import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

test.use({ storageState: STORAGE_STATE });

test('@smoke gallery loads after login', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});
```

Tags on tests drive lane filtering:

| Tag | Lane | Command |
|---|---|---|
| `@smoke` | CI PR gate | `npm run test:e2e:smoke` |
| `@visual` | Visual regression | `npm run test:e2e:visual` |
| `@docs-screenshots` | Docs image generation | `npm run test:e2e:docs-screenshots` |

### Benchmarking

Write benchmarks for performance-critical code:

```go
func BenchmarkOperation(b *testing.B) {
    // Setup
    data := prepareTestData()

    // Reset timer after setup
    b.ResetTimer()

    // Run operation b.N times
    for i := 0; i < b.N; i++ {
        Operation(data)
    }
}
```

## Continuous Integration

Tests run automatically via GitHub Actions on pushes to repository branches and on pull requests targeting `main`.

### CI Workflow

The CI pipeline (`.github/workflows/ci.yml`) includes:

#### 1. Change Detection

- Detects which files changed (Go code, Docker files)
- Identifies affected Go packages for optimized testing
- Skips unnecessary jobs when possible

#### 2. Linting (`lint`)

- Runs `golangci-lint` with comprehensive checks
- Installs libvips for dependency requirements
- Must pass before PR can be merged
- **Required on all PRs**

#### 3. Unit Tests (`test-unit`)

- Runs fast unit tests with `make test-unit`
- Excludes integration tests (uses `-short` flag)
- Generates coverage reports
- Uploads test results as artifacts
- **Required on all PRs**

#### 4. Backend Integration Tests (`test-integration`)

- Runs slower backend integration tests with real dependencies
- Installs libvips and ffmpeg
- Runs on pull requests when Go code changes

#### 5. Backend Race Detector (`test-race`)

- Runs tests with `-race` to detect data races
- Runs on pull requests when Go code changes

#### 6. Frontend Static Checks (`test-frontend-check`)

- ESLint (`npm run lint:js`), Prettier format check, and svelte-check (TypeScript types)
- All three are required; runs on pull requests when frontend code changes

#### 7. Frontend Unit Tests (`test-frontend-unit`)

- Vitest unit tests in `frontend/src/tests/`
- No backend required; runs on all PRs

#### 8. Frontend Playwright Smoke (`test-frontend-e2e-smoke`)

- Starts the backend automatically
- Runs the stable Chromium smoke lane used for routine PR coverage
- Excludes the separate visual regression and docs screenshot-generation workflows
- Runs on pull requests when frontend code changes

#### 8. Docker Build (`build-docker`)

- Builds Docker image to verify it compiles
- Only runs if tests pass
- Uses BuildKit caching for speed

### Pull Request Scope

The workflow uses path-based change detection to skip unnecessary jobs. In practice:

- Go changes trigger backend build, unit, integration, and race coverage.
- Frontend changes trigger frontend unit, frontend integration, and Playwright smoke coverage.
- Visual regression and docs screenshot generation remain manual workflows because they update or validate committed UI artifacts rather than routine behavior.

### CI Requirements

For a PR to be mergeable:

1. ✅ Go linting must pass
2. ✅ Go unit tests must pass
3. ✅ Frontend ESLint, Prettier, and svelte-check must pass when frontend files changed
4. ✅ Frontend unit tests must pass when frontend files changed
5. ✅ Frontend Playwright smoke must pass when frontend files changed
6. ✅ Backend integration and race detection must pass when Go code changes
7. ✅ Docker build must succeed

### Viewing CI Results

1. **On Pull Requests**: Check the "Checks" tab
2. **Test Artifacts**: Download from the workflow run
    - `unit-test-results` - Coverage and JSON output
    - `integration-test-results` - Integration coverage
3. **Coverage Reports**: View coverage percentages in workflow logs

### Local Testing Before Push

Run the same checks locally:

```bash
# Run linting
make lint

# Run the local PR gate for changed areas
make pr-check

# If you want Go lint autofixes before rerunning the same PR gate
make pr-check-fix

# Run unit tests
make test-unit

# Run backend integration and race coverage when Go changes are involved
make test-integration
make test-race

# Run everything
make test-all
```

### Frontend PR Checklist

Use this checklist to match local validation to the kind of frontend change in your PR:

- Start with `make pr-check` when the PR changes frontend behavior, browser interactions, or page bootstrapping. It already covers frontend static checks, frontend unit/integration, and the Chromium smoke lane.
- Use `make pr-check-fix` instead when you want Go lint autofixes applied before rerunning the same local PR gate.
- Run `make frontend-test-e2e` as well when the affected area is outside the smoke subset or when you need broader functional browser coverage.
- Run `make frontend-test-e2e-visual` when the PR intentionally changes UI presentation. If the updated rendering is expected, regenerate baselines with `make frontend-test-e2e-visual-baselines` and include the changed artifacts in the PR.
- Run `make frontend-test-e2e-docs-screenshots` only when the PR updates documentation imagery, and include the refreshed `docs/images/` files in the PR.
- Run the relevant `make frontend-test-e2e-performance*` lane for performance-sensitive changes. Those specs are excluded from the default E2E selection and from routine PR CI.

### Running Additional UI Validation Locally

Visual regression and docs screenshot generation are intentionally kept out of the default PR workflow because they validate committed UI artifacts rather than routine functional behavior.

Use these commands locally when needed:

```bash
make frontend-test-e2e-visual
make frontend-test-e2e-visual-baselines
make frontend-test-e2e-docs-screenshots
```

### Build Tags

Tests use the same build tags as the main application:

- `fts5` - SQLite FTS5 full-text search support

## Coverage Goals

- **Backend**: ~40-65% (varies by package), target >80%
- **Frontend**: ~80% of modules covered (as of February 2026)

### Recent Improvements

**2026**:

- Migrated frontend from vanilla JS to SvelteKit (Svelte 5, TypeScript)
- Frontend test suite migrated from JSDOM/eval-based Vitest to `@testing-library/svelte` component tests
- Playwright E2E tests rewritten for SvelteKit DOM structure; old `static/e2e/` specs preserved but not run in CI
- Added visual regression lane (`@visual`) with Playwright `toHaveScreenshot()` and PNG baselines in `frontend/e2e/snapshots/`
- Added docs screenshot lane (`@docs-screenshots`) that writes PNGs directly to `docs/images/`
- `make pr-check` now runs ESLint + Prettier + svelte-check (was only svelte-check before)

## Common Issues

### Race Conditions

If `make test-race` reports data races:

1. Identify the shared resource
2. Add proper synchronization (mutex, channel)
3. Verify with `make test-race` again

### Flaky Tests

If tests fail intermittently:

1. Check for timing dependencies
2. Look for shared global state
3. Verify cleanup in `t.Cleanup()`
4. Use `t.Parallel()` carefully with shared resources

### Slow Tests

If tests take too long:

1. Use `testing.Short()` to skip in short mode
2. Reduce test data size
3. Use parallel execution with `t.Parallel()`
4. Consider if integration test should be unit test

## Package-Specific Testing

### Transcoder Package

The transcoder package requires special handling due to external dependencies (ffmpeg/ffprobe).

#### Test Organization

**Unit Tests** (`transcoder_test.go`):

- Test parsing logic and configuration
- Use mock ffmpeg/ffprobe bash scripts
- No external dependencies required
- Complete in < 100ms per test
- Use `t.Parallel()` for concurrency

**Integration Tests** (`transcoder_coverage_test.go`):

- Test real ffmpeg/ffprobe interaction
- Require ffmpeg installed on system
- Use `checkFFmpegAvailable(t)` helper (skips if not available or in short mode)
- Use test video file from `/testdata/test.mp4`
- Include `Integration` suffix in function name

#### Running Transcoder Tests

```bash
# Unit tests only (no ffmpeg required)
go test -short ./internal/transcoder

# All tests (requires ffmpeg)
go test ./internal/transcoder

# Specific test
make test-package PKG=transcoder TESTARGS="-run=TestGetVideoInfoIntegration_RealVideo"

# With coverage
make test-coverage PKG=transcoder

# Benchmarks
go test -short -bench=. ./internal/transcoder  # Unit only
go test -bench=. ./internal/transcoder          # All benchmarks
```

#### Test Data Files

**Test Video (`/testdata/test.mp4`)**:

- Generated by `/testdata/generate.sh`
- Properties: 1 second duration, 320×240 resolution, ~3KB, h264 codec
- Purpose: Minimal real video for testing ffmpeg/ffprobe integration
- See `/testdata/README.md` for details

**Mock Implementations**:
Unit tests create temporary bash scripts that simulate ffmpeg/ffprobe behavior:

- Return predefined JSON output for testing parsing logic
- Temporary scripts created in `t.TempDir()` and auto-cleaned
- PATH temporarily modified to use mocks

#### Writing Transcoder Tests

**Unit Test Pattern** (mock ffprobe):

```go
func TestGetVideoInfo_ParsesFFProbeOutput(t *testing.T) {
    t.Parallel()

    tmpDir := t.TempDir()
    mockFFProbe := filepath.Join(tmpDir, "ffprobe")

    ffprobeScript := `#!/bin/bash
cat << 'EOF'
{"streams":[{"codec_name":"h264","width":1920,"height":1080}],"format":{"duration":"125.5"}}
EOF
`

    if err := os.WriteFile(mockFFProbe, []byte(ffprobeScript), 0755); err != nil {
        t.Fatalf("Failed to create mock ffprobe: %v", err)
    }

    oldPath := os.Getenv("PATH")
    defer func() { _ = os.Setenv("PATH", oldPath) }()
    _ = os.Setenv("PATH", tmpDir+":"+oldPath)

    // Test code here...
}
```

**Integration Test Pattern** (real ffmpeg):

```go
func TestStreamVideoIntegration_WithResize(t *testing.T) {
    checkFFmpegAvailable(t)  // Skips if ffmpeg not available or in short mode
    testVideo := getTestVideoPath(t)

    tmpDir := t.TempDir()
    trans := New(tmpDir, true)
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    var buf bytes.Buffer
    err := trans.StreamVideo(ctx, testVideo, &buf, 320)
    if err != nil {
        t.Fatalf("StreamVideo() error: %v", err)
    }

    if buf.Len() == 0 {
        t.Error("Expected video data")
    }
}
```

**Guidelines for New Transcoder Tests:**

Unit Tests:

- Use table-driven test structure
- Create mock ffprobe/ffmpeg scripts in `t.TempDir()`
- No `Integration` suffix in function name
- Should complete in < 100ms
- Use `t.Parallel()` for concurrent execution
- Add to `transcoder_test.go` or `transcoder_coverage_test.go`

Integration Tests:

- Add `Integration` suffix to function name
- Call `checkFFmpegAvailable(t)` at the start
- Use `getTestVideoPath(t)` to get test video file path
- Use `context.WithTimeout()` with reasonable timeout (e.g., 30 seconds)
- Handle cleanup with `defer` or `t.Cleanup()`
- Add to `transcoder_coverage_test.go`

#### Transcoder CI Integration

**Pull Requests:**

- ✅ Backend unit tests run automatically when Go changes are present
- ✅ Backend integration and race coverage run automatically when Go changes are present
- FFmpeg is installed in the backend integration jobs that need it

**Main Branch:**

- Pushes still go through the same change-detected CI pipeline
- Backend jobs run when Go files changed
- FFmpeg is installed in the integration-oriented jobs that need it

There is no separate PR label required for backend integration coverage in the current workflow.

#### Troubleshooting Transcoder Tests

**FFmpeg Not Found:**

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y ffmpeg

# macOS
brew install ffmpeg

# Verify installation
which ffmpeg ffprobe
ffmpeg -version
```

**Test Video Not Found:**

```bash
# Verify test files exist
ls -lh testdata/

# Regenerate if missing
cd testdata
./generate.sh
```

**Tests Timing Out:**

- Integration tests use 30-second context timeouts
- If tests timeout on slower systems, increase timeout in the test
- Check if ffmpeg is actually hanging: `ffmpeg -version`

**Mock Script Failures:**

- **Permission denied**: Ensure mock scripts have execute permissions (0755)
- **Command not found**: Verify PATH modification is working
- **Bash not available**: Ensure `/bin/bash` exists on your system

#### Performance Expectations

**Unit Tests:**

- Constructor/getter tests: < 1ms per test
- Mock ffprobe parsing: < 50ms per test
- File operations: < 10ms per test
- Full unit test suite: < 1 second

**Integration Tests:**

- `GetVideoInfo`: 100-500ms per test
- `StreamVideo` (direct): 200-1000ms per test
- `StreamVideo` (transcode): 1-5 seconds per test
- Full integration suite: 10-30 seconds

Times vary based on system performance and video complexity.

#### Coverage Status

- **Current coverage:** ~90%
- **Target:** >80% (project-wide goal)
- **Test count:** 46 tests (37 unit + 9 integration) + 5 benchmarks

## See Also

- [Profiling Guide](profiling.md) - CPU, memory, and database profiling
- [Monitoring Stack](monitoring.md) - Performance testing and metrics monitoring
- [Architecture](architecture.md) - System architecture overview
- [Memory & GC Tuning](../admin/memory-tuning.md) - Performance optimization guide
- [Playwright Config](../../frontend/playwright.config.ts) - E2E test configuration
- [E2E Test Directory](../../frontend/e2e/) - Playwright spec files

## Resources

### Backend Testing (Go)

- [Go Testing Package](https://pkg.go.dev/testing)
- [Go Blog: Table Driven Tests](https://go.dev/blog/subtests)
- [Effective Go: Testing](https://go.dev/doc/effective_go#testing)

### Frontend Testing (TypeScript / SvelteKit)

- [Vitest Documentation](https://vitest.dev/) - Unit test framework
- [Playwright Documentation](https://playwright.dev/) - E2E browser testing
- [@testing-library/svelte](https://testing-library.com/docs/svelte-testing-library/intro/) - Svelte component testing utilities
- [SvelteKit Testing](https://svelte.dev/docs/kit/testing) - Official SvelteKit testing guide
