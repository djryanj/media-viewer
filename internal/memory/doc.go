// Package memory provides memory management utilities for controlling Go's
// runtime memory usage in containerized environments.
//
// # Overview
//
// When running in Kubernetes or other container orchestrators, Go applications
// can be OOM-killed if they exceed their memory limits. Unlike GOMAXPROCS,
// which Go automatically detects from cgroup CPU limits, GOMEMLIMIT must be
// configured explicitly.
//
// This package provides utilities to:
//   - Configure GOMEMLIMIT from Kubernetes Downward API environment variables
//   - Reserve memory for non-heap allocations (FFmpeg, CGO, memory-mapped files)
//   - Monitor memory usage and provide backpressure signals
//
// # Configuration
//
// The simplest way to use this package is to call [ConfigureFromEnv] early in
// your main function, before any significant allocations occur:
//
//	func main() {
//	    memory.ConfigureFromEnv()
//	    // ... rest of application
//	}
//
// # Environment Variables
//
// The following environment variables control memory configuration:
//
//   - GOMEMLIMIT: Standard Go environment variable. If set, takes precedence
//     over all other configuration. Accepts values like "400MiB" or "1GiB".
//
//   - MEMORY_LIMIT: Container memory limit in bytes. Typically set via
//     Kubernetes Downward API (see example below). This is the raw value
//     from which GOMEMLIMIT is calculated.
//
//   - MEMORY_RATIO: Percentage of MEMORY_LIMIT to use for Go heap, expressed
//     as a decimal between 0.0 and 1.0. Default is 0.85 (85%). Lower this
//     value if your application spawns memory-intensive subprocesses or
//     uses significant CGO/mmap memory.
//
// # Kubernetes Configuration
//
// To pass the container memory limit to your application, use the Kubernetes
// Downward API in your deployment manifest:
//
//	spec:
//	  containers:
//	  - name: myapp
//	    resources:
//	      limits:
//	        memory: "512Mi"
//	    env:
//	    - name: MEMORY_LIMIT
//	      valueFrom:
//	        resourceFieldRef:
//	          resource: limits.memory
//	    - name: MEMORY_RATIO
//	      value: "0.75"  # Optional, reserve 25% for FFmpeg, etc.
//
// # Memory Ratio Guidelines
//
// The MEMORY_RATIO determines how much of the container's memory limit is
// allocated to Go's heap. The remaining memory is available for:
//
//   - Child processes (e.g., FFmpeg for video transcoding)
//   - CGO allocations (e.g., image processing libraries)
//   - Memory-mapped files
//   - Goroutine stacks
//   - OS buffers and caches
//
// Recommended ratios based on workload:
//
//	| Workload Type                    | Recommended Ratio |
//	|----------------------------------|-------------------|
//	| Pure Go, no subprocesses         | 0.90              |
//	| Light CGO usage                  | 0.85 (default)    |
//	| Heavy image processing           | 0.80              |
//	| FFmpeg video transcoding         | 0.75              |
//	| Multiple concurrent subprocesses | 0.70              |
//
// # How GOMEMLIMIT Works
//
// GOMEMLIMIT (introduced in Go 1.19) sets a soft memory limit for the Go
// runtime. When heap allocations approach this limit, the garbage collector
// runs more aggressively to try to stay under the limit.
//
// Important notes:
//
//   - GOMEMLIMIT is a soft limit, not a hard limit. Go may temporarily exceed
//     it if the GC cannot free memory fast enough.
//
//   - GOMEMLIMIT only affects Go heap allocations. It does not limit memory
//     used by CGO, mmap, or child processes.
//
//   - Setting GOMEMLIMIT too high risks OOM kills. Setting it too low causes
//     excessive GC overhead and reduced performance.
//
// # Memory Monitoring
//
// For applications that need runtime memory monitoring and backpressure,
// use the [Monitor] type:
//
//	monitor := memory.NewMonitor(memory.DefaultConfig())
//	monitor.Start()
//	defer monitor.Stop()
//
//	// In your worker goroutines:
//	if !monitor.WaitIfPaused() {
//	    return // shutdown signal received
//	}
//	// ... do memory-intensive work
//
// The monitor provides:
//
//   - Automatic pausing when memory exceeds critical threshold
//   - Throttling signals when memory is under pressure
//   - Periodic memory usage tracking
//
// # Example Usage
//
// Basic configuration:
//
//	package main
//
//	import "myapp/internal/memory"
//
//	func main() {
//	    // Configure GOMEMLIMIT from environment (call first!)
//	    memory.ConfigureFromEnv()
//
//	    // ... initialize application
//	}
//
// With memory monitoring for background workers:
//
//	package main
//
//	import "myapp/internal/memory"
//
//	func main() {
//	    memory.ConfigureFromEnv()
//
//	    // Create monitor for backpressure
//	    monitor := memory.NewMonitor(memory.DefaultConfig())
//	    monitor.Start()
//	    defer monitor.Stop()
//
//	    // Pass monitor to workers that do memory-intensive operations
//	    thumbnailGenerator := NewThumbnailGenerator(monitor)
//	    thumbnailGenerator.Start()
//	}
//
// # Comparison with GOMAXPROCS
//
// Go's behavior differs for CPU and memory limits:
//
//	| Aspect      | GOMAXPROCS              | GOMEMLIMIT                |
//	|-------------|-------------------------|---------------------------|
//	| Auto-detect | Yes (since Go 1.19)     | No                        |
//	| Cgroup      | Reads CPU quota         | Does not read mem limit   |
//	| Effect      | Limits parallelism      | Triggers aggressive GC    |
//	| Consequence | Throttling              | OOM kill if exceeded      |
//
// This is why explicit configuration via this package is necessary for
// memory-constrained container environments.
//
// # References
//
//   - Go 1.19 Release Notes (GOMEMLIMIT): https://go.dev/doc/go1.19
//   - GC Guide: https://go.dev/doc/gc-guide
//   - Kubernetes Downward API: https://kubernetes.io/docs/concepts/workloads/pods/downward-api/
package memory
