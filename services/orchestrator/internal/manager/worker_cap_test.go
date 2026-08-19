package manager

import (
	"context"
	"fmt"
	"os/exec"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

func TestSpawnWorker_RejectsWhenAtCap(t *testing.T) {
	m := New(Config{WhatsAppBinaryPath: "/bin/sh", MaxWorkers: 2})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	// Fill to capacity with synthetic entries (no real processes).
	m.workers["conn-a"] = &WorkerProcess{
		ID: "conn-a", CompanyID: "co", ConnectionID: "conn-a",
		Status: types.StatusConnected, PID: 1,
	}
	m.workers["conn-b"] = &WorkerProcess{
		ID: "conn-b", CompanyID: "co", ConnectionID: "conn-b",
		Status: types.StatusConnected, PID: 2,
	}

	err := m.SpawnWorker(context.Background(), "co", "conn-c", "", "postgres://x")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "worker limit reached (2/2)")
	assert.Equal(t, 2, m.WorkerCount(), "count unchanged after rejection")
}

func TestSpawnWorker_ReplacesStoppedWorkerSameID(t *testing.T) {
	m := New(Config{WhatsAppBinaryPath: "/bin/sh", MaxWorkers: 1})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	// One slot occupied by a stopped worker with the SAME connectionID.
	// spawnWorker cleans up stopped/error entries for the same ID before
	// the cap check, so this should pass the admission gate.
	m.workers["conn-a"] = &WorkerProcess{
		ID: "conn-a", CompanyID: "co", ConnectionID: "conn-a",
		Status: types.StatusStopped, PID: 1,
	}

	err := m.SpawnWorker(context.Background(), "co", "conn-a", "", "postgres://x")
	// Expect a start error (binary doesn't exist), NOT a cap error.
	if err != nil {
		assert.NotContains(t, err.Error(), "worker limit reached")
	}
}

func TestSpawnWorker_ZeroMaxWorkersIsUnlimited(t *testing.T) {
	m := New(Config{WhatsAppBinaryPath: "/bin/sh", MaxWorkers: 0})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	for i := 0; i < 50; i++ {
		id := fmt.Sprintf("conn-%d", i)
		m.workers[id] = &WorkerProcess{
			ID: id, CompanyID: "co", ConnectionID: id,
			Status: types.StatusConnected, PID: i + 100,
		}
	}

	// Should NOT hit a cap error — only a start error.
	err := m.SpawnWorker(context.Background(), "co", "conn-new", "", "postgres://x")
	if err != nil {
		assert.NotContains(t, err.Error(), "worker limit reached")
	}
}

func TestSpawnWorker_ConcurrentAdmissionRespectsLimit(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}

	m := New(Config{WhatsAppBinaryPath: "/bin/sh", MaxWorkers: 3})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	// Use real short-lived processes so cmd.Start() succeeds.
	var wg sync.WaitGroup
	var mu sync.Mutex
	var admitted, rejected int

	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			id := fmt.Sprintf("concurrent-%d", idx)
			err := m.SpawnWorker(context.Background(), "co", id, "", "postgres://x")
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				admitted++
			} else {
				rejected++
			}
		}(i)
	}
	wg.Wait()

	// Clean up any spawned processes.
	m.mu.Lock()
	for _, w := range m.workers {
		if w.cmd != nil && w.cmd.Process != nil {
			_ = w.cmd.Process.Kill()
		}
	}
	m.mu.Unlock()

	assert.LessOrEqual(t, admitted, 3, "should never exceed MaxWorkers")
	assert.GreaterOrEqual(t, rejected, 3, "excess spawns should be rejected")
}

func TestSpawnWorker_ExistingRunningWorkerDoesNotCountTwice(t *testing.T) {
	m := New(Config{WhatsAppBinaryPath: "/bin/sh", MaxWorkers: 2})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	// Pre-populate one running worker.
	cmd := exec.Command("/bin/sh", "-c", "sleep 60")
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill() })

	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()

	m.workers["conn-existing"] = &WorkerProcess{
		ID: "conn-existing", CompanyID: "co", ConnectionID: "conn-existing",
		Status: types.StatusConnected, PID: cmd.Process.Pid, cmd: cmd, done: done,
	}

	// Re-spawning the same connection should not error — it republishes status.
	err := m.SpawnWorker(context.Background(), "co", "conn-existing", "", "postgres://x")
	assert.NoError(t, err, "re-spawning existing running worker should not error")
	assert.Equal(t, 1, m.WorkerCount())
}
