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

## Continuous Integration

Tests run automatically via GitHub Actions:

**Backend Tests:**

- **Unit tests** run on all PRs (required)
- **Integration tests** run on `main` or when PR is labeled `test:integration`
- **Race detector** runs on `main` or when PR is labeled `test:race`
- **Linting** runs on all PRs (required)

**Frontend Tests:**

- **Unit tests** run on all PRs (no backend required, fast)
- **Integration tests** run on all PRs (backend started automatically)
- **E2E tests** run on all PRs (Playwright with backend)
- **Coverage reports** uploaded as artifacts

Add labels to your PR to enable optional backend test suites.

## Documentation

- **[Complete Testing Guide](https://djryanj.github.io/media-viewer/development/testing/)** - Comprehensive guide covering all testing practices
- **[Architecture](https://djryanj.github.io/media-viewer/development/architecture/)** - System architecture and design
- **[Contributing](https://djryanj.github.io/media-viewer/development/contributing/)** - Contribution guidelines
