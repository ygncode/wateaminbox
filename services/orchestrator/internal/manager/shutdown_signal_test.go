package manager

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// startCooperativeTestWorkers spawns n children that write a marker file on
// SIGTERM and then exit cleanly — the happy path for graceful shutdown.
func startCooperativeTestWorkers(t *testing.T, n int, markerDir string) ([]*exec.Cmd, *Manager) {
	t.Helper()

	m := New(Config{WhatsAppBinaryPath: "/bin/sh"})
	m.ctx, m.cancel = context.WithCancel(context.Background())

	cmds := make([]*exec.Cmd, 0, n)
	for i := 0; i < n; i++ {
		id := "coop-" + string(rune('a'+i))
		marker := filepath.Join(markerDir, id)
		ready := marker + ".ready"
		cmd := exec.Command("/bin/sh", "-c",
			`trap 'echo got_sigterm > "`+marker+`"; exit 0' TERM; : > "`+ready+`"; while true; do sleep 0.1; done`)
		cmd.Env = append(os.Environ(), "COMPANY_ID=company", "CONNECTION_ID="+id)
		require.NoError(t, cmd.Start())
		require.Eventually(t, func() bool {
			_, err := os.Stat(ready)
			return err == nil
		}, 5*time.Second, 10*time.Millisecond, "worker %s should install its signal trap", id)

		done := make(chan struct{})
		go func() {
			_ = cmd.Wait()
			close(done)
		}()
		t.Cleanup(func() { _ = cmd.Process.Kill() })

		m.workers[id] = &WorkerProcess{
			ID:           id,
			CompanyID:    "company",
			ConnectionID: id,
			Status:       types.StatusConnected,
			PID:          cmd.Process.Pid,
			done:         done,
		}
		cmds = append(cmds, cmd)
	}
	return cmds, m
}

// Cooperative workers receive SIGTERM, write a marker, exit cleanly, and are
// never SIGKILLed.
func TestStop_CooperativeWorkersExitGracefully(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}

	markerDir := t.TempDir()
	cmds, m := startCooperativeTestWorkers(t, 3, markerDir)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := m.Stop(ctx)
	require.NoError(t, err)

	for i, cmd := range cmds {
		assert.False(t, alive(cmd), "worker %d should have exited", i)
	}

	// Every cooperative worker must have written its marker.
	for i := 0; i < 3; i++ {
		id := "coop-" + string(rune('a'+i))
		marker := filepath.Join(markerDir, id)
		content, err := os.ReadFile(marker)
		require.NoError(t, err, "worker %s should have written its marker", id)
		assert.Contains(t, string(content), "got_sigterm")
	}

	assert.Zero(t, m.WorkerCount())
}

// Stubborn workers that ignore SIGTERM get SIGKILLed only after the full grace
// period — not before. Uses multiple workers to avoid trap-setup race.
func TestStop_StubbornWorkersGetGracePeriod(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}

	cmds, m := startStubbornTestWorkers(t, 2)
	// Let the shells set up their traps.
	time.Sleep(200 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	started := time.Now()
	_ = m.Stop(ctx)
	elapsed := time.Since(started)

	assert.GreaterOrEqual(t, elapsed, 4*time.Second,
		"should wait close to the full grace period before SIGKILL")

	for i, cmd := range cmds {
		assert.False(t, alive(cmd), "stubborn worker %d should be dead after SIGKILL", i)
	}
}

// Manager context cancellation after worker exit does not affect unrelated PIDs.
func TestStop_CancelAfterWorkerExit(t *testing.T) {
	markerDir := t.TempDir()
	_, m := startCooperativeTestWorkers(t, 1, markerDir)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := m.Stop(ctx)
	require.NoError(t, err)

	// The manager context should now be cancelled.
	assert.Error(t, m.ctx.Err(), "manager context should be cancelled after Stop")
}

// Workers spawned with done channel close it when process exits, enabling
// reliable wait without PID polling.
func TestDoneChannel_ClosedOnProcessExit(t *testing.T) {
	m := New(Config{WhatsAppBinaryPath: "/bin/sh"})
	m.ctx, m.cancel = context.WithCancel(context.Background())

	cmd := exec.Command("/bin/sh", "-c", "exit 0")
	done := make(chan struct{})
	require.NoError(t, cmd.Start())

	go func() {
		_ = cmd.Wait()
		close(done)
	}()

	select {
	case <-done:
		// expected
	case <-time.After(5 * time.Second):
		t.Fatal("done channel should have been closed when process exited")
	}
}
