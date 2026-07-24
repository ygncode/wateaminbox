package manager

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// Config holds the configuration for the process manager.
type Config struct {
	NATSClient            *nats.Client
	WhatsAppBinaryPath    string
	DefaultNATSURL        string
	HealthCheckInterval   time.Duration
	DatabaseURL           string        // Database URL for worker registry persistence
	AutoRestartEnabled    bool          // Enable auto-restart on crash
	AutoRestartMaxRetries int           // Max restart attempts (default: 5)
	AutoRestartBackoff    time.Duration // Base backoff between restarts (default: 5s)
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
	shuttingDown bool            // prevents NATS publishes during shutdown
	registry     *WorkerRegistry // persistent storage for worker state
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
	RestartCount int       // Number of restart attempts
	LastCrashAt  time.Time // When last crash occurred
	cmd          *exec.Cmd
	cancelFunc   context.CancelFunc
	healthCancel context.CancelFunc
}

// Copy returns a shallow copy of the worker process without internal fields.
// Use this to safely return worker info outside of mutex-protected code.
func (w *WorkerProcess) Copy() *WorkerProcess {
	return &WorkerProcess{
		ID:           w.ID,
		CompanyID:    w.CompanyID,
		ConnectionID: w.ConnectionID,
		TenantSchema: w.TenantSchema,
		DatabaseURL:  w.DatabaseURL,
		Status:       w.Status,
		PID:          w.PID,
		StartedAt:    w.StartedAt,
		LastActivity: w.LastActivity,
		RestartCount: w.RestartCount,
		LastCrashAt:  w.LastCrashAt,
	}
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
	// Auto-restart defaults
	if cfg.AutoRestartMaxRetries == 0 {
		cfg.AutoRestartMaxRetries = 5
	}
	if cfg.AutoRestartBackoff == 0 {
		cfg.AutoRestartBackoff = 5 * time.Second
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

	// Initialize handlers FIRST so we can publish events during recovery
	m.handlers = NewHandlers(m, m.config.NATSClient)

	// Initialize worker registry for persistence (optional - works without it)
	if m.config.DatabaseURL != "" {
		registry, err := NewWorkerRegistry(m.config.DatabaseURL)
		if err != nil {
			log.Printf("Warning: failed to initialize worker registry: %v", err)
			log.Println("Continuing without persistence - workers will not survive orchestrator restart")
		} else {
			m.registry = registry
			log.Println("Worker registry initialized successfully")

			// Recover existing workers from database
			if err := m.recoverOrphanedWorkers(m.ctx); err != nil {
				log.Printf("Warning: failed to recover workers: %v", err)
			}
		}
	} else {
		log.Println("No database URL configured - worker persistence disabled")
	}

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

	// Close the worker registry
	if m.registry != nil {
		if err := m.registry.Close(); err != nil {
			log.Printf("Error closing worker registry: %v", err)
		}
	}

	log.Println("Process manager stopped")
	return nil
}

// SpawnWorker creates and starts a new WhatsApp worker process.
func (m *Manager) SpawnWorker(ctx context.Context, companyID, connectionID, tenantSchema, databaseURL string) error {
	m.mu.Lock()

	// Check if worker already exists (keyed by connectionID)
	if existing, exists := m.workers[connectionID]; exists {
		if existing.Status != types.StatusStopped && existing.Status != types.StatusError {
			// Worker already running - republish current status instead of returning error
			status := existing.Status
			log.Printf("Worker for connection %s already exists with status %s, republishing status", connectionID, status)
			// Preserve the actual lifecycle state. A running worker may still be
			// negotiating a QR pairing or protocol handshake and is not connected
			// until it emits a confirmed connected event.
			// publishConnectionStatus also reads manager state, so release the
			// write lock before calling it.
			m.mu.Unlock()
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
		m.mu.Unlock()
		return fmt.Errorf("failed to start worker process: %w", err)
	}

	worker.PID = cmd.Process.Pid
	worker.Status = types.StatusConnecting
	m.workers[connectionID] = worker
	m.mu.Unlock()

	log.Printf("Worker spawned for company %s, connection %s with PID %d", companyID, connectionID, worker.PID)

	// Register worker in persistent storage
	if m.registry != nil {
		if err := m.registry.RegisterWorker(ctx, worker); err != nil {
			log.Printf("Warning: failed to register worker in registry: %v", err)
		}
	}

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

	pid := worker.PID
	if pid <= 0 {
		return fmt.Errorf("worker %s has no process ID", connectionID)
	}

	// Recovered workers have no exec.Cmd. Verify the PID still belongs to the
	// configured worker binary before signaling it, mitigating PID reuse.
	if worker.cmd == nil {
		matches, err := m.isExpectedWorkerProcess(pid)
		if err != nil {
			return fmt.Errorf("verify recovered worker %s: %w", connectionID, err)
		}
		if !matches {
			return fmt.Errorf("refusing to signal reused PID %d for worker %s", pid, connectionID)
		}
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("find worker %s process: %w", connectionID, err)
	}
	if pgid, pgErr := syscall.Getpgid(pid); pgErr == nil && pgid == pid {
		err = syscall.Kill(-pgid, syscall.SIGTERM)
	} else {
		err = process.Signal(syscall.SIGTERM)
	}
	if err != nil && !errors.Is(err, os.ErrProcessDone) && !errors.Is(err, syscall.ESRCH) {
		return fmt.Errorf("signal worker %s: %w", connectionID, err)
	}
	log.Printf("Sent shutdown signal to worker %s", connectionID)

	if worker.cancelFunc != nil {
		worker.cancelFunc()
	}
	if err := waitForProcessExit(ctx, pid, 5*time.Second); err != nil {
		_ = process.Signal(syscall.SIGKILL)
		if killErr := waitForProcessExit(ctx, pid, 2*time.Second); killErr != nil {
			return fmt.Errorf("worker %s did not exit: %w", connectionID, killErr)
		}
	}

	// Delete durable/in-memory state only after process termination is confirmed.
	if m.registry != nil {
		if err := m.registry.RemoveWorker(ctx, connectionID); err != nil {
			return fmt.Errorf("remove worker %s from registry: %w", connectionID, err)
		}
	}

	m.mu.Lock()
	worker.Status = types.StatusStopped
	delete(m.workers, connectionID)
	m.mu.Unlock()

	return nil
}

func (m *Manager) isExpectedWorkerProcess(pid int) (bool, error) {
	procExecutable := fmt.Sprintf("/proc/%d/exe", pid)
	if executable, err := os.Readlink(procExecutable); err == nil {
		expected, expectedErr := filepath.EvalSymlinks(m.config.WhatsAppBinaryPath)
		if expectedErr != nil {
			expected = m.config.WhatsAppBinaryPath
		}
		actual, actualErr := filepath.EvalSymlinks(executable)
		if actualErr != nil {
			actual = executable
		}
		return actual == expected, nil
	}

	output, err := exec.Command("ps", "-p", fmt.Sprint(pid), "-o", "command=").Output()
	if err != nil {
		return false, err
	}
	fields := strings.Fields(string(output))
	if len(fields) == 0 {
		return false, nil
	}
	actual := fields[0]
	return actual == m.config.WhatsAppBinaryPath || filepath.Base(actual) == filepath.Base(m.config.WhatsAppBinaryPath), nil
}

func waitForProcessExit(ctx context.Context, pid int, timeout time.Duration) error {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()

	for {
		process, err := os.FindProcess(pid)
		if err != nil {
			return nil
		}
		err = process.Signal(syscall.Signal(0))
		if errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return fmt.Errorf("timed out waiting for PID %d", pid)
		case <-ticker.C:
		}
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

			// Check if process is still running using PID
			// This works for both spawned workers (with cmd) and recovered workers (without cmd)
			if worker.PID > 0 {
				process, err := os.FindProcess(worker.PID)
				if err != nil {
					log.Printf("Health check: worker %s process not found (PID %d)", connectionID, worker.PID)
					m.handleWorkerFailure(connectionID, "process not found")
					return
				}

				// Send signal 0 to check if process exists
				err = process.Signal(syscall.Signal(0))
				if err != nil {
					log.Printf("Health check: worker %s process dead (PID %d): %v", connectionID, worker.PID, err)
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
	log.Printf("handleWorkerFailure called for %s: %s", connectionID, reason)
	m.mu.Lock()
	worker, exists := m.workers[connectionID]
	if !exists {
		log.Printf("Worker %s not found in workers map, cannot handle failure", connectionID)
		m.mu.Unlock()
		return
	}
	log.Printf("Worker %s found in map, processing failure...", connectionID)

	companyID := worker.CompanyID
	worker.Status = types.StatusError
	worker.LastCrashAt = time.Now()

	// Cancel health check if running
	if worker.healthCancel != nil {
		worker.healthCancel()
	}

	// Copy the state before releasing the manager lock. Database calls must not
	// happen while this lock is held: a stalled database operation would block
	// command handling and prevent every subsequent reconnect request.
	workerCopy := worker.Copy()
	m.mu.Unlock()

	// Get restart count from registry or use in-memory count.
	restartCount := workerCopy.RestartCount
	if m.registry != nil {
		if count, err := m.registry.GetRestartCount(m.ctx, connectionID); err == nil {
			restartCount = count
		}
	}
	workerCopy.RestartCount = restartCount

	// Publish error event
	m.publishConnectionStatus(companyID, connectionID, types.StatusError, reason)

	// Check if auto-restart is enabled and under retry limit
	if m.config.AutoRestartEnabled && restartCount < m.config.AutoRestartMaxRetries {
		log.Printf("Auto-restart enabled for %s (attempt %d/%d)", connectionID, restartCount+1, m.config.AutoRestartMaxRetries)
		go m.scheduleRestart(workerCopy, reason)
	} else if restartCount >= m.config.AutoRestartMaxRetries {
		log.Printf("Worker %s exceeded max restart attempts (%d)", connectionID, m.config.AutoRestartMaxRetries)
		// Publish permanent failure event
		m.publishConnectionStatus(companyID, connectionID, "failed", "max restart attempts exceeded")

		// Clean up from registry since we're not restarting
		if m.registry != nil {
			if err := m.registry.RemoveWorker(m.ctx, connectionID); err != nil {
				log.Printf("Warning: failed to remove worker from registry: %v", err)
			}
		}

		// Remove from in-memory tracking
		m.mu.Lock()
		delete(m.workers, connectionID)
		m.mu.Unlock()
	}
}

// scheduleRestart schedules a worker restart with exponential backoff.
func (m *Manager) scheduleRestart(worker *WorkerProcess, reason string) {
	// Exponential backoff: 5s, 10s, 20s, 40s, 80s (capped at 2 minutes)
	backoff := m.config.AutoRestartBackoff * time.Duration(1<<worker.RestartCount)
	if backoff > 2*time.Minute {
		backoff = 2 * time.Minute
	}

	log.Printf("Scheduling restart for %s in %v (attempt %d/%d, reason: %s)",
		worker.ConnectionID, backoff, worker.RestartCount+1, m.config.AutoRestartMaxRetries, reason)

	time.Sleep(backoff)

	// Check if we're still supposed to restart (not shutting down)
	m.mu.RLock()
	shuttingDown := m.shuttingDown
	m.mu.RUnlock()

	if shuttingDown {
		log.Printf("Skipping restart for %s - orchestrator is shutting down", worker.ConnectionID)
		return
	}

	// Increment restart count in registry
	if m.registry != nil {
		if err := m.registry.IncrementRestartCount(m.ctx, worker.ConnectionID); err != nil {
			log.Printf("Warning: failed to increment restart count: %v", err)
		}
	}

	// Respawn the worker
	log.Printf("Restarting worker %s...", worker.ConnectionID)
	err := m.SpawnWorker(m.ctx, worker.CompanyID, worker.ConnectionID, worker.TenantSchema, worker.DatabaseURL)
	if err != nil {
		log.Printf("Auto-restart failed for %s: %v", worker.ConnectionID, err)
		// The next failure will trigger another restart attempt if under limit
	}
}

// recoverOrphanedWorkers recovers workers from the database after orchestrator restart.
func (m *Manager) recoverOrphanedWorkers(ctx context.Context) error {
	if m.registry == nil {
		return nil
	}

	workers, err := m.registry.GetAllWorkers(ctx)
	if err != nil {
		return fmt.Errorf("failed to get workers from registry: %w", err)
	}

	if len(workers) == 0 {
		log.Println("No workers to recover from registry")
		return nil
	}

	log.Printf("Found %d workers in registry, checking status...", len(workers))

	for _, w := range workers {
		databaseURL := m.config.DatabaseURL
		if databaseURL == "" {
			databaseURL = w.DatabaseURL // Backward compatibility with old registry rows.
		}
		// Check that the process exists and still belongs to the worker binary.
		// A stale registry PID may have been reused by an unrelated process.
		processMatches, processErr := m.isExpectedWorkerProcess(w.PID)
		if processErr != nil || !processMatches {
			log.Printf("Worker %s (PID %d) is dead or has a reused PID, cleaning up and notifying API", w.ConnectionID, w.PID)
			m.registry.RemoveWorker(ctx, w.ConnectionID)
			// Publish error status so the API updates the database
			m.publishConnectionStatus(w.CompanyID, w.ConnectionID, types.StatusError, "worker process died")

			// Trigger respawn if auto-restart enabled
			if m.config.AutoRestartEnabled && w.RestartCount < m.config.AutoRestartMaxRetries {
				workerProcess := &WorkerProcess{
					ConnectionID: w.ConnectionID,
					CompanyID:    w.CompanyID,
					TenantSchema: w.TenantSchema,
					DatabaseURL:  databaseURL,
					RestartCount: w.RestartCount,
				}
				go m.scheduleRestart(workerProcess, "recovered after orchestrator restart")
			}
			continue
		}

		// Process is alive - re-add to in-memory tracking
		log.Printf("Recovered worker %s (PID %d)", w.ConnectionID, w.PID)

		// Create a WorkerProcess from the record
		// Note: We don't have the cmd handle, so we can't cleanly stop this worker
		// But we can track it and monitor its health
		worker := &WorkerProcess{
			ID:           w.ConnectionID,
			CompanyID:    w.CompanyID,
			ConnectionID: w.ConnectionID,
			TenantSchema: w.TenantSchema,
			DatabaseURL:  databaseURL,
			Status:       w.Status,
			PID:          w.PID,
			StartedAt:    w.StartedAt,
			LastActivity: w.LastHeartbeat,
			RestartCount: w.RestartCount,
		}

		m.mu.Lock()
		m.workers[w.ConnectionID] = worker
		m.mu.Unlock()

		// Start health check goroutine for this recovered worker
		healthCtx, healthCancel := context.WithCancel(m.ctx)
		worker.healthCancel = healthCancel

		m.wg.Add(1)
		go m.healthCheckWorker(healthCtx, w.ConnectionID)

		// Publish status to notify API that this connection is alive
		m.publishConnectionStatus(w.CompanyID, w.ConnectionID, w.Status, "recovered after orchestrator restart")
	}

	return nil
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
