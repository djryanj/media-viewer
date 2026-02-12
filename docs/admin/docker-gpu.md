# GPU Support in Docker

This document explains how to enable GPU-accelerated video transcoding in Docker deployments.

## Overview

The application supports three GPU acceleration methods:

- **NVIDIA NVENC** - NVIDIA GPUs (amd64 and arm64)
- **Intel/AMD VA-API** - Intel Quick Sync and AMD GPUs (amd64 only)
- **Apple VideoToolbox** - macOS (not applicable to Docker)

**Architecture Notes:**

- **amd64/x86_64**: Supports both NVIDIA and VA-API GPU acceleration
- **arm64**: Supports NVIDIA GPU acceleration only (no Intel/AMD VA-API hardware)
- Both architectures fall back to CPU transcoding if no GPU is available

The Docker images are multi-architecture and automatically install the appropriate GPU drivers based on the target platform.

## Dockerfile

The `Dockerfile` includes VA-API support for x86_64/amd64 platforms via Alpine's ffmpeg package and VA-API libraries.

**Architecture Support:**

- **amd64/x86_64**: Full VA-API support with Intel/AMD GPU drivers
- **arm64**: CPU transcoding only (VA-API packages excluded)

The Dockerfile automatically detects the target architecture and only installs VA-API packages on amd64 builds, keeping arm64 images smaller and avoiding unnecessary dependencies.

**Pros:**

- Optimized for each architecture
- Works with Intel/AMD GPUs on x86_64
- CPU fallback always available
- Smaller arm64 images

**Cons:**

- Limited NVIDIA GPU support (depends on Alpine ffmpeg build)

## Docker Runtime Configuration

GPU support requires runtime configuration to expose GPU devices to the container.

### NVIDIA GPU (NVENC)

**Prerequisites:**

- NVIDIA GPU with NVENC support
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed on host

**Docker Compose:**

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        runtime: nvidia # Use NVIDIA runtime
        environment:
            - GPU_ACCEL=nvidia # or 'auto'
        volumes:
            - ./media:/media:ro
            - ./cache:/cache
            - ./database:/database
```

**Docker Run:**

```bash
docker run -d \
  --name media-viewer \
  --gpus all \
  -e GPU_ACCEL=nvidia \
  -v /path/to/media:/media:ro \
  -v /path/to/cache:/cache \
  -v /path/to/database:/database \
  -p 8080:8080 \
  ghcr.io/djryanj/media-viewer:latest
```

**Verification:**
Check logs for:

```
[INFO] ✓ GPU acceleration enabled: nvidia (encoder: h264_nvenc)
```

### Intel/AMD GPU (VA-API)

**Prerequisites:**

- Intel GPU with Quick Sync or AMD GPU with VCE/VCN
- `/dev/dri` devices available on host

**Docker Compose:**

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest
        devices:
            - /dev/dri:/dev/dri # Map DRI devices
        environment:
            - GPU_ACCEL=vaapi # or 'auto'
        volumes:
            - ./media:/media:ro
            - ./cache:/cache
            - ./database:/database
```

**Docker Run:**

```bash
docker run -d \
  --name media-viewer \
  --device=/dev/dri:/dev/dri \
  -e GPU_ACCEL=vaapi \
  -v /path/to/media:/media:ro \
  -v /path/to/cache:/cache \
  -v /path/to/database:/database \
  -p 8080:8080 \
  ghcr.io/djryanj/media-viewer:latest
```

**Verification:**
Check logs for:

```
[INFO] ✓ Found DRI device: /dev/dri/renderD128
[INFO] ✓ GPU acceleration enabled: vaapi (encoder: h264_vaapi)
```

### Auto-Detection

Use `GPU_ACCEL=auto` (the default) to automatically detect and use any available GPU:

```yaml
environment:
    - GPU_ACCEL=auto # Tests NVIDIA, VA-API, VideoToolbox in order
```

The application will:

1. Check for NVIDIA GPU and test NVENC
2. Check for VA-API devices and test h264_vaapi
3. Fall back to CPU encoding if no GPU works

## Troubleshooting

### Check GPU Device Access

**NVIDIA:**

```bash
# Check if NVIDIA GPU is visible in container
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

**VA-API:**

```bash
# Check if DRI devices exist
ls -la /dev/dri/

# Check permissions (should be accessible to container user)
stat /dev/dri/renderD128
```

### Enable Debug Logging

Set `DEBUG=1` to see detailed GPU detection and encoder test output:

```yaml
environment:
    - DEBUG=1
    - GPU_ACCEL=auto
```

Look for logs like:

```
[DEBUG] Checking GPU encoder: vaapi (accel=vaapi, encoder=h264_vaapi, filter="format=nv12,hwupload")
[DEBUG]   Device check passed for vaapi
[DEBUG] Testing h264_vaapi with real encode (accel=vaapi, filter="format=nv12,hwupload")...
[DEBUG]   Adding video filter: format=nv12,hwupload
[DEBUG]   Adding VA-API qp: 30
[DEBUG]   Running: ffmpeg [...]
[INFO] ✓ GPU acceleration enabled: vaapi (encoder: h264_vaapi)
```

### Common Issues

**"No GPU encoder available"**

- For NVIDIA: Ensure NVIDIA Container Toolkit is installed and `--gpus all` is used
- For VA-API: Verify `/dev/dri` devices exist and are mapped with `--device`
- Check that ffmpeg has the required encoders: `docker exec media-viewer ffmpeg -encoders | grep h264`

**"Hardware initialization failed"**

- VA-API: Install correct drivers on host (intel-media-driver or mesa-va-gallium)
- NVIDIA: Update GPU drivers and ensure NVENC is enabled
- Check device permissions (user must have access to GPU devices)

**Transcoding works but still using CPU**

- Verify GPU_ACCEL is set correctly
- Check logs for GPU detection messages
- Look for `[GPU: ...]` tag in transcode start logs

### Performance Monitoring

Check if GPU is being used for transcodes:

```bash
# Watch container logs
docker logs -f media-viewer

# Look for:
[INFO] Using GPU encoder: h264_vaapi (vaapi) with filters: format=nv12,hwupload
[INFO] FFmpeg started [GPU: vaapi/h264_vaapi], streaming to client...
```

Monitor GPU usage:

**NVIDIA:**

```bash
nvidia-smi -l 1
```

**Intel:**

```bash
intel_gpu_top
```

**AMD:**

```bash
radeontop
```

## Building GPU-Optimized Image

To build with the enhanced GPU support:

```bash
docker build -f Dockerfile.gpu -t media-viewer:gpu .
```

Or use in docker-compose:

```yaml
services:
    media-viewer:
        build:
            context: .
            dockerfile: Dockerfile.gpu
        # ... rest of configuration
```

## Kubernetes Deployment

For Kubernetes, GPU device plugins are required:

**NVIDIA:**

```yaml
apiVersion: v1
kind: Pod
metadata:
    name: media-viewer
spec:
    containers:
        - name: media-viewer
          image: ghcr.io/djryanj/media-viewer:latest
          env:
              - name: GPU_ACCEL
                value: 'nvidia'
          resources:
              limits:
                  nvidia.com/gpu: 1 # Request 1 GPU
```

**Intel/AMD (Manual Device Mount):**

```yaml
apiVersion: v1
kind: Pod
metadata:
    name: media-viewer
spec:
    containers:
        - name: media-viewer
          image: ghcr.io/djryanj/media-viewer:latest
          env:
              - name: GPU_ACCEL
                value: 'vaapi'
          volumeMounts:
              - name: dri
                mountPath: /dev/dri
    volumes:
        - name: dri
          hostPath:
              path: /dev/dri
```

**Intel GPU with Device Plugin:**

If using the [Intel GPU Device Plugin](https://github.com/intel/intel-device-plugins-for-kubernetes), you can request GPU resources:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
    name: media-viewer
spec:
    template:
        spec:
            nodeSelector:
                intel.feature.node.kubernetes.io/gpu: 'true'
            containers:
                - name: media-viewer
                  image: ghcr.io/djryanj/media-viewer:latest
                  env:
                      - name: GPU_ACCEL
                        value: 'vaapi'
                  resources:
                      requests:
                          gpu.intel.com/i915: '1'
                      limits:
                          gpu.intel.com/i915: '1'
```

Note: The Intel GPU Device Plugin automatically mounts `/dev/dri` devices when GPU resources are requested.

## Performance Expectations

With GPU acceleration enabled:

- **2-5x faster** transcode times vs CPU
- **50-80% lower** CPU usage during transcoding
- Especially beneficial for:
    - 4K/8K video
    - Multiple concurrent transcodes
    - Systems with limited CPU capacity

Example: 4K HEVC video → 1080p H.264

- CPU only: ~30-45 seconds
- NVIDIA NVENC: ~8-12 seconds
- Intel VA-API: ~10-15 seconds
