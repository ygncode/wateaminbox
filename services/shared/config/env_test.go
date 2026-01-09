package config

import (
	"os"
	"testing"
	"time"
)

func TestGetEnv(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		defaultValue string
		envValue     string
		setEnv       bool
		want         string
	}{
		{
			name:         "returns default when env not set",
			key:          "TEST_GET_ENV_UNSET",
			defaultValue: "default-value",
			setEnv:       false,
			want:         "default-value",
		},
		{
			name:         "returns env value when set",
			key:          "TEST_GET_ENV_SET",
			defaultValue: "default-value",
			envValue:     "env-value",
			setEnv:       true,
			want:         "env-value",
		},
		{
			name:         "returns default when env is empty string",
			key:          "TEST_GET_ENV_EMPTY",
			defaultValue: "default-value",
			envValue:     "",
			setEnv:       true,
			want:         "default-value",
		},
		{
			name:         "handles empty default",
			key:          "TEST_GET_ENV_EMPTY_DEFAULT",
			defaultValue: "",
			setEnv:       false,
			want:         "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Clean up before and after test
			os.Unsetenv(tt.key)
			defer os.Unsetenv(tt.key)

			if tt.setEnv {
				os.Setenv(tt.key, tt.envValue)
			}

			got := GetEnv(tt.key, tt.defaultValue)
			if got != tt.want {
				t.Errorf("GetEnv() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetDurationEnv(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		defaultValue time.Duration
		envValue     string
		setEnv       bool
		want         time.Duration
	}{
		{
			name:         "returns default when env not set",
			key:          "TEST_DURATION_UNSET",
			defaultValue: 30 * time.Second,
			setEnv:       false,
			want:         30 * time.Second,
		},
		{
			name:         "parses seconds correctly",
			key:          "TEST_DURATION_SECONDS",
			defaultValue: 30 * time.Second,
			envValue:     "60s",
			setEnv:       true,
			want:         60 * time.Second,
		},
		{
			name:         "parses minutes correctly",
			key:          "TEST_DURATION_MINUTES",
			defaultValue: 30 * time.Second,
			envValue:     "5m",
			setEnv:       true,
			want:         5 * time.Minute,
		},
		{
			name:         "parses hours correctly",
			key:          "TEST_DURATION_HOURS",
			defaultValue: 30 * time.Second,
			envValue:     "2h",
			setEnv:       true,
			want:         2 * time.Hour,
		},
		{
			name:         "parses complex duration correctly",
			key:          "TEST_DURATION_COMPLEX",
			defaultValue: 30 * time.Second,
			envValue:     "1h30m45s",
			setEnv:       true,
			want:         1*time.Hour + 30*time.Minute + 45*time.Second,
		},
		{
			name:         "returns default on invalid duration",
			key:          "TEST_DURATION_INVALID",
			defaultValue: 30 * time.Second,
			envValue:     "invalid",
			setEnv:       true,
			want:         30 * time.Second,
		},
		{
			name:         "returns default on empty string",
			key:          "TEST_DURATION_EMPTY",
			defaultValue: 30 * time.Second,
			envValue:     "",
			setEnv:       true,
			want:         30 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Unsetenv(tt.key)
			defer os.Unsetenv(tt.key)

			if tt.setEnv {
				os.Setenv(tt.key, tt.envValue)
			}

			got := GetDurationEnv(tt.key, tt.defaultValue)
			if got != tt.want {
				t.Errorf("GetDurationEnv() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetIntEnv(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		defaultValue int
		envValue     string
		setEnv       bool
		want         int
	}{
		{
			name:         "returns default when env not set",
			key:          "TEST_INT_UNSET",
			defaultValue: 42,
			setEnv:       false,
			want:         42,
		},
		{
			name:         "parses positive integer",
			key:          "TEST_INT_POSITIVE",
			defaultValue: 42,
			envValue:     "100",
			setEnv:       true,
			want:         100,
		},
		{
			name:         "parses negative integer",
			key:          "TEST_INT_NEGATIVE",
			defaultValue: 42,
			envValue:     "-50",
			setEnv:       true,
			want:         -50,
		},
		{
			name:         "parses zero",
			key:          "TEST_INT_ZERO",
			defaultValue: 42,
			envValue:     "0",
			setEnv:       true,
			want:         0,
		},
		{
			name:         "returns default on invalid integer",
			key:          "TEST_INT_INVALID",
			defaultValue: 42,
			envValue:     "not-a-number",
			setEnv:       true,
			want:         42,
		},
		{
			name:         "returns default on float value",
			key:          "TEST_INT_FLOAT",
			defaultValue: 42,
			envValue:     "3.14",
			setEnv:       true,
			want:         42,
		},
		{
			name:         "returns default on empty string",
			key:          "TEST_INT_EMPTY",
			defaultValue: 42,
			envValue:     "",
			setEnv:       true,
			want:         42,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Unsetenv(tt.key)
			defer os.Unsetenv(tt.key)

			if tt.setEnv {
				os.Setenv(tt.key, tt.envValue)
			}

			got := GetIntEnv(tt.key, tt.defaultValue)
			if got != tt.want {
				t.Errorf("GetIntEnv() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetInt64Env(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		defaultValue int64
		envValue     string
		setEnv       bool
		want         int64
	}{
		{
			name:         "returns default when env not set",
			key:          "TEST_INT64_UNSET",
			defaultValue: 42,
			setEnv:       false,
			want:         42,
		},
		{
			name:         "parses large positive integer",
			key:          "TEST_INT64_LARGE",
			defaultValue: 42,
			envValue:     "9223372036854775807", // max int64
			setEnv:       true,
			want:         9223372036854775807,
		},
		{
			name:         "parses large negative integer",
			key:          "TEST_INT64_LARGE_NEG",
			defaultValue: 42,
			envValue:     "-9223372036854775808", // min int64
			setEnv:       true,
			want:         -9223372036854775808,
		},
		{
			name:         "returns default on invalid",
			key:          "TEST_INT64_INVALID",
			defaultValue: 42,
			envValue:     "invalid",
			setEnv:       true,
			want:         42,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Unsetenv(tt.key)
			defer os.Unsetenv(tt.key)

			if tt.setEnv {
				os.Setenv(tt.key, tt.envValue)
			}

			got := GetInt64Env(tt.key, tt.defaultValue)
			if got != tt.want {
				t.Errorf("GetInt64Env() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetBoolEnv(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		defaultValue bool
		envValue     string
		setEnv       bool
		want         bool
	}{
		{
			name:         "returns default when env not set",
			key:          "TEST_BOOL_UNSET",
			defaultValue: true,
			setEnv:       false,
			want:         true,
		},
		{
			name:         "parses 'true'",
			key:          "TEST_BOOL_TRUE",
			defaultValue: false,
			envValue:     "true",
			setEnv:       true,
			want:         true,
		},
		{
			name:         "parses 'false'",
			key:          "TEST_BOOL_FALSE",
			defaultValue: true,
			envValue:     "false",
			setEnv:       true,
			want:         false,
		},
		{
			name:         "parses '1' as true",
			key:          "TEST_BOOL_ONE",
			defaultValue: false,
			envValue:     "1",
			setEnv:       true,
			want:         true,
		},
		{
			name:         "parses '0' as false",
			key:          "TEST_BOOL_ZERO",
			defaultValue: true,
			envValue:     "0",
			setEnv:       true,
			want:         false,
		},
		{
			name:         "parses 'TRUE' (uppercase)",
			key:          "TEST_BOOL_UPPER",
			defaultValue: false,
			envValue:     "TRUE",
			setEnv:       true,
			want:         true,
		},
		{
			name:         "parses 'False' (mixed case)",
			key:          "TEST_BOOL_MIXED",
			defaultValue: true,
			envValue:     "False",
			setEnv:       true,
			want:         false,
		},
		{
			name:         "returns default on invalid",
			key:          "TEST_BOOL_INVALID",
			defaultValue: true,
			envValue:     "yes", // 'yes' is not accepted by strconv.ParseBool
			setEnv:       true,
			want:         true,
		},
		{
			name:         "returns default on empty string",
			key:          "TEST_BOOL_EMPTY",
			defaultValue: true,
			envValue:     "",
			setEnv:       true,
			want:         true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Unsetenv(tt.key)
			defer os.Unsetenv(tt.key)

			if tt.setEnv {
				os.Setenv(tt.key, tt.envValue)
			}

			got := GetBoolEnv(tt.key, tt.defaultValue)
			if got != tt.want {
				t.Errorf("GetBoolEnv() = %v, want %v", got, tt.want)
			}
		})
	}
}
