package manager

import (
	"context"
	"regexp"
	"testing"

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
		ConnectionID: "00000000-0000-4000-8000-000000000001",
		CompanyID:    "00000000-0000-4000-8000-000000000002",
		TenantSchema: "tenant_company",
		PID:          42,
		Status:       "connecting",
		RestartCount: 2,
		LaunchID:     "00000000-0000-4000-8000-000000000003",
		DesiredState: DesiredStateRunning,
	}
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO worker_registry")).
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
			"observed-launch",
		).
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := registry.ClaimWorkerLaunch(context.Background(), worker, "observed-launch")
	require.ErrorContains(t, err, "claim conflict")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestActivateWorkerLaunchRejectsLostClaim(t *testing.T) {
	registry, mock := newMockRegistry(t)
	worker := &WorkerProcess{
		ConnectionID: "connection", CompanyID: "company", TenantSchema: "tenant_company",
		PID: 42, Status: "connecting", RestartCount: 1,
		LaunchID: "lost-launch", DesiredState: DesiredStateRunning,
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
			worker.ConnectionID,
			worker.CompanyID,
			worker.LaunchID,
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
