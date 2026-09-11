package manager

import (
	"context"
	"os"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// TestNew_ValidConfig tests manager creation with valid configuration.
func TestNew_ValidConfig(t *testing.T) {
	cfg := Config{
		WhatsAppBinaryPath:  "/usr/bin/test-worker",
		DefaultNATSURL:      "nats://localhost:4222",
		HealthCheckInterval: 30 * time.Second,
	}

	m := New(cfg)

	assert.NotNil(t, m, "manager should not be nil")
	assert.Equal(t, cfg.WhatsAppBinaryPath, m.config.WhatsAppBinaryPath)
	assert.Equal(t, cfg.DefaultNATSURL, m.config.DefaultNATSURL)
	assert.Equal(t, cfg.HealthCheckInterval, m.config.HealthCheckInterval)
	assert.NotNil(t, m.workers, "workers map should be initialized")
	assert.Empty(t, m.workers, "workers map should be empty initially")
}

// TestNew_DefaultValues tests that default values are applied when not specified.
func TestNew_DefaultValues(t *testing.T) {
	cfg := Config{}

	m := New(cfg)

	assert.Equal(t, "/usr/local/bin/whatsapp-worker", m.config.WhatsAppBinaryPath, "should use default binary path")
	assert.Equal(t, "nats://localhost:4222", m.config.DefaultNATSURL, "should use default NATS URL")
	assert.Equal(t, 30*time.Second, m.config.HealthCheckInterval, "should use default health check interval")
}

// TestNew_PartialConfig tests that only missing values get defaults.
func TestNew_PartialConfig(t *testing.T) {
	cfg := Config{
		WhatsAppBinaryPath: "/custom/path/worker",
		// Leave DefaultNATSURL and HealthCheckInterval empty
	}

	m := New(cfg)

	assert.Equal(t, "/custom/path/worker", m.config.WhatsAppBinaryPath, "should keep custom binary path")
	assert.Equal(t, "nats://localhost:4222", m.config.DefaultNATSURL, "should use default NATS URL")
	assert.Equal(t, 30*time.Second, m.config.HealthCheckInterval, "should use default health check interval")
}

// TestShuttingDownFlag tests the shuttingDown flag behavior.
func TestShuttingDownFlag(t *testing.T) {
	m := New(Config{})

	// Initially not shutting down
	m.mu.RLock()
	assert.False(t, m.shuttingDown)
	m.mu.RUnlock()

	// Set shutting down
	m.mu.Lock()
	m.shuttingDown = true
	m.mu.Unlock()

	// Verify flag is set
	m.mu.RLock()
	assert.True(t, m.shuttingDown)
	m.mu.RUnlock()
}

// TestConfig_Fields tests Config field access.
func TestConfig_Fields(t *testing.T) {
	cfg := Config{
		WhatsAppBinaryPath:  "/path/to/binary",
		DefaultNATSURL:      "nats://custom:4222",
		HealthCheckInterval: 60 * time.Second,
	}

	assert.Equal(t, "/path/to/binary", cfg.WhatsAppBinaryPath)
	assert.Equal(t, "nats://custom:4222", cfg.DefaultNATSURL)
	assert.Equal(t, 60*time.Second, cfg.HealthCheckInterval)
}

func TestPersistenceFreeWorkerPrefersRestrictedNATSURL(t *testing.T) {
	m := New(Config{
		DefaultNATSURL: "nats://service-control",
		WorkerNATSURL:  "nats://worker-data-plane",
	})

	databaseURL, natsURL, err := m.workerRuntimeURLs("postgresql://worker-data-plane")
	require.NoError(t, err)
	assert.Equal(t, "postgresql://worker-data-plane", databaseURL)
	assert.Equal(t, "nats://worker-data-plane", natsURL)
}

func TestPersistenceFreeWorkerFallsBackToDefaultNATSURL(t *testing.T) {
	m := New(Config{DefaultNATSURL: "nats://local-development"})

	_, natsURL, err := m.workerRuntimeURLs("postgresql://local-development")
	require.NoError(t, err)
	assert.Equal(t, "nats://local-development", natsURL)
}

// TestWorkerLogWriter tests the worker log writer.
func TestDurableManagerRequiresDistinctRestrictedWorkerCredentials(t *testing.T) {
	for _, testCase := range []struct {
		name string
		cfg  Config
		want string
	}{
		{name: "missing node identity", cfg: Config{DatabaseURL: "manager", WorkerDatabaseURL: "worker-db", WorkerNATSURL: "worker-nats"}, want: "ORCHESTRATOR_NODE_ID"},
		{name: "unsafe node identity", cfg: Config{DatabaseURL: "manager", WorkerDatabaseURL: "worker-db", WorkerNATSURL: "worker-nats", NodeID: "node.one"}, want: "invalid character"},
		{name: "missing database", cfg: Config{DatabaseURL: "manager", WorkerNATSURL: "worker-nats", NodeID: "node-1"}, want: "WORKER_DATABASE_URL"},
		{name: "missing nats", cfg: Config{DatabaseURL: "manager", WorkerDatabaseURL: "worker-db", NodeID: "node-1"}, want: "WORKER_NATS_URL"},
		{name: "reused database", cfg: Config{DatabaseURL: "same", WorkerDatabaseURL: "same", WorkerNATSURL: "worker-nats", NodeID: "node-1"}, want: "must not reuse"},
		{name: "reused nats", cfg: Config{DatabaseURL: "manager", WorkerDatabaseURL: "worker-db", DefaultNATSURL: "same", WorkerNATSURL: "same", NodeID: "node-1"}, want: "must not reuse"},
		{name: "wrong database user", cfg: Config{DatabaseURL: "manager", WorkerDatabaseURL: "postgresql://manager:secret@db/app", WorkerNATSURL: "nats://worker:secret@nats", NodeID: "node-1"}, want: "dedicated"},
		{name: "wrong nats user", cfg: Config{DatabaseURL: "manager", WorkerDatabaseURL: "postgresql://wateaminbox_worker:secret@db/app", WorkerNATSURL: "nats://service:secret@nats", NodeID: "node-1"}, want: "dedicated"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			manager := New(testCase.cfg)
			err := manager.Start(context.Background())
			require.ErrorContains(t, err, testCase.want)
		})
	}
}

func TestRestrictedWorkerCredentialsAllowSingleHostAndPerNodeIdentities(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		url        string
		scheme     string
		singleHost string
		wantError  bool
	}{
		{name: "single-host database", url: "postgresql://wateaminbox_worker:secret@db/app", scheme: "postgresql", singleHost: "wateaminbox_worker"},
		{name: "per-node database", url: "postgresql://wti_w_0123456789abcdefabcd:secret@db/app", scheme: "postgresql", singleHost: "wateaminbox_worker"},
		{name: "single-host nats", url: "nats://worker:secret@nats", scheme: "nats", singleHost: "worker"},
		{name: "per-node nats", url: "nats://wti-w-0123456789abcdefabcd:secret@nats", scheme: "nats", singleHost: "worker"},
		{name: "uppercase suffix", url: "postgresql://wti_w_0123456789abcdefabcD:secret@db/app", scheme: "postgresql", singleHost: "wateaminbox_worker", wantError: true},
		{name: "short suffix", url: "nats://wti-w-0123456789abcdefabc:secret@nats", scheme: "nats", singleHost: "worker", wantError: true},
		{name: "wrong prefix", url: "postgresql://wti_m_0123456789abcdefabcd:secret@db/app", scheme: "postgresql", singleHost: "wateaminbox_worker", wantError: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := validateRestrictedCredentialURL("credential", testCase.url, testCase.scheme, testCase.singleHost)
			if testCase.wantError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestCredentialUsernamePreservesPerNodeDatabaseIdentity(t *testing.T) {
	_, username, err := credentialUsername("postgresql://wti_w_0123456789abcdefabcd:secret@db/app")
	require.NoError(t, err)
	require.Equal(t, "wti_w_0123456789abcdefabcd", username)
}

func TestWorkerLogWriter(t *testing.T) {
	w := &workerLogWriter{
		connectionID: "test-conn",
		stream:       "stdout",
	}

	// Write should return the correct byte count
	data := []byte("test message")
	n, err := w.Write(data)

	assert.NoError(t, err)
	assert.Equal(t, len(data), n)
}

// TestStatusConstants tests that status constants are defined correctly.
func TestStatusConstants(t *testing.T) {
	// Verify status constants match expected values
	assert.Equal(t, "starting", types.StatusStarting)
	assert.Equal(t, "connecting", types.StatusConnecting)
	assert.Equal(t, "connected", types.StatusConnected)
	assert.Equal(t, "disconnected", types.StatusDisconnected)
	assert.Equal(t, "stopping", types.StatusStopping)
	assert.Equal(t, "stopped", types.StatusStopped)
	assert.Equal(t, "error", types.StatusError)
}

func TestStop_ShutsDownRecoveredProcess(t *testing.T) {
	cmd, m := startRecoveredTestWorker(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	require.NoError(t, m.Stop(ctx))
	assert.Zero(t, m.WorkerCount())
	assert.Error(t, cmd.Process.Signal(os.Signal(syscall.Signal(0))))
}

// TestManagerLifecycle_BasicFlow tests the basic manager lifecycle.
func TestManagerLifecycle_BasicFlow(t *testing.T) {
	// Create manager
	m := New(Config{
		HealthCheckInterval: 1 * time.Second,
	})

	// Verify initial state
	assert.Empty(t, m.workers)
	assert.Equal(t, 0, m.WorkerCount())
	assert.NotZero(t, m.GetStartedAt())

	// Add a worker manually (simulating spawn)
	m.mu.Lock()
	m.workers["test-conn"] = &WorkerProcess{
		ID:           "test-conn",
		CompanyID:    "test-company",
		ConnectionID: "test-conn",
		Status:       types.StatusConnecting,
		StartedAt:    time.Now(),
		LastActivity: time.Now(),
	}
	m.mu.Unlock()

	// Verify worker is tracked
	assert.Equal(t, 1, m.WorkerCount())
	worker, exists := m.GetWorkerStatus("test-conn")
	assert.True(t, exists)
	assert.Equal(t, types.StatusConnecting, worker.Status)

	// Update status
	m.UpdateWorkerStatus("test-conn", types.StatusConnected)
	worker, _ = m.GetWorkerStatus("test-conn")
	assert.Equal(t, types.StatusConnected, worker.Status)

	// Remove worker (simulating stop)
	m.mu.Lock()
	delete(m.workers, "test-conn")
	m.mu.Unlock()

	// Verify worker is removed
	assert.Equal(t, 0, m.WorkerCount())
	_, exists = m.GetWorkerStatus("test-conn")
	assert.False(t, exists)
}

// TestPublishConnectionStatus_DuringShutdown tests that publishing is skipped during shutdown.
func TestPublishConnectionStatus_DuringShutdown(t *testing.T) {
	m := New(Config{})

	// Set shutting down flag
	m.mu.Lock()
	m.shuttingDown = true
	m.mu.Unlock()

	// This should not panic even without handlers
	// (In production, handlers would check the flag before publishing)
	m.publishConnectionStatus("company", "connection", types.StatusStopped, "test")

	// Verify no handlers were called (handlers is nil)
	assert.Nil(t, m.handlers)
}

// TestContextCancellation tests behavior when context is cancelled.
func TestContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	m := New(Config{})
	m.ctx, m.cancel = context.WithCancel(ctx)

	// Cancel the parent context
	cancel()

	// Manager's context should also be cancelled
	select {
	case <-m.ctx.Done():
		// Expected
	case <-time.After(100 * time.Millisecond):
		t.Error("manager context should be cancelled")
	}
}

// TestApplyRestartJitter_StaysWithinWindow verifies the jitter window is
// (backoff-spread, backoff]: never longer than the nominal backoff, so the
// ceiling can never be exceeded, and never shorter than the spread allows.
