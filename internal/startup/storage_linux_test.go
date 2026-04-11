package startup

import "testing"

func TestClassifyUnsafeDBFilesystemType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		fsType     int64
		wantUnsafe bool
		wantName   string
	}{
		{name: "nfs", fsType: dbFSTypeNFS, wantUnsafe: true, wantName: "NFS"},
		{name: "smb", fsType: dbFSTypeSMB, wantUnsafe: true, wantName: "SMB"},
		{name: "cifs", fsType: dbFSTypeCIFS, wantUnsafe: true, wantName: "CIFS"},
		{name: "9p", fsType: dbFSType9P, wantUnsafe: true, wantName: "9P/WSL"},
		{name: "ext4", fsType: 0xEF53, wantUnsafe: false, wantName: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			gotUnsafe, gotName := classifyUnsafeDBFilesystemType(tt.fsType)
			if gotUnsafe != tt.wantUnsafe {
				t.Errorf("classifyUnsafeDBFilesystemType(%#x) unsafe = %v, want %v", tt.fsType, gotUnsafe, tt.wantUnsafe)
			}
			if gotName != tt.wantName {
				t.Errorf("classifyUnsafeDBFilesystemType(%#x) name = %q, want %q", tt.fsType, gotName, tt.wantName)
			}
		})
	}
}
