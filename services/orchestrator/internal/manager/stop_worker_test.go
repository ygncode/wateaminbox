package manager

import (
	"context"
	"os/exec"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

func TestStopWorker_DoesNotTriggerCrashHandling(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}

	m := New(Config{
		WhatsAppBinaryPath:    "/bin/sh",
		AutoRestartEnabled:    true,
		AutoRestartMaxRetries: 5,
		AutoRestartBackoff:    100 * time.Millisecond,
	})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	cmd := exec.Command("/bin/sh", "-c",
		`trap 'exit 0' TERM; while true; do sleep 0.1; done`)
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill() })

	done := make(chan struct{})
	worker := &WorkerProcess{
		ID:           "stop-test",
		CompanyID:    "co",
		ConnectionID: "stop-test",
		Status:       types.StatusConnected,
		PID:          cmd.Process.Pid,
		cmd:          cmd,
		done:         done,
	}
	m.workers["stop-test"] = worker

	m.wg.Add(1)
	go m.monitorWorkerProcess("stop-test", cmd, worker)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := m.StopWorker(ctx, "co", "stop-test", "test stop")
	require.NoError(t, err)

	// Give any would-be crash handling or restart scheduling time to fire.
	time.Sleep(500 * time.Millisecond)

	assert.Zero(t, m.WorkerCount(), "worker should be removed after stop")
	_, exists := m.GetWorkerStatus("stop-test")
	assert.False(t, exists, "stopped worker should not reappear from a restart")
}

func TestStopWorker_MonitorSeesExpectedExit(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}

	m := New(Config{WhatsAppBinaryPath: "/bin/sh"})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	cmd := exec.Command("/bin/sh", "-c",
		`trap 'exit 0' TERM; while true; do sleep 0.1; done`)
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill() })

	done := make(chan struct{})
	worker := &WorkerProcess{
		ID:           "expected-exit",
		CompanyID:    "co",
		ConnectionID: "expected-exit",
		Status:       types.StatusConnected,
		PID:          cmd.Process.Pid,
		cmd:          cmd,
		done:         done,
	}
	m.workers["expected-exit"] = worker

	m.wg.Add(1)
	go m.monitorWorkerProcess("expected-exit", cmd, worker)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	require.NoError(t, m.StopWorker(ctx, "co", "expected-exit", "graceful"))

	m.mu.RLock()
	_, stillInMap := m.workers["expected-exit"]
	m.mu.RUnlock()
	assert.False(t, stillInMap, "stopWorkerInternal should have removed the worker")
}
