FROM mcr.microsoft.com/devcontainers/javascript-node:24-trixie

ARG GO_VERSION=1.26.2

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    g++ \
    gcc \
    git \
    libc6-dev \
    make \
    pkg-config \
    tar \
    && rm -rf /var/lib/apt/lists/* \
    && arch="$(dpkg --print-architecture)" \
    && case "${arch}" in \
    amd64) go_arch='amd64' ;; \
    arm64) go_arch='arm64' ;; \
    *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-${go_arch}.tar.gz" \
    && rm -rf /usr/local/go \
    && tar -C /usr/local -xzf /tmp/go.tar.gz \
    && rm -f /tmp/go.tar.gz \
    && mkdir -p /go/bin /go/pkg /go/src \
    && chown -R node:node /go

ENV GOPATH=/go
ENV PATH=/usr/local/go/bin:/go/bin:${PATH}
