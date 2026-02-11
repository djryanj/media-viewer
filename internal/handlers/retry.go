package handlers

import (
	"media-viewer/internal/filesystem"
)

// NFSRetryConfig is an alias for filesystem.RetryConfig for backward compatibility
type NFSRetryConfig = filesystem.RetryConfig

// DefaultNFSRetryConfig returns sensible defaults for NFS retry behavior
func DefaultNFSRetryConfig() NFSRetryConfig {
	return filesystem.DefaultRetryConfig()
}

// StatWithRetry performs os.Stat with retry logic for NFS stale file handle errors
var StatWithRetry = filesystem.StatWithRetry

// OpenWithRetry performs os.Open with retry logic for NFS stale file handle errors
var OpenWithRetry = filesystem.OpenWithRetry
