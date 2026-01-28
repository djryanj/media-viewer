# Build stage
FROM --platform=$TARGETPLATFORM golang:1.25-alpine AS builder

ARG TARGETPLATFORM
ARG BUILDPLATFORM
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown

WORKDIR /app

# Install build dependencies including cross-compilation tools
# This allows native compilation speed even when cross-compiling
RUN apk add --no-cache \
    gcc \
    g++ \
    musl-dev \
    sqlite-dev \
    # Cross-compilation tools for ARM64
    gcc-aarch64-none-elf \
    # Additional useful tools
    make \
    git

# Copy go mod files first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build with proper cross-compilation setup
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    if [ "$TARGETARCH" = "arm64" ] && [ "$BUILDPLATFORM" != "$TARGETPLATFORM" ]; then \
    # Cross-compiling to ARM64
    export CC=aarch64-linux-musl-gcc; \
    export CXX=aarch64-linux-musl-g++; \
    export AR=aarch64-linux-musl-ar; \
    fi && \
    CGO_ENABLED=1 \
    GOOS=${TARGETOS} \
    GOARCH=${TARGETARCH} \
    go build \
    -tags 'fts5 netgo osusergo' \
    -ldflags "-s -w -extldflags '-static' \
    -X 'media-viewer/internal/startup.Version=${VERSION}' \
    -X 'media-viewer/internal/startup.Commit=${COMMIT}' \
    -X 'media-viewer/internal/startup.BuildTime=${BUILD_TIME}'" \
    -a -o media-viewer .

# Build password reset tool
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    if [ "$TARGETARCH" = "arm64" ] && [ "$BUILDPLATFORM" != "$TARGETPLATFORM" ]; then \
    export CC=aarch64-linux-musl-gcc; \
    export CXX=aarch64-linux-musl-g++; \
    export AR=aarch64-linux-musl-ar; \
    fi && \
    CGO_ENABLED=1 \
    GOOS=${TARGETOS} \
    GOARCH=${TARGETARCH} \
    go build \
    -tags 'netgo osusergo' \
    -ldflags "-s -w -extldflags '-static' \
    -X 'media-viewer/internal/startup.Version=${VERSION}' \
    -X 'media-viewer/internal/startup.Commit=${COMMIT}' \
    -X 'media-viewer/internal/startup.BuildTime=${BUILD_TIME}'" \
    -a -o resetpw ./cmd/resetpw

# Runtime stage
FROM alpine:3.23

# Install runtime dependencies in a single layer
RUN apk add --no-cache \
    ffmpeg \
    ca-certificates \
    tzdata \
    sqlite \
    && rm -rf /var/cache/apk/*

# Create directories with proper permissions
RUN mkdir -p /media /cache /database && \
    chown -R nobody:nobody /media /cache /database

# Copy binaries from builder
COPY --from=builder /app/media-viewer /app/media-viewer
COPY --from=builder /app/resetpw /app/resetpw

# Copy static files
COPY --from=builder /app/static /app/static

# Set ownership of application files
RUN chown -R nobody:nobody /app

WORKDIR /app

# Environment variables
ENV MEDIA_DIR=/media \
    CACHE_DIR=/cache \
    DATABASE_DIR=/database \
    PORT=8080 \
    INDEX_INTERVAL=30m

# Expose port
EXPOSE 8080

# Switch to unprivileged user
USER nobody:nobody

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/readyz || exit 1

# Run the application
CMD ["./media-viewer"]