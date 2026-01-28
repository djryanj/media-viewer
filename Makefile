VERSION ?= dev
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME ?= $(shell date -u '+%Y-%m-%d_%H:%M:%S')
LDFLAGS := -X 'media-viewer/internal/startup.Version=$(VERSION)' \
           -X 'media-viewer/internal/startup.Commit=$(COMMIT)' \
           -X 'media-viewer/internal/startup.BuildTime=$(BUILD_TIME)'

DIST_DIR := dist
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64

.PHONY: all build run dev test clean docker-build resetpw

BUILD_TAGS := fts5
GO_BUILD := go build -tags '$(BUILD_TAGS)'
GO_RUN := go run -tags '$(BUILD_TAGS)'
GO_TEST := go test -tags '$(BUILD_TAGS)'

all: build

build:
	@echo "Building with FTS5 support..."
	$(GO_BUILD) -o media-viewer .

build-all: build resetpw

resetpw:
	@echo "Building password reset tool..."
	$(GO_BUILD) -o resetpw ./cmd/resetpw

run:
	@echo "Running with FTS5 support..."
	$(GO_RUN) .

dev:
	@echo "Starting development server..."
	air

test:
	@echo "Running tests..."
	$(GO_TEST) -v ./...

clean:
	rm -rf tmp/
	rm -f media-viewer
	rm -f resetpw

docker-build:
	docker build -t media-viewer .

build-all:
	@echo "Building for multiple platforms..."
	@mkdir -p $(DIST_DIR)
	@$(foreach platform,$(PLATFORMS), \
		$(eval OS := $(word 1,$(subst /, ,$(platform)))) \
		$(eval ARCH := $(word 2,$(subst /, ,$(platform)))) \
		echo "Building $(OS)/$(ARCH)..." && \
		GOOS=$(OS) GOARCH=$(ARCH) go build \
			-ldflags "$(LDFLAGS)" \
			-o $(DIST_DIR)/media-viewer-$(VERSION)-$(OS)-$(ARCH) \
			./cmd/server && \
		GOOS=$(OS) GOARCH=$(ARCH) go build \
			-ldflags "$(LDFLAGS)" \
			-o $(DIST_DIR)/usermgmt-$(VERSION)-$(OS)-$(ARCH) \
			./cmd/resetpw || exit 1; \
	)
	@echo "Build complete! Binaries in $(DIST_DIR)/"
