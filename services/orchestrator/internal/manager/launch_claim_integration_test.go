package manager

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// Set WR_TEST_DATABASE_URL to a database carrying the public schema to run
// these. They cover the launch compare-and-swap against real PostgreSQL types,
// which is where an untyped empty launch ID fails to parse rather than simply
// matching no row.
func launchClaimRegistry(t *testing.T) *WorkerRegistry {
	t.Helper()

	databaseURL := os.Getenv("WR_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WR_TEST_DATABASE_URL is not set")
	}

	registry, err := NewWorkerRegistry(databaseURL)
	require.NoError(t, err)
	t.Cleanup(func() { _ = registry.Close() })
	return registry
}

func launchWorker(companyID string) *WorkerProcess {
	connectionID := mustLaunchID()
	return &WorkerProcess{
		ID:           connectionID,
		CompanyID:    companyID,
		ConnectionID: connectionID,
		TenantSchema: "tenant_test",
		Status:       types.StatusConnecting,
		PID:          4242,
		LaunchID:     mustLaunchID(),
		DesiredState: "running",
	}
}

// A first launch has no previous launch to compare against. This is every
// brand-new connection, and every spawn after a worker was durably stopped.
func TestClaimWorkerLaunch_FirstLaunchHasNoPreviousLaunch(t *testing.T) {
	registry := launchClaimRegistry(t)
	worker := launchWorker(mustLaunchID())

	err := registry.ClaimWorkerLaunch(context.Background(), worker, "")
	require.NoError(t, err, "a first launch must be claimable")

	t.Cleanup(func() {
		_, _ = registry.db.Exec(`DELETE FROM worker_registry WHERE connection_id = $1`, worker.ConnectionID)
	})

	var launchID string
	require.NoError(t, registry.db.QueryRow(
		`SELECT launch_id::text FROM worker_registry WHERE connection_id = $1`, worker.ConnectionID,
	).Scan(&launchID))
	require.Equal(t, worker.LaunchID, launchID)
}

// Claiming with no expected launch must still refuse a connection another
// launch already owns, or two orchestrators could run the same session.
func TestClaimWorkerLaunch_FirstLaunchRefusesExistingOwner(t *testing.T) {
	registry := launchClaimRegistry(t)
	worker := launchWorker(mustLaunchID())

	require.NoError(t, registry.ClaimWorkerLaunch(context.Background(), worker, ""))
	t.Cleanup(func() {
		_, _ = registry.db.Exec(`DELETE FROM worker_registry WHERE connection_id = $1`, worker.ConnectionID)
	})

	intruder := *worker
	intruder.LaunchID = mustLaunchID()
	err := registry.ClaimWorkerLaunch(context.Background(), &intruder, "")
	require.ErrorIs(t, err, ErrWorkerLaunchConflict)
}

// The ordinary compare-and-swap: a relaunch that observed the current launch.
func TestClaimWorkerLaunch_ReplacesObservedLaunch(t *testing.T) {
	registry := launchClaimRegistry(t)
	worker := launchWorker(mustLaunchID())

	require.NoError(t, registry.ClaimWorkerLaunch(context.Background(), worker, ""))
	t.Cleanup(func() {
		_, _ = registry.db.Exec(`DELETE FROM worker_registry WHERE connection_id = $1`, worker.ConnectionID)
	})

	relaunch := *worker
	relaunch.LaunchID = mustLaunchID()
	require.NoError(t, registry.ClaimWorkerLaunch(context.Background(), &relaunch, worker.LaunchID))

	var launchID string
	require.NoError(t, registry.db.QueryRow(
		`SELECT launch_id::text FROM worker_registry WHERE connection_id = $1`, worker.ConnectionID,
	).Scan(&launchID))
	require.Equal(t, relaunch.LaunchID, launchID)
}

// A stale expected launch must lose the race.
func TestClaimWorkerLaunch_RejectsStaleExpectedLaunch(t *testing.T) {
	registry := launchClaimRegistry(t)
	worker := launchWorker(mustLaunchID())

	require.NoError(t, registry.ClaimWorkerLaunch(context.Background(), worker, ""))
	t.Cleanup(func() {
		_, _ = registry.db.Exec(`DELETE FROM worker_registry WHERE connection_id = $1`, worker.ConnectionID)
	})

	stale := *worker
	stale.LaunchID = mustLaunchID()
	err := registry.ClaimWorkerLaunch(context.Background(), &stale, mustLaunchID())
	require.ErrorIs(t, err, ErrWorkerLaunchConflict)
}

func mustLaunchID() string {
	id, err := newLaunchID()
	if err != nil {
		panic(err)
	}
	return id
}

var _ = sql.ErrNoRows
