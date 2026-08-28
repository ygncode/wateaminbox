package manager

import (
	"context"
	"os"
	"os/exec"
	"strings"
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

// TestGetWorkerStatus_NotFound tests getting status of non-existent worker.
func TestGetWorkerStatus_NotFound(t *testing.T) {
	m := New(Config{})

	worker, exists := m.GetWorkerStatus("non-existent-id")

	assert.False(t, exists, "should not find non-existent worker")
	assert.Nil(t, worker, "worker should be nil when not found")
}

// TestGetWorkerStatus_Exists tests getting status of existing worker.
func TestGetWorkerStatus_Exists(t *testing.T) {
	m := New(Config{})

	// Manually add a worker for testing
	testWorker := &WorkerProcess{
		ID:           "test-connection-123",
		CompanyID:    "company-456",
		ConnectionID: "test-connection-123",
		TenantSchema: "tenant_company_456",
		Status:       types.StatusConnected,
		PID:          12345,
		StartedAt:    time.Now().Add(-1 * time.Hour),
		LastActivity: time.Now().Add(-5 * time.Minute),
	}
	m.workers["test-connection-123"] = testWorker

	worker, exists := m.GetWorkerStatus("test-connection-123")

	assert.True(t, exists, "should find existing worker")
	require.NotNil(t, worker, "worker should not be nil")
	assert.Equal(t, "test-connection-123", worker.ID)
	assert.Equal(t, "company-456", worker.CompanyID)
	assert.Equal(t, types.StatusConnected, worker.Status)
	assert.Equal(t, 12345, worker.PID)
}

// TestGetWorkerStatus_ReturnsCopy tests that GetWorkerStatus returns a copy.
func TestGetWorkerStatus_ReturnsCopy(t *testing.T) {
	m := New(Config{})

	testWorker := &WorkerProcess{
		ID:           "test-id",
		CompanyID:    "company-id",
		ConnectionID: "test-id",
		Status:       types.StatusConnected,
	}
	m.workers["test-id"] = testWorker

	worker, _ := m.GetWorkerStatus("test-id")

	// Modify the returned copy
	worker.Status = types.StatusError

	// Original should be unchanged
	assert.Equal(t, types.StatusConnected, m.workers["test-id"].Status, "original worker should be unchanged")
}

// TestListWorkers_Empty tests listing workers when none exist.
func TestListWorkers_Empty(t *testing.T) {
	m := New(Config{})

	workers := m.ListWorkers()

	assert.Empty(t, workers, "should return empty slice when no workers")
	assert.NotNil(t, workers, "should return non-nil slice")
}

// TestListWorkers_Multiple tests listing multiple workers.
func TestListWorkers_Multiple(t *testing.T) {
	m := New(Config{})

	// Add multiple workers
	m.workers["conn-1"] = &WorkerProcess{
		ID:           "conn-1",
		CompanyID:    "company-a",
		ConnectionID: "conn-1",
		Status:       types.StatusConnected,
	}
	m.workers["conn-2"] = &WorkerProcess{
		ID:           "conn-2",
		CompanyID:    "company-b",
		ConnectionID: "conn-2",
		Status:       types.StatusConnecting,
	}
	m.workers["conn-3"] = &WorkerProcess{
		ID:           "conn-3",
		CompanyID:    "company-a",
		ConnectionID: "conn-3",
		Status:       types.StatusError,
	}

	workers := m.ListWorkers()

	assert.Len(t, workers, 3, "should return all workers")

	// Verify all workers are present (order not guaranteed)
	ids := make(map[string]bool)
	for _, w := range workers {
		ids[w.ID] = true
	}
	assert.True(t, ids["conn-1"], "should contain conn-1")
	assert.True(t, ids["conn-2"], "should contain conn-2")
	assert.True(t, ids["conn-3"], "should contain conn-3")
}

// TestListWorkersByCompany_Empty tests filtering when no workers match.
func TestListWorkersByCompany_Empty(t *testing.T) {
	m := New(Config{})

	m.workers["conn-1"] = &WorkerProcess{
		ID:        "conn-1",
		CompanyID: "company-a",
	}

	workers := m.ListWorkersByCompany("company-x")

	assert.Empty(t, workers, "should return empty slice when no workers match")
}

// TestListWorkersByCompany_Filtered tests filtering workers by company.
func TestListWorkersByCompany_Filtered(t *testing.T) {
	m := New(Config{})

	m.workers["conn-1"] = &WorkerProcess{
		ID:        "conn-1",
		CompanyID: "company-a",
	}
	m.workers["conn-2"] = &WorkerProcess{
		ID:        "conn-2",
		CompanyID: "company-b",
	}
	m.workers["conn-3"] = &WorkerProcess{
		ID:        "conn-3",
		CompanyID: "company-a",
	}

	workers := m.ListWorkersByCompany("company-a")

	assert.Len(t, workers, 2, "should return only company-a workers")
	for _, w := range workers {
		assert.Equal(t, "company-a", w.CompanyID, "all workers should belong to company-a")
	}
}

// TestUpdateWorkerStatus_Exists tests updating status of existing worker.
func TestUpdateWorkerStatus_Exists(t *testing.T) {
	m := New(Config{})

	initialTime := time.Now().Add(-1 * time.Hour)
	m.workers["conn-1"] = &WorkerProcess{
		ID:           "conn-1",
		Status:       types.StatusConnecting,
		LastActivity: initialTime,
	}

	m.UpdateWorkerStatus("conn-1", types.StatusConnected)

	assert.Equal(t, types.StatusConnected, m.workers["conn-1"].Status, "status should be updated")
	assert.True(t, m.workers["conn-1"].LastActivity.After(initialTime), "last activity should be updated")
}

// TestUpdateWorkerStatus_NotFound tests updating status of non-existent worker.
func TestUpdateWorkerStatus_NotFound(t *testing.T) {
	m := New(Config{})

	// Should not panic
	m.UpdateWorkerStatus("non-existent", types.StatusConnected)

	// Verify no worker was created
	assert.Empty(t, m.workers)
}

// TestUpdateWorkerActivity_Exists tests updating activity time.
func TestUpdateWorkerActivity_Exists(t *testing.T) {
	m := New(Config{})

	initialTime := time.Now().Add(-1 * time.Hour)
	m.workers["conn-1"] = &WorkerProcess{
		ID:           "conn-1",
		LastActivity: initialTime,
	}

	m.UpdateWorkerActivity("conn-1")

	assert.True(t, m.workers["conn-1"].LastActivity.After(initialTime), "last activity should be updated")
}

// TestUpdateWorkerActivity_NotFound tests updating activity of non-existent worker.
func TestUpdateWorkerActivity_NotFound(t *testing.T) {
	m := New(Config{})

	// Should not panic
	m.UpdateWorkerActivity("non-existent")

	// Verify no worker was created
	assert.Empty(t, m.workers)
}

// TestWorkerCount_Empty tests counting workers when none exist.
func TestWorkerCount_Empty(t *testing.T) {
	m := New(Config{})

	count := m.WorkerCount()

	assert.Equal(t, 0, count, "should return 0 when no workers")
}

// TestWorkerCount_Multiple tests counting multiple workers.
func TestWorkerCount_Multiple(t *testing.T) {
	m := New(Config{})

	m.workers["conn-1"] = &WorkerProcess{ID: "conn-1"}
	m.workers["conn-2"] = &WorkerProcess{ID: "conn-2"}
	m.workers["conn-3"] = &WorkerProcess{ID: "conn-3"}

	count := m.WorkerCount()

	assert.Equal(t, 3, count, "should return correct count")
}

// TestGetStartedAt tests getting the manager start time.
func TestGetStartedAt(t *testing.T) {
	before := time.Now()
	m := New(Config{})
	after := time.Now()

	startedAt := m.GetStartedAt()

	assert.True(t, startedAt.After(before) || startedAt.Equal(before), "started time should be >= before")
	assert.True(t, startedAt.Before(after) || startedAt.Equal(after), "started time should be <= after")
}

// TestConcurrentAccess tests thread-safety of worker operations.
func TestConcurrentAccess(t *testing.T) {
	m := New(Config{})

	// Pre-populate with some workers
	for i := 0; i < 10; i++ {
		id := string(rune('a' + i))
		m.workers[id] = &WorkerProcess{
			ID:        id,
			CompanyID: "company",
			Status:    types.StatusConnected,
		}
	}

	done := make(chan bool)

	// Concurrent reads
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				_ = m.ListWorkers()
				_ = m.WorkerCount()
				_, _ = m.GetWorkerStatus("a")
			}
			done <- true
		}()
	}

	// Concurrent status updates
	for i := 0; i < 5; i++ {
		go func(idx int) {
			for j := 0; j < 100; j++ {
				id := string(rune('a' + (idx % 10)))
				m.UpdateWorkerStatus(id, types.StatusConnected)
				m.UpdateWorkerActivity(id)
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify integrity
	assert.Equal(t, 10, m.WorkerCount(), "worker count should remain consistent")
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

// TestWorkerProcess_Fields tests WorkerProcess field access.
func TestWorkerProcess_Fields(t *testing.T) {
	now := time.Now()
	worker := &WorkerProcess{
		ID:           "worker-123",
		CompanyID:    "company-456",
		ConnectionID: "conn-789",
		TenantSchema: "tenant_company_456",
		DatabaseURL:  "postgres://localhost/db",
		Status:       types.StatusConnected,
		PID:          54321,
		StartedAt:    now,
		LastActivity: now,
	}

	assert.Equal(t, "worker-123", worker.ID)
	assert.Equal(t, "company-456", worker.CompanyID)
	assert.Equal(t, "conn-789", worker.ConnectionID)
	assert.Equal(t, "tenant_company_456", worker.TenantSchema)
	assert.Equal(t, "postgres://localhost/db", worker.DatabaseURL)
	assert.Equal(t, types.StatusConnected, worker.Status)
	assert.Equal(t, 54321, worker.PID)
	assert.Equal(t, now, worker.StartedAt)
	assert.Equal(t, now, worker.LastActivity)
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

func TestWorkerEnvironmentIsStrictDataPlaneAllowlist(t *testing.T) {
	for name, value := range map[string]string{
		"HTTP_BEARER_TOKEN":        "rollout-authority",
		"JWT_SECRET":               "jwt-authority",
		"DATABASE_URL":             "postgresql://manager-control",
		"NATS_URL":                 "nats://service-control",
		"POSTGRES_PASSWORD":        "manager-password",
		"NATS_SERVICE_PASSWORD":    "service-password",
		"PATH":                     "/privileged/bin",
		"S3_ENDPOINT":              "https://storage.example",
		"S3_ACCESS_KEY":            "shared-data-plane-key",
		"WORKER_DB_MAX_OPEN_CONNS": "4",
	} {
		t.Setenv(name, value)
	}

	environment := workerBaseEnvironment()
	joined := strings.Join(environment, "\n")
	for _, forbidden := range []string{
		"HTTP_BEARER_TOKEN=", "JWT_SECRET=", "DATABASE_URL=", "NATS_URL=",
		"POSTGRES_PASSWORD=", "NATS_SERVICE_PASSWORD=", "PATH=",
	} {
		assert.NotContains(t, joined, forbidden)
	}
	assert.Contains(t, joined, "S3_ENDPOINT=https://storage.example")
	assert.Contains(t, joined, "S3_ACCESS_KEY=shared-data-plane-key")
	assert.Contains(t, joined, "WORKER_DB_MAX_OPEN_CONNS=4")
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

func startRecoveredTestWorker(t *testing.T) (*exec.Cmd, *Manager) {
	t.Helper()
	cmd := exec.Command("/bin/sleep", "30")
	cmd.Env = append(os.Environ(), "COMPANY_ID=company", "CONNECTION_ID=recovered")
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	go func() { _ = cmd.Wait() }()

	m := New(Config{WhatsAppBinaryPath: "/bin/sleep"})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	m.workers["recovered"] = &WorkerProcess{
		ID:           "recovered",
		CompanyID:    "company",
		ConnectionID: "recovered",
		Status:       types.StatusConnected,
		PID:          cmd.Process.Pid,
	}
	// Linux may briefly expose the new PID before /proc/<pid>/environ reflects
	// the exec'd child's identity. Recovered production workers are long-lived;
	// wait for that equivalent precondition instead of racing the fixture.
	require.Eventually(t, func() bool {
		matches, err := m.isExpectedWorkerProcess(cmd.Process.Pid, "company", "recovered")
		return err == nil && matches
	}, time.Second, 10*time.Millisecond)
	return cmd, m
}

func TestStopWorker_RecoveredProcess(t *testing.T) {
	cmd, m := startRecoveredTestWorker(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	require.NoError(t, m.StopWorker(ctx, "company", "recovered", "test disconnect"))
	_, exists := m.GetWorkerStatus("recovered")
	assert.False(t, exists)
	assert.Error(t, cmd.Process.Signal(os.Signal(syscall.Signal(0))))
}

func TestStopWorker_RefusesReusedPID(t *testing.T) {
	m := New(Config{WhatsAppBinaryPath: "/definitely/not-the-test-process"})
	m.workers["recovered"] = &WorkerProcess{
		ID:           "recovered",
		CompanyID:    "company",
		ConnectionID: "recovered",
		PID:          os.Getpid(),
	}

	err := m.StopWorker(context.Background(), "company", "recovered", "test")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "refusing to signal reused PID")
	_, exists := m.GetWorkerStatus("recovered")
	assert.True(t, exists)
}

func TestStopWorkerRefusesDifferentConnectionUsingSameBinary(t *testing.T) {
	cmd := exec.Command("/bin/sleep", "30")
	cmd.Env = append(os.Environ(), "COMPANY_ID=other-company", "CONNECTION_ID=other-connection")
	require.NoError(t, cmd.Start())
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	})

	m := New(Config{WhatsAppBinaryPath: "/bin/sleep"})
	m.workers["recovered"] = &WorkerProcess{
		ID: "recovered", CompanyID: "company", ConnectionID: "recovered",
		PID: cmd.Process.Pid, Status: types.StatusConnected,
	}

	err := m.StopWorker(context.Background(), "company", "recovered", "test")
	require.ErrorContains(t, err, "refusing to signal reused PID")
	assert.NoError(t, cmd.Process.Signal(syscall.Signal(0)), "unrelated worker must remain alive")
}

func TestStop_ShutsDownRecoveredProcess(t *testing.T) {
	cmd, m := startRecoveredTestWorker(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	require.NoError(t, m.Stop(ctx))
	assert.Zero(t, m.WorkerCount())
	assert.Error(t, cmd.Process.Signal(os.Signal(syscall.Signal(0))))
}

// BenchmarkListWorkers benchmarks the ListWorkers operation.
func BenchmarkListWorkers(b *testing.B) {
	m := New(Config{})

	// Add 100 workers
	for i := 0; i < 100; i++ {
		id := string(rune(i))
		m.workers[id] = &WorkerProcess{
			ID:        id,
			CompanyID: "company",
			Status:    types.StatusConnected,
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.ListWorkers()
	}
}

// BenchmarkGetWorkerStatus benchmarks the GetWorkerStatus operation.
func BenchmarkGetWorkerStatus(b *testing.B) {
	m := New(Config{})

	m.workers["test-id"] = &WorkerProcess{
		ID:        "test-id",
		CompanyID: "company",
		Status:    types.StatusConnected,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = m.GetWorkerStatus("test-id")
	}
}

// BenchmarkUpdateWorkerStatus benchmarks the UpdateWorkerStatus operation.
func BenchmarkUpdateWorkerStatus(b *testing.B) {
	m := New(Config{})

	m.workers["test-id"] = &WorkerProcess{
		ID:           "test-id",
		Status:       types.StatusConnecting,
		LastActivity: time.Now(),
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.UpdateWorkerStatus("test-id", types.StatusConnected)
	}
}

// BenchmarkWorkerCount benchmarks the WorkerCount operation.
func BenchmarkWorkerCount(b *testing.B) {
	m := New(Config{})

	for i := 0; i < 100; i++ {
		id := string(rune(i))
		m.workers[id] = &WorkerProcess{ID: id}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.WorkerCount()
	}
}

// Integration-style tests that require more setup
// These test the interaction between components

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
func TestApplyRestartJitter_StaysWithinWindow(t *testing.T) {
	const backoff = 5 * time.Second
	spread := time.Duration(float64(backoff) * restartJitterFraction)

	for i := 0; i < 1000; i++ {
		got := applyRestartJitter(backoff)
		assert.Greater(t, got, backoff-spread, "jittered backoff below window")
		assert.LessOrEqual(t, got, backoff, "jittered backoff exceeded the nominal backoff")
	}
}

// jitterSamples is large enough that the distribution assertions below fail
// only on a genuine regression. With 10+ buckets and 2000 samples the chance of
// any bucket coming up empty, or of one holding twice its share, is below
// 1e-40; math/rand/v2's global source cannot be seeded, so the tests rely on
// that margin instead of a fixed seed.
const jitterSamples = 2000

// jitterHistogram counts sampled delays into fixed-width buckets measured down
// from the nominal backoff: bucket 0 is the slice of the window closest to
// backoff. Buckets, rather than distinct nanosecond values, are what matters
// operationally — two workers 3ns apart still reconnect together.
func jitterHistogram(t *testing.T, backoff, bucket time.Duration) []int {
	t.Helper()

	spread := time.Duration(float64(backoff) * restartJitterFraction)
	require.Zero(t, spread%bucket, "bucket width must divide the jitter spread evenly")

	buckets := make([]int, spread/bucket)
	for i := 0; i < jitterSamples; i++ {
		got := applyRestartJitter(backoff)
		require.Greater(t, got, backoff-spread, "jittered backoff below window")
		require.LessOrEqual(t, got, backoff, "jittered backoff exceeded the nominal backoff")
		buckets[(backoff-got)/bucket]++
	}
	return buckets
}

// assertSpread fails if any bucket is empty (the window is not being used) or
// if one bucket holds more than twice its fair share (delays are clumping).
func assertSpread(t *testing.T, buckets []int, bucket time.Duration) {
	t.Helper()

	fairShare := jitterSamples / len(buckets)
	for i, count := range buckets {
		assert.NotZero(t, count,
			"no restart landed in the %v bucket at offset %v; the jitter window is not fully used",
			bucket, time.Duration(i)*bucket)
		assert.Less(t, count, 2*fairShare,
			"%d of %d restarts landed in a single %v bucket at offset %v; they would reconnect together",
			count, jitterSamples, bucket, time.Duration(i)*bucket)
	}
}

// TestApplyRestartJitter_SpreadsAcrossBackoffWindow is the point of the jitter:
// workers recovered together share a RestartCount and would otherwise compute
// an identical delay, reconnecting to WhatsApp in one synchronized burst. At
// the 5s first-attempt backoff the delays must fill the whole 2.5s window in
// 250ms slices, not merely differ by nanoseconds.
func TestApplyRestartJitter_SpreadsAcrossBackoffWindow(t *testing.T) {
	const (
		backoff = 5 * time.Second
		bucket  = 250 * time.Millisecond
	)

	assertSpread(t, jitterHistogram(t, backoff, bucket), bucket)
}

// TestApplyRestartJitter_CeilingSpreadsAcrossMinute covers the case that
// matters most: after repeated failures every worker sits at maxRestartBackoff,
// so the ceiling is where synchronization would be worst. The delays must
// spread over the full minute in 5s slices. This also guards the regression a
// symmetric jitter window would cause, where clamping out-of-range values back
// to the ceiling would pile workers into the bucket at offset 0.
func TestApplyRestartJitter_CeilingSpreadsAcrossMinute(t *testing.T) {
	const bucket = 5 * time.Second

	assertSpread(t, jitterHistogram(t, maxRestartBackoff, bucket), bucket)
}

// TestApplyRestartJitter_DegenerateBackoffs guards the cases where the spread
// rounds to nothing: the delay must be returned unchanged rather than panicking
// in rand.Int64N or going negative.
func TestApplyRestartJitter_DegenerateBackoffs(t *testing.T) {
	for _, backoff := range []time.Duration{0, time.Nanosecond, time.Duration(-1)} {
		t.Run(backoff.String(), func(t *testing.T) {
			assert.Equal(t, backoff, applyRestartJitter(backoff))
		})
	}
}
