package manager

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newMockRegistry(t *testing.T) (*WorkerRegistry, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return &WorkerRegistry{db: db}, mock
}

func TestClaimWorkerLaunchRefusesConflict(t *testing.T) {
	registry, mock := newMockRegistry(t)
	worker := &WorkerProcess{
		ConnectionID:    "00000000-0000-4000-8000-000000000001",
		CompanyID:       "00000000-0000-4000-8000-000000000002",
		TenantSchema:    "tenant_company",
		PID:             42,
		Status:          "connecting",
		RestartCount:    2,
		LaunchID:        "00000000-0000-4000-8000-000000000003",
		DesiredState:    DesiredStateRunning,
		ArtifactVersion: "v2",
		ArtifactSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO worker_registry")).
		WithArgs(
			worker.ConnectionID,
			worker.CompanyID,
			worker.TenantSchema,
			"",
			worker.PID,
			worker.Status,
			sqlmock.AnyArg(),
			worker.RestartCount,
			worker.LaunchID,
			worker.DesiredState,
			worker.ArtifactVersion,
			worker.ArtifactSHA256,
			"observed-launch",
		).
		WillReturnRows(sqlmock.NewRows([]string{"worker_uid", "worker_gid"}))

	err := registry.ClaimWorkerLaunch(context.Background(), worker, "observed-launch")
	require.ErrorContains(t, err, "claim conflict")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestClaimWorkerLaunchReturnsFreshDurableCredentials(t *testing.T) {
	registry, mock := newMockRegistry(t)
	worker := &WorkerProcess{
		ConnectionID: "connection", CompanyID: "company", TenantSchema: "tenant_company",
		LaunchID: "new-launch", DesiredState: DesiredStateRunning, Status: "starting",
		ArtifactVersion: "v2", ArtifactSHA256: "digest",
	}
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO worker_registry")).
		WithArgs("connection", "company", "tenant_company", "", 0, "starting", sqlmock.AnyArg(), 0, "new-launch", DesiredStateRunning, "v2", "digest", "old-launch").
		WillReturnRows(sqlmock.NewRows([]string{"worker_uid", "worker_gid"}).AddRow(100123, 100123))

	require.NoError(t, registry.ClaimWorkerLaunch(context.Background(), worker, "old-launch"))
	assert.Equal(t, 100123, worker.WorkerUID)
	assert.Equal(t, 100123, worker.WorkerGID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestActivateWorkerLaunchRejectsLostClaim(t *testing.T) {
	registry, mock := newMockRegistry(t)
	worker := &WorkerProcess{
		ConnectionID: "connection", CompanyID: "company", TenantSchema: "tenant_company",
		PID: 42, Status: "connecting", RestartCount: 1,
		LaunchID: "lost-launch", DesiredState: DesiredStateRunning,
		ArtifactVersion: "v2", ArtifactSHA256: "digest",
		WorkerUID: 100000, WorkerGID: 100000,
	}
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry SET")).
		WithArgs(
			worker.TenantSchema,
			"",
			worker.PID,
			worker.Status,
			sqlmock.AnyArg(),
			worker.RestartCount,
			worker.DesiredState,
			worker.ArtifactVersion,
			worker.ArtifactSHA256,
			worker.ConnectionID,
			worker.CompanyID,
			worker.LaunchID,
			worker.WorkerUID,
			worker.WorkerGID,
		).
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := registry.ActivateWorkerLaunch(context.Background(), worker)
	require.ErrorIs(t, err, ErrWorkerLaunchConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRemoveWorkerLaunchReportsGenerationMismatch(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM worker_registry WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3")).
		WithArgs("connection", "company", "stale-launch").
		WillReturnResult(sqlmock.NewResult(0, 0))

	removed, err := registry.RemoveWorkerLaunch(
		context.Background(),
		"connection",
		"company",
		"stale-launch",
	)
	require.NoError(t, err)
	assert.False(t, removed)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHeartbeatUpdateIsScopedToTenantAndLaunch(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry SET last_heartbeat = $1 WHERE connection_id = $2 AND company_id = $3 AND launch_id = $4")).
		WithArgs(sqlmock.AnyArg(), "connection", "company", "launch").
		WillReturnResult(sqlmock.NewResult(0, 1))

	updated, err := registry.UpdateHeartbeatLaunch(
		context.Background(),
		"connection",
		"company",
		"launch",
	)
	require.NoError(t, err)
	assert.True(t, updated)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRestartCountLookupIsScopedToTenantAndLaunch(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT restart_count FROM worker_registry WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3")).
		WithArgs("connection", "company", "launch").
		WillReturnRows(sqlmock.NewRows([]string{"restart_count"}).AddRow(3))

	count, found, err := registry.GetRestartCountLaunch(
		context.Background(),
		"connection",
		"company",
		"launch",
	)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, 3, count)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestStatusUpdateRejectsStaleLaunch(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry SET status = $1, last_heartbeat = $2 WHERE connection_id = $3 AND company_id = $4 AND launch_id = $5")).
		WithArgs(WorkerStatusRecovering, sqlmock.AnyArg(), "connection", "company", "stale-launch").
		WillReturnResult(sqlmock.NewResult(0, 0))

	updated, err := registry.UpdateStatusLaunch(
		context.Background(),
		"connection",
		"company",
		"stale-launch",
		WorkerStatusRecovering,
	)
	require.NoError(t, err)
	assert.False(t, updated)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateWorkerUpgradeBatchPersistsAllSnapshotsBeforeCommit(t *testing.T) {
	registry, mock := newMockRegistry(t)
	now := time.Now()
	intent := WorkerUpgradeItemIntent{
		Position: 0, CompanyID: "company", TenantSchema: "tenant_company",
		ConnectionID: "connection", SourceGeneration: "source-launch",
		SourceArtifactVersion: "v1", SourceArtifactSHA256: "source-digest",
	}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("LOCK TABLE worker_registry IN SHARE MODE")).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM worker_registry WHERE desired_state = 'running' AND NOT artifact_normalized")).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO worker_upgrade_batches")).
		WithArgs("v2", "target-digest").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "target_artifact_version", "target_artifact_sha256", "phase",
			"result", "last_error", "created_at", "updated_at", "completed_at",
		}).AddRow("batch", "v2", "target-digest", WorkerUpgradePhaseStop, "", "", now, now, nil))
	mock.ExpectQuery(`(?s)INSERT INTO worker_upgrade_items .*AND desired_state = 'running'.*AND artifact_version = \$7::varchar\(128\).*AND artifact_sha256 = \$8::varchar\(64\)`).
		WithArgs("batch", 0, "company", "tenant_company", "connection", "source-launch", "v1", "source-digest").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "batch_id", "position", "company_id", "tenant_schema", "connection_id",
			"source_generation", "source_artifact_version", "source_artifact_sha256",
			"target_generation", "recovery_generation", "rollback_generation",
			"phase", "result", "last_error", "created_at", "updated_at", "completed_at",
		}).AddRow("item", "batch", 0, "company", "tenant_company", "connection", "source-launch", "v1", "source-digest", "", "", "", WorkerUpgradePhaseStop, "", "", now, now, nil))
	mock.ExpectCommit()

	batch, err := registry.CreateWorkerUpgradeBatch(context.Background(), "v2", "target-digest", []WorkerUpgradeItemIntent{intent})
	require.NoError(t, err)
	require.Len(t, batch.Items, 1)
	assert.Equal(t, "source-launch", batch.Items[0].SourceGeneration)
	assert.Equal(t, "v1", batch.Items[0].SourceArtifactVersion)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateWorkerUpgradeBatchRollsBackOnStaleSnapshot(t *testing.T) {
	registry, mock := newMockRegistry(t)
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("LOCK TABLE worker_registry IN SHARE MODE")).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM worker_registry WHERE desired_state = 'running' AND NOT artifact_normalized")).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO worker_upgrade_batches")).
		WithArgs("v2", "digest").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "target_artifact_version", "target_artifact_sha256", "phase",
			"result", "last_error", "created_at", "updated_at", "completed_at",
		}).AddRow("batch", "v2", "digest", WorkerUpgradePhaseStop, "", "", now, now, nil))
	mock.ExpectQuery(`(?s)INSERT INTO worker_upgrade_items .*AND desired_state = 'running'.*AND artifact_version = \$7::varchar\(128\).*AND artifact_sha256 = \$8::varchar\(64\)`).
		WithArgs("batch", 0, "company", "tenant_company", "connection", "stale", "v1", "old-digest").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	batch, err := registry.CreateWorkerUpgradeBatch(context.Background(), "v2", "digest", []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: "company", TenantSchema: "tenant_company",
		ConnectionID: "connection", SourceGeneration: "stale",
		SourceArtifactVersion: "v1", SourceArtifactSHA256: "old-digest",
	}})
	require.Nil(t, batch)
	require.ErrorIs(t, err, ErrWorkerUpgradeSnapshotConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetActiveWorkerUpgradeBatchLoadsCrashRecoveryStateInOrder(t *testing.T) {
	registry, mock := newMockRegistry(t)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id::text, target_artifact_version, target_artifact_sha256, phase, COALESCE(result, ''), COALESCE(last_error, ''), created_at, updated_at, completed_at FROM worker_upgrade_batches WHERE completed_at IS NULL")).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "target_artifact_version", "target_artifact_sha256", "phase",
			"result", "last_error", "created_at", "updated_at", "completed_at",
		}).AddRow("batch", "v2", "target-digest", WorkerUpgradePhaseRecovery, "", "restart", now, now, nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_items WHERE batch_id = $1::uuid ORDER BY position")).
		WithArgs("batch").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "batch_id", "position", "company_id", "tenant_schema", "connection_id",
			"source_generation", "source_artifact_version", "source_artifact_sha256",
			"target_generation", "recovery_generation", "rollback_generation",
			"phase", "result", "last_error", "created_at", "updated_at", "completed_at",
		}).AddRow("item", "batch", 0, "company", "tenant_company", "connection", "source", "v1", "source-digest", "target", "", "", WorkerUpgradePhaseRecovery, "", "", now, now, nil))

	batch, err := registry.GetActiveWorkerUpgradeBatch(context.Background())
	require.NoError(t, err)
	require.NotNil(t, batch)
	assert.Equal(t, WorkerUpgradePhaseRecovery, batch.Phase)
	require.Len(t, batch.Items, 1)
	assert.Equal(t, "target", batch.Items[0].TargetGeneration)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAdvanceWorkerUpgradeItemScopesCASByTenantConnectionAndSourceGeneration(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_items SET phase = $1, target_generation = COALESCE(NULLIF($2, '')::uuid, target_generation), last_error = NULLIF($3, ''), updated_at = now() WHERE batch_id = $4::uuid AND company_id = $5::uuid AND tenant_schema = $6 AND connection_id = $7::uuid AND source_generation = $8::uuid AND phase = $9 AND completed_at IS NULL")).
		WithArgs(WorkerUpgradePhaseLaunch, "target", "", "batch", "company", "tenant_company", "connection", "source", WorkerUpgradePhaseStop).
		WillReturnResult(sqlmock.NewResult(0, 0))

	updated, err := registry.AdvanceWorkerUpgradeItem(
		context.Background(), "batch", "company", "tenant_company", "connection", "source",
		WorkerUpgradePhaseStop, WorkerUpgradePhaseLaunch, "target", "",
	)
	require.NoError(t, err)
	assert.False(t, updated)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCompanyWorkerArtifactUsesNewestCompletedRollout(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT batch.target_artifact_version, batch.target_artifact_sha256 FROM worker_upgrade_batches batch JOIN worker_upgrade_items item ON item.batch_id = batch.id WHERE item.company_id = $1::uuid AND batch.result = 'completed' AND batch.completed_at IS NOT NULL ORDER BY batch.completed_at DESC LIMIT 1")).
		WithArgs("company").
		WillReturnRows(sqlmock.NewRows([]string{"target_artifact_version", "target_artifact_sha256"}).
			AddRow("v3", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))

	version, digest, found, err := registry.GetCompanyWorkerArtifact(context.Background(), "company")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "v3", version)
	assert.Equal(t, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", digest)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAuthoritativeStopRollsBackRegistryIntentWhenAbandonmentFails(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry SET desired_state = $1, last_heartbeat = now()")).
		WithArgs(DesiredStateStopped, "connection", "company", "tenant", "launch").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT batch.id::text FROM worker_upgrade_batches batch JOIN worker_upgrade_items item ON item.batch_id = batch.id JOIN worker_registry current ON current.connection_id = item.connection_id")).
		WithArgs("company", "tenant", "connection", "launch", DesiredStateStopped).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("batch"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_items SET phase = 'abandoned', result = 'abandoned_external'")).
		WithArgs("operator stop", "batch").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_batches SET phase = 'abandoned', result = 'abandoned'")).
		WithArgs("operator stop", "batch").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	updated, abandoned, err := registry.SetDesiredStateAndAbandonHaltedUpgrade(
		context.Background(), "connection", "company", "tenant", "launch",
		DesiredStateStopped, "operator stop",
	)
	assert.False(t, updated)
	assert.False(t, abandoned)
	require.ErrorContains(t, err, "affected 0 rows")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHaltWorkerUpgradeRollsBackWhenCheckedItemUpdateLosesCAS(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT item.id::text FROM worker_upgrade_items item JOIN worker_upgrade_batches batch ON batch.id = item.batch_id")).
		WithArgs("batch", "company", "tenant", "connection", "source", WorkerUpgradePhaseRollback, WorkerUpgradePhaseRollback).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("item"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_items SET phase = 'halted'")).
		WithArgs("target", "failed", "item", WorkerUpgradePhaseRollback).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	halted, err := registry.HaltWorkerUpgrade(
		context.Background(), "batch", "company", "tenant", "connection", "source",
		WorkerUpgradePhaseRollback, WorkerUpgradePhaseRollback, "target", "failed",
	)
	assert.False(t, halted)
	require.ErrorContains(t, err, "affected 0 rows")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestResumeHaltedWorkerUpgradeRollbackIsAtomic(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT item\.id::text.*AND EXISTS \(.*FROM worker_registry current.*FOR UPDATE OF batch, item`).
		WithArgs("batch", "connection").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("item"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_items SET phase = 'rollback', last_error = NULL, updated_at = now() WHERE id = $1::uuid AND phase = 'halted' AND completed_at IS NULL")).
		WithArgs("item").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_batches SET phase = 'rollback', last_error = NULL, updated_at = now() WHERE id = $1::uuid AND phase = 'halted' AND completed_at IS NULL")).
		WithArgs("batch").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	resumed, err := registry.ResumeHaltedWorkerUpgradeRollback(context.Background(), "batch", "connection")
	require.NoError(t, err)
	assert.True(t, resumed)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetWorkerCarriesArtifactIdentityForRecovery(t *testing.T) {
	registry, mock := newMockRegistry(t)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state, artifact_version, artifact_sha256, worker_uid, worker_gid FROM worker_registry WHERE connection_id = $1")).
		WithArgs("connection").
		WillReturnRows(sqlmock.NewRows([]string{
			"connection_id", "company_id", "tenant_schema", "database_url", "pid", "status",
			"started_at", "last_heartbeat", "restart_count", "launch_id", "desired_state",
			"artifact_version", "artifact_sha256", "worker_uid", "worker_gid",
		}).AddRow("connection", "company", "tenant_company", "", 42, "connected", now, now, 0, "launch", DesiredStateRunning, "v2", "digest", 100000, 100000))

	worker, err := registry.GetWorker(context.Background(), "connection")
	require.NoError(t, err)
	require.NotNil(t, worker)
	assert.Equal(t, "v2", worker.ArtifactVersion)
	assert.Equal(t, "digest", worker.ArtifactSHA256)
	assert.Equal(t, 100000, worker.WorkerUID)
	assert.Equal(t, 100000, worker.WorkerGID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestBeginWorkerUpgradeRollbackAtomicallyReopensPriorAndCancelsUntouched(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT item.position FROM worker_upgrade_items item JOIN worker_upgrade_batches batch ON batch.id = item.batch_id")).
		WithArgs("batch", "company", "tenant_company", "failed", "source-failed", WorkerUpgradePhaseVerify).
		WillReturnRows(sqlmock.NewRows([]string{"position"}).AddRow(2))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_batches SET phase = 'rollback', last_error = $1, updated_at = now() WHERE id = $2::uuid AND completed_at IS NULL")).
		WithArgs("target failed", "batch").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_items SET phase = 'rollback', result = NULL, completed_at = NULL, target_generation = COALESCE(NULLIF($1, '')::uuid, target_generation), last_error = $2, updated_at = now()")).
		WithArgs("target-failed", "target failed", "batch", "company", "tenant_company", "failed", "source-failed", WorkerUpgradePhaseVerify).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_items SET phase = 'rollback', result = NULL, completed_at = NULL, last_error = $1, updated_at = now() WHERE batch_id = $2::uuid AND position < $3 AND result = 'target_complete' AND completed_at IS NOT NULL")).
		WithArgs("target failed", "batch", 2).WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_items SET phase = 'canceled', result = 'canceled_untouched'")).
		WithArgs("target failed", "batch", 2).WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	began, err := registry.BeginWorkerUpgradeRollback(
		context.Background(), "batch", "company", "tenant_company", "failed",
		"source-failed", WorkerUpgradePhaseVerify, "target-failed", "target failed",
	)
	require.NoError(t, err)
	assert.True(t, began)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestVerifyRefreshCompletionRequiresExactDurableTargetGeneration(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT item.id::text FROM worker_upgrade_items item JOIN worker_upgrade_batches batch ON batch.id = item.batch_id JOIN worker_registry current ON current.connection_id = item.connection_id")).
		WithArgs("batch", "company", "tenant_company", "connection", "source", "target-old", "target-new").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectRollback()

	updated, err := registry.CompleteWorkerUpgradeVerifyRefresh(
		context.Background(), "batch", "company", "tenant_company", "connection",
		"source", "target-old", "target-new",
	)
	require.NoError(t, err)
	assert.False(t, updated, "a non-owning durable target generation must not refresh verification")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCompleteWorkerUpgradeBatchRefusesNonTerminalItemSet(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_batches batch")).
		WithArgs("completed", "batch", WorkerUpgradePhaseStop).
		WillReturnResult(sqlmock.NewResult(0, 0))

	completed, err := registry.CompleteWorkerUpgradeBatch(context.Background(), "batch", WorkerUpgradePhaseStop, "completed")
	require.NoError(t, err)
	assert.False(t, completed)
	require.NoError(t, mock.ExpectationsWereMet())
}
