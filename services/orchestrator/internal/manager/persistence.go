package manager

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

// WorkerRegistry provides persistent storage for worker state.
// This allows the orchestrator to recover workers after restart.
type WorkerRegistry struct {
	db *sql.DB
}

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
}

// NewWorkerRegistry creates a new worker registry connected to the database.
func NewWorkerRegistry(databaseURL string) (*WorkerRegistry, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database connection: %w", err)
	}

	// Test the connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)

	log.Println("Worker registry connected to database")
	return &WorkerRegistry{db: db}, nil
}

// Close closes the database connection.
func (r *WorkerRegistry) Close() error {
	if r.db != nil {
		return r.db.Close()
	}
	return nil
}

// RegisterWorker saves worker state to the database.
// Uses upsert to handle re-registration after restart.
func (r *WorkerRegistry) RegisterWorker(ctx context.Context, w *WorkerProcess) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO worker_registry (connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
		ON CONFLICT (connection_id) DO UPDATE SET
			pid = EXCLUDED.pid,
			status = EXCLUDED.status,
			started_at = EXCLUDED.started_at,
			last_heartbeat = EXCLUDED.last_heartbeat
	`, w.ConnectionID, w.CompanyID, w.TenantSchema, w.DatabaseURL, w.PID, w.Status, now, w.RestartCount)
	if err != nil {
		return fmt.Errorf("failed to register worker: %w", err)
	}
	return nil
}

// RemoveWorker deletes a worker from the registry.
func (r *WorkerRegistry) RemoveWorker(ctx context.Context, connectionID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM worker_registry WHERE connection_id = $1`, connectionID)
	if err != nil {
		return fmt.Errorf("failed to remove worker: %w", err)
	}
	return nil
}

// GetAllWorkers returns all registered workers.
func (r *WorkerRegistry) GetAllWorkers(ctx context.Context) ([]*WorkerRecord, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count
		FROM worker_registry
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to query workers: %w", err)
	}
	defer rows.Close()

	var workers []*WorkerRecord
	for rows.Next() {
		w := &WorkerRecord{}
		if err := rows.Scan(&w.ConnectionID, &w.CompanyID, &w.TenantSchema, &w.DatabaseURL, &w.PID, &w.Status, &w.StartedAt, &w.LastHeartbeat, &w.RestartCount); err != nil {
			return nil, fmt.Errorf("failed to scan worker: %w", err)
		}
		workers = append(workers, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating workers: %w", err)
	}
	return workers, nil
}

// UpdateStatus updates the status of a worker.
func (r *WorkerRegistry) UpdateStatus(ctx context.Context, connectionID, status string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET status = $1, last_heartbeat = $2 WHERE connection_id = $3
	`, status, time.Now(), connectionID)
	if err != nil {
		return fmt.Errorf("failed to update worker status: %w", err)
	}
	return nil
}

// UpdateHeartbeat updates the last_heartbeat timestamp for a worker.
func (r *WorkerRegistry) UpdateHeartbeat(ctx context.Context, connectionID string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET last_heartbeat = $1 WHERE connection_id = $2
	`, time.Now(), connectionID)
	if err != nil {
		return fmt.Errorf("failed to update heartbeat: %w", err)
	}
	return nil
}

// IncrementRestartCount increments the restart counter for a worker.
func (r *WorkerRegistry) IncrementRestartCount(ctx context.Context, connectionID string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET restart_count = restart_count + 1 WHERE connection_id = $1
	`, connectionID)
	if err != nil {
		return fmt.Errorf("failed to increment restart count: %w", err)
	}
	return nil
}

// ResetRestartCount resets the restart counter for a worker (called on successful connection).
func (r *WorkerRegistry) ResetRestartCount(ctx context.Context, connectionID string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET restart_count = 0 WHERE connection_id = $1
	`, connectionID)
	if err != nil {
		return fmt.Errorf("failed to reset restart count: %w", err)
	}
	return nil
}

// GetWorker retrieves a single worker by connection ID.
func (r *WorkerRegistry) GetWorker(ctx context.Context, connectionID string) (*WorkerRecord, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count
		FROM worker_registry
		WHERE connection_id = $1
	`, connectionID)

	w := &WorkerRecord{}
	err := row.Scan(&w.ConnectionID, &w.CompanyID, &w.TenantSchema, &w.DatabaseURL, &w.PID, &w.Status, &w.StartedAt, &w.LastHeartbeat, &w.RestartCount)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get worker: %w", err)
	}
	return w, nil
}

// GetRestartCount returns the current restart count for a worker.
func (r *WorkerRegistry) GetRestartCount(ctx context.Context, connectionID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `
		SELECT restart_count FROM worker_registry WHERE connection_id = $1
	`, connectionID).Scan(&count)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("failed to get restart count: %w", err)
	}
	return count, nil
}
