package manager

import (
	"context"
	"os"
	"os/exec"
	"sort"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// startRecoveredTestWorkers spawns n real child processes and registers them as
// recovered workers, mirroring the state a replacement orchestrator inherits.
func startRecoveredTestWorkers(t *testing.T, n int) ([]*exec.Cmd, *Manager) {
	t.Helper()

	m := New(Config{WhatsAppBinaryPath: "/bin/sleep"})
	m.ctx, m.cancel = context.WithCancel(context.Background())

	cmds := make([]*exec.Cmd, 0, n)
	for i := 0; i < n; i++ {
		cmd := exec.Command("/bin/sleep", "30")
		require.NoError(t, cmd.Start())
		go func() { _ = cmd.Wait() }()
		t.Cleanup(func() { _ = cmd.Process.Kill() })

		id := "connection-" + string(rune('a'+i))
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

func alive(cmd *exec.Cmd) bool {
	return cmd.Process.Signal(os.Signal(syscall.Signal(0))) == nil
}

// The regression this guards: marking each worker immediately before stopping it
// meant a SIGKILL partway through shutdown left the later workers' durable
// records reading "connected", which the next orchestrator reports as a crash.
func TestStop_MarksEveryWorkerBeforeStoppingAny(t *testing.T) {
	cmds, m := startRecoveredTestWorkers(t, 3)

	var (
		mu          sync.Mutex
		calls       [][]string
		aliveAtCall []int
	)
	m.markWorkersRecovering = func(_ context.Context, ids []string) error {
		mu.Lock()
		defer mu.Unlock()
		recorded := append([]string(nil), ids...)
		sort.Strings(recorded)
		calls = append(calls, recorded)

		running := 0
		for _, cmd := range cmds {
			if alive(cmd) {
				running++
			}
		}
		aliveAtCall = append(aliveAtCall, running)
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.NoError(t, m.Stop(ctx))

	require.Len(t, calls, 1, "recovery intent should be recorded in one batch, not per worker")
	assert.Equal(t, []string{"connection-a", "connection-b", "connection-c"}, calls[0])
	assert.Equal(t, []int{len(cmds)}, aliveAtCall,
		"every worker must still be running when its record is marked")

	for i, cmd := range cmds {
		assert.False(t, alive(cmd), "worker %d should have been stopped", i)
	}
	assert.Zero(t, m.WorkerCount())
}

// Shutdown must still stop the workers when the database is unreachable.
func TestStop_ContinuesWhenMarkingFails(t *testing.T) {
	cmds, m := startRecoveredTestWorkers(t, 2)

	called := false
	m.markWorkersRecovering = func(context.Context, []string) error {
		called = true
		return assert.AnError
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.NoError(t, m.Stop(ctx))

	assert.True(t, called)
	for i, cmd := range cmds {
		assert.False(t, alive(cmd), "worker %d should have been stopped anyway", i)
	}
	assert.Zero(t, m.WorkerCount())
}

// A manager without persistence has nothing to mark and must still shut down.
func TestStop_WithoutRegistryHook(t *testing.T) {
	cmds, m := startRecoveredTestWorkers(t, 1)
	require.Nil(t, m.markWorkersRecovering)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.NoError(t, m.Stop(ctx))

	assert.False(t, alive(cmds[0]))
}
