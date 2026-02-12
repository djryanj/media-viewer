# GPU Support in Docker

This document explains how to enable GPU-accelerated video transcoding in Docker deployments.

## Overview

The application supports three GPU acceleration methods:

- **NVIDIA NVENC** - NVIDIA GPUs (requires Debian-based image)
- **Intel/AMD VA-API** - Intel Quick Sync and AMD GPUs (amd64 only)
- **Apple VideoToolbox** - macOS (not applicable to Docker)

**Important:** NVIDIA GPU support requires using `Dockerfile.nvidia` (Debian-based) instead of the standard Alpine-based Dockerfile. See [Docker Images](#docker-images) section below.

**Architecture Notes:**

- **amd64/x86_64**: Supports both NVIDIA (Debian image) and VA-API (any image) GPU acceleration
- **arm64**: Supports NVIDIA GPU acceleration only (Debian image), no Intel/AMD VA-API hardware
- Both architectures fall back to CPU transcoding if no GPU is available

## Docker Images

### Standard Dockerfile (Alpine-based)

The standard `Dockerfile` uses Alpine Linux and includes VA-API support for Intel/AMD GPUs.

**GPU Support:**

- **Intel/AMD VA-API**: ✅ Fully supported on amd64
- **NVIDIA NVENC**: ❌ **Not compatible**
- **Reason**: Alpine uses musl libc, but NVIDIA drivers require glibc

**Architecture Support:**

- **amd64/x86_64**: Full VA-API support with Intel/AMD GPU drivers
- **arm64**: CPU transcoding only (VA-API packages excluded)

**Pros:**

- Smallest image size (~150MB)
- Fast builds
- Works with Intel/AMD GPUs on x86_64
- CPU fallback always available

**Cons:**

- **Cannot use NVIDIA GPUs** due to musl/glibc incompatibility

### Dockerfile.nvidia (Debian-based)

**Required for NVIDIA GPU support.** Uses Debian Bookworm for glibc compatibility with NVIDIA drivers.

**GPU Support:**

- **NVIDIA NVENC**: ✅ Fully supported (glibc-compatible)
- **Intel/AMD VA-API**: ❌ Not included (use standard Dockerfile for VA-API)

**Why Debian?**

NVIDIA drivers are compiled against glibc and cannot be loaded in musl-based Alpine containers, even with NVIDIA Container Toolkit properly configured. The Debian base provides the necessary glibc runtime.

**Architecture Support:**

- **amd64/x86_64**: Full NVIDIA GPU support
- **arm64**: Full NVIDIA GPU support

**Published Image Tags:**

```bash
# Latest stable release with NVIDIA support
docker pull ghcr.io/djryanj/media-viewer:latest-nvidia

# Specific version with NVIDIA support
docker pull ghcr.io/djryanj/media-viewer:v1.0.0-nvidia
```

**Building from Source** (optional):

```bash
docker build -f Dockerfile.nvidia -t media-viewer:nvidia .
```

**Pros:**

- Full NVIDIA GPU support
- Compatible with NVIDIA Container Toolkit
- Works with `--gpus all` flag

**Cons:**

- Larger image size (~300MB vs ~150MB for Alpine)
- No VA-API support (use standard Dockerfile for Intel/AMD GPUs)

## Docker Runtime Configuration

GPU support requires runtime configuration to expose GPU devices to the container.

### NVIDIA GPU (NVENC)

**Prerequisites:**

- NVIDIA GPU with NVENC support
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed on host
- **Must use `:latest-nvidia` or `:vX.X.X-nvidia` image tags** (Debian-based) - Standard Alpine-based image is incompatible
- **Windows users:** See [Windows/WSL2 Setup](#windowswsl2-setup) section for additional requirements

**Pull the NVIDIA-optimized image:**

```bash
docker pull ghcr.io/djryanj/media-viewer:latest-nvidia
```

**Docker Compose:**

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest-nvidia  # Use NVIDIA-optimized image
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
  media-viewer:nvidia
```

**Verification:**
Check logs for:

```
[INFO] ✓ GPU acceleration enabled: nvidia (encoder: h264_nvenc)
```

### Intel/AMD GPU (VA-API)

**Use the standard Alpine-based image** (`:latest` or `:vX.X.X` tags without `-nvidia` suffix).

**Prerequisites:**

- Intel GPU with Quick Sync or AMD GPU with VCE/VCN
- `/dev/dri` devices available on host

**Docker Compose:**

```yaml
services:
    media-viewer:
        image: ghcr.io/djryanj/media-viewer:latest  # Standard image, not -nvidia
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

### Windows/WSL2 Setup

If you're running Docker Desktop on Windows with WSL2, NVIDIA GPU passthrough requires additional setup:

**Prerequisites:**

1. Windows 11 or Windows 10 version 21H2 or higher
2. NVIDIA GPU drivers installed in Windows (not WSL2)
3. WSL2 enabled and updated
4. Docker Desktop with WSL2 backend enabled

**Steps:**

1. **Install NVIDIA drivers in Windows** (not inside WSL2):
    - Download from [NVIDIA website](https://www.nvidia.com/download/index.aspx)
    - Version must be 510.06 or higher for WSL2 support

2. **Verify GPU visibility in WSL2:**

    ```bash
    # Inside WSL2 terminal
    nvidia-smi
    ```

    Should show your GPU. If not, update Windows and GPU drivers.

3. **Install NVIDIA Container Toolkit in WSL2:**

    ```bash
    # Inside WSL2 terminal
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

    sudo apt-get update
    sudo apt-get install -y nvidia-container-toolkit
    ```

4. **Configure Docker in WSL2:**

    ```bash
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker
    ```

5. **Test GPU access:**

    ```bash
    docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
    ```

    Should display your GPU information. If this fails, the application won't see the GPU either.

6. **Run media-viewer with GPU:**
    ```bash
    docker run --rm --name media-viewer \
      --gpus all \
      -e GPU_ACCEL=nvidia \
      -e LOG_LEVEL=debug \
      -v D:\media:/media:ro \
      -p 8081:8080 \
      ghcr.io/djryanj/media-viewer:latest-nvidia
    ```

**Common Windows/WSL2 Issues:**

- **"no such file or directory" for /dev/nvidia\*** - NVIDIA Container Toolkit not installed in WSL2
- **"nvidia-smi not found" in WSL2** - Windows GPU drivers outdated (need 510.06+)
- **GPU works in Windows but not WSL2** - WSL needs update: `wsl --update`
- **Docker Desktop doesn't see GPU** - Ensure WSL2 backend is enabled in Docker Desktop settings

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

### Common Issues

**NVIDIA GPU: "No GPU encoder available" despite `nvidia-smi` working in test container**

This means you're using the **Alpine-based standard image**, which is incompatible with NVIDIA drivers:

- Alpine Linux uses musl libc, NVIDIA drivers require glibc
- Even with NVIDIA Container Toolkit and `--gpus all`, Alpine cannot load NVIDIA libraries
- **Solution**: Use the NVIDIA-optimized Debian-based image:
    ```bash
    docker pull ghcr.io/djryanj/media-viewer:latest-nvidia
    docker run --rm --gpus all -e GPU_ACCEL=nvidia ghcr.io/djryanj/media-viewer:latest-nvidia
    ```
- Test with Alpine images will always fail: `docker run --rm --gpus all alpine:latest nvidia-smi` ❌
- Test with Debian works: `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi` ✅

**"No GPU encoder available" / "stat /dev/nvidia0: no such file or directory"**

This means the container cannot see the GPU devices:

- **Linux:** Ensure NVIDIA Container Toolkit is installed and `--gpus all` flag is used
- **Windows/WSL2:** Follow the complete [Windows/WSL2 Setup](#windowswsl2-setup) above - the `--gpus all` flag alone is not enough
- Test with: `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`
- If the test fails, the toolkit isn't properly configured

**VA-API: "stat /dev/dri/renderD128: no such file or directory"**

- Verify `/dev/dri` devices exist on host: `ls -la /dev/dri/`
- Ensure devices are mapped: `--device=/dev/dri:/dev/dri`
- Check that ffmpeg has VA-API support: `docker exec media-viewer ffmpeg -encoders | grep vaapi`

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
          image: ghcr.io/djryanj/media-viewer:latest-nvidia  # Use NVIDIA-optimized image
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
          image: ghcr.io/djryanj/media-viewer:latest  # Use standard image (not -nvidia)
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
                  image: ghcr.io/djryanj/media-viewer:latest  # Use standard image (not -nvidia)
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
