# libvips Integration

## Overview

Media Viewer uses [libvips](https://www.libvips.org/) for memory-efficient thumbnail generation. libvips provides decode-time downsampling for JPEG images, which dramatically reduces memory usage compared to standard image libraries.

## Memory Benefits

**Standard Image Processing:**

- Load full 6000x4000 JPEG → 96MB in memory
- Resize to 1600x1600 → 10MB
- Peak memory: 106MB per image

**With libvips:**

- Decode directly to 1600x1600 → 10MB
- Peak memory: 10MB per image
- **~90% memory reduction** for large images

## Installation

### Docker (Included)

The official Docker image includes libvips automatically. No additional setup required.

### Development (Local)

libvips must be installed on your system for development builds:

**macOS (Homebrew):**

```bash
brew install vips
```

**Ubuntu/Debian:**

```bash
sudo apt-get install libvips-dev
```

**Alpine Linux:**

```bash
apk add vips-dev
```

**Fedora/RHEL:**

```bash
sudo dnf install vips-devel
```

**Windows:**
Download pre-built binaries from: https://github.com/libvips/build-win64-mxe

### Building Without libvips

If libvips is not installed, the application will:

1. Log a warning: `Failed to initialize libvips (will use fallback methods)`
2. Use two-stage resize for large JPEGs (less efficient but functional)
3. Fall back to standard imaging library for all other formats

The application remains fully functional without libvips, just with higher memory usage for large JPEG files.

## Configuration

libvips is initialized automatically when thumbnail generation is enabled. Configuration:

```go
vips.Startup(&vips.Config{
    ConcurrencyLevel: 1,              // Single image at a time
    MaxCacheMem:      50 * 1024 * 1024, // 50MB cache
    MaxCacheSize:     100,              // Max 100 operations
})
```

These conservative settings prevent memory bloat while still providing excellent performance.

!!! warning "Writable /tmp Directory Required"
    libvips requires a writable `/tmp` directory for temporary file operations during image processing. Ensure your container or system has:
    
    - `/tmp` mounted with write permissions
    - Sufficient disk space in `/tmp` (at least 1GB recommended)
    - No `noexec` flag on the `/tmp` mount
    
    **Docker users:** The default Docker configuration provides a writable `/tmp`. No action needed.
    
    **Custom deployments:** If running with read-only root filesystem, ensure `/tmp` is mounted as a writable tmpfs volume:
    
    ```yaml
    volumes:
      - type: tmpfs
        target: /tmp
    ```

## Monitoring

Check if libvips is active:

1. **Startup logs:**

    ```
    [INFO] libvips initialized successfully (version: 8.15.0)
    ```

2. **Debug logs during thumbnail generation:**

    ```
    [DEBUG] Successfully loaded image.jpg using libvips
    ```

3. **If unavailable:**

    ```
    [WARN] Failed to initialize libvips: ... (will use fallback methods)
    ```

4. **Memory metrics:**
   Monitor `media_viewer_thumbnail_memory_usage_bytes` - should be dramatically lower for large JPEGs when libvips is active.

## Troubleshooting

### "/tmp Not Writable"

**Symptoms:**

- libvips initialization fails
- Errors mentioning temporary files
- "Permission denied" errors during image processing

**Cause:** libvips cannot write to `/tmp` directory

**Solution:**

1. **Check /tmp permissions:**
   ```bash
   ls -ld /tmp
   # Should show: drwxrwxrwt (permissions 1777)
   ```

2. **Fix permissions if needed:**
   ```bash
   sudo chmod 1777 /tmp
   ```

3. **For read-only containers:**
   Mount tmpfs for `/tmp`:
   ```yaml
   volumes:
     - type: tmpfs
       target: /tmp
       tmpfs:
         size: 1G
   ```

4. **Set alternative temp directory:**
   ```bash
   export TMPDIR=/writable/path
   ```

### "Failed to initialize libvips"

**Cause:** libvips shared library not found

**Solution:**

- Ensure libvips is installed: `vips --version`
- Check library path: `ldconfig -p | grep vips` (Linux)
- Set `LD_LIBRARY_PATH` if needed: `export LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH`

### High Memory Usage Despite libvips

**Check:**

1. Verify libvips initialization in logs
2. Check file types - libvips only used for JPEG currently
3. Monitor debug logs to confirm vips is being used
4. PNG/WebP files still use standard library (higher memory)

### Build Errors

**CGO Required:**
libvips requires CGO. Ensure:

```bash
CGO_ENABLED=1 go build
```

**Missing Headers:**
Install development packages:

- Ubuntu: `libvips-dev`
- macOS: Headers included with `brew install vips`

## Performance Characteristics

| Image Size | Format | Standard Library | With libvips | Reduction |
| ---------- | ------ | ---------------- | ------------ | --------- |
| 6000x4000  | JPEG   | ~106MB           | ~10MB        | 90%       |
| 4000x3000  | JPEG   | ~60MB            | ~10MB        | 83%       |
| 2000x1500  | JPEG   | ~15MB            | ~10MB        | 33%       |
| 1600x1200  | JPEG   | ~10MB            | ~10MB        | 0%        |
| Any        | PNG    | Varies           | Not used     | N/A       |

Memory reduction is most dramatic for large JPEG files (>4MP).

## Future Enhancements

Potential improvements:

- Extend libvips to PNG/WebP formats
- Use vips thumbnail pipeline for even lower memory
- Implement vips streaming for very large files
- Add vips-based image transformations (rotate, crop)

## References

- [libvips Homepage](https://www.libvips.org/)
- [govips Library](https://github.com/davidbyttow/govips)
- [libvips Performance](https://github.com/libvips/libvips/wiki/Speed-and-memory-use)
