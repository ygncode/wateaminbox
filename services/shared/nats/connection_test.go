package nats

import (
	"testing"
	"time"
)

func TestConnectionConfigDefaults(t *testing.T) {
	cfg := ConnectionConfig{
		URL: "nats://localhost:4222",
	}

	// Test that buildConnectionOptions works with minimal config
	opts := buildConnectionOptions(cfg)

	// Should have at least retry, max reconnects, reconnect wait, and handlers
	if len(opts) < 4 {
		t.Errorf("Expected at least 4 options, got %d", len(opts))
	}
}

func TestConnectionConfigWithName(t *testing.T) {
	cfg := ConnectionConfig{
		URL:  "nats://localhost:4222",
		Name: "test-client",
	}

	opts := buildConnectionOptions(cfg)

	// Should have one more option for name
	if len(opts) < 5 {
		t.Errorf("Expected at least 5 options with name, got %d", len(opts))
	}
}

func TestConnectionConfigRetryOnFailedConnect(t *testing.T) {
	tests := []struct {
		name    string
		retry   *bool
		wantLen int
	}{
		{
			name:    "nil (uses default true)",
			retry:   nil,
			wantLen: 4,
		},
		{
			name:    "explicit true",
			retry:   boolPtr(true),
			wantLen: 4,
		},
		{
			name:    "explicit false",
			retry:   boolPtr(false),
			wantLen: 4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := ConnectionConfig{
				URL:                  "nats://localhost:4222",
				RetryOnFailedConnect: tt.retry,
			}

			opts := buildConnectionOptions(cfg)
			if len(opts) < tt.wantLen {
				t.Errorf("Expected at least %d options, got %d", tt.wantLen, len(opts))
			}
		})
	}
}

func TestConnectionConfigMaxReconnects(t *testing.T) {
	tests := []struct {
		name   string
		max    *int
		expect string
	}{
		{
			name:   "nil (uses default unlimited)",
			max:    nil,
			expect: "default",
		},
		{
			name:   "explicit 10",
			max:    intPtr(10),
			expect: "custom",
		},
		{
			name:   "explicit 0 (no reconnects)",
			max:    intPtr(0),
			expect: "none",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := ConnectionConfig{
				URL:           "nats://localhost:4222",
				MaxReconnects: tt.max,
			}

			opts := buildConnectionOptions(cfg)
			// Just verify it doesn't panic and returns options
			if len(opts) < 4 {
				t.Errorf("Expected at least 4 options, got %d", len(opts))
			}
		})
	}
}

func TestConnectionConfigReconnectWait(t *testing.T) {
	tests := []struct {
		name string
		wait time.Duration
	}{
		{
			name: "zero (uses default 1 second)",
			wait: 0,
		},
		{
			name: "custom 5 seconds",
			wait: 5 * time.Second,
		},
		{
			name: "custom 100ms",
			wait: 100 * time.Millisecond,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := ConnectionConfig{
				URL:           "nats://localhost:4222",
				ReconnectWait: tt.wait,
			}

			opts := buildConnectionOptions(cfg)
			if len(opts) < 4 {
				t.Errorf("Expected at least 4 options, got %d", len(opts))
			}
		})
	}
}

func TestConnectionConfigHandlers(t *testing.T) {
	disconnectCalled := false
	reconnectCalled := false

	cfg := ConnectionConfig{
		URL:  "nats://localhost:4222",
		Name: "test-client",
		DisconnectHandler: func(err error) {
			disconnectCalled = true
		},
		ReconnectHandler: func() {
			reconnectCalled = true
		},
	}

	opts := buildConnectionOptions(cfg)

	// Verify options were created without panic
	if len(opts) < 5 {
		t.Errorf("Expected at least 5 options, got %d", len(opts))
	}

	// The handlers are set but not called in this test
	// (would require a real NATS connection to test)
	_ = disconnectCalled
	_ = reconnectCalled
}

func TestNewConnectionRequiresURL(t *testing.T) {
	cfg := ConnectionConfig{
		URL: "",
	}

	_, err := NewConnection(nil, cfg)
	if err == nil {
		t.Error("Expected error for empty URL")
	}
}

func TestNewConnectionWithInvalidURL(t *testing.T) {
	cfg := ConnectionConfig{
		URL: "nats://nonexistent:4222",
	}

	// Disable retry to fail fast
	retry := false
	cfg.RetryOnFailedConnect = &retry

	_, err := NewConnection(nil, cfg)
	if err == nil {
		t.Error("Expected error for invalid URL")
	}
}

// Helper functions
func boolPtr(b bool) *bool {
	return &b
}

func intPtr(i int) *int {
	return &i
}

// TestConnectionMethods tests the Connection wrapper methods
// Note: These tests require mocking or a real NATS server
// Here we just test the nil-safety of methods

func TestConnectionMethodsNilSafe(t *testing.T) {
	// Test that methods don't panic with nil connection
	c := &Connection{
		nc:  nil,
		js:  nil,
		cfg: ConnectionConfig{},
	}

	// These should return nil/empty/false without panic
	if c.Conn() != nil {
		t.Error("Conn() should return nil for nil connection")
	}

	if c.JetStream() != nil {
		t.Error("JetStream() should return nil for nil JetStream")
	}

	if c.IsConnected() {
		t.Error("IsConnected() should return false for nil connection")
	}

	if c.ConnectedUrl() != "" {
		t.Error("ConnectedUrl() should return empty for nil connection")
	}

	// Close should not panic with nil connection
	c.Close()
}
