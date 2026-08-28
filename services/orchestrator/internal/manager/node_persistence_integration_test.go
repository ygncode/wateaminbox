package manager

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// Set WR_TEST_DATABASE_URL to a database carrying the public schema (including
// migration 077) to run these. They cover node ownership against real
// PostgreSQL: the claim recording its node, the activation node fence, the
// node-scoped recovery read, and the NULL-owner adoption CAS.
func nodeRegistry(t *testing.T, nodeID string) *WorkerRegistry {
	t.Helper()

	databaseURL := os.Getenv("WR_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WR_TEST_DATABASE_URL is not set")
	}

	registry, err := NewWorkerRegistry(databaseURL, nodeID)
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	return registry
}

func cleanupWorkerRow(t *testing.T, registry *WorkerRegistry, connectionID string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = registry.db.Exec(`DELETE FROM worker_registry WHERE connection_id = $1`, connectionID)
	})
}

// A claim records the claiming node as the durable owner.
func TestClaimWorkerLaunch_RecordsOwningNode(t *testing.T) {
	registry := nodeRegistry(t, "itest-node-a")
	worker := launchWorker(mustLaunchID())

	require.NoError(t, registry.ClaimWorkerLaunch(context.Background(), worker, ""))
	cleanupWorkerRow(t, registry, worker.ConnectionID)

	record, err := registry.GetWorker(context.Background(), worker.ConnectionID)
	require.NoError(t, err)
	require.NotNil(t, record)
	require.Equal(t, "itest-node-a", record.NodeID)
}

// Activation is fenced by node ownership: after another node CAS-reclaims the
// connection, the original node's activation must fail rather than record its
// PID over the new owner's launch.
func TestActivateWorkerLaunch_RefusesForeignNodeOwnership(t *testing.T) {
	registryA := nodeRegistry(t, "itest-node-a")
	registryB := nodeRegistry(t, "itest-node-b")
	worker := launchWorker(mustLaunchID())

	require.NoError(t, registryA.ClaimWorkerLaunch(context.Background(), worker, ""))
	cleanupWorkerRow(t, registryA, worker.ConnectionID)

	// Node B reclaims the observed launch, taking ownership.
	reclaimed := *worker
	reclaimed.LaunchID = mustLaunchID()
	require.NoError(t, registryB.ClaimWorkerLaunch(context.Background(), &reclaimed, worker.LaunchID))

	// Node A's stale activation must not stick. Even with B's launch ID it is
	// node-fenced; with A's own stale launch ID it is generation-fenced.
	stale := *worker
	stale.PID = 51515
	require.ErrorIs(t, registryA.ActivateWorkerLaunch(context.Background(), &stale), ErrWorkerLaunchConflict)

	// The rightful owner activates.
	reclaimed.PID = 61616
	require.NoError(t, registryB.ActivateWorkerLaunch(context.Background(), &reclaimed))
}

// Recovery reads must include exactly the rows this node owns.
func TestGetNodeWorkers_ExcludesForeignRows(t *testing.T) {
	registryA := nodeRegistry(t, "itest-node-a")
	registryB := nodeRegistry(t, "itest-node-b")

	mine := launchWorker(mustLaunchID())
	require.NoError(t, registryA.ClaimWorkerLaunch(context.Background(), mine, ""))
	cleanupWorkerRow(t, registryA, mine.ConnectionID)

	foreign := launchWorker(mustLaunchID())
	require.NoError(t, registryB.ClaimWorkerLaunch(context.Background(), foreign, ""))
	cleanupWorkerRow(t, registryB, foreign.ConnectionID)

	records, err := registryA.GetNodeWorkers(context.Background())
	require.NoError(t, err)
	seen := make(map[string]bool, len(records))
	for _, record := range records {
		require.Equal(t, "itest-node-a", record.NodeID,
			"a node-scoped read must never return another node's row")
		seen[record.ConnectionID] = true
	}
	require.True(t, seen[mine.ConnectionID])
	require.False(t, seen[foreign.ConnectionID])
}

// Adoption claims only ownerless pre-migration rows, never another node's.
func TestAdoptUnassignedWorkers_ClaimsOnlyOwnerlessRows(t *testing.T) {
	registryA := nodeRegistry(t, "itest-node-a")
	registryB := nodeRegistry(t, "itest-node-b")

	foreign := launchWorker(mustLaunchID())
	require.NoError(t, registryB.ClaimWorkerLaunch(context.Background(), foreign, ""))
	cleanupWorkerRow(t, registryB, foreign.ConnectionID)

	// Simulate a pre-migration row: claimed, then owner cleared.
	legacy := launchWorker(mustLaunchID())
	require.NoError(t, registryB.ClaimWorkerLaunch(context.Background(), legacy, ""))
	cleanupWorkerRow(t, registryB, legacy.ConnectionID)
	_, err := registryB.db.Exec(`UPDATE worker_registry SET node_id = NULL WHERE connection_id = $1`, legacy.ConnectionID)
	require.NoError(t, err)

	adopted, err := registryA.AdoptUnassignedWorkers(context.Background())
	require.NoError(t, err)
	require.GreaterOrEqual(t, adopted, int64(1))

	legacyRecord, err := registryA.GetWorker(context.Background(), legacy.ConnectionID)
	require.NoError(t, err)
	require.NotNil(t, legacyRecord)
	require.Equal(t, "itest-node-a", legacyRecord.NodeID)

	foreignRecord, err := registryA.GetWorker(context.Background(), foreign.ConnectionID)
	require.NoError(t, err)
	require.NotNil(t, foreignRecord)
	require.Equal(t, "itest-node-b", foreignRecord.NodeID,
		"adoption must never move a row already owned by another node")
}
