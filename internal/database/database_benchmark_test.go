package database

// WAL checkpoint benchmark suite
//
// These benchmarks exist specifically to catch regressions in WAL checkpoint
// behavior around BulkIndexEnd. Each benchmark targets a distinct failure
// mode observed (or risked) during the 0.15.x WAL refactors:
//
//   BenchmarkBulkIndexEndLatency              — synchronous hot path of
//     BulkIndexEnd (FTS rebuild + PASSIVE checkpoint). Establishes the
//     baseline ns/op for before/after comparisons.
//
//   BenchmarkBulkIndexEndWithStalledReader    — BulkIndexEnd with an active
//     read transaction holding a WAL snapshot. A synchronous TRUNCATE on the
//     hot path would block for up to busy_timeout (30 s) per iteration,
//     producing a ~30 s/op result instead of the expected ~ms/op.
//
//   BenchmarkBatchWritesConcurrentTruncate    — batch write throughput while
//     a goroutine fires TRUNCATE checkpoints every 20 ms. Reproduces the
//     0.15.3 regression: if TRUNCATE holds the single writer connection,
//     BeginBatch blocks for up to 30 s per iteration.
//
//   BenchmarkWALShrinkAfterBulkIndex          — measures the elapsed time
//     from BulkIndexEnd returning until the WAL has been physically
//     truncated (log pages == 0). The ns/op metric covers BulkIndexEnd
//     itself; a separate "ns/truncation" custom metric covers the async
//     TRUNCATE goroutine. With old code that has no async goroutine, log
//     never reaches 0 and the benchmark fatals after 30 s, making the
//     regression immediately obvious.
//
// Run before and after `git stash pop` to compare:
//
//	go test -tags fts5 -bench='BenchmarkBulkIndex|BenchmarkBatchWrites|BenchmarkWALShrink' \
//	        -benchmem -benchtime=5s -count=3 -run='^$' ./internal/database/
//
// Or via the Makefile (applies -tags fts5 automatically):
//
//	make test-bench-package database BENCH='BenchmarkBulkIndex|BenchmarkBatchWrites|BenchmarkWALShrink'

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Shared helpers (testing.TB variants of helpers defined in _integration_test)
// ---------------------------------------------------------------------------

// openHoldingReadTxTB opens a read-only transaction that pins a WAL snapshot,
// establishing a read-mark so that a TRUNCATE checkpoint cannot complete until
// the transaction is rolled back. Compatible with *testing.T and *testing.B.
func openHoldingReadTxTB(tb testing.TB, db *Database) *sql.Tx {
	tb.Helper()
	tx, err := db.reader.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		tb.Fatalf("openHoldingReadTxTB: BeginTx: %v", err)
	}
	var n int
	if err := tx.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM files").Scan(&n); err != nil {
		_ = tx.Rollback()
		tb.Fatalf("openHoldingReadTxTB: dummy read: %v", err)
	}
	return tx
}

// seedBulkFiles inserts count files using the bulk-index path so that FTS
// data exists for a realistic BulkIndexEnd rebuild in subsequent iterations.
func seedBulkFiles(b *testing.B, db *Database, count int) {
	b.Helper()
	ctx := context.Background()
	if err := db.BulkIndexBegin(ctx); err != nil {
		b.Fatalf("seedBulkFiles: BulkIndexBegin: %v", err)
	}
	batch, err := db.BeginBatch(ctx)
	if err != nil {
		b.Fatalf("seedBulkFiles: BeginBatch: %v", err)
	}
	for i := 0; i < count; i++ {
		_ = batch.UpsertFile(ctx, &MediaFile{
			Name:       fmt.Sprintf("seed_%04d.jpg", i),
			Path:       fmt.Sprintf("seed/%04d.jpg", i),
			ParentPath: "seed",
			Type:       FileTypeImage,
			Size:       4096,
			ModTime:    time.Now(),
		})
	}
	if err := db.EndBatch(batch, nil); err != nil {
		b.Fatalf("seedBulkFiles: EndBatch: %v", err)
	}
	if err := db.BulkIndexEnd(ctx); err != nil {
		b.Fatalf("seedBulkFiles: BulkIndexEnd: %v", err)
	}
}

// walLogPages returns the current WAL frame count via PRAGMA wal_checkpoint(PASSIVE).
// log == 0 means the WAL file has been physically truncated.
func walLogPages(b *testing.B, db *Database) int {
	b.Helper()
	var busy, log, checkpointed int
	err := db.writer.QueryRowContext(
		context.Background(), "PRAGMA wal_checkpoint(PASSIVE)",
	).Scan(&busy, &log, &checkpointed)
	if err != nil {
		b.Fatalf("walLogPages: %v", err)
	}
	return log
}

// ---------------------------------------------------------------------------
// BenchmarkBulkIndexEndLatency
// ---------------------------------------------------------------------------

// BenchmarkBulkIndexEndLatency measures the synchronous latency of BulkIndexEnd
// (FTS rebuild + trigger restore + PASSIVE checkpoint) with no concurrent readers.
//
// Expected ns/op: low milliseconds on a local SSD; somewhat higher on NFS.
// A spike to seconds indicates a blocking checkpoint has been placed on the
// synchronous call path.
func BenchmarkBulkIndexEndLatency(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()
	ctx := context.Background()

	// Seed rows once so FTS rebuild has realistic work to do.
	seedBulkFiles(b, db, 500)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		if err := db.BulkIndexBegin(ctx); err != nil {
			b.Fatalf("BulkIndexBegin: %v", err)
		}
		b.StartTimer()

		if err := db.BulkIndexEnd(ctx); err != nil {
			b.Fatalf("BulkIndexEnd: %v", err)
		}
	}
}

// ---------------------------------------------------------------------------
// BenchmarkBulkIndexEndWithStalledReader
// ---------------------------------------------------------------------------

// BenchmarkBulkIndexEndWithStalledReader measures BulkIndexEnd latency when
// an active read transaction is holding a WAL snapshot open.
//
// If BulkIndexEnd ever issues a synchronous TRUNCATE checkpoint, it will block
// until the reader releases its snapshot — up to busy_timeout (30 s). The
// expected result with a correct PASSIVE-only sync path is low milliseconds.
//
// Before/after signal: ~30 s/op indicates TRUNCATE was added to the sync path;
// ~ms/op confirms PASSIVE (non-blocking) is still in use.
//
// NOTE: when the async TRUNCATE goroutine is present, this benchmark produces
// elevated and high-variance ns/op (e.g. 12–33 ms) because the goroutine from
// iteration N contends with iteration N+1's FTS rebuild over the single writer
// connection. This is a benchmark artifact — in production BulkIndexEnd runs
// once per index cycle, separated by tens of minutes. Treat this benchmark as
// a pass/fail boundary test: any result under ~1 s/op passes; ~30 s/op means
// a synchronous TRUNCATE has been placed on the BulkIndexEnd call path.
func BenchmarkBulkIndexEndWithStalledReader(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()
	ctx := context.Background()

	seedBulkFiles(b, db, 500)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		if err := db.BulkIndexBegin(ctx); err != nil {
			b.Fatalf("BulkIndexBegin: %v", err)
		}
		// Open a reader that pins the current WAL snapshot. A synchronous
		// TRUNCATE inside BulkIndexEnd blocks here for up to busy_timeout.
		readerTx := openHoldingReadTxTB(b, db)
		b.StartTimer()

		if err := db.BulkIndexEnd(ctx); err != nil {
			b.Logf("BulkIndexEnd error (non-fatal in benchmark): %v", err)
		}

		b.StopTimer()
		_ = readerTx.Rollback()
		b.StartTimer()
	}
}

// ---------------------------------------------------------------------------
// BenchmarkBatchWritesConcurrentTruncate
// ---------------------------------------------------------------------------

// BenchmarkBatchWritesConcurrentTruncate measures per-batch write throughput
// (BeginBatch → UpsertFile → EndBatch) while a background goroutine fires
// TRUNCATE checkpoints every 20 ms.
//
// This directly reproduces the 0.15.3 regression: Checkpoint (TRUNCATE) holds
// the single writer connection, so every BeginBatch call blocks until the
// checkpoint finishes — producing ~30 s/op spikes when the checkpoint fires
// during a write burst.
//
// With the current design (TRUNCATE is async and fires after writes complete),
// the goroutine serializes through the writer pool without blocking the write
// path, and ns/op stays low.
//
// Before/after signal: consistent sub-millisecond ns/op = no write-path
// contention; multi-second ns/op spikes = TRUNCATE is blocking writes.
func BenchmarkBatchWritesConcurrentTruncate(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()
	ctx := context.Background()

	stopCh := make(chan struct{})
	b.Cleanup(func() { close(stopCh) })

	// Fire TRUNCATE checkpoints at 20 ms intervals. This is tighter than the
	// old background worker default (30 s) to maximize collision probability
	// with the write-path in a short benchmark run.
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				truncCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
				_, _, _ = db.Checkpoint(truncCtx)
				cancel()
			case <-stopCh:
				return
			}
		}
	}()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		batch, err := db.BeginBatch(ctx)
		if err != nil {
			b.Fatalf("BeginBatch: %v", err)
		}
		_ = batch.UpsertFile(ctx, &MediaFile{
			Name:       fmt.Sprintf("conc_%d.jpg", i),
			Path:       fmt.Sprintf("conc/%d.jpg", i),
			ParentPath: "conc",
			Type:       FileTypeImage,
			Size:       1024,
			ModTime:    time.Now(),
		})
		if err := db.EndBatch(batch, nil); err != nil {
			b.Fatalf("EndBatch: %v", err)
		}
	}
}

// ---------------------------------------------------------------------------
// BenchmarkWALShrinkAfterBulkIndex
// ---------------------------------------------------------------------------

// BenchmarkWALShrinkAfterBulkIndex measures two quantities for each bulk-index
// cycle:
//
//  1. ns/op  — the synchronous latency of BulkIndexEnd itself.
//  2. ns/truncation — elapsed time from BulkIndexEnd returning until the WAL
//     has been physically truncated (PASSIVE checkpoint shows log == 0).
//
// The ns/truncation metric is the key before/after signal:
//   - New code: BulkIndexEnd fires an async TRUNCATE goroutine; with no
//     competing readers the WAL should reach log == 0 within a few ms.
//   - Old code (no async goroutine): PASSIVE never truncates, log stays at
//     its high-water value forever. This benchmark then fatals after 30 s,
//     making the missing goroutine immediately visible.
func BenchmarkWALShrinkAfterBulkIndex(b *testing.B) {
	db, _ := setupTestDB(b)
	defer db.Close()
	ctx := context.Background()

	var totalTruncNs int64

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()

		// Insert fresh rows each iteration so the WAL has real content.
		if err := db.BulkIndexBegin(ctx); err != nil {
			b.Fatalf("BulkIndexBegin: %v", err)
		}
		batch, err := db.BeginBatch(ctx)
		if err != nil {
			b.Fatalf("BeginBatch: %v", err)
		}
		for j := 0; j < 200; j++ {
			_ = batch.UpsertFile(ctx, &MediaFile{
				Name:       fmt.Sprintf("wal_%d_%04d.jpg", i, j),
				Path:       fmt.Sprintf("wal/%d/%04d.jpg", i, j),
				ParentPath: fmt.Sprintf("wal/%d", i),
				Type:       FileTypeImage,
				Size:       4096,
				ModTime:    time.Now(),
			})
		}
		if err := db.EndBatch(batch, nil); err != nil {
			b.Fatalf("EndBatch: %v", err)
		}

		b.StartTimer()

		// BulkIndexEnd must return promptly (PASSIVE + fires async TRUNCATE).
		if err := db.BulkIndexEnd(ctx); err != nil {
			b.Fatalf("BulkIndexEnd: %v", err)
		}

		b.StopTimer()

		// ---- custom metric: time-to-WAL-truncation -------------------------
		// Poll until the async TRUNCATE goroutine has finished and the WAL
		// has log == 0. With old code (no goroutine) this never completes;
		// the Fatalf below makes the regression immediately visible.
		truncStart := time.Now()
		const pollTimeout = 30 * time.Second
		for {
			log := walLogPages(b, db)
			if log == 0 {
				break
			}
			if time.Since(truncStart) > pollTimeout {
				b.Fatalf("WAL log pages never reached 0 after %v (current log=%d) — "+
					"async TRUNCATE goroutine missing or broken?", pollTimeout, log)
			}
			time.Sleep(time.Millisecond)
		}
		totalTruncNs += time.Since(truncStart).Nanoseconds()
		// --------------------------------------------------------------------
	}

	if b.N > 0 {
		b.ReportMetric(float64(totalTruncNs)/float64(b.N), "ns/truncation")
	}
}
