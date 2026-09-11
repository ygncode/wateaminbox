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
