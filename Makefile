VERSION ?= dev
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME ?= $(shell date -u '+%Y-%m-%d_%H:%M:%S')
LDFLAGS := -X 'media-viewer/internal/startup.Version=$(VERSION)' \
           -X 'media-viewer/internal/startup.Commit=$(COMMIT)' \
           -X 'media-viewer/internal/startup.BuildTime=$(BUILD_TIME)'

DIST_DIR := dist
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64
STATIC_DIR := static

.PHONY: all build build-all run dev dev-frontend dev-full test clean \
        docker-build docker-run lint lint-fix lint-all lint-fix-all \
        resetpw frontend-install frontend-lint frontend-lint-fix \
        frontend-format frontend-format-check frontend-check frontend-dev \
		icons

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
	$(GO_BUILD) -ldflags "$(LDFLAGS)" -o media-viewer .

build-all: build resetpw

resetpw:
	@echo "Building password reset tool..."
	$(GO_BUILD) -ldflags "$(LDFLAGS)" -o resetpw ./cmd/resetpw

# =============================================================================
# Development Targets
# =============================================================================

run:
	@echo "Running with FTS5 support..."
	$(GO_RUN) .

dev:
	@echo "Starting Go development server with hot reload..."
	LOG_LEVEL=debug air

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

test:
	@echo "Running tests..."
	$(GO_TEST) -v ./...

test-coverage:
	@echo "Running tests with coverage..."
	$(GO_TEST) -v -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

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
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	@echo "Setup complete"


# ===========================================
# Icons
# ===========================================

icons: ## Regenerate PWA icons
	@echo "Generating icons..."
	@cd static && node generate-icons.js

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
	@echo "  test             Run all tests"
	@echo "  test-coverage    Run tests with coverage report"
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
	@echo "Setup targets:"
	@echo "  setup            Install all development dependencies"
	@echo ""
	@echo "Other:"
	@echo "  help             Show this help message"
