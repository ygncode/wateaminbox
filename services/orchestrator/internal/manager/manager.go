package manager

import (
	"context"
	crand "crypto/rand"
	"errors"
	"fmt"
	"hash/fnv"
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
	MaxWorkers            int           // 0 = unlimited
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
	lifecycle    [256]sync.Mutex // serializes operations for each connection

	// markWorkersRecovering records recovery intent for a whole set of workers
	// at once. It is wired to the registry when persistence initialises, and is
	// a field rather than a direct call so shutdown ordering can be tested
	// without a database.
	markWorkersRecovering func(context.Context, []string) error

	// recordWorkerHeartbeat advances a worker's durable last_heartbeat. It is
	// wired to the registry when persistence initialises, and is a field rather
	// than a direct registry call so the health check can be exercised without
	// a database.
	recordWorkerHeartbeat func(context.Context, string, string, string) (bool, error)
}

// WorkerProcess represents a managed WhatsApp worker.
type WorkerProcess struct {
	ID           string
	LaunchID     string // unique identity for this particular process launch
	DesiredState string // durable operator intent (running or stopped)
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
	ExpectedExit bool      // Suppresses crash handling in monitorWorkerProcess.
	RemoveOnExit bool      // One-shot unlink workers remove themselves on exit.
	cmd          *exec.Cmd
	healthCancel context.CancelFunc
	done         chan struct{} // closed after cmd.Wait() reaps the process
	exitErr      error         // cmd.Wait result, published before done closes
}

// Copy returns a shallow copy of the worker process without internal fields.
// Use this to safely return worker info outside of mutex-protected code.
func (w *WorkerProcess) Copy() *WorkerProcess {
	return &WorkerProcess{
		ID:           w.ID,
		LaunchID:     w.LaunchID,
		DesiredState: w.DesiredState,
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
		RemoveOnExit: w.RemoveOnExit,
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
			return fmt.Errorf("failed to initialize required worker registry: %w", err)
		} else {
			m.registry = registry
			m.markWorkersRecovering = registry.MarkWorkersRecovering
			m.recordWorkerHeartbeat = registry.UpdateHeartbeatLaunch
			log.Println("Worker registry initialized successfully")

			// Recovery must finish before commands are consumed. Continuing after
			// an ambiguous durable intent could start a duplicate worker.
			if err := m.recoverOrphanedWorkers(m.ctx); err != nil {
				_ = registry.Close()
				return fmt.Errorf("failed to recover workers: %w", err)
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

	// Stop all workers — manager context stays alive so health checks and
	// monitors can still observe workers while they drain.
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
			unlock := m.lockLifecycle(connectionID)
			defer unlock()

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

	// Cancel the manager context now that all workers have been stopped.
	// This stops health checks and monitors.
	if m.cancel != nil {
		m.cancel()
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
	// Surfaced to main.go, which logs it. Shutdown still completed; this reports
	// which workers could not be stopped cleanly.
	return errors.Join(stopErrs...)
}

var ErrWorkerNotFound = errors.New("worker not found")

const (
	DesiredStateRunning   = "running"
	DesiredStateStopped   = "stopped"
	DesiredStateUnlinking = "unlinking"
)

func newLaunchID() (string, error) {
	var id [16]byte
	if _, err := crand.Read(id[:]); err != nil {
		return "", fmt.Errorf("generate launch ID: %w", err)
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16]), nil
}

func (m *Manager) lockLifecycle(connectionID string) func() {
	h := fnv.New32a()
	_, _ = h.Write([]byte(connectionID))
	lock := &m.lifecycle[h.Sum32()%uint32(len(m.lifecycle))]
	lock.Lock()
	return lock.Unlock
}

// SpawnWorker creates and starts a new WhatsApp worker process.
func (m *Manager) SpawnWorker(ctx context.Context, companyID, connectionID, tenantSchema, databaseURL string) error {
	unlock := m.lockLifecycle(connectionID)
	defer unlock()
	return m.spawnWorker(ctx, companyID, connectionID, tenantSchema, databaseURL, false, 0)
}

func (m *Manager) spawnWorker(
	ctx context.Context,
	companyID, connectionID, tenantSchema, databaseURL string,
	unlinkOnStart bool,
	restartCount int,
) error {
	launchID, err := newLaunchID()
	if err != nil {
		return err
	}

	m.mu.Lock()
	if m.shuttingDown {
		m.mu.Unlock()
		return fmt.Errorf("process manager is shutting down")
	}

	previousLaunchID := ""
	var previousWorker *WorkerProcess
	// Check if worker already exists (keyed by connectionID).
	if existing, exists := m.workers[connectionID]; exists {
		if existing.CompanyID != companyID {
			m.mu.Unlock()
			return fmt.Errorf("worker %s belongs to another company", connectionID)
		}
		if existing.Status != types.StatusStopped && existing.Status != types.StatusError {
			status := existing.Status
			log.Printf("Worker for connection %s already exists with status %s, republishing status", connectionID, status)
			m.mu.Unlock()
			go m.publishConnectionStatus(companyID, connectionID, status, "worker already running")
			return nil
		}
		previousLaunchID = existing.LaunchID
		previousWorker = existing
		delete(m.workers, connectionID)
	}

	if m.config.MaxWorkers > 0 && len(m.workers) >= m.config.MaxWorkers {
		count := len(m.workers)
		m.mu.Unlock()
		return fmt.Errorf("worker limit reached (%d/%d)", count, m.config.MaxWorkers)
	}

	// Create the command without a context so the manager context cancellation
	// does not kill the process — the manager has explicit signal ownership.
	cmd := exec.Command(m.config.WhatsAppBinaryPath)
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("WORKER_ID=%s", connectionID),
		fmt.Sprintf("COMPANY_ID=%s", companyID),
		fmt.Sprintf("CONNECTION_ID=%s", connectionID),
		fmt.Sprintf("NATS_URL=%s", m.config.DefaultNATSURL),
		fmt.Sprintf("DATABASE_URL=%s", databaseURL),
		fmt.Sprintf("TENANT_SCHEMA=%s", tenantSchema),
		fmt.Sprintf("UNLINK_ON_START=%t", unlinkOnStart),
	)
	cmd.Stdout = &workerLogWriter{connectionID: connectionID, stream: "stdout"}
	cmd.Stderr = &workerLogWriter{connectionID: connectionID, stream: "stderr"}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	desiredState := DesiredStateRunning
	if unlinkOnStart {
		desiredState = DesiredStateUnlinking
	}
	worker := &WorkerProcess{
		ID:           connectionID,
		LaunchID:     launchID,
		DesiredState: desiredState,
		CompanyID:    companyID,
		ConnectionID: connectionID,
		TenantSchema: tenantSchema,
		DatabaseURL:  databaseURL,
		Status:       types.StatusStarting,
		StartedAt:    time.Now(),
		LastActivity: time.Now(),
		RestartCount: restartCount,
		RemoveOnExit: unlinkOnStart,
		cmd:          cmd,
		done:         make(chan struct{}),
	}

	// Reserve the map slot before releasing the global lock, preserving the
	// worker cap while a different connection starts. The per-connection
	// lifecycle lock prevents anyone from observing this launch as replaceable.
	m.workers[connectionID] = worker
	m.mu.Unlock()

	removeInMemory := func() {
		m.mu.Lock()
		if current, ok := m.workers[connectionID]; ok && current.LaunchID == launchID {
			delete(m.workers, connectionID)
		}
		m.mu.Unlock()
	}
	restorePrevious := func() {
		if previousWorker == nil {
			return
		}
		m.mu.Lock()
		if _, exists := m.workers[connectionID]; !exists {
			m.workers[connectionID] = previousWorker
		}
		m.mu.Unlock()
	}
	preserveFailedIntent := restartCount > 0 || unlinkOnStart
	markLaunchFailed := func() {
		m.mu.Lock()
		if current, ok := m.workers[connectionID]; ok && current.LaunchID == launchID {
			current.PID = 0
			current.Status = types.StatusError
			current.LastCrashAt = time.Now()
		}
		m.mu.Unlock()
		if m.registry != nil {
			_, _ = m.registry.UpdateStatusLaunch(ctx, connectionID, companyID, launchID, types.StatusError)
		}
	}

	// Reserve durable ownership before starting the child. In particular, an
	// existing registry row owned by another tenant must fail before a process
	// with that tenant's connection ID can be launched.
	if m.registry != nil {
		if err := m.registry.ClaimWorkerLaunch(ctx, worker.Copy(), previousLaunchID); err != nil {
			removeInMemory()
			if !errors.Is(err, ErrWorkerLaunchConflict) {
				restorePrevious()
			}
			return fmt.Errorf("reserve worker launch: %w", err)
		}
	}

	log.Printf("Spawning worker for company %s, connection %s...", companyID, connectionID)
	if err := cmd.Start(); err != nil {
		if preserveFailedIntent {
			markLaunchFailed()
		} else {
			if m.registry != nil {
				_, _ = m.registry.RemoveWorkerLaunch(ctx, connectionID, companyID, launchID)
			}
			removeInMemory()
		}
		return fmt.Errorf("failed to start worker process: %w", err)
	}

	m.mu.Lock()
	current, currentExists := m.workers[connectionID]
	if !currentExists || current.LaunchID != launchID {
		m.mu.Unlock()
		stopUnregisteredProcess(cmd)
		if m.registry != nil {
			_, _ = m.registry.RemoveWorkerLaunch(ctx, connectionID, companyID, launchID)
		}
		return fmt.Errorf("worker %s launch changed during process start", connectionID)
	}
	worker.PID = cmd.Process.Pid
	worker.Status = types.StatusConnecting
	m.mu.Unlock()
	if m.registry != nil {
		if err := m.registry.ActivateWorkerLaunch(ctx, worker.Copy()); err != nil {
			stopUnregisteredProcess(cmd)
			if errors.Is(err, ErrWorkerLaunchConflict) {
				removeInMemory()
			} else if preserveFailedIntent {
				markLaunchFailed()
			} else {
				_, _ = m.registry.RemoveWorkerLaunch(ctx, connectionID, companyID, launchID)
				removeInMemory()
			}
			return fmt.Errorf("activate worker launch: %w", err)
		}
	}

	if !unlinkOnStart {
		healthCtx, healthCancel := context.WithCancel(m.ctx)
		worker.healthCancel = healthCancel
		m.wg.Add(1)
		go m.healthCheckWorker(healthCtx, connectionID, launchID)
	}

	log.Printf("Worker spawned for company %s, connection %s with PID %d", companyID, connectionID, worker.PID)

	// Start process monitor goroutine
	m.wg.Add(1)
	go m.monitorWorkerProcess(connectionID, cmd, worker)

	// Publish worker started event
	m.publishConnectionStatus(companyID, connectionID, types.StatusConnecting, "Worker process started")

	return nil
}

// stopUnregisteredProcess reaps a child whose durable activation failed. No
// monitor goroutine exists yet, so this function owns the single cmd.Wait call.
func stopUnregisteredProcess(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	if pgid, err := syscall.Getpgid(pid); err == nil && pgid == pid {
		_ = syscall.Kill(-pgid, syscall.SIGTERM)
	} else {
		_ = cmd.Process.Signal(syscall.SIGTERM)
	}

	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	select {
	case <-done:
		return
	case <-time.After(5 * time.Second):
	}

	if pgid, err := syscall.Getpgid(pid); err == nil && pgid == pid {
		_ = syscall.Kill(-pgid, syscall.SIGKILL)
	} else {
		_ = cmd.Process.Kill()
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		log.Printf("Warning: unregistered worker PID %d did not exit after SIGKILL", pid)
	}
}

// StopWorker terminates a specific worker process.
func (m *Manager) StopWorker(ctx context.Context, companyID, connectionID, reason string) error {
	unlock := m.lockLifecycle(connectionID)
	defer unlock()
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
	unlock := m.lockLifecycle(connectionID)
	defer unlock()
	m.mu.RLock()
	worker, exists := m.workers[connectionID]
	if exists && worker.CompanyID != companyID {
		m.mu.RUnlock()
		return fmt.Errorf("worker %s belongs to another company", connectionID)
	}
	m.mu.RUnlock()
	if exists && worker.PID <= 0 && (worker.Status == types.StatusError || worker.Status == types.StatusStopped) {
		if tenantSchema == "" {
			tenantSchema = worker.TenantSchema
		}
		if databaseURL == "" {
			databaseURL = worker.DatabaseURL
		}
		return m.spawnWorker(
			ctx,
			companyID,
			connectionID,
			tenantSchema,
			databaseURL,
			true,
			worker.RestartCount+1,
		)
	}
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
			0,
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
		return fmt.Errorf("%w: %s", ErrWorkerNotFound, connectionID)
	}
	if worker.CompanyID != companyID {
		m.mu.Unlock()
		return fmt.Errorf("worker %s belongs to another company", connectionID)
	}

	if worker.PID <= 0 && worker.Status != types.StatusError && worker.Status != types.StatusStopped {
		m.mu.Unlock()
		return fmt.Errorf("worker %s has no process ID", connectionID)
	}

	// Mark as stopping — every explicit stop suppresses crash handling in
	// monitorWorkerProcess, which races to observe the process exit.
	previousStatus := worker.Status
	previousDesiredState := worker.DesiredState
	worker.Status = types.StatusStopping
	worker.ExpectedExit = true
	targetDesiredState := DesiredStateStopped
	if stopSignal == syscall.SIGUSR1 {
		targetDesiredState = DesiredStateUnlinking
	}
	if !preserveRegistry {
		worker.DesiredState = targetDesiredState
	}
	launchID := worker.LaunchID
	m.mu.Unlock()

	log.Printf("Stopping worker %s: %s", connectionID, reason)

	// Persist explicit stop intent before signalling. A delayed restart or a new
	// orchestrator must not resurrect a process the operator stopped.
	if !preserveRegistry && m.registry != nil {
		updated, err := m.registry.SetDesiredState(ctx, connectionID, companyID, launchID, targetDesiredState)
		if err != nil || !updated {
			m.mu.Lock()
			if current, ok := m.workers[connectionID]; ok && current.LaunchID == launchID {
				current.Status = previousStatus
				current.DesiredState = previousDesiredState
				current.ExpectedExit = false
			}
			m.mu.Unlock()
			if err != nil {
				return fmt.Errorf("persist stopped intent for worker %s: %w", connectionID, err)
			}
			return fmt.Errorf("worker %s launch changed while stopping", connectionID)
		}
	}

	// Mark recovery intent before signaling. If the orchestrator itself is
	// terminated before the child finishes, the durable record still tells the
	// replacement process to recover this worker.
	// Stop already marks the whole set in one statement before any of these run,
	// so this is a second line of defence rather than the primary record. Failing
	// the stop on it would be worse than the stale row it guards against: the
	// worker would keep running, still holding its WhatsApp session, while the
	// orchestrator exits around it.
	if preserveRegistry && m.registry != nil {
		updated, err := m.registry.UpdateStatusLaunch(
			ctx,
			connectionID,
			companyID,
			launchID,
			WorkerStatusRecovering,
		)
		if err != nil || !updated {
			log.Printf(
				"Warning: failed to re-mark worker %s launch %s for recovery: updated=%t error=%v",
				connectionID,
				launchID,
				updated,
				err,
			)
		}
	}

	// Cancel health check
	if worker.healthCancel != nil {
		worker.healthCancel()
	}

	pid := worker.PID
	if pid <= 0 {
		if !preserveRegistry && targetDesiredState == DesiredStateUnlinking {
			m.mu.Lock()
			if current, ok := m.workers[connectionID]; ok && current.LaunchID == launchID {
				current.Status = types.StatusError
				current.ExpectedExit = false
			}
			m.mu.Unlock()
			return fmt.Errorf("worker %s has no live process; durable unlink must be resumed", connectionID)
		}
		if m.registry != nil && !preserveRegistry {
			removed, removeErr := m.registry.RemoveWorkerLaunch(ctx, connectionID, companyID, launchID)
			if removeErr != nil || !removed {
				m.mu.Lock()
				if current, ok := m.workers[connectionID]; ok && current.LaunchID == launchID {
					current.Status = types.StatusError
					current.ExpectedExit = false
				}
				m.mu.Unlock()
				if removeErr != nil {
					return fmt.Errorf("remove processless worker %s: %w", connectionID, removeErr)
				}
				return fmt.Errorf("processless worker %s launch changed before removal", connectionID)
			}
		}
		m.mu.Lock()
		if current, ok := m.workers[connectionID]; ok && current.LaunchID == launchID {
			delete(m.workers, connectionID)
		}
		m.mu.Unlock()
		return nil
	}

	// Recovered workers have no exec.Cmd. Verify the PID still belongs to the
	// configured worker binary before signaling it, mitigating PID reuse.
	if worker.cmd == nil {
		matches, err := m.isExpectedWorkerProcess(pid, worker.CompanyID, worker.ConnectionID)
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

	gracePeriod := 5 * time.Second
	if stopSignal == syscall.SIGUSR1 {
		gracePeriod = 20 * time.Second
	}
	if err := m.waitForWorkerExit(ctx, worker, pid, gracePeriod); err != nil {
		if pgid, pgErr := syscall.Getpgid(pid); pgErr == nil && pgid == pid {
			_ = syscall.Kill(-pgid, syscall.SIGKILL)
		} else {
			_ = process.Signal(syscall.SIGKILL)
		}
		log.Printf("Escalated to SIGKILL for worker %s (PID %d)", connectionID, pid)
		if killErr := m.waitForWorkerExit(ctx, worker, pid, 2*time.Second); killErr != nil {
			return fmt.Errorf("worker %s did not exit: %w", connectionID, killErr)
		}
	}

	if stopSignal == syscall.SIGUSR1 && worker.cmd != nil && worker.exitErr != nil {
		m.mu.Lock()
		if current, ok := m.workers[connectionID]; ok && current.LaunchID == launchID {
			current.PID = 0
			current.Status = types.StatusError
			current.DesiredState = DesiredStateUnlinking
		}
		m.mu.Unlock()
		return fmt.Errorf("unlink worker %s exited before completing purge: %w", connectionID, worker.exitErr)
	}

	// Explicit disconnect/unlink removes the durable record. During an
	// orchestrator shutdown it must survive so startup recovery can respawn the
	// WhatsApp process with its existing session credentials.
	if m.registry != nil && !preserveRegistry {
		removed, err := m.registry.RemoveWorkerLaunch(ctx, connectionID, companyID, launchID)
		if err != nil {
			return fmt.Errorf("remove worker %s from registry: %w", connectionID, err)
		}
		if !removed {
			return fmt.Errorf("worker %s launch changed before registry removal", connectionID)
		}
	}

	m.mu.Lock()
	if current, ok := m.workers[connectionID]; ok && current.LaunchID == launchID {
		worker.Status = types.StatusStopped
		delete(m.workers, connectionID)
	}
	m.mu.Unlock()

	return nil
}

func (m *Manager) isExpectedWorkerProcess(pid int, companyID, connectionID string) (bool, error) {
	if pid <= 0 {
		return false, nil
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false, nil
	}
	if err := process.Signal(syscall.Signal(0)); err != nil {
		if errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH) {
			return false, nil
		}
		return false, fmt.Errorf("check PID %d liveness: %w", pid, err)
	}

	procExecutable := fmt.Sprintf("/proc/%d/exe", pid)
	executable, executableErr := os.Readlink(procExecutable)
	if executableErr != nil {
		output, err := exec.Command("ps", "-p", fmt.Sprint(pid), "-o", "command=").Output()
		if err != nil {
			return false, err
		}
		fields := strings.Fields(string(output))
		if len(fields) == 0 {
			return false, nil
		}
		executable = fields[0]
	}

	expected, expectedErr := filepath.EvalSymlinks(m.config.WhatsAppBinaryPath)
	if expectedErr != nil {
		expected = m.config.WhatsAppBinaryPath
	}
	actual, actualErr := filepath.EvalSymlinks(executable)
	if actualErr != nil {
		actual = executable
	}
	if actual != expected && filepath.Base(actual) != filepath.Base(expected) {
		return false, nil
	}

	// The executable alone is insufficient: every connection runs the same
	// worker binary, so a stale PID can be reused by another tenant's worker.
	// Match the immutable tenant/connection identity from the child environment
	// before sending any signal to an adopted process.
	environment, err := os.ReadFile(fmt.Sprintf("/proc/%d/environ", pid))
	if err != nil {
		environment, err = exec.Command("ps", "eww", "-p", fmt.Sprint(pid), "-o", "command=").Output()
		if err != nil {
			return false, err
		}
	}
	normalized := strings.ReplaceAll(string(environment), "\x00", " ")
	fields := strings.Fields(normalized)
	companyToken := "COMPANY_ID=" + companyID
	connectionToken := "CONNECTION_ID=" + connectionID
	companyMatches := false
	connectionMatches := false
	for _, field := range fields {
		companyMatches = companyMatches || field == companyToken
		connectionMatches = connectionMatches || field == connectionToken
	}
	return companyMatches && connectionMatches, nil
}

// waitForWorkerExit waits for a spawned worker's done channel (closed when
// cmd.Wait reaps the process) or falls back to signal-0 polling for recovered
// workers that have no exec.Cmd.
func (m *Manager) waitForWorkerExit(ctx context.Context, worker *WorkerProcess, pid int, timeout time.Duration) error {
	if worker.done != nil {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		select {
		case <-worker.done:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return fmt.Errorf("timed out waiting for PID %d", pid)
		}
	}
	return waitForProcessExit(ctx, pid, timeout)
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
func (m *Manager) healthCheckWorker(ctx context.Context, connectionID, launchID string) {
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
			if !exists || worker.LaunchID != launchID {
				m.mu.RUnlock()
				log.Printf("Health check: worker %s no longer exists, stopping health check", connectionID)
				return
			}
			pid := worker.PID
			lastActivity := worker.LastActivity
			m.mu.RUnlock()

			// Check if process is still running using PID
			// This works for both spawned workers (with cmd) and recovered workers (without cmd)
			if pid > 0 {
				process, err := os.FindProcess(pid)
				if err != nil {
					log.Printf("Health check: worker %s process not found (PID %d)", connectionID, pid)
					m.handleWorkerFailure(connectionID, launchID, "process not found")
					return
				}

				// Send signal 0 to check if process exists
				err = process.Signal(syscall.Signal(0))
				if err != nil {
					log.Printf("Health check: worker %s process dead (PID %d): %v", connectionID, pid, err)
					m.handleWorkerFailure(connectionID, launchID, "process dead")
					return
				}
			}

			// The process answered signal 0, so it is alive. Record that in the
			// durable registry.
			if m.recordWorkerHeartbeat != nil {
				updated, err := m.recordWorkerHeartbeat(
					ctx,
					connectionID,
					worker.CompanyID,
					launchID,
				)
				if err != nil {
					log.Printf("Warning: failed to record heartbeat for worker %s: %v", connectionID, err)
				} else if !updated {
					log.Printf("Health check: worker %s launch changed before heartbeat; stopping health check", connectionID)
					return
				}
			}

			// Check for stale activity. This is about WhatsApp traffic, not
			// liveness: an idle connection legitimately sees none for hours.
			if time.Since(lastActivity) > 5*time.Minute {
				log.Printf("Health check: worker %s has stale activity (last: %v)", connectionID, lastActivity)
			}
		}
	}
}

// monitorWorkerProcess monitors the worker process and handles its exit.
func (m *Manager) monitorWorkerProcess(
	connectionID string,
	cmd *exec.Cmd,
	workerProcess *WorkerProcess,
) {
	defer m.wg.Done()

	// Close done immediately after Wait so a serialized StopWorker waiting for
	// process reaping cannot deadlock with this callback's lifecycle lock.
	err := cmd.Wait()
	workerProcess.exitErr = err
	close(workerProcess.done)

	unlock := m.lockLifecycle(connectionID)
	m.mu.Lock()
	current, currentLaunch := m.workers[connectionID]
	isCurrent := currentLaunch && current.LaunchID == workerProcess.LaunchID
	removeOnExit := workerProcess.RemoveOnExit
	expectedExit := workerProcess.ExpectedExit
	shuttingDown := m.shuttingDown
	if removeOnExit && isCurrent && workerProcess.healthCancel != nil {
		workerProcess.healthCancel()
	}
	m.mu.Unlock()

	if removeOnExit {
		// A one-shot unlink is complete only after a clean process exit. A
		// signal, crash, or orchestrator shutdown may interrupt LogoutAndPurge;
		// keep durable unlink intent so startup or an explicit retry finishes it.
		retainForCleanup := err != nil || expectedExit || shuttingDown
		if isCurrent && m.registry != nil && !retainForCleanup {
			removed, removeErr := m.registry.RemoveWorkerLaunch(m.ctx, connectionID, workerProcess.CompanyID, workerProcess.LaunchID)
			if removeErr != nil {
				retainForCleanup = true
				log.Printf("Warning: failed to remove completed unlink worker %s: %v", connectionID, removeErr)
			} else if !removed {
				log.Printf("Completed unlink worker %s no longer owns its durable launch", connectionID)
			}
		}
		m.mu.Lock()
		if current, ok := m.workers[connectionID]; ok && current.LaunchID == workerProcess.LaunchID {
			if retainForCleanup {
				current.PID = 0
				current.Status = types.StatusError
				current.DesiredState = DesiredStateUnlinking
			} else {
				delete(m.workers, connectionID)
			}
		}
		m.mu.Unlock()
		unlock()
		if err != nil {
			log.Printf("One-shot unlink worker %s exited with error: %v", connectionID, err)
		} else {
			log.Printf("One-shot unlink worker %s completed", connectionID)
		}
		return
	}
	unlock()

	if !isCurrent || expectedExit || shuttingDown {
		return
	}

	// Process exited unexpectedly. Failure handling rechecks the launch after
	// acquiring the lifecycle lock, so a replacement between here and there wins.
	if err != nil {
		log.Printf("Worker %s exited with error: %v", connectionID, err)
		m.handleWorkerFailure(connectionID, workerProcess.LaunchID, err.Error())
	} else {
		log.Printf("Worker %s exited cleanly", connectionID)
		m.handleWorkerFailure(connectionID, workerProcess.LaunchID, "process exited")
	}
}

// handleWorkerFailure handles a worker failure only for the launch that failed.
func (m *Manager) handleWorkerFailure(connectionID, launchID, reason string) {
	unlock := m.lockLifecycle(connectionID)
	defer unlock()
	log.Printf("handleWorkerFailure called for %s launch %s: %s", connectionID, launchID, reason)
	m.mu.Lock()
	worker, exists := m.workers[connectionID]
	if !exists || worker.LaunchID != launchID || worker.DesiredState != DesiredStateRunning {
		log.Printf("Ignoring stale failure for worker %s launch %s", connectionID, launchID)
		m.mu.Unlock()
		return
	}
	log.Printf("Worker %s found in map, processing failure...", connectionID)

	companyID := worker.CompanyID
	worker.Status = types.StatusError
	worker.PID = 0
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
		if count, found, err := m.registry.GetRestartCountLaunch(
			m.ctx,
			connectionID,
			workerCopy.CompanyID,
			workerCopy.LaunchID,
		); err == nil && found {
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
	} else {
		failureReason := "automatic restart disabled"
		if restartCount >= m.config.AutoRestartMaxRetries {
			failureReason = "max restart attempts exceeded"
			log.Printf("Worker %s exceeded max restart attempts (%d)", connectionID, m.config.AutoRestartMaxRetries)
		}
		m.publishConnectionStatus(companyID, connectionID, "failed", failureReason)

		// Retain the failed in-memory generation when durable cleanup fails.
		// A manual spawn can then CAS from that exact launch instead of becoming
		// permanently wedged behind an unclaimable desired-running row.
		removeFromMemory := true
		if m.registry != nil {
			removed, err := m.registry.RemoveWorkerLaunch(m.ctx, connectionID, companyID, workerCopy.LaunchID)
			if err != nil || !removed {
				removeFromMemory = false
				log.Printf("Warning: failed to remove worker from registry: removed=%t error=%v", removed, err)
			}
		}
		if removeFromMemory {
			m.mu.Lock()
			if current, ok := m.workers[connectionID]; ok && current.LaunchID == workerCopy.LaunchID {
				delete(m.workers, connectionID)
			}
			m.mu.Unlock()
		}
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

	unlock := m.lockLifecycle(worker.ConnectionID)
	defer unlock()

	// A delayed restart is valid only while the exact failed launch is still the
	// current launch and both in-memory and durable intent remain running.
	m.mu.RLock()
	current, exists := m.workers[worker.ConnectionID]
	valid := !m.shuttingDown && exists && current.LaunchID == worker.LaunchID &&
		current.CompanyID == worker.CompanyID && current.DesiredState == DesiredStateRunning &&
		current.Status == types.StatusError
	m.mu.RUnlock()
	if !valid {
		log.Printf("Skipping stale restart for %s launch %s", worker.ConnectionID, worker.LaunchID)
		return
	}

	if m.registry != nil {
		record, err := m.registry.GetWorker(m.ctx, worker.ConnectionID)
		if err != nil || record == nil || record.LaunchID != worker.LaunchID ||
			record.CompanyID != worker.CompanyID || record.DesiredState != DesiredStateRunning {
			log.Printf("Skipping restart for %s: durable launch or desired state changed (error: %v)", worker.ConnectionID, err)
			return
		}
		updated, err := m.registry.IncrementRestartCountLaunch(m.ctx, worker.ConnectionID, worker.CompanyID, worker.LaunchID)
		if err != nil || !updated {
			log.Printf("Skipping restart for %s: failed to advance matching restart attempt (error: %v)", worker.ConnectionID, err)
			return
		}
	}

	// Respawn while retaining the same per-connection lifecycle lock. Carry the
	// incremented attempt into the replacement launch so registration cannot
	// accidentally reset the durable retry budget.
	nextRestartCount := worker.RestartCount + 1
	log.Printf("Restarting worker %s...", worker.ConnectionID)
	err := m.spawnWorker(
		m.ctx,
		worker.CompanyID,
		worker.ConnectionID,
		worker.TenantSchema,
		worker.DatabaseURL,
		false,
		nextRestartCount,
	)
	if err != nil {
		log.Printf("Auto-restart failed for %s: %v", worker.ConnectionID, err)
		m.mu.RLock()
		failedLaunch, exists := m.workers[worker.ConnectionID]
		var failedCopy *WorkerProcess
		if exists && failedLaunch.CompanyID == worker.CompanyID && failedLaunch.Status == types.StatusError {
			failedCopy = failedLaunch.Copy()
		}
		m.mu.RUnlock()
		if failedCopy != nil {
			// Re-enter normal failure handling after releasing this lifecycle lock.
			// That preserves the incremented budget and schedules the next attempt.
			go m.handleWorkerFailure(failedCopy.ConnectionID, failedCopy.LaunchID, err.Error())
		}
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

func shouldRecoverWorker(w *WorkerRecord) bool {
	return w.DesiredState == DesiredStateRunning
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
		// Check every intent before deciding whether to skip it. A stopped or
		// unlinking row may represent a crash between persisting intent and
		// signaling the old process, and must not leave that child orphaned.
		processMatches, processErr := m.isExpectedWorkerProcess(w.PID, w.CompanyID, w.ConnectionID)
		if processErr != nil {
			return fmt.Errorf("verify persisted worker %s process identity: %w", w.ConnectionID, processErr)
		}
		processAlive := processMatches

		if w.DesiredState == DesiredStateStopped || w.DesiredState == DesiredStateUnlinking {
			if !processAlive {
				if w.DesiredState == DesiredStateUnlinking {
					failed := &WorkerProcess{
						ID: w.ConnectionID, LaunchID: w.LaunchID, DesiredState: DesiredStateUnlinking,
						ConnectionID: w.ConnectionID, CompanyID: w.CompanyID,
						TenantSchema: w.TenantSchema, DatabaseURL: databaseURL,
						Status: types.StatusError, RestartCount: w.RestartCount,
					}
					m.mu.Lock()
					m.workers[w.ConnectionID] = failed
					m.mu.Unlock()
					unlink := m.lockLifecycle(w.ConnectionID)
					err := m.spawnWorker(ctx, w.CompanyID, w.ConnectionID, w.TenantSchema, databaseURL, true, w.RestartCount+1)
					unlink()
					if err != nil {
						return fmt.Errorf("resume durable unlink for worker %s: %w", w.ConnectionID, err)
					}
				} else if removed, err := m.registry.RemoveWorkerLaunch(ctx, w.ConnectionID, w.CompanyID, w.LaunchID); err != nil || !removed {
					log.Printf("Warning: failed to clear completed stopped worker %s: removed=%t error=%v", w.ConnectionID, removed, err)
					if err != nil {
						m.mu.Lock()
						m.workers[w.ConnectionID] = &WorkerProcess{
							ID: w.ConnectionID, LaunchID: w.LaunchID, DesiredState: DesiredStateStopped,
							ConnectionID: w.ConnectionID, CompanyID: w.CompanyID,
							TenantSchema: w.TenantSchema, DatabaseURL: databaseURL,
							Status: types.StatusError, RestartCount: w.RestartCount,
						}
						m.mu.Unlock()
					}
				}
				continue
			}

			pending := &WorkerProcess{
				ID: w.ConnectionID, LaunchID: w.LaunchID, DesiredState: w.DesiredState,
				ConnectionID: w.ConnectionID, CompanyID: w.CompanyID,
				TenantSchema: w.TenantSchema, DatabaseURL: databaseURL,
				Status: w.Status, PID: w.PID, StartedAt: w.StartedAt,
				LastActivity: w.LastHeartbeat, RestartCount: w.RestartCount,
			}
			m.mu.Lock()
			m.workers[w.ConnectionID] = pending
			m.mu.Unlock()
			if w.DesiredState == DesiredStateUnlinking {
				// An adopted process has no wait status, so its exit cannot prove
				// LogoutAndPurge succeeded. Keep the row, stop it, then run a
				// manager-owned one-shot whose clean exit can be verified.
				if err := m.stopWorkerInternal(ctx, w.CompanyID, w.ConnectionID, "resume durable unlink", syscall.SIGUSR1, true); err != nil {
					return fmt.Errorf("stop adopted unlink worker %s: %w", w.ConnectionID, err)
				}
				m.mu.Lock()
				m.workers[w.ConnectionID] = &WorkerProcess{
					ID: w.ConnectionID, LaunchID: w.LaunchID, DesiredState: DesiredStateUnlinking,
					ConnectionID: w.ConnectionID, CompanyID: w.CompanyID,
					TenantSchema: w.TenantSchema, DatabaseURL: databaseURL,
					Status: types.StatusError, RestartCount: w.RestartCount,
				}
				m.mu.Unlock()
				unlink := m.lockLifecycle(w.ConnectionID)
				err := m.spawnWorker(ctx, w.CompanyID, w.ConnectionID, w.TenantSchema, databaseURL, true, w.RestartCount+1)
				unlink()
				if err != nil {
					return fmt.Errorf("verify durable unlink for worker %s: %w", w.ConnectionID, err)
				}
				continue
			}
			if err := m.stopWorkerInternal(ctx, w.CompanyID, w.ConnectionID, "complete durable stopped intent", syscall.SIGTERM, false); err != nil {
				return fmt.Errorf("complete durable stopped intent for worker %s: %w", w.ConnectionID, err)
			}
			m.publishConnectionStatus(w.CompanyID, w.ConnectionID, types.StatusStopped, "completed pending lifecycle request")
			continue
		}
		if !shouldRecoverWorker(w) {
			log.Printf("Skipping worker %s with unknown desired state %q", w.ConnectionID, w.DesiredState)
			continue
		}

		if !processAlive {
			log.Printf("Worker %s (PID %d) is dead or has a reused PID, retaining launch intent and notifying API", w.ConnectionID, w.PID)
			// Tell the API the connection is coming back. Only a record that was
			// not marked for recovery represents an actual crash.
			status, reason := recoveryAnnouncement(w.Status)
			m.publishConnectionStatus(w.CompanyID, w.ConnectionID, status, reason)

			// Trigger respawn if auto-restart enabled
			if m.config.AutoRestartEnabled && w.RestartCount < m.config.AutoRestartMaxRetries {
				workerProcess := &WorkerProcess{
					ID:           w.ConnectionID,
					LaunchID:     w.LaunchID,
					DesiredState: w.DesiredState,
					ConnectionID: w.ConnectionID,
					CompanyID:    w.CompanyID,
					TenantSchema: w.TenantSchema,
					DatabaseURL:  databaseURL,
					Status:       types.StatusError,
					RestartCount: w.RestartCount,
				}
				m.mu.Lock()
				m.workers[w.ConnectionID] = workerProcess
				m.mu.Unlock()
				go m.scheduleRestart(workerProcess.Copy(), "recovered after orchestrator restart")
			} else {
				reason := "automatic restart disabled"
				if w.RestartCount >= m.config.AutoRestartMaxRetries {
					reason = "max restart attempts exceeded"
				}
				m.publishConnectionStatus(w.CompanyID, w.ConnectionID, "failed", reason)
				if removed, removeErr := m.registry.RemoveWorkerLaunch(ctx, w.ConnectionID, w.CompanyID, w.LaunchID); removeErr != nil || !removed {
					log.Printf("Warning: failed to clear terminal recovery row for worker %s: removed=%t error=%v", w.ConnectionID, removed, removeErr)
					m.mu.Lock()
					m.workers[w.ConnectionID] = &WorkerProcess{
						ID: w.ConnectionID, LaunchID: w.LaunchID, DesiredState: w.DesiredState,
						ConnectionID: w.ConnectionID, CompanyID: w.CompanyID,
						TenantSchema: w.TenantSchema, DatabaseURL: databaseURL,
						Status: types.StatusError, RestartCount: w.RestartCount,
					}
					m.mu.Unlock()
				}
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
			LaunchID:     w.LaunchID,
			DesiredState: w.DesiredState,
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
		go m.healthCheckWorker(healthCtx, w.ConnectionID, w.LaunchID)

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
