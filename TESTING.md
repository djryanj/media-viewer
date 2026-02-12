# Testing Guide

For comprehensive testing documentation, see the [Testing Guide](https://djryanj.github.io/media-viewer/development/testing/) in the project documentation.

## Quick Reference

### Run all tests

```bash
make test
```

### Run tests with coverage

```bash
make test-coverage
```

### Run tests for a specific package

```bash
make test-package handlers
```

### Run tests with race detector

```bash
make test-race
```

## Continuous Integration

Tests run automatically via GitHub Actions:

- **Unit tests** run on all PRs (required)
- **Integration tests** run on `main` or when PR is labeled `test:integration`
- **Race detector** runs on `main` or when PR is labeled `test:race`
- **Linting** runs on all PRs (required)

Add labels to your PR to enable optional test suites.

## Documentation

- **[Complete Testing Guide](https://djryanj.github.io/media-viewer/development/testing/)** - Comprehensive guide covering all testing practices
- **[Architecture](https://djryanj.github.io/media-viewer/development/architecture/)** - System architecture and design
- **[Contributing](https://djryanj.github.io/media-viewer/development/contributing/)** - Contribution guidelines
