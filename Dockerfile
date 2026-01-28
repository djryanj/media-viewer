# Build stage
FROM --platform=$TARGETPLATFORM golang:1.25-alpine AS builder

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown

WORKDIR /app

# Install build dependencies for CGO (required for SQLite)
RUN apk add --no-cache \
    gcc \
    musl-dev \
    sqlite-dev

# Copy go mod files first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build static binary with CGO enabled (required for SQLite FTS5)
# No need to set GOOS/GOARCH - we're building natively for each platform
RUN CGO_ENABLED=1 go build \
    -tags 'fts5 netgo osusergo' \
    -ldflags "-s -w -extldflags '-static' \
    -X 'media-viewer/internal/startup.Version=${VERSION}' \
    -X 'media-viewer/internal/startup.Commit=${COMMIT}' \
    -X 'media-viewer/internal/startup.BuildTime=${BUILD_TIME}'" \
    -a -o media-viewer .

# Build password reset tool
RUN CGO_ENABLED=1 go build \
    -tags 'netgo osusergo' \
    -ldflags "-s -w -extldflags '-static' \
    -X 'media-viewer/internal/startup.Version=${VERSION}' \
    -X 'media-viewer/internal/startup.Commit=${COMMIT}' \
    -X 'media-viewer/internal/startup.BuildTime=${BUILD_TIME}'" \
    -a -o resetpw ./cmd/resetpw

# Runtime stage
FROM alpine:3.23

# Install runtime dependencies
RUN apk add --no-cache \
    ffmpeg \
    ca-certificates \
    tzdata \
    sqlite

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
ENV MEDIA_DIR=/media
ENV CACHE_DIR=/cache
ENV DATABASE_DIR=/database
ENV PORT=8080
ENV INDEX_INTERVAL=30m

# Expose port
EXPOSE 8080

# Switch to unprivileged user
USER nobody:nobody

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/readyz || exit 1

# Run the application
CMD ["./media-viewer"]