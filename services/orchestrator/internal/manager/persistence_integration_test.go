package manager

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
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
		completed, completeErr := registry.CompleteWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseVerify)
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
		completed, completeErr := registry.CompleteWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseRollback)
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
