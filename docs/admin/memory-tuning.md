# Memory and Garbage Collection Tuning

This guide explains how to optimize memory usage and garbage collection (GC) performance for Media Viewer.

## Quick Start

### For Production (Containerized Deployments)

**Recommended configuration** for Docker/Kubernetes with library of ~40,000 mixed items:

```yaml
environment:
    - MEMORY_LIMIT=2147483648 # 2 GiB
    - MEMORY_RATIO=0.75
```

**Result:** 0.16% GC overhead under heavy load, adaptive behavior, excellent memory efficiency.

### For Simple Deployments (No Container Limits)

**Alternative configuration** for bare metal/VMs:

```yaml
environment:
    - GOGC=150
```

**Result:** 0.15% GC overhead, predictable behavior, simple configuration.

## Benchmark Results

Real-world testing with 3,106 thumbnail generation (heavy image processing workload):

| Configuration            | Idle GC Rate | Load GC Rate | GC CPU %  | Peak Memory | Behavior               |
| ------------------------ | ------------ | ------------ | --------- | ----------- | ---------------------- |
| **Original (Manual GC)** | 31/s         | >31/s        | 1.88%     | 502 MB      | ❌ Excessive           |
| **GOGC=150**             | 4.5/s        | 4.5/s        | 0.15%     | 502 MB      | ✅ Good (predictable)  |
| **MEMORY_RATIO=0.75**    | 0.2/s        | 6/s          | **0.16%** | **534 MB**  | ✅ **Best (adaptive)** |

### Why MEMORY_RATIO=0.75 is Optimal

1. **Adaptive Performance**: Scales GC frequency with workload
    - Idle: 0.2 GCs/second (near-zero overhead)
    - Heavy load: 6 GCs/second (still excellent)
    - Automatically adjusts to allocation patterns

2. **Memory Bounded**: Respects container resource limits
    - Works with Kubernetes/Docker memory constraints
    - Never triggers out-of-memory conditions
    - Grew to only 33% of 1.61 GB limit under heavy load

3. **Better Caching**: More memory for application data
    - 534 MB vs 502 MB (6% more cache space)
    - Larger thumbnail cache improves performance
    - More room for image buffers and decoded frames

4. **Production Ready**: Designed for real-world deployments
    - Container-aware
    - Handles allocation spikes (235 MB/s peak tested)
    - No manual tuning required

## Understanding GC Metrics

### GC CPU Fraction

**Metric:** `media_viewer_go_gc_cpu_fraction`

**What it measures:** Percentage of CPU time spent in garbage collection.

**How to interpret:**

- **0.00 - 0.03 (0-3%)**: ✅ Excellent - GC overhead is minimal
- **0.03 - 0.05 (3-5%)**: ⚠️ Acceptable - Some overhead but manageable
- **0.05 - 0.10 (5-10%)**: ⚠️ High - Consider tuning
- **> 0.10 (>10%)**: ❌ Critical - GC consuming too much CPU

**Example:**

```
GC CPU Fraction: 0.085 (8.5%)
Meaning: 8.5% of CPU time is spent on garbage collection
Impact: Application is ~9% slower than optimal
```

### GC Pause Duration

**Metric:** `media_viewer_go_gc_pause_last_seconds`

**What it measures:** Duration of the most recent stop-the-world GC pause.

**How to interpret:**

- **< 1ms**: ✅ Excellent - Barely noticeable
- **1-5ms**: ✅ Good - Acceptable for most workloads
- **5-10ms**: ⚠️ Noticeable - May cause small latency spikes
- **> 10ms**: ❌ Poor - Will cause visible request latency

**Why it matters:** During GC pauses, ALL goroutines stop. A 10ms pause means HTTP requests, database queries, and thumbnail generation are all delayed by 10ms.

### GC Frequency

**Metric:** `rate(media_viewer_go_gc_runs_total[5m])`

**What it measures:** How many garbage collections occur per second.

**How to interpret:**

- **< 1 GC/s**: ✅ Excellent - Infrequent, efficient collection
- **1-5 GC/s**: ✅ Good - Reasonable frequency
- **5-10 GC/s**: ⚠️ High - Consider tuning
- **> 10 GC/s**: ❌ Excessive - Memory pressure or poor configuration

**Why it matters:** Each GC has overhead (pause, CPU cycles, cache invalidation).

### Memory Usage Ratio

**Metric:** `media_viewer_memory_usage_ratio`

**What it measures:** Current memory usage as a fraction of the configured limit.

**How to interpret:**

- **< 0.70 (70%)**: Plenty of headroom
- **0.70 - 0.85 (70-85%)**: Normal operating range
- **0.85 - 0.95 (85-95%)**: High utilization, GC becomes aggressive
- **> 0.95 (95%)**: Critical - may trigger memory pressure pauses

## Configuration Approaches

### Approach 1: MEMORY_RATIO (Recommended)

**Best for:** Containerized deployments with memory limits (Docker, Kubernetes)

#### Docker Compose Example

```yaml
services:
    media-viewer:
        environment:
            - MEMORY_LIMIT=2147483648 # 2 GiB
            - MEMORY_RATIO=0.75
        deploy:
            resources:
                limits:
                    memory: 2G
```

#### Kubernetes Example

```yaml
env:
    - name: MEMORY_LIMIT
      valueFrom:
          resourceFieldRef:
              resource: limits.memory
    - name: MEMORY_RATIO
      value: '0.75'
resources:
    limits:
        memory: 2Gi
```

#### How It Works

MEMORY_RATIO sets what percentage of container memory is allocated to the Go heap. The remaining memory is available for:

- Operating system overhead
- FFmpeg video processing
- CGO allocations (libvips image processing)
- File system cache

**Values:**

- `0.75` (recommended): 75% for Go heap, 25% for other components
- `0.80`: More cache, less headroom for FFmpeg/CGO
- `0.70`: More headroom for heavy video transcoding

#### Monitoring

Watch for:

- GC CPU overhead < 1%
- Memory usage < 80% of limit
- No memory pressure pauses (`media_viewer_memory_gc_pauses_total`)

### Approach 2: GOGC

**Best for:** Non-containerized deployments, simple setups, unlimited memory

#### Configuration

```yaml
environment:
    - GOGC=150
```

#### How It Works

`GOGC` sets the percentage of heap growth before triggering GC:

- **GOGC=100** (Go default): GC triggers at 2x live heap
    - Example: 200 MB heap → GC at 400 MB

- **GOGC=150** (recommended): GC triggers at 2.5x live heap
    - Example: 200 MB heap → GC at 500 MB
    - Result: 33% fewer GCs

- **GOGC=200** (aggressive): GC triggers at 3x live heap
    - Example: 200 MB heap → GC at 600 MB
    - Result: 50% fewer GCs

#### When to Use

- Running on bare metal or VMs (not containerized)
- No memory limits set
- Want simple, fixed configuration
- Have abundant memory available

## Tuning Process

### Step 1: Establish Baseline

Enable metrics and run under typical load:

```bash
# Check current GC metrics
curl http://localhost:9091/metrics | grep -E "gc_cpu|gc_runs|memory_usage"
```

Record baseline values:

- GC CPU Fraction: **\_\_\_\_**
- GC Frequency: **\_\_\_\_**
- Memory Usage Ratio: **\_\_\_\_**

### Step 2: Choose Configuration

**If containerized (Docker/Kubernetes):**

```yaml
MEMORY_RATIO=0.75
```

**If not containerized:**

```yaml
GOGC=150
```

### Step 3: Monitor Results

Watch Prometheus metrics:

```promql
# GC CPU overhead percentage
media_viewer_go_gc_cpu_fraction * 100

# GC frequency (per second)
rate(media_viewer_go_gc_runs_total[5m])

# Memory pressure
media_viewer_memory_usage_ratio * 100
```

### Step 4: Adjust if Needed

#### If GC overhead is still high (>3%)

**With MEMORY_RATIO:**

- Increase container memory limit
- Ensure MEMORY_LIMIT env var is set correctly

**With GOGC:**

- Increase GOGC value (try 200)
- Ensure you have enough memory

#### If memory usage is too high (>90%)

**With MEMORY_RATIO:**

- Lower to 0.70 (more headroom for FFmpeg/CGO)
- Or increase container memory

**With GOGC:**

- Lower GOGC value (try 100)
- Or add memory to the system

## Common Scenarios

### High GC Frequency

**Symptoms:**

- GC runs > 10/second
- GC CPU fraction > 5%
- High allocation rate

**Solution (preferred):**

```yaml
environment:
    - MEMORY_LIMIT=2147483648 # Ensure adequate memory
    - MEMORY_RATIO=0.75
```

**Solution (alternative):**

```yaml
environment:
    - GOGC=200 # Increase to reduce frequency
```

### Memory Pressure

**Symptoms:**

- Memory usage > 85% of limit
- GC CPU fraction high (>8%)
- Memory pressure pauses

**Solution:**

```yaml
environment:
    - MEMORY_RATIO=0.70 # Was 0.75 - give more headroom
```

Or increase container memory:

```yaml
deploy:
    resources:
        limits:
            memory: 3G # Was 2G
```

### Long GC Pauses

**Symptoms:**

- Individual GC pauses > 10ms
- Latency spikes in API requests
- Large heap size

**Analysis:**

- Longer but less frequent pauses are often acceptable
- Check if it affects user experience
- Monitor P95/P99 request latency

**If truly problematic:**

- Lower GOGC (reduces heap size)
- Or accept the trade-off for better throughput

### Out of Memory Kills

**Symptoms:**

- Container restarts unexpectedly
- Memory usage hits 100%
- OOM errors in logs

**Immediate fix:**

```yaml
environment:
    - MEMORY_RATIO=0.70 # Was 0.75 or higher
```

**Better solution:**

```yaml
deploy:
    resources:
        limits:
            memory: 3G # Increase container memory
```

## Performance Metrics

### Before Optimization

With manual `runtime.GC()` calls in hot paths:

| Metric              | Value  |
| ------------------- | ------ |
| GC CPU Overhead     | 1.88%  |
| GC Frequency (idle) | 31/sec |
| GC Frequency (load) | 31/sec |
| Peak Memory         | 502 MB |
| Behavior            | Fixed  |

### After Optimization (MEMORY_RATIO=0.75)

| Metric              | Value    | Change    |
| ------------------- | -------- | --------- |
| GC CPU Overhead     | 0.16%    | ↓ 91%     |
| GC Frequency (idle) | 0.2/sec  | ↓ 99%     |
| GC Frequency (load) | 6/sec    | ↓ 80%     |
| Peak Memory         | 534 MB   | +6% cache |
| Behavior            | Adaptive | ✅        |

### After Optimization (GOGC=150)

| Metric              | Value   | Change      |
| ------------------- | ------- | ----------- |
| GC CPU Overhead     | 0.15%   | ↓ 92%       |
| GC Frequency (idle) | 4.5/sec | ↓ 85%       |
| GC Frequency (load) | 4.5/sec | ↓ 85%       |
| Peak Memory         | 502 MB  | Stable      |
| Behavior            | Fixed   | Predictable |

## Monitoring with Prometheus

### Key Queries

```promql
# GC CPU overhead percentage
media_viewer_go_gc_cpu_fraction * 100

# GC frequency (per second)
rate(media_viewer_go_gc_runs_total[5m])

# Average GC pause time (milliseconds)
rate(media_viewer_go_gc_pause_total_seconds[5m]) * 1000

# Memory pressure (% of limit)
media_viewer_go_memalloc_bytes / media_viewer_go_memlimit_bytes * 100

# Allocation rate (MB/second)
rate(media_viewer_go_memalloc_bytes[5m]) / 1024 / 1024
```

### Grafana Dashboard

A pre-built dashboard with GC monitoring is available at:

```
hack/grafana/dashboard.json
```

The dashboard includes:

- GC CPU overhead over time
- GC frequency trends
- Memory usage ratio
- Pause time distribution
- Allocation rate patterns

## Alerting

### Example Prometheus Alerts

```yaml
# High GC overhead
- alert: HighGCOverhead
  expr: media_viewer_go_gc_cpu_fraction > 0.05
  for: 10m
  annotations:
      summary: 'GC consuming >5% of CPU'
      description: 'Consider increasing GOGC or container memory'

# Memory pressure
- alert: MemoryPressure
  expr: media_viewer_memory_usage_ratio > 0.90
  for: 5m
  annotations:
      summary: 'Memory usage >90% of limit'
      description: 'May trigger aggressive GC or OOM'

# Excessive GC frequency
- alert: ExcessiveGC
  expr: rate(media_viewer_go_gc_runs_total[5m]) > 10
  for: 10m
  annotations:
      summary: 'More than 10 GCs per second'
      description: 'GC running too frequently, tune configuration'
```

## Advanced Topics

### GOMEMLIMIT Direct Configuration

For non-containerized deployments, you can set GOMEMLIMIT directly:

```bash
# Set 4 GiB memory limit
GOMEMLIMIT=4GiB

# Or in bytes
GOMEMLIMIT=4294967296
```

**When to use:**

- Running without containers
- Want explicit memory limit
- Not using MEMORY_RATIO

**Note:** MEMORY_RATIO calculates GOMEMLIMIT automatically from container limits, which is preferred for containerized deployments.

### Allocation Rate Analysis

Monitor allocation patterns to understand GC behavior:

```promql
# Allocation rate during indexing
rate(media_viewer_go_memalloc_bytes[5m])
  and on() media_viewer_indexer_running == 1

# Allocation rate during thumbnail generation
rate(media_viewer_go_memalloc_bytes[1m])
  and on() rate(media_viewer_thumbnail_generations_total[1m]) > 0
```

**Typical rates:**

- Idle: 1-5 MB/s
- Light browsing: 5-20 MB/s
- Thumbnail generation: 50-150 MB/s
- Heavy transcoding: 100-300 MB/s

### Heap Size vs GC Frequency Trade-off

Understanding the fundamental trade-off:

| Configuration | Heap Size | GC Frequency | Pros                          | Cons                |
| ------------- | --------- | ------------ | ----------------------------- | ------------------- |
| GOGC=50       | Smaller   | High         | Low memory use                | High CPU overhead   |
| GOGC=100      | Medium    | Medium       | Balanced (Go default)         | Moderate of both    |
| GOGC=150      | Larger    | Low          | Low CPU overhead              | More memory needed  |
| GOGC=200      | Largest   | Very low     | Minimal GC overhead           | Highest memory need |
| MEMORY_RATIO  | Dynamic   | Adaptive     | Best of both, container-aware | Requires limits     |

## Troubleshooting

### GC metrics not improving after tuning

**Check:**

1. Configuration actually applied: `curl http://localhost:9091/metrics | grep memlimit`
2. Container has enough memory: `docker stats`
3. No memory leaks: Monitor `media_viewer_go_memsys_bytes` over days

### Container being OOM killed

**Solutions:**

1. Lower MEMORY_RATIO: `0.70` instead of `0.75`
2. Increase container memory limit
3. Reduce concurrent operations (INDEX_WORKERS, thumbnail workers)

### Still seeing high GC frequency with MEMORY_RATIO

**Check:**

1. MEMORY_LIMIT env var is set correctly
2. Container memory limit matches MEMORY_LIMIT
3. Not hitting the limit (check `media_viewer_memory_usage_ratio`)

### Memory usage growing endlessly

**This suggests a memory leak:**

1. Monitor `media_viewer_go_memsys_bytes` over time
2. Check if it stabilizes or keeps growing
3. File a bug report with metrics data

## See Also

- [Metrics Reference](metrics.md) - Detailed metrics documentation
- [Environment Variables](environment-variables.md) - Configuration reference
- [Server Configuration](server-config.md) - Performance tuning options
- [Go GC Guide](https://tip.golang.org/doc/gc-guide) - Official Go documentation
