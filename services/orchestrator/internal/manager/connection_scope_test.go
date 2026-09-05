package manager

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

func TestConnectionScopeParsing(t *testing.T) {
	unset, err := ParseConnectionScope("", false)
	require.NoError(t, err)
	require.Nil(t, unset)
	closed, err := ParseConnectionScope("", true)
	require.NoError(t, err)
	require.NotNil(t, closed)
	require.Empty(t, closed)
	company := "11111111-1111-4111-8111-111111111111"
	connection := "22222222-2222-4222-8222-222222222222"
	scope, err := ParseConnectionScope(company+"/"+connection, true)
	require.NoError(t, err)
	m := New(Config{ConnectionScope: scope})
	require.True(t, m.connectionInScope(company, connection))
	require.False(t, m.connectionInScope(connection, connection), "same connection in another company is denied")
	require.Equal(t, -1, m.advertisedCapacity())
	require.Equal(t, 15, New(Config{MaxWorkers: 15}).advertisedCapacity())
	for _, invalid := range []string{"*", "none", company, company + "/*", company + "/" + connection + ","} {
		_, err := ParseConnectionScope(invalid, true)
		require.Error(t, err)
	}
}

func TestScopedRuntimeDoesNotAdoptUnassignedWorkers(t *testing.T) {
	registry, mock := newMockRegistry(t)
	m := New(Config{ConnectionScope: map[string]bool{}, NodeID: "test-node-1"})
	m.registry = registry
	// There must be no unassigned-row UPDATE before this read.
	mock.ExpectQuery("FROM worker_registry WHERE node_id").WithArgs("test-node-1").
		WillReturnRows(sqlmock.NewRows(workerRecordColumns))
	require.NoError(t, m.recoverOrphanedWorkers(context.Background()))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestScopedTakeoverLeavesCustomerOwnershipUntouched(t *testing.T) {
	registry, mock := newMockRegistry(t)
	m := New(Config{ConnectionScope: map[string]bool{"test-company/test-connection": true}, NodeID: "test-node-1", AutoRestartEnabled: true})
	m.registry = registry
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_registry w")).
		WithArgs("test-node-1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(workerRecordColumns).AddRow(
			"customer-connection", "customer-company", "tenant_customer", "", 999999, WorkerStatusRecovering,
			now, now, 0, "dead-launch", DesiredStateRunning, "v1",
			"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			100000, 100000, "production-node"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_batches WHERE completed_at IS NULL")).WillReturnError(errNoActiveBatch)
	m.takeOverFailedNodes(context.Background())
	require.Zero(t, m.WorkerCount())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestClosedScopeBlocksLifecycleBeforeDatabaseOrProcessEffects(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	h.manager.config.ConnectionScope = map[string]bool{}
	ctx := context.Background()
	payload, err := json.Marshal(types.SpawnWorkerCommand{
		Type: types.CommandSpawn, CompanyID: "company", ConnectionID: "connection",
	})
	require.NoError(t, err)
	require.ErrorIs(t, h.handleSpawnCommand(ctx, payload, 0), ErrConnectionOutsideScope)
	require.ErrorIs(t, h.manager.SpawnWorker(ctx, "company", "connection", "tenant", ""), ErrConnectionOutsideScope)
	require.ErrorIs(t, h.manager.StopWorker(ctx, "company", "connection", "stop"), ErrConnectionOutsideScope)
	require.ErrorIs(t, h.manager.UnlinkWorker(ctx, "company", "connection", "tenant", "", "unlink"), ErrConnectionOutsideScope)
	// Rollout and recovery ultimately use this launch path too. The invalid
	// executable must never be reached, nor may a launch be reserved in SQL.
	require.ErrorIs(t, h.manager.spawnWorkerArtifactWithLaunch(ctx, "company", "connection", "tenant", "", false, 0, WorkerArtifact{BinaryPath: "/does-not-exist"}, ""), ErrConnectionOutsideScope)
	h.manager.takeOverFailedNodes(ctx)
	require.Empty(t, *forwarded)
	require.Zero(t, h.manager.WorkerCount())
	require.NoError(t, mock.ExpectationsWereMet())
}
