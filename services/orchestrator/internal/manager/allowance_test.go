package manager

import (
	"context"
	"errors"
	"os/exec"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// runningWorker starts a real short-lived process and registers it, so stopping
// it exercises the same path production uses.
func runningWorker(t *testing.T, m *Manager, companyID, connectionID string) {
	t.Helper()

	cmd := exec.Command("/bin/sh", "-c", `trap 'exit 0' TERM; while true; do sleep 0.1; done`)
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill() })

	done := make(chan struct{})
	worker := &WorkerProcess{
		ID:           connectionID,
		CompanyID:    companyID,
		ConnectionID: connectionID,
		Status:       types.StatusConnected,
		PID:          cmd.Process.Pid,
		cmd:          cmd,
		done:         done,
	}
	m.workers[connectionID] = worker

	m.wg.Add(1)
	go m.monitorWorkerProcess(connectionID, cmd, worker)
}

func newAllowanceManager(t *testing.T) *Manager {
	t.Helper()
	m := New(Config{WhatsAppBinaryPath: "/bin/sh"})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	t.Cleanup(m.cancel)
	return m
}

func TestEnforceConnectionAllowance_StopsWorkersWithoutAllowance(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}

	m := newAllowanceManager(t)
	runningWorker(t, m, "company-suspended", "conn-suspended")
	runningWorker(t, m, "company-paying", "conn-paying")

	var asked []string
	m.checkConnectionAllowances = func(_ context.Context, companyIDs []string) ([]string, error) {
		asked = append(asked, companyIDs...)
		return []string{"company-suspended"}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	m.enforceConnectionAllowance(ctx)

	assert.ElementsMatch(t, []string{"company-suspended", "company-paying"}, asked,
		"every distinct company with a running worker should be checked once")

	_, suspendedExists := m.GetWorkerStatus("conn-suspended")
	assert.False(t, suspendedExists, "a worker without allowance should be stopped")

	_, payingExists := m.GetWorkerStatus("conn-paying")
	assert.True(t, payingExists, "a worker with allowance must be left running")
}

func TestAllowanceStopWaitsForActiveRolloutWriter(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}
	m := newAllowanceManager(t)
	runningWorker(t, m, "company-suspended", "conn-suspended")
	m.checkConnectionAllowances = func(_ context.Context, _ []string) ([]string, error) {
		return []string{"company-suspended"}, nil
	}
	m.rolloutMu.Lock()
	done := make(chan struct{})
	go func() {
		m.enforceConnectionAllowance(context.Background())
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("allowance stop crossed the active rollout writer gate")
	case <-time.After(30 * time.Millisecond):
	}
	_, exists := m.GetWorkerStatus("conn-suspended")
	assert.True(t, exists)
	m.rolloutMu.Unlock()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("allowance stop did not proceed after rollout completed")
	}
	_, exists = m.GetWorkerStatus("conn-suspended")
	assert.False(t, exists)
}

func TestEnforceConnectionAllowance_FailsOpenOnError(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}

	m := newAllowanceManager(t)
	runningWorker(t, m, "company-paying", "conn-paying")

	m.checkConnectionAllowances = func(_ context.Context, _ []string) ([]string, error) {
		return nil, errors.New("database unavailable")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	m.enforceConnectionAllowance(ctx)

	time.Sleep(200 * time.Millisecond)
	_, exists := m.GetWorkerStatus("conn-paying")
	assert.True(t, exists, "an unreadable allowance must never stop a live session")
}

func TestEnforceConnectionAllowance_NoWorkersDoesNotQuery(t *testing.T) {
	m := newAllowanceManager(t)

	called := false
	m.checkConnectionAllowances = func(_ context.Context, _ []string) ([]string, error) {
		called = true
		return nil, nil
	}

	m.enforceConnectionAllowance(context.Background())
	assert.False(t, called, "an idle orchestrator should not query allowances")
}

func TestEnforceConnectionAllowance_WithoutRegistryIsNoop(t *testing.T) {
	m := newAllowanceManager(t)
	m.checkConnectionAllowances = nil
	m.enforceConnectionAllowance(context.Background())
}
