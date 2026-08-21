package manager

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/lib/pq"
)

// WorkerRegistry provides persistent storage for worker state.
type WorkerRegistry struct {
	db *sql.DB
}

var ErrWorkerLaunchConflict = errors.New("worker launch claim conflict")

// WorkerRecord represents a worker record in the database.
type WorkerRecord struct {
	ID            string
	ConnectionID  string
	CompanyID     string
	TenantSchema  string
	DatabaseURL   string
	PID           int
	Status        string
	StartedAt     time.Time
	LastHeartbeat time.Time
	RestartCount  int
	LaunchID      string
	DesiredState  string
}

func NewWorkerRegistry(databaseURL string) (*WorkerRegistry, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database connection: %w", err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}
	var lifecycleColumns int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'worker_registry'
			AND column_name IN ('launch_id', 'desired_state')
	`).Scan(&lifecycleColumns); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to verify worker registry schema: %w", err)
	}
	if lifecycleColumns != 2 {
		_ = db.Close()
		return nil, fmt.Errorf("worker registry lifecycle migration is not applied")
	}
	var supportsUnlinking bool
	if err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM pg_constraint constraint_row
			JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
			JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
			WHERE schema_row.nspname = 'public'
				AND table_row.relname = 'worker_registry'
				AND constraint_row.conname = 'worker_registry_desired_state_check'
				AND pg_get_constraintdef(constraint_row.oid) LIKE '%unlinking%'
		)
	`).Scan(&supportsUnlinking); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to verify worker registry lifecycle constraint: %w", err)
	}
	if !supportsUnlinking {
		_ = db.Close()
		return nil, fmt.Errorf("worker registry does not support durable unlink intent")
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	log.Println("Worker registry connected to database")
	return &WorkerRegistry{db: db}, nil
}

func (r *WorkerRegistry) Close() error {
	if r.db != nil {
		return r.db.Close()
	}
	return nil
}

// ClaimWorkerLaunch atomically replaces only the launch the caller observed.
// This compare-and-swap prevents overlapping orchestrators from both claiming
// the same live connection. A durable stopped row may be reclaimed explicitly.
func (r *WorkerRegistry) ClaimWorkerLaunch(ctx context.Context, w *WorkerProcess, expectedLaunchID string) error {
	now := time.Now()
	// A first launch has no previous launch to compare against: the connection
	// is new, or its row was removed when the worker was durably stopped. The
	// expectation is then "no row exists", which is a typed NULL rather than an
	// empty string. PostgreSQL parses the parameter as uuid whether or not the
	// conflict branch runs, so passing "" fails the whole statement instead of
	// simply matching nothing. launch_id is NOT NULL, so IS NOT DISTINCT FROM a
	// NULL expectation can never match a row another launch already owns.
	var expected any
	if expectedLaunchID != "" {
		expected = expectedLaunchID
	}
	result, err := r.db.ExecContext(ctx, `
		INSERT INTO worker_registry (connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10)
		ON CONFLICT (connection_id) DO UPDATE SET
			tenant_schema = EXCLUDED.tenant_schema,
			database_url = EXCLUDED.database_url,
			pid = EXCLUDED.pid,
			status = EXCLUDED.status,
			started_at = EXCLUDED.started_at,
			last_heartbeat = EXCLUDED.last_heartbeat,
			restart_count = EXCLUDED.restart_count,
			launch_id = EXCLUDED.launch_id,
			desired_state = EXCLUDED.desired_state
		WHERE worker_registry.company_id = EXCLUDED.company_id
			AND worker_registry.launch_id IS NOT DISTINCT FROM $11::uuid
	`, w.ConnectionID, w.CompanyID, w.TenantSchema, "", w.PID, w.Status, now, w.RestartCount, w.LaunchID, w.DesiredState, expected)
	if err != nil {
		return fmt.Errorf("failed to claim worker launch: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect worker launch claim: %w", err)
	}
	if affected != 1 {
		return ErrWorkerLaunchConflict
	}
	return nil
}

// ActivateWorkerLaunch records the PID only if the caller still owns the exact
// tenant-scoped generation it reserved before starting the child.
func (r *WorkerRegistry) ActivateWorkerLaunch(ctx context.Context, w *WorkerProcess) error {
	now := time.Now()
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET
			tenant_schema = $1, database_url = $2, pid = $3, status = $4,
			started_at = $5, last_heartbeat = $5, restart_count = $6,
			desired_state = $7
		WHERE connection_id = $8 AND company_id = $9 AND launch_id = $10
	`, w.TenantSchema, "", w.PID, w.Status, now, w.RestartCount, w.DesiredState, w.ConnectionID, w.CompanyID, w.LaunchID)
	if err != nil {
		return fmt.Errorf("failed to activate worker launch: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect worker launch activation: %w", err)
	}
	if affected != 1 {
		return ErrWorkerLaunchConflict
	}
	return nil
}

// RemoveWorkerLaunch deletes only the specified tenant-owned launch. A stale
// callback therefore cannot remove a newer launch's row.
func (r *WorkerRegistry) RemoveWorkerLaunch(ctx context.Context, connectionID, companyID, launchID string) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		DELETE FROM worker_registry WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3
	`, connectionID, companyID, launchID)
	if err != nil {
		return false, fmt.Errorf("failed to remove worker: %w", err)
	}
	removed, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect worker removal: %w", err)
	}
	return removed == 1, nil
}

func (r *WorkerRegistry) GetAllWorkers(ctx context.Context) ([]*WorkerRecord, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state
		FROM worker_registry
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to query workers: %w", err)
	}
	defer rows.Close()

	var workers []*WorkerRecord
	for rows.Next() {
		w := &WorkerRecord{}
		if err := rows.Scan(&w.ConnectionID, &w.CompanyID, &w.TenantSchema, &w.DatabaseURL, &w.PID, &w.Status, &w.StartedAt, &w.LastHeartbeat, &w.RestartCount, &w.LaunchID, &w.DesiredState); err != nil {
			return nil, fmt.Errorf("failed to scan worker: %w", err)
		}
		workers = append(workers, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating workers: %w", err)
	}
	return workers, nil
}

func (r *WorkerRegistry) UpdateStatusLaunch(
	ctx context.Context,
	connectionID, companyID, launchID, status string,
) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET status = $1, last_heartbeat = $2
		WHERE connection_id = $3 AND company_id = $4 AND launch_id = $5
	`, status, time.Now(), connectionID, companyID, launchID)
	if err != nil {
		return false, fmt.Errorf("failed to update worker status: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect worker status update: %w", err)
	}
	return updated == 1, nil
}

// MarkWorkersRecovering preserves desired_state=running while recording that
// shutdown deliberately terminated these launches.
func (r *WorkerRegistry) MarkWorkersRecovering(ctx context.Context, connectionIDs []string) error {
	if len(connectionIDs) == 0 {
		return nil
	}
	_, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET status = $1, last_heartbeat = $2
		WHERE connection_id = ANY($3) AND desired_state = $4
	`, WorkerStatusRecovering, time.Now(), pq.Array(connectionIDs), DesiredStateRunning)
	if err != nil {
		return fmt.Errorf("failed to mark workers for recovery: %w", err)
	}
	return nil
}

func (r *WorkerRegistry) UpdateHeartbeatLaunch(
	ctx context.Context,
	connectionID, companyID, launchID string,
) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET last_heartbeat = $1
		WHERE connection_id = $2 AND company_id = $3 AND launch_id = $4
	`, time.Now(), connectionID, companyID, launchID)
	if err != nil {
		return false, fmt.Errorf("failed to update heartbeat: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect heartbeat update: %w", err)
	}
	return updated == 1, nil
}

func (r *WorkerRegistry) IncrementRestartCountLaunch(ctx context.Context, connectionID, companyID, launchID string) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET restart_count = restart_count + 1
		WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3 AND desired_state = $4
	`, connectionID, companyID, launchID, DesiredStateRunning)
	if err != nil {
		return false, fmt.Errorf("failed to increment restart count: %w", err)
	}
	affected, err := result.RowsAffected()
	return affected == 1, err
}

func (r *WorkerRegistry) SetDesiredState(ctx context.Context, connectionID, companyID, launchID, desiredState string) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET desired_state = $1
		WHERE connection_id = $2 AND company_id = $3 AND launch_id = $4
	`, desiredState, connectionID, companyID, launchID)
	if err != nil {
		return false, fmt.Errorf("failed to set desired state: %w", err)
	}
	affected, err := result.RowsAffected()
	return affected == 1, err
}

func (r *WorkerRegistry) GetWorker(ctx context.Context, connectionID string) (*WorkerRecord, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state
		FROM worker_registry WHERE connection_id = $1
	`, connectionID)
	w := &WorkerRecord{}
	err := row.Scan(&w.ConnectionID, &w.CompanyID, &w.TenantSchema, &w.DatabaseURL, &w.PID, &w.Status, &w.StartedAt, &w.LastHeartbeat, &w.RestartCount, &w.LaunchID, &w.DesiredState)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get worker: %w", err)
	}
	return w, nil
}

func (r *WorkerRegistry) GetRestartCountLaunch(
	ctx context.Context,
	connectionID, companyID, launchID string,
) (int, bool, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `
		SELECT restart_count FROM worker_registry
		WHERE connection_id = $1 AND company_id = $2 AND launch_id = $3
	`, connectionID, companyID, launchID).Scan(&count)
	if err == sql.ErrNoRows {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("failed to get restart count: %w", err)
	}
	return count, true, nil
}

// CompaniesWithoutConnectionAllowance returns the subset of the given companies
// whose WhatsApp connection allowance is exhausted. The allowance is the same
// generic limit the API enforces when a connection is created; a company that
// may run no connections must not keep running the ones it already started.
//
// A company that cannot be read is never returned. Losing the database, or
// racing a company row that does not exist yet, must never stop a running
// worker: the query names only companies that are explicitly out of allowance.
func (r *WorkerRegistry) CompaniesWithoutConnectionAllowance(
	ctx context.Context,
	companyIDs []string,
) ([]string, error) {
	if len(companyIDs) == 0 {
		return nil, nil
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id::text
		FROM public.companies
		WHERE id::text = ANY($1) AND max_whatsapp_connections <= 0
	`, pq.Array(companyIDs))
	if err != nil {
		return nil, fmt.Errorf("failed to read connection allowances: %w", err)
	}
	defer rows.Close()

	var blocked []string
	for rows.Next() {
		var companyID string
		if err := rows.Scan(&companyID); err != nil {
			return nil, fmt.Errorf("failed to scan company allowance: %w", err)
		}
		blocked = append(blocked, companyID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate company allowances: %w", err)
	}
	return blocked, nil
}
