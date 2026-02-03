# Testing Guide

This directory contains the test suite for the Media Viewer backend (Go code).

## Running Tests

### Run all tests

```bash
make test
```

### Run tests in short mode (skip long-running tests)

```bash
make test-short
```

### Run tests with coverage report

```bash
make test-coverage
```

### View coverage as text summary

```bash
make test-coverage-report
```

### Run tests with race detector

```bash
make test-race
```

### Run benchmarks

```bash
make test-bench
```

### Clean test artifacts

```bash
make test-clean
```

## Test Organization

Tests are colocated with the code they test, using the standard Go convention of `_test.go` files.

### Current Test Coverage

- `cmd/media-viewer` - Main application entry point (server configuration, routing, shutdown)
- `internal/mediatypes` - File type detection and MIME type mapping
- `internal/memory` - Memory configuration and management
- `internal/startup` - Application startup and configuration
- `internal/logging` - Logging levels and functions

### Writing Tests

Follow these guidelines when adding new tests:

1. **Name tests clearly**: Use descriptive test names with `Test` prefix
2. **Use table-driven tests**: For testing multiple scenarios
3. **Test edge cases**: Include boundary conditions and error cases
4. **Keep tests focused**: Each test should verify one specific behavior
5. **Use test helpers**: Extract common setup into helper functions
6. **Document test intent**: Add comments for complex test logic

### Example Test Structure

```go
func TestFeature(t *testing.T) {
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
        // More test cases...
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
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

## Continuous Integration

Tests are automatically run in CI/CD pipelines. All tests must pass before merging.

## Test Tags

Tests use the same build tags as the main application:

- `fts5` - SQLite FTS5 full-text search support

## Future Testing Goals

- Increase code coverage to >80%
- Add integration tests for database operations
- Add end-to-end API tests
- Add performance benchmarks for critical paths
- Add fuzz testing for input validation
