# Testing Guide

This guide covers testing practices, tools, and procedures for the Media Viewer backend (Go code).

## Quick Start

```bash
# Run all tests
make test

# Run tests with coverage report
make test-coverage

# Run tests for a specific package
make test-package PKG=handlers
```

## Running Tests

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

Tests run automatically via GitHub Actions on every push to `main` and on all pull requests.

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

#### 4. Integration Tests (`test-integration`)

- Runs slower integration tests with real dependencies
- Installs libvips and ffmpeg
- Runs automatically on `main` branch
- On PRs: only runs when labeled with `test:integration`
- **Optional on PRs** (add label to run)

#### 5. Race Detector (`test-race`)

- Runs tests with `-race` flag to detect data races
- Runs automatically on `main` branch
- On PRs: only runs when labeled with `test:race`
- **Optional on PRs** (add label to run)

#### 6. Docker Build (`build-docker`)

- Builds Docker image to verify it compiles
- Only runs if tests pass
- Uses BuildKit caching for speed

### Pull Request Labels

Control which tests run on your PR:

- **`test:integration`** - Run integration tests (normally skipped on PRs)
- **`test:race`** - Run race detector (normally skipped on PRs)

### CI Requirements

For a PR to be mergeable:

1. ✅ Linting must pass
2. ✅ Unit tests must pass
3. ✅ Docker build must succeed
4. ⚠️ Integration tests optional (unless labeled)
5. ⚠️ Race detector optional (unless labeled)

On the `main` branch, all tests including integration and race detection run automatically.

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

# Run unit tests (what CI runs by default)
make test-unit

# Run integration tests (if you added the label)
make test-integration

# Run race detector (if you added the label)
make test-race

# Run everything
make test-all
```

### Build Tags

Tests use the same build tags as the main application:

- `fts5` - SQLite FTS5 full-text search support

## Coverage Goals

- Current: ~40-65% (varies by package)
- Target: >80% overall coverage

### Recent Improvements

**February 2026**: Added comprehensive integration tests for database package, increasing coverage from ~5% to ~40%

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

- ✅ Unit tests run automatically (`test-unit` job)
- ⚠️ Integration tests only run with `test:integration` label
- FFmpeg is **not** installed by default

**Main Branch:**

- ✅ Unit tests run automatically
- ✅ Integration tests run automatically
- FFmpeg is installed in the `test-integration` job

To run integration tests on your PR, add the `test:integration` label.

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

## Resources

- [Go Testing Package](https://pkg.go.dev/testing)
- [Go Blog: Table Driven Tests](https://go.dev/blog/subtests)
- [Effective Go: Testing](https://go.dev/doc/effective_go#testing)
