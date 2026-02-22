# =============================================================================
# Media Viewer — Makefile
# =============================================================================

VERSION ?= dev
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME ?= $(shell date -u '+%Y-%m-%d_%H:%M:%S')
LDFLAGS := -X 'media-viewer/internal/startup.Version=$(VERSION)' \
           -X 'media-viewer/internal/startup.Commit=$(COMMIT)' \
           -X 'media-viewer/internal/startup.BuildTime=$(BUILD_TIME)'

DIST_DIR := dist
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64
STATIC_DIR := static

# Build configuration
BUILD_TAGS := fts5
GO_BUILD := go build -tags '$(BUILD_TAGS)'
GO_RUN := go run -tags '$(BUILD_TAGS)'
GO_TEST := go test -tags '$(BUILD_TAGS)'

# Test configuration
PKG ?= ./...
TESTARGS ?=
TESTTIMEOUT ?= 10m

# PR check configuration
PR_BASE ?= main
FORCE ?= 0

# =============================================================================
# .PHONY declarations (all targets, grouped by section)
# =============================================================================

.PHONY: all \
        build build-all resetpw release-build \
        run dev dev-info dev-proxy dev-frontend dev-full \
        test test-short test-package test-failures \
        test-coverage test-coverage-report test-coverage-merge \
        test-race test-bench test-bench-performance test-bench-large test-performance \
        test-unit test-integration test-all \
        test-clean \
        pr-check pr-check-all \
        frontend-install \
        frontend-lint frontend-lint-js frontend-lint-css \
        frontend-lint-fix frontend-lint-css-fix \
        frontend-format frontend-format-check frontend-check \
        frontend-dev \
        frontend-test frontend-test-unit frontend-test-integration \
        frontend-test-integration-auto frontend-test-e2e-auto \
        frontend-test-e2e \
        frontend-test-coverage frontend-test-unit-coverage \
        frontend-test-unit-watch frontend-test-unit-ui \
        frontend-test-file \
        frontend-test-e2e-module frontend-test-e2e-category frontend-test-e2e-file \
        frontend-test-e2e-headed frontend-test-e2e-ui frontend-test-e2e-debug \
        frontend-test-e2e-coverage frontend-test-e2e-report \
        lint lint-fix lint-all lint-fix-all format-all check-all \
        clean clean-all \
        docker-build docker-build-dev docker-run \
        icons docs-serve docs-build docs-deploy \
        download-sample-media \
        setup help

# Default target
all: build

# =============================================================================
# Go Build Targets
# =============================================================================

build:
	@echo "Building with FTS5 support..."
	$(GO_BUILD) -ldflags "$(LDFLAGS)" -o media-viewer ./cmd/media-viewer

build-all: build resetpw

resetpw:
	@echo "Building password reset tool..."
	$(GO_BUILD) -ldflags "$(LDFLAGS)" -o resetpw ./cmd/resetpw

release-build:
	@echo "Building release binaries..."
	$(GO_BUILD) -ldflags "$(LDFLAGS) -s -w" -o media-viewer ./cmd/media-viewer
	$(GO_BUILD) -ldflags "$(LDFLAGS) -s -w" -o resetpw ./cmd/resetpw

# =============================================================================
# Development Targets
# =============================================================================

run:
	@echo "Running with FTS5 support..."
	$(GO_RUN) ./cmd/media-viewer

dev:
	@echo "Starting Go development server with hot reload..."
	LOG_LEVEL=debug WEBAUTHN_RP_ID=localhost \
	WEBAUTHN_RP_DISPLAY_NAME="Media Viewer Dev" \
	WEBAUTHN_RP_ORIGINS=http://localhost:8080 \
	INDEX_INTERVAL=2m \
	THUMBNAIL_INTERVAL=4m \
	SESSION_DURATION=1h \
	air

dev-info:
	@echo "Starting Go development server with info level logging..."
	LOG_LEVEL=info WEBAUTHN_RP_ID=localhost \
	WEBAUTHN_RP_DISPLAY_NAME="Media Viewer Dev" \
	WEBAUTHN_RP_ORIGINS=http://localhost:8080 \
	INDEX_INTERVAL=30m \
	THUMBNAIL_INTERVAL=6h \
	SESSION_DURATION=1h \
	air

# Start frontend dev server proxying to the Go backend (requires 'make dev' running)
dev-proxy:
	@echo "Starting frontend development server proxying to Go backend..."
	@cd $(STATIC_DIR) && npm run dev:proxy

# Backward-compatible alias for dev-proxy
dev-frontend: dev-proxy

dev-full:
	@echo "Starting full development environment (Go + Frontend)..."
	@echo "Press Ctrl+C to stop both servers"
	@trap 'kill 0' INT; \
		LOG_LEVEL=debug air & \
		sleep 2 && cd $(STATIC_DIR) && npm run dev:proxy & \
		wait

# =============================================================================
# Go Test Targets
# =============================================================================

# Run all Go tests
test:
	@echo "Running tests..."
	$(GO_TEST) -v ./... 2>&1 | tee test.log

# Run Go tests in short mode (skip long-running tests)
test-short:
	@echo "Running tests (short mode)..."
	$(GO_TEST) -short -v ./... 2>&1 | tee short.log

# Run tests for specific packages.
# Automatically resolves short package names (e.g., "indexer" -> "./internal/indexer").
# Examples:
#   make test-package database
#   make test-package database handlers
#   make test-package indexer TESTARGS="-run=TestNew"
#   make test-package ./internal/indexer
#   make test-package PKG=indexer
test-package:
	@goals="$(filter-out test-package,$(MAKECMDGOALS))"; \
	pkgs="$${goals:-$(PKG)}"; \
	if [ "$$pkgs" = "./..." ] || [ -z "$$pkgs" ]; then \
		echo "Running all tests..."; \
		$(GO_TEST) -v ./... $(TESTARGS) -timeout $(TESTTIMEOUT) 2>&1 | tee all.log; \
	else \
		for pkg in $$pkgs; do \
			if echo "$$pkg" | grep -q "^\./"; then \
				pkg_path="$$pkg"; \
				pkg_name=$$(echo "$$pkg" | sed 's|^.*/||'); \
			else \
				pkg_path="./internal/$$pkg"; \
				pkg_name="$$pkg"; \
			fi; \
			echo "Running tests for $$pkg_path $(TESTARGS)... (logging to $$pkg_name.log)"; \
			$(GO_TEST) -v $$pkg_path $(TESTARGS) -timeout $(TESTTIMEOUT) 2>&1 | tee $$pkg_name.log; \
		done; \
	fi

# Run tests and show only failures.
# Examples:
#   make test-failures database
#   make test-failures database handlers
#   make test-failures (all packages)
#   make test-failures indexer TESTARGS="-run=TestNew"
test-failures:
	@goals="$(filter-out test-failures,$(MAKECMDGOALS))"; \
	pkgs="$${goals:-$(PKG)}"; \
	echo "Running tests and showing failures only..."; \
	if [ "$$pkgs" = "./..." ] || [ -z "$$pkgs" ]; then \
		$(GO_TEST) -v ./... $(TESTARGS) -timeout $(TESTTIMEOUT) 2>&1 | tee failures-all.log | grep -E "FAIL|--- FAIL|panic" || echo "✓ All tests passed!"; \
	else \
		for pkg in $$pkgs; do \
			if echo "$$pkg" | grep -q "^\./"; then \
				pkg_path="$$pkg"; \
				pkg_name=$$(echo "$$pkg" | sed 's|^.*/||'); \
			else \
				pkg_path="./internal/$$pkg"; \
				pkg_name="$$pkg"; \
			fi; \
			echo "Testing $$pkg_path... (logging to failures-$$pkg_name.log)"; \
			$(GO_TEST) -v $$pkg_path $(TESTARGS) -timeout $(TESTTIMEOUT) 2>&1 | tee failures-$$pkg_name.log | grep -E "FAIL|--- FAIL|panic" || echo "✓ Tests passed for $$pkg_name!"; \
		done; \
	fi

# Run tests with coverage report.
# Examples:
#   make test-coverage (all packages)
#   make test-coverage database
#   make test-coverage database handlers
#   make test-coverage indexer TESTARGS="-run=TestNew"
test-coverage:
	@goals="$(filter-out test-coverage,$(MAKECMDGOALS))"; \
	pkgs="$${goals:-$(PKG)}"; \
	if [ "$$pkgs" = "./..." ] || [ -z "$$pkgs" ]; then \
		echo "Running tests with coverage for all packages..."; \
		$(GO_TEST) -v -coverprofile=coverage.out ./... $(TESTARGS) -timeout $(TESTTIMEOUT) 2>&1 | tee coverage-all.log; \
		go tool cover -html=coverage.out -o coverage.html; \
		echo "Coverage report: coverage.html"; \
		go tool cover -func=coverage.out | grep total; \
	else \
		for pkg in $$pkgs; do \
			if echo "$$pkg" | grep -q "^\./"; then \
				pkg_path="$$pkg"; \
				pkg_name=$$(echo "$$pkg" | sed 's|^.*/||'); \
			else \
				pkg_path="./internal/$$pkg"; \
				pkg_name="$$pkg"; \
			fi; \
			echo "Running tests with coverage for $$pkg_path... (logging to coverage-$$pkg_name.log)"; \
			$(GO_TEST) -v -coverprofile=coverage-$$pkg_name.out $$pkg_path $(TESTARGS) -timeout $(TESTTIMEOUT) 2>&1 | tee coverage-$$pkg_name.log; \
			if [ -f coverage-$$pkg_name.out ]; then \
				go tool cover -html=coverage-$$pkg_name.out -o coverage-$$pkg_name.html; \
				echo "Coverage report for $$pkg_name: coverage-$$pkg_name.html"; \
				go tool cover -func=coverage-$$pkg_name.out | grep total; \
			fi; \
		done; \
	fi

# Display coverage summary from a previous test-coverage run
test-coverage-report:
	@echo "Generating coverage report..."
	@if [ ! -f coverage.out ]; then \
		echo "Error: coverage.out not found. Run 'make test-coverage' first."; \
		exit 1; \
	fi
	go tool cover -func=coverage.out

test-race:
	@echo "Running tests with race detector..."
	$(GO_TEST) -race -v ./... 2>&1 | tee race.log

test-bench:
	@echo "Running benchmarks..."
	$(GO_TEST) -bench=. -benchmem ./... 2>&1 | tee bench.log

test-bench-performance:
	@echo "Running performance optimization benchmarks..."
	@echo "Includes cache size, query optimization, and HTTP endpoint benchmarks"
	$(GO_TEST) -bench=BenchmarkGetCacheSize -benchmem ./internal/media/ 2>&1 | tee bench-cache.log
	$(GO_TEST) -bench=BenchmarkListDirectory -benchmem ./internal/database/ 2>&1 | tee bench-queries.log
	$(GO_TEST) -bench=BenchmarkGetMediaInDirectory -benchmem ./internal/database/ 2>&1 | tee bench-media.log
	$(GO_TEST) -bench=Benchmark.*Endpoint -benchmem ./internal/handlers/ 2>&1 | tee bench-handlers.log
	@echo "Benchmark results saved to bench-*.log files"

test-bench-large:
	@echo "Running large dataset benchmarks (this may take a while)..."
	$(GO_TEST) -bench=.*Large -benchtime=10s -timeout=30m ./internal/database/ ./internal/media/ 2>&1 | tee bench-large.log

test-performance:
	@echo "Running performance tests..."
	$(GO_TEST) -v -run=".*Performance.*" -timeout=30m ./internal/database/ ./internal/media/ ./internal/handlers/ 2>&1 | tee test-performance.log

# Run only unit tests (fast, no external dependencies)
test-unit:
	@echo "Running unit tests (excluding integration)..."
	$(GO_TEST) -short -v -coverprofile=coverage-unit.out -json ./... 2>&1 | tee unit.log | tee test-unit.json | grep -v '"Action":"output"' || true
	@echo ""
	@echo "Unit test coverage:"
	@go tool cover -func=coverage-unit.out | grep total || true

# Run only integration tests (require external dependencies)
test-integration:
	@echo "Running integration tests only..."
	@echo "Note: Integration tests may take longer as they test with real dependencies"
	$(GO_TEST) -v -run=Integration -coverprofile=coverage-integration.out -json ./... 2>&1 | tee integration.log | tee test-integration.json | grep -v '"Action":"output"' || true
	@if [ -f coverage-integration.out ]; then \
		echo ""; \
		echo "Integration test coverage:"; \
		go tool cover -func=coverage-integration.out | grep total || true; \
	fi

# Run all Go tests (unit + integration) with coverage
test-all:
	@echo "Running all tests (unit + integration) with coverage..."
	$(GO_TEST) -v -coverprofile=coverage-all.out ./... 2>&1 | tee all.log
	@echo ""
	@echo "Overall test coverage:"
	@go tool cover -func=coverage-all.out | grep total

# Merge coverage from separate unit and integration test runs
test-coverage-merge:
	@echo "Merging coverage reports..."
	@if [ -f coverage-unit.out ] && [ -f coverage-integration.out ]; then \
		echo "mode: set" > coverage-merged.out; \
		grep -h -v "^mode:" coverage-unit.out coverage-integration.out | sort -u >> coverage-merged.out; \
		go tool cover -html=coverage-merged.out -o coverage-merged.html; \
		echo "Merged coverage report: coverage-merged.html"; \
		go tool cover -func=coverage-merged.out | grep total; \
	else \
		echo "Error: Both coverage-unit.out and coverage-integration.out must exist."; \
		echo "Run 'make test-unit' and 'make test-integration' first."; \
		exit 1; \
	fi

test-clean:
	@echo "Cleaning test artifacts..."
	rm -f coverage.out coverage.html coverage-*.out coverage-*.html test-*.json *.log
	go clean -testcache

# =============================================================================
# PR Check Targets
# =============================================================================

# Detect changed files: committed (vs base branch) + uncommitted/staged
_CHANGED_FILES = $(shell \
	{ git diff --name-only $(PR_BASE)...HEAD 2>/dev/null; \
	  git diff --name-only HEAD 2>/dev/null; \
	  git diff --name-only --cached 2>/dev/null; \
	  git diff --name-only 2>/dev/null; \
	} | sort -u)

# Go backend changes (matches CI "go" filter)
_HAS_GO_CHANGES = $(shell \
	if [ "$(FORCE)" = "1" ]; then echo "1"; \
	elif echo "$(_CHANGED_FILES)" | tr ' ' '\n' | grep -qE '\.go$$|^go\.(mod|sum)$$|^Makefile$$'; then echo "1"; \
	else echo ""; fi)

# Frontend changes (matches CI "frontend" filter)
_HAS_FRONTEND_CHANGES = $(shell \
	if [ "$(FORCE)" = "1" ]; then echo "1"; \
	elif echo "$(_CHANGED_FILES)" | tr ' ' '\n' | grep -qE '^static/'; then echo "1"; \
	else echo ""; fi)

# Run PR checks, only for changed areas (use FORCE=1 to run all)
pr-check:
	@echo "Running PR checks (base: $(PR_BASE))..."
	@echo "Changed files:"
	@echo "$(_CHANGED_FILES)" | tr ' ' '\n' | sed 's/^/  /'
	@echo ""
	@if [ -n "$(_HAS_GO_CHANGES)" ]; then \
		echo "Go changes detected."; \
	else \
		echo "No Go changes detected — skipping backend checks."; \
	fi
	@if [ -n "$(_HAS_FRONTEND_CHANGES)" ]; then \
		echo "Frontend changes detected."; \
	else \
		echo "No frontend changes detected — skipping frontend checks."; \
	fi
	@echo ""
	@# ── Backend checks ──
	@if [ -n "$(_HAS_GO_CHANGES)" ]; then \
		set -e; \
		echo "Step 1: Running Go linter (will auto-fix some lint issues)..."; \
		$(MAKE) lint-fix; \
		echo ""; \
		echo "Step 2: Running Go tests..."; \
		$(MAKE) test; \
		echo ""; \
		echo "Step 3: Running race detector..."; \
		$(MAKE) test-race; \
		echo ""; \
	fi
	@# ── Frontend checks ──
	@if [ -n "$(_HAS_FRONTEND_CHANGES)" ]; then \
		set -e; \
		echo "Step 4: Running frontend checks..."; \
		$(MAKE) frontend-check; \
		echo ""; \
		echo "Step 5: Running frontend unit tests..."; \
		$(MAKE) frontend-test-unit; \
		echo ""; \
		echo "Step 6: Running frontend integration tests (ephemeral server)..."; \
		$(MAKE) frontend-test-integration-auto; \
		echo ""; \
	fi
	@if [ -z "$(_HAS_GO_CHANGES)" ] && [ -z "$(_HAS_FRONTEND_CHANGES)" ]; then \
		echo "No relevant changes detected. Nothing to check!"; \
		echo "  (Use 'make pr-check FORCE=1' to run all checks anyway)"; \
	else \
		echo "All relevant PR checks completed successfully!"; \
	fi

# Force-run all PR checks regardless of changes
pr-check-all:
	@$(MAKE) pr-check FORCE=1

# =============================================================================
# Go Lint Targets
# =============================================================================

lint:
	@echo "Linting Go code..."
	golangci-lint run --config=.golangci.yml

lint-fix:
	@echo "Fixing Go lint issues..."
	golangci-lint run --fix --config=.golangci.yml

# =============================================================================
# Frontend Targets — Setup & Linting
# =============================================================================

frontend-install:
	@echo "Installing frontend dependencies..."
	cd $(STATIC_DIR) && npm install

# Lint all frontend code (JS + CSS)
frontend-lint:
	@echo "Linting frontend code..."
	cd $(STATIC_DIR) && npm run lint

frontend-lint-js:
	@echo "Linting JavaScript..."
	cd $(STATIC_DIR) && npm run lint:js

frontend-lint-css:
	@echo "Linting CSS..."
	cd $(STATIC_DIR) && npm run lint:css

# Fix all frontend lint issues (JS + CSS)
frontend-lint-fix:
	@echo "Fixing frontend lint issues..."
	cd $(STATIC_DIR) && npm run lint:fix

frontend-lint-css-fix:
	@echo "Fixing CSS lint issues..."
	cd $(STATIC_DIR) && npm run lint:css:fix

frontend-format:
	@echo "Formatting frontend code..."
	cd $(STATIC_DIR) && npm run format

frontend-format-check:
	@echo "Checking frontend code formatting..."
	cd $(STATIC_DIR) && npm run format:check

# Run all frontend static checks (lint + format check)
frontend-check:
	@echo "Running all frontend checks..."
	cd $(STATIC_DIR) && npm run check

# =============================================================================
# Frontend Targets — Development
# =============================================================================

# Standalone frontend dev server (no Go backend)
frontend-dev:
	@echo "Starting frontend dev server (standalone)..."
	cd $(STATIC_DIR) && npm run dev

# =============================================================================
# Frontend Targets — Tests
# =============================================================================

# Run all frontend tests (unit + integration + e2e; requires backend)
frontend-test:
	@echo "Running all frontend tests (requires backend for integration/e2e tests)..."
	@echo "Note: Start backend with 'make dev' in another terminal first"
	cd $(STATIC_DIR) && npm test

# Run frontend unit tests (no backend required)
frontend-test-unit:
	@echo "Running frontend unit tests (no backend required)..."
	cd $(STATIC_DIR) && npm run test:unit:only

# Run frontend integration tests (requires backend at TEST_BASE_URL or localhost:8080)
frontend-test-integration:
	@echo "Running frontend integration tests..."
	@echo "Note: Requires backend running (use 'make frontend-test-integration-auto' for automatic server)"
	cd $(STATIC_DIR) && npm run test:integration

# Run frontend integration tests with an ephemeral test server
frontend-test-integration-auto:
	@echo "Running frontend integration tests with ephemeral test server..."
	@./hack/run-with-test-server.sh $(MAKE) frontend-test-integration

# Run frontend E2E tests (requires backend at TEST_BASE_URL or localhost:8080)
frontend-test-e2e:
	@echo "Running frontend E2E tests..."
	@echo "Note: Requires backend running (use 'make frontend-test-e2e-auto' for automatic server)"
	cd $(STATIC_DIR) && npm run test:e2e

# Run frontend E2E tests with an ephemeral test server
frontend-test-e2e-auto:
	@echo "Running frontend E2E tests with ephemeral test server..."
	@./hack/run-with-test-server.sh $(MAKE) frontend-test-e2e

# Run frontend tests with coverage.
# Examples:
#   make frontend-test-coverage (all tests)
#   make frontend-test-coverage favorites
#   make frontend-test-coverage favorites gallery
#   make frontend-test-coverage tests/unit/favorites.test.js
frontend-test-coverage:
	@goals="$(filter-out frontend-test-coverage,$(MAKECMDGOALS))"; \
	files="$${goals:-$(FILE)}"; \
	if [ -z "$$files" ]; then \
		echo "Running all frontend tests with coverage..."; \
		echo "Note: Requires backend running at http://localhost:8080"; \
		cd $(STATIC_DIR) && npm run test:coverage; \
	else \
		cd $(STATIC_DIR) && \
		for file in $$files; do \
			if echo "$$file" | grep -q "\.test\.js$$"; then \
				file_path="$$file"; \
				file_name=$$(echo "$$file" | sed 's|^.*/||' | sed 's|\.test\.js$$||'); \
			else \
				file_path="$$file"; \
				file_name="$$file"; \
			fi; \
			echo "Running coverage for $$file_path... (logging to ../coverage-$$file_name.log)"; \
			npm run test:file -- "$$file_path" --coverage 2>&1 | tee "../coverage-$$file_name.log"; \
		done; \
	fi

# Run frontend unit tests only with coverage
frontend-test-unit-coverage:
	@echo "Running frontend unit tests with coverage..."
	cd $(STATIC_DIR) && npm run test:unit:coverage

# Run frontend unit tests in watch mode
frontend-test-unit-watch:
	@echo "Running frontend unit tests in watch mode..."
	cd $(STATIC_DIR) && npm run test:unit:watch

# Run frontend unit tests with interactive UI
frontend-test-unit-ui:
	@echo "Running frontend unit tests with UI..."
	cd $(STATIC_DIR) && npm run test:unit:ui

# Run specific frontend test files.
# Examples:
#   make frontend-test-file favorites
#   make frontend-test-file favorites gallery
#   make frontend-test-file tests/unit/favorites.test.js
frontend-test-file:
	@goals="$(filter-out frontend-test-file,$(MAKECMDGOALS))"; \
	files="$${goals:-$(FILE)}"; \
	if [ -z "$$files" ]; then \
		echo "Error: Please specify a test file"; \
		echo "Usage: make frontend-test-file <filename>"; \
		echo "Examples:"; \
		echo "  make frontend-test-file favorites"; \
		echo "  make frontend-test-file favorites gallery"; \
		echo "  make frontend-test-file tests/unit/favorites.test.js"; \
		exit 1; \
	fi; \
	cd $(STATIC_DIR) && \
	for file in $$files; do \
		if echo "$$file" | grep -q "\.test\.js$$"; then \
			file_path="$$file"; \
			file_name=$$(echo "$$file" | sed 's|^.*/||' | sed 's|\.test\.js$$||'); \
		else \
			file_path="$$file"; \
			file_name="$$file"; \
		fi; \
		echo "Running tests for $$file_path... (logging to ../$$file_name.test.log)"; \
		npm run test:file -- "$$file_path" 2>&1 | tee "../$$file_name.test.log"; \
	done

# =============================================================================
# Frontend Targets — E2E Tests
# =============================================================================

# Run E2E tests by module/tag.
# Examples:
#   make frontend-test-e2e-module search
#   make frontend-test-e2e-module gallery settings
#   make frontend-test-e2e-module @video
frontend-test-e2e-module:
	@goals="$(filter-out frontend-test-e2e-module,$(MAKECMDGOALS))"; \
	modules="$${goals:-$(MODULE)}"; \
	if [ -z "$$modules" ]; then \
		echo "Error: Please specify a module/tag"; \
		echo "Usage: make frontend-test-e2e-module <module>"; \
		echo "Examples:"; \
		echo "  make frontend-test-e2e-module search"; \
		echo "  make frontend-test-e2e-module gallery settings"; \
		echo "  make frontend-test-e2e-module @video"; \
		echo ""; \
		echo "Available module tags:"; \
		echo "  Core: @auth @core @session"; \
		echo "  UI: @gallery @lightbox @video @navigation"; \
		echo "  Features: @search @settings @playlist @tags @favorites"; \
		echo "  Interaction: @keyboard @mobile @touch"; \
		exit 1; \
	fi; \
	cd $(STATIC_DIR) && \
	for module in $$modules; do \
		tag=$$(echo "$$module" | sed 's/^@//'); \
		echo "Running E2E tests for @$$tag... (logging to ../e2e-$$tag.log)"; \
		npm run test:e2e -- --grep "@$$tag" 2>&1 | tee "../e2e-$$tag.log"; \
	done

# Run E2E tests by category (directory).
# Tests are organized in: core/, features/, ui/, workflows/
# Examples:
#   make frontend-test-e2e-category core
#   make frontend-test-e2e-category features ui
frontend-test-e2e-category:
	@goals="$(filter-out frontend-test-e2e-category,$(MAKECMDGOALS))"; \
	categories="$${goals:-$(CATEGORY)}"; \
	if [ -z "$$categories" ]; then \
		echo "Error: Please specify a category"; \
		echo "Usage: make frontend-test-e2e-category <category>"; \
		echo "Examples:"; \
		echo "  make frontend-test-e2e-category core"; \
		echo "  make frontend-test-e2e-category features ui"; \
		echo ""; \
		echo "Available categories: core, features, ui, workflows"; \
		exit 1; \
	fi; \
	cd $(STATIC_DIR) && \
	for category in $$categories; do \
		echo "Running E2E tests for category: $$category... (logging to ../e2e-category-$$category.log)"; \
		npm run test:e2e -- e2e/specs/$$category/ 2>&1 | tee "../e2e-category-$$category.log"; \
	done

# Run specific E2E spec files.
# Examples:
#   make frontend-test-e2e-file auth
#   make frontend-test-e2e-file gallery search
#   make frontend-test-e2e-file e2e/specs/core/auth.spec.js
frontend-test-e2e-file:
	@goals="$(filter-out frontend-test-e2e-file,$(MAKECMDGOALS))"; \
	files="$${goals:-$(FILE)}"; \
	if [ -z "$$files" ]; then \
		echo "Error: Please specify a spec file"; \
		echo "Usage: make frontend-test-e2e-file <spec>"; \
		echo "Examples:"; \
		echo "  make frontend-test-e2e-file auth"; \
		echo "  make frontend-test-e2e-file gallery search"; \
		echo "  make frontend-test-e2e-file e2e/specs/core/auth.spec.js"; \
		echo ""; \
		echo "Available spec files:"; \
		echo "  Core: auth"; \
		echo "  Features: search, settings, playlist, tags-favorites"; \
		echo "  UI: gallery, lightbox-video"; \
		exit 1; \
	fi; \
	cd $(STATIC_DIR) && \
	for file in $$files; do \
		if echo "$$file" | grep -q "\.spec\.js$$"; then \
			file_path="$$file"; \
			file_name=$$(echo "$$file" | sed 's|^.*/||' | sed 's|\.spec\.js$$||'); \
		elif echo "$$file" | grep -q "e2e/specs/"; then \
			file_path="$$file"; \
			file_name=$$(echo "$$file" | sed 's|^.*/||' | sed 's|\.spec\.js$$||'); \
		else \
			file_path="e2e/specs/**/*$$file*.spec.js"; \
			file_name="$$file"; \
		fi; \
		echo "Running E2E tests for $$file_path... (logging to ../e2e-$$file_name.log)"; \
		npm run test:e2e -- "$$file_path" 2>&1 | tee "../e2e-$$file_name.log"; \
	done

# Run E2E tests in headed mode (visible browser)
frontend-test-e2e-headed:
	@echo "Running E2E tests in headed mode..."
	@echo "Note: Requires backend running at http://localhost:8080"
	cd $(STATIC_DIR) && npm run test:e2e:headed

# Run E2E tests with interactive Playwright UI
frontend-test-e2e-ui:
	@echo "Running E2E tests with interactive UI..."
	@echo "Note: Requires backend running at http://localhost:8080"
	cd $(STATIC_DIR) && npm run test:e2e:ui

# Run E2E tests in debug mode
frontend-test-e2e-debug:
	@echo "Running E2E tests in debug mode..."
	@echo "Note: Requires backend running at http://localhost:8080"
	cd $(STATIC_DIR) && npm run test:e2e:debug

# Generate E2E test coverage report
frontend-test-e2e-coverage:
	@echo "Generating E2E test coverage report..."
	cd $(STATIC_DIR) && npm run test:e2e:coverage
	@echo ""
	@echo "Coverage reports generated:"
	@echo "  HTML:     $(STATIC_DIR)/e2e/coverage-reports/e2e-coverage.html"
	@echo "  Markdown: $(STATIC_DIR)/e2e/coverage-reports/e2e-coverage.md"
	@echo "  JSON:     $(STATIC_DIR)/e2e/coverage-reports/e2e-coverage.json"

# View E2E test HTML report
frontend-test-e2e-report:
	@echo "Opening E2E test report..."
	cd $(STATIC_DIR) && npm run test:e2e:report

# =============================================================================
# Combined Lint / Format / Check Targets
# =============================================================================

lint-all: lint frontend-lint
	@echo "All linting complete."

lint-fix-all: lint-fix frontend-lint-fix
	@echo "All lint fixes applied."

format-all: frontend-format
	@echo "All formatting complete."

check-all: lint frontend-check
	@echo "All checks complete."

# =============================================================================
# Clean Targets
# =============================================================================

clean:
	@echo "Cleaning build artifacts..."
	rm -rf tmp/
	rm -f media-viewer
	rm -f resetpw
	rm -f coverage.out coverage.html
	rm -f *.log

clean-all: clean
	@echo "Cleaning all artifacts including node_modules..."
	rm -rf $(STATIC_DIR)/node_modules

# =============================================================================
# Docker Targets
# =============================================================================

docker-build:
	@echo "Building Docker image..."
	docker build -t media-viewer .

docker-build-dev:
	@echo "Building Docker image for development..."
	docker build -t media-viewer:dev --build-arg VERSION=$(VERSION) --build-arg COMMIT=$(COMMIT) .

docker-run:
	@echo "Running Docker container..."
	docker run --rm -p 8080:8080 -p 9090:9090 media-viewer

# =============================================================================
# Icons
# =============================================================================

icons:
	@echo "Generating PWA icons..."
	@cd static && node generate-icons.js

# =============================================================================
# Documentation
# =============================================================================

docs-serve:
	@echo "Serving documentation with mkdocs..."
	mkdocs serve -a 0.0.0.0:8000

docs-build:
	@echo "Building documentation with mkdocs..."
	mkdocs build

docs-deploy:
	@echo "Deploying documentation with mkdocs..."
	mkdocs gh-deploy

# =============================================================================
# Sample Media
# =============================================================================

download-sample-media:
	@echo "Downloading sample media files..."
	@chmod +x ./hack/download-sample-media.sh
	@./hack/download-sample-media.sh

# =============================================================================
# Setup
# =============================================================================

setup: frontend-install
	@echo "Installing Go tools..."
	go install github.com/air-verse/air@latest
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	@echo "Setup complete."

# =============================================================================
# Help
# =============================================================================

help:
	@echo "Media Viewer Makefile"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Build"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  build              Build the main application"
	@echo "  build-all          Build main application and resetpw tool"
	@echo "  resetpw            Build the password reset tool"
	@echo "  release-build      Build with release optimizations (-s -w)"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Development"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  run                Run the application"
	@echo "  dev                Run with hot reload (air, debug logging)"
	@echo "  dev-info           Run with hot reload (air, info logging)"
	@echo "  dev-proxy          Run frontend with live reload, proxying to Go backend"
	@echo "  dev-frontend       Alias for dev-proxy"
	@echo "  dev-full           Run both Go and frontend dev servers"
	@echo "  frontend-dev       Run standalone frontend dev server (no backend)"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Go Tests"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  test               Run all Go tests"
	@echo "  test-short         Run Go tests in short mode"
	@echo "  test-unit          Run unit tests only (fast, -short flag)"
	@echo "  test-integration   Run integration tests only (-run=Integration)"
	@echo "  test-all           Run all tests with coverage"
	@echo "  test-race          Run tests with race detector"
	@echo ""
	@echo "  test-package       Run tests for specific package(s)"
	@echo "                       make test-package database"
	@echo "                       make test-package database handlers"
	@echo "                       make test-package indexer TESTARGS=\"-run=TestNew\""
	@echo ""
	@echo "  test-failures      Run tests, show only failures"
	@echo "                       make test-failures database"
	@echo ""
	@echo "  test-coverage      Run tests with coverage report"
	@echo "                       make test-coverage"
	@echo "                       make test-coverage database"
	@echo "  test-coverage-report  Display coverage summary (requires prior test-coverage)"
	@echo "  test-coverage-merge   Merge unit + integration coverage reports"
	@echo ""
	@echo "  test-bench              Run all benchmarks"
	@echo "  test-bench-performance  Run targeted performance benchmarks"
	@echo "  test-bench-large        Run large dataset benchmarks"
	@echo "  test-performance        Run performance test suite"
	@echo "  test-clean              Clean test artifacts and cache"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Go Lint"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  lint               Lint Go code"
	@echo "  lint-fix           Fix Go lint issues"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Frontend — Lint & Format"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  frontend-install       Install npm dependencies"
	@echo "  frontend-lint          Lint JS and CSS"
	@echo "  frontend-lint-js       Lint JavaScript only"
	@echo "  frontend-lint-css      Lint CSS only"
	@echo "  frontend-lint-fix      Fix JS and CSS lint issues"
	@echo "  frontend-lint-css-fix  Fix CSS lint issues only"
	@echo "  frontend-format        Format frontend code (Prettier)"
	@echo "  frontend-format-check  Check frontend formatting"
	@echo "  frontend-check         Run all frontend static checks"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Frontend — Tests"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  frontend-test                Run all frontend tests (requires backend)"
	@echo "  frontend-test-unit           Run unit tests (no backend required)"
	@echo "  frontend-test-integration    Run integration tests (requires backend)"
	@echo "  frontend-test-integration-auto  Run integration tests with ephemeral server"
	@echo "  frontend-test-unit-coverage  Run unit tests with coverage"
	@echo "  frontend-test-unit-watch     Run unit tests in watch mode"
	@echo "  frontend-test-unit-ui        Run unit tests with interactive UI"
	@echo ""
	@echo "  frontend-test-file      Run specific test file(s)"
	@echo "                            make frontend-test-file favorites"
	@echo "                            make frontend-test-file favorites gallery"
	@echo ""
	@echo "  frontend-test-coverage  Run tests with coverage"
	@echo "                            make frontend-test-coverage"
	@echo "                            make frontend-test-coverage favorites"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Frontend — E2E Tests"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  frontend-test-e2e           Run all E2E tests (requires backend)"
	@echo "  frontend-test-e2e-auto      Run E2E tests with ephemeral server"
	@echo "  frontend-test-e2e-headed    Run E2E tests with visible browser"
	@echo "  frontend-test-e2e-ui        Run E2E tests with interactive Playwright UI"
	@echo "  frontend-test-e2e-debug     Run E2E tests in debug mode"
	@echo "  frontend-test-e2e-coverage  Generate E2E test coverage report"
	@echo "  frontend-test-e2e-report    View E2E test HTML report"
	@echo ""
	@echo "  frontend-test-e2e-module    Run E2E tests by module/tag"
	@echo "                                make frontend-test-e2e-module search"
	@echo "                                make frontend-test-e2e-module gallery settings"
	@echo "                              Tags: @auth @core @session @gallery @lightbox"
	@echo "                                    @video @search @settings @playlist @tags"
	@echo "                                    @favorites @keyboard @mobile @touch"
	@echo ""
	@echo "  frontend-test-e2e-category  Run E2E tests by category (directory)"
	@echo "                                make frontend-test-e2e-category core"
	@echo "                                make frontend-test-e2e-category features ui"
	@echo "                              Categories: core, features, ui, workflows"
	@echo ""
	@echo "  frontend-test-e2e-file      Run specific E2E spec file(s)"
	@echo "                                make frontend-test-e2e-file auth"
	@echo "                                make frontend-test-e2e-file gallery search"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Combined Targets"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  lint-all           Lint Go and frontend code"
	@echo "  lint-fix-all       Fix all lint issues (Go + frontend)"
	@echo "  format-all         Format all code (frontend)"
	@echo "  check-all          Run all checks (Go lint + frontend checks)"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " PR Checks"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  pr-check           Run checks for changed files only (vs $(PR_BASE))"
	@echo "                       make pr-check"
	@echo "                       make pr-check PR_BASE=develop"
	@echo "  pr-check-all       Run all checks regardless of changes"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Clean"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  clean              Remove build artifacts and logs"
	@echo "  clean-all          Remove all artifacts including node_modules"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Docker"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  docker-build       Build Docker image"
	@echo "  docker-build-dev   Build Docker image for development"
	@echo "  docker-run         Run Docker container"
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo " Other"
	@echo "═══════════════════════════════════════════════════════════════════"
	@echo "  icons              Regenerate PWA icons"
	@echo "  docs-serve         Serve documentation locally (port 8000)"
	@echo "  docs-build         Build documentation site"
	@echo "  docs-deploy        Deploy documentation to GitHub Pages"
	@echo "  download-sample-media  Download free sample media for testing"
	@echo "  setup              Install all development dependencies"
	@echo "  help               Show this help message"

# =============================================================================
# Catch-all target for positional arguments
# =============================================================================
# This allows targets like test-package, frontend-test-file, etc. to accept
# positional arguments (e.g., "make test-package database handlers").
# Make will attempt to "build" each positional arg as a target; this catch-all
# silently succeeds so that the parent target can process them as arguments.
%:
	@:
