package manager

import (
	"context"
	"os/exec"
	"sync"
	"time"
)

// WorkerProcess represents a managed WhatsApp worker.
type WorkerProcess struct {
	ID                  string
	LaunchID            string // unique identity for this particular process launch
	DesiredState        string // durable operator intent (running or stopped)
	CompanyID           string
	ConnectionID        string
	TenantSchema        string
	DatabaseURL         string
	Status              string
	PID                 int
	StartedAt           time.Time
	LastActivity        time.Time
	RestartCount        int       // Number of restart attempts
	LastCrashAt         time.Time // When last crash occurred
	ArtifactVersion     string
	ArtifactSHA256      string
	BinaryPath          string
	WorkerUID           int // durable, generation-specific unprivileged Linux identity
	WorkerGID           int
	ProcessReady        bool
	RuntimeConnected    bool
	Authenticated       bool
	LastRuntimeSignalAt time.Time   // strictly monotonic per launch/readiness token
	runtimeStatusMu     *sync.Mutex // serializes durable runtime edges for this generation
	ExpectedExit        bool        // Suppresses crash handling in monitorWorkerProcess.
	RemoveOnExit        bool        // One-shot unlink workers remove themselves on exit.
	cmd                 *exec.Cmd
	healthCancel        context.CancelFunc
	done                chan struct{} // closed after cmd.Wait() reaps the process
	exitErr             error         // cmd.Wait result, published before done closes
	readinessToken      string        // per-launch HMAC key; never exposed by status APIs
}

// Copy returns a shallow copy of the worker process without internal fields.
// Use this to safely return worker info outside of mutex-protected code.
func (w *WorkerProcess) Copy() *WorkerProcess {
	return &WorkerProcess{
		ID:                  w.ID,
		LaunchID:            w.LaunchID,
		DesiredState:        w.DesiredState,
		CompanyID:           w.CompanyID,
		ConnectionID:        w.ConnectionID,
		TenantSchema:        w.TenantSchema,
		DatabaseURL:         w.DatabaseURL,
		Status:              w.Status,
		PID:                 w.PID,
		StartedAt:           w.StartedAt,
		LastActivity:        w.LastActivity,
		RestartCount:        w.RestartCount,
		LastCrashAt:         w.LastCrashAt,
		ArtifactVersion:     w.ArtifactVersion,
		ArtifactSHA256:      w.ArtifactSHA256,
		BinaryPath:          w.BinaryPath,
		WorkerUID:           w.WorkerUID,
		WorkerGID:           w.WorkerGID,
		ProcessReady:        w.ProcessReady,
		RuntimeConnected:    w.RuntimeConnected,
		Authenticated:       w.Authenticated,
		LastRuntimeSignalAt: w.LastRuntimeSignalAt,
		ExpectedExit:        w.ExpectedExit,
		RemoveOnExit:        w.RemoveOnExit,
	}
}

// GetWorkerStatus returns the status of a specific worker by connectionID.
func (m *Manager) GetWorkerStatus(connectionID string) (*WorkerProcess, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	worker, exists := m.workers[connectionID]
	if !exists {
		return nil, false
	}

	// Return a copy to avoid race conditions
	return worker.Copy(), true
}

// ListWorkers returns all managed workers.
func (m *Manager) ListWorkers() []*WorkerProcess {
	m.mu.RLock()
	defer m.mu.RUnlock()

	workers := make([]*WorkerProcess, 0, len(m.workers))
	for _, w := range m.workers {
		workers = append(workers, w.Copy())
	}
	return workers
}

// ListWorkersByCompany returns all workers for a specific company.
func (m *Manager) ListWorkersByCompany(companyID string) []*WorkerProcess {
	m.mu.RLock()
	defer m.mu.RUnlock()

	workers := make([]*WorkerProcess, 0)
	for _, w := range m.workers {
		if w.CompanyID == companyID {
			workers = append(workers, w.Copy())
		}
	}
	return workers
}

// FleetWorker pairs a durable registry record with this node's live runtime
// view when the record is owned and tracked locally.
type FleetWorker struct {
	Record *WorkerRecord
	Local  *WorkerProcess
}

// ListFleetWorkers returns the durable fleet-wide worker view, so an operator
// sees every node's connections rather than one instance's memory. Locally
// owned rows are enriched with this node's runtime state. Returns nil with no
// error when no registry is configured.
func (m *Manager) ListFleetWorkers(ctx context.Context) ([]*FleetWorker, error) {
	if m.registry == nil {
		return nil, nil
	}
	records, err := m.registry.GetAllWorkers(ctx)
	if err != nil {
		return nil, err
	}
	fleet := make([]*FleetWorker, 0, len(records))
	for _, record := range records {
		fleetWorker := &FleetWorker{Record: record}
		if worker, exists := m.GetWorkerStatus(record.ConnectionID); exists && worker.LaunchID == record.LaunchID {
			fleetWorker.Local = worker
		}
		fleet = append(fleet, fleetWorker)
	}
	return fleet, nil
}

// GetFleetWorker returns one connection's durable record with local runtime
// enrichment. Returns nil, nil when no registry is configured or no row exists.
func (m *Manager) GetFleetWorker(ctx context.Context, connectionID string) (*FleetWorker, error) {
	if m.registry == nil {
		return nil, nil
	}
	record, err := m.registry.GetWorker(ctx, connectionID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, nil
	}
	fleetWorker := &FleetWorker{Record: record}
	if worker, exists := m.GetWorkerStatus(record.ConnectionID); exists && worker.LaunchID == record.LaunchID {
		fleetWorker.Local = worker
	}
	return fleetWorker, nil
}

// ListOrchestratorNodes reports every registered node lease. Returns nil with
// no error when no registry is configured.
func (m *Manager) ListOrchestratorNodes(ctx context.Context) ([]*OrchestratorNode, error) {
	if m.registry == nil {
		return nil, nil
	}
	return m.registry.ListNodes(ctx)
}

// NodeID reports this instance's configured node identity.
func (m *Manager) NodeID() string {
	return m.config.NodeID
}

// UpdateWorkerStatus updates the status of a worker (called by handlers).
func (m *Manager) UpdateWorkerStatus(connectionID, status string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if worker, exists := m.workers[connectionID]; exists {
		worker.Status = status
		worker.LastActivity = time.Now()
	}
}

// UpdateWorkerActivity updates the last activity time of a worker.
func (m *Manager) UpdateWorkerActivity(connectionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if worker, exists := m.workers[connectionID]; exists {
		worker.LastActivity = time.Now()
	}
}

// GetStartedAt returns when the manager was started.
func (m *Manager) GetStartedAt() time.Time {
	return m.startedAt
}

// WorkerCount returns the number of active workers.
func (m *Manager) WorkerCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.workers)
}
