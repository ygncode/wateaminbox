package manager

import (
	"context"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

const testReadinessToken = "test-readiness-token"

func runtimeStatus(company, connection, launch, version, status string) sharednats.WorkerRuntimeStatus {
	signal := sharednats.WorkerRuntimeStatus{
		CompanyID: company, ConnectionID: connection, LaunchID: launch,
		ArtifactVersion: version, Status: status,
	}
	signal.Signature, _ = sharednats.SignWorkerRuntimeStatus(signal, testReadinessToken)
	return signal
}

func TestWorkerReadinessRequiresProcessConnectedAndAuthenticatedForExactGeneration(t *testing.T) {
	manager := New(Config{})
	manager.workers["connection"] = &WorkerProcess{
		CompanyID: "company", ConnectionID: "connection", LaunchID: "launch-new", ArtifactVersion: "v2", readinessToken: testReadinessToken,
	}
	ready := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		ready <- manager.waitWorkerReady(ctx, "launch-new")
	}()

	// Every identity dimension and the per-launch HMAC fence stale/forged signals.
	forged := runtimeStatus("company", "connection", "launch-new", "v2", sharednats.WorkerRuntimeStatusProcessReady)
	forged.Signature, _ = sharednats.SignWorkerRuntimeStatus(forged, "other-launch-token")
	manager.RecordWorkerRuntimeStatus(forged)
	manager.RecordWorkerRuntimeStatus(runtimeStatus("other", "connection", "launch-new", "v2", sharednats.WorkerRuntimeStatusProcessReady))
	manager.RecordWorkerRuntimeStatus(runtimeStatus("company", "connection", "launch-old", "v2", sharednats.WorkerRuntimeStatusAuthenticated))
	manager.RecordWorkerRuntimeStatus(runtimeStatus("company", "connection", "launch-new", "v1", sharednats.WorkerRuntimeStatusConnected))
	select {
	case err := <-ready:
		t.Fatalf("stale readiness completed verification: %v", err)
	case <-time.After(20 * time.Millisecond):
	}

	manager.RecordWorkerRuntimeStatus(runtimeStatus("company", "connection", "launch-new", "v2", sharednats.WorkerRuntimeStatusProcessReady))
	manager.RecordWorkerRuntimeStatus(runtimeStatus("company", "connection", "launch-new", "v2", sharednats.WorkerRuntimeStatusAuthenticated))
	select {
	case err := <-ready:
		t.Fatalf("authenticated without connected completed verification: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	manager.RecordWorkerRuntimeStatus(runtimeStatus("company", "connection", "launch-new", "v2", sharednats.WorkerRuntimeStatusConnected))
	require.NoError(t, <-ready)
}

func TestWorkerReadinessSignalsBeforeWaitAreNotLost(t *testing.T) {
	manager := New(Config{})
	manager.workers["connection"] = &WorkerProcess{
		CompanyID: "company", ConnectionID: "connection", LaunchID: "launch", ArtifactVersion: "v2", readinessToken: testReadinessToken,
	}
	for _, status := range []string{
		sharednats.WorkerRuntimeStatusProcessReady,
		sharednats.WorkerRuntimeStatusConnected,
		sharednats.WorkerRuntimeStatusAuthenticated,
	} {
		manager.RecordWorkerRuntimeStatus(runtimeStatus("company", "connection", "launch", "v2", status))
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, manager.waitWorkerReady(ctx, "launch"))
}

func TestRolloutGateSerializesLifecycleMutations(t *testing.T) {
	manager := New(Config{})
	manager.workers["connection"] = &WorkerProcess{
		CompanyID: "company", ConnectionID: "connection", LaunchID: "source",
		DesiredState: DesiredStateRunning, Status: "error",
	}
	manager.rolloutMu.Lock() // models committed intent handed to the runner
	result := make(chan error, 1)
	go func() {
		result <- manager.StopWorker(context.Background(), "company", "connection", "operator stop")
	}()
	select {
	case err := <-result:
		t.Fatalf("lifecycle mutation crossed active rollout gate: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	manager.rolloutMu.Unlock()
	require.NoError(t, <-result)
	_, exists := manager.GetWorkerStatus("connection")
	assert.False(t, exists)
}

func TestWorkerReadinessConcurrentDuplicateSignalsAreRaceSafe(t *testing.T) {
	manager := New(Config{})
	manager.workers["connection"] = &WorkerProcess{
		CompanyID: "company", ConnectionID: "connection", LaunchID: "launch", ArtifactVersion: "v2", readinessToken: testReadinessToken,
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- manager.waitWorkerReady(ctx, "launch") }()

	var workers sync.WaitGroup
	for i := 0; i < 64; i++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			statuses := []string{
				sharednats.WorkerRuntimeStatusProcessReady,
				sharednats.WorkerRuntimeStatusConnected,
				sharednats.WorkerRuntimeStatusAuthenticated,
			}
			manager.RecordWorkerRuntimeStatus(runtimeStatus("company", "connection", "launch", "v2", statuses[index%len(statuses)]))
		}(i)
	}
	workers.Wait()
	assert.NoError(t, <-result, "readiness did not complete")
}

func TestRecoverWorkerUpgradeOwnsWriterGateBeforeReturning(t *testing.T) {
	registry, mock := newMockRegistry(t)
	now := time.Now()
	batchColumns := []string{
		"id", "target_artifact_version", "target_artifact_sha256", "phase",
		"result", "last_error", "created_at", "updated_at", "completed_at",
	}
	itemColumns := []string{
		"id", "batch_id", "position", "company_id", "tenant_schema", "connection_id",
		"source_generation", "source_artifact_version", "source_artifact_sha256",
		"target_generation", "phase", "result", "last_error", "created_at", "updated_at", "completed_at",
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_batches WHERE completed_at IS NULL")).
		WillReturnRows(sqlmock.NewRows(batchColumns).AddRow(
			"batch", "v2", "target-digest", WorkerUpgradePhaseLaunch, "", "", now, now, nil,
		))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_items WHERE batch_id = $1::uuid ORDER BY position")).
		WithArgs("batch").
		WillReturnRows(sqlmock.NewRows(itemColumns).AddRow(
			"item", "batch", 0, "company", "tenant_company", "connection", "source",
			"v1", "source-digest", "", WorkerUpgradePhaseLaunch, "", "", now, now, nil,
		))
	// The asynchronous runner blocks on this load while retaining rolloutMu.
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_upgrade_batches WHERE id = $1::uuid")).
		WithArgs("batch").WillDelayFor(100 * time.Millisecond).WillReturnError(assert.AnError)

	manager := New(Config{})
	manager.registry = registry
	manager.rolloutCtx = context.Background()
	require.NoError(t, manager.RecoverWorkerUpgrade(context.Background()))
	if manager.rolloutMu.TryRLock() {
		manager.rolloutMu.RUnlock()
		t.Fatal("recovery returned before synchronously acquiring rollout writer gate")
	}
	require.Eventually(t, func() bool {
		if !manager.rolloutMu.TryRLock() {
			return false
		}
		manager.rolloutMu.RUnlock()
		return true
	}, time.Second, 10*time.Millisecond)
	require.NoError(t, mock.ExpectationsWereMet())
}
