package startup

import (
	"path/filepath"

	"media-viewer/internal/logging"

	"golang.org/x/sys/unix"
)

const (
	dbFSType9P   = int64(0x01021997)
	dbFSTypeCIFS = int64(0xFF534D42)
	dbFSTypeNFS  = int64(0x6969)
	dbFSTypeSMB  = int64(0x517B)
	storageNFS   = "NFS"
	storage9PWSL = "9P/WSL"
)

func detectUnsafeDBStorage(path string) (unsafe bool, storageName string) {
	resolvedPath, err := filepath.Abs(path)
	if err != nil {
		resolvedPath = path
	}

	var stat unix.Statfs_t
	if err := unix.Statfs(resolvedPath, &stat); err != nil {
		logging.Warn("  Failed to inspect database filesystem type for %s: %v", resolvedPath, err)
		return false, ""
	}

	return classifyUnsafeDBFilesystemType(stat.Type)
}

func classifyUnsafeDBFilesystemType(fsType int64) (unsafe bool, storageName string) {
	switch fsType {
	case dbFSTypeNFS:
		return true, storageNFS
	case dbFSTypeSMB:
		return true, "SMB"
	case dbFSTypeCIFS:
		return true, "CIFS"
	case dbFSType9P:
		return true, storage9PWSL
	default:
		return false, ""
	}
}
