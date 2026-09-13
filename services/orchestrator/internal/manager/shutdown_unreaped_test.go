package manager

import (
	"context"
	"os"
	"os/exec"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// startUnreapedTestWorker registers a recovered worker whose process has
// already exited and has deliberately not been reaped, so it sits as a zombie.
//
// This is the state that made TestStop_CollectsEveryWorkerFailure flake on CI:
// a worker process can exit at any moment, and until its parent collects it the
// PID still answers signal 0 while /proc/<pid>/exe and /proc/<pid>/environ are
// gone. Reproducing it by withholding the reap makes the window permanent
// instead of a few microseconds wide.
func startUnreapedTestWorker(t *testing.T, id string) (int, *Manager) {
	t.Helper()

	m := New(Config{WhatsAppBinaryPath: "/bin/sleep"})
	m.ctx, m.cancel = context.WithCancel(context.Background())

	cmd := exec.Command("/bin/sleep", "30")
	cmd.Env = append(os.Environ(), "COMPANY_ID=company", "CONNECTION_ID="+id)
	require.NoError(t, cmd.Start())
	pid := cmd.Process.Pid
	require.NoError(t, cmd.Process.Signal(syscall.SIGKILL))
	// No cmd.Wait(): the child stays a zombie for the duration of the test.
	t.Cleanup(func() { _, _ = cmd.Process.Wait() })

	require.Eventually(t, func() bool { return processIsZombie(pid) },
		5*time.Second, 10*time.Millisecond, "child never became a zombie")

	m.workers[id] = &WorkerProcess{
		ID:           id,
		CompanyID:    "company",
		ConnectionID: id,
		Status:       types.StatusConnected,
		PID:          pid,
	}
	return pid, m
}

// A worker whose process exited without being reaped must stop cleanly. Before
// this was handled, the identity check read the missing executable as a reused
// PID and refused to signal, so the stop failed and the worker stayed in the
// map with its record left mid-flight.
func TestStop_TreatsUnreapedExitAsStopped(t *testing.T) {
	_, m := startUnreapedTestWorker(t, "connection-zombie")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	started := time.Now()
	require.NoError(t, m.Stop(ctx), "an already-exited worker is not a failure to stop")
	// Waiting for ESRCH on an unreaped corpse would spend the 5s grace and then
	// escalate; recognising the exit has to be immediate.
	assert.Less(t, time.Since(started), 3*time.Second,
		"stopping an exited worker must not wait out the grace period")
	assert.Zero(t, m.WorkerCount(), "the exited worker should have been removed")
}

// The identity check must still refuse a PID that is genuinely someone else's.
// The exemption above is for corpses only, and must not become a way to signal
// an arbitrary live process.
func TestStopWorker_StillRefusesGenuinelyReusedPID(t *testing.T) {
	m := New(Config{WhatsAppBinaryPath: "/bin/sleep"})
	m.ctx, m.cancel = context.WithCancel(context.Background())

	// A live process that is not a worker: right binary is irrelevant, the
	// environment does not carry this connection's identity.
	impostor := exec.Command("/bin/sleep", "30")
	impostor.Env = []string{"PATH=/usr/bin:/bin"}
	require.NoError(t, impostor.Start())
	go func() { _ = impostor.Wait() }()
	t.Cleanup(func() { _ = impostor.Process.Kill() })

	m.workers["connection-x"] = &WorkerProcess{
		ID:           "connection-x",
		CompanyID:    "company",
		ConnectionID: "connection-x",
		Status:       types.StatusConnected,
		PID:          impostor.Process.Pid,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := m.stopWorkerInternal(ctx, "company", "connection-x", "test", syscall.SIGTERM, true)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "refusing to signal reused PID")
	alive, aliveErr := processIsAlive(impostor.Process.Pid)
	require.NoError(t, aliveErr)
	assert.True(t, alive, "the impostor must not have been signalled")
}
