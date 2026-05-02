package metrics

const (
	labelValUnknown   = "unknown"
	labelValStat      = "stat"
	labelValVideo     = "video"
	labelValRollback  = "rollback"
	labelValTotal     = "total"
	labelValProcessed = "processed"
	labelValTagged    = "tagged"
	labelValSkipped   = "skipped"
	labelValFailed    = "failed"
	labelValWrite     = "write"
)

// InitializeMetrics pre-populates all expected label combinations so that
// every metric is exported from the first Prometheus scrape.
// Call this once at startup after metric registration.
func InitializeMetrics() {
	// --- Database storage health ---
	for _, file := range []string{"main", "wal", "shm"} {
		DBStorageErrors.WithLabelValues(file)
	}

	// --- Filesystem operation metrics (per volume × operation) ---
	volumes := []string{"media", labelValCache, "database", labelValUnknown}
	fsOps := []string{"read", labelValWrite, labelValStat, labelValReaddir}

	for _, vol := range volumes {
		for _, op := range fsOps {
			FilesystemOperationDuration.WithLabelValues(vol, op)
			FilesystemOperationErrors.WithLabelValues(vol, op)
		}
	}

	// --- Filesystem retry metrics (per retry-operation × volume) ---
	retryOps := []string{labelValStat, "open", labelValReaddir, labelValWrite}

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
	for _, format := range []string{"jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "avif", "svg", labelValUnknown} {
		ThumbnailImageDecodeByFormat.WithLabelValues(format)
	}

	// --- Thumbnail generation detailed phases ---
	thumbTypes := []string{labelValImage, labelValVideo, "folder"}
	phases := []string{"decode", "resize", "encode", labelValCache}

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
	for _, mt := range []string{labelValImage, labelValVideo} {
		ThumbnailFFmpegDuration.WithLabelValues(mt)
	}

	// --- EXIF auto-tagger ---
	for _, runType := range []string{"full", "incremental"} {
		ExifTagRunsTotal.WithLabelValues(runType)
		ExifTagRunDuration.WithLabelValues(runType)
	}
	for _, status := range []string{labelValTagged, labelValSkipped, labelValFailed} {
		ExifTagFilesTotal.WithLabelValues(status)
	}
	for _, status := range []string{labelValTotal, labelValProcessed, labelValTagged, labelValSkipped, labelValFailed} {
		ExifTagCurrentRunFiles.WithLabelValues(status)
		ExifTagLastRunFiles.WithLabelValues(status)
	}

	// --- DB query operations ---
	for _, op := range []string{"initialize_schema", "upsert_file", "delete_missing_files",
		"get_file_by_path", "rebuild_fts", "begin_transaction", labelCommit, labelValRollback} {
		DBQueryTotal.WithLabelValues(op, "success")
		DBQueryTotal.WithLabelValues(op, "error")
		DBQueryDuration.WithLabelValues(op)
	}

	for _, t := range []string{labelCommit, labelValRollback, "batch_insert", "batch_update", "cleanup"} {
		DBTransactionDuration.WithLabelValues(t)
	}
}
