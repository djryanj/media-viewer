/*
Package workers provides utilities for determining optimal worker pool sizes
in containerized environments.

# Overview

When running Go applications in containers (Docker, Kubernetes, etc.), the
number of available CPUs may be limited by cgroup constraints. While Go 1.19+
automatically sets GOMAXPROCS based on container CPU limits, the commonly used
runtime.NumCPU() function still returns the host machine's CPU count.

This package provides helper functions that use GOMAXPROCS to determine
appropriate worker counts for different types of workloads, ensuring your
application respects container resource limits.

# The Problem

Consider a Kubernetes pod with a CPU limit of 2 cores running on a 64-core node:

	// Wrong: Returns 64 (host CPUs), ignores container limit
	workers := runtime.NumCPU()

	// Correct: Returns 2 (respects container limit in Go 1.19+)
	workers := runtime.GOMAXPROCS(0)

Spawning 64 workers when you only have 2 CPUs available leads to:
  - Excessive context switching overhead
  - CPU throttling by the container runtime
  - Poor performance and increased latency
  - Potential memory pressure from goroutine stacks

# Basic Usage

The package provides task-specific helper functions:

	import "media-viewer/internal/workers"

	// For CPU-intensive tasks (image processing, compression)
	// Uses 1 worker per available CPU
	numWorkers := workers.ForCPU(8) // max 8 workers

	// For I/O-bound tasks (file operations, network calls)
	// Uses 2 workers per available CPU
	numWorkers := workers.ForIO(16) // max 16 workers

	// For mixed workloads
	// Uses 1.5 workers per available CPU
	numWorkers := workers.ForMixed(12) // max 12 workers

# Custom Configuration

For fine-grained control, use the Count function directly:

	// 3 workers per CPU, maximum of 24
	numWorkers := workers.Count(3.0, 24)

	// No maximum (use 0)
	numWorkers := workers.Count(2.0, 0)

# Environment Variable Override

All functions respect the THUMBNAIL_WORKERS environment variable, allowing operators
to override the automatic calculation:

	# In Kubernetes deployment
	env:
	- name: THUMBNAIL_WORKERS
	  value: "4"

This is useful for:
  - Fine-tuning performance in specific environments
  - Debugging resource issues
  - Temporarily limiting concurrency

# Workload Types

Different workloads benefit from different worker-to-CPU ratios:

CPU-Bound Tasks (multiplier: 1.0):

Tasks that primarily consume CPU cycles benefit from having one worker per
available CPU. More workers would just increase context switching overhead.

Examples:

  - Image resizing and encoding

  - Video transcoding

  - Compression/decompression

  - Cryptographic operations

    workers := workers.ForCPU(8)

I/O-Bound Tasks (multiplier: 2.0):

Tasks that spend most of their time waiting for I/O can benefit from more
workers than CPUs, as workers can perform useful work while others wait.

Examples:

  - File system operations

  - Database queries

  - Network requests

  - Reading/writing to disk

    workers := workers.ForIO(16)

Mixed Tasks (multiplier: 1.5):

Tasks that combine CPU work with I/O operations benefit from a moderate
multiplier.

Examples:

  - Thumbnail generation (read file, process image, write result)

  - Log processing (read, parse, write)

  - ETL pipelines

    workers := workers.ForMixed(12)

# Kubernetes Integration

Example Kubernetes deployment with CPU limits:

	apiVersion: apps/v1
	kind: Deployment
	spec:
	  template:
	    spec:
	      containers:
	      - name: app
	        resources:
	          requests:
	            cpu: "500m"     # Request 0.5 CPU
	          limits:
	            cpu: "2"        # Limit to 2 CPUs
	        env:
	        # Optional: explicit override
	        - name: THUMBNAIL_WORKERS
	          value: "4"

With this configuration:
  - GOMAXPROCS is automatically set to 2 by Go runtime
  - workers.ForCPU(8) returns 2
  - workers.ForIO(8) returns 4
  - workers.ForMixed(8) returns 3

# Best Practices

1. Always specify a maximum:

	// Good: prevents runaway worker creation on large machines
	workers := workers.ForIO(16)

	// Risky: could create too many workers
	workers := workers.ForIO(0)

2. Choose the right workload type:

	// Don't use I/O multiplier for CPU-bound work
	// This wastes resources on context switching
	workers := workers.ForCPU(8) // Not ForIO(8)

3. Consider downstream resources:

	// If workers hit a database, limit concurrency to avoid
	// overwhelming the database connection pool
	workers := workers.ForIO(dbPoolSize)

4. Monitor and adjust:

	// Log worker count for observability
	count := workers.ForMixed(8)
	log.Printf("Starting %d workers (GOMAXPROCS=%d)", count, runtime.GOMAXPROCS(0))

# Thread Safety

All functions in this package are safe for concurrent use. They read from
runtime.GOMAXPROCS and environment variables, which are themselves thread-safe.

# Go Version Requirements

This package relies on Go 1.19+ behavior where GOMAXPROCS is automatically
set based on container CPU limits. On earlier Go versions, GOMAXPROCS defaults
to runtime.NumCPU(), and the container-awareness benefits are lost.

For Go < 1.19, consider using the go.uber.org/automaxprocs package to achieve
similar behavior.
*/
package workers
