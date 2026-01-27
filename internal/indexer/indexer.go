package indexer

import (
	"crypto/md5"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"media-viewer/internal/database"

	"github.com/fsnotify/fsnotify"
)

var imageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
	".bmp": true, ".webp": true, ".svg": true, ".ico": true,
	".tiff": true, ".tif": true, ".heic": true, ".heif": true,
}

var videoExtensions = map[string]bool{
	".mp4": true, ".mkv": true, ".avi": true, ".mov": true,
	".wmv": true, ".flv": true, ".webm": true, ".m4v": true,
	".mpeg": true, ".mpg": true, ".3gp": true, ".ts": true,
}

var playlistExtensions = map[string]bool{
	".wpl": true,
}

var mimeTypes = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
	".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
	".svg": "image/svg+xml", ".ico": "image/x-icon",
	".mp4": "video/mp4", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
	".mov": "video/quicktime", ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv",
	".webm": "video/webm", ".m4v": "video/x-m4v",
	".wpl": "application/vnd.ms-wpl",
}

type Indexer struct {
	db            *database.Database
	mediaDir      string
	indexInterval time.Duration
	watcher       *fsnotify.Watcher
	stopChan      chan struct{}
	indexMu       sync.Mutex
	isIndexing    bool
	lastIndexTime time.Time
}

func New(db *database.Database, mediaDir string, indexInterval time.Duration) *Indexer {
	return &Indexer{
		db:            db,
		mediaDir:      mediaDir,
		indexInterval: indexInterval,
		stopChan:      make(chan struct{}),
	}
}

func (idx *Indexer) Start() error {
	// Initial index
	log.Println("Starting initial index...")
	if err := idx.Index(); err != nil {
		log.Printf("Initial index error: %v", err)
	}

	// Start file watcher
	go idx.watchFiles()

	// Start periodic re-index
	go idx.periodicIndex()

	return nil
}

func (idx *Indexer) Stop() {
	close(idx.stopChan)
	if idx.watcher != nil {
		idx.watcher.Close()
	}
}

func (idx *Indexer) Index() error {
	idx.indexMu.Lock()
	if idx.isIndexing {
		idx.indexMu.Unlock()
		log.Println("Index already in progress, skipping...")
		return nil
	}
	idx.isIndexing = true
	idx.indexMu.Unlock()

	defer func() {
		idx.indexMu.Lock()
		idx.isIndexing = false
		idx.indexMu.Unlock()
	}()

	startTime := time.Now()
	log.Println("Starting file index...")

	log.Println("[DEBUG] Starting file index - acquiring database lock...")

	tx, err := idx.db.BeginBatch()
	if err != nil {
		log.Printf("[ERROR] Failed to begin transaction: %v", err)
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	log.Println("[DEBUG] Database lock acquired, scanning files...")

	indexTime := time.Now()
	fileCount := 0
	folderCount := 0

	err = filepath.Walk(idx.mediaDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("Error accessing path %s: %v", path, err)
			return nil // Continue walking
		}

		// Skip hidden files and directories
		if strings.HasPrefix(info.Name(), ".") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		relPath, err := filepath.Rel(idx.mediaDir, path)
		if err != nil {
			return nil
		}

		// Skip root
		if relPath == "." {
			return nil
		}

		// Determine parent path
		parentPath := filepath.Dir(relPath)
		if parentPath == "." {
			parentPath = ""
		}

		var file database.MediaFile

		if info.IsDir() {
			file = database.MediaFile{
				Name:       info.Name(),
				Path:       relPath,
				ParentPath: parentPath,
				Type:       database.FileTypeFolder,
				Size:       0,
				ModTime:    info.ModTime(),
				FileHash:   fmt.Sprintf("%x", md5.Sum([]byte(relPath+info.ModTime().String()))),
			}
			folderCount++
		} else {
			ext := strings.ToLower(filepath.Ext(info.Name()))
			fileType := getFileType(ext)

			// Skip unsupported files
			if fileType == "" {
				return nil
			}

			file = database.MediaFile{
				Name:       info.Name(),
				Path:       relPath,
				ParentPath: parentPath,
				Type:       database.FileType(fileType),
				Size:       info.Size(),
				ModTime:    info.ModTime(),
				MimeType:   mimeTypes[ext],
				FileHash:   fmt.Sprintf("%x", md5.Sum([]byte(fmt.Sprintf("%s%d%d", relPath, info.Size(), info.ModTime().Unix())))),
			}
			fileCount++
		}

		if err := idx.db.UpsertFile(tx, &file); err != nil {
			log.Printf("Error upserting file %s: %v", relPath, err)
		}

		// Log progress every 1000 items
		if (fileCount+folderCount)%1000 == 0 {
			log.Printf("Indexed %d files, %d folders...", fileCount, folderCount)
		}

		return nil
	})

	if err != nil {
		idx.db.EndBatch(tx, err)
		return fmt.Errorf("walk error: %w", err)
	}

	// Delete files that no longer exist
	deleted, err := idx.db.DeleteMissingFiles(tx, indexTime)
	if err != nil {
		log.Printf("Error deleting missing files: %v", err)
	} else if deleted > 0 {
		log.Printf("Removed %d missing files from index", deleted)
	}

	if err := idx.db.EndBatch(tx, nil); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	duration := time.Since(startTime)
	idx.lastIndexTime = time.Now()

	// Update stats
	stats, _ := idx.db.CalculateStats()
	stats.LastIndexed = idx.lastIndexTime
	stats.IndexDuration = duration.String()
	idx.db.UpdateStats(stats)

	log.Printf("Index complete: %d files, %d folders in %v", fileCount, folderCount, duration)

	return nil
}

func (idx *Indexer) watchFiles() {
	var err error
	idx.watcher, err = fsnotify.NewWatcher()
	if err != nil {
		log.Printf("Failed to create file watcher: %v", err)
		return
	}

	// Add all directories to watcher
	filepath.Walk(idx.mediaDir, func(path string, info os.FileInfo, err error) error {
		if err == nil && info.IsDir() && !strings.HasPrefix(info.Name(), ".") {
			idx.watcher.Add(path)
		}
		return nil
	})

	log.Println("File watcher started")

	// Debounce mechanism
	var debounceTimer *time.Timer
	var debounceMu sync.Mutex

	triggerReindex := func() {
		debounceMu.Lock()
		defer debounceMu.Unlock()

		if debounceTimer != nil {
			debounceTimer.Stop()
		}
		debounceTimer = time.AfterFunc(2*time.Second, func() {
			log.Println("File changes detected, re-indexing...")
			idx.Index()
		})
	}

	for {
		select {
		case event, ok := <-idx.watcher.Events:
			if !ok {
				return
			}

			// Skip hidden files
			if strings.Contains(event.Name, "/.") {
				continue
			}

			switch {
			case event.Op&fsnotify.Create != 0:
				// Add new directories to watcher
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					idx.watcher.Add(event.Name)
				}
				triggerReindex()

			case event.Op&fsnotify.Remove != 0:
				triggerReindex()

			case event.Op&fsnotify.Rename != 0:
				triggerReindex()

			case event.Op&fsnotify.Write != 0:
				// Only trigger for non-directory writes
				if info, err := os.Stat(event.Name); err == nil && !info.IsDir() {
					triggerReindex()
				}
			}

		case err, ok := <-idx.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Watcher error: %v", err)

		case <-idx.stopChan:
			return
		}
	}
}

func (idx *Indexer) periodicIndex() {
	ticker := time.NewTicker(idx.indexInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			log.Println("Periodic re-index triggered")
			idx.Index()
		case <-idx.stopChan:
			return
		}
	}
}

func (idx *Indexer) IsIndexing() bool {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()
	return idx.isIndexing
}

func (idx *Indexer) LastIndexTime() time.Time {
	idx.indexMu.Lock()
	defer idx.indexMu.Unlock()
	return idx.lastIndexTime
}

// TriggerIndex manually triggers a re-index
func (idx *Indexer) TriggerIndex() {
	go idx.Index()
}

func getFileType(ext string) string {
	if imageExtensions[ext] {
		return "image"
	}
	if videoExtensions[ext] {
		return "video"
	}
	if playlistExtensions[ext] {
		return "playlist"
	}
	return ""
}
