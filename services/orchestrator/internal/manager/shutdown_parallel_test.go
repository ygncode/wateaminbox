package manager

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// perWorkerStopCost is what one stop costs when the worker ignores SIGTERM: the
// 5s grace in stopWorkerInternal plus up to 2s waiting on the SIGKILL.
const perWorkerStopCost = 7 * time.Second

// startStubbornTestWorkers spawns n children that ignore SIGTERM, so every stop
// has to run the full grace period and escalate. That is the case where serial
// stopping overran the shutdown budget.
//
// The children are started without Setpgid, so their process group is the test
// runner's and stopWorkerInternal signals the process directly rather than the
// group. Signalling the group here would kill the test binary itself.
func startStubbornTestWorkers(t *testing.T, n int) ([]*exec.Cmd, *Manager) {
	t.Helper()

	m := New(Config{WhatsAppBinaryPath: "/bin/sh"})
	m.ctx, m.cancel = context.WithCancel(context.Background())

	cmds := make([]*exec.Cmd, 0, n)
	for i := 0; i < n; i++ {
		id := "stubborn-" + string(rune('a'+i))
		cmd := exec.Command("/bin/sh", "-c", `trap "" TERM; sleep 60`)
		cmd.Env = append(os.Environ(), "COMPANY_ID=company", "CONNECTION_ID="+id)
		require.NoError(t, cmd.Start())
		go func() { _ = cmd.Wait() }()
		t.Cleanup(func() { _ = cmd.Process.Kill() })

		m.workers[id] = &WorkerProcess{
			ID:           id,
			CompanyID:    "company",
			ConnectionID: id,
			Status:       types.StatusConnected,
			PID:          cmd.Process.Pid,
		}
		cmds = append(cmds, cmd)
	}
	return cmds, m
}

// Six workers that each need the full grace period cost ~42s serially, which
// neither the 30s shutdown budget nor the 40s Compose stop_grace_period covers.
// Run concurrently they cost about one worker's worth.
func TestStop_StopsWorkersConcurrently(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}

	const workers = 6
	cmds, m := startStubbornTestWorkers(t, workers)

	ctx, cancel := context.WithTimeout(context.Background(), shutdownBudget)
	defer cancel()

	started := time.Now()
	require.NoError(t, m.Stop(ctx))
	elapsed := time.Since(started)

	serial := workers * perWorkerStopCost
	assert.Less(t, elapsed, serial/2,
		"stopping %d workers took %s; serial stopping would cost about %s", workers, elapsed, serial)
	assert.Less(t, elapsed, shutdownBudget,
		"shutdown must finish inside the budget main.go allows itself")

	for i, cmd := range cmds {
		assert.False(t, alive(cmd), "worker %d should have been stopped", i)
	}
	assert.Zero(t, m.WorkerCount())
}

// Concurrent stops must report every failure, not just the last one, and a
// failing worker must not prevent the others from being stopped.
func TestStop_CollectsEveryWorkerFailure(t *testing.T) {
	cmds, m := startRecoveredTestWorkers(t, 2)

	// A worker with no usable PID fails inside stopWorkerInternal before it
	// signals anything, which is the per-worker failure path.
	for _, id := range []string{"broken-one", "broken-two"} {
		m.workers[id] = &WorkerProcess{
			ID:           id,
			CompanyID:    "company",
			ConnectionID: id,
			Status:       types.StatusConnected,
			PID:          0,
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := m.Stop(ctx)
	require.Error(t, err, "failures must be surfaced, not only logged")
	assert.Contains(t, err.Error(), "broken-one")
	assert.Contains(t, err.Error(), "broken-two")

	for i, cmd := range cmds {
		assert.False(t, alive(cmd), "healthy worker %d should still have been stopped", i)
	}
	// The healthy workers are gone; the two that failed stay behind for the
	// operator rather than being silently forgotten.
	assert.Equal(t, 2, m.WorkerCount())
}

// A shutdown context that expires must not wedge the stops. Every goroutine
// should observe the cancellation and unwind rather than sit on its grace timer.
func TestStop_UnwindsWhenContextExpires(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}

	cmds, m := startStubbornTestWorkers(t, 4)

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	started := time.Now()
	_ = m.Stop(ctx)
	elapsed := time.Since(started)

	assert.Less(t, elapsed, perWorkerStopCost,
		"an expired context should unwind the stops, not wait out every grace period")
	for _, cmd := range cmds {
		_ = cmd.Process.Kill()
	}
}
