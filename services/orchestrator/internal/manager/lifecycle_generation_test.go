package manager

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"syscall"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

func TestNewLaunchIDIsUnique(t *testing.T) {
	first, err := newLaunchID()
	require.NoError(t, err)
	second, err := newLaunchID()
	require.NoError(t, err)
	assert.NotEmpty(t, first)
	assert.NotEqual(t, first, second)
}

func TestHandleWorkerFailureIgnoresStaleLaunch(t *testing.T) {
	m := New(Config{AutoRestartEnabled: true, AutoRestartBackoff: time.Nanosecond})
	m.ctx = context.Background()
	current := &WorkerProcess{
		ID: "connection", LaunchID: "new-launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusConnected,
	}
	m.workers[current.ConnectionID] = current

	m.handleWorkerFailure(current.ConnectionID, "old-launch", "late process exit")

	got, exists := m.GetWorkerStatus(current.ConnectionID)
	require.True(t, exists)
	assert.Equal(t, "new-launch", got.LaunchID)
	assert.Equal(t, types.StatusConnected, got.Status)
}

func TestPendingRestartRequiresSameRunningLaunch(t *testing.T) {
	m := New(Config{AutoRestartEnabled: true, AutoRestartBackoff: time.Nanosecond})
	m.ctx = context.Background()
	m.workers["connection"] = &WorkerProcess{
		ID: "connection", LaunchID: "new-launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusError,
	}
	stale := &WorkerProcess{
		ID: "connection", LaunchID: "old-launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusError,
	}

	m.scheduleRestart(stale, "old crash")

	got, exists := m.GetWorkerStatus("connection")
	require.True(t, exists)
	assert.Equal(t, "new-launch", got.LaunchID)
}

func TestPendingRestartCannotUndoExplicitStopIntent(t *testing.T) {
	m := New(Config{AutoRestartEnabled: true, AutoRestartBackoff: time.Nanosecond})
	m.ctx = context.Background()
	stopped := &WorkerProcess{
		ID: "connection", LaunchID: "launch", DesiredState: DesiredStateStopped,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusError,
	}
	m.workers[stopped.ConnectionID] = stopped

	m.scheduleRestart(stopped.Copy(), "old crash")

	got, exists := m.GetWorkerStatus(stopped.ConnectionID)
	require.True(t, exists)
	assert.Equal(t, DesiredStateStopped, got.DesiredState)
	assert.Equal(t, "launch", got.LaunchID)
}

func TestStaleUnlinkMonitorCannotDeleteNewLaunch(t *testing.T) {
	m := New(Config{})
	m.ctx = context.Background()

	cmd := exec.Command("true")
	require.NoError(t, cmd.Start())
	old := &WorkerProcess{
		ID: "connection", LaunchID: "old-launch", DesiredState: DesiredStateStopped,
		CompanyID: "company", ConnectionID: "connection", RemoveOnExit: true,
		cmd: cmd, done: make(chan struct{}),
	}
	m.workers[old.ConnectionID] = &WorkerProcess{
		ID: "connection", LaunchID: "new-launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusConnected,
	}

	m.wg.Add(1)
	go m.monitorWorkerProcess(old.ConnectionID, cmd, old)
	m.wg.Wait()

	got, exists := m.GetWorkerStatus(old.ConnectionID)
	require.True(t, exists)
	assert.Equal(t, "new-launch", got.LaunchID)
}

func TestLifecycleLockSerializesSameConnection(t *testing.T) {
	m := New(Config{})
	firstUnlock := m.lockLifecycle("connection")
	acquired := make(chan struct{})
	go func() {
		unlock := m.lockLifecycle("connection")
		close(acquired)
		unlock()
	}()

	select {
	case <-acquired:
		t.Fatal("second lifecycle operation acquired the same connection concurrently")
	case <-time.After(20 * time.Millisecond):
	}
	firstUnlock()
	select {
	case <-acquired:
	case <-time.After(time.Second):
		t.Fatal("serialized lifecycle operation did not proceed")
	}
}

func TestStopRejectsCrossCompanyConnection(t *testing.T) {
	m := New(Config{})
	m.ctx = context.Background()
	m.workers["connection"] = &WorkerProcess{
		ID: "connection", LaunchID: "launch", DesiredState: DesiredStateRunning,
		CompanyID: "owner-company", ConnectionID: "connection", Status: types.StatusConnected,
	}

	err := m.StopWorker(context.Background(), "other-company", "connection", "unauthorized")
	require.Error(t, err)
	got, exists := m.GetWorkerStatus("connection")
	require.True(t, exists)
	assert.Equal(t, "owner-company", got.CompanyID)
	assert.Equal(t, types.StatusConnected, got.Status)
}

func TestRecoveryRespectsStoppedDesiredState(t *testing.T) {
	assert.False(t, shouldRecoverWorker(&WorkerRecord{DesiredState: DesiredStateStopped}))
	assert.True(t, shouldRecoverWorker(&WorkerRecord{DesiredState: DesiredStateRunning}))
	assert.False(t, shouldRecoverWorker(&WorkerRecord{}), "unknown state must fail closed")
}

func TestUnlinkProcesslessFailedWorkerRunsOneShotPurge(t *testing.T) {
	tempDir := t.TempDir()
	marker := filepath.Join(tempDir, "unlink-mode")
	binary := filepath.Join(tempDir, "worker")
	require.NoError(t, os.WriteFile(binary, []byte("#!/bin/sh\nprintf '%s' \"$UNLINK_ON_START\" > \"$MARKER\"\n"), 0o755))

	m := New(Config{WhatsAppBinaryPath: binary})
	m.ctx = context.Background()
	m.workers["connection"] = &WorkerProcess{
		ID: "connection", LaunchID: "failed-launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", TenantSchema: "tenant_company",
		DatabaseURL: "postgres://unused", Status: types.StatusError, PID: 0,
	}
	t.Setenv("MARKER", marker)

	require.NoError(t, m.UnlinkWorker(
		context.Background(), "company", "connection", "tenant_company", "postgres://unused", "test unlink",
	))
	m.wg.Wait()
	contents, err := os.ReadFile(marker)
	require.NoError(t, err)
	assert.Equal(t, "true", string(contents))
	assert.Equal(t, 0, m.WorkerCount())
}

func TestFailedLiveWorkerUnlinkRetainsDurableIntent(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry SET desired_state = $1 WHERE connection_id = $2 AND company_id = $3 AND launch_id = $4")).
		WithArgs(DesiredStateUnlinking, "connection", "company", "launch").
		WillReturnResult(sqlmock.NewResult(0, 1))

	ready := filepath.Join(t.TempDir(), "ready")
	cmd := exec.Command("/bin/sh", "-c", `trap 'exit 1' USR1; : > "$READY"; while true; do sleep 0.1; done`)
	cmd.Env = append(os.Environ(), "READY="+ready)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	require.NoError(t, cmd.Start())
	require.Eventually(t, func() bool {
		_, err := os.Stat(ready)
		return err == nil
	}, time.Second, 10*time.Millisecond)
	worker := &WorkerProcess{
		ID: "connection", LaunchID: "launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusConnected,
		PID: cmd.Process.Pid, cmd: cmd, done: make(chan struct{}),
	}
	m := New(Config{})
	m.ctx = context.Background()
	m.registry = registry
	m.workers[worker.ConnectionID] = worker
	m.wg.Add(1)
	go m.monitorWorkerProcess(worker.ConnectionID, cmd, worker)

	err := m.UnlinkWorker(context.Background(), "company", "connection", "tenant_company", "postgres://unused", "test unlink")
	require.ErrorContains(t, err, "exited before completing purge")
	m.wg.Wait()
	retained, exists := m.GetWorkerStatus(worker.ConnectionID)
	require.True(t, exists)
	assert.Equal(t, DesiredStateUnlinking, retained.DesiredState)
	assert.Equal(t, types.StatusError, retained.Status)
	assert.Zero(t, retained.PID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFailedOneShotUnlinkRetainsDurableIntent(t *testing.T) {
	registry, mock := newMockRegistry(t)
	cmd := exec.Command("false")
	require.NoError(t, cmd.Start())
	worker := &WorkerProcess{
		ID: "connection", LaunchID: "unlink-launch", DesiredState: DesiredStateUnlinking,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusConnecting,
		PID: cmd.Process.Pid, RemoveOnExit: true, cmd: cmd, done: make(chan struct{}),
	}
	m := New(Config{})
	m.ctx = context.Background()
	m.registry = registry
	m.workers[worker.ConnectionID] = worker
	m.wg.Add(1)
	go m.monitorWorkerProcess(worker.ConnectionID, cmd, worker)
	m.wg.Wait()

	retained, exists := m.GetWorkerStatus(worker.ConnectionID)
	require.True(t, exists)
	assert.Equal(t, DesiredStateUnlinking, retained.DesiredState)
	assert.Equal(t, types.StatusError, retained.Status)
	assert.Zero(t, retained.PID)
	require.NoError(t, mock.ExpectationsWereMet(), "failed unlink must not delete durable intent")
}

func TestCompletedUnlinkRetainsLaunchWhenRegistryCleanupFails(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM worker_registry WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3")).
		WithArgs("connection", "company", "unlink-launch").
		WillReturnError(assert.AnError)

	cmd := exec.Command("true")
	require.NoError(t, cmd.Start())
	worker := &WorkerProcess{
		ID: "connection", LaunchID: "unlink-launch", DesiredState: DesiredStateUnlinking,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusConnecting,
		PID: cmd.Process.Pid, RemoveOnExit: true, cmd: cmd, done: make(chan struct{}),
	}
	m := New(Config{})
	m.ctx = context.Background()
	m.registry = registry
	m.workers[worker.ConnectionID] = worker
	m.wg.Add(1)
	go m.monitorWorkerProcess(worker.ConnectionID, cmd, worker)
	m.wg.Wait()

	retained, exists := m.GetWorkerStatus(worker.ConnectionID)
	require.True(t, exists)
	assert.Equal(t, DesiredStateUnlinking, retained.DesiredState)
	assert.Equal(t, types.StatusError, retained.Status)
	assert.Zero(t, retained.PID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecoveryClearsStoppedIntentAfterProcessIsGone(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state, artifact_version, artifact_sha256, worker_uid, worker_gid FROM worker_registry")).
		WillReturnRows(sqlmock.NewRows([]string{
			"connection_id", "company_id", "tenant_schema", "database_url", "pid", "status",
			"started_at", "last_heartbeat", "restart_count", "launch_id", "desired_state", "artifact_version", "artifact_sha256", "worker_uid", "worker_gid",
		}).AddRow(
			"connection", "company", "tenant_company", "", 999999, types.StatusStopping,
			time.Now(), time.Now(), 0, "launch", DesiredStateStopped, "embedded", "", 100000, 100000,
		))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_batches WHERE completed_at IS NULL")).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM worker_registry WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3")).
		WithArgs("connection", "company", "launch").
		WillReturnResult(sqlmock.NewResult(0, 1))

	m := New(Config{WhatsAppBinaryPath: filepath.Join(t.TempDir(), "worker")})
	m.ctx = context.Background()
	m.registry = registry
	require.NoError(t, m.recoverOrphanedWorkers(context.Background()))
	assert.Equal(t, 0, m.WorkerCount())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecoveryRetainsStoppedLaunchWhenCleanupFails(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state, artifact_version, artifact_sha256, worker_uid, worker_gid FROM worker_registry")).
		WillReturnRows(sqlmock.NewRows([]string{
			"connection_id", "company_id", "tenant_schema", "database_url", "pid", "status",
			"started_at", "last_heartbeat", "restart_count", "launch_id", "desired_state", "artifact_version", "artifact_sha256", "worker_uid", "worker_gid",
		}).AddRow(
			"connection", "company", "tenant_company", "", 999999, types.StatusStopping,
			time.Now(), time.Now(), 0, "launch", DesiredStateStopped, "embedded", "", 100001, 100001,
		))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_batches WHERE completed_at IS NULL")).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM worker_registry WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3")).
		WithArgs("connection", "company", "launch").
		WillReturnError(assert.AnError)

	m := New(Config{WhatsAppBinaryPath: filepath.Join(t.TempDir(), "worker")})
	m.ctx = context.Background()
	m.registry = registry
	require.NoError(t, m.recoverOrphanedWorkers(context.Background()))
	retained, exists := m.GetWorkerStatus("connection")
	require.True(t, exists)
	assert.Equal(t, "launch", retained.LaunchID)
	assert.Equal(t, DesiredStateStopped, retained.DesiredState)
	assert.Equal(t, types.StatusError, retained.Status)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRestartCarriesIncrementedAttemptIntoNewLaunch(t *testing.T) {
	tempDir := t.TempDir()
	binary := filepath.Join(tempDir, "worker")
	require.NoError(t, os.WriteFile(binary, []byte("#!/bin/sh\nsleep 30\n"), 0o755))

	m := New(Config{
		WhatsAppBinaryPath: binary,
		AutoRestartEnabled: true,
		AutoRestartBackoff: time.Nanosecond,
	})
	m.ctx = context.Background()
	failed := &WorkerProcess{
		ID: "connection", LaunchID: "failed-launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", TenantSchema: "tenant_company",
		DatabaseURL: "postgres://unused", Status: types.StatusError, RestartCount: 2,
	}
	m.workers[failed.ConnectionID] = failed

	m.scheduleRestart(failed.Copy(), "test failure")

	restarted, exists := m.GetWorkerStatus(failed.ConnectionID)
	require.True(t, exists)
	assert.NotEqual(t, failed.LaunchID, restarted.LaunchID)
	assert.Equal(t, 3, restarted.RestartCount)
	require.NoError(t, m.StopWorker(context.Background(), "company", "connection", "test cleanup"))
	m.wg.Wait()
}

func TestKillCommandReturnsPersistenceFailureForRedelivery(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry SET desired_state = $1 WHERE connection_id = $2 AND company_id = $3 AND launch_id = $4")).
		WithArgs(DesiredStateStopped, "connection", "company", "launch").
		WillReturnError(assert.AnError)

	m := New(Config{})
	m.ctx = context.Background()
	m.registry = registry
	m.workers["connection"] = &WorkerProcess{
		ID: "connection", LaunchID: "launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusConnected, PID: 999999,
	}
	h := &Handlers{manager: m}
	payload, err := json.Marshal(types.KillWorkerCommand{
		CompanyID: "company", ConnectionID: "connection", Reason: "test stop",
	})
	require.NoError(t, err)

	err = h.handleKillCommand(context.Background(), payload)
	require.ErrorContains(t, err, "persist stopped intent")
	retained, exists := m.GetWorkerStatus("connection")
	require.True(t, exists)
	assert.Equal(t, DesiredStateRunning, retained.DesiredState)
	assert.Equal(t, types.StatusConnected, retained.Status)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestKillCommandAcknowledgesAlreadyMissingWorker(t *testing.T) {
	m := New(Config{})
	m.ctx = context.Background()
	h := &Handlers{manager: m}
	payload, err := json.Marshal(types.KillWorkerCommand{
		CompanyID: "company", ConnectionID: "missing", Reason: "test stop",
	})
	require.NoError(t, err)
	assert.NoError(t, h.handleKillCommand(context.Background(), payload))
}

func TestReconnectCommandReplacesProcesslessFailedLaunch(t *testing.T) {
	tempDir := t.TempDir()
	binary := filepath.Join(tempDir, "worker")
	require.NoError(t, os.WriteFile(binary, []byte("#!/bin/sh\nsleep 30\n"), 0o755))

	m := New(Config{WhatsAppBinaryPath: binary, DatabaseURL: "postgres://unused"})
	m.ctx = context.Background()
	m.workers["connection"] = &WorkerProcess{
		ID: "connection", LaunchID: "failed-launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", TenantSchema: "tenant_company",
		DatabaseURL: "postgres://unused", Status: types.StatusError, PID: 0,
	}
	h := &Handlers{manager: m}
	payload, err := json.Marshal(types.SpawnWorkerCommand{
		CompanyID: "company", ConnectionID: "connection", TenantSchema: "tenant_company",
	})
	require.NoError(t, err)

	require.NoError(t, h.handleSpawnCommand(context.Background(), payload))
	restarted, exists := m.GetWorkerStatus("connection")
	require.True(t, exists)
	assert.NotEqual(t, "failed-launch", restarted.LaunchID)
	assert.Positive(t, restarted.PID)
	require.NoError(t, m.StopWorker(context.Background(), "company", "connection", "test cleanup"))
	m.wg.Wait()
}

func TestTransientClaimFailureRestoresPreviousFailedLaunch(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO worker_registry")).
		WithArgs(
			"connection", "company", "tenant_company", "", 0, types.StatusStarting,
			sqlmock.AnyArg(), 1, sqlmock.AnyArg(), DesiredStateRunning,
			defaultArtifactVersion, "", "old-launch",
		).
		WillReturnError(assert.AnError)

	m := New(Config{WhatsAppBinaryPath: filepath.Join(t.TempDir(), "unused-worker")})
	m.ctx = context.Background()
	m.registry = registry
	old := &WorkerProcess{
		ID: "connection", LaunchID: "old-launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", TenantSchema: "tenant_company",
		DatabaseURL: "postgres://unused", Status: types.StatusError,
	}
	m.workers[old.ConnectionID] = old

	err := m.spawnWorker(context.Background(), "company", "connection", "tenant_company", "postgres://unused", false, 1)
	require.ErrorContains(t, err, "reserve worker launch")
	restored, exists := m.GetWorkerStatus("connection")
	require.True(t, exists)
	assert.Equal(t, "old-launch", restored.LaunchID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTransientRestartSpawnFailuresConsumeBudgetAndTerminate(t *testing.T) {
	m := New(Config{
		WhatsAppBinaryPath:    filepath.Join(t.TempDir(), "missing-worker"),
		AutoRestartEnabled:    true,
		AutoRestartMaxRetries: 3,
		AutoRestartBackoff:    time.Nanosecond,
	})
	m.ctx = context.Background()
	failed := &WorkerProcess{
		ID: "connection", LaunchID: "failed-launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", TenantSchema: "tenant_company",
		DatabaseURL: "postgres://unused", Status: types.StatusError,
	}
	m.workers[failed.ConnectionID] = failed

	m.scheduleRestart(failed.Copy(), "test failure")
	require.Eventually(t, func() bool {
		_, exists := m.GetWorkerStatus(failed.ConnectionID)
		return !exists
	}, time.Second, time.Millisecond, "failed starts must continue until the retry budget is exhausted")
}

func TestTerminalCleanupFailureKeepsLaunchClaimable(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT restart_count FROM worker_registry WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3")).
		WithArgs("connection", "company", "launch").
		WillReturnRows(sqlmock.NewRows([]string{"restart_count"}).AddRow(0))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM worker_registry WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3")).
		WithArgs("connection", "company", "launch").
		WillReturnError(assert.AnError)

	m := New(Config{AutoRestartEnabled: false})
	m.ctx = context.Background()
	m.registry = registry
	worker := &WorkerProcess{
		ID: "connection", LaunchID: "launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusConnected,
	}
	m.workers[worker.ConnectionID] = worker

	m.handleWorkerFailure(worker.ConnectionID, worker.LaunchID, "test failure")
	retained, exists := m.GetWorkerStatus(worker.ConnectionID)
	require.True(t, exists)
	assert.Equal(t, "launch", retained.LaunchID)
	assert.Equal(t, types.StatusError, retained.Status)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFailureWithAutoRestartDisabledBecomesTerminal(t *testing.T) {
	m := New(Config{AutoRestartEnabled: false})
	m.ctx = context.Background()
	worker := &WorkerProcess{
		ID: "connection", LaunchID: "launch", DesiredState: DesiredStateRunning,
		CompanyID: "company", ConnectionID: "connection", Status: types.StatusConnected,
	}
	m.workers[worker.ConnectionID] = worker

	m.handleWorkerFailure(worker.ConnectionID, worker.LaunchID, "test failure")
	_, exists := m.GetWorkerStatus(worker.ConnectionID)
	assert.False(t, exists)
}

func TestSpawnIsRejectedAfterShutdownStarts(t *testing.T) {
	tempDir := t.TempDir()
	marker := filepath.Join(tempDir, "started")
	binary := filepath.Join(tempDir, "worker")
	require.NoError(t, os.WriteFile(binary, []byte("#!/bin/sh\ntouch \"$MARKER\"\n"), 0o755))

	m := New(Config{WhatsAppBinaryPath: binary})
	m.ctx = context.Background()
	m.shuttingDown = true
	t.Setenv("MARKER", marker)
	err := m.SpawnWorker(context.Background(), "company", "connection", "tenant_company", "postgres://unused")
	require.ErrorContains(t, err, "shutting down")
	_, statErr := os.Stat(marker)
	assert.ErrorIs(t, statErr, os.ErrNotExist)
	assert.Equal(t, 0, m.WorkerCount())
}

func TestSpawnDoesNotStartProcessWhenDurableOwnershipFails(t *testing.T) {
	tempDir := t.TempDir()
	marker := filepath.Join(tempDir, "started")
	binary := filepath.Join(tempDir, "worker")
	require.NoError(t, os.WriteFile(binary, []byte("#!/bin/sh\ntouch \"$MARKER\"\nsleep 30\n"), 0o755))

	registry, mock := newMockRegistry(t)
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO worker_registry")).
		WithArgs(
			"00000000-0000-4000-8000-000000000001",
			"00000000-0000-4000-8000-000000000002",
			"tenant_company",
			"",
			0,
			types.StatusStarting,
			sqlmock.AnyArg(),
			0,
			sqlmock.AnyArg(),
			DesiredStateRunning,
			defaultArtifactVersion,
			sqlmock.AnyArg(),
			// A first launch expects no prior launch: a typed NULL, not "".
			nil,
		).
		WillReturnRows(sqlmock.NewRows([]string{"worker_uid", "worker_gid"}))

	m := New(Config{WhatsAppBinaryPath: binary})
	m.ctx = context.Background()
	m.registry = registry
	t.Setenv("MARKER", marker)
	err := m.SpawnWorker(
		context.Background(),
		"00000000-0000-4000-8000-000000000002",
		"00000000-0000-4000-8000-000000000001",
		"tenant_company",
		"postgres://unused",
	)
	require.ErrorContains(t, err, "claim conflict")
	_, statErr := os.Stat(marker)
	assert.ErrorIs(t, statErr, os.ErrNotExist, "worker process must not start before durable ownership")
	assert.Equal(t, 0, m.WorkerCount())
	require.NoError(t, mock.ExpectationsWereMet())
}
