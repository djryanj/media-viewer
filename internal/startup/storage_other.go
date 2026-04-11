//go:build !linux

package startup

func detectUnsafeDBStorage(string) (bool, string) {
	return false, ""
}
