package metrics

// InitializeMetrics pre-populates all expected label combinations so that
// every metric is exported from the first Prometheus scrape.
// Call this once at startup after metric registration.
func InitializeMetrics() {
	// --- Database storage health ---
	for _, file := range []string{"main", "wal", "shm"} {
		DBStorageErrors.WithLabelValues(file)
	}

	// --- Filesystem operation metrics (per volume × operation) ---
	volumes := []string{"media", "cache", "database", "unknown"}
	fsOps := []string{"read", "write", "stat", "readdir"}

	for _, vol := range volumes {
		for _, op := range fsOps {
			FilesystemOperationDuration.WithLabelValues(vol, op)
			FilesystemOperationErrors.WithLabelValues(vol, op)
		}
	}

	// --- Filesystem retry metrics (per retry-operation × volume) ---
	retryOps := []string{"stat", "open", "readdir", "write"}

	for _, op := range retryOps {
		for _, vol := range volumes {
			FilesystemRetryAttempts.WithLabelValues(op, vol)
			FilesystemRetrySuccess.WithLabelValues(op, vol)
			FilesystemRetryFailures.WithLabelValues(op, vol)
			FilesystemStaleErrors.WithLabelValues(op, vol)
			FilesystemRetryDuration.WithLabelValues(op, vol)
		}
	}

	// --- Thumbnail image decode by format ---
	for _, format := range []string{"jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "avif", "svg", "unknown"} {
		ThumbnailImageDecodeByFormat.WithLabelValues(format)
	}

	// --- Thumbnail generation detailed phases ---
	thumbTypes := []string{"image", "video", "folder"}
	phases := []string{"decode", "resize", "encode", "cache"}

	for _, t := range thumbTypes {
		for _, p := range phases {
			ThumbnailGenerationDurationDetailed.WithLabelValues(t, p)
		}
		ThumbnailMemoryUsageBytes.WithLabelValues(t)
		ThumbnailGenerationsTotal.WithLabelValues(t, "success")
		ThumbnailGenerationsTotal.WithLabelValues(t, "error")
		ThumbnailGenerationsTotal.WithLabelValues(t, "error_not_found")
		ThumbnailGenerationsTotal.WithLabelValues(t, "error_unsupported")
		ThumbnailGenerationsTotal.WithLabelValues(t, "error_nil")
		ThumbnailGenerationsTotal.WithLabelValues(t, "error_encode")
	}

	// --- Thumbnail FFmpeg duration ---
	for _, mt := range []string{"image", "video"} {
		ThumbnailFFmpegDuration.WithLabelValues(mt)
	}

	// --- DB query operations ---
	for _, op := range []string{"initialize_schema", "upsert_file", "delete_missing_files",
		"get_file_by_path", "rebuild_fts", "vacuum", "begin_transaction", "commit", "rollback"} {
		DBQueryTotal.WithLabelValues(op, "success")
		DBQueryTotal.WithLabelValues(op, "error")
		DBQueryDuration.WithLabelValues(op)
	}

	for _, t := range []string{"commit", "rollback", "batch_insert", "batch_update", "cleanup"} {
		DBTransactionDuration.WithLabelValues(t)
	}
}
