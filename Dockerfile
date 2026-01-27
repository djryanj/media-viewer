# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

RUN apk add --no-cache gcc musl-dev

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build main application
RUN CGO_ENABLED=1 GOOS=linux go build -tags 'fts5' -a -o media-viewer .

# Build password reset tool
RUN CGO_ENABLED=1 GOOS=linux go build -tags 'fts5' -a -o resetpw ./cmd/resetpw

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache \
    ffmpeg \
    ca-certificates \
    tzdata \
    sqlite

WORKDIR /app

COPY --from=builder /app/media-viewer .
COPY --from=builder /app/resetpw .
COPY --from=builder /app/static ./static

RUN mkdir -p /media /cache

ENV MEDIA_DIR=/media
ENV CACHE_DIR=/cache
ENV PORT=8080
ENV INDEX_INTERVAL=30m

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/login.html || exit 1

CMD ["./media-viewer"]