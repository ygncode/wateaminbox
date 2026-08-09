package manager

import (
	"context"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// startTrackedTestWorker spawns a real child process and tracks it as a worker,
// so the health check exercises its actual liveness path rather than a stub.
func startTrackedTestWorker(t *testing.T, connectionID string) (*Manager, *exec.Cmd) {
	t.Helper()

	cmd := exec.Command("/bin/sleep", "30")
	require.NoError(t, cmd.Start())
	go func() { _ = cmd.Wait() }()
	t.Cleanup(func() { _ = cmd.Process.Kill() })

	m := New(Config{HealthCheckInterval: 10 * time.Millisecond})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	t.Cleanup(m.cancel)

	m.workers[connectionID] = &WorkerProcess{
		ID:           connectionID,
		CompanyID:    "company",
		ConnectionID: connectionID,
		Status:       types.StatusConnected,
		PID:          cmd.Process.Pid,
		LastActivity: time.Now(),
	}
	return m, cmd
}

func processAlive(cmd *exec.Cmd) bool {
	return cmd.Process.Signal(os.Signal(syscall.Signal(0))) == nil
}

// The regression this guards: UpdateHeartbeat existed on the registry but had
// no caller anywhere, so last_heartbeat was written once by RegisterWorker and
// never again. A worker connected and serving traffic for fourteen hours still
// reported a fourteen-hour-old heartbeat, which is indistinguishable from an
// abandoned row, so anything alerting on heartbeat age fired permanently and
// told an operator nothing.
func TestHealthCheck_RecordsHeartbeatWhileProcessIsAlive(t *testing.T) {
	const id = "connection-a"
	m, _ := startTrackedTestWorker(t, id)

	var (
		mu       sync.Mutex
		recorded []string
	)
	m.recordWorkerHeartbeat = func(_ context.Context, connectionID string) error {
		mu.Lock()
		defer mu.Unlock()
		recorded = append(recorded, connectionID)
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.wg.Add(1)
	go m.healthCheckWorker(ctx, id)

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(recorded) >= 2
	}, 2*time.Second, 10*time.Millisecond, "health check should record a heartbeat on every tick")

	cancel()
	m.wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	for _, connectionID := range recorded {
		assert.Equal(t, id, connectionID, "heartbeat recorded against the wrong worker")
	}
}

// A bookkeeping write must never take down a worker that is running fine and
// holding a live WhatsApp session.
func TestHealthCheck_SurvivesHeartbeatWriteFailure(t *testing.T) {
	const id = "connection-a"
	m, cmd := startTrackedTestWorker(t, id)

	var (
		mu       sync.Mutex
		attempts int
	)
	m.recordWorkerHeartbeat = func(_ context.Context, _ string) error {
		mu.Lock()
		defer mu.Unlock()
		attempts++
		return assert.AnError
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.wg.Add(1)
	go m.healthCheckWorker(ctx, id)

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return attempts >= 3
	}, 2*time.Second, 10*time.Millisecond, "health check should keep running after a failed heartbeat write")

	cancel()
	m.wg.Wait()

	_, exists := m.GetWorkerStatus(id)
	assert.True(t, exists, "a failed bookkeeping write must not drop the worker")
	assert.True(t, processAlive(cmd), "a failed bookkeeping write must not stop the process")
}

// Nothing should be written for a worker the manager is no longer tracking.
func TestHealthCheck_StopsWithoutHeartbeatWhenWorkerRemoved(t *testing.T) {
	m := New(Config{HealthCheckInterval: 10 * time.Millisecond})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	var (
		mu    sync.Mutex
		calls int
	)
	m.recordWorkerHeartbeat = func(_ context.Context, _ string) error {
		mu.Lock()
		defer mu.Unlock()
		calls++
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	m.wg.Add(1)
	go func() {
		m.healthCheckWorker(ctx, "connection-missing")
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("health check did not exit for a worker that does not exist")
	}

	mu.Lock()
	defer mu.Unlock()
	assert.Zero(t, calls, "no heartbeat should be written for a worker that is not tracked")
}

// A deployment without persistence configured must still run its health checks.
func TestHealthCheck_RunsWithoutARegistry(t *testing.T) {
	const id = "connection-a"
	m, cmd := startTrackedTestWorker(t, id)
	require.Nil(t, m.recordWorkerHeartbeat, "no registry wired, so no heartbeat recorder")

	ctx, cancel := context.WithCancel(context.Background())
	m.wg.Add(1)
	go m.healthCheckWorker(ctx, id)

	time.Sleep(100 * time.Millisecond)
	cancel()
	m.wg.Wait()

	_, exists := m.GetWorkerStatus(id)
	assert.True(t, exists, "worker should be untouched when there is nothing to record to")
	assert.True(t, processAlive(cmd), "process should be untouched when there is nothing to record to")
}
