package manager

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/lib/pq"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

func TestWorkerRegistryAcceptsRealMigration071IdentitySchema(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	require.NoError(t, registry.Close())
}

func TestRealPostgresVerifyRefreshFencesExactTargetGeneration(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	ctx := context.Background()
	companyID, _ := newLaunchID()
	connectionID, _ := newLaunchID()
	sourceGeneration, _ := newLaunchID()
	sourceDigest := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	targetDigest := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	_, err = registry.db.ExecContext(ctx, `
		INSERT INTO worker_registry (
			connection_id, company_id, tenant_schema, database_url, pid, status,
			launch_id, desired_state, artifact_version, artifact_sha256
		) VALUES ($1::uuid, $2::uuid, 'tenant_refresh', '', 0, 'connected',
			$3::uuid, 'running', 'v1', $4)
	`, connectionID, companyID, sourceGeneration, sourceDigest)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
	})
	batch, err := registry.CreateWorkerUpgradeBatch(ctx, "v2", targetDigest, []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: companyID, TenantSchema: "tenant_refresh",
		ConnectionID: connectionID, SourceGeneration: sourceGeneration,
		SourceArtifactVersion: "v1", SourceArtifactSHA256: sourceDigest,
	}})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
	})
	item := batch.Items[0]
	advanced, err := registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseStop, WorkerUpgradePhaseLaunch, "", "")
	require.NoError(t, err)
	require.True(t, advanced)
	oldTarget, _ := newLaunchID()
	advanced, err = registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseLaunch, WorkerUpgradePhaseVerify, oldTarget, "")
	require.NoError(t, err)
	require.True(t, advanced)
	advanced, err = registry.BeginWorkerUpgradeVerifyRefresh(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, oldTarget)
	require.NoError(t, err)
	require.True(t, advanced)
	newTarget, _ := newLaunchID()
	advanced, err = registry.ReserveWorkerUpgradeGeneration(
		ctx, batch.ID, companyID, item.TenantSchema, connectionID,
		sourceGeneration, WorkerUpgradePhaseRecovery, "recovery_generation", newTarget,
	)
	require.NoError(t, err)
	require.True(t, advanced)
	_, err = registry.db.ExecContext(ctx, `
		UPDATE worker_registry SET launch_id = $1::uuid,
			artifact_version = 'v2', artifact_sha256 = $2,
			worker_uid = nextval('worker_os_identity_seq')
		WHERE connection_id = $3::uuid
	`, newTarget, targetDigest, connectionID)
	require.NoError(t, err)
	wrongTarget, _ := newLaunchID()
	advanced, err = registry.CompleteWorkerUpgradeVerifyRefresh(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, oldTarget, wrongTarget)
	require.NoError(t, err)
	require.False(t, advanced)
	advanced, err = registry.CompleteWorkerUpgradeVerifyRefresh(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, oldTarget, newTarget)
	require.NoError(t, err)
	require.True(t, advanced)
	refreshed, err := registry.GetWorkerUpgradeBatch(ctx, batch.ID)
	require.NoError(t, err)
	require.Equal(t, WorkerUpgradePhaseVerify, refreshed.Items[0].Phase)
	require.Equal(t, newTarget, refreshed.Items[0].TargetGeneration)
}

func TestRealPostgresCompletionCASRejectsStaleGenerationArtifactAndCredentials(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	ctx := context.Background()
	companyID, _ := newLaunchID()
	connectionID, _ := newLaunchID()
	sourceGeneration, _ := newLaunchID()
	targetGeneration, _ := newLaunchID()
	sourceDigest := "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	targetDigest := "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	_, err = registry.db.ExecContext(ctx, `
		INSERT INTO worker_registry (
			connection_id, company_id, tenant_schema, database_url, pid, status,
			launch_id, desired_state, artifact_version, artifact_sha256
		) VALUES ($1::uuid, $2::uuid, 'tenant_cas', '', 101, 'connected',
			$3::uuid, 'running', 'source', $4)
	`, connectionID, companyID, sourceGeneration, sourceDigest)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
	})
	batch, err := registry.CreateWorkerUpgradeBatch(ctx, "target", targetDigest, []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: companyID, TenantSchema: "tenant_cas",
		ConnectionID: connectionID, SourceGeneration: sourceGeneration,
		SourceArtifactVersion: "source", SourceArtifactSHA256: sourceDigest,
	}})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
	})
	item := batch.Items[0]
	advanced, err := registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseStop, WorkerUpgradePhaseLaunch, "", "")
	require.NoError(t, err)
	require.True(t, advanced)
	advanced, err = registry.ReserveWorkerUpgradeGeneration(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseLaunch, "target_generation", targetGeneration)
	require.NoError(t, err)
	require.True(t, advanced)
	advanced, err = registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseLaunch, WorkerUpgradePhaseVerify, targetGeneration, "")
	require.NoError(t, err)
	require.True(t, advanced)
	_, err = registry.db.ExecContext(ctx, `
		UPDATE worker_registry SET launch_id = $1::uuid, artifact_version = 'target',
			artifact_sha256 = $2, worker_uid = nextval('worker_os_identity_seq')
		WHERE connection_id = $3::uuid
	`, targetGeneration, targetDigest, connectionID)
	require.NoError(t, err)
	record, err := registry.GetWorker(ctx, connectionID)
	require.NoError(t, err)
	fresh := WorkerUpgradeLiveFence{LaunchID: record.LaunchID, ArtifactVersion: record.ArtifactVersion, ArtifactSHA256: record.ArtifactSHA256, WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID}
	for _, stale := range []WorkerUpgradeLiveFence{
		{LaunchID: sourceGeneration, ArtifactVersion: fresh.ArtifactVersion, ArtifactSHA256: fresh.ArtifactSHA256, WorkerUID: fresh.WorkerUID, WorkerGID: fresh.WorkerGID},
		{LaunchID: fresh.LaunchID, ArtifactVersion: "source", ArtifactSHA256: sourceDigest, WorkerUID: fresh.WorkerUID, WorkerGID: fresh.WorkerGID},
		{LaunchID: fresh.LaunchID, ArtifactVersion: fresh.ArtifactVersion, ArtifactSHA256: fresh.ArtifactSHA256, WorkerUID: fresh.WorkerUID + 1, WorkerGID: fresh.WorkerGID + 1},
	} {
		completed, completeErr := registry.CompleteWorkerUpgradeItem(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseVerify, stale)
		require.NoError(t, completeErr)
		require.False(t, completed)
	}
	// Hold the registry row while an external generation replacement commits.
	// Completion must block on PostgreSQL's row lock, then observe the newer
	// generation and fail its CAS rather than recording stale success.
	tx, err := registry.db.BeginTx(ctx, nil)
	require.NoError(t, err)
	newerGeneration, _ := newLaunchID()
	_, err = tx.ExecContext(ctx, `
		UPDATE worker_registry SET launch_id = $1::uuid,
			worker_uid = nextval('worker_os_identity_seq')
		WHERE connection_id = $2::uuid
	`, newerGeneration, connectionID)
	require.NoError(t, err)
	type completionResult struct {
		completed bool
		err       error
	}
	completion := make(chan completionResult, 1)
	go func() {
		ok, completeErr := registry.CompleteWorkerUpgradeItem(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseVerify, fresh)
		completion <- completionResult{completed: ok, err: completeErr}
	}()
	select {
	case <-completion:
		t.Fatal("completion did not serialize behind the registry generation CAS")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, tx.Commit())
	raceResult := <-completion
	require.NoError(t, raceResult.err)
	require.False(t, raceResult.completed)

	_, err = registry.db.ExecContext(ctx, `
		UPDATE worker_registry SET launch_id = $1::uuid,
			worker_uid = nextval('worker_os_identity_seq')
		WHERE connection_id = $2::uuid
	`, targetGeneration, connectionID)
	require.NoError(t, err)
	record, err = registry.GetWorker(ctx, connectionID)
	require.NoError(t, err)
	fresh = WorkerUpgradeLiveFence{LaunchID: record.LaunchID, ArtifactVersion: record.ArtifactVersion, ArtifactSHA256: record.ArtifactSHA256, WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID}
	completed, err := registry.CompleteWorkerUpgradeItem(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseVerify, fresh)
	require.NoError(t, err)
	require.True(t, completed)
}

func TestRealPostgresReservedGenerationCrashBoundariesRetrySameIdentity(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	const (
		sourceDigest = "1212121212121212121212121212121212121212121212121212121212121212"
		targetDigest = "3434343434343434343434343434343434343434343434343434343434343434"
	)
	type fixture struct {
		registry         *WorkerRegistry
		batch            *WorkerUpgradeBatch
		item             *WorkerUpgradeItem
		companyID        string
		connectionID     string
		sourceGeneration string
	}
	newFixture := func(t *testing.T) fixture {
		t.Helper()
		registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
		require.NoError(t, err)
		t.Cleanup(func() { _ = registry.Close() })
		companyID, _ := newLaunchID()
		connectionID, _ := newLaunchID()
		sourceGeneration, _ := newLaunchID()
		_, err = registry.db.ExecContext(context.Background(), `
			INSERT INTO worker_registry (
				connection_id, company_id, tenant_schema, database_url, pid, status,
				launch_id, desired_state, artifact_version, artifact_sha256
			) VALUES ($1::uuid, $2::uuid, 'tenant_crash_boundary', '', 0, 'error',
				$3::uuid, 'running', 'source', $4)
		`, connectionID, companyID, sourceGeneration, sourceDigest)
		require.NoError(t, err)
		batch, err := registry.CreateWorkerUpgradeBatch(context.Background(), "target", targetDigest, []WorkerUpgradeItemIntent{{
			Position: 0, CompanyID: companyID, TenantSchema: "tenant_crash_boundary",
			ConnectionID: connectionID, SourceGeneration: sourceGeneration,
			SourceArtifactVersion: "source", SourceArtifactSHA256: sourceDigest,
		}})
		require.NoError(t, err)
		t.Cleanup(func() {
			_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
			_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
		})
		return fixture{registry: registry, batch: batch, item: batch.Items[0], companyID: companyID, connectionID: connectionID, sourceGeneration: sourceGeneration}
	}
	claimAndRetry := func(t *testing.T, f fixture, generation, expectedGeneration, version, digest, phase string) *WorkerRecord {
		t.Helper()
		first := &WorkerProcess{
			ConnectionID: f.connectionID, CompanyID: f.companyID,
			TenantSchema: "tenant_crash_boundary", LaunchID: generation,
			DesiredState: DesiredStateRunning, Status: "error",
			ArtifactVersion: version, ArtifactSHA256: digest,
		}
		require.NoError(t, f.registry.ClaimWorkerLaunch(context.Background(), first, expectedGeneration))
		firstUID := first.WorkerUID
		recoveredBatch, err := f.registry.GetWorkerUpgradeBatch(context.Background(), f.batch.ID)
		require.NoError(t, err)
		require.Len(t, recoveredBatch.Items, 1)
		recoveredItem := recoveredBatch.Items[0]
		manager := New(Config{})
		manager.registry = f.registry
		manager.workers[f.connectionID] = &WorkerProcess{
			ConnectionID: f.connectionID, CompanyID: f.companyID,
			TenantSchema: recoveredItem.TenantSchema, LaunchID: generation,
			DesiredState: DesiredStateRunning, Status: "error", PID: 0,
			ArtifactVersion: version, ArtifactSHA256: digest,
			WorkerUID: first.WorkerUID, WorkerGID: first.WorkerGID,
		}
		manager.reservedRelaunch = func(ctx context.Context, item *WorkerUpgradeItem, artifact WorkerArtifact, reservedGeneration string) error {
			retry := &WorkerProcess{
				ConnectionID: item.ConnectionID, CompanyID: item.CompanyID,
				TenantSchema: item.TenantSchema, LaunchID: reservedGeneration,
				DesiredState: DesiredStateRunning, Status: "error",
				ArtifactVersion: artifact.Version, ArtifactSHA256: artifact.SHA256,
			}
			if claimErr := f.registry.ClaimWorkerLaunch(ctx, retry, reservedGeneration); claimErr != nil {
				return claimErr
			}
			retry.PID = 4242
			manager.mu.Lock()
			manager.workers[item.ConnectionID] = retry
			manager.mu.Unlock()
			return nil
		}
		relaunched, err := manager.relaunchDeadReservedGeneration(
			context.Background(), recoveredBatch, recoveredItem, phase, generation,
			WorkerArtifact{Version: version, SHA256: digest},
		)
		require.NoError(t, err)
		require.True(t, relaunched)
		relaunchedWorker, exists := manager.GetWorkerStatus(f.connectionID)
		require.True(t, exists)
		require.Equal(t, generation, relaunchedWorker.LaunchID)
		require.NotEqual(t, firstUID, relaunchedWorker.WorkerUID)
		record, err := f.registry.GetWorker(context.Background(), f.connectionID)
		require.NoError(t, err)
		require.Equal(t, generation, record.LaunchID)
		require.Equal(t, version, record.ArtifactVersion)
		require.Equal(t, digest, record.ArtifactSHA256)
		require.Equal(t, relaunchedWorker.WorkerUID, record.WorkerUID)
		return record
	}
	prepareTarget := func(t *testing.T, f fixture) string {
		t.Helper()
		ctx := context.Background()
		advanced, err := f.registry.AdvanceWorkerUpgradeItem(ctx, f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, WorkerUpgradePhaseStop, WorkerUpgradePhaseLaunch, "", "")
		require.NoError(t, err)
		require.True(t, advanced)
		targetGeneration, _ := newLaunchID()
		reserved, err := f.registry.ReserveWorkerUpgradeGeneration(ctx, f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, WorkerUpgradePhaseLaunch, "target_generation", targetGeneration)
		require.NoError(t, err)
		require.True(t, reserved)
		return targetGeneration
	}

	t.Run("target launch", func(t *testing.T) {
		f := newFixture(t)
		targetGeneration := prepareTarget(t, f)
		claimAndRetry(t, f, targetGeneration, f.sourceGeneration, "target", targetDigest, WorkerUpgradePhaseLaunch)
		recovered, err := f.registry.GetWorkerUpgradeBatch(context.Background(), f.batch.ID)
		require.NoError(t, err)
		require.Equal(t, WorkerUpgradePhaseLaunch, recovered.Items[0].Phase)
		require.Equal(t, targetGeneration, recovered.Items[0].TargetGeneration)
		advanced, err := f.registry.AdvanceWorkerUpgradeItem(context.Background(), f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, WorkerUpgradePhaseLaunch, WorkerUpgradePhaseVerify, targetGeneration, "")
		require.NoError(t, err)
		require.True(t, advanced)
	})

	t.Run("verify refresh", func(t *testing.T) {
		f := newFixture(t)
		targetGeneration := prepareTarget(t, f)
		claimAndRetry(t, f, targetGeneration, f.sourceGeneration, "target", targetDigest, WorkerUpgradePhaseLaunch)
		advanced, err := f.registry.AdvanceWorkerUpgradeItem(context.Background(), f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, WorkerUpgradePhaseLaunch, WorkerUpgradePhaseVerify, targetGeneration, "")
		require.NoError(t, err)
		require.True(t, advanced)
		advanced, err = f.registry.BeginWorkerUpgradeVerifyRefresh(context.Background(), f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, targetGeneration)
		require.NoError(t, err)
		require.True(t, advanced)
		recoveryGeneration, _ := newLaunchID()
		advanced, err = f.registry.ReserveWorkerUpgradeGeneration(context.Background(), f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, WorkerUpgradePhaseRecovery, "recovery_generation", recoveryGeneration)
		require.NoError(t, err)
		require.True(t, advanced)
		claimAndRetry(t, f, recoveryGeneration, targetGeneration, "target", targetDigest, WorkerUpgradePhaseRecovery)
		recovered, err := f.registry.GetWorkerUpgradeBatch(context.Background(), f.batch.ID)
		require.NoError(t, err)
		require.Equal(t, WorkerUpgradePhaseRecovery, recovered.Items[0].Phase)
		require.Equal(t, recoveryGeneration, recovered.Items[0].RecoveryGeneration)
		advanced, err = f.registry.CompleteWorkerUpgradeVerifyRefresh(context.Background(), f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, targetGeneration, recoveryGeneration)
		require.NoError(t, err)
		require.True(t, advanced)
	})

	t.Run("reverse rollback", func(t *testing.T) {
		f := newFixture(t)
		targetGeneration := prepareTarget(t, f)
		claimAndRetry(t, f, targetGeneration, f.sourceGeneration, "target", targetDigest, WorkerUpgradePhaseLaunch)
		advanced, err := f.registry.AdvanceWorkerUpgradeItem(context.Background(), f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, WorkerUpgradePhaseLaunch, WorkerUpgradePhaseVerify, targetGeneration, "")
		require.NoError(t, err)
		require.True(t, advanced)
		began, err := f.registry.BeginWorkerUpgradeRollback(context.Background(), f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, WorkerUpgradePhaseVerify, targetGeneration, "target failed")
		require.NoError(t, err)
		require.True(t, began)
		rollbackGeneration, _ := newLaunchID()
		reserved, err := f.registry.ReserveWorkerUpgradeGeneration(context.Background(), f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, WorkerUpgradePhaseRollback, "rollback_generation", rollbackGeneration)
		require.NoError(t, err)
		require.True(t, reserved)
		record := claimAndRetry(t, f, rollbackGeneration, targetGeneration, "source", sourceDigest, WorkerUpgradePhaseRollback)
		recovered, err := f.registry.GetWorkerUpgradeBatch(context.Background(), f.batch.ID)
		require.NoError(t, err)
		require.Equal(t, WorkerUpgradePhaseRollback, recovered.Items[0].Phase)
		require.Equal(t, rollbackGeneration, recovered.Items[0].RollbackGeneration)
		completed, err := f.registry.CompleteWorkerUpgradeItem(context.Background(), f.batch.ID, f.companyID, f.item.TenantSchema, f.connectionID, f.sourceGeneration, WorkerUpgradePhaseRollback, WorkerUpgradeLiveFence{
			LaunchID: record.LaunchID, ArtifactVersion: record.ArtifactVersion,
			ArtifactSHA256: record.ArtifactSHA256, WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID,
		})
		require.NoError(t, err)
		require.True(t, completed)
	})
}

func TestRealPostgresAuthoritativeStopAbandonsHaltedBatchAndBlocksRetryResurrection(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	ctx := context.Background()
	companyID, _ := newLaunchID()
	connectionID, _ := newLaunchID()
	sourceGeneration, _ := newLaunchID()
	digest := "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	_, err = registry.db.ExecContext(ctx, `
		INSERT INTO worker_registry (
			connection_id, company_id, tenant_schema, database_url, pid, status,
			launch_id, desired_state, artifact_version, artifact_sha256
		) VALUES ($1::uuid, $2::uuid, 'tenant_abandon', '', 0, 'error',
			$3::uuid, 'running', 'source', $4)
	`, connectionID, companyID, sourceGeneration, digest)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
	})
	batch, err := registry.CreateWorkerUpgradeBatch(ctx, "target", "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: companyID, TenantSchema: "tenant_abandon",
		ConnectionID: connectionID, SourceGeneration: sourceGeneration,
		SourceArtifactVersion: "source", SourceArtifactSHA256: digest,
	}})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
	})
	halted, err := registry.HaltWorkerUpgrade(ctx, batch.ID, companyID, "tenant_abandon", connectionID, sourceGeneration, WorkerUpgradePhaseStop, WorkerUpgradePhaseStop, "", "test halt")
	require.NoError(t, err)
	require.True(t, halted)
	newerGeneration, _ := newLaunchID()
	_, err = registry.db.ExecContext(ctx, `
		UPDATE worker_registry SET launch_id = $1::uuid,
			worker_uid = nextval('worker_os_identity_seq')
		WHERE connection_id = $2::uuid
	`, newerGeneration, connectionID)
	require.NoError(t, err)
	resumed, err := registry.ResumeHaltedWorkerUpgradeRollback(ctx, batch.ID, connectionID)
	require.NoError(t, err)
	require.False(t, resumed, "retry must not CAS-replace a newer generation")
	_, err = registry.db.ExecContext(ctx, `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
	require.NoError(t, err)
	resumed, err = registry.ResumeHaltedWorkerUpgradeRollback(ctx, batch.ID, connectionID)
	require.NoError(t, err)
	require.False(t, resumed, "retry must not resurrect a missing generation")
	_, err = registry.db.ExecContext(ctx, `
		INSERT INTO worker_registry (
			connection_id, company_id, tenant_schema, database_url, pid, status,
			launch_id, desired_state, artifact_version, artifact_sha256
		) VALUES ($1::uuid, $2::uuid, 'tenant_abandon', '', 0, 'error',
			$3::uuid, 'running', 'source', $4)
	`, connectionID, companyID, sourceGeneration, digest)
	require.NoError(t, err)
	updated, abandoned, err := registry.SetDesiredStateAndAbandonHaltedUpgrade(
		ctx, connectionID, companyID, "tenant_wrong", sourceGeneration,
		DesiredStateStopped, "operator stop",
	)
	require.NoError(t, err)
	require.False(t, updated)
	require.False(t, abandoned)
	updated, abandoned, err = registry.SetDesiredStateAndAbandonHaltedUpgrade(
		ctx, connectionID, companyID, "tenant_abandon", newerGeneration,
		DesiredStateStopped, "operator stop",
	)
	require.NoError(t, err)
	require.False(t, updated)
	require.False(t, abandoned)
	updated, abandoned, err = registry.SetDesiredStateAndAbandonHaltedUpgrade(
		ctx, connectionID, companyID, "tenant_abandon", sourceGeneration,
		DesiredStateStopped, "operator stop",
	)
	require.NoError(t, err)
	require.True(t, updated)
	require.True(t, abandoned)
	updated, abandoned, err = registry.SetDesiredStateAndAbandonHaltedUpgrade(
		ctx, connectionID, companyID, "tenant_abandon", sourceGeneration,
		DesiredStateStopped, "operator stop redelivery",
	)
	require.NoError(t, err)
	require.True(t, updated)
	require.False(t, abandoned)
	status, err := registry.GetWorkerUpgradeBatch(ctx, batch.ID)
	require.NoError(t, err)
	require.Equal(t, WorkerUpgradePhaseAbandoned, status.Phase)
	require.Equal(t, "abandoned", status.Result)
	require.NotNil(t, status.CompletedAt)
	require.Equal(t, WorkerUpgradeItemResultAbandonedExternal, status.Items[0].Result)
	resumed, err = registry.ResumeHaltedWorkerUpgradeRollback(ctx, batch.ID, connectionID)
	require.NoError(t, err)
	require.False(t, resumed, "an authoritative stop must not be resurrected by retry")
	_, err = registry.db.ExecContext(ctx, `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
	require.NoError(t, err)
	laterGeneration, _ := newLaunchID()
	_, err = registry.db.ExecContext(ctx, `
		INSERT INTO worker_registry (
			connection_id, company_id, tenant_schema, database_url, pid, status,
			launch_id, desired_state, artifact_version, artifact_sha256
		) VALUES ($1::uuid, $2::uuid, 'tenant_abandon', '', 0, 'error',
			$3::uuid, 'running', 'source', $4)
	`, connectionID, companyID, laterGeneration, digest)
	require.NoError(t, err)
	laterBatch, err := registry.CreateWorkerUpgradeBatch(ctx, "later", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: companyID, TenantSchema: "tenant_abandon",
		ConnectionID: connectionID, SourceGeneration: laterGeneration,
		SourceArtifactVersion: "source", SourceArtifactSHA256: digest,
	}})
	require.NoError(t, err, "abandonment did not release active-batch serialization")
	_, _ = registry.db.ExecContext(ctx, `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, laterBatch.ID)
}

func TestRealPostgresAuthoritativeUnlinkAbandonsHaltedBatchAndIsIdempotent(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	ctx := context.Background()
	companyID, _ := newLaunchID()
	connectionID, _ := newLaunchID()
	generation, _ := newLaunchID()
	digest := "abababababababababababababababababababababababababababababababab"
	_, err = registry.db.ExecContext(ctx, `
		INSERT INTO worker_registry (
			connection_id, company_id, tenant_schema, database_url, pid, status,
			launch_id, desired_state, artifact_version, artifact_sha256
		) VALUES ($1::uuid, $2::uuid, 'tenant_unlink', '', 0, 'error',
			$3::uuid, 'running', 'source', $4)
	`, connectionID, companyID, generation, digest)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
	})
	batch, err := registry.CreateWorkerUpgradeBatch(ctx, "target", "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd", []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: companyID, TenantSchema: "tenant_unlink",
		ConnectionID: connectionID, SourceGeneration: generation,
		SourceArtifactVersion: "source", SourceArtifactSHA256: digest,
	}})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
	})
	halted, err := registry.HaltWorkerUpgrade(ctx, batch.ID, companyID, "tenant_unlink", connectionID, generation, WorkerUpgradePhaseStop, WorkerUpgradePhaseStop, "", "test halt")
	require.NoError(t, err)
	require.True(t, halted)
	updated, abandoned, err := registry.SetDesiredStateAndAbandonHaltedUpgrade(
		ctx, connectionID, companyID, "tenant_unlink", generation,
		DesiredStateUnlinking, "operator unlink",
	)
	require.NoError(t, err)
	require.True(t, updated)
	require.True(t, abandoned)
	updated, abandoned, err = registry.SetDesiredStateAndAbandonHaltedUpgrade(
		ctx, connectionID, companyID, "tenant_unlink", generation,
		DesiredStateUnlinking, "operator unlink redelivery",
	)
	require.NoError(t, err)
	require.True(t, updated)
	require.False(t, abandoned)
	record, err := registry.GetWorker(ctx, connectionID)
	require.NoError(t, err)
	require.Equal(t, DesiredStateUnlinking, record.DesiredState)
	status, err := registry.GetWorkerUpgradeBatch(ctx, batch.ID)
	require.NoError(t, err)
	require.Equal(t, "abandoned", status.Result)
	resumed, err := registry.ResumeHaltedWorkerUpgradeRollback(ctx, batch.ID, connectionID)
	require.NoError(t, err)
	require.False(t, resumed)
}

func TestRealPostgresBatchWideRollbackTerminalContract(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	ctx := context.Background()
	companyID, _ := newLaunchID()
	digest := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	intents := make([]WorkerUpgradeItemIntent, 0, 4)
	connectionIDs := make([]string, 0, 4)
	for position := 0; position < 4; position++ {
		connectionID, _ := newLaunchID()
		launchID, _ := newLaunchID()
		connectionIDs = append(connectionIDs, connectionID)
		_, err = registry.db.ExecContext(ctx, `
			INSERT INTO worker_registry (
				connection_id, company_id, tenant_schema, database_url, pid,
				status, launch_id, desired_state, artifact_version, artifact_sha256
			) VALUES ($1::uuid, $2::uuid, 'tenant_integration', '', 0,
				'connected', $3::uuid, 'running', 'v1', $4)
		`, connectionID, companyID, launchID, digest)
		require.NoError(t, err)
		intents = append(intents, WorkerUpgradeItemIntent{
			Position: position, CompanyID: companyID, TenantSchema: "tenant_integration",
			ConnectionID: connectionID, SourceGeneration: launchID,
			SourceArtifactVersion: "v1", SourceArtifactSHA256: digest,
		})
	}
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE company_id = $1::uuid`, companyID)
	})

	batch, err := registry.CreateWorkerUpgradeBatch(ctx, "v2", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", intents)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
	})
	for position := 0; position < 2; position++ {
		item := batch.Items[position]
		advanced, advanceErr := registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseStop, WorkerUpgradePhaseLaunch, "", "")
		require.NoError(t, advanceErr)
		require.True(t, advanced)
		targetGeneration, _ := newLaunchID()
		advanced, advanceErr = registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseLaunch, WorkerUpgradePhaseVerify, targetGeneration, "")
		require.NoError(t, advanceErr)
		require.True(t, advanced)
		_, advanceErr = registry.db.ExecContext(ctx, `
			UPDATE worker_registry SET launch_id = $1::uuid,
				artifact_version = 'v2', artifact_sha256 = $2,
				worker_uid = nextval('worker_os_identity_seq')
			WHERE connection_id = $3::uuid
		`, targetGeneration, batch.TargetArtifactSHA256, item.ConnectionID)
		require.NoError(t, advanceErr)
		record, getErr := registry.GetWorker(ctx, item.ConnectionID)
		require.NoError(t, getErr)
		completed, completeErr := registry.CompleteWorkerUpgradeItem(
			ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
			item.SourceGeneration, WorkerUpgradePhaseVerify, WorkerUpgradeLiveFence{
				LaunchID: record.LaunchID, ArtifactVersion: record.ArtifactVersion,
				ArtifactSHA256: record.ArtifactSHA256, WorkerUID: record.WorkerUID,
				WorkerGID: record.WorkerGID,
			},
		)
		require.NoError(t, completeErr)
		require.True(t, completed)
	}
	failed := batch.Items[2]
	advanced, err := registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, failed.CompanyID, failed.TenantSchema, failed.ConnectionID, failed.SourceGeneration, WorkerUpgradePhaseStop, WorkerUpgradePhaseLaunch, "", "")
	require.NoError(t, err)
	require.True(t, advanced)
	began, err := registry.BeginWorkerUpgradeRollback(ctx, batch.ID, failed.CompanyID, failed.TenantSchema, failed.ConnectionID, failed.SourceGeneration, WorkerUpgradePhaseLaunch, "", "integration target failure")
	require.NoError(t, err)
	require.True(t, began)

	rollback, err := registry.GetWorkerUpgradeBatch(ctx, batch.ID)
	require.NoError(t, err)
	require.Equal(t, WorkerUpgradePhaseRollback, rollback.Phase)
	for position, item := range rollback.Items {
		if position < 3 {
			require.Equal(t, WorkerUpgradePhaseRollback, item.Phase)
			require.Empty(t, item.Result)
			require.Nil(t, item.CompletedAt)
		} else {
			require.Equal(t, WorkerUpgradePhaseCanceled, item.Phase)
			require.Equal(t, WorkerUpgradeItemResultCanceledUntouched, item.Result)
			require.NotNil(t, item.CompletedAt)
		}
	}
	terminal, err := registry.CompleteWorkerUpgradeBatch(ctx, batch.ID, WorkerUpgradePhaseRollback, "rolled_back")
	require.NoError(t, err)
	require.False(t, terminal, "batch became terminal before every touched item was restored")
	for position := 2; position >= 0; position-- {
		item := rollback.Items[position]
		rollbackGeneration, launchErr := newLaunchID()
		require.NoError(t, launchErr)
		reserved, reserveErr := registry.ReserveWorkerUpgradeGeneration(
			ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
			item.SourceGeneration, WorkerUpgradePhaseRollback, "rollback_generation", rollbackGeneration,
		)
		require.NoError(t, reserveErr)
		require.True(t, reserved)
		_, updateErr := registry.db.ExecContext(ctx, `
			UPDATE worker_registry SET launch_id = $1::uuid,
				artifact_version = $2, artifact_sha256 = $3,
				worker_uid = nextval('worker_os_identity_seq'), desired_state = 'running'
			WHERE connection_id = $4::uuid
		`, rollbackGeneration, item.SourceArtifactVersion, item.SourceArtifactSHA256, item.ConnectionID)
		require.NoError(t, updateErr)
		record, getErr := registry.GetWorker(ctx, item.ConnectionID)
		require.NoError(t, getErr)
		fence := WorkerUpgradeLiveFence{
			LaunchID: record.LaunchID, ArtifactVersion: record.ArtifactVersion,
			ArtifactSHA256: record.ArtifactSHA256, WorkerUID: record.WorkerUID,
			WorkerGID: record.WorkerGID,
		}
		staleFence := fence
		staleFence.WorkerUID++
		staleFence.WorkerGID++
		completed, completeErr := registry.CompleteWorkerUpgradeItem(
			ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
			item.SourceGeneration, WorkerUpgradePhaseRollback, staleFence,
		)
		require.NoError(t, completeErr)
		require.False(t, completed, "rollback completion accepted stale credentials")
		completed, completeErr = registry.CompleteWorkerUpgradeItem(
			ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
			item.SourceGeneration, WorkerUpgradePhaseRollback, fence,
		)
		require.NoError(t, completeErr)
		require.True(t, completed)
	}
	terminal, err = registry.CompleteWorkerUpgradeBatch(ctx, batch.ID, WorkerUpgradePhaseRollback, "rolled_back")
	require.NoError(t, err)
	require.True(t, terminal)
	terminalBatch, err := registry.GetWorkerUpgradeBatch(ctx, batch.ID)
	require.NoError(t, err)
	require.Equal(t, "rolled_back", terminalBatch.Result)
	require.NotNil(t, terminalBatch.CompletedAt)
	for position, item := range terminalBatch.Items {
		if position < 3 {
			require.Equal(t, WorkerUpgradeItemResultRollbackComplete, item.Result)
		}
	}
}

func TestRealPostgresVerifyRefreshPersistenceFailureKeepsRecoveryGenerationRetryable(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	ctx := context.Background()
	companyID, _ := newLaunchID()
	connectionID, _ := newLaunchID()
	sourceGeneration, _ := newLaunchID()
	targetGeneration, _ := newLaunchID()
	recoveryGeneration, _ := newLaunchID()
	sourceDigest := "9191919191919191919191919191919191919191919191919191919191919191"
	targetDigest := "9292929292929292929292929292929292929292929292929292929292929292"
	_, err = registry.db.ExecContext(ctx, `
		INSERT INTO worker_registry (
			connection_id, company_id, tenant_schema, database_url, pid, status,
			launch_id, desired_state, artifact_version, artifact_sha256
		) VALUES ($1::uuid, $2::uuid, 'tenant_refresh_retry', '', 0, 'error',
			$3::uuid, 'running', 'source', $4)
	`, connectionID, companyID, sourceGeneration, sourceDigest)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
	})
	batch, err := registry.CreateWorkerUpgradeBatch(ctx, "target", targetDigest, []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: companyID, TenantSchema: "tenant_refresh_retry",
		ConnectionID: connectionID, SourceGeneration: sourceGeneration,
		SourceArtifactVersion: "source", SourceArtifactSHA256: sourceDigest,
	}})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
	})
	item := batch.Items[0]
	advanced, err := registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseStop, WorkerUpgradePhaseLaunch, "", "")
	require.NoError(t, err)
	require.True(t, advanced)
	advanced, err = registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseLaunch, WorkerUpgradePhaseVerify, targetGeneration, "")
	require.NoError(t, err)
	require.True(t, advanced)
	advanced, err = registry.BeginWorkerUpgradeVerifyRefresh(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, targetGeneration)
	require.NoError(t, err)
	require.True(t, advanced)
	advanced, err = registry.ReserveWorkerUpgradeGeneration(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseRecovery, "recovery_generation", recoveryGeneration)
	require.NoError(t, err)
	require.True(t, advanced)
	_, err = registry.db.ExecContext(ctx, `
		UPDATE worker_registry SET launch_id = $1::uuid, artifact_version = 'target',
			artifact_sha256 = $2, worker_uid = nextval('worker_os_identity_seq')
		WHERE connection_id = $3::uuid
	`, recoveryGeneration, targetDigest, connectionID)
	require.NoError(t, err)

	triggerName := "fail_refresh_" + strings.ReplaceAll(connectionID, "-", "")
	functionName := triggerName + "_fn"
	_, err = registry.db.ExecContext(ctx, fmt.Sprintf(`
		CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF OLD.id = %s::uuid AND NEW.phase = 'verify' THEN
				RAISE EXCEPTION 'injected verify-refresh persistence failure';
			END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER %s BEFORE UPDATE ON worker_upgrade_items
		FOR EACH ROW EXECUTE FUNCTION %s()
	`, pq.QuoteIdentifier(functionName), pq.QuoteLiteral(item.ID), pq.QuoteIdentifier(triggerName), pq.QuoteIdentifier(functionName)))
	require.NoError(t, err)
	dropTrigger := func() {
		_, _ = registry.db.ExecContext(context.Background(), fmt.Sprintf(
			`DROP TRIGGER IF EXISTS %s ON worker_upgrade_items; DROP FUNCTION IF EXISTS %s()`,
			pq.QuoteIdentifier(triggerName), pq.QuoteIdentifier(functionName),
		))
	}
	t.Cleanup(dropTrigger)
	advanced, err = registry.CompleteWorkerUpgradeVerifyRefresh(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, targetGeneration, recoveryGeneration)
	require.ErrorContains(t, err, "injected verify-refresh persistence failure")
	require.False(t, advanced)
	dropTrigger()

	recovered, err := registry.GetWorkerUpgradeBatch(ctx, batch.ID)
	require.NoError(t, err)
	require.Equal(t, WorkerUpgradePhaseRecovery, recovered.Items[0].Phase)
	require.Equal(t, recoveryGeneration, recovered.Items[0].RecoveryGeneration)
	halted, err := registry.HaltWorkerUpgrade(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseRecovery, WorkerUpgradePhaseStop, targetGeneration, "refresh completion failed")
	require.NoError(t, err)
	require.True(t, halted)

	// A replacement orchestrator must accept only the exact claimed recovery
	// generation as the rollback predecessor.
	restarted, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	defer restarted.Close()
	newerGeneration, _ := newLaunchID()
	_, err = restarted.db.ExecContext(ctx, `
		UPDATE worker_registry SET launch_id = $1::uuid
		WHERE connection_id = $2::uuid
	`, newerGeneration, connectionID)
	require.NoError(t, err)
	resumed, err := restarted.ResumeHaltedWorkerUpgradeRollback(ctx, batch.ID, connectionID)
	require.NoError(t, err)
	require.False(t, resumed, "retry accepted an unreserved newer generation")
	_, err = restarted.db.ExecContext(ctx, `
		UPDATE worker_registry SET launch_id = $1::uuid
		WHERE connection_id = $2::uuid
	`, recoveryGeneration, connectionID)
	require.NoError(t, err)
	resumed, err = restarted.ResumeHaltedWorkerUpgradeRollback(ctx, batch.ID, connectionID)
	require.NoError(t, err)
	require.True(t, resumed)
	retried, err := restarted.GetWorkerUpgradeBatch(ctx, batch.ID)
	require.NoError(t, err)
	require.Equal(t, WorkerUpgradePhaseRollback, retried.Items[0].Phase)
	record, err := restarted.GetWorker(ctx, connectionID)
	require.NoError(t, err)
	fenced, err := restarted.FenceWorkerUpgradeOwnedLaunch(ctx, batch.ID, companyID, item.TenantSchema, connectionID, sourceGeneration, WorkerUpgradePhaseRollback, WorkerUpgradeLiveFence{
		LaunchID: recoveryGeneration, ArtifactVersion: "target", ArtifactSHA256: targetDigest,
		WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID,
	})
	require.NoError(t, err)
	require.True(t, fenced)
}

func TestRealPostgresLegacyArtifactNormalizationGatesRolloutAndRejectsLiveMismatch(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	ctx := context.Background()
	companyID, _ := newLaunchID()
	connectionID, _ := newLaunchID()
	generation, _ := newLaunchID()
	digest := "9393939393939393939393939393939393939393939393939393939393939393"
	_, err = registry.db.ExecContext(ctx, `
		INSERT INTO worker_registry (
			connection_id, company_id, tenant_schema, database_url, pid, status,
			launch_id, desired_state, artifact_version, artifact_sha256,
			artifact_normalized
		) VALUES ($1::uuid, $2::uuid, 'tenant_legacy_boundary', '', $3, 'connected',
			$4::uuid, 'running', 'embedded', '', false)
	`, connectionID, companyID, os.Getpid(), generation)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
	})
	_, err = registry.CreateWorkerUpgradeBatch(ctx, "target", strings.Repeat("9", 64), []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: companyID, TenantSchema: "tenant_legacy_boundary",
		ConnectionID: connectionID, SourceGeneration: generation,
		SourceArtifactVersion: "embedded", SourceArtifactSHA256: "",
	}})
	require.ErrorIs(t, err, ErrWorkerArtifactNormalization)

	root := t.TempDir()
	artifactDir := filepath.Join(root, "bootstrap")
	require.NoError(t, os.MkdirAll(artifactDir, 0o755))
	binary := filepath.Join(artifactDir, "whatsapp-worker")
	require.NoError(t, os.WriteFile(binary, []byte("bootstrap-live-row-test"), 0o755))
	actualDigest, err := sha256File(binary)
	require.NoError(t, err)
	manager := New(Config{
		ArtifactRoot: root, WhatsAppBinaryPath: binary,
		DefaultArtifactVersion: "bootstrap", DefaultArtifactSHA256: actualDigest,
	})
	manager.ctx = context.Background()
	manager.registry = registry
	err = manager.recoverOrphanedWorkers(ctx)
	require.ErrorContains(t, err, "legacy worker")
	var normalized bool
	var persistedDigest string
	require.NoError(t, registry.db.QueryRowContext(ctx, `
		SELECT artifact_normalized, artifact_sha256 FROM worker_registry
		WHERE connection_id = $1::uuid
	`, connectionID).Scan(&normalized, &persistedDigest))
	require.False(t, normalized)
	require.Empty(t, persistedDigest, "a mismatched live PID must remain unnormalized")

	_, err = registry.db.ExecContext(ctx, `UPDATE worker_registry SET pid = 0 WHERE connection_id = $1::uuid`, connectionID)
	require.NoError(t, err)
	normalizedNow, err := registry.NormalizeLegacyWorkerArtifact(ctx, connectionID, companyID, "tenant_legacy_boundary", generation, "bootstrap", digest)
	require.NoError(t, err)
	require.True(t, normalizedNow)
	batch, err := registry.CreateWorkerUpgradeBatch(ctx, "target", strings.Repeat("8", 64), []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: companyID, TenantSchema: "tenant_legacy_boundary",
		ConnectionID: connectionID, SourceGeneration: generation,
		SourceArtifactVersion: "bootstrap", SourceArtifactSHA256: digest,
	}})
	require.NoError(t, err)
	_, _ = registry.db.ExecContext(ctx, `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
}

func TestRealPostgresPreservedRolloutStopDeactivatesPIDBeforeEmptyMapLifecycle(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	for _, operation := range []string{"stop", "unlink"} {
		t.Run(operation, func(t *testing.T) {
			if operation == "unlink" && runtime.GOOS != "linux" {
				t.Skip("durable unlink process isolation requires Linux")
			}
			registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
			require.NoError(t, err)
			t.Cleanup(func() { _ = registry.Close() })
			ctx := context.Background()
			companyID, _ := newLaunchID()
			connectionID, _ := newLaunchID()
			generation, _ := newLaunchID()
			root, err := os.MkdirTemp("/tmp", "worker-empty-map-")
			require.NoError(t, err)
			t.Cleanup(func() { _ = os.RemoveAll(root) })
			require.NoError(t, os.Chmod(root, 0o755))
			digest := writeArtifact(t, root, "bootstrap", []byte("#!/bin/sh\nexit 0\n"))

			cmd := exec.Command("/bin/sh", "-c", "trap 'exit 0' TERM; while :; do sleep 0.05; done")
			cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
			require.NoError(t, cmd.Start())
			t.Cleanup(func() { _ = cmd.Process.Kill(); _, _ = cmd.Process.Wait() })
			done := make(chan struct{})
			go func() { _ = cmd.Wait(); close(done) }()

			_, err = registry.db.ExecContext(ctx, `
				INSERT INTO worker_registry (
					connection_id, company_id, tenant_schema, database_url, pid, status,
					launch_id, desired_state, artifact_version, artifact_sha256
				) VALUES ($1::uuid, $2::uuid, $3, '', $4, 'connected',
					$5::uuid, 'running', 'bootstrap', $6)
			`, connectionID, companyID, "tenant_"+strings.ReplaceAll(companyID, "-", "_"), cmd.Process.Pid, generation, digest)
			require.NoError(t, err)
			t.Cleanup(func() {
				_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
			})
			record, err := registry.GetWorker(ctx, connectionID)
			require.NoError(t, err)
			batch, err := registry.CreateWorkerUpgradeBatch(ctx, "target", strings.Repeat("9", 64), []WorkerUpgradeItemIntent{{
				Position: 0, CompanyID: companyID, TenantSchema: record.TenantSchema,
				ConnectionID: connectionID, SourceGeneration: generation,
				SourceArtifactVersion: "bootstrap", SourceArtifactSHA256: digest,
			}})
			require.NoError(t, err)
			t.Cleanup(func() {
				_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
			})
			halted, err := registry.HaltWorkerUpgrade(ctx, batch.ID, companyID, record.TenantSchema, connectionID, generation, WorkerUpgradePhaseStop, WorkerUpgradePhaseStop, "", "test rollback halt")
			require.NoError(t, err)
			require.True(t, halted)

			manager := New(Config{
				ArtifactRoot: root, WhatsAppBinaryPath: filepath.Join(root, "bootstrap", "whatsapp-worker"),
				DefaultArtifactVersion: "bootstrap", DefaultArtifactSHA256: digest,
				WorkerDatabaseURL: "postgresql://wateaminbox_worker:WorkerIntegration_0123456789abcdef@postgres/wateaminbox",
				WorkerNATSURL:     "nats://worker:WorkerIntegration_0123456789abcdef@nats:4222",
			})
			manager.ctx = ctx
			manager.registry = registry
			manager.workers[connectionID] = &WorkerProcess{
				ID: connectionID, ConnectionID: connectionID, CompanyID: companyID,
				TenantSchema: record.TenantSchema, LaunchID: generation,
				DesiredState: DesiredStateRunning, ArtifactVersion: "bootstrap",
				ArtifactSHA256: digest, BinaryPath: filepath.Join(root, "bootstrap", "whatsapp-worker"),
				WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID,
				PID: cmd.Process.Pid, Status: types.StatusConnected, cmd: cmd, done: done,
			}
			require.NoError(t, manager.stopWorkerInternal(ctx, companyID, connectionID, "rollback stop", syscall.SIGTERM, true))
			_, exists := manager.GetWorkerStatus(connectionID)
			require.False(t, exists, "confirmed rollout stop must leave the volatile map empty")
			record, err = registry.GetWorker(ctx, connectionID)
			require.NoError(t, err)
			require.NotNil(t, record)
			require.Zero(t, record.PID)
			require.Equal(t, generation, record.LaunchID, "deactivation must retain the reserved generation")
			require.Equal(t, WorkerStatusRecovering, record.Status)

			switch operation {
			case "stop":
				require.NoError(t, manager.StopWorker(ctx, companyID, connectionID, "operator stop after halt"))
			case "unlink":
				require.NoError(t, manager.UnlinkWorker(ctx, companyID, connectionID, record.TenantSchema, manager.config.WorkerDatabaseURL, "operator unlink after halt"))
				manager.wg.Wait()
			}
			record, err = registry.GetWorker(ctx, connectionID)
			require.NoError(t, err)
			require.Nil(t, record)
			status, err := registry.GetWorkerUpgradeBatch(ctx, batch.ID)
			require.NoError(t, err)
			require.Equal(t, WorkerUpgradePhaseAbandoned, status.Phase)
			require.Equal(t, WorkerUpgradeItemResultAbandonedExternal, status.Items[0].Result)
		})
	}
}

func TestRealPostgresEmptyMapStopRollsBackFailedAbandonmentThenRedelivers(t *testing.T) {
	if os.Getenv("RUN_DB_INTEGRATION") != "1" {
		t.Skip("set RUN_DB_INTEGRATION=1")
	}
	registry, err := NewWorkerRegistry(os.Getenv("DATABASE_URL"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	ctx := context.Background()
	companyID, _ := newLaunchID()
	connectionID, _ := newLaunchID()
	generation, _ := newLaunchID()
	root := t.TempDir()
	digest := writeArtifact(t, root, "bootstrap", []byte("#!/bin/sh\nexit 0\n"))
	_, err = registry.db.ExecContext(ctx, `
		INSERT INTO worker_registry (
			connection_id, company_id, tenant_schema, database_url, pid, status,
			launch_id, desired_state, artifact_version, artifact_sha256
		) VALUES ($1::uuid, $2::uuid, 'tenant_empty_map', '', 0, 'error',
			$3::uuid, 'running', 'bootstrap', $4)
	`, connectionID, companyID, generation, digest)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_registry WHERE connection_id = $1::uuid`, connectionID)
	})
	batch, err := registry.CreateWorkerUpgradeBatch(ctx, "target", strings.Repeat("7", 64), []WorkerUpgradeItemIntent{{
		Position: 0, CompanyID: companyID, TenantSchema: "tenant_empty_map",
		ConnectionID: connectionID, SourceGeneration: generation,
		SourceArtifactVersion: "bootstrap", SourceArtifactSHA256: digest,
	}})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = registry.db.ExecContext(context.Background(), `DELETE FROM worker_upgrade_batches WHERE id = $1::uuid`, batch.ID)
	})
	halted, err := registry.HaltWorkerUpgrade(ctx, batch.ID, companyID, "tenant_empty_map", connectionID, generation, WorkerUpgradePhaseStop, WorkerUpgradePhaseStop, "", "test halt")
	require.NoError(t, err)
	require.True(t, halted)

	triggerName := "fail_abandon_" + strings.ReplaceAll(connectionID, "-", "")
	functionName := triggerName + "_fn"
	_, err = registry.db.ExecContext(ctx, fmt.Sprintf(`
		CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF OLD.id = %s::uuid AND NEW.phase = 'abandoned' THEN
				RAISE EXCEPTION 'injected abandonment persistence failure';
			END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER %s BEFORE UPDATE ON worker_upgrade_batches
		FOR EACH ROW EXECUTE FUNCTION %s()
	`, pq.QuoteIdentifier(functionName), pq.QuoteLiteral(batch.ID), pq.QuoteIdentifier(triggerName), pq.QuoteIdentifier(functionName)))
	require.NoError(t, err)
	dropTrigger := func() {
		_, _ = registry.db.ExecContext(context.Background(), fmt.Sprintf(
			`DROP TRIGGER IF EXISTS %s ON worker_upgrade_batches; DROP FUNCTION IF EXISTS %s()`,
			pq.QuoteIdentifier(triggerName), pq.QuoteIdentifier(functionName),
		))
	}
	t.Cleanup(dropTrigger)

	manager := New(Config{ArtifactRoot: root, WhatsAppBinaryPath: filepath.Join(root, "bootstrap", "whatsapp-worker")})
	manager.ctx = context.Background()
	manager.registry = registry
	err = manager.StopWorker(ctx, companyID, connectionID, "operator stop")
	require.ErrorContains(t, err, "injected abandonment persistence failure")
	record, err := registry.GetWorker(ctx, connectionID)
	require.NoError(t, err)
	require.Equal(t, DesiredStateRunning, record.DesiredState, "registry intent escaped the failed transaction")
	status, err := registry.GetWorkerUpgradeBatch(ctx, batch.ID)
	require.NoError(t, err)
	require.Equal(t, WorkerUpgradePhaseHalted, status.Phase)
	require.Nil(t, status.CompletedAt)
	dropTrigger()

	// Simulate command redelivery to a replacement manager with an empty map.
	restarted := New(Config{ArtifactRoot: root, WhatsAppBinaryPath: filepath.Join(root, "bootstrap", "whatsapp-worker")})
	restarted.ctx = context.Background()
	restarted.registry = registry
	require.NoError(t, restarted.StopWorker(ctx, companyID, connectionID, "operator stop redelivery"))
	record, err = registry.GetWorker(ctx, connectionID)
	require.NoError(t, err)
	require.Nil(t, record)
	status, err = registry.GetWorkerUpgradeBatch(ctx, batch.ID)
	require.NoError(t, err)
	require.Equal(t, WorkerUpgradePhaseAbandoned, status.Phase)
	require.Equal(t, WorkerUpgradeItemResultAbandonedExternal, status.Items[0].Result)
}
