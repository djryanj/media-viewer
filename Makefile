VERSION ?= dev
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME ?= $(shell date -u '+%Y-%m-%d_%H:%M:%S')
LDFLAGS := -X 'media-viewer/internal/startup.Version=$(VERSION)' \
           -X 'media-viewer/internal/startup.Commit=$(COMMIT)' \
           -X 'media-viewer/internal/startup.BuildTime=$(BUILD_TIME)'

DIST_DIR := dist
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64
STATIC_DIR := static

.PHONY: all build build-all run dev dev-info dev-frontend dev-full \
        test test-short test-coverage test-coverage-report test-race test-bench test-clean \
        test-unit test-integration test-all test-coverage-merge pr-check \
        test-package test-failures \
        docker-build docker-run lint lint-fix lint-all lint-fix-all \
        resetpw frontend-install frontend-lint frontend-lint-fix \
        frontend-format frontend-format-check frontend-check frontend-dev \
		icons docs-serve docs-build docs-deploy \
		download-sample-media

# Build configuration
BUILD_TAGS := fts5
GO_BUILD := go build -tags '$(BUILD_TAGS)'
GO_RUN := go run -tags '$(BUILD_TAGS)'
GO_TEST := go test -tags '$(BUILD_TAGS)'

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

dev-frontend:
	@echo "Starting frontend development server with live reload..."
	@cd $(STATIC_DIR) && npm run dev:proxy

dev-full:
	@echo "Starting full development environment (Go + Frontend)..."
	@echo "Press Ctrl+C to stop both servers"
	@trap 'kill 0' INT; \
		LOG_LEVEL=debug air & \
		sleep 2 && cd $(STATIC_DIR) && npm run dev:proxy & \
		wait

# =============================================================================
# Test Targets
# =============================================================================

# Variables for test filtering
PKG ?= ./...
TESTARGS ?=
TESTTIMEOUT ?= 10m

# Catch-all rule to prevent make from treating package names as targets
%:
	@:

test:
	@echo "Running tests..."
	$(GO_TEST) -v ./... 2>&1 | tee test.log

test-short:
	@echo "Running tests (short mode)..."
	$(GO_TEST) -short -v ./... 2>&1 | tee short.log

# Test specific packages
# Automatically resolves short package names (e.g., "indexer" -> "./internal/indexer")
# Examples:
#   make test-package database
#   make test-package database handlers
#   make test-package indexer TESTARGS="-run=TestNew"
#   make test-package ./internal/indexer (also works with full paths)
#   make test-package PKG=indexer (legacy syntax still supported)
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

# Run tests and show only failures
# Examples:
#   make test-failures database
#   make test-failures database handlers
#   make test-failures (all packages)
#   make test-failures indexer TESTARGS="-run=TestNew"
#   make test-failures PKG=handlers (legacy syntax still supported)
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

# Run tests with coverage report
# Automatically resolves short package names (e.g., "indexer" -> "./internal/indexer")
# Examples:
#   make test-coverage (all packages)
#   make test-coverage database
#   make test-coverage database handlers
#   make test-coverage indexer TESTARGS="-run=TestNew"
#   make test-coverage PKG=handlers (legacy syntax still supported)
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

test-coverage-report:
	@echo "Generating coverage report..."
	go tool cover -func=coverage.out

test-race:
	@echo "Running tests with race detector..."
	$(GO_TEST) -race -v ./... 2>&1 | tee race.log

test-bench:
	@echo "Running benchmarks..."
	$(GO_TEST) -bench=. -benchmem ./... 2>&1 | tee bench.log

# Run only unit tests (fast, no integration tag)
# Unit tests are tests that don't require external dependencies
# They use t.Parallel() and should complete quickly
test-unit:
	@echo "Running unit tests (excluding integration)..."
	$(GO_TEST) -short -v -coverprofile=coverage-unit.out -json ./... 2>&1 | tee unit.log | tee test-unit.json | grep -v '"Action":"output"' || true
	@echo "\nUnit test coverage:"
	@go tool cover -func=coverage-unit.out | grep total || true

# Run only integration tests
# Integration tests require external dependencies (database files, ffmpeg, etc.)
# They are marked with integration build tag or skip when testing.Short()
test-integration:
	@echo "Running integration tests only..."
	@echo "Note: Integration tests may take longer as they test with real dependencies"
	$(GO_TEST) -v -run=Integration -coverprofile=coverage-integration.out -json ./... 2>&1 | tee integration.log | tee test-integration.json | grep -v '"Action":"output"' || true
	@if [ -f coverage-integration.out ]; then \
		echo "\nIntegration test coverage:"; \
		go tool cover -func=coverage-integration.out | grep total || true; \
	fi

# Run all tests (unit + integration)
test-all:
	@echo "Running all tests (unit + integration)..."
	$(GO_TEST) -v -coverprofile=coverage-all.out ./... 2>&1 | tee all.log
	@echo "\nOverall test coverage:"
	@go tool cover -func=coverage-all.out | grep total

# Merge coverage from unit and integration tests
test-coverage-merge:
	@echo "Merging coverage reports..."
	@if [ -f coverage-unit.out ] && [ -f coverage-integration.out ]; then \
		echo "mode: set" > coverage-merged.out; \
		grep -h -v "^mode:" coverage-unit.out coverage-integration.out | sort -u >> coverage-merged.out; \
		go tool cover -html=coverage-merged.out -o coverage-merged.html; \
		echo "Merged coverage report: coverage-merged.html"; \
		go tool cover -func=coverage-merged.out | grep total; \
	else \
		echo "Error: Both coverage-unit.out and coverage-integration.out must exist"; \
		exit 1; \
	fi

# Run PR checks: lint fixes, tests, and race detection
# This target runs all checks typically needed before submitting a pull request
pr-check:
	@echo "Running PR checks..."
	@echo "Step 1/3: Running Go linter (will auto-fix some lint issues)..."
	@$(MAKE) lint-fix
	@echo "\nStep 2/3: Running tests..."
	@$(MAKE) test
	@echo "\nStep 3/3: Running race detector..."
	@$(MAKE) test-race
	@echo "\nAll PR checks completed successfully!"

test-clean:
	@echo "Cleaning test artifacts..."
	rm -f coverage.out coverage.html coverage-*.out coverage-*.html test-*.json *.log
	go clean -testcache

# =============================================================================
# Lint Targets (Go)
# =============================================================================

lint:
	@echo "Linting Go code..."
	golangci-lint run

lint-fix:
	@echo "Fixing Go lint issues..."
	golangci-lint run --fix

# =============================================================================
# Frontend Targets
# =============================================================================

frontend-install:
	@echo "Installing frontend dependencies..."
	cd $(STATIC_DIR) && npm install

frontend-lint:
	@echo "Linting frontend code..."
	cd $(STATIC_DIR) && npm run lint

frontend-lint-js:
	@echo "Linting JavaScript..."
	cd $(STATIC_DIR) && npm run lint:js

frontend-lint-css:
	@echo "Linting CSS..."
	cd $(STATIC_DIR) && npm run lint:css

frontend-lint-fix:
	@echo "Fixing frontend lint issues..."
	cd $(STATIC_DIR) && npm run lint:fix

frontend-format:
	@echo "Formatting frontend code..."
	cd $(STATIC_DIR) && npm run format

frontend-format-check:
	@echo "Checking frontend code formatting..."
	cd $(STATIC_DIR) && npm run format:check

frontend-check:
	@echo "Running all frontend checks..."
	cd $(STATIC_DIR) && npm run check

frontend-dev:
	@echo "Starting frontend dev server (standalone)..."
	cd $(STATIC_DIR) && npm run dev

# =============================================================================
# Combined Lint/Format Targets
# =============================================================================

lint-all: lint frontend-lint
	@echo "All linting complete"

lint-fix-all: lint-fix frontend-lint-fix
	@echo "All lint fixes applied"

format-all: frontend-format
	@echo "All formatting complete"

check-all: lint frontend-check
	@echo "All checks complete"

# =============================================================================
# Clean Targets
# =============================================================================

clean:
	@echo "Cleaning build artifacts..."
	rm -rf tmp/
	rm -f media-viewer
	rm -f resetpw
	rm -f coverage.out coverage.html

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
# Release Targets
# =============================================================================

release-build:
	@echo "Building release binaries..."
	$(GO_BUILD) -ldflags "$(LDFLAGS) -s -w" -o media-viewer .
	$(GO_BUILD) -ldflags "$(LDFLAGS) -s -w" -o resetpw ./cmd/resetpw

# =============================================================================
# Setup Targets
# =============================================================================

setup: frontend-install
	@echo "Installing Go tools..."
	go install github.com/air-verse/air@latest
	go install github.com/golangci-lint-lint/golangci-lint@latest
	@echo "Setup complete"


# ===========================================
# Icons
# ===========================================

icons: ## Regenerate PWA icons
	@echo "Generating icons..."
	@cd static && node generate-icons.js

# ===========================================
# Docs
# ===========================================

docs-serve:
	@echo "Serving documentation with mkdocs..."
	mkdocs serve -a 0.0.0.0:8000

docs-build:
	@echo "Building documentation with mkdocs..."
	mkdocs build

docs-deploy:
	@echo "Deploying documentation with mkdocs..."
	mkdocs gh-deploy

# ===========================================
# Sample Media
# ===========================================

download-sample-media:
	@echo "Downloading sample media files..."
	@chmod +x ./hack/download-sample-media.sh
	@./hack/download-sample-media.sh

# =============================================================================
# Help
# =============================================================================

help:
	@echo "Media Viewer Makefile"
	@echo ""
	@echo "Build targets:"
	@echo "  build            Build the main application"
	@echo "  build-all        Build main application and resetpw tool"
	@echo "  resetpw          Build the password reset tool"
	@echo "  release-build    Build with release optimizations"
	@echo ""
	@echo "Development targets:"
	@echo "  run              Run the application"
	@echo "  dev              Run with hot reload (air)"
	@echo "  dev-frontend     Run frontend with live reload (browser-sync)"
	@echo "  dev-full         Run both Go and frontend dev servers"
	@echo ""
	@echo "Test targets:"
	@echo "  test                     Run all tests"
	@echo "  test-short               Run tests in short mode"
	@echo "  test-package             Run tests for a specific package"
	@echo "                           Usage: make test-package PKG=<package> [TESTARGS='-run=TestName'] [TESTTIMEOUT=10m]"
	@echo "                           Examples:"
	@echo "                             make test-package PKG=indexer"
	@echo "                             make test-package PKG=handlers TESTARGS='-run=TestHealth'"
	@echo "                             make test-package PKG=./internal/indexer (full path also works)"
	@echo "  test-coverage            Run tests with coverage report"
	@echo "                           Usage: make test-coverage [PKG=<package>] [TESTARGS='-run=TestName']"
	@echo "                           Examples:"
	@echo "                             make test-coverage (all packages)"
	@echo "                             make test-coverage PKG=indexer"
	@echo "                             make test-coverage PKG=handlers TESTARGS='-run=TestHealth'"
	@echo "  test-coverage-report     Display coverage report summary"
	@echo "  test-race                Run tests with race detector"
	@echo "  test-bench               Run benchmarks"
	@echo "  test-clean               Clean test artifacts"
	@echo ""
	@echo "Lint targets (Go):"
	@echo "  lint             Lint Go code"
	@echo "  lint-fix         Fix Go lint issues"
	@echo ""
	@echo "Frontend targets:"
	@echo "  frontend-install      Install npm dependencies"
	@echo "  frontend-lint         Lint JS and CSS"
	@echo "  frontend-lint-fix     Fix JS and CSS lint issues"
	@echo "  frontend-format       Format frontend code"
	@echo "  frontend-format-check Check frontend formatting"
	@echo "  frontend-check        Run all frontend checks"
	@echo "  frontend-dev          Run standalone frontend dev server"
	@echo ""
	@echo "Combined targets:"
	@echo "  lint-all         Lint Go and frontend code"
	@echo "  lint-fix-all     Fix all lint issues"
	@echo "  check-all        Run all checks"
	@echo ""
	@echo "Clean targets:"
	@echo "  clean            Remove build artifacts"
	@echo "  clean-all        Remove all artifacts including node_modules"
	@echo ""
	@echo "Docker targets:"
	@echo "  docker-build     Build Docker image"
	@echo "  docker-build-dev Build Docker image for development"
	@echo "  docker-run       Run Docker container"
	@echo ""
	@echo "Icons targets:"
	@echo "  icons            Regenerate PWA icons"
	@echo ""
	@echo "Documentation targets:"
	@echo "  docs-serve       Serve documentation locally (port 8000)"
	@echo "  docs-build       Build documentation site"
	@echo "  docs-deploy      Deploy documentation to GitHub Pages"
	@echo ""
	@echo "Sample data targets:"
	@echo "  download-sample-media Download free sample images/videos for testing"
	@echo ""
	@echo "Setup targets:"
	@echo "  setup            Install all development dependencies"
	@echo ""
	@echo "Other:"
	@echo "  help             Show this help message"
