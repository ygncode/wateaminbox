package manager

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
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

	// markWorkersRecovering records recovery intent for a whole set of workers
	// at once. It is wired to the registry when persistence initialises, and is
	// a field rather than a direct call so shutdown ordering can be tested
	// without a database.
	markWorkersRecovering func(context.Context, []string) error

	// recordWorkerHeartbeat advances a worker's durable last_heartbeat. It is
	// wired to the registry when persistence initialises, and is a field rather
	// than a direct registry call so the health check can be exercised without
	// a database.
	recordWorkerHeartbeat func(context.Context, string) error
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
	ExpectedExit bool      // One-shot unlink workers must not auto-restart.
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
		ExpectedExit: w.ExpectedExit,
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
			m.markWorkersRecovering = registry.MarkWorkersRecovering
			m.recordWorkerHeartbeat = registry.UpdateHeartbeat
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

	// Record recovery intent for every worker before touching a single process.
	// If the container's stop grace period expires mid-shutdown, SIGKILL takes
	// down an orchestrator whose unmarked records still read "connected", and
	// the replacement process reports those healthy connections as crashes.
	// Doing it in one statement up front makes that bookkeeping independent of
	// how far the stops below actually get.
	//
	// A failure here is logged rather than fatal: shutdown must still stop the
	// workers, and stopWorkerInternal marks each record again as it goes.
	//
	// Bounded separately from the shutdown context. This write sits ahead of
	// every SIGTERM, so on the caller's full budget a slow or unreachable
	// PostgreSQL would spend the time meant for closing WhatsApp sessions and
	// leave the container to SIGKILL the workers instead — the exact outcome
	// the marking exists to prevent. Give up quickly and go stop the workers.
	if m.markWorkersRecovering != nil && len(workerIDs) > 0 {
		markCtx, cancelMark := context.WithTimeout(ctx, markRecoveringTimeout)
		err := m.markWorkersRecovering(markCtx, workerIDs)
		cancelMark()
		if err != nil {
			log.Printf("Warning: failed to mark workers for recovery before shutdown: %v", err)
		}
	}

	// Stop the workers concurrently. Each one costs up to 5s of grace plus a 2s
	// SIGKILL wait, so stopping them in turn only fits about four workers into
	// the 30s shutdown budget while GLOBAL_MAX_ACTIVE_CONNECTIONS permits far
	// more; the rest would be killed with the container instead of being asked
	// to close their WhatsApp sessions. The stops are independent: each touches
	// only its own process and its own map entry, the map itself is mutex
	// guarded, and the registry's connection pool is safe for concurrent use.
	var (
		stopWG   sync.WaitGroup
		stopMu   sync.Mutex
		stopErrs []error
	)
	for _, id := range workerIDs {
		worker, exists := m.GetWorkerStatus(id)
		if !exists {
			continue
		}

		stopWG.Add(1)
		// Keep the durable record while stopping for an orchestrator restart.
		// The next orchestrator process uses that record to respawn the worker;
		// deleting it here leaves a database connection marked connected with no
		// process consuming incoming WhatsApp messages.
		go func(companyID, connectionID string) {
			defer stopWG.Done()

			err := m.stopWorkerInternal(ctx, companyID, connectionID, "orchestrator shutdown", syscall.SIGTERM, true)
			if err == nil {
				return
			}
			log.Printf("Error stopping worker %s: %v", connectionID, err)
			stopMu.Lock()
			stopErrs = append(stopErrs, fmt.Errorf("stop worker %s: %w", connectionID, err))
			stopMu.Unlock()
		}(worker.CompanyID, id)
	}
	stopWG.Wait()

	// Wait for all goroutines to finish
	m.wg.Wait()

	// Close the worker registry
	if m.registry != nil {
		if err := m.registry.Close(); err != nil {
			log.Printf("Error closing worker registry: %v", err)
		}
	}

	log.Println("Process manager stopped")
	// Surfaced to main.go, which logs it. Shutdown still completed; this reports
	// which workers could not be stopped cleanly.
	return errors.Join(stopErrs...)
}

// SpawnWorker creates and starts a new WhatsApp worker process.
func (m *Manager) SpawnWorker(ctx context.Context, companyID, connectionID, tenantSchema, databaseURL string) error {
	return m.spawnWorker(ctx, companyID, connectionID, tenantSchema, databaseURL, false)
}

func (m *Manager) spawnWorker(
	ctx context.Context,
	companyID, connectionID, tenantSchema, databaseURL string,
	unlinkOnStart bool,
) error {
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
		fmt.Sprintf("UNLINK_ON_START=%t", unlinkOnStart),
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
		ExpectedExit: unlinkOnStart,
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

	if !unlinkOnStart {
		// Start health check goroutine
		healthCtx, healthCancel := context.WithCancel(m.ctx)
		worker.healthCancel = healthCancel

		m.wg.Add(1)
		go m.healthCheckWorker(healthCtx, connectionID)
	}

	// Start process monitor goroutine
	m.wg.Add(1)
	go m.monitorWorkerProcess(workerCtx, connectionID, cmd, worker)

	// Publish worker started event
	m.publishConnectionStatus(companyID, connectionID, types.StatusConnecting, "Worker process started")

	return nil
}

// StopWorker terminates a specific worker process.
func (m *Manager) StopWorker(ctx context.Context, companyID, connectionID, reason string) error {
	if err := m.stopWorkerInternal(ctx, companyID, connectionID, reason, syscall.SIGTERM, false); err != nil {
		return err
	}

	// Publish stopped event (only if not shutting down)
	m.publishConnectionStatus(companyID, connectionID, types.StatusStopped, reason)

	return nil
}

// UnlinkWorker asks the worker to log out of WhatsApp and purge its credential
// store before exiting.
func (m *Manager) UnlinkWorker(
	ctx context.Context,
	companyID, connectionID, tenantSchema, databaseURL, reason string,
) error {
	m.mu.RLock()
	_, exists := m.workers[connectionID]
	m.mu.RUnlock()
	if !exists {
		if databaseURL == "" {
			return fmt.Errorf("database URL is required to unlink a stopped session")
		}
		if tenantSchema == "" {
			tenantSchema = "tenant_" + strings.ReplaceAll(companyID, "-", "_")
		}
		return m.spawnWorker(
			ctx,
			companyID,
			connectionID,
			tenantSchema,
			databaseURL,
			true,
		)
	}
	if err := m.stopWorkerInternal(ctx, companyID, connectionID, reason, syscall.SIGUSR1, false); err != nil {
		return err
	}
	m.publishConnectionStatus(companyID, connectionID, types.StatusStopped, reason)
	return nil
}

// stopWorkerInternal terminates a worker without publishing events.
// Used during shutdown to avoid NATS errors.
func (m *Manager) stopWorkerInternal(
	ctx context.Context,
	companyID, connectionID, reason string,
	stopSignal syscall.Signal,
	preserveRegistry bool,
) error {
	m.mu.Lock()
	worker, exists := m.workers[connectionID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("worker %s not found", connectionID)
	}

	// Mark as stopping
	worker.Status = types.StatusStopping
	if stopSignal == syscall.SIGUSR1 {
		worker.ExpectedExit = true
	}
	m.mu.Unlock()

	log.Printf("Stopping worker %s: %s", connectionID, reason)

	// Mark recovery intent before signaling. If the orchestrator itself is
	// terminated before the child finishes, the durable record still tells the
	// replacement process to recover this worker.
	// Stop already marks the whole set in one statement before any of these run,
	// so this is a second line of defence rather than the primary record. Failing
	// the stop on it would be worse than the stale row it guards against: the
	// worker would keep running, still holding its WhatsApp session, while the
	// orchestrator exits around it.
	if preserveRegistry && m.registry != nil {
		if err := m.registry.UpdateStatus(ctx, connectionID, WorkerStatusRecovering); err != nil {
			log.Printf("Warning: failed to re-mark worker %s for recovery: %v", connectionID, err)
		}
	}

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
		err = syscall.Kill(-pgid, stopSignal)
	} else {
		err = process.Signal(stopSignal)
	}
	if err != nil && !errors.Is(err, os.ErrProcessDone) && !errors.Is(err, syscall.ESRCH) {
		return fmt.Errorf("signal worker %s: %w", connectionID, err)
	}
	log.Printf("Sent %s signal to worker %s", stopSignal, connectionID)

	if worker.cancelFunc != nil && stopSignal != syscall.SIGUSR1 {
		worker.cancelFunc()
	}
	gracePeriod := 5 * time.Second
	if stopSignal == syscall.SIGUSR1 {
		gracePeriod = 20 * time.Second
	}
	if err := waitForProcessExit(ctx, pid, gracePeriod); err != nil {
		_ = process.Signal(syscall.SIGKILL)
		if killErr := waitForProcessExit(ctx, pid, 2*time.Second); killErr != nil {
			return fmt.Errorf("worker %s did not exit: %w", connectionID, killErr)
		}
	}

	// Explicit disconnect/unlink removes the durable record. During an
	// orchestrator shutdown it must survive so startup recovery can respawn the
	// WhatsApp process with its existing session credentials.
	if m.registry != nil && !preserveRegistry {
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

			// The process answered signal 0, so it is alive. Record that in the
			// durable registry.
			//
			// Without this, last_heartbeat was only ever written by
			// RegisterWorker and so stayed frozen at the spawn time for the
			// life of the worker: a connection healthy for fourteen hours still
			// reported a fourteen-hour-old heartbeat, indistinguishable from an
			// abandoned row. A heartbeat that never beats cannot answer the one
			// question the column exists for.
			//
			// Logged rather than fatal. Failing the health check because a
			// bookkeeping write failed would stop a worker that is running
			// perfectly well and holding a live WhatsApp session.
			if m.recordWorkerHeartbeat != nil {
				if err := m.recordWorkerHeartbeat(ctx, connectionID); err != nil {
					log.Printf("Warning: failed to record heartbeat for worker %s: %v", connectionID, err)
				}
			}

			// Check for stale activity. This is about WhatsApp traffic, not
			// liveness: an idle connection legitimately sees none for hours.
			if time.Since(worker.LastActivity) > 5*time.Minute {
				log.Printf("Health check: worker %s has stale activity (last: %v)", connectionID, worker.LastActivity)
			}
		}
	}
}

// monitorWorkerProcess monitors the worker process and handles its exit.
func (m *Manager) monitorWorkerProcess(
	ctx context.Context,
	connectionID string,
	cmd *exec.Cmd,
	workerProcess *WorkerProcess,
) {
	defer m.wg.Done()

	// Wait for the process to exit
	err := cmd.Wait()

	m.mu.Lock()
	expectedExit := workerProcess.ExpectedExit
	if expectedExit {
		if workerProcess.healthCancel != nil {
			workerProcess.healthCancel()
		}
		delete(m.workers, connectionID)
	}
	m.mu.Unlock()
	if expectedExit {
		if m.registry != nil {
			if removeErr := m.registry.RemoveWorker(m.ctx, connectionID); removeErr != nil {
				log.Printf("Warning: failed to remove completed unlink worker %s: %v", connectionID, removeErr)
			}
		}
		if err != nil {
			log.Printf("One-shot unlink worker %s exited with error: %v", connectionID, err)
		} else {
			log.Printf("One-shot unlink worker %s completed", connectionID)
		}
		return
	}

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

const (
	// maxRestartBackoff caps the exponential restart delay.
	maxRestartBackoff = 2 * time.Minute
	// restartJitterFraction is how much of the nominal backoff the jitter may
	// subtract, so a delay lands anywhere in the last (1-fraction) of the
	// window: 2.5s-5s for a 5s backoff.
	restartJitterFraction = 0.5
)

// applyRestartJitter spreads a restart delay across
// (backoff-spread, backoff] so that workers which failed together do not
// reconnect on the same second.
//
// Without it, every worker recovered after an orchestrator restart sits at
// RestartCount 0 and therefore computes an identical backoff, so they all
// reconnect to WhatsApp in the same instant — a self-inflicted thundering herd
// against both the orchestrator's spawn path and WhatsApp's servers.
//
// The jitter only subtracts. Widening the window in both directions would push
// delays past maxRestartBackoff, and clamping those back to the ceiling would
// land a share of the workers on exactly the same delay again — reintroducing
// the synchronisation this exists to break.
func applyRestartJitter(backoff time.Duration) time.Duration {
	spread := time.Duration(float64(backoff) * restartJitterFraction)
	if spread <= 0 {
		return backoff
	}

	return backoff - time.Duration(rand.Int64N(int64(spread)))
}

// scheduleRestart schedules a worker restart with exponential backoff and
// jitter.
func (m *Manager) scheduleRestart(worker *WorkerProcess, reason string) {
	// Exponential ceiling on the default 5s base: 5s, 10s, 20s, 40s, 80s
	// (capped at 2 minutes). Jitter then pulls the actual delay down into the
	// upper half of that window.
	backoff := m.config.AutoRestartBackoff * time.Duration(1<<worker.RestartCount)
	if backoff > maxRestartBackoff {
		backoff = maxRestartBackoff
	}
	backoff = applyRestartJitter(backoff)

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

// markRecoveringTimeout bounds the single registry write that shutdown performs
// before signalling any worker. It is deliberately far below the shutdown
// budget in main.go: the write is bookkeeping, and the workers' sessions are
// what the budget is for.
const markRecoveringTimeout = 5 * time.Second

// WorkerStatusRecovering marks a durable registry record whose process was
// stopped deliberately, as part of an orchestrator shutdown, rather than lost.
// It is a registry-only lifecycle state: it is never published as a connection
// status because the API only understands the connection-facing vocabulary in
// services/shared/nats.
const WorkerStatusRecovering = "recovering"

// recoveryAnnouncement reports the connection status a restarting orchestrator
// should publish for a registry record whose process is no longer running.
//
// A planned restart and a crash are indistinguishable by the time recovery
// runs: the worker is a child process of the orchestrator, so replacing the
// orchestrator container always leaves a registry row pointing at a PID that no
// longer exists. Only the durable status separates them. Announcing a planned
// restart as an error made every deployment raise a "WhatsApp disconnected"
// alert at every operator, seconds before the same worker reconnected, which
// trains people to ignore the alert that matters.
func recoveryAnnouncement(recordStatus string) (status, reason string) {
	if recordStatus == WorkerStatusRecovering {
		return types.StatusConnecting, "reconnecting after planned orchestrator restart"
	}
	return types.StatusError, "worker process died"
}

// survivorAnnouncement reports what to publish for a worker whose process
// outlived the orchestrator. Nothing, whatever the record says.
//
// The registry is written once, by RegisterWorker at spawn, and never advanced
// as the WhatsApp session comes up, so a worker connected for hours still
// carries the status it was born with. Republishing that took a connection the
// API held as "connected" and pushed it back to "connecting", where nothing
// corrected it: the process survived, so it never re-announced itself.
//
// "recovering" is declined for the same reason, which is easy to get wrong.
// That marker means this orchestrator's shutdown path asked the worker to
// stop — but we are here because the process is still alive, so the request
// did not take effect. The worker never left, its session is still up, and
// announcing "connecting" would downgrade a live connection exactly as the
// spawn-time default did. A record that contradicts the observed process is
// not evidence about the session.
//
// The orchestrator cannot see the WhatsApp session; it knows only that a
// process is alive. Saying nothing leaves the API holding the last status the
// worker itself reported, which is the best information anyone has. Claiming
// "connected" would be inventing state. The recordStatus argument is kept so
// the rule stays one auditable decision rather than an implicit fallthrough,
// and so a future status has to be considered here rather than silently
// acquiring a meaning.
func survivorAnnouncement(recordStatus string) (status string, publish bool) {
	_ = recordStatus
	return "", false
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
			// Tell the API the connection is coming back. Only a record that was
			// not marked for recovery represents an actual crash.
			status, reason := recoveryAnnouncement(w.Status)
			m.publishConnectionStatus(w.CompanyID, w.ConnectionID, status, reason)

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

		// Tell the API only what this orchestrator actually established. A
		// surviving process whose record still carries its spawn-time status
		// tells us nothing about the WhatsApp session, and publishing it would
		// overwrite a correct "connected" with a stale "connecting".
		if status, publish := survivorAnnouncement(w.Status); publish {
			m.publishConnectionStatus(w.CompanyID, w.ConnectionID, status, "recovered after orchestrator restart")
		} else {
			log.Printf(
				"Worker %s recovered with process alive; leaving connection status untouched (registry status %q is not authoritative)",
				w.ConnectionID, w.Status,
			)
		}
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
