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
	docker build -t djryanj.azurecr.io/media-viewer .
