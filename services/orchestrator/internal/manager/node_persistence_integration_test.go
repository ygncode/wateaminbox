package manager

import (
	"context"
	"os"
	"testing"
	"time"

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

	registry, err := NewWorkerRegistry(databaseURL, nodeID, 0)
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

func leaseRegistry(t *testing.T, nodeID string) *WorkerRegistry {
	t.Helper()
	registry := nodeRegistry(t, nodeID)
	t.Cleanup(func() {
		_, _ = registry.db.Exec(`DELETE FROM orchestrator_nodes WHERE node_id = $1`, nodeID)
	})
	return registry
}

// Registration enforces per-node stop-first replacement: a live lease refuses
// a second instance of the same node, and release lets a replacement in.
func TestRegisterNodeLease_RefusesLiveDuplicate(t *testing.T) {
	registry := leaseRegistry(t, "itest-lease-a")
	ctx := context.Background()

	require.NoError(t, registry.RegisterNodeLease(ctx, time.Minute, 15))
	require.ErrorIs(t, registry.RegisterNodeLease(ctx, time.Minute, 15), ErrNodeLeaseHeld)

	require.NoError(t, registry.ReleaseNodeLease(ctx))
	require.NoError(t, registry.RegisterNodeLease(ctx, time.Minute, 15))
}

// Renewal succeeds only while the lease is live; a lapsed lease is an
// authoritative loss and must never silently resurrect.
func TestRenewNodeLease_RefusesExpiredLease(t *testing.T) {
	registry := leaseRegistry(t, "itest-lease-b")
	ctx := context.Background()

	require.NoError(t, registry.RegisterNodeLease(ctx, time.Minute, 15))
	renewed, err := registry.RenewNodeLease(ctx, time.Minute)
	require.NoError(t, err)
	require.True(t, renewed)

	require.NoError(t, registry.ReleaseNodeLease(ctx))
	renewed, err = registry.RenewNodeLease(ctx, time.Minute)
	require.NoError(t, err)
	require.False(t, renewed, "an expired lease must not renew")
}

// Takeover requires the owner's lease to be expired past the margin at the
// moment of the CAS; a live owner keeps its workers.
func TestTakeOverFailedNodeWorker_RequiresProvablyExpiredLease(t *testing.T) {
	owner := leaseRegistry(t, "itest-lease-owner")
	peer := leaseRegistry(t, "itest-lease-peer")
	ctx := context.Background()

	require.NoError(t, owner.RegisterNodeLease(ctx, time.Minute, 15))
	worker := launchWorker(mustLaunchID())
	require.NoError(t, owner.ClaimWorkerLaunch(ctx, worker, ""))
	cleanupWorkerRow(t, owner, worker.ConnectionID)

	// Live owner: not listed, not transferable.
	candidates, err := peer.ListFailedNodeWorkers(ctx, 0)
	require.NoError(t, err)
	for _, candidate := range candidates {
		require.NotEqual(t, worker.ConnectionID, candidate.ConnectionID,
			"a live node's workers must never be takeover candidates")
	}
	transferred, err := peer.TakeOverFailedNodeWorker(ctx, worker.ConnectionID, "itest-lease-owner", 0)
	require.NoError(t, err)
	require.False(t, transferred)

	// Expired owner (zero margin): listed and transferable exactly once.
	require.NoError(t, owner.ReleaseNodeLease(ctx))
	candidates, err = peer.ListFailedNodeWorkers(ctx, 0)
	require.NoError(t, err)
	found := false
	for _, candidate := range candidates {
		if candidate.ConnectionID == worker.ConnectionID {
			found = true
		}
	}
	require.True(t, found, "an expired node's running workers must be takeover candidates")

	transferred, err = peer.TakeOverFailedNodeWorker(ctx, worker.ConnectionID, "itest-lease-owner", 0)
	require.NoError(t, err)
	require.True(t, transferred)

	record, err := peer.GetWorker(ctx, worker.ConnectionID)
	require.NoError(t, err)
	require.Equal(t, "itest-lease-peer", record.NodeID)

	// The CAS is single-winner: repeating it finds no row owned by the dead node.
	transferred, err = peer.TakeOverFailedNodeWorker(ctx, worker.ConnectionID, "itest-lease-owner", 0)
	require.NoError(t, err)
	require.False(t, transferred)
}

// A takeover margin larger than the elapsed expiry keeps the connection with
// its owner: takeover must wait until the owner has provably self-fenced.
func TestTakeOverFailedNodeWorker_WaitsOutTheMargin(t *testing.T) {
	owner := leaseRegistry(t, "itest-lease-margin")
	peer := leaseRegistry(t, "itest-lease-margin-peer")
	ctx := context.Background()

	require.NoError(t, owner.RegisterNodeLease(ctx, time.Minute, 15))
	worker := launchWorker(mustLaunchID())
	require.NoError(t, owner.ClaimWorkerLaunch(ctx, worker, ""))
	cleanupWorkerRow(t, owner, worker.ConnectionID)
	require.NoError(t, owner.ReleaseNodeLease(ctx))

	transferred, err := peer.TakeOverFailedNodeWorker(ctx, worker.ConnectionID, "itest-lease-margin", time.Hour)
	require.NoError(t, err)
	require.False(t, transferred, "takeover inside the margin must be refused")
}

// Placement selects a live peer with free slots and skips full or expired
// nodes.
func TestSelectSpawnNode_PicksLivePeerWithFreeSlots(t *testing.T) {
	self := leaseRegistry(t, "itest-place-self")
	fullPeer := leaseRegistry(t, "itest-place-full")
	freePeer := leaseRegistry(t, "itest-place-free")
	deadPeer := leaseRegistry(t, "itest-place-dead")
	ctx := context.Background()

	require.NoError(t, self.RegisterNodeLease(ctx, time.Minute, 1))
	require.NoError(t, fullPeer.RegisterNodeLease(ctx, time.Minute, 1))
	require.NoError(t, freePeer.RegisterNodeLease(ctx, time.Minute, 5))
	require.NoError(t, deadPeer.RegisterNodeLease(ctx, time.Minute, 50))
	require.NoError(t, deadPeer.ReleaseNodeLease(ctx))

	occupant := launchWorker(mustLaunchID())
	require.NoError(t, fullPeer.ClaimWorkerLaunch(ctx, occupant, ""))
	cleanupWorkerRow(t, fullPeer, occupant.ConnectionID)

	target, found, err := self.SelectSpawnNode(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "itest-place-free", target,
		"placement must pick the live peer with free slots, not a full or expired one")
}

// The fleet-wide limit admits reclaims of existing connections but refuses a
// brand-new connection once the fleet is full.
func TestFleetConnectionLimit_RefusesNewConnectionsWhenFull(t *testing.T) {
	databaseURL := os.Getenv("WR_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WR_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()

	// Count whatever rows already exist so the limit is exact for this test.
	probe := nodeRegistry(t, "itest-cap-probe")
	var existing int
	require.NoError(t, probe.db.QueryRow(`SELECT COUNT(*) FROM worker_registry`).Scan(&existing))

	registry, err := NewWorkerRegistry(databaseURL, "itest-cap-node", existing+2)
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })

	admitted := launchWorker(mustLaunchID())
	require.NoError(t, registry.ClaimWorkerLaunch(ctx, admitted, ""))
	cleanupWorkerRow(t, registry, admitted.ConnectionID)
	second := launchWorker(mustLaunchID())
	require.NoError(t, registry.ClaimWorkerLaunch(ctx, second, ""))
	cleanupWorkerRow(t, registry, second.ConnectionID)

	refused := launchWorker(mustLaunchID())
	err = registry.ClaimWorkerLaunch(ctx, refused, "")
	require.ErrorIs(t, err, ErrFleetConnectionLimit)

	// Lower the ceiling below current occupancy. Reclaiming the admitted
	// connection is still not new capacity and must remain available.
	registry.fleetMaxConnections = existing + 1
	reclaim := *admitted
	reclaim.LaunchID = mustLaunchID()
	require.NoError(t, registry.ClaimWorkerLaunch(ctx, &reclaim, admitted.LaunchID))
}
