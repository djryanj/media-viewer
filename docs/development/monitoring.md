# Development Monitoring Stack

This guide covers the monitoring stack for local development and performance testing using Docker Compose, Prometheus, and Grafana.

## Overview

The `hack/` directory contains a complete monitoring stack that includes:

- **Media Viewer** - Main application with metrics enabled
- **Prometheus** - Metrics collection and storage
- **Grafana** - Visualization and dashboards

This stack is pre-configured with:

- Automatic dashboard provisioning
- Optimized GC settings for testing
- Cross-platform support (Linux, macOS, Windows)
- Network accessibility for testing from multiple devices

## Quick Start

### 1. Configure Media Directory

Edit `hack/docker-compose.yml` to set your media directory path:

```yaml
volumes:
    # Windows
    - C:\Users\YourName\Videos\media-viewer:/media

    # Linux
    - /home/yourname/media-viewer:/media

    # macOS
    - /Users/yourname/media-viewer:/media
```

### 2. Start the Stack

**Linux/macOS:**

```bash
cd hack
./start-monitoring.sh
```

**Windows PowerShell:**

```powershell
cd hack
.\start-monitoring.ps1
```

**Or manually:**

```bash
cd hack
docker-compose up -d
```

### 3. Access Services

Once running, access the services at:

- **Media Viewer**: http://localhost:8081
- **Prometheus**: http://localhost:9091
- **Grafana**: http://localhost:3001 (admin/admin)

**Note:** These use different host ports than the standard setup to avoid conflicts. The main application is on port 8081 (instead of 8080), Prometheus on 9091 (instead of 9090), and Grafana on 3001 (instead of 3000).

**Network Access:** If you cannot access via `localhost`, use your machine's IP address. Find it with:

```bash
# Windows
ipconfig

# Linux/macOS
ip addr show  # or ifconfig
```

Then access: `http://192.168.1.100:8081` (use your actual IP)

For detailed network troubleshooting, see `hack/NETWORK-ACCESS.md`.

## Helper Scripts

### Start Monitoring Stack

Automatically starts Docker Compose and checks service health:

**Linux/macOS:**

```bash
cd hack
./start-monitoring.sh
```

**Windows PowerShell:**

```powershell
cd hack
.\start-monitoring.ps1
```

### Generate Load

Generate realistic load for performance testing (runs for 5 minutes by default):

**Linux/macOS:**

```bash
# Default - hits localhost:8081
./generate-load.sh

# Custom URL
BASE_URL=http://192.168.1.100:8081 ./generate-load.sh

# Custom duration (10 minutes)
DURATION=600 ./generate-load.sh
```

**Windows PowerShell:**

```powershell
# Default
.\generate-load.ps1

# Custom URL
.\generate-load.ps1 -BaseUrl "http://192.168.1.100:8081"

# Custom duration (10 minutes)
.\generate-load.ps1 -Duration 600
```

**What it does:**

- Hits public health check endpoints (`/readyz`, `/healthz`)
- Generates memory allocation load
- No authentication required
- Safe for continuous testing

## Performance Testing Workflow

### 1. Establish Baseline

Start with the default configuration:

```bash
cd hack
docker-compose up -d
# Wait 5-10 minutes for metrics to stabilize
```

Record baseline metrics in Grafana:

- GC CPU Fraction: ****\_**%**
- GC Frequency: ****\_**** GCs/min
- P95 Thumbnail Time: ****\_**** ms
- Memory Usage: ****\_**%**

### 2. Run Load Tests

Generate load to stress test the application:

```bash
# Linux/macOS
./generate-load.sh

# Windows
.\generate-load.ps1
```

### 3. Test Configuration Changes

Edit `docker-compose.yml` to test different settings:

```yaml
environment:
    # Test MEMORY_RATIO
    - MEMORY_RATIO=0.70

    # Or test GOGC
    - GOGC=150
```

Restart and monitor:

```bash
docker-compose restart media-viewer
# Wait 5-10 minutes for steady state
```

### 4. Compare Results

Use Grafana's time range selector to overlay different periods and compare:

- GC CPU overhead changes
- GC frequency changes
- Memory usage patterns
- Throughput improvements

## Key Metrics to Monitor

### GC Performance

| Metric                            | Target             | Interpretation                     |
| --------------------------------- | ------------------ | ---------------------------------- |
| `media_viewer_go_gc_cpu_fraction` | < 3%               | Percentage of CPU time spent in GC |
| GC Frequency                      | < 10 GCs/min       | How often garbage collection runs  |
| GC Pause Duration                 | < 5ms (individual) | Stop-the-world pause time          |
| GC Pause Budget                   | < 10ms/sec (total) | Total pause time per second        |

### Memory Metrics

| Metric                            | Target | Interpretation                   |
| --------------------------------- | ------ | -------------------------------- |
| `media_viewer_memory_usage_ratio` | < 85%  | Memory usage vs configured limit |
| Allocation Rate                   | varies | MB/sec being allocated           |
| Heap Size                         | varies | Current Go heap size             |

### Application Performance

| Metric              | Target  | Interpretation                  |
| ------------------- | ------- | ------------------------------- |
| P95 Thumbnail Time  | < 500ms | 95th percentile generation time |
| P95 API Latency     | < 100ms | 95th percentile request latency |
| Cache Hit Rate      | > 80%   | Thumbnail cache efficiency      |
| Indexing Throughput | varies  | Files processed per second      |

## Prometheus Queries

Access Prometheus at http://localhost:9091/graph and run these queries:

### GC Performance

```promql
# GC CPU overhead (percentage)
media_viewer_go_gc_cpu_fraction * 100

# GC frequency (GCs per minute)
rate(media_viewer_go_gc_runs_total[5m]) * 60

# GC pause budget (ms per second)
rate(media_viewer_go_gc_pause_total_seconds[5m]) * 1000

# Memory pressure (% of GOMEMLIMIT)
media_viewer_go_memalloc_bytes / media_viewer_go_memlimit_bytes * 100
```

### Application Performance

```promql
# P95 thumbnail generation time
histogram_quantile(0.95,
  rate(media_viewer_thumbnail_generation_duration_seconds_bucket{type="image"}[5m]))

# P95 API latency
histogram_quantile(0.95,
  rate(media_viewer_http_request_duration_seconds_bucket[5m]))

# Request rate
rate(media_viewer_http_requests_total[5m])

# Cache hit rate
rate(media_viewer_thumbnail_cache_hits_total[5m])
  /
(rate(media_viewer_thumbnail_cache_hits_total[5m])
  + rate(media_viewer_thumbnail_cache_misses_total[5m]))
```

## Grafana Dashboard

The stack includes a pre-built dashboard with panels for:

- **HTTP Performance**: Request rates, latencies, error rates
- **Garbage Collection**: CPU overhead, frequency, pause times
- **Memory Usage**: Heap size, allocation rate, pressure
- **Indexing**: Throughput, batch performance, errors
- **Thumbnails**: Generation time, cache efficiency, phase timing
- **Database**: Query performance, transaction rates

The dashboard is automatically loaded on startup.

### Manual Import

If the dashboard doesn't load automatically:

1. Go to Dashboards → Import in Grafana
2. Upload `hack/grafana/dashboard.json`

## Configuration Testing

### Default Configuration

The stack starts with optimized production settings:

```yaml
environment:
    - MEMORY_LIMIT=2147483648 # 2 GiB
    - MEMORY_RATIO=0.75 # Recommended for production
```

**Expected results:**

- GC CPU overhead: ~0.16%
- GC frequency: 0.2/s idle, 6/s under load
- Adaptive behavior based on workload

### Testing GOGC

Test fixed GC targeting instead of memory ratio:

```yaml
environment:
    - GOGC=150
    # Comment out MEMORY_RATIO when using GOGC
```

**Expected results:**

- GC CPU overhead: ~0.15%
- GC frequency: ~4.5/s (constant)
- Predictable behavior regardless of load

### Testing Different MEMORY_RATIO Values

```yaml
environment:
    # More memory for Go heap (more caching)
    - MEMORY_RATIO=0.80

    # Less memory for Go heap (more for FFmpeg/CGO)
    - MEMORY_RATIO=0.70
```

## Troubleshooting

### Cannot Access Services

**Symptom:** Cannot connect to http://localhost:8081

**Solutions:**

1. **Check containers are running:**

    ```bash
    docker-compose ps
    ```

    All should show "Up" status.

2. **Check port conflicts:**

    ```bash
    # Windows
    netstat -ano | findstr "8081"

    # Linux/macOS
    lsof -i :8081
    ```

3. **Use host IP instead of localhost:**

    ```bash
    # Find your IP
    ipconfig  # Windows
    ip addr   # Linux

    # Access via IP
    http://192.168.1.100:8081
    ```

4. **Check firewall (Windows):**

    Ports may need to be allowed through Windows Firewall if accessing from another machine.

See `hack/NETWORK-ACCESS.md` for detailed troubleshooting.

### No Metrics Showing in Grafana

**Check Prometheus scraping:**

```bash
# Check targets
curl http://localhost:9091/api/v1/targets

# Check metrics endpoint
curl http://localhost:8081/metrics | grep media_viewer_go_gc
```

**Check Prometheus target status:**

Visit http://localhost:9091/targets - should show `media-viewer (1/1 up)`

### Container Won't Start

**Check logs:**

```bash
docker-compose logs media-viewer
```

**Rebuild if needed:**

```bash
docker-compose build --no-cache media-viewer
docker-compose up -d
```

### Media Directory Mount Error

**Windows:**

1. Ensure directory exists: `Test-Path "D:\path\to\media"`
2. Check Docker Desktop → Settings → Resources → File Sharing
3. Ensure drive is shared and restart Docker Desktop

**Linux/macOS:**

1. Check permissions: `ls -la /path/to/media`
2. Ensure directory exists: `mkdir -p /path/to/media`

## Benchmark Results

Based on real-world testing with 3,106 thumbnail generation:

### Before Optimization (Manual GC)

| Metric              | Value  |
| ------------------- | ------ |
| GC CPU Overhead     | 1.88%  |
| GC Frequency (idle) | 31/sec |
| GC Frequency (load) | 31/sec |
| Memory Usage        | 502 MB |

### After Optimization (MEMORY_RATIO=0.75)

| Metric              | Value   | Improvement |
| ------------------- | ------- | ----------- |
| GC CPU Overhead     | 0.16%   | ↓ 91%       |
| GC Frequency (idle) | 0.2/sec | ↓ 99%       |
| GC Frequency (load) | 6/sec   | ↓ 80%       |
| Memory Usage        | 534 MB  | +6%         |

### Configuration Comparison

| Configuration         | GC CPU %  | Idle GC/s | Load GC/s | Behavior        |
| --------------------- | --------- | --------- | --------- | --------------- |
| Original (Manual GC)  | 1.88%     | 31        | 31        | Fixed           |
| GOGC=150              | 0.15%     | 4.5       | 4.5       | Fixed           |
| **MEMORY_RATIO=0.75** | **0.16%** | **0.2**   | **6**     | **Adaptive** ✅ |

## Data Persistence

All data is persisted in Docker volumes:

```bash
# List volumes
docker volume ls | grep hack

# Backup Grafana dashboards
docker cp hack-grafana-1:/var/lib/grafana/dashboards ./backup/

# Clean up everything (WARNING: deletes all data)
docker-compose down -v
```

## Production Notes

The monitoring stack in `hack/` is designed for development and testing. For production deployment:

1. **Secure Grafana:**

    ```yaml
    environment:
        - GF_SECURITY_ADMIN_PASSWORD=<strong-password>
    ```

2. **Increase Prometheus retention:**

    ```yaml
    command:
        - '--storage.tsdb.retention.time=30d'
    ```

3. **Add resource limits:**
    ```yaml
    deploy:
        resources:
            limits:
                memory: 1G
                cpus: '0.5'
    ```

See the [Metrics & Monitoring](../admin/metrics.md) documentation for production deployment guidance.

## See Also

- [Memory & GC Tuning](../admin/memory-tuning.md) - Detailed tuning guide with benchmarks
- [Metrics Reference](../admin/metrics.md) - Complete metrics documentation
- [Architecture Overview](architecture.md) - System architecture and design
- [Testing Guide](testing.md) - Backend testing practices

## Additional Resources

The `hack/` directory contains additional documentation:

- **ARCHITECTURE.md** - Port mappings and network architecture
- **NETWORK-ACCESS.md** - Network troubleshooting guide
- **GC-MONITORING.md** - Historical GC tuning guide (see [Memory Tuning](../admin/memory-tuning.md) for current docs)
