package manager

import (
	"context"
	"errors"
	"os/exec"
	"regexp"
	"syscall"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPendingBatchRollbackRunsEveryTouchedItemInReverse(t *testing.T) {
	now := time.Now()
	batch := &WorkerUpgradeBatch{Items: []*WorkerUpgradeItem{
		{Position: 0, Phase: WorkerUpgradePhaseRollback},
		{Position: 1, Phase: WorkerUpgradePhaseRollback},
		{Position: 2, Phase: WorkerUpgradePhaseRollback},
		{Position: 3, Phase: WorkerUpgradePhaseCanceled, Result: WorkerUpgradeItemResultCanceledUntouched, CompletedAt: &now},
	}}
	pending := pendingRollbackItemsReverse(batch)
	require.Len(t, pending, 3)
	assert.Equal(t, []int{2, 1, 0}, []int{pending[0].Position, pending[1].Position, pending[2].Position})
}

func TestRollbackRefusesToSignalNewerUnownedGeneration(t *testing.T) {
	registry, mock := newMockRegistry(t)
	root := t.TempDir()
	digest := writeArtifact(t, root, "source", []byte("source worker"))
	cmd := exec.Command("/bin/sh", "-c", "while true; do sleep 1; done")
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _, _ = cmd.Process.Wait() })
	manager := New(Config{ArtifactRoot: root})
	manager.registry = registry
	manager.workers["connection"] = &WorkerProcess{
		CompanyID: "company", ConnectionID: "connection", TenantSchema: "tenant_company",
		LaunchID: "newer-generation", DesiredState: DesiredStateRunning,
		ArtifactVersion: "other", ArtifactSHA256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		WorkerUID: 100002, WorkerGID: 100002, PID: cmd.Process.Pid, cmd: cmd,
	}
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state, artifact_version, artifact_sha256, worker_uid, worker_gid FROM worker_registry WHERE connection_id = $1")).
		WithArgs("connection").WillReturnRows(sqlmock.NewRows([]string{
		"connection_id", "company_id", "tenant_schema", "database_url", "pid", "status",
		"started_at", "last_heartbeat", "restart_count", "launch_id", "desired_state",
		"artifact_version", "artifact_sha256", "worker_uid", "worker_gid",
	}).AddRow("connection", "company", "tenant_company", "", cmd.Process.Pid, "connected", now, now, 0,
		"newer-generation", DesiredStateRunning, "other", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 100002, 100002))
	batch := &WorkerUpgradeBatch{ID: "batch", TargetArtifactVersion: "target", TargetArtifactSHA256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", Phase: WorkerUpgradePhaseRollback}
	item := &WorkerUpgradeItem{
		BatchID: "batch", CompanyID: "company", TenantSchema: "tenant_company",
		ConnectionID: "connection", SourceGeneration: "source-generation",
		SourceArtifactVersion: "source", SourceArtifactSHA256: digest,
		TargetGeneration: "target-generation", Phase: WorkerUpgradePhaseRollback,
	}
	err := manager.rollbackWorkerUpgrade(context.Background(), batch, item)
	require.ErrorContains(t, err, "not the snapshotted source or reserved target")
	require.NoError(t, syscall.Kill(cmd.Process.Pid, 0), "newer generation was signaled")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRollbackFailureHaltsOnlyActionableItemAndBatch(t *testing.T) {
	registry, mock := newMockRegistry(t)
	batch := &WorkerUpgradeBatch{ID: "batch", Phase: WorkerUpgradePhaseRollback}
	item := &WorkerUpgradeItem{
		ID: "failed", BatchID: "batch", CompanyID: "company", TenantSchema: "tenant_company",
		ConnectionID: "connection", SourceGeneration: "source", TargetGeneration: "target",
		Phase: WorkerUpgradePhaseRollback,
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT item.id::text FROM worker_upgrade_items item JOIN worker_upgrade_batches batch ON batch.id = item.batch_id")).
		WithArgs("batch", "company", "tenant_company", "connection", "source", WorkerUpgradePhaseRollback, WorkerUpgradePhaseRollback).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("failed"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_items SET phase = 'halted'")).
		WithArgs("target", "rollback failed", "failed", WorkerUpgradePhaseRollback).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_batches SET phase = 'halted'")).
		WithArgs("rollback failed", "batch", WorkerUpgradePhaseRollback).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	manager := New(Config{})
	manager.registry = registry
	manager.haltRollbackFailure(context.Background(), batch, item, errors.New("rollback failed"))
	require.NoError(t, mock.ExpectationsWereMet(), "pending earlier rollbacks must remain pending, not be mass-halted")
}
