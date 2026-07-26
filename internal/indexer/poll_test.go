package indexer

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"

	"media-viewer/internal/database"
	"media-viewer/internal/metrics"
)

// counterValue reads the current value of a Prometheus counter.
func counterValue(t *testing.T, c prometheus.Counter) float64 {
	t.Helper()

	var m dto.Metric
	if err := c.Write(&m); err != nil {
		t.Fatalf("failed to read counter: %v", err)
	}
	return m.GetCounter().GetValue()
}

// newPollTestIndexer returns an indexer rooted at a temp directory containing
// count subdirectories, along with the entry listing that detectChanges would
// hand to checkSubdirectorySample.
func newPollTestIndexer(t *testing.T, count int) (idx *Indexer, entries []os.DirEntry, dir string) {
	t.Helper()

	dir = t.TempDir()
	for i := 0; i < count; i++ {
		// Zero-padded so ReadDir's sorted order matches creation order.
		if err := os.Mkdir(filepath.Join(dir, fmt.Sprintf("sub%04d", i)), 0o755); err != nil {
			t.Fatalf("failed to create subdirectory: %v", err)
		}
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("failed to read temp dir: %v", err)
	}

	return New(&database.Database{}, dir, 5*time.Minute), entries, dir
}

// seedSubdirModTimes records every entry as already-seen with a modification
// time in the future, so stat-ing an unchanged directory reports no change.
func seedSubdirModTimes(idx *Indexer, entries []os.DirEntry) {
	future := time.Now().Add(time.Hour)
	times := make(map[string]time.Time, len(entries))
	for _, e := range entries {
		times[e.Name()] = future
	}

	idx.stateMu.Lock()
	idx.lastSubdirModTimes = times
	idx.stateMu.Unlock()
}

func TestCheckSubdirectorySampleCapsStatsPerPoll(t *testing.T) {
	idx, entries, _ := newPollTestIndexer(t, maxSubdirStatsPerPoll*3)
	seedSubdirModTimes(idx, entries)

	before := counterValue(t, metrics.IndexerPollSubdirStats)
	if idx.checkSubdirectorySample(entries) {
		t.Fatal("no subdirectory was modified, so no change should be reported")
	}
	got := counterValue(t, metrics.IndexerPollSubdirStats) - before

	if got != float64(maxSubdirStatsPerPoll) {
		t.Errorf("poll issued %v subdirectory stats, want %d (the per-poll cap)",
			got, maxSubdirStatsPerPoll)
	}
}

func TestCheckSubdirectorySampleRotatesAcrossPolls(t *testing.T) {
	idx, entries, _ := newPollTestIndexer(t, maxSubdirStatsPerPoll*2)
	seedSubdirModTimes(idx, entries)

	// Make the last directory the only one that looks modified. It sits outside
	// the first poll's window, so only a later, rotated poll can reach it.
	last := entries[len(entries)-1].Name()
	idx.stateMu.Lock()
	idx.lastSubdirModTimes[last] = time.Now().Add(-time.Hour)
	idx.stateMu.Unlock()

	if idx.checkSubdirectorySample(entries) {
		t.Fatal("first poll should not have reached the last subdirectory")
	}
	if !idx.checkSubdirectorySample(entries) {
		t.Error("second poll should have rotated onto the remaining subdirectories and seen the change")
	}
}

func TestCheckSubdirectorySampleRecordsStatErrors(t *testing.T) {
	idx, entries, dir := newPollTestIndexer(t, 1)
	seedSubdirModTimes(idx, entries)

	// Remove the directory after the listing was taken — the same race a network
	// mount hits when a directory disappears between READDIR and GETATTR.
	if err := os.Remove(filepath.Join(dir, entries[0].Name())); err != nil {
		t.Fatalf("failed to remove subdirectory: %v", err)
	}

	before := counterValue(t, metrics.IndexerPollStatErrors)
	idx.checkSubdirectorySample(entries)

	if got := counterValue(t, metrics.IndexerPollStatErrors) - before; got != 1 {
		t.Errorf("recorded %v poll stat errors, want 1 — a failing stat must not be silently skipped", got)
	}
}

func TestCheckSubdirectorySampleDetectsNewSubdirWithoutStat(t *testing.T) {
	idx, entries, _ := newPollTestIndexer(t, 1)
	// lastSubdirModTimes is left empty, so the single entry has never been seen.

	before := counterValue(t, metrics.IndexerPollSubdirStats)
	if !idx.checkSubdirectorySample(entries) {
		t.Fatal("a previously unseen subdirectory should be reported as a change")
	}

	if got := counterValue(t, metrics.IndexerPollSubdirStats) - before; got != 0 {
		t.Errorf("issued %v stats to detect a new subdirectory, want 0 — the name alone is enough", got)
	}
}

func TestCheckSubdirectorySampleIgnoresFilesAndHiddenDirs(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, ".hidden"), 0o755); err != nil {
		t.Fatalf("failed to create hidden dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "photo.jpg"), []byte("x"), 0o644); err != nil {
		t.Fatalf("failed to create file: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("failed to read temp dir: %v", err)
	}

	idx := New(&database.Database{}, dir, 5*time.Minute)

	before := counterValue(t, metrics.IndexerPollSubdirStats)
	if idx.checkSubdirectorySample(entries) {
		t.Error("hidden directories and plain files should never report a change")
	}

	if got := counterValue(t, metrics.IndexerPollSubdirStats) - before; got != 0 {
		t.Errorf("issued %v stats for hidden dirs and files, want 0", got)
	}
}

func TestCheckSubdirectorySampleCoversEveryDirectoryEventually(t *testing.T) {
	total := maxSubdirStatsPerPoll*2 + 7
	idx, entries, _ := newPollTestIndexer(t, total)
	seedSubdirModTimes(idx, entries)

	// Three polls are enough to sweep the whole set once at the current cap.
	before := counterValue(t, metrics.IndexerPollSubdirStats)
	for i := 0; i < 3; i++ {
		if idx.checkSubdirectorySample(entries) {
			t.Fatalf("poll %d reported a change when nothing was modified", i)
		}
	}

	if got := counterValue(t, metrics.IndexerPollSubdirStats) - before; got < float64(total) {
		t.Errorf("three polls covered %v directories, want at least %d — rotation must reach the whole set",
			got, total)
	}
}
