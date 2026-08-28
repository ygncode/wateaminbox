package manager

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// errNoActiveBatch makes the active-rollout probe report "no batch".
var errNoActiveBatch = sql.ErrNoRows

// Self-fencing runs exactly once, stops the manager, and then ends the
// process through the fatal seam. Losing the lease twice (or racing an
// operator signal) must not fence twice.
func TestSelfFenceRunsOnceAndEndsProcess(t *testing.T) {
	m := New(Config{NodeID: "test-node-1"})
	m.ctx, m.cancel = context.WithCancel(context.Background())

	var mu sync.Mutex
	var reasons []string
	m.fatal = func(reason string) {
		mu.Lock()
		reasons = append(reasons, reason)
		mu.Unlock()
	}

	m.selfFence("lease lost")
	m.selfFence("lease lost again")

	mu.Lock()
	defer mu.Unlock()
	require.Equal(t, []string{"lease lost"}, reasons)
}

// An authoritative renewal failure (lease expired or taken) fences; the
// wall-clock guard fences even when the database comes back after a stall.
func TestNodeLeaseLossTriggersSelfFence(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE orchestrator_nodes")).
		WithArgs("test-node-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0)) // lease no longer held

	m := New(Config{NodeID: "test-node-1", NodeLeaseDuration: 4 * time.Second})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	m.registry = registry

	fenced := make(chan string, 1)
	m.fatal = func(reason string) { fenced <- reason }

	m.wg.Add(1)
	go m.runNodeLease(m.ctx)
	t.Cleanup(m.cancel)

	select {
	case reason := <-fenced:
		assert.Contains(t, reason, "lease")
	case <-time.After(5 * time.Second):
		t.Fatal("lease loss did not trigger self-fencing")
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

// A PostgreSQL request can remain stuck on a half-open connection without
// returning an error. The absolute watchdog must fence at the lease deadline
// independently of that in-flight renewal; otherwise a peer can take over while
// this node's workers continue running.
func TestNodeLeaseBlockedRenewalStillFencesAtDeadline(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE orchestrator_nodes")).
		WithArgs("test-node-1", sqlmock.AnyArg()).
		WillDelayFor(5 * time.Second).
		WillReturnResult(sqlmock.NewResult(0, 1))

	leaseDuration := 1500 * time.Millisecond
	m := New(Config{NodeID: "test-node-1", NodeLeaseDuration: leaseDuration})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	m.registry = registry

	fenced := make(chan string, 1)
	m.fatal = func(reason string) { fenced <- reason }

	started := time.Now()
	m.wg.Add(1)
	go m.runNodeLease(m.ctx)
	t.Cleanup(m.cancel)

	select {
	case reason := <-fenced:
		assert.Contains(t, reason, "lease")
		assert.Less(t, time.Since(started), 3*time.Second,
			"fencing must not wait for the blocked five-second renewal")
	case <-time.After(3 * time.Second):
		t.Fatal("blocked lease renewal prevented deadline self-fencing")
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

// A node that has begun shutdown must not transfer durable ownership to
// itself: it will not launch the adopted worker, and peers would have to wait
// through another lease-expiry cycle before recovering the stranded row.
func TestTakeOverFailedNodesSkipsDuringShutdown(t *testing.T) {
	registry, mock := newMockRegistry(t)
	m := New(Config{NodeID: "test-node-1", AutoRestartEnabled: true})
	m.registry = registry
	m.shuttingDown = true

	m.takeOverFailedNodes(context.Background())

	require.NoError(t, mock.ExpectationsWereMet(), "shutdown must return before any registry query")
}

// Shutdown waits for a normal in-flight takeover to finish before taking its
// worker snapshot, so a transferred row cannot be inserted immediately after
// the snapshot and become stranded on the stopping node.
func TestStopWaitsForInFlightTakeover(t *testing.T) {
	m := New(Config{})
	m.ctx, m.cancel = context.WithCancel(context.Background())

	m.takeoverMu.RLock() // model the CAS + local insertion critical section
	locked := true
	defer func() {
		if locked {
			m.takeoverMu.RUnlock()
		}
	}()

	stopCtx, cancelStop := context.WithTimeout(context.Background(), time.Second)
	defer cancelStop()
	done := make(chan error, 1)
	go func() { done <- m.Stop(stopCtx) }()

	require.Eventually(t, func() bool {
		m.mu.RLock()
		defer m.mu.RUnlock()
		return m.shuttingDown
	}, 500*time.Millisecond, 10*time.Millisecond)
	select {
	case err := <-done:
		require.Failf(t, "shutdown returned before takeover finished", "error: %v", err)
	default:
	}

	m.takeoverMu.RUnlock()
	locked = false
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("shutdown did not continue after takeover finished")
	}
}

// Takeover adopts a failed node's running connection: the ownership CAS moves
// the row here and the connection re-enters the ordinary delayed-restart path.
func TestTakeOverFailedNodesFlow(t *testing.T) {
	registry, mock := newMockRegistry(t)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_registry w")).
		WithArgs("test-node-1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(workerRecordColumns).AddRow(
			"connection", "company", "tenant_company", "", 999999, WorkerStatusRecovering,
			now, now, 0, "dead-launch", DesiredStateRunning, "v1",
			"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			100000, 100000, "test-node-2",
		))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_batches WHERE completed_at IS NULL")).
		WillReturnError(errNoActiveBatch)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry w SET node_id = $1")).
		WithArgs("test-node-1", "connection", "test-node-2", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	m := New(Config{
		NodeID:             "test-node-1",
		AutoRestartEnabled: true,
		// Keep the scheduled respawn asleep past the end of the test.
		AutoRestartBackoff: time.Hour,
		WorkerDatabaseURL:  "postgres://restricted",
	})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	t.Cleanup(m.cancel)
	m.registry = registry

	m.takeOverFailedNodes(context.Background())

	adopted, exists := m.GetWorkerStatus("connection")
	require.True(t, exists, "taken-over connection must be tracked locally")
	assert.Equal(t, "dead-launch", adopted.LaunchID)
	assert.Equal(t, types.StatusError, adopted.Status)
	assert.Equal(t, DesiredStateRunning, adopted.DesiredState)
	// The durable artifact identity must survive takeover, or the respawn
	// would silently rewrite the row to this node's default artifact.
	assert.Equal(t, "v1", adopted.ArtifactVersion)
	assert.Equal(t, "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", adopted.ArtifactSHA256)
	assert.Equal(t, 100000, adopted.WorkerUID)
	assert.Equal(t, 100000, adopted.WorkerGID)
	require.NoError(t, mock.ExpectationsWereMet())
}

// A timed-out takeover UPDATE can commit before the client receives its error.
// The fresh ownership read must recover that ambiguous success into local state
// rather than stranding the row on this node.
func TestTakeOverFailedNodesResolvesAmbiguousCommittedCAS(t *testing.T) {
	registry, mock := newMockRegistry(t)
	now := time.Now()
	candidate := sqlmock.NewRows(workerRecordColumns).AddRow(
		"connection", "company", "tenant_company", "", 999999, WorkerStatusRecovering,
		now, now, 0, "dead-launch", DesiredStateRunning, "v1",
		"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		100000, 100000, "test-node-2",
	)
	owned := sqlmock.NewRows(workerRecordColumns).AddRow(
		"connection", "company", "tenant_company", "", 0, WorkerStatusRecovering,
		now, now, 0, "dead-launch", DesiredStateRunning, "v1",
		"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		100000, 100000, "test-node-1",
	)
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_registry w")).
		WithArgs("test-node-1", sqlmock.AnyArg()).
		WillReturnRows(candidate)
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_batches WHERE completed_at IS NULL")).
		WillReturnError(errNoActiveBatch)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry w SET node_id = $1")).
		WithArgs("test-node-1", "connection", "test-node-2", sqlmock.AnyArg()).
		WillReturnError(errors.New("ambiguous timeout"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_registry WHERE connection_id = $1")).
		WithArgs("connection").
		WillReturnRows(owned)

	m := New(Config{
		NodeID:             "test-node-1",
		AutoRestartEnabled: true,
		AutoRestartBackoff: time.Hour,
		WorkerDatabaseURL:  "postgres://restricted",
	})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	t.Cleanup(m.cancel)
	m.registry = registry

	m.takeOverFailedNodes(context.Background())

	adopted, exists := m.GetWorkerStatus("connection")
	require.True(t, exists, "an ambiguously committed takeover must be tracked locally")
	assert.Equal(t, "test-node-1", registry.NodeID())
	assert.Equal(t, "dead-launch", adopted.LaunchID)
	require.NoError(t, mock.ExpectationsWereMet())
}

// A takeover CAS that reports no transfer (the owner came back and renewed,
// or a sibling node won) must leave no local state behind.
func TestTakeOverFailedNodesRespectsLostCAS(t *testing.T) {
	registry, mock := newMockRegistry(t)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_registry w")).
		WithArgs("test-node-1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(workerRecordColumns).AddRow(
			"connection", "company", "tenant_company", "", 999999, WorkerStatusRecovering,
			now, now, 0, "dead-launch", DesiredStateRunning, "v1",
			"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			100000, 100000, "test-node-2",
		))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_batches WHERE completed_at IS NULL")).
		WillReturnError(errNoActiveBatch)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry w SET node_id = $1")).
		WithArgs("test-node-1", "connection", "test-node-2", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))

	m := New(Config{NodeID: "test-node-1", AutoRestartEnabled: true, AutoRestartBackoff: time.Hour})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	t.Cleanup(m.cancel)
	m.registry = registry

	m.takeOverFailedNodes(context.Background())

	_, exists := m.GetWorkerStatus("connection")
	require.False(t, exists, "a lost takeover CAS must not track the connection")
	require.NoError(t, mock.ExpectationsWereMet())
}

// A connection inside an unfinished rollout item belongs to the durable
// stop-first state machine and is never adopted by crash takeover.
func TestTakeOverFailedNodesLeavesRolloutOwnedConnections(t *testing.T) {
	registry, mock := newMockRegistry(t)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_registry w")).
		WithArgs("test-node-1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(workerRecordColumns).AddRow(
			"connection", "company", "tenant_company", "", 999999, WorkerStatusRecovering,
			now, now, 0, "dead-launch", DesiredStateRunning, "v1",
			"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			100000, 100000, "test-node-2",
		))
	batchColumns := []string{
		"id", "target_artifact_version", "target_artifact_sha256", "phase",
		"result", "last_error", "created_at", "updated_at", "completed_at",
	}
	itemColumns := []string{
		"id", "batch_id", "position", "company_id", "tenant_schema", "connection_id",
		"source_generation", "source_artifact_version", "source_artifact_sha256",
		"target_generation", "recovery_generation", "rollback_generation",
		"phase", "result", "last_error", "created_at", "updated_at", "completed_at",
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_batches WHERE completed_at IS NULL")).
		WillReturnRows(sqlmock.NewRows(batchColumns).AddRow(
			"batch", "v2", "target-digest", WorkerUpgradePhaseStop, "", "", now, now, nil,
		))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_items WHERE batch_id = $1::uuid ORDER BY position")).
		WithArgs("batch").
		WillReturnRows(sqlmock.NewRows(itemColumns).AddRow(
			"item", "batch", 0, "company", "tenant_company", "connection", "dead-launch",
			"v1", "source-digest", "", "", "", WorkerUpgradePhaseStop, "", "", now, now, nil,
		))

	m := New(Config{NodeID: "test-node-1", AutoRestartEnabled: true, AutoRestartBackoff: time.Hour})
	m.ctx, m.cancel = context.WithCancel(context.Background())
	t.Cleanup(m.cancel)
	m.registry = registry

	m.takeOverFailedNodes(context.Background())

	_, exists := m.GetWorkerStatus("connection")
	require.False(t, exists, "rollout-owned connections must not be taken over")
	require.NoError(t, mock.ExpectationsWereMet())
}

// The fleet-wide connection limit is checked in the same transaction as the
// claim, behind the advisory lock, and refuses a brand-new connection when
// the fleet is full.
func TestClaimWorkerLaunchEnforcesFleetLimitAtomically(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	registry := &WorkerRegistry{db: db, nodeID: "test-node-1", fleetMaxConnections: 2}

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SELECT pg_advisory_xact_lock($1)")).
		WithArgs(fleetCapacityAdvisoryLockID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS (")).
		WithArgs("connection").
		WillReturnRows(sqlmock.NewRows([]string{"exists", "count"}).AddRow(false, 2))
	mock.ExpectRollback()

	worker := &WorkerProcess{
		ConnectionID: "connection", CompanyID: "company", TenantSchema: "tenant_company",
		LaunchID: "launch", DesiredState: DesiredStateRunning, Status: "starting",
		ArtifactVersion: "v1", ArtifactSHA256: "digest",
	}
	err = registry.ClaimWorkerLaunch(context.Background(), worker, "")
	require.ErrorIs(t, err, ErrFleetConnectionLimit)
	require.NoError(t, mock.ExpectationsWereMet())
}

// Below the limit the claim proceeds and commits inside the same transaction.
func TestClaimWorkerLaunchAdmitsBelowFleetLimit(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	registry := &WorkerRegistry{db: db, nodeID: "test-node-1", fleetMaxConnections: 2}

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SELECT pg_advisory_xact_lock($1)")).
		WithArgs(fleetCapacityAdvisoryLockID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS (")).
		WithArgs("connection").
		WillReturnRows(sqlmock.NewRows([]string{"exists", "count"}).AddRow(false, 1))
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO worker_registry")).
		WillReturnRows(sqlmock.NewRows([]string{"worker_uid", "worker_gid"}).AddRow(100123, 100123))
	mock.ExpectCommit()

	worker := &WorkerProcess{
		ConnectionID: "connection", CompanyID: "company", TenantSchema: "tenant_company",
		LaunchID: "launch", DesiredState: DesiredStateRunning, Status: "starting",
		ArtifactVersion: "v1", ArtifactSHA256: "digest",
	}
	require.NoError(t, registry.ClaimWorkerLaunch(context.Background(), worker, ""))
	assert.Equal(t, 100123, worker.WorkerUID)
	require.NoError(t, mock.ExpectationsWereMet())
}

// Reclaiming an existing row adds no fleet occupancy and remains available
// when an operator lowers the ceiling below the current durable row count.
func TestClaimWorkerLaunchAdmitsExistingConnectionAboveFleetLimit(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	registry := &WorkerRegistry{db: db, nodeID: "test-node-1", fleetMaxConnections: 2}

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SELECT pg_advisory_xact_lock($1)")).
		WithArgs(fleetCapacityAdvisoryLockID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS (")).
		WithArgs("connection").
		WillReturnRows(sqlmock.NewRows([]string{"exists", "count"}).AddRow(true, 3))
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO worker_registry")).
		WillReturnRows(sqlmock.NewRows([]string{"worker_uid", "worker_gid"}).AddRow(100123, 100123))
	mock.ExpectCommit()

	worker := &WorkerProcess{
		ConnectionID: "connection", CompanyID: "company", TenantSchema: "tenant_company",
		LaunchID: "replacement-launch", DesiredState: DesiredStateRunning, Status: "starting",
		ArtifactVersion: "v1", ArtifactSHA256: "digest",
	}
	require.NoError(t, registry.ClaimWorkerLaunch(context.Background(), worker, "previous-launch"))
	assert.Equal(t, 100123, worker.WorkerUID)
	require.NoError(t, mock.ExpectationsWereMet())
}
