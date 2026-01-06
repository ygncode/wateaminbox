package manager

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// Config holds the configuration for the process manager.
type Config struct {
	NATSClient          *nats.Client
	WhatsAppBinaryPath  string
	DefaultNATSURL      string
	HealthCheckInterval time.Duration
}

// Manager handles WhatsApp worker process lifecycle.
type Manager struct {
	config       Config
	mu           sync.RWMutex
	workers      map[string]*WorkerProcess // keyed by connectionID
	ctx          context.Context
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	handlers     *Handlers
	startedAt    time.Time
	shuttingDown bool // prevents NATS publishes during shutdown
}

// WorkerProcess represents a managed WhatsApp worker.
type WorkerProcess struct {
	ID           string
	CompanyID    string
	ConnectionID string
	TenantSchema string
	DatabaseURL  string
	Status       string
	PID          int
	StartedAt    time.Time
	LastActivity time.Time
	cmd          *exec.Cmd
	cancelFunc   context.CancelFunc
	healthCancel context.CancelFunc
}

// New creates a new process manager.
func New(cfg Config) *Manager {
	if cfg.HealthCheckInterval == 0 {
		cfg.HealthCheckInterval = 30 * time.Second
	}
	if cfg.WhatsAppBinaryPath == "" {
		cfg.WhatsAppBinaryPath = "/usr/local/bin/whatsapp-worker"
	}
	if cfg.DefaultNATSURL == "" {
		cfg.DefaultNATSURL = "nats://localhost:4222"
	}

	return &Manager{
		config:    cfg,
		workers:   make(map[string]*WorkerProcess),
		startedAt: time.Now(),
	}
}

// Start begins the manager and starts listening for events.
func (m *Manager) Start(ctx context.Context) error {
	log.Println("Starting process manager...")

	m.ctx, m.cancel = context.WithCancel(ctx)

	// Initialize handlers
	m.handlers = NewHandlers(m, m.config.NATSClient)

	// Start command subscription
	if err := m.handlers.StartSubscription(m.ctx); err != nil {
		return fmt.Errorf("failed to start command subscription: %w", err)
	}

	log.Println("Process manager started successfully")
	return nil
}

// Stop gracefully shuts down all managed workers.
func (m *Manager) Stop(ctx context.Context) error {
	log.Println("Stopping process manager...")

	// Set shutdown flag first to prevent NATS publishes during shutdown
	m.mu.Lock()
	m.shuttingDown = true
	m.mu.Unlock()

	// Stop NATS subscription first to prevent processing new commands
	// and avoid "nats: connection closed" errors during shutdown
	if m.handlers != nil {
		log.Println("Stopping NATS command subscription...")
		if err := m.handlers.StopSubscription(); err != nil {
			log.Printf("Error stopping NATS subscription: %v", err)
		}
	}

	// Cancel the manager context (stops health checks and monitors)
	if m.cancel != nil {
		m.cancel()
	}

	// Stop all workers
	m.mu.Lock()
	workerIDs := make([]string, 0, len(m.workers))
	for id := range m.workers {
		workerIDs = append(workerIDs, id)
	}
	m.mu.Unlock()

	for _, id := range workerIDs {
		worker, exists := m.GetWorkerStatus(id)
		if exists {
			if err := m.stopWorkerInternal(ctx, worker.CompanyID, id, "orchestrator shutdown"); err != nil {
				log.Printf("Error stopping worker %s: %v", id, err)
			}
		}
	}

	// Wait for all goroutines to finish
	m.wg.Wait()

	log.Println("Process manager stopped")
	return nil
}

// SpawnWorker creates and starts a new WhatsApp worker process.
func (m *Manager) SpawnWorker(ctx context.Context, companyID, connectionID, tenantSchema, databaseURL string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if worker already exists (keyed by connectionID)
	if existing, exists := m.workers[connectionID]; exists {
		if existing.Status != types.StatusStopped && existing.Status != types.StatusError {
			// Worker already running - republish current status instead of returning error
			status := existing.Status
			log.Printf("Worker for connection %s already exists with status %s, republishing status", connectionID, status)
			// Use "connected" for any running state since the worker is functional
			if status == types.StatusConnecting {
				status = types.StatusConnected
			}
			// Schedule status publish after releasing lock
			go m.publishConnectionStatus(companyID, connectionID, status, "worker already running")
			return nil
		}
		// Clean up the old worker entry
		delete(m.workers, connectionID)
	}

	// Create worker context with cancel
	workerCtx, workerCancel := context.WithCancel(m.ctx)

	// Create the command
	cmd := exec.CommandContext(workerCtx, m.config.WhatsAppBinaryPath)

	// Set environment variables
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("WORKER_ID=%s", connectionID),
		fmt.Sprintf("COMPANY_ID=%s", companyID),
		fmt.Sprintf("CONNECTION_ID=%s", connectionID),
		fmt.Sprintf("NATS_URL=%s", m.config.DefaultNATSURL),
		fmt.Sprintf("DATABASE_URL=%s", databaseURL),
		fmt.Sprintf("TENANT_SCHEMA=%s", tenantSchema),
	)

	// Redirect stdout and stderr
	cmd.Stdout = &workerLogWriter{connectionID: connectionID, stream: "stdout"}
	cmd.Stderr = &workerLogWriter{connectionID: connectionID, stream: "stderr"}

	// Set process group for clean termination
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}

	// Create worker entry
	worker := &WorkerProcess{
		ID:           connectionID,
		CompanyID:    companyID,
		ConnectionID: connectionID,
		TenantSchema: tenantSchema,
		DatabaseURL:  databaseURL,
		Status:       types.StatusStarting,
		StartedAt:    time.Now(),
		LastActivity: time.Now(),
		cmd:          cmd,
		cancelFunc:   workerCancel,
	}

	// Start the process
	log.Printf("Spawning worker for company %s, connection %s...", companyID, connectionID)
	if err := cmd.Start(); err != nil {
		workerCancel()
		return fmt.Errorf("failed to start worker process: %w", err)
	}

	worker.PID = cmd.Process.Pid
	worker.Status = types.StatusConnecting
	m.workers[connectionID] = worker

	log.Printf("Worker spawned for company %s, connection %s with PID %d", companyID, connectionID, worker.PID)

	// Start health check goroutine
	healthCtx, healthCancel := context.WithCancel(m.ctx)
	worker.healthCancel = healthCancel

	m.wg.Add(1)
	go m.healthCheckWorker(healthCtx, connectionID)

	// Start process monitor goroutine
	m.wg.Add(1)
	go m.monitorWorkerProcess(workerCtx, connectionID, cmd)

	// Publish worker started event
	m.publishConnectionStatus(companyID, connectionID, types.StatusConnecting, "Worker process started")

	return nil
}

// StopWorker terminates a specific worker process.
func (m *Manager) StopWorker(ctx context.Context, companyID, connectionID, reason string) error {
	if err := m.stopWorkerInternal(ctx, companyID, connectionID, reason); err != nil {
		return err
	}

	// Publish stopped event (only if not shutting down)
	m.publishConnectionStatus(companyID, connectionID, types.StatusStopped, reason)

	return nil
}

// stopWorkerInternal terminates a worker without publishing events.
// Used during shutdown to avoid NATS errors.
func (m *Manager) stopWorkerInternal(ctx context.Context, companyID, connectionID, reason string) error {
	m.mu.Lock()
	worker, exists := m.workers[connectionID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("worker %s not found", connectionID)
	}

	// Mark as stopping
	worker.Status = types.StatusStopping
	m.mu.Unlock()

	log.Printf("Stopping worker %s: %s", connectionID, reason)

	// Cancel health check
	if worker.healthCancel != nil {
		worker.healthCancel()
	}

	// Try graceful shutdown first with SIGTERM
	if worker.cmd != nil && worker.cmd.Process != nil {
		// Send SIGTERM to the process group
		pgid, err := syscall.Getpgid(worker.cmd.Process.Pid)
		if err == nil {
			syscall.Kill(-pgid, syscall.SIGTERM)
		} else {
			worker.cmd.Process.Signal(syscall.SIGTERM)
		}

		// Wait for process to exit with timeout
		done := make(chan error, 1)
		go func() {
			done <- worker.cmd.Wait()
		}()

		select {
		case <-done:
			log.Printf("Worker %s terminated gracefully", connectionID)
		case <-time.After(10 * time.Second):
			// Force kill if graceful shutdown fails
			log.Printf("Worker %s did not terminate gracefully, forcing kill", connectionID)
			if worker.cmd.Process != nil {
				pgid, err := syscall.Getpgid(worker.cmd.Process.Pid)
				if err == nil {
					syscall.Kill(-pgid, syscall.SIGKILL)
				} else {
					worker.cmd.Process.Kill()
				}
			}
		}
	}

	// Cancel worker context
	if worker.cancelFunc != nil {
		worker.cancelFunc()
	}

	// Update status
	m.mu.Lock()
	worker.Status = types.StatusStopped
	delete(m.workers, connectionID)
	m.mu.Unlock()

	return nil
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
	workerCopy := &WorkerProcess{
		ID:           worker.ID,
		CompanyID:    worker.CompanyID,
		ConnectionID: worker.ConnectionID,
		TenantSchema: worker.TenantSchema,
		Status:       worker.Status,
		PID:          worker.PID,
		StartedAt:    worker.StartedAt,
		LastActivity: worker.LastActivity,
	}
	return workerCopy, true
}

// ListWorkers returns all managed workers.
func (m *Manager) ListWorkers() []*WorkerProcess {
	m.mu.RLock()
	defer m.mu.RUnlock()

	workers := make([]*WorkerProcess, 0, len(m.workers))
	for _, w := range m.workers {
		workerCopy := &WorkerProcess{
			ID:           w.ID,
			CompanyID:    w.CompanyID,
			ConnectionID: w.ConnectionID,
			TenantSchema: w.TenantSchema,
			Status:       w.Status,
			PID:          w.PID,
			StartedAt:    w.StartedAt,
			LastActivity: w.LastActivity,
		}
		workers = append(workers, workerCopy)
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
			workerCopy := &WorkerProcess{
				ID:           w.ID,
				CompanyID:    w.CompanyID,
				ConnectionID: w.ConnectionID,
				TenantSchema: w.TenantSchema,
				Status:       w.Status,
				PID:          w.PID,
				StartedAt:    w.StartedAt,
				LastActivity: w.LastActivity,
			}
			workers = append(workers, workerCopy)
		}
	}
	return workers
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

// healthCheckWorker performs periodic health checks on a worker.
func (m *Manager) healthCheckWorker(ctx context.Context, connectionID string) {
	defer m.wg.Done()

	ticker := time.NewTicker(m.config.HealthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.mu.RLock()
			worker, exists := m.workers[connectionID]
			m.mu.RUnlock()

			if !exists {
				log.Printf("Health check: worker %s no longer exists, stopping health check", connectionID)
				return
			}

			// Check if process is still running
			if worker.cmd != nil && worker.cmd.Process != nil {
				// Try to get process state
				process, err := os.FindProcess(worker.PID)
				if err != nil {
					log.Printf("Health check: worker %s process not found", connectionID)
					m.handleWorkerFailure(connectionID, "process not found")
					return
				}

				// Send signal 0 to check if process exists
				err = process.Signal(syscall.Signal(0))
				if err != nil {
					log.Printf("Health check: worker %s process dead: %v", connectionID, err)
					m.handleWorkerFailure(connectionID, "process dead")
					return
				}
			}

			// Check for stale activity
			if time.Since(worker.LastActivity) > 5*time.Minute {
				log.Printf("Health check: worker %s has stale activity (last: %v)", connectionID, worker.LastActivity)
			}
		}
	}
}

// monitorWorkerProcess monitors the worker process and handles its exit.
func (m *Manager) monitorWorkerProcess(ctx context.Context, connectionID string, cmd *exec.Cmd) {
	defer m.wg.Done()

	// Wait for the process to exit
	err := cmd.Wait()

	select {
	case <-ctx.Done():
		// Context was cancelled, this is expected
		return
	default:
		// Process exited unexpectedly
		if err != nil {
			log.Printf("Worker %s exited with error: %v", connectionID, err)
			m.handleWorkerFailure(connectionID, err.Error())
		} else {
			log.Printf("Worker %s exited cleanly", connectionID)
			m.handleWorkerFailure(connectionID, "process exited")
		}
	}
}

// handleWorkerFailure handles a worker failure.
func (m *Manager) handleWorkerFailure(connectionID, reason string) {
	m.mu.Lock()
	worker, exists := m.workers[connectionID]
	var companyID string
	if exists {
		companyID = worker.CompanyID
		worker.Status = types.StatusError
		// Cancel health check if running
		if worker.healthCancel != nil {
			worker.healthCancel()
		}
	}
	m.mu.Unlock()

	// Publish error event
	if companyID != "" {
		m.publishConnectionStatus(companyID, connectionID, types.StatusError, reason)
	}
}

// publishConnectionStatus publishes a connection status event.
// Skips publishing during shutdown to avoid NATS errors.
func (m *Manager) publishConnectionStatus(companyID, connectionID, status, reason string) {
	m.mu.RLock()
	shuttingDown := m.shuttingDown
	m.mu.RUnlock()

	if shuttingDown {
		log.Printf("Skipping status publish during shutdown: %s -> %s", connectionID, status)
		return
	}

	if m.handlers != nil {
		m.handlers.PublishConnectionStatus(companyID, connectionID, status, reason)
	}
}

// workerLogWriter captures worker process logs.
type workerLogWriter struct {
	connectionID string
	stream       string
}

func (w *workerLogWriter) Write(p []byte) (n int, err error) {
	log.Printf("[worker:%s:%s] %s", w.connectionID, w.stream, string(p))
	return len(p), nil
}
