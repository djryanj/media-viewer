# Testing Guide

For comprehensive testing documentation, see the [Testing Guide](https://djryanj.github.io/media-viewer/development/testing/) in the project documentation.

## Quick Reference

### Backend Tests (Go)

```bash
# Run all tests
make test

# Run tests with coverage
make test-coverage

# Run tests for a specific package
make test-package handlers

# Run tests with race detector
make test-race
```

### Frontend Tests (JavaScript)

Frontend tests are split into unit tests (no backend) and integration tests (backend required).

```bash
# Run unit tests only (no backend needed)
make frontend-test-unit
cd static && npm run test:unit:only

# For integration/E2E tests, start backend first (in one terminal)
make dev

# Run integration tests (in another terminal)
make frontend-test-integration
cd static && npm run test:integration

# Run E2E tests
make frontend-test-e2e
cd static && npm run test:e2e

# Run the stable Chromium smoke lane used for routine PR coverage
make frontend-test-e2e-smoke
cd static && npm run test:e2e:smoke

# Run visual regression checks against committed JSON baselines
make frontend-test-e2e-visual
cd static && npm run test:e2e:visual

# Refresh visual snapshot baselines after intentional UI changes
make frontend-test-e2e-visual-baselines
cd static && npm run test:e2e:visual:baselines

# Refresh documentation screenshots written to docs/images/
make frontend-test-e2e-docs-screenshots
cd static && npm run test:e2e:docs-screenshots

# Run all tests (unit + integration + E2E)
make frontend-test
cd static && npm test

# With coverage
make frontend-test-unit-coverage
cd static && npm run test:unit:coverage

# Watch mode
make frontend-test-unit-watch
cd static && npm run test:unit:watch

# Interactive UI
make frontend-test-unit-ui
cd static && npm run test:unit:ui
```

See [static/tests/README.md](static/tests/README.md) for complete frontend testing documentation.

The default `make frontend-test-e2e` / `npm run test:e2e` path excludes `@performance` specs and docs screenshot-generation specs so normal developer and PR runs stay predictable. Visual regression and docs screenshot generation are separate workflows.

## Continuous Integration

Tests run automatically via GitHub Actions:

**Backend Tests:**

- **Unit tests** run on all PRs (required)
- **Integration tests** run on PRs when Go changes are present
- **Race detector** runs on PRs when Go changes are present
- **Linting** runs on all PRs (required)

**Frontend Tests:**

- **Unit tests** run on all PRs (no backend required, fast)
- **Integration tests** run on all PRs (backend started automatically)
- **Playwright smoke tests** run on all PRs (backend started automatically, Chromium only)
- **Visual regression** is a separate opt-in local workflow and is not part of the default PR lane
- **Docs screenshot generation** is a separate opt-in local workflow and is not part of the default PR lane
- **Coverage reports** uploaded as artifacts

The workflow uses path-based change detection to skip backend jobs when Go files did not change.

## Documentation

- **[Complete Testing Guide](https://djryanj.github.io/media-viewer/development/testing/)** - Comprehensive guide covering all testing practices
- **[Architecture](https://djryanj.github.io/media-viewer/development/architecture/)** - System architecture and design
- **[Contributing](https://djryanj.github.io/media-viewer/development/contributing/)** - Contribution guidelines
