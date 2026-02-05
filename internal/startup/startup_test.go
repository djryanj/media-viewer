package startup

import (
	"os"
	"testing"
)

func TestGetBuildInfo(t *testing.T) {
	info := GetBuildInfo()

	// Check that all fields are populated
	if info.Version == "" {
		t.Error("Expected Version to be set")
	}
	if info.GoVersion == "" {
		t.Error("Expected GoVersion to be set")
	}
	if info.OS == "" {
		t.Error("Expected OS to be set")
	}
	if info.Arch == "" {
		t.Error("Expected Arch to be set")
	}

	// Verify that runtime values are correct
	if info.GoVersion != GoVersion {
		t.Errorf("Expected GoVersion=%s, got %s", GoVersion, info.GoVersion)
	}
}

func TestGetEnv(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		defaultValue string
		envValue     string
		want         string
		setEnv       bool
	}{
		{
			name:         "Returns default when env var not set",
			key:          "TEST_UNSET_VAR",
			defaultValue: "default",
			want:         "default",
			setEnv:       false,
		},
		{
			name:         "Returns env value when set",
			key:          "TEST_SET_VAR",
			defaultValue: "default",
			envValue:     "custom",
			want:         "custom",
			setEnv:       true,
		},
		{
			name:         "Returns empty string when env var is empty",
			key:          "TEST_EMPTY_VAR",
			defaultValue: "default",
			envValue:     "",
			want:         "",
			setEnv:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setEnv {
				t.Setenv(tt.key, tt.envValue)
			} else {
				// Ensure the variable is not set
				os.Unsetenv(tt.key)
				t.Cleanup(func() {
					os.Unsetenv(tt.key)
				})
			}

			got := getEnv(tt.key, tt.defaultValue)
			if got != tt.want {
				t.Errorf("getEnv(%q, %q) = %q, want %q", tt.key, tt.defaultValue, got, tt.want)
			}
		})
	}
}

func TestRouteInfo(t *testing.T) {
	route := RouteInfo{
		Method: "GET",
		Path:   "/api/test",
		Name:   "TestRoute",
	}

	if route.Method != "GET" {
		t.Errorf("Expected Method=GET, got %s", route.Method)
	}
	if route.Path != "/api/test" {
		t.Errorf("Expected Path=/api/test, got %s", route.Path)
	}
	if route.Name != "TestRoute" {
		t.Errorf("Expected Name=TestRoute, got %s", route.Name)
	}
}
