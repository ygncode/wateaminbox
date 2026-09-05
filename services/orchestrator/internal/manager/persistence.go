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

// WorkerRegistry provides persistent storage for worker state. Every registry
// is bound to one orchestrator node identity: claims record it as the owner
// and recovery reads only rows it owns.
type WorkerRegistry struct {
	db     *sql.DB
	nodeID string
	// fleetMaxConnections caps the number of distinct connections across every
	// node, enforced atomically inside the launch claim. 0 disables the cap.
	fleetMaxConnections    int
	newConnectionAdmission bool
}

var (
	ErrWorkerLaunchConflict          = errors.New("worker launch claim conflict")
	ErrWorkerUpgradeBatchActive      = errors.New("a worker upgrade batch is already active")
	ErrWorkerUpgradeSnapshotConflict = errors.New("worker upgrade snapshot no longer matches the source generation")
	ErrWorkerArtifactNormalization   = errors.New("worker artifact normalization is incomplete")
	ErrFleetConnectionLimit          = errors.New("fleet-wide connection limit reached")
	ErrNodeLeaseHeld                 = errors.New("orchestrator node identity is held by a live lease")
)

// fleetCapacityAdvisoryLockID serializes fleet-capacity claim checks across
// every orchestrator node without blocking unrelated registry writes such as
// heartbeats. Transaction-scoped, so a crashed claimer releases it implicitly.
const fleetCapacityAdvisoryLockID int64 = 0x57415465616D4942 // "WATeamIB"

const (
	WorkerUpgradePhaseStop      = "stop"
	WorkerUpgradePhaseLaunch    = "launch"
	WorkerUpgradePhaseVerify    = "verify"
	WorkerUpgradePhaseRollback  = "rollback"
	WorkerUpgradePhaseRecovery  = "recovery"
	WorkerUpgradePhaseCanceled  = "canceled"
	WorkerUpgradePhaseHalted    = "halted"
	WorkerUpgradePhaseAbandoned = "abandoned"

	WorkerUpgradeItemResultTargetComplete    = "target_complete"
	WorkerUpgradeItemResultRollbackComplete  = "rollback_complete"
	WorkerUpgradeItemResultCanceledUntouched = "canceled_untouched"
	WorkerUpgradeItemResultAbandonedExternal = "abandoned_external"
)

// WorkerUpgradeItemIntent is the immutable pre-signal snapshot of one worker.
// SourceGeneration is the worker_registry launch_id observed by the caller.
type WorkerUpgradeLiveFence struct {
	LaunchID        string
	ArtifactVersion string
	ArtifactSHA256  string
	WorkerUID       int
	WorkerGID       int
}

type WorkerUpgradeItemIntent struct {
	Position              int
	CompanyID             string
	TenantSchema          string
	ConnectionID          string
	SourceGeneration      string
	SourceArtifactVersion string
	SourceArtifactSHA256  string
}

// WorkerUpgradeBatch is a durable, globally serialized rolling upgrade.
type WorkerUpgradeBatch struct {
	ID                    string               `json:"id"`
	TargetArtifactVersion string               `json:"target_artifact_version"`
	TargetArtifactSHA256  string               `json:"target_artifact_sha256"`
	Phase                 string               `json:"phase"`
	Result                string               `json:"result,omitempty"`
	LastError             string               `json:"last_error,omitempty"`
	CreatedAt             time.Time            `json:"created_at"`
	UpdatedAt             time.Time            `json:"updated_at"`
	CompletedAt           *time.Time           `json:"completed_at,omitempty"`
	Items                 []*WorkerUpgradeItem `json:"items"`
}

// WorkerUpgradeItem records enough source state to resume or roll back after a
// crash. Every mutation is scoped by tenant, connection, and source generation.
type WorkerUpgradeItem struct {
	ID                    string     `json:"id"`
	BatchID               string     `json:"batch_id"`
	Position              int        `json:"position"`
	CompanyID             string     `json:"company_id"`
	TenantSchema          string     `json:"tenant_schema"`
	ConnectionID          string     `json:"connection_id"`
	SourceGeneration      string     `json:"source_generation"`
	SourceArtifactVersion string     `json:"source_artifact_version"`
	SourceArtifactSHA256  string     `json:"source_artifact_sha256"`
	TargetGeneration      string     `json:"target_generation,omitempty"`
	RecoveryGeneration    string     `json:"recovery_generation,omitempty"`
	RollbackGeneration    string     `json:"rollback_generation,omitempty"`
	Phase                 string     `json:"phase"`
	Result                string     `json:"result,omitempty"`
	LastError             string     `json:"last_error,omitempty"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
	CompletedAt           *time.Time `json:"completed_at,omitempty"`
}

// WorkerRecord represents a worker record in the database.
type WorkerRecord struct {
	ID              string
	ConnectionID    string
	CompanyID       string
	TenantSchema    string
	DatabaseURL     string
	PID             int
	Status          string
	StartedAt       time.Time
	LastHeartbeat   time.Time
	RestartCount    int
	LaunchID        string
	DesiredState    string
	ArtifactVersion string
	ArtifactSHA256  string
	WorkerUID       int
	WorkerGID       int
	NodeID          string // owning orchestrator node; empty only for pre-adoption legacy rows
}

// validateNodeID accepts only NATS-token- and consumer-name-safe identities so
// a node ID can appear verbatim in subjects and durable consumer names.
func validateNodeID(nodeID string) error {
	if nodeID == "" || len(nodeID) > 64 {
		return errors.New("orchestrator node ID must be 1-64 characters")
	}
	for _, r := range nodeID {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return fmt.Errorf("orchestrator node ID contains invalid character %q; use letters, digits, '-' or '_'", r)
		}
	}
	return nil
}

func NewWorkerRegistry(databaseURL, nodeID string, fleetMaxConnections int) (*WorkerRegistry, error) {
	if err := validateNodeID(nodeID); err != nil {
		return nil, err
	}
	if fleetMaxConnections < 0 {
		return nil, errors.New("fleet-wide connection limit must be non-negative")
	}
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
	var upgradeSchemaObjects int
	if err := db.QueryRow(`
		SELECT
			(SELECT COUNT(*) FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'worker_registry'
				AND column_name IN ('artifact_version', 'artifact_sha256', 'artifact_normalized', 'worker_uid', 'worker_gid'))
			+
			(SELECT COUNT(*) FROM information_schema.tables
			 WHERE table_schema = 'public'
				AND table_name IN ('worker_upgrade_batches', 'worker_upgrade_items'))
			+
			(SELECT COUNT(*) FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'worker_upgrade_items'
				AND column_name IN ('recovery_generation', 'rollback_generation'))
			+
			(SELECT COUNT(*) FROM information_schema.sequences
			 WHERE sequence_schema = 'public' AND sequence_name = 'worker_os_identity_seq')
	`).Scan(&upgradeSchemaObjects); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to verify worker upgrade schema: %w", err)
	}
	if upgradeSchemaObjects != 10 {
		_ = db.Close()
		return nil, fmt.Errorf("worker upgrade migration is not applied")
	}
	var safeWorkerIdentitySchema bool
	if err := db.QueryRow(`
		SELECT
			EXISTS (
				SELECT 1
				FROM information_schema.columns uid
				JOIN information_schema.columns gid
					ON gid.table_schema = uid.table_schema
					AND gid.table_name = uid.table_name
				WHERE uid.table_schema = 'public' AND uid.table_name = 'worker_registry'
					AND uid.column_name = 'worker_uid' AND uid.is_nullable = 'NO'
					AND uid.column_default LIKE 'nextval(%worker_os_identity_seq%'
					AND gid.column_name = 'worker_gid' AND gid.is_generated = 'ALWAYS'
					AND regexp_replace(gid.generation_expression, '[()]', '', 'g') = 'worker_uid'
			)
			AND EXISTS (
				SELECT 1 FROM information_schema.sequences
				WHERE sequence_schema = 'public' AND sequence_name = 'worker_os_identity_seq'
					AND minimum_value::numeric = 100000
					AND maximum_value::numeric = 2147483646
					AND cycle_option = 'NO'
			)
			AND EXISTS (
				SELECT 1 FROM pg_indexes
				WHERE schemaname = 'public' AND tablename = 'worker_registry'
					AND indexname = 'worker_registry_worker_uid_key'
					AND indexdef LIKE 'CREATE UNIQUE INDEX%'
			)
			AND EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'worker_registry'
					AND column_name = 'artifact_normalized' AND is_nullable = 'NO'
					AND column_default = 'true'
			)
			AND EXISTS (
				SELECT 1 FROM pg_constraint constraint_row
				JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
				JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
				WHERE schema_row.nspname = 'public'
					AND table_row.relname = 'worker_registry'
					AND constraint_row.conname = 'worker_registry_artifact_normalization_check'
			)
	`).Scan(&safeWorkerIdentitySchema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to verify worker identity schema: %w", err)
	}
	if !safeWorkerIdentitySchema {
		_ = db.Close()
		return nil, fmt.Errorf("worker identity schema is not collision-safe")
	}
	var nodeIdentityColumns int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'worker_registry'
			AND column_name = 'node_id'
	`).Scan(&nodeIdentityColumns); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to verify worker node identity schema: %w", err)
	}
	if nodeIdentityColumns != 1 {
		_ = db.Close()
		return nil, fmt.Errorf("worker registry node identity migration is not applied")
	}
	var nodeLeaseTables int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'orchestrator_nodes'
	`).Scan(&nodeLeaseTables); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to verify orchestrator node lease schema: %w", err)
	}
	if nodeLeaseTables != 1 {
		_ = db.Close()
		return nil, fmt.Errorf("orchestrator node lease migration is not applied")
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	log.Printf("Worker registry connected to database as node %s", nodeID)
	return &WorkerRegistry{db: db, nodeID: nodeID, fleetMaxConnections: fleetMaxConnections}, nil
}

// NodeID reports the orchestrator node identity this registry claims for.
func (r *WorkerRegistry) NodeID() string {
	return r.nodeID
}

func (r *WorkerRegistry) Close() error {
	if r.db != nil {
		return r.db.Close()
	}
	return nil
}

const claimWorkerLaunchSQL = `
		INSERT INTO worker_registry (connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state, artifact_version, artifact_sha256, artifact_normalized, node_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, true, $14)
		ON CONFLICT (connection_id) DO UPDATE SET
			tenant_schema = EXCLUDED.tenant_schema,
			database_url = EXCLUDED.database_url,
			pid = EXCLUDED.pid,
			status = EXCLUDED.status,
			started_at = EXCLUDED.started_at,
			last_heartbeat = EXCLUDED.last_heartbeat,
			restart_count = EXCLUDED.restart_count,
			launch_id = EXCLUDED.launch_id,
			desired_state = EXCLUDED.desired_state,
			artifact_version = EXCLUDED.artifact_version,
			artifact_sha256 = EXCLUDED.artifact_sha256,
			artifact_normalized = true,
			worker_uid = EXCLUDED.worker_uid,
			node_id = EXCLUDED.node_id
		WHERE worker_registry.company_id = EXCLUDED.company_id
			AND worker_registry.launch_id IS NOT DISTINCT FROM $13::uuid
		RETURNING worker_uid, worker_gid
	`

// ClaimWorkerLaunch atomically replaces only the launch the caller observed.
// This compare-and-swap prevents overlapping orchestrators from both claiming
// the same live connection. A durable stopped row may be reclaimed explicitly.
//
// When a fleet-wide connection limit is configured, admission is checked in
// the same transaction as the claim, serialized across nodes by an advisory
// lock: counting and then claiming as separate steps is a race that two nodes
// can both win. Reclaiming a connection that already has a row never counts
// against the limit, so recovery, restart, and takeover are unaffected.
func (r *WorkerRegistry) ClaimWorkerLaunch(ctx context.Context, w *WorkerProcess, expectedLaunchID string) error {
	now := time.Now()
	// A first launch expects no prior launch: PostgreSQL needs a typed NULL,
	// never the invalid empty UUID. A nonempty expectation remains an exact CAS.
	var expected any
	if expectedLaunchID != "" {
		expected = expectedLaunchID
	}
	claimArgs := []any{
		w.ConnectionID, w.CompanyID, w.TenantSchema, "", w.PID, w.Status, now,
		w.RestartCount, w.LaunchID, w.DesiredState, w.ArtifactVersion,
		w.ArtifactSHA256, expected, r.nodeID,
	}

	var err error
	if r.fleetMaxConnections > 0 || r.newConnectionAdmission {
		err = r.claimWithFleetLimit(ctx, w, claimArgs)
	} else {
		err = r.db.QueryRowContext(ctx, claimWorkerLaunchSQL, claimArgs...).Scan(&w.WorkerUID, &w.WorkerGID)
	}
	if err == sql.ErrNoRows {
		return ErrWorkerLaunchConflict
	}
	if errors.Is(err, ErrFleetConnectionLimit) {
		return err
	}
	if err != nil {
		return fmt.Errorf("failed to claim worker launch: %w", err)
	}
	if err := validateWorkerIdentity(w.WorkerUID, w.WorkerGID); err != nil {
		return fmt.Errorf("invalid allocated worker identity: %w", err)
	}
	return nil
}

func (r *WorkerRegistry) claimWithFleetLimit(ctx context.Context, w *WorkerProcess, claimArgs []any) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin fleet-limited worker claim: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, fleetCapacityAdvisoryLockID); err != nil {
		return fmt.Errorf("serialize fleet capacity check: %w", err)
	}
	var (
		connectionExists bool
		occupied         int
	)
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM worker_registry WHERE connection_id = $1
		), COUNT(*)
		FROM worker_registry
	`, w.ConnectionID).Scan(&connectionExists, &occupied); err != nil {
		return fmt.Errorf("inspect fleet capacity: %w", err)
	}
	// Capacity is admission control, not a recovery gate. Once a connection
	// has a durable row, reclaiming its generation adds no fleet occupancy and
	// must remain possible even if an operator lowered the ceiling below the
	// current count. The launch CAS below still enforces tenant and generation
	// ownership for that existing row.
	if !connectionExists && r.newConnectionAdmission {
		var allowed bool
		if err := tx.QueryRowContext(ctx, `SELECT accepting_new AND expires_at>clock_timestamp()
			FROM public.runtime_node_admission WHERE node_id=$1 FOR SHARE`, r.nodeID).Scan(&allowed); err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("new connection admission unavailable: %w", err)
		}
		if !allowed {
			return errors.New("new connection admission denied")
		}
	}
	if !connectionExists && r.fleetMaxConnections > 0 && occupied >= r.fleetMaxConnections {
		return fmt.Errorf("%w (%d/%d)", ErrFleetConnectionLimit, occupied, r.fleetMaxConnections)
	}
	if err := tx.QueryRowContext(ctx, claimWorkerLaunchSQL, claimArgs...).Scan(&w.WorkerUID, &w.WorkerGID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit fleet-limited worker claim: %w", err)
	}
	return nil
}

// ActivateWorkerLaunch records the PID only if the caller still owns the exact
// tenant-scoped generation it reserved before starting the child, and only
// while that generation is still assigned to this node.
func (r *WorkerRegistry) ActivateWorkerLaunch(ctx context.Context, w *WorkerProcess) error {
	now := time.Now()
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET
			tenant_schema = $1, database_url = $2, pid = $3, status = $4,
			started_at = $5, last_heartbeat = $5, restart_count = $6,
			desired_state = $7, artifact_version = $8, artifact_sha256 = $9
		WHERE connection_id = $10 AND company_id = $11 AND launch_id = $12
			AND worker_uid = $13 AND worker_gid = $14 AND node_id = $15
	`, w.TenantSchema, "", w.PID, w.Status, now, w.RestartCount, w.DesiredState, w.ArtifactVersion, w.ArtifactSHA256, w.ConnectionID, w.CompanyID, w.LaunchID, w.WorkerUID, w.WorkerGID, r.nodeID)
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

// DeactivateWorkerLaunch clears a confirmed-exited process while preserving
// the exact reserved generation for rollout or shutdown recovery. The PID
// fence prevents a stale waiter from deactivating a replacement process.
func (r *WorkerRegistry) DeactivateWorkerLaunch(
	ctx context.Context,
	connectionID, companyID, launchID string,
	pid int,
) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry
		SET pid = 0, status = $1, last_heartbeat = now()
		WHERE connection_id = $2 AND company_id = $3 AND launch_id = $4 AND pid = $5
	`, WorkerStatusRecovering, connectionID, companyID, launchID, pid)
	if err != nil {
		return false, fmt.Errorf("failed to deactivate worker launch: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect worker launch deactivation: %w", err)
	}
	return updated == 1, nil
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

func (r *WorkerRegistry) scanWorkerRows(rows *sql.Rows) ([]*WorkerRecord, error) {
	defer rows.Close()
	var workers []*WorkerRecord
	for rows.Next() {
		w := &WorkerRecord{}
		var nodeID sql.NullString
		if err := rows.Scan(&w.ConnectionID, &w.CompanyID, &w.TenantSchema, &w.DatabaseURL, &w.PID, &w.Status, &w.StartedAt, &w.LastHeartbeat, &w.RestartCount, &w.LaunchID, &w.DesiredState, &w.ArtifactVersion, &w.ArtifactSHA256, &w.WorkerUID, &w.WorkerGID, &nodeID); err != nil {
			return nil, fmt.Errorf("failed to scan worker: %w", err)
		}
		w.NodeID = nodeID.String
		workers = append(workers, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating workers: %w", err)
	}
	return workers, nil
}

func (r *WorkerRegistry) GetAllWorkers(ctx context.Context) ([]*WorkerRecord, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state, artifact_version, artifact_sha256, worker_uid, worker_gid, node_id
		FROM worker_registry
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to query workers: %w", err)
	}
	return r.scanWorkerRows(rows)
}

// GetNodeWorkers returns only the launches this node owns. Recovery must never
// see, adopt, or respawn a row owned by another orchestrator node: PIDs are
// host-local, so a foreign row's dead-looking PID may be a live process on its
// owner's host, and respawning it would run two whatsmeow clients against one
// connection's device rows.
func (r *WorkerRegistry) GetNodeWorkers(ctx context.Context) ([]*WorkerRecord, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state, artifact_version, artifact_sha256, worker_uid, worker_gid, node_id
		FROM worker_registry
		WHERE node_id = $1
	`, r.nodeID)
	if err != nil {
		return nil, fmt.Errorf("failed to query node workers: %w", err)
	}
	return r.scanWorkerRows(rows)
}

// AdoptUnassignedWorkers claims every row written before the node identity
// migration. NULL node_id is the compare-and-swap predicate, so two nodes
// starting concurrently can never both adopt one row. Rows already assigned to
// another node are never touched.
func (r *WorkerRegistry) AdoptUnassignedWorkers(ctx context.Context) (int64, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry SET node_id = $1 WHERE node_id IS NULL
	`, r.nodeID)
	if err != nil {
		return 0, fmt.Errorf("failed to adopt unassigned workers: %w", err)
	}
	adopted, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("inspect unassigned worker adoption: %w", err)
	}
	return adopted, nil
}

// OrchestratorNode is one node's durable lease state.
type OrchestratorNode struct {
	NodeID         string
	LeaseExpiresAt time.Time
	HeartbeatAt    time.Time
	StartedAt      time.Time
	LeaseExpired   bool
}

// RegisterNodeLease claims this node's identity for one running instance. A
// live lease refuses registration, enforcing per-node stop-first replacement
// from shared state: two orchestrators believing they are the same node would
// both recover and respawn that node's connections. The node's local worker
// capacity is recorded so peers can place new connections by free slots.
func (r *WorkerRegistry) RegisterNodeLease(ctx context.Context, leaseDuration time.Duration, maxWorkers int) error {
	result, err := r.db.ExecContext(ctx, `
		INSERT INTO orchestrator_nodes (node_id, lease_expires_at, heartbeat_at, started_at, max_workers)
		VALUES ($1, now() + make_interval(secs => $2), now(), now(), $3)
		ON CONFLICT (node_id) DO UPDATE SET
			lease_expires_at = EXCLUDED.lease_expires_at,
			heartbeat_at = now(),
			started_at = now(),
			max_workers = EXCLUDED.max_workers
		WHERE orchestrator_nodes.lease_expires_at <= now()
	`, r.nodeID, leaseDuration.Seconds(), maxWorkers)
	if err != nil {
		return fmt.Errorf("register node lease: %w", err)
	}
	registered, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect node lease registration: %w", err)
	}
	if registered != 1 {
		return fmt.Errorf("%w: node %s", ErrNodeLeaseHeld, r.nodeID)
	}
	return nil
}

// RenewNodeLease extends only a lease that has not yet expired. A false
// return is authoritative: the lease lapsed, the node has lost ownership
// authority, and the caller must self-fence rather than keep running workers.
func (r *WorkerRegistry) RenewNodeLease(ctx context.Context, leaseDuration time.Duration) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE orchestrator_nodes
		SET lease_expires_at = now() + make_interval(secs => $2), heartbeat_at = now()
		WHERE node_id = $1 AND lease_expires_at > now()
	`, r.nodeID, leaseDuration.Seconds())
	if err != nil {
		return false, fmt.Errorf("renew node lease: %w", err)
	}
	renewed, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect node lease renewal: %w", err)
	}
	return renewed == 1, nil
}

// ReleaseNodeLease expires this node's lease immediately on graceful
// shutdown, so a stop-first replacement of the same node can register without
// waiting out the lease. Peers still wait the full takeover margin beyond the
// expiry before touching this node's connections.
func (r *WorkerRegistry) ReleaseNodeLease(ctx context.Context) error {
	if _, err := r.db.ExecContext(ctx, `
		UPDATE orchestrator_nodes SET lease_expires_at = now() WHERE node_id = $1
	`, r.nodeID); err != nil {
		return fmt.Errorf("release node lease: %w", err)
	}
	return nil
}

// ListNodes reports every registered orchestrator node and its lease state.
func (r *WorkerRegistry) ListNodes(ctx context.Context) ([]*OrchestratorNode, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT node_id, lease_expires_at, heartbeat_at, started_at, lease_expires_at <= now()
		FROM orchestrator_nodes ORDER BY node_id
	`)
	if err != nil {
		return nil, fmt.Errorf("list orchestrator nodes: %w", err)
	}
	defer rows.Close()
	var nodes []*OrchestratorNode
	for rows.Next() {
		node := &OrchestratorNode{}
		if err := rows.Scan(&node.NodeID, &node.LeaseExpiresAt, &node.HeartbeatAt, &node.StartedAt, &node.LeaseExpired); err != nil {
			return nil, fmt.Errorf("scan orchestrator node: %w", err)
		}
		nodes = append(nodes, node)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate orchestrator nodes: %w", err)
	}
	return nodes, nil
}

// ListFailedNodeWorkers returns desired-running rows owned by nodes whose
// lease has been expired for at least the takeover margin. The owner must
// have a lease row: takeover deliberately requires provable expiry rather
// than mere absence, so workers owned by a binary that predates leases are
// never silently stolen. Stopped and unlinking rows stay with their owner —
// their durable intent needs no live process here.
func (r *WorkerRegistry) ListFailedNodeWorkers(ctx context.Context, takeoverMargin time.Duration) ([]*WorkerRecord, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT w.connection_id, w.company_id, w.tenant_schema, w.database_url, w.pid, w.status, w.started_at, w.last_heartbeat, w.restart_count, w.launch_id, w.desired_state, w.artifact_version, w.artifact_sha256, w.worker_uid, w.worker_gid, w.node_id
		FROM worker_registry w
		WHERE w.node_id IS NOT NULL AND w.node_id <> $1
			AND w.desired_state = 'running'
			AND EXISTS (
				SELECT 1 FROM orchestrator_nodes n
				WHERE n.node_id = w.node_id
					AND n.lease_expires_at + make_interval(secs => $2) <= now()
			)
	`, r.nodeID, takeoverMargin.Seconds())
	if err != nil {
		return nil, fmt.Errorf("list failed-node workers: %w", err)
	}
	return r.scanWorkerRows(rows)
}

// SelectSpawnNode returns the live peer node with the most free worker slots,
// for placing a brand-new connection when this node is at local capacity.
// Existing connections are never moved by placement: node affinity is the
// default because a worker's outbound IP is part of its WhatsApp identity.
func (r *WorkerRegistry) SelectSpawnNode(ctx context.Context) (string, bool, error) {
	var target string
	admissionFilter := ""
	if r.newConnectionAdmission {
		admissionFilter = ` AND EXISTS (SELECT 1 FROM public.runtime_node_admission a
			WHERE a.node_id=n.node_id AND a.accepting_new AND a.expires_at>now()) `
	}
	err := r.db.QueryRowContext(ctx, `
		SELECT n.node_id
		FROM orchestrator_nodes n
		LEFT JOIN (
			SELECT node_id, COUNT(*) AS owned FROM worker_registry GROUP BY node_id
		) w ON w.node_id = n.node_id
		WHERE n.node_id <> $1 AND n.lease_expires_at > now()
			AND (n.max_workers = 0 OR COALESCE(w.owned, 0) < n.max_workers)
		`+admissionFilter+` ORDER BY CASE WHEN n.max_workers = 0 THEN 2147483647
			ELSE n.max_workers - COALESCE(w.owned, 0) END DESC, n.node_id
		LIMIT 1
	`, r.nodeID).Scan(&target)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("select spawn placement node: %w", err)
	}
	return target, true, nil
}

// TakeOverFailedNodeWorker CASes one connection's ownership away from a node
// that has provably self-fenced: the previous owner's lease must still be
// expired past the margin at the moment of transfer, so a node that came back
// and re-registered keeps its workers.
func (r *WorkerRegistry) TakeOverFailedNodeWorker(ctx context.Context, connectionID, previousNodeID string, takeoverMargin time.Duration) (bool, error) {
	// An incoming takeover acquires authority on this host. Unlike recovery of
	// an already-owned launch, it requires a live admission grant when enabled.
	admissionFilter := ""
	if r.newConnectionAdmission {
		admissionFilter = ` AND EXISTS (SELECT 1 FROM public.runtime_node_admission a
			WHERE a.node_id=$1 AND a.accepting_new AND a.expires_at>clock_timestamp()) `
	}
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry w SET node_id = $1
		WHERE w.connection_id = $2 AND w.node_id = $3
			AND w.desired_state = 'running'
			AND EXISTS (
				SELECT 1 FROM orchestrator_nodes n
				WHERE n.node_id = $3 AND n.lease_expires_at + make_interval(secs => $4) <= now()
			)
	`+admissionFilter, r.nodeID, connectionID, previousNodeID, takeoverMargin.Seconds())
	if err != nil {
		return false, fmt.Errorf("take over failed-node worker: %w", err)
	}
	transferred, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect failed-node worker takeover: %w", err)
	}
	return transferred == 1, nil
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

// Called only for exact launches observed fully ready at planned shutdown.
func (r *WorkerRegistry) ResetHealthyLaunchBudgets(ctx context.Context, launches []string) error {
	if len(launches) == 0 {
		return nil
	}
	_, err := r.db.ExecContext(ctx, `UPDATE worker_registry SET restart_count=0
		WHERE node_id=$1 AND launch_id=ANY($2::uuid[]) AND desired_state='running'`, r.nodeID, pq.Array(launches))
	return err
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

// SetDesiredStateAndAbandonHaltedUpgrade atomically gives an acknowledged
// operator stop/unlink authority over a halted rollout. The exact tenant-owned
// launch intent changes in the same transaction that truthfully abandons every
// unfinished batch item, so redelivery cannot resurrect the rollout.
func (r *WorkerRegistry) SetDesiredStateAndAbandonHaltedUpgrade(
	ctx context.Context, connectionID, companyID, tenantSchema, launchID,
	desiredState, reason string,
) (updated, abandoned bool, err error) {
	if desiredState != DesiredStateStopped && desiredState != DesiredStateUnlinking {
		return false, false, fmt.Errorf("invalid authoritative desired state %q", desiredState)
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, false, fmt.Errorf("begin authoritative worker lifecycle intent: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `
		UPDATE worker_registry
		SET desired_state = $1, last_heartbeat = now()
		WHERE connection_id = $2::uuid AND company_id = $3::uuid
			AND tenant_schema = $4 AND launch_id = $5::uuid
	`, desiredState, connectionID, companyID, tenantSchema, launchID)
	if err != nil {
		return false, false, fmt.Errorf("persist authoritative worker lifecycle intent: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, false, fmt.Errorf("inspect authoritative worker lifecycle intent: %w", err)
	}
	if rows != 1 {
		return false, false, nil
	}

	var batchID string
	err = tx.QueryRowContext(ctx, `
		SELECT batch.id::text
		FROM worker_upgrade_batches batch
		JOIN worker_upgrade_items item ON item.batch_id = batch.id
		JOIN worker_registry current ON current.connection_id = item.connection_id
		WHERE batch.phase = 'halted' AND batch.completed_at IS NULL
			AND item.company_id = $1::uuid AND item.tenant_schema = $2
			AND item.connection_id = $3::uuid
			AND current.company_id = item.company_id
			AND current.tenant_schema = item.tenant_schema
			AND current.launch_id = $4::uuid
			AND current.desired_state = $5
		FOR UPDATE OF batch, item, current
	`, companyID, tenantSchema, connectionID, launchID, desiredState).Scan(&batchID)
	if err != nil && err != sql.ErrNoRows {
		return false, false, fmt.Errorf("lock halted rollout for authoritative lifecycle: %w", err)
	}
	if err == nil {
		itemResult, updateErr := tx.ExecContext(ctx, `
			UPDATE worker_upgrade_items
			SET phase = 'abandoned', result = 'abandoned_external',
				last_error = $1, completed_at = now(), updated_at = now()
			WHERE batch_id = $2::uuid AND completed_at IS NULL
		`, reason, batchID)
		if updateErr != nil {
			return false, false, fmt.Errorf("abandon halted rollout items: %w", updateErr)
		}
		itemRows, rowsErr := itemResult.RowsAffected()
		if rowsErr != nil || itemRows < 1 {
			return false, false, fmt.Errorf("abandon halted rollout items affected %d rows: %w", itemRows, rowsErr)
		}
		batchResult, updateErr := tx.ExecContext(ctx, `
			UPDATE worker_upgrade_batches
			SET phase = 'abandoned', result = 'abandoned', last_error = $1,
				completed_at = now(), updated_at = now()
			WHERE id = $2::uuid AND phase = 'halted' AND completed_at IS NULL
		`, reason, batchID)
		if updateErr != nil {
			return false, false, fmt.Errorf("abandon halted rollout batch: %w", updateErr)
		}
		batchRows, rowsErr := batchResult.RowsAffected()
		if rowsErr != nil || batchRows != 1 {
			return false, false, fmt.Errorf("abandon halted rollout batch affected %d rows: %w", batchRows, rowsErr)
		}
		abandoned = true
	}
	if err = tx.Commit(); err != nil {
		return false, false, fmt.Errorf("commit authoritative worker lifecycle intent: %w", err)
	}
	return true, abandoned, nil
}

// NormalizeLegacyWorkerArtifact crosses the migration bootstrap boundary only
// after the caller has proved the old UID-10001 process is gone. The exact
// tenant generation is retained for the following ordinary launch CAS.
func (r *WorkerRegistry) NormalizeLegacyWorkerArtifact(
	ctx context.Context, connectionID, companyID, tenantSchema, launchID,
	artifactVersion, artifactSHA256 string,
) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry
		SET artifact_version = $1, artifact_sha256 = $2,
			artifact_normalized = true, pid = 0, status = 'recovering',
			last_heartbeat = now()
		WHERE connection_id = $3::uuid AND company_id = $4::uuid
			AND tenant_schema = $5 AND launch_id = $6::uuid
			AND NOT artifact_normalized
			AND artifact_version = 'embedded' AND artifact_sha256 = ''
	`, artifactVersion, artifactSHA256, connectionID, companyID, tenantSchema, launchID)
	if err != nil {
		return false, fmt.Errorf("normalize legacy worker artifact: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect legacy worker artifact normalization: %w", err)
	}
	return rows == 1, nil
}

func (r *WorkerRegistry) GetWorker(ctx context.Context, connectionID string) (*WorkerRecord, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state, artifact_version, artifact_sha256, worker_uid, worker_gid, node_id
		FROM worker_registry WHERE connection_id = $1
	`, connectionID)
	w := &WorkerRecord{}
	var nodeID sql.NullString
	err := row.Scan(&w.ConnectionID, &w.CompanyID, &w.TenantSchema, &w.DatabaseURL, &w.PID, &w.Status, &w.StartedAt, &w.LastHeartbeat, &w.RestartCount, &w.LaunchID, &w.DesiredState, &w.ArtifactVersion, &w.ArtifactSHA256, &w.WorkerUID, &w.WorkerGID, &nodeID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get worker: %w", err)
	}
	w.NodeID = nodeID.String
	return w, nil
}

// GetCompanyWorkerArtifact returns the newest successfully completed rollout
// target that included this tenant company. It makes a WhatsApp-only release
// the default for later connections without changing/replacing orchestrator
// configuration.
func (r *WorkerRegistry) GetCompanyWorkerArtifact(ctx context.Context, companyID string) (string, string, bool, error) {
	var version, digest string
	err := r.db.QueryRowContext(ctx, `
		SELECT batch.target_artifact_version, batch.target_artifact_sha256
		FROM worker_upgrade_batches batch
		JOIN worker_upgrade_items item ON item.batch_id = batch.id
		WHERE item.company_id = $1::uuid AND batch.result = 'completed'
			AND batch.completed_at IS NOT NULL
		ORDER BY batch.completed_at DESC
		LIMIT 1
	`, companyID).Scan(&version, &digest)
	if err == sql.ErrNoRows {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, fmt.Errorf("get company worker artifact: %w", err)
	}
	return version, digest, true, nil
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

// CreateWorkerUpgradeBatch persists the batch and every source snapshot in one
// transaction. It commits before returning, so callers can safely send their
// first stop signal only after this method succeeds.
func (r *WorkerRegistry) CreateWorkerUpgradeBatch(
	ctx context.Context,
	targetArtifactVersion, targetArtifactSHA256 string,
	intents []WorkerUpgradeItemIntent,
) (*WorkerUpgradeBatch, error) {
	if len(intents) == 0 {
		return nil, errors.New("worker upgrade batch requires at least one item")
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin worker upgrade batch: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Serialize the fleet-wide normalization gate with legacy writers and new
	// claims. No rollout may snapshot a partially normalized source fleet.
	if _, err = tx.ExecContext(ctx, `LOCK TABLE worker_registry IN SHARE MODE`); err != nil {
		return nil, fmt.Errorf("lock worker registry for upgrade snapshot: %w", err)
	}
	var unnormalized int
	if err = tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM worker_registry
		WHERE desired_state = 'running' AND NOT artifact_normalized
	`).Scan(&unnormalized); err != nil {
		return nil, fmt.Errorf("inspect worker artifact normalization: %w", err)
	}
	if unnormalized != 0 {
		return nil, fmt.Errorf("%w: %d desired-running row(s)", ErrWorkerArtifactNormalization, unnormalized)
	}

	batch := &WorkerUpgradeBatch{Items: make([]*WorkerUpgradeItem, 0, len(intents))}
	var completedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `
		INSERT INTO worker_upgrade_batches (
			target_artifact_version, target_artifact_sha256
		) VALUES ($1, $2)
		RETURNING id::text, target_artifact_version, target_artifact_sha256,
			phase, COALESCE(result, ''), COALESCE(last_error, ''),
			created_at, updated_at, completed_at
	`, targetArtifactVersion, targetArtifactSHA256).Scan(
		&batch.ID, &batch.TargetArtifactVersion, &batch.TargetArtifactSHA256,
		&batch.Phase, &batch.Result, &batch.LastError,
		&batch.CreatedAt, &batch.UpdatedAt, &completedAt,
	)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" && pqErr.Constraint == "worker_upgrade_batches_one_active_idx" {
			return nil, ErrWorkerUpgradeBatchActive
		}
		return nil, fmt.Errorf("create worker upgrade batch: %w", err)
	}
	batch.CompletedAt = nullableTime(completedAt)

	for _, intent := range intents {
		item := &WorkerUpgradeItem{}
		var itemCompletedAt sql.NullTime
		err = tx.QueryRowContext(ctx, `
			INSERT INTO worker_upgrade_items (
				batch_id, position, company_id, tenant_schema, connection_id,
				source_generation, source_artifact_version, source_artifact_sha256
			)
			SELECT $1::uuid, $2, $3::uuid, $4::varchar(100), $5::uuid, $6::uuid,
				$7::varchar(128), $8::varchar(64)
			FROM worker_registry
			WHERE company_id = $3::uuid AND tenant_schema = $4::varchar(100)
				AND connection_id = $5::uuid AND launch_id = $6::uuid
				AND desired_state = 'running'
				AND artifact_version = $7::varchar(128)
				AND artifact_sha256 = $8::varchar(64)
				AND artifact_normalized
			FOR UPDATE
			RETURNING id::text, batch_id::text, position, company_id::text,
				tenant_schema, connection_id::text, source_generation::text,
				source_artifact_version, source_artifact_sha256,
				COALESCE(target_generation::text, ''),
				COALESCE(recovery_generation::text, ''),
				COALESCE(rollback_generation::text, ''),
				phase, COALESCE(result, ''), COALESCE(last_error, ''),
				created_at, updated_at, completed_at
		`, batch.ID, intent.Position, intent.CompanyID, intent.TenantSchema,
			intent.ConnectionID, intent.SourceGeneration,
			intent.SourceArtifactVersion, intent.SourceArtifactSHA256).Scan(
			&item.ID, &item.BatchID, &item.Position, &item.CompanyID,
			&item.TenantSchema, &item.ConnectionID, &item.SourceGeneration,
			&item.SourceArtifactVersion, &item.SourceArtifactSHA256,
			&item.TargetGeneration, &item.RecoveryGeneration, &item.RollbackGeneration,
			&item.Phase, &item.Result, &item.LastError,
			&item.CreatedAt, &item.UpdatedAt, &itemCompletedAt,
		)
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("%w: company=%s tenant=%s connection=%s generation=%s",
				ErrWorkerUpgradeSnapshotConflict, intent.CompanyID, intent.TenantSchema,
				intent.ConnectionID, intent.SourceGeneration)
		}
		if err != nil {
			return nil, fmt.Errorf("create worker upgrade item for connection %s: %w", intent.ConnectionID, err)
		}
		item.CompletedAt = nullableTime(itemCompletedAt)
		batch.Items = append(batch.Items, item)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit worker upgrade batch: %w", err)
	}
	return batch, nil
}

func nullableTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}

func scanWorkerUpgradeBatch(row *sql.Row) (*WorkerUpgradeBatch, error) {
	batch := &WorkerUpgradeBatch{}
	var completedAt sql.NullTime
	err := row.Scan(
		&batch.ID, &batch.TargetArtifactVersion, &batch.TargetArtifactSHA256,
		&batch.Phase, &batch.Result, &batch.LastError,
		&batch.CreatedAt, &batch.UpdatedAt, &completedAt,
	)
	if err != nil {
		return nil, err
	}
	batch.CompletedAt = nullableTime(completedAt)
	return batch, nil
}

func (r *WorkerRegistry) loadWorkerUpgradeItems(ctx context.Context, batchID string) ([]*WorkerUpgradeItem, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id::text, batch_id::text, position, company_id::text,
			tenant_schema, connection_id::text, source_generation::text,
			source_artifact_version, source_artifact_sha256,
			COALESCE(target_generation::text, ''),
			COALESCE(recovery_generation::text, ''),
			COALESCE(rollback_generation::text, ''),
			phase, COALESCE(result, ''), COALESCE(last_error, ''),
			created_at, updated_at, completed_at
		FROM worker_upgrade_items WHERE batch_id = $1::uuid
		ORDER BY position
	`, batchID)
	if err != nil {
		return nil, fmt.Errorf("query worker upgrade items: %w", err)
	}
	defer rows.Close()
	items := make([]*WorkerUpgradeItem, 0)
	for rows.Next() {
		item := &WorkerUpgradeItem{}
		var completedAt sql.NullTime
		if err := rows.Scan(
			&item.ID, &item.BatchID, &item.Position, &item.CompanyID,
			&item.TenantSchema, &item.ConnectionID, &item.SourceGeneration,
			&item.SourceArtifactVersion, &item.SourceArtifactSHA256,
			&item.TargetGeneration, &item.RecoveryGeneration, &item.RollbackGeneration,
			&item.Phase, &item.Result, &item.LastError,
			&item.CreatedAt, &item.UpdatedAt, &completedAt,
		); err != nil {
			return nil, fmt.Errorf("scan worker upgrade item: %w", err)
		}
		item.CompletedAt = nullableTime(completedAt)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate worker upgrade items: %w", err)
	}
	return items, nil
}

// GetWorkerUpgradeBatch provides status for a specific durable batch.
func (r *WorkerRegistry) GetWorkerUpgradeBatch(ctx context.Context, batchID string) (*WorkerUpgradeBatch, error) {
	batch, err := scanWorkerUpgradeBatch(r.db.QueryRowContext(ctx, `
		SELECT id::text, target_artifact_version, target_artifact_sha256,
			phase, COALESCE(result, ''), COALESCE(last_error, ''),
			created_at, updated_at, completed_at
		FROM worker_upgrade_batches WHERE id = $1::uuid
	`, batchID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get worker upgrade batch: %w", err)
	}
	batch.Items, err = r.loadWorkerUpgradeItems(ctx, batch.ID)
	if err != nil {
		return nil, err
	}
	return batch, nil
}

// GetActiveWorkerUpgradeBatch is the crash-recovery entry point. A halted batch
// remains active and is returned until an operator resumes and completes it.
func (r *WorkerRegistry) GetActiveWorkerUpgradeBatch(ctx context.Context) (*WorkerUpgradeBatch, error) {
	batch, err := scanWorkerUpgradeBatch(r.db.QueryRowContext(ctx, `
		SELECT id::text, target_artifact_version, target_artifact_sha256,
			phase, COALESCE(result, ''), COALESCE(last_error, ''),
			created_at, updated_at, completed_at
		FROM worker_upgrade_batches WHERE completed_at IS NULL
	`))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get active worker upgrade batch: %w", err)
	}
	batch.Items, err = r.loadWorkerUpgradeItems(ctx, batch.ID)
	if err != nil {
		return nil, err
	}
	return batch, nil
}

func (r *WorkerRegistry) AdvanceWorkerUpgradeBatch(
	ctx context.Context, batchID, expectedPhase, nextPhase, lastError string,
) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_upgrade_batches
		SET phase = $1, last_error = NULLIF($2, ''), updated_at = now()
		WHERE id = $3::uuid AND phase = $4 AND completed_at IS NULL
	`, nextPhase, lastError, batchID, expectedPhase)
	if err != nil {
		return false, fmt.Errorf("advance worker upgrade batch: %w", err)
	}
	updated, err := result.RowsAffected()
	return updated == 1, err
}

func (r *WorkerRegistry) AdvanceWorkerUpgradeItem(
	ctx context.Context,
	batchID, companyID, tenantSchema, connectionID, sourceGeneration,
	expectedPhase, nextPhase, targetGeneration, lastError string,
) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_upgrade_items
		SET phase = $1,
			target_generation = COALESCE(NULLIF($2, '')::uuid, target_generation),
			last_error = NULLIF($3, ''), updated_at = now()
		WHERE batch_id = $4::uuid AND company_id = $5::uuid
			AND tenant_schema = $6 AND connection_id = $7::uuid
			AND source_generation = $8::uuid AND phase = $9
			AND completed_at IS NULL
			AND ($9 <> 'stop' OR EXISTS (
				SELECT 1 FROM worker_registry source
				WHERE source.connection_id = worker_upgrade_items.connection_id
					AND source.company_id = worker_upgrade_items.company_id
					AND source.tenant_schema = worker_upgrade_items.tenant_schema
					AND source.launch_id = worker_upgrade_items.source_generation
					AND source.desired_state = 'running'
					AND source.artifact_version = worker_upgrade_items.source_artifact_version
					AND source.artifact_sha256 = worker_upgrade_items.source_artifact_sha256
			))
	`, nextPhase, targetGeneration, lastError, batchID, companyID, tenantSchema,
		connectionID, sourceGeneration, expectedPhase)
	if err != nil {
		return false, fmt.Errorf("advance worker upgrade item: %w", err)
	}
	updated, err := result.RowsAffected()
	return updated == 1, err
}

// ReserveWorkerUpgradeGeneration records a planned launch before its registry
// CAS. A crash can therefore distinguish a rollout-owned launch from an
// unrelated process that happens to use the same artifact.
func (r *WorkerRegistry) ReserveWorkerUpgradeGeneration(
	ctx context.Context, batchID, companyID, tenantSchema, connectionID,
	sourceGeneration, phase, column, generation string,
) (bool, error) {
	if column != "target_generation" && column != "recovery_generation" && column != "rollback_generation" {
		return false, fmt.Errorf("invalid rollout generation column %q", column)
	}
	query := fmt.Sprintf(`
		UPDATE worker_upgrade_items item
		SET %s = $1::uuid, updated_at = now()
		FROM worker_upgrade_batches batch
		WHERE item.batch_id = batch.id AND batch.id = $2::uuid
			AND item.company_id = $3::uuid AND item.tenant_schema = $4
			AND item.connection_id = $5::uuid AND item.source_generation = $6::uuid
			AND item.phase = $7 AND item.completed_at IS NULL
			AND batch.completed_at IS NULL AND batch.phase <> 'halted'
			AND %s IS NULL
	`, column, column)
	result, err := r.db.ExecContext(ctx, query, generation, batchID, companyID,
		tenantSchema, connectionID, sourceGeneration, phase)
	if err != nil {
		return false, fmt.Errorf("reserve %s: %w", column, err)
	}
	updated, err := result.RowsAffected()
	return updated == 1, err
}

// FenceWorkerUpgradeOwnedLaunch atomically confirms the exact live registry
// generation immediately before the rollout signals or CAS-replaces it.
func (r *WorkerRegistry) FenceWorkerUpgradeOwnedLaunch(
	ctx context.Context, batchID, companyID, tenantSchema, connectionID,
	sourceGeneration, itemPhase string, fence WorkerUpgradeLiveFence,
) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_registry current
		SET status = 'recovering', last_heartbeat = now()
		FROM worker_upgrade_items item, worker_upgrade_batches batch
		WHERE item.batch_id = batch.id AND batch.id = $1::uuid
			AND item.company_id = $2::uuid AND item.tenant_schema = $3
			AND item.connection_id = $4::uuid AND item.source_generation = $5::uuid
			AND item.phase = $6 AND item.completed_at IS NULL
			AND batch.completed_at IS NULL
			AND current.connection_id = item.connection_id
			AND current.company_id = item.company_id
			AND current.tenant_schema = item.tenant_schema
			AND current.launch_id = $7::uuid AND current.desired_state = 'running'
			AND current.artifact_version = $8 AND current.artifact_sha256 = $9
			AND current.worker_uid = $10 AND current.worker_gid = $11
			AND current.worker_uid BETWEEN 100000 AND 2147483646
	`, batchID, companyID, tenantSchema, connectionID, sourceGeneration,
		itemPhase, fence.LaunchID, fence.ArtifactVersion, fence.ArtifactSHA256,
		fence.WorkerUID, fence.WorkerGID)
	if err != nil {
		return false, fmt.Errorf("fence rollout-owned worker launch: %w", err)
	}
	updated, err := result.RowsAffected()
	return updated == 1, err
}

// BeginWorkerUpgradeVerifyRefresh durably records that the exact target
// generation must be replaced to mint fresh, in-memory readiness authority.
func (r *WorkerRegistry) BeginWorkerUpgradeVerifyRefresh(
	ctx context.Context, batchID, companyID, tenantSchema, connectionID,
	sourceGeneration, targetGeneration string,
) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_upgrade_items item
		SET phase = 'recovery', recovery_generation = NULL, updated_at = now()
		FROM worker_upgrade_batches batch
		WHERE item.batch_id = batch.id AND batch.id = $1::uuid
			AND item.company_id = $2::uuid AND item.tenant_schema = $3
			AND item.connection_id = $4::uuid
			AND item.source_generation = $5::uuid
			AND item.target_generation = $6::uuid
			AND item.phase = 'verify' AND item.completed_at IS NULL
			AND batch.completed_at IS NULL AND batch.phase <> 'halted'
	`, batchID, companyID, tenantSchema, connectionID, sourceGeneration, targetGeneration)
	if err != nil {
		return false, fmt.Errorf("begin worker verify authority refresh: %w", err)
	}
	updated, err := result.RowsAffected()
	return updated == 1, err
}

// CompleteWorkerUpgradeVerifyRefresh accepts only the exact currently claimed
// target launch with the batch's immutable digest and durable Linux identity.
func (r *WorkerRegistry) CompleteWorkerUpgradeVerifyRefresh(
	ctx context.Context, batchID, companyID, tenantSchema, connectionID,
	sourceGeneration, previousTargetGeneration, refreshedTargetGeneration string,
) (bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin worker verify authority refresh completion: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var itemID string
	err = tx.QueryRowContext(ctx, `
		SELECT item.id::text
		FROM worker_upgrade_items item
		JOIN worker_upgrade_batches batch ON batch.id = item.batch_id
		JOIN worker_registry current ON current.connection_id = item.connection_id
		WHERE batch.id = $1::uuid
			AND item.company_id = $2::uuid AND item.tenant_schema = $3
			AND item.connection_id = $4::uuid
			AND item.source_generation = $5::uuid
			AND item.target_generation = $6::uuid
			AND item.recovery_generation = $7::uuid
			AND item.phase = 'recovery' AND item.completed_at IS NULL
			AND batch.completed_at IS NULL AND batch.phase <> 'halted'
			AND current.company_id = item.company_id
			AND current.tenant_schema = item.tenant_schema
			AND current.launch_id = $7::uuid
			AND current.desired_state = 'running'
			AND current.artifact_version = batch.target_artifact_version
			AND current.artifact_sha256 = batch.target_artifact_sha256
			AND current.worker_uid BETWEEN 100000 AND 2147483646
			AND current.worker_gid = current.worker_uid
		FOR UPDATE OF batch, item, current
	`, batchID, companyID, tenantSchema, connectionID, sourceGeneration,
		previousTargetGeneration, refreshedTargetGeneration).Scan(&itemID)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock exact worker verify authority refresh: %w", err)
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE worker_upgrade_items
		SET phase = 'verify', target_generation = $1::uuid,
			recovery_generation = NULL, updated_at = now()
		WHERE id = $2::uuid AND phase = 'recovery'
			AND recovery_generation = $1::uuid AND completed_at IS NULL
	`, refreshedTargetGeneration, itemID)
	if err != nil {
		return false, fmt.Errorf("complete worker verify authority refresh: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil || updated != 1 {
		return false, fmt.Errorf("complete worker verify authority refresh affected %d rows: %w", updated, err)
	}
	if err = tx.Commit(); err != nil {
		return false, fmt.Errorf("commit worker verify authority refresh: %w", err)
	}
	return true, nil
}

// BeginWorkerUpgradeRollback atomically changes the whole batch: the failed
// item and every prior target-complete item become pending rollback in reverse
// order, while untouched later items are terminally canceled in the same tx.
func (r *WorkerRegistry) BeginWorkerUpgradeRollback(
	ctx context.Context, batchID, companyID, tenantSchema, connectionID,
	sourceGeneration, expectedPhase, targetGeneration, lastError string,
) (bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin batch-wide worker rollback: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var position int
	err = tx.QueryRowContext(ctx, `
		SELECT item.position
		FROM worker_upgrade_items item
		JOIN worker_upgrade_batches batch ON batch.id = item.batch_id
		WHERE batch.id = $1::uuid AND item.company_id = $2::uuid
			AND item.tenant_schema = $3 AND item.connection_id = $4::uuid
			AND item.source_generation = $5::uuid AND item.phase = $6
			AND item.completed_at IS NULL AND batch.completed_at IS NULL
			AND batch.phase <> 'halted'
			AND NOT EXISTS (
				SELECT 1 FROM worker_upgrade_items future
				WHERE future.batch_id = item.batch_id
					AND future.position > item.position
					AND future.completed_at IS NULL
					AND (future.phase <> 'stop' OR future.target_generation IS NOT NULL)
			)
		FOR UPDATE OF batch, item
	`, batchID, companyID, tenantSchema, connectionID, sourceGeneration, expectedPhase).Scan(&position)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock failed worker upgrade item: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `
		UPDATE worker_upgrade_batches
		SET phase = 'rollback', last_error = $1, updated_at = now()
		WHERE id = $2::uuid AND completed_at IS NULL
	`, lastError, batchID); err != nil {
		return false, fmt.Errorf("persist batch rollback intent: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `
		UPDATE worker_upgrade_items
		SET phase = 'rollback', result = NULL, completed_at = NULL,
			target_generation = COALESCE(NULLIF($1, '')::uuid, target_generation),
			last_error = $2, updated_at = now()
		WHERE batch_id = $3::uuid AND company_id = $4::uuid
			AND tenant_schema = $5 AND connection_id = $6::uuid
			AND source_generation = $7::uuid AND phase = $8
	`, targetGeneration, lastError, batchID, companyID, tenantSchema,
		connectionID, sourceGeneration, expectedPhase); err != nil {
		return false, fmt.Errorf("persist failed item rollback intent: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `
		UPDATE worker_upgrade_items
		SET phase = 'rollback', result = NULL, completed_at = NULL,
			last_error = $1, updated_at = now()
		WHERE batch_id = $2::uuid AND position < $3
			AND result = 'target_complete' AND completed_at IS NOT NULL
	`, lastError, batchID, position); err != nil {
		return false, fmt.Errorf("reopen prior target items for rollback: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `
		UPDATE worker_upgrade_items
		SET phase = 'canceled', result = 'canceled_untouched',
			last_error = $1, completed_at = now(), updated_at = now()
		WHERE batch_id = $2::uuid AND position > $3
			AND phase = 'stop' AND target_generation IS NULL
			AND completed_at IS NULL
	`, lastError, batchID, position); err != nil {
		return false, fmt.Errorf("cancel untouched worker upgrade items: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return false, fmt.Errorf("commit batch-wide worker rollback: %w", err)
	}
	return true, nil
}

// HaltWorkerUpgrade atomically records the actionable item and batch error. It
// never leaves one side halted while the other remains runnable.
func (r *WorkerRegistry) HaltWorkerUpgrade(
	ctx context.Context, batchID, companyID, tenantSchema, connectionID,
	sourceGeneration, expectedItemPhase, expectedBatchPhase, targetGeneration,
	lastError string,
) (bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin worker upgrade halt: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var itemID string
	err = tx.QueryRowContext(ctx, `
		SELECT item.id::text
		FROM worker_upgrade_items item
		JOIN worker_upgrade_batches batch ON batch.id = item.batch_id
		WHERE batch.id = $1::uuid AND item.company_id = $2::uuid
			AND item.tenant_schema = $3 AND item.connection_id = $4::uuid
			AND item.source_generation = $5::uuid
			AND item.phase = $6 AND item.completed_at IS NULL
			AND batch.phase = $7 AND batch.completed_at IS NULL
		FOR UPDATE OF batch, item
	`, batchID, companyID, tenantSchema, connectionID, sourceGeneration,
		expectedItemPhase, expectedBatchPhase).Scan(&itemID)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock worker upgrade halt: %w", err)
	}
	itemResult, err := tx.ExecContext(ctx, `
		UPDATE worker_upgrade_items
		SET phase = 'halted',
			target_generation = COALESCE(NULLIF($1, '')::uuid, target_generation),
			last_error = $2, updated_at = now()
		WHERE id = $3::uuid AND phase = $4 AND completed_at IS NULL
	`, targetGeneration, lastError, itemID, expectedItemPhase)
	if err != nil {
		return false, fmt.Errorf("halt worker upgrade item: %w", err)
	}
	itemRows, err := itemResult.RowsAffected()
	if err != nil || itemRows != 1 {
		return false, fmt.Errorf("halt worker upgrade item affected %d rows: %w", itemRows, err)
	}
	batchResult, err := tx.ExecContext(ctx, `
		UPDATE worker_upgrade_batches
		SET phase = 'halted', last_error = $1, updated_at = now()
		WHERE id = $2::uuid AND phase = $3 AND completed_at IS NULL
	`, lastError, batchID, expectedBatchPhase)
	if err != nil {
		return false, fmt.Errorf("halt worker upgrade batch: %w", err)
	}
	batchRows, err := batchResult.RowsAffected()
	if err != nil || batchRows != 1 {
		return false, fmt.Errorf("halt worker upgrade batch affected %d rows: %w", batchRows, err)
	}
	if err = tx.Commit(); err != nil {
		return false, fmt.Errorf("commit worker upgrade halt: %w", err)
	}
	return true, nil
}

// ResumeHaltedWorkerUpgradeRollback atomically reopens exactly one halted item
// and its halted batch. Immutable tenant/source-generation columns remain the
// fence used by the resumed rollback state machine.
func (r *WorkerRegistry) ResumeHaltedWorkerUpgradeRollback(ctx context.Context, batchID, connectionID string) (bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin halted worker upgrade recovery: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var itemID string
	err = tx.QueryRowContext(ctx, `
		SELECT item.id::text
		FROM worker_upgrade_items item
		JOIN worker_upgrade_batches batch ON batch.id = item.batch_id
		WHERE batch.id = $1::uuid AND item.connection_id = $2::uuid
			AND batch.phase = 'halted' AND batch.completed_at IS NULL
			AND item.phase = 'halted' AND item.completed_at IS NULL
			AND EXISTS (
				SELECT 1 FROM worker_registry current
				WHERE current.connection_id = item.connection_id
					AND current.company_id = item.company_id
					AND current.tenant_schema = item.tenant_schema
					AND current.desired_state = 'running'
					AND current.worker_uid BETWEEN 100000 AND 2147483646
					AND current.worker_gid = current.worker_uid
					AND (
						(current.launch_id = item.rollback_generation
						 AND current.artifact_version = item.source_artifact_version
						 AND current.artifact_sha256 = item.source_artifact_sha256)
					 OR (current.launch_id = item.recovery_generation
						 AND current.artifact_version = batch.target_artifact_version
						 AND current.artifact_sha256 = batch.target_artifact_sha256)
					 OR (current.launch_id = item.target_generation
						 AND current.artifact_version = batch.target_artifact_version
						 AND current.artifact_sha256 = batch.target_artifact_sha256)
					 OR (current.launch_id = item.source_generation
						 AND current.artifact_version = item.source_artifact_version
						 AND current.artifact_sha256 = item.source_artifact_sha256)
					)
			)
		FOR UPDATE OF batch, item
	`, batchID, connectionID).Scan(&itemID)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock halted worker upgrade rollback: %w", err)
	}
	itemResult, err := tx.ExecContext(ctx, `
		UPDATE worker_upgrade_items
		SET phase = 'rollback', last_error = NULL, updated_at = now()
		WHERE id = $1::uuid AND phase = 'halted' AND completed_at IS NULL
	`, itemID)
	if err != nil {
		return false, fmt.Errorf("resume halted worker upgrade item: %w", err)
	}
	itemRows, err := itemResult.RowsAffected()
	if err != nil || itemRows != 1 {
		return false, fmt.Errorf("resume halted worker item affected %d rows: %w", itemRows, err)
	}
	batchResult, err := tx.ExecContext(ctx, `
		UPDATE worker_upgrade_batches
		SET phase = 'rollback', last_error = NULL, updated_at = now()
		WHERE id = $1::uuid AND phase = 'halted' AND completed_at IS NULL
	`, batchID)
	if err != nil {
		return false, fmt.Errorf("resume halted worker upgrade batch: %w", err)
	}
	batchRows, err := batchResult.RowsAffected()
	if err != nil || batchRows != 1 {
		return false, fmt.Errorf("resume halted worker batch affected %d rows: %w", batchRows, err)
	}
	if err = tx.Commit(); err != nil {
		return false, fmt.Errorf("commit halted worker upgrade recovery: %w", err)
	}
	return true, nil
}

func (r *WorkerRegistry) CompleteWorkerUpgradeItem(
	ctx context.Context,
	batchID, companyID, tenantSchema, connectionID, sourceGeneration,
	expectedPhase string, fence WorkerUpgradeLiveFence,
) (bool, error) {
	itemResult := ""
	switch expectedPhase {
	case WorkerUpgradePhaseVerify:
		itemResult = WorkerUpgradeItemResultTargetComplete
	case WorkerUpgradePhaseRollback:
		itemResult = WorkerUpgradeItemResultRollbackComplete
	default:
		return false, fmt.Errorf("phase %q cannot complete a worker upgrade item", expectedPhase)
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin worker upgrade item completion: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var itemID string
	err = tx.QueryRowContext(ctx, `
		SELECT item.id::text
		FROM worker_upgrade_items item
		JOIN worker_upgrade_batches batch ON batch.id = item.batch_id
		JOIN worker_registry current ON current.connection_id = item.connection_id
		WHERE batch.id = $1::uuid
			AND item.company_id = $2::uuid AND item.tenant_schema = $3
			AND item.connection_id = $4::uuid AND item.source_generation = $5::uuid
			AND item.phase = $6 AND item.completed_at IS NULL AND item.result IS NULL
			AND batch.completed_at IS NULL
			AND (($6 = 'verify' AND item.target_generation = $7::uuid
				AND batch.target_artifact_version = $8
				AND batch.target_artifact_sha256 = $9)
			 OR ($6 = 'rollback' AND item.rollback_generation = $7::uuid
				AND item.source_artifact_version = $8
				AND item.source_artifact_sha256 = $9))
			AND current.company_id = item.company_id
			AND current.tenant_schema = item.tenant_schema
			AND current.launch_id = $7::uuid
			AND current.desired_state = 'running'
			AND current.artifact_version = $8
			AND current.artifact_sha256 = $9
			AND current.worker_uid = $10 AND current.worker_gid = $11
			AND current.worker_uid BETWEEN 100000 AND 2147483646
		FOR UPDATE OF batch, item, current
	`, batchID, companyID, tenantSchema, connectionID, sourceGeneration,
		expectedPhase, fence.LaunchID, fence.ArtifactVersion, fence.ArtifactSHA256,
		fence.WorkerUID, fence.WorkerGID).Scan(&itemID)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock exact live worker upgrade completion: %w", err)
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE worker_upgrade_items
		SET result = $1, completed_at = now(), updated_at = now()
		WHERE id = $2::uuid AND phase = $3
			AND completed_at IS NULL AND result IS NULL
	`, itemResult, itemID, expectedPhase)
	if err != nil {
		return false, fmt.Errorf("complete worker upgrade item: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil || updated != 1 {
		return false, fmt.Errorf("complete worker upgrade item affected %d rows: %w", updated, err)
	}
	if err = tx.Commit(); err != nil {
		return false, fmt.Errorf("commit worker upgrade item completion: %w", err)
	}
	return true, nil
}

func (r *WorkerRegistry) CompleteWorkerUpgradeBatch(
	ctx context.Context, batchID, expectedPhase, resultValue string,
) (bool, error) {
	if resultValue != "completed" && resultValue != "rolled_back" {
		return false, fmt.Errorf("invalid worker upgrade batch result %q", resultValue)
	}
	result, err := r.db.ExecContext(ctx, `
		UPDATE worker_upgrade_batches batch
		SET result = $1,
			phase = CASE WHEN $1 = 'completed' THEN 'verify' ELSE 'rollback' END,
			completed_at = now(), updated_at = now()
		WHERE batch.id = $2::uuid AND batch.phase = $3
			AND batch.completed_at IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM worker_upgrade_items item
				WHERE item.batch_id = batch.id AND (
					item.completed_at IS NULL OR
					($1 = 'completed' AND item.result <> 'target_complete') OR
					($1 = 'rolled_back' AND item.result NOT IN
						('rollback_complete', 'canceled_untouched'))
				)
			)
	`, resultValue, batchID, expectedPhase)
	if err != nil {
		return false, fmt.Errorf("complete worker upgrade batch: %w", err)
	}
	updated, err := result.RowsAffected()
	return updated == 1, err
}
