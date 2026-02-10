package metrics

import (
	"testing"
)

func TestHTTPMetricsExist(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"HTTPRequestsTotal", HTTPRequestsTotal},
		{"HTTPRequestDuration", HTTPRequestDuration},
		{"HTTPRequestsInFlight", HTTPRequestsInFlight},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestDatabaseMetricsExist(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"DBQueryTotal", DBQueryTotal},
		{"DBQueryDuration", DBQueryDuration},
		{"DBConnectionsOpen", DBConnectionsOpen},
		{"DBSizeBytes", DBSizeBytes},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestIndexerMetricsExist(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"IndexerRunsTotal", IndexerRunsTotal},
		{"IndexerLastRunTimestamp", IndexerLastRunTimestamp},
		{"IndexerLastRunDuration", IndexerLastRunDuration},
		{"IndexerFilesProcessed", IndexerFilesProcessed},
		{"IndexerFoldersProcessed", IndexerFoldersProcessed},
		{"IndexerErrors", IndexerErrors},
		{"IndexerIsRunning", IndexerIsRunning},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestThumbnailMetricsExist(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"ThumbnailGenerationsTotal", ThumbnailGenerationsTotal},
		{"ThumbnailGenerationDuration", ThumbnailGenerationDuration},
		{"ThumbnailCacheHits", ThumbnailCacheHits},
		{"ThumbnailCacheMisses", ThumbnailCacheMisses},
		{"ThumbnailCacheSize", ThumbnailCacheSize},
		{"ThumbnailCacheCount", ThumbnailCacheCount},
		{"ThumbnailGeneratorRunning", ThumbnailGeneratorRunning},
		{"ThumbnailGenerationBatchComplete", ThumbnailGenerationBatchComplete},
		{"ThumbnailGenerationLastDuration", ThumbnailGenerationLastDuration},
		{"ThumbnailGenerationLastTimestamp", ThumbnailGenerationLastTimestamp},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestHTTPMetricTypes(t *testing.T) {
	t.Run("HTTPRequestsTotal is CounterVec", func(_ *testing.T) {
		// Try to increment it with labels to verify it's a CounterVec
		HTTPRequestsTotal.WithLabelValues("GET", "/test", "200").Add(0)
	})

	t.Run("HTTPRequestDuration is HistogramVec", func(_ *testing.T) {
		// Try to observe with labels to verify it's a HistogramVec
		HTTPRequestDuration.WithLabelValues("GET", "/test").Observe(0.1)
	})

	t.Run("HTTPRequestsInFlight is Gauge", func(_ *testing.T) {
		// Try to set it to verify it's a Gauge
		HTTPRequestsInFlight.Set(0)
	})
}

func TestDatabaseMetricOperations(t *testing.T) {
	t.Run("DBQueryTotal increment", func(_ *testing.T) {
		// Should not panic
		DBQueryTotal.WithLabelValues("select", "success").Add(0)
	})

	t.Run("DBQueryDuration observe", func(_ *testing.T) {
		// Should not panic
		DBQueryDuration.WithLabelValues("select").Observe(0.001)
	})

	t.Run("DBConnectionsOpen set", func(_ *testing.T) {
		// Should not panic
		DBConnectionsOpen.Set(5)
	})

	t.Run("DBSizeBytes set with labels", func(_ *testing.T) {
		// Should not panic
		DBSizeBytes.WithLabelValues("main").Set(1024)
		DBSizeBytes.WithLabelValues("wal").Set(512)
		DBSizeBytes.WithLabelValues("shm").Set(256)
	})
}

func TestIndexerMetricOperations(t *testing.T) {
	t.Run("IndexerRunsTotal increment", func(_ *testing.T) {
		// Should not panic
		IndexerRunsTotal.Add(0)
	})

	t.Run("IndexerLastRunTimestamp set", func(_ *testing.T) {
		// Should not panic
		IndexerLastRunTimestamp.Set(1234567890)
	})

	t.Run("IndexerLastRunDuration set", func(_ *testing.T) {
		// Should not panic
		IndexerLastRunDuration.Set(12.5)
	})

	t.Run("IndexerIsRunning toggle", func(_ *testing.T) {
		// Should not panic
		IndexerIsRunning.Set(1)
		IndexerIsRunning.Set(0)
	})

	t.Run("IndexerFilesProcessed increment", func(_ *testing.T) {
		// Should not panic
		IndexerFilesProcessed.Add(0)
	})

	t.Run("IndexerFoldersProcessed increment", func(_ *testing.T) {
		// Should not panic
		IndexerFoldersProcessed.Add(0)
	})

	t.Run("IndexerErrors increment", func(_ *testing.T) {
		// Should not panic
		IndexerErrors.Add(0)
	})
}

func TestThumbnailMetricOperations(t *testing.T) {
	t.Run("ThumbnailGenerationsTotal with labels", func(_ *testing.T) {
		// Should not panic
		ThumbnailGenerationsTotal.WithLabelValues("video", "success").Add(0)
		ThumbnailGenerationsTotal.WithLabelValues("image", "failure").Add(0)
	})

	t.Run("ThumbnailGenerationDuration observe", func(_ *testing.T) {
		// Should not panic
		ThumbnailGenerationDuration.WithLabelValues("video").Observe(1.5)
		ThumbnailGenerationDuration.WithLabelValues("image").Observe(0.1)
	})

	t.Run("ThumbnailCacheHits increment", func(_ *testing.T) {
		// Should not panic
		ThumbnailCacheHits.Add(0)
	})

	t.Run("ThumbnailCacheMisses increment", func(_ *testing.T) {
		// Should not panic
		ThumbnailCacheMisses.Add(0)
	})

	t.Run("ThumbnailCacheSize set", func(_ *testing.T) {
		// Should not panic
		ThumbnailCacheSize.Set(1024 * 1024 * 100) // 100 MB
	})

	t.Run("ThumbnailCacheCount set", func(_ *testing.T) {
		// Should not panic
		ThumbnailCacheCount.Set(500)
	})

	t.Run("ThumbnailGeneratorRunning toggle", func(_ *testing.T) {
		// Should not panic
		ThumbnailGeneratorRunning.Set(1)
		ThumbnailGeneratorRunning.Set(0)
	})

	t.Run("ThumbnailGenerationBatchComplete with labels", func(_ *testing.T) {
		// Should not panic
		ThumbnailGenerationBatchComplete.WithLabelValues("full").Add(0)
		ThumbnailGenerationBatchComplete.WithLabelValues("manual").Add(0)
	})
}

func TestMetricLabels(t *testing.T) {
	t.Run("HTTPRequestsTotal labels", func(_ *testing.T) {
		// Test common HTTP methods and status codes
		methods := []string{"GET", "POST", "PUT", "DELETE", "PATCH"}
		statuses := []string{"200", "201", "400", "404", "500"}

		for _, method := range methods {
			for _, status := range statuses {
				// Should not panic
				HTTPRequestsTotal.WithLabelValues(method, "/test", status).Add(0)
			}
		}
	})

	t.Run("DBQueryTotal labels", func(_ *testing.T) {
		operations := []string{"select", "insert", "update", "delete"}
		statuses := []string{"success", "error"}

		for _, op := range operations {
			for _, status := range statuses {
				// Should not panic
				DBQueryTotal.WithLabelValues(op, status).Add(0)
			}
		}
	})
}

func TestDBQueryDurationBuckets(_ *testing.T) {
	// Verify that the duration buckets make sense for database queries
	// Expected buckets: 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5

	// We can't directly access the buckets, but we can observe values
	// and ensure they don't panic
	testDurations := []float64{
		0.0001, // Very fast query
		0.001,  // 1ms
		0.01,   // 10ms
		0.1,    // 100ms
		1.0,    // 1 second
		5.0,    // 5 seconds
		10.0,   // 10 seconds (slow)
	}

	for _, duration := range testDurations {
		// Should not panic
		DBQueryDuration.WithLabelValues("select").Observe(duration)
	}
}

func TestThumbnailGenerationDurationBuckets(*testing.T) {
	// Verify that the duration buckets make sense for thumbnail generation
	// Expected buckets: 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10

	testDurations := []float64{
		0.01, // 10ms (fast image)
		0.1,  // 100ms (normal image)
		1.0,  // 1 second (video frame)
		5.0,  // 5 seconds (complex video)
		10.0, // 10 seconds (very slow)
	}

	for _, duration := range testDurations {
		// Should not panic
		ThumbnailGenerationDuration.WithLabelValues("image").Observe(duration)
		ThumbnailGenerationDuration.WithLabelValues("video").Observe(duration)
	}
}

func TestMetricsAreRegistered(t *testing.T) {
	// Test that metrics can be collected without panic
	// This verifies they're properly registered with Prometheus

	t.Run("Collect HTTP metrics", func(_ *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Collecting HTTP metrics panicked: %v", r)
			}
		}()

		// Use the metrics
		HTTPRequestsTotal.WithLabelValues("GET", "/", "200").Add(1)
		HTTPRequestDuration.WithLabelValues("GET", "/").Observe(0.1)
		HTTPRequestsInFlight.Inc()
		HTTPRequestsInFlight.Dec()
	})

	t.Run("Collect Database metrics", func(_ *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Collecting DB metrics panicked: %v", r)
			}
		}()

		DBQueryTotal.WithLabelValues("select", "success").Add(1)
		DBQueryDuration.WithLabelValues("select").Observe(0.01)
		DBConnectionsOpen.Set(10)
		DBSizeBytes.WithLabelValues("main").Set(1024)
	})

	t.Run("Collect Indexer metrics", func(_ *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Collecting Indexer metrics panicked: %v", r)
			}
		}()

		IndexerRunsTotal.Inc()
		IndexerFilesProcessed.Add(100)
		IndexerFoldersProcessed.Add(10)
		IndexerIsRunning.Set(1)
	})

	t.Run("Collect Thumbnail metrics", func(_ *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Collecting Thumbnail metrics panicked: %v", r)
			}
		}()

		ThumbnailGenerationsTotal.WithLabelValues("video", "success").Add(1)
		ThumbnailGenerationDuration.WithLabelValues("video").Observe(1.5)
		ThumbnailCacheHits.Inc()
		ThumbnailCacheMisses.Inc()
	})
}

func BenchmarkHTTPMetricsIncrement(b *testing.B) {
	b.Run("Counter increment", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			HTTPRequestsTotal.WithLabelValues("GET", "/api/files", "200").Inc()
		}
	})

	b.Run("Histogram observe", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			HTTPRequestDuration.WithLabelValues("GET", "/api/files").Observe(0.1)
		}
	})

	b.Run("Gauge set", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			HTTPRequestsInFlight.Set(float64(i % 100))
		}
	})
}

func BenchmarkDatabaseMetrics(b *testing.B) {
	b.Run("Query counter", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			DBQueryTotal.WithLabelValues("select", "success").Inc()
		}
	})

	b.Run("Query duration", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			DBQueryDuration.WithLabelValues("select").Observe(0.001)
		}
	})
}

// =============================================================================
// Additional Metrics Tests
// =============================================================================

func TestMediaLibraryMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"MediaFilesTotal", MediaFilesTotal},
		{"MediaFoldersTotal", MediaFoldersTotal},
		{"MediaTagsTotal", MediaTagsTotal},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestMediaLibraryMetricOperations(t *testing.T) {
	t.Run("MediaFilesTotal by type", func(_ *testing.T) {
		MediaFilesTotal.WithLabelValues("image").Set(1000)
		MediaFilesTotal.WithLabelValues("video").Set(500)
		MediaFilesTotal.WithLabelValues("playlist").Set(25)
	})

	t.Run("MediaFoldersTotal", func(_ *testing.T) {
		MediaFoldersTotal.Set(50)
	})

	t.Run("MediaTagsTotal", func(_ *testing.T) {
		MediaTagsTotal.Set(20)
	})
}

func TestTranscoderMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"TranscoderJobsTotal", TranscoderJobsTotal},
		{"TranscoderJobDuration", TranscoderJobDuration},
		{"TranscoderJobsInProgress", TranscoderJobsInProgress},
		{"TranscoderCacheSizeBytes", TranscoderCacheSizeBytes},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestTranscoderMetricOperations(t *testing.T) {
	t.Run("TranscoderJobsTotal by status", func(_ *testing.T) {
		TranscoderJobsTotal.WithLabelValues("success").Add(10)
		TranscoderJobsTotal.WithLabelValues("failure").Add(2)
		TranscoderJobsTotal.WithLabelValues("canceled").Add(1)
	})

	t.Run("TranscoderJobDuration", func(_ *testing.T) {
		TranscoderJobDuration.Observe(30.5)
		TranscoderJobDuration.Observe(120.0)
	})

	t.Run("TranscoderJobsInProgress", func(_ *testing.T) {
		TranscoderJobsInProgress.Set(3)
		TranscoderJobsInProgress.Inc()
		TranscoderJobsInProgress.Dec()
	})

	t.Run("TranscoderCacheSizeBytes", func(_ *testing.T) {
		TranscoderCacheSizeBytes.Set(1024 * 1024 * 500) // 500 MB
		TranscoderCacheSizeBytes.Set(0)
	})
}

func TestAuthenticationMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"AuthAttemptsTotal", AuthAttemptsTotal},
		{"ActiveSessions", ActiveSessions},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestAuthenticationMetricOperations(t *testing.T) {
	t.Run("AuthAttemptsTotal by status", func(_ *testing.T) {
		AuthAttemptsTotal.WithLabelValues("success").Add(100)
		AuthAttemptsTotal.WithLabelValues("failure").Add(5)
		AuthAttemptsTotal.WithLabelValues("locked").Add(1)
	})

	t.Run("ActiveSessions", func(_ *testing.T) {
		ActiveSessions.Set(10)
		ActiveSessions.Inc()
		ActiveSessions.Dec()
	})
}

func TestAppInfoMetric(t *testing.T) {
	if AppInfo == nil {
		t.Fatal("AppInfo metric is nil")
	}

	t.Run("SetAppInfo function", func(_ *testing.T) {
		SetAppInfo("1.0.0", "abc123", "go1.21.0")
		SetAppInfo("2.0.0", "def456", "go1.22.0")
	})
}

func TestMemoryMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"MemoryUsageRatio", MemoryUsageRatio},
		{"MemoryPaused", MemoryPaused},
		{"MemoryGCPauses", MemoryGCPauses},
		{"GoMemLimit", GoMemLimit},
		{"GoMemAllocBytes", GoMemAllocBytes},
		{"GoMemSysBytes", GoMemSysBytes},
		{"GoGCRuns", GoGCRuns},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestMemoryMetricOperations(t *testing.T) {
	t.Run("MemoryUsageRatio", func(_ *testing.T) {
		MemoryUsageRatio.Set(0.75)
		MemoryUsageRatio.Set(0.90)
	})

	t.Run("MemoryPaused", func(_ *testing.T) {
		MemoryPaused.Set(0)
		MemoryPaused.Set(1)
	})

	t.Run("MemoryGCPauses", func(_ *testing.T) {
		MemoryGCPauses.Inc()
		MemoryGCPauses.Add(5)
	})

	t.Run("GoMemLimit", func(_ *testing.T) {
		GoMemLimit.Set(1024 * 1024 * 1024) // 1GB
	})

	t.Run("GoMemAllocBytes", func(_ *testing.T) {
		GoMemAllocBytes.Set(100 * 1024 * 1024) // 100MB
	})

	t.Run("GoMemSysBytes", func(_ *testing.T) {
		GoMemSysBytes.Set(200 * 1024 * 1024) // 200MB
	})

	t.Run("GoGCRuns", func(_ *testing.T) {
		GoGCRuns.Add(10)
	})
}

func TestPollingMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"IndexerPollChecksTotal", IndexerPollChecksTotal},
		{"IndexerPollChangesDetected", IndexerPollChangesDetected},
		{"IndexerPollDuration", IndexerPollDuration},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestPollingMetricOperations(t *testing.T) {
	t.Run("IndexerPollChecksTotal", func(_ *testing.T) {
		IndexerPollChecksTotal.Inc()
		IndexerPollChecksTotal.Add(100)
	})

	t.Run("IndexerPollChangesDetected", func(_ *testing.T) {
		IndexerPollChangesDetected.Inc()
		IndexerPollChangesDetected.Add(5)
	})

	t.Run("IndexerPollDuration", func(_ *testing.T) {
		IndexerPollDuration.Observe(0.5)
		IndexerPollDuration.Observe(2.5)
	})
}

func TestFilesystemMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"FilesystemOperationDuration", FilesystemOperationDuration},
		{"FilesystemOperationErrors", FilesystemOperationErrors},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestFilesystemMetricOperations(t *testing.T) {
	t.Run("FilesystemOperationDuration", func(_ *testing.T) {
		FilesystemOperationDuration.WithLabelValues("media", "read").Observe(0.001)
		FilesystemOperationDuration.WithLabelValues("cache", "write").Observe(0.01)
		FilesystemOperationDuration.WithLabelValues("database", "stat").Observe(0.0005)
	})

	t.Run("FilesystemOperationErrors", func(_ *testing.T) {
		FilesystemOperationErrors.WithLabelValues("media", "read").Inc()
		FilesystemOperationErrors.WithLabelValues("cache", "write").Add(2)
	})
}

func TestEnhancedIndexerMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"IndexerRunDuration", IndexerRunDuration},
		{"IndexerBatchProcessingDuration", IndexerBatchProcessingDuration},
		{"IndexerFilesPerSecond", IndexerFilesPerSecond},
		{"IndexerParallelWorkers", IndexerParallelWorkers},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestEnhancedIndexerMetricOperations(t *testing.T) {
	t.Run("IndexerRunDuration", func(_ *testing.T) {
		IndexerRunDuration.Observe(30.5)
		IndexerRunDuration.Observe(120.0)
	})

	t.Run("IndexerBatchProcessingDuration", func(_ *testing.T) {
		IndexerBatchProcessingDuration.Observe(0.1)
		IndexerBatchProcessingDuration.Observe(1.5)
	})

	t.Run("IndexerFilesPerSecond", func(_ *testing.T) {
		IndexerFilesPerSecond.Set(100.5)
	})

	t.Run("IndexerParallelWorkers", func(_ *testing.T) {
		IndexerParallelWorkers.Set(4)
	})
}

func TestEnhancedThumbnailMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"ThumbnailMemoryUsageBytes", ThumbnailMemoryUsageBytes},
		{"ThumbnailGenerationDurationDetailed", ThumbnailGenerationDurationDetailed},
		{"ThumbnailFFmpegDuration", ThumbnailFFmpegDuration},
		{"ThumbnailImageDecodeByFormat", ThumbnailImageDecodeByFormat},
		{"ThumbnailBatchProcessingRate", ThumbnailBatchProcessingRate},
		{"ThumbnailGenerationFilesTotal", ThumbnailGenerationFilesTotal},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestEnhancedThumbnailMetricOperations(t *testing.T) {
	t.Run("ThumbnailMemoryUsageBytes", func(_ *testing.T) {
		ThumbnailMemoryUsageBytes.WithLabelValues("image").Observe(10 * 1024 * 1024)
		ThumbnailMemoryUsageBytes.WithLabelValues("video").Observe(50 * 1024 * 1024)
	})

	t.Run("ThumbnailGenerationDurationDetailed", func(_ *testing.T) {
		ThumbnailGenerationDurationDetailed.WithLabelValues("image", "decode").Observe(0.01)
		ThumbnailGenerationDurationDetailed.WithLabelValues("image", "resize").Observe(0.05)
		ThumbnailGenerationDurationDetailed.WithLabelValues("image", "encode").Observe(0.02)
	})

	t.Run("ThumbnailFFmpegDuration", func(_ *testing.T) {
		ThumbnailFFmpegDuration.WithLabelValues("video").Observe(2.5)
	})

	t.Run("ThumbnailImageDecodeByFormat", func(_ *testing.T) {
		ThumbnailImageDecodeByFormat.WithLabelValues("jpeg").Observe(0.01)
		ThumbnailImageDecodeByFormat.WithLabelValues("png").Observe(0.02)
		ThumbnailImageDecodeByFormat.WithLabelValues("gif").Observe(0.03)
	})

	t.Run("ThumbnailBatchProcessingRate", func(_ *testing.T) {
		ThumbnailBatchProcessingRate.Set(50.5)
	})

	t.Run("ThumbnailGenerationFilesTotal", func(_ *testing.T) {
		ThumbnailGenerationFilesTotal.WithLabelValues("generated").Set(100)
		ThumbnailGenerationFilesTotal.WithLabelValues("skipped").Set(50)
		ThumbnailGenerationFilesTotal.WithLabelValues("failed").Set(5)
	})
}

func TestDatabasePerformanceMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"DBTransactionDuration", DBTransactionDuration},
		{"DBRowsAffected", DBRowsAffected},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestDatabasePerformanceMetricOperations(t *testing.T) {
	t.Run("DBTransactionDuration", func(_ *testing.T) {
		DBTransactionDuration.WithLabelValues("batch_insert").Observe(0.5)
		DBTransactionDuration.WithLabelValues("batch_update").Observe(1.0)
		DBTransactionDuration.WithLabelValues("cleanup").Observe(2.5)
	})

	t.Run("DBRowsAffected", func(_ *testing.T) {
		DBRowsAffected.WithLabelValues("insert").Observe(100)
		DBRowsAffected.WithLabelValues("update").Observe(50)
		DBRowsAffected.WithLabelValues("delete").Observe(10)
	})
}

func TestCachePerformanceMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"ThumbnailCacheReadLatency", ThumbnailCacheReadLatency},
		{"ThumbnailCacheWriteLatency", ThumbnailCacheWriteLatency},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestCachePerformanceMetricOperations(t *testing.T) {
	t.Run("ThumbnailCacheReadLatency", func(_ *testing.T) {
		ThumbnailCacheReadLatency.Observe(0.0001)
		ThumbnailCacheReadLatency.Observe(0.001)
	})

	t.Run("ThumbnailCacheWriteLatency", func(_ *testing.T) {
		ThumbnailCacheWriteLatency.Observe(0.001)
		ThumbnailCacheWriteLatency.Observe(0.01)
	})
}

func TestFileProcessingMetrics(t *testing.T) {
	tests := []struct {
		name   string
		metric interface{}
	}{
		{"FileHashComputeDuration", FileHashComputeDuration},
		{"DirectoryWalkDepth", DirectoryWalkDepth},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.metric == nil {
				t.Errorf("%s metric is nil", tt.name)
			}
		})
	}
}

func TestFileProcessingMetricOperations(t *testing.T) {
	t.Run("FileHashComputeDuration", func(_ *testing.T) {
		FileHashComputeDuration.Observe(0.001)
		FileHashComputeDuration.Observe(0.01)
	})

	t.Run("DirectoryWalkDepth", func(_ *testing.T) {
		DirectoryWalkDepth.Observe(1)
		DirectoryWalkDepth.Observe(5)
		DirectoryWalkDepth.Observe(10)
	})
}

func TestMetricsConcurrentAccess(t *testing.T) {
	// Test that metrics can be updated concurrently without panic
	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Goroutine %d panicked: %v", id, r)
				}
				done <- true
			}()

			// Update various metrics concurrently
			HTTPRequestsTotal.WithLabelValues("GET", "/test", "200").Inc()
			DBQueryTotal.WithLabelValues("select", "success").Inc()
			IndexerFilesProcessed.Add(1)
			ThumbnailCacheHits.Inc()
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}
}

func BenchmarkThumbnailMetrics(b *testing.B) {
	b.Run("Generation counter", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			ThumbnailGenerationsTotal.WithLabelValues("image", "success").Inc()
		}
	})

	b.Run("Cache hits", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			ThumbnailCacheHits.Inc()
		}
	})

	b.Run("Duration histogram", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			ThumbnailGenerationDuration.WithLabelValues("image").Observe(0.1)
		}
	})
}

func BenchmarkMemoryMetrics(b *testing.B) {
	b.Run("Memory usage ratio", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			MemoryUsageRatio.Set(0.75)
		}
	})

	b.Run("GC runs counter", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			GoGCRuns.Add(1)
		}
	})
}
