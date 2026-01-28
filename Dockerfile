# syntax=docker/dockerfile:1

# Build stage
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS builder

# Install xx for cross-compilation
COPY --from=tonistiigi/xx:1.9.0 / /

ARG TARGETPLATFORM
ARG BUILDPLATFORM
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown

WORKDIR /app

# Install build dependencies for the build platform
RUN apk add --no-cache \
    clang \
    lld \
    make \
    git

# Install target platform dependencies
RUN xx-apk add --no-cache \
    gcc \
    g++ \
    musl-dev \
    sqlite-dev

# Copy go mod files first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the main application using xx-clang
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=1 \
    GOOS=$(xx-info os) \
    GOARCH=$(xx-info arch) \
    CC="xx-clang" \
    CXX="xx-clang++" \
    go build \
    -tags 'fts5 netgo osusergo' \
    -ldflags "-s -w -extldflags '-static' \
    -X 'media-viewer/internal/startup.Version=${VERSION}' \
    -X 'media-viewer/internal/startup.Commit=${COMMIT}' \
    -X 'media-viewer/internal/startup.BuildTime=${BUILD_TIME}'" \
    -a -o media-viewer . && \
    xx-verify --static media-viewer

# Build password reset tool
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=1 \
    GOOS=$(xx-info os) \
    GOARCH=$(xx-info arch) \
    CC="xx-clang" \
    CXX="xx-clang++" \
    go build \
    -tags 'fts5 netgo osusergo' \
    -ldflags "-s -w -extldflags '-static' \
    -X 'media-viewer/internal/startup.Version=${VERSION}' \
    -X 'media-viewer/internal/startup.Commit=${COMMIT}' \
    -X 'media-viewer/internal/startup.BuildTime=${BUILD_TIME}'" \
    -a -o resetpw ./cmd/resetpw && \
    xx-verify --static resetpw

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