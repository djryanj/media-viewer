# Extend whatever base image your runner pods currently use
# Common bases for ARC:
FROM ghcr.io/actions/actions-runner:latest
# OR if you're using the controller's built-in runner:
# FROM summerwind/actions-runner:latest

# Switch to root to install packages
USER root

# Install all CI dependencies in a single layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libvips-dev \
        ffmpeg \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Switch back to the runner user
USER runner
