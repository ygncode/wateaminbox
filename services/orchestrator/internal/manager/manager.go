package manager

import (
	"context"
	crand "crypto/rand"
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"math/rand/v2"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	gnats "github.com/nats-io/nats.go"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// Config holds the configuration for the process manager.
type Config struct {
	ConnectionScope       map[string]bool // nil: unrestricted; empty: deny all starts and ownership acquisition.
	NATSClient            *nats.Client
	WhatsAppBinaryPath    string
	DefaultNATSURL        string
	HealthCheckInterval   time.Duration
	DatabaseURL           string        // Privileged manager URL for registry/control persistence.
	WorkerDatabaseURL     string        // Restricted runtime/session-only worker URL.
	WorkerNATSURL         string        // Restricted worker NATS user URL.
	AutoRestartEnabled    bool          // Enable auto-restart on crash
	AutoRestartMaxRetries int           // Max restart attempts (default: 5)
	AutoRestartBackoff    time.Duration // Base backoff between restarts (default: 5s)
	MaxWorkers            int           // 0 = unlimited
	// AllowanceCheckInterval controls how often running workers are checked
	// against their company's connection allowance (default: 60s).
	AllowanceCheckInterval time.Duration
	ArtifactRoot           string        // Retained immutable worker artifacts.
	DefaultArtifactVersion string        // Artifact used by ordinary spawn/restart.
	DefaultArtifactSHA256  string        // Optional digest for the default artifact.
	RolloutReadyTimeout    time.Duration // Process + authenticated WhatsApp readiness deadline.
	RootManagerApproved    bool          // Explicit approval for Linux root credential isolation.
	// NodeID is this orchestrator instance's stable identity. It scopes durable
	// worker ownership, recovery, and per-node command routing. Required
	// whenever the registry (DatabaseURL) is configured.
	NodeID string
	// FleetMaxConnections caps distinct connections across every node,
	// enforced atomically inside the registry launch claim (0 = unlimited).
	// This is generic capacity protection; commercial entitlement authority
	// stays in the private control plane.
	FleetMaxConnections int
	// NodeLeaseDuration is this node's lease TTL in orchestrator_nodes. An
	// instance that cannot renew within the TTL self-fences: it terminates its
	// workers and exits rather than keep WhatsApp clients alive without
	// ownership authority (default 60s).
	NodeLeaseDuration time.Duration
	// NodeTakeoverMargin is how long past lease expiry a peer waits before
	// taking over a failed node's connections. It must comfortably exceed the
	// fencing detection interval plus the worker stop budget, so the previous
	// owner's clients are provably gone (default 60s).
	NodeTakeoverMargin time.Duration
}

// Manager handles WhatsApp worker process lifecycle.
type Manager struct {
	config        Config
	mu            sync.RWMutex
	workers       map[string]*WorkerProcess // keyed by connectionID
	ctx           context.Context
	cancel        context.CancelFunc
	rolloutCtx    context.Context
	rolloutCancel context.CancelFunc
	wg            sync.WaitGroup
	rolloutWG     sync.WaitGroup
	handlers      *Handlers
	startedAt     time.Time
	shuttingDown  bool            // prevents NATS publishes during shutdown
	registry      *WorkerRegistry // persistent storage for worker state
	// workerDatabaseRole is captured from the already-validated restricted URL
	// during Start and passed to child workers for their current_user check.
	workerDatabaseRole string
	registryReady      atomic.Bool     // enables promoted-artifact reads after recovery
	lifecycle          [256]sync.Mutex // serializes operations for each connection
	rolloutMu          sync.RWMutex    // rollout excludes every normal lifecycle mutation
	// takeoverMu makes shutdown and failed-node ownership transfer mutually
	// exclusive. Once shutdown sets shuttingDown while holding the write lock,
	// no takeover may CAS a connection onto a node that will not restart it.
	takeoverMu  sync.RWMutex
	readinessMu sync.Mutex
	readiness   map[string]chan struct{} // keyed by immutable launch ID
	runtimeSub  *gnats.Subscription

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

	// checkConnectionAllowances names the subset of the given companies that may
	// no longer run any connection. It is wired to the registry when persistence
	// initialises, and is a field rather than a direct registry call so
	// enforcement can be exercised without a database.
	checkConnectionAllowances func(context.Context, []string) ([]string, error)

	// reservedRelaunch is a focused crash-boundary test seam. Production uses
	// spawnWorkerArtifactWithLaunch when it is nil.
	reservedRelaunch func(context.Context, *WorkerUpgradeItem, WorkerArtifact, string) error

	// fenceOnce ensures self-fencing runs exactly once even if the lease loop
	// and an operator signal race.
	fenceOnce sync.Once
	// fatal ends the process after fencing. It is a field rather than a direct
	// os.Exit so fencing can be tested without killing the test binary.
	fatal func(reason string)
}

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
	LastRuntimeSignalAt time.Time // strictly monotonic per launch/readiness token
	ExpectedExit        bool      // Suppresses crash handling in monitorWorkerProcess.
	RemoveOnExit        bool      // One-shot unlink workers remove themselves on exit.
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
	if cfg.AllowanceCheckInterval == 0 {
		cfg.AllowanceCheckInterval = 60 * time.Second
	}
	if cfg.ArtifactRoot == "" {
		cfg.ArtifactRoot = defaultArtifactRoot
	}
	if cfg.DefaultArtifactVersion == "" {
		cfg.DefaultArtifactVersion = defaultArtifactVersion
	}
	if cfg.RolloutReadyTimeout == 0 {
		cfg.RolloutReadyTimeout = 2 * time.Minute
	}
	if cfg.NodeLeaseDuration == 0 {
		cfg.NodeLeaseDuration = 60 * time.Second
	}
	if cfg.NodeTakeoverMargin == 0 {
		cfg.NodeTakeoverMargin = 60 * time.Second
	}

	return &Manager{
		config:    cfg,
		workers:   make(map[string]*WorkerProcess),
		readiness: make(map[string]chan struct{}),
		startedAt: time.Now(),
		fatal: func(reason string) {
			log.Fatalf("orchestrator self-fenced: %s", reason)
		},
	}
}

// Start begins the manager and starts listening for events.
func (m *Manager) Start(ctx context.Context) error {
	log.Println("Starting process manager...")

	if m.config.DatabaseURL != "" {
		if err := validateNodeID(m.config.NodeID); err != nil {
			return fmt.Errorf("ORCHESTRATOR_NODE_ID is required for durable worker ownership: %w", err)
		}
		if strings.TrimSpace(m.config.WorkerDatabaseURL) == "" {
			return errors.New("WORKER_DATABASE_URL is required for durable worker isolation")
		}
		if strings.TrimSpace(m.config.WorkerNATSURL) == "" {
			return errors.New("WORKER_NATS_URL is required for durable worker isolation")
		}
		if m.config.WorkerDatabaseURL == m.config.DatabaseURL {
			return errors.New("WORKER_DATABASE_URL must not reuse the manager database credential")
		}
		if m.config.WorkerNATSURL == m.config.DefaultNATSURL {
			return errors.New("WORKER_NATS_URL must not reuse the service NATS credential")
		}
		if err := validateRestrictedCredentialURL("WORKER_DATABASE_URL", m.config.WorkerDatabaseURL, "postgresql", "wateaminbox_worker"); err != nil {
			return err
		}
		_, m.workerDatabaseRole, _ = credentialUsername(m.config.WorkerDatabaseURL)
		if err := validateRestrictedCredentialURL("WORKER_NATS_URL", m.config.WorkerNATSURL, "nats", "worker"); err != nil {
			return err
		}
		if err := validateRootManagerApproval(m.config.RootManagerApproved); err != nil {
			return err
		}
	}

	m.ctx, m.cancel = context.WithCancel(ctx)
	m.rolloutCtx, m.rolloutCancel = context.WithCancel(m.ctx)

	// Initialize handlers FIRST so we can publish events during recovery.
	m.handlers = NewHandlers(m, m.config.NATSClient)
	// Subscribe before recovering or spawning: process-ready/connected signals
	// are transient and must not race a fast worker launch.
	if m.config.NATSClient != nil {
		if err := m.startRuntimeStatusSubscription(); err != nil {
			return fmt.Errorf("subscribe to worker runtime status: %w", err)
		}
	}

	// Initialize worker registry for persistence (optional - works without it)
	if m.config.DatabaseURL != "" {
		registry, err := NewWorkerRegistry(m.config.DatabaseURL, m.config.NodeID, m.config.FleetMaxConnections)
		if err != nil {
			return fmt.Errorf("failed to initialize required worker registry: %w", err)
		} else {
			m.registry = registry
			m.markWorkersRecovering = registry.MarkWorkersRecovering
			m.recordWorkerHeartbeat = registry.UpdateHeartbeatLaunch
			m.checkConnectionAllowances = registry.CompaniesWithoutConnectionAllowance
			log.Println("Worker registry initialized successfully")

			// Claim the node identity before touching a single durable row.
			// A live lease for this node means another instance is (or very
			// recently was) running as it; recovering here would produce two
			// orchestrators respawning one node's connections.
			if err := registry.RegisterNodeLease(m.ctx, m.config.NodeLeaseDuration, m.advertisedCapacity()); err != nil {
				_ = registry.Close()
				return fmt.Errorf("failed to register orchestrator node lease: %w", err)
			}
			// Renew from the moment of registration so a long recovery cannot
			// silently let the fresh lease lapse.
			m.wg.Add(1)
			go m.runNodeLease(m.ctx)

			// Recovery must finish before commands are consumed. Continuing after
			// an ambiguous durable intent could start a duplicate worker.
			// A failed startup exits through log.Fatalf without reaching
			// Stop(), so the fresh lease must be released here or the
			// replacement container crash-loops on ErrNodeLeaseHeld until the
			// TTL runs out. A failed release falls back to natural expiry.
			releaseLeaseOnStartupFailure := func() {
				m.cancel()
				releaseCtx, cancelRelease := context.WithTimeout(context.Background(), markRecoveringTimeout)
				if releaseErr := registry.ReleaseNodeLease(releaseCtx); releaseErr != nil {
					log.Printf("Warning: failed to release node lease after startup failure: %v", releaseErr)
				}
				cancelRelease()
				_ = registry.Close()
			}
			if err := m.recoverOrphanedWorkers(m.ctx); err != nil {
				releaseLeaseOnStartupFailure()
				return fmt.Errorf("failed to recover workers: %w", err)
			}
			if err := m.RecoverWorkerUpgrade(m.ctx); err != nil {
				releaseLeaseOnStartupFailure()
				return fmt.Errorf("failed to recover worker upgrade: %w", err)
			}
			m.registryReady.Store(true)

			m.wg.Add(1)
			go m.runNodeTakeover(m.ctx)
		}
	} else {
		log.Println("No database URL configured - worker persistence disabled")
	}

	// Start command subscription
	if err := m.handlers.StartSubscription(m.ctx); err != nil {
		return fmt.Errorf("failed to start command subscription: %w", err)
	}

	if m.checkConnectionAllowances != nil {
		m.wg.Add(1)
		go m.runAllowanceEnforcement(m.ctx)
	}

	log.Println("Process manager started successfully")
	return nil
}

func validateRestrictedCredentialURL(name, raw, scheme, username string) error {
	parsed, actualUsername, err := credentialUsername(raw)
	if err != nil || parsed.Scheme != scheme || parsed.Hostname() == "" ||
		!allowedRestrictedUsername(actualUsername, username) {
		return fmt.Errorf("%s must use the dedicated %q user", name, username)
	}
	if password, present := parsed.User.Password(); !present || password == "" {
		return fmt.Errorf("%s must include a non-empty credential", name)
	}
	return nil
}

func credentialUsername(raw string) (*url.URL, string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User == nil || parsed.User.Username() == "" {
		return parsed, "", errors.New("credential URL has no username")
	}
	return parsed, parsed.User.Username(), nil
}

func allowedRestrictedUsername(actual, singleHost string) bool {
	if actual == singleHost {
		return true
	}
	var suffix string
	switch singleHost {
	case "wateaminbox_worker":
		suffix = strings.TrimPrefix(actual, "wti_w_")
		if suffix == actual {
			return false
		}
	case "worker":
		suffix = strings.TrimPrefix(actual, "wti-w-")
		if suffix == actual {
			return false
		}
	default:
		return false
	}
	if len(suffix) != 20 {
		return false
	}
	for _, char := range suffix {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

// Stop gracefully shuts down all managed workers.
func (m *Manager) Stop(ctx context.Context) error {
	log.Println("Stopping process manager...")

	// Publish the shutdown transition before waiting for failed-node takeover.
	// New takeover attempts then return without touching durable ownership. Each
	// takeover CAS has its own short database deadline; taking the write lock
	// waits for any such bounded CAS and local insertion to finish before the
	// worker snapshot below, so no transferred row can be inserted after it.
	m.mu.Lock()
	m.shuttingDown = true
	m.mu.Unlock()
	m.takeoverMu.Lock()
	m.takeoverMu.Unlock()

	// Stop NATS subscription first to prevent processing new commands
	// and avoid "nats: connection closed" errors during shutdown
	if m.runtimeSub != nil {
		if err := m.runtimeSub.Drain(); err != nil {
			log.Printf("Error stopping runtime status subscription: %v", err)
		}
	}
	if m.handlers != nil {
		log.Println("Stopping NATS command subscription...")
		if err := m.handlers.StopSubscription(); err != nil {
			log.Printf("Error stopping NATS subscription: %v", err)
		}
	}

	// Release a lifecycle lock held while waiting for rollout readiness. Its
	// durable phase remains unfinished and startup recovery resumes it. Manager
	// context stays alive so health checks and monitors can still observe workers
	// while they drain.
	if m.rolloutCancel != nil {
		m.rolloutCancel()
	}
	m.rolloutWG.Wait()

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

	// Release the node lease so a stop-first replacement of this node can
	// register immediately instead of waiting out the TTL. Peers still wait
	// the full takeover margin beyond this expiry. Failure is non-fatal: the
	// lease then simply runs out on its own.
	if m.registry != nil {
		releaseCtx, cancelRelease := context.WithTimeout(context.Background(), markRecoveringTimeout)
		if err := m.registry.ReleaseNodeLease(releaseCtx); err != nil {
			log.Printf("Warning: failed to release node lease: %v", err)
		}
		cancelRelease()
	}

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
	DesiredStateRunning           = "running"
	DesiredStateStopped           = "stopped"
	DesiredStateUnlinking         = "unlinking"
	connectionAllowanceStopReason = "connection allowance exhausted"
)

func newReadinessToken() (string, error) {
	var token [32]byte
	if _, err := crand.Read(token[:]); err != nil {
		return "", fmt.Errorf("generate worker readiness token: %w", err)
	}
	return fmt.Sprintf("%x", token[:]), nil
}

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
	m.rolloutMu.RLock()
	defer m.rolloutMu.RUnlock()
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
	if !m.connectionInScope(companyID, connectionID) {
		return ErrConnectionOutsideScope
	}
	artifact, err := m.defaultArtifact(ctx, companyID)
	if err != nil {
		return fmt.Errorf("resolve default worker artifact: %w", err)
	}
	return m.spawnWorkerArtifact(ctx, companyID, connectionID, tenantSchema, databaseURL, unlinkOnStart, restartCount, artifact)
}

// spawnWorkerArtifact starts exactly the already-validated immutable artifact.
// The caller must hold the connection lifecycle lock.
func (m *Manager) spawnWorkerArtifact(
	ctx context.Context,
	companyID, connectionID, tenantSchema, databaseURL string,
	unlinkOnStart bool,
	restartCount int,
	artifact WorkerArtifact,
) error {
	return m.spawnWorkerArtifactWithLaunch(
		ctx, companyID, connectionID, tenantSchema, databaseURL,
		unlinkOnStart, restartCount, artifact, "",
	)
}

func (m *Manager) workerRuntimeURLs(databaseURL string) (string, string, error) {
	workerDatabaseURL := databaseURL
	workerNATSURL := m.config.DefaultNATSURL
	// Restricted NATS authority is useful independently of durable registry
	// persistence, including on non-Linux development hosts.
	if m.config.WorkerNATSURL != "" {
		workerNATSURL = m.config.WorkerNATSURL
	}
	if m.registry != nil {
		workerDatabaseURL = m.config.WorkerDatabaseURL
		if workerDatabaseURL == "" || m.config.WorkerNATSURL == "" {
			return "", "", errors.New("restricted worker database and NATS credentials are required")
		}
	}
	return workerDatabaseURL, workerNATSURL, nil
}

// spawnWorkerArtifactWithLaunch uses a generation durably reserved by a rollout
// before the registry CAS. Ordinary starts pass an empty plannedLaunchID.
func (m *Manager) spawnWorkerArtifactWithLaunch(
	ctx context.Context,
	companyID, connectionID, tenantSchema, databaseURL string,
	unlinkOnStart bool,
	restartCount int,
	artifact WorkerArtifact,
	plannedLaunchID string,
) error {
	launchID := plannedLaunchID
	if !m.connectionInScope(companyID, connectionID) {
		return ErrConnectionOutsideScope
	}
	var err error
	if launchID == "" {
		launchID, err = newLaunchID()
		if err != nil {
			return err
		}
	}
	readinessToken, err := newReadinessToken()
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
	cmd := exec.Command(artifact.BinaryPath)
	workerDatabaseURL, workerNATSURL, err := m.workerRuntimeURLs(databaseURL)
	if err != nil {
		m.mu.Unlock()
		return err
	}
	cmd.Env = append(workerBaseEnvironment(),
		fmt.Sprintf("WORKER_ID=%s", connectionID),
		fmt.Sprintf("COMPANY_ID=%s", companyID),
		fmt.Sprintf("CONNECTION_ID=%s", connectionID),
		fmt.Sprintf("NATS_URL=%s", workerNATSURL),
		fmt.Sprintf("DATABASE_URL=%s", workerDatabaseURL),
		fmt.Sprintf("TENANT_SCHEMA=%s", tenantSchema),
		fmt.Sprintf("UNLINK_ON_START=%t", unlinkOnStart),
		fmt.Sprintf("WORKER_LAUNCH_ID=%s", launchID),
		fmt.Sprintf("WORKER_ARTIFACT_VERSION=%s", artifact.Version),
		fmt.Sprintf("WORKER_READINESS_TOKEN=%s", readinessToken),
	)
	if m.registry != nil {
		requiredDatabaseRole := m.workerDatabaseRole
		if requiredDatabaseRole == "" {
			// Some focused manager tests attach a registry directly without Start;
			// retain the supported single-host identity for that internal harness.
			requiredDatabaseRole = "wateaminbox_worker"
		}
		cmd.Env = append(cmd.Env, fmt.Sprintf("WORKER_REQUIRED_DATABASE_ROLE=%s", requiredDatabaseRole))
	}
	cmd.Stdout = &workerLogWriter{connectionID: connectionID, stream: "stdout"}
	cmd.Stderr = &workerLogWriter{connectionID: connectionID, stream: "stderr"}

	desiredState := DesiredStateRunning
	if unlinkOnStart {
		desiredState = DesiredStateUnlinking
	}
	worker := &WorkerProcess{
		ID:              connectionID,
		LaunchID:        launchID,
		DesiredState:    desiredState,
		CompanyID:       companyID,
		ConnectionID:    connectionID,
		TenantSchema:    tenantSchema,
		DatabaseURL:     workerDatabaseURL,
		Status:          types.StatusStarting,
		StartedAt:       time.Now(),
		LastActivity:    time.Now(),
		RestartCount:    restartCount,
		ArtifactVersion: artifact.Version,
		ArtifactSHA256:  artifact.SHA256,
		BinaryPath:      artifact.BinaryPath,
		RemoveOnExit:    unlinkOnStart,
		cmd:             cmd,
		done:            make(chan struct{}),
		readinessToken:  readinessToken,
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
		if err := m.registry.ClaimWorkerLaunch(ctx, worker, previousLaunchID); err != nil {
			removeInMemory()
			if !errors.Is(err, ErrWorkerLaunchConflict) {
				restorePrevious()
			}
			return fmt.Errorf("reserve worker launch: %w", err)
		}
	}
	cmd.SysProcAttr, err = newWorkerSysProcAttr(worker.WorkerUID, worker.WorkerGID)
	if err != nil {
		if m.registry != nil {
			_, _ = m.registry.RemoveWorkerLaunch(ctx, connectionID, companyID, launchID)
		}
		removeInMemory()
		return fmt.Errorf("configure worker process isolation: %w", err)
	}

	log.Printf("Spawning worker for company %s, connection %s as uid/gid %d/%d...", companyID, connectionID, worker.WorkerUID, worker.WorkerGID)
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

func workerBaseEnvironment() []string {
	// Workers receive only this audited data-plane configuration. In particular,
	// manager DB/NATS credentials and operational bearer/JWT authority are never
	// inherited from the root orchestrator environment.
	allowed := []string{
		"LOG_LEVEL",
		"S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET",
		"S3_REGION", "S3_FORCE_PATH_STYLE", "S3_LEGACY_ENDPOINTS",
		"STORAGE_ENDPOINT", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY",
		"STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_FORCE_PATH_STYLE",
		"STORAGE_CREATE_BUCKET_IF_MISSING",
		"WORKER_DB_MAX_OPEN_CONNS", "WORKER_DB_MAX_IDLE_CONNS",
		"WORKER_DB_CONN_MAX_LIFETIME", "WORKER_DB_CONN_MAX_IDLE_TIME",
		"SSL_CERT_FILE", "SSL_CERT_DIR",
	}
	environment := make([]string, 0, len(allowed))
	for _, name := range allowed {
		if value, ok := os.LookupEnv(name); ok {
			environment = append(environment, name+"="+value)
		}
	}
	return environment
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
	m.rolloutMu.RLock()
	defer m.rolloutMu.RUnlock()
	unlock := m.lockLifecycle(connectionID)
	defer unlock()
	if _, err := m.reconcileDurableLifecycleWorker(ctx, companyID, connectionID, ""); err != nil {
		return err
	}
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
	m.rolloutMu.RLock()
	defer m.rolloutMu.RUnlock()
	unlock := m.lockLifecycle(connectionID)
	defer unlock()
	durable, err := m.reconcileDurableLifecycleWorker(ctx, companyID, connectionID, tenantSchema)
	if err != nil {
		return err
	}
	if durable != nil {
		tenantSchema = durable.TenantSchema
		if databaseURL == "" {
			databaseURL = m.config.WorkerDatabaseURL
		}
	}
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
		if m.registry != nil {
			updated, abandoned, err := m.registry.SetDesiredStateAndAbandonHaltedUpgrade(
				ctx, connectionID, companyID, tenantSchema, worker.LaunchID,
				DesiredStateUnlinking, reason,
			)
			if err != nil {
				return fmt.Errorf("persist processless unlink intent: %w", err)
			}
			if !updated {
				return fmt.Errorf("worker %s launch changed before processless unlink", connectionID)
			}
			if abandoned {
				log.Printf("Abandoned halted rollout for processless unlink of worker %s", connectionID)
			}
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

// reconcileDurableLifecycleWorker makes the exact durable launch visible to
// stop/unlink before either operation consults the in-memory map. This is
// essential after a restart or stale callback: halted rollout abandonment is
// authorized by the registry generation, not by volatile process bookkeeping.
func (m *Manager) reconcileDurableLifecycleWorker(
	ctx context.Context, companyID, connectionID, tenantHint string,
) (*WorkerRecord, error) {
	if !m.connectionInScope(companyID, connectionID) {
		return nil, ErrConnectionOutsideScope
	}
	if m.registry == nil {
		return nil, nil
	}
	record, err := m.registry.GetWorker(ctx, connectionID)
	if err != nil {
		return nil, fmt.Errorf("inspect durable worker lifecycle for %s: %w", connectionID, err)
	}
	if record == nil {
		return nil, nil
	}
	if record.CompanyID != companyID {
		return nil, fmt.Errorf("worker %s belongs to another company", connectionID)
	}
	if tenantHint != "" && tenantHint != record.TenantSchema {
		return nil, fmt.Errorf("worker %s tenant changed before lifecycle operation", connectionID)
	}
	if record.ArtifactSHA256 == "" {
		return nil, fmt.Errorf("%w for worker %s", ErrWorkerArtifactNormalization, connectionID)
	}
	m.mu.RLock()
	current := m.workers[connectionID]
	exactMap := current != nil && current.LaunchID == record.LaunchID &&
		current.CompanyID == record.CompanyID && current.TenantSchema == record.TenantSchema
	m.mu.RUnlock()
	if exactMap {
		return record, nil
	}
	binaryPath, err := m.persistedArtifactPath(record.ArtifactVersion, record.ArtifactSHA256)
	if err != nil {
		return nil, fmt.Errorf("validate durable worker artifact identity for %s: %w", connectionID, err)
	}

	m.mu.Lock()
	current = m.workers[connectionID]
	if current == nil || current.LaunchID != record.LaunchID ||
		current.CompanyID != record.CompanyID || current.TenantSchema != record.TenantSchema {
		databaseURL := m.config.WorkerDatabaseURL
		if databaseURL == "" {
			databaseURL = record.DatabaseURL
		}
		status := record.Status
		if record.PID <= 0 {
			status = types.StatusError
		}
		m.workers[connectionID] = &WorkerProcess{
			ID: record.ConnectionID, ConnectionID: record.ConnectionID,
			CompanyID: record.CompanyID, TenantSchema: record.TenantSchema,
			DatabaseURL: databaseURL, PID: record.PID, Status: status,
			StartedAt: record.StartedAt, LastActivity: record.LastHeartbeat,
			RestartCount: record.RestartCount, LaunchID: record.LaunchID,
			DesiredState: record.DesiredState, ArtifactVersion: record.ArtifactVersion,
			ArtifactSHA256: record.ArtifactSHA256, BinaryPath: binaryPath,
			WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID,
		}
	}
	m.mu.Unlock()
	return record, nil
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

	// Persist explicit stop intent before signalling. If this exact launch is
	// involved in a halted rollout, abandonment is committed in the same
	// transaction so redelivery can never resume or resurrect it.
	if !preserveRegistry && m.registry != nil {
		updated, abandoned, err := m.registry.SetDesiredStateAndAbandonHaltedUpgrade(
			ctx, connectionID, companyID, worker.TenantSchema, launchID,
			targetDesiredState, reason,
		)
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
		if abandoned {
			log.Printf("Abandoned halted rollout for authoritative lifecycle operation on worker %s", connectionID)
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

	if preserveRegistry && m.registry != nil {
		deactivated, deactivateErr := m.registry.DeactivateWorkerLaunch(
			ctx, connectionID, companyID, launchID, pid,
		)
		if deactivateErr != nil {
			return fmt.Errorf("deactivate confirmed-exited worker %s: %w", connectionID, deactivateErr)
		}
		if !deactivated {
			return fmt.Errorf("worker %s launch or PID changed before deactivation", connectionID)
		}
		m.mu.Lock()
		if current, ok := m.workers[connectionID]; ok && current.LaunchID == launchID {
			current.PID = 0
			current.Status = WorkerStatusRecovering
		}
		m.mu.Unlock()
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

func workerExecutablePath(m *Manager, connectionID string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if worker, ok := m.workers[connectionID]; ok && worker.BinaryPath != "" {
		return worker.BinaryPath
	}
	return m.config.WhatsAppBinaryPath
}

func (m *Manager) isExpectedWorkerProcess(pid int, companyID, connectionID string) (bool, error) {
	m.mu.RLock()
	worker := m.workers[connectionID]
	m.mu.RUnlock()
	if worker == nil {
		return false, nil
	}
	return m.isExpectedWorkerProcessAtPath(pid, companyID, connectionID, workerExecutablePath(m, connectionID), worker.WorkerUID, worker.WorkerGID)
}

func (m *Manager) isExpectedWorkerProcessAtPath(pid int, companyID, connectionID, expectedPath string, expectedUID, expectedGID int) (bool, error) {
	return m.isExpectedWorkerProcessAtPathWithCredentials(pid, companyID, connectionID, expectedPath, func(pid int) (bool, error) {
		return workerProcessCredentialsMatch(pid, expectedUID, expectedGID)
	})
}

func (m *Manager) isExpectedLegacyWorkerProcessAtPath(pid int, companyID, connectionID, expectedPath string) (bool, error) {
	return m.isExpectedWorkerProcessAtPathWithCredentials(pid, companyID, connectionID, expectedPath, legacyWorkerProcessCredentialsMatch)
}

func (m *Manager) isExpectedWorkerProcessAtPathWithCredentials(
	pid int, companyID, connectionID, expectedPath string,
	credentialsMatch func(int) (bool, error),
) (bool, error) {
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

	expected, expectedErr := filepath.EvalSymlinks(expectedPath)
	if expectedErr != nil {
		expected = expectedPath
	}
	actual, actualErr := filepath.EvalSymlinks(executable)
	if actualErr != nil {
		actual = executable
	}
	if actual != expected {
		return false, nil
	}
	credentialsOK, err := credentialsMatch(pid)
	if err != nil {
		return false, fmt.Errorf("verify PID %d credentials: %w", pid, err)
	}
	if !credentialsOK {
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
	m.rolloutMu.RLock()
	defer m.rolloutMu.RUnlock()
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

	m.rolloutMu.RLock()
	defer m.rolloutMu.RUnlock()
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
	artifact, artifactErr := m.defaultArtifact(m.ctx, worker.CompanyID)
	if worker.ArtifactSHA256 != "" {
		artifact, artifactErr = m.resolveArtifact(worker.ArtifactVersion, worker.ArtifactSHA256)
	}
	if artifactErr != nil {
		log.Printf("Auto-restart refused unsafe artifact for %s: %v", worker.ConnectionID, artifactErr)
		return
	}
	err := m.spawnWorkerArtifact(
		m.ctx,
		worker.CompanyID,
		worker.ConnectionID,
		worker.TenantSchema,
		worker.DatabaseURL,
		false,
		nextRestartCount,
		artifact,
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

func processIsAlive(pid int) (bool, error) {
	if pid <= 0 {
		return false, nil
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false, nil
	}
	if err = process.Signal(syscall.Signal(0)); err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH) {
		return false, nil
	}
	return false, err
}

// normalizeLegacyWorker stops the pre-isolation UID-10001 process (if it still
// exists), proves its exit, and only then binds the durable row to the exact
// installed bootstrap bytes. A mismatched live PID is never treated as dead.
func (m *Manager) normalizeLegacyWorker(ctx context.Context, w *WorkerRecord) error {
	artifact, err := m.configuredBootstrapArtifact()
	if err != nil {
		return fmt.Errorf("resolve bootstrap artifact: %w", err)
	}
	if err := validateArtifactSHA256(artifact.SHA256); err != nil {
		return fmt.Errorf("bootstrap artifact has no durable digest: %w", err)
	}
	matches, err := m.isExpectedLegacyWorkerProcessAtPath(
		w.PID, w.CompanyID, w.ConnectionID, m.config.WhatsAppBinaryPath,
	)
	if err != nil {
		return fmt.Errorf("verify legacy worker process: %w", err)
	}
	if !matches {
		alive, aliveErr := processIsAlive(w.PID)
		if aliveErr != nil {
			return fmt.Errorf("inspect legacy worker PID %d: %w", w.PID, aliveErr)
		}
		if alive {
			return fmt.Errorf("refusing to normalize legacy worker %s: PID %d is live but does not match bootstrap path, tenant, connection, and UID/GID 10001", w.ConnectionID, w.PID)
		}
	} else {
		process, findErr := os.FindProcess(w.PID)
		if findErr != nil {
			return fmt.Errorf("find legacy worker PID %d: %w", w.PID, findErr)
		}
		if pgid, pgErr := syscall.Getpgid(w.PID); pgErr == nil && pgid == w.PID {
			err = syscall.Kill(-pgid, syscall.SIGTERM)
		} else {
			err = process.Signal(syscall.SIGTERM)
		}
		if err != nil && !errors.Is(err, os.ErrProcessDone) && !errors.Is(err, syscall.ESRCH) {
			return fmt.Errorf("stop legacy worker PID %d: %w", w.PID, err)
		}
		if err = waitForProcessExit(ctx, w.PID, 5*time.Second); err != nil {
			if pgid, pgErr := syscall.Getpgid(w.PID); pgErr == nil && pgid == w.PID {
				_ = syscall.Kill(-pgid, syscall.SIGKILL)
			} else {
				_ = process.Signal(syscall.SIGKILL)
			}
			if killErr := waitForProcessExit(ctx, w.PID, 2*time.Second); killErr != nil {
				return fmt.Errorf("confirm legacy worker PID %d exit: %w", w.PID, killErr)
			}
		}
	}
	normalized, err := m.registry.NormalizeLegacyWorkerArtifact(
		ctx, w.ConnectionID, w.CompanyID, w.TenantSchema, w.LaunchID,
		artifact.Version, artifact.SHA256,
	)
	if err != nil {
		return err
	}
	if !normalized {
		return errors.New("legacy worker generation changed before artifact normalization")
	}
	w.ArtifactVersion = artifact.Version
	w.ArtifactSHA256 = artifact.SHA256
	w.PID = 0
	w.Status = WorkerStatusRecovering
	return nil
}

// recoverOrphanedWorkers recovers this node's workers from the database after
// orchestrator restart. Rows owned by other nodes are never read: their PIDs
// are host-local, and adopting or respawning them here would run a duplicate
// whatsmeow client against a connection another node still manages.
func (m *Manager) recoverOrphanedWorkers(ctx context.Context) error {
	if m.registry == nil {
		return nil
	}

	// Claim pre-migration rows first. NULL node_id is the CAS predicate, so a
	// concurrently starting node can never adopt the same row.
	if m.config.ConnectionScope == nil {
		adopted, err := m.registry.AdoptUnassignedWorkers(ctx)
		if err != nil {
			return fmt.Errorf("failed to adopt unassigned workers: %w", err)
		}
		if adopted > 0 {
			log.Printf("Adopted %d worker record(s) with no node owner as node %s", adopted, m.config.NodeID)
		}
	}

	workers, err := m.registry.GetNodeWorkers(ctx)
	if err != nil {
		return fmt.Errorf("failed to get workers from registry: %w", err)
	}

	if len(workers) == 0 {
		log.Println("No workers to recover from registry")
		return nil
	}

	log.Printf("Found %d workers owned by node %s in registry, checking status...", len(workers), m.config.NodeID)

	// An unfinished artifact upgrade owns its connections before ordinary crash
	// recovery. Otherwise a dead source generation could be auto-restarted with
	// the default artifact while the durable stop-first state machine is about to
	// launch its target, creating overlap.
	upgradeItems := make(map[string]*WorkerUpgradeItem)
	if active, activeErr := m.registry.GetActiveWorkerUpgradeBatch(ctx); activeErr != nil {
		return fmt.Errorf("load active worker upgrade before recovery: %w", activeErr)
	} else if active != nil {
		for _, item := range active.Items {
			if item.CompletedAt == nil {
				upgradeItems[item.ConnectionID] = item
			}
		}
	}

	for _, w := range workers {
		if !m.connectionInScope(w.CompanyID, w.ConnectionID) {
			return ErrConnectionOutsideScope
		}
		if w.ArtifactSHA256 == "" {
			if err := m.normalizeLegacyWorker(ctx, w); err != nil {
				return fmt.Errorf("normalize legacy worker %s: %w", w.ConnectionID, err)
			}
		}
		if err := validateWorkerIdentity(w.WorkerUID, w.WorkerGID); err != nil {
			return fmt.Errorf("worker %s has unsafe durable process credentials: %w", w.ConnectionID, err)
		}
		databaseURL := m.config.WorkerDatabaseURL
		if databaseURL == "" {
			databaseURL = w.DatabaseURL // Persistence-free compatibility only.
		}
		if item := upgradeItems[w.ConnectionID]; item != nil {
			if item.CompanyID != w.CompanyID || item.TenantSchema != w.TenantSchema {
				return fmt.Errorf("active worker upgrade tenant snapshot no longer matches connection %s", w.ConnectionID)
			}
			artifact, artifactErr := m.resolveArtifact(w.ArtifactVersion, w.ArtifactSHA256)
			if artifactErr != nil {
				return fmt.Errorf("validate persisted artifact for upgrade recovery %s: %w", w.ConnectionID, artifactErr)
			}
			adopted := &WorkerProcess{
				ID: w.ConnectionID, LaunchID: w.LaunchID, DesiredState: w.DesiredState,
				CompanyID: w.CompanyID, ConnectionID: w.ConnectionID, TenantSchema: w.TenantSchema,
				DatabaseURL: databaseURL, Status: w.Status, PID: w.PID, StartedAt: w.StartedAt,
				LastActivity: w.LastHeartbeat, RestartCount: w.RestartCount,
				ArtifactVersion: artifact.Version, ArtifactSHA256: artifact.SHA256, BinaryPath: artifact.BinaryPath,
				WorkerUID: w.WorkerUID, WorkerGID: w.WorkerGID,
			}
			m.mu.Lock()
			m.workers[w.ConnectionID] = adopted
			m.mu.Unlock()
			processMatches, processErr := m.isExpectedWorkerProcess(w.PID, w.CompanyID, w.ConnectionID)
			if processErr != nil {
				return fmt.Errorf("verify persisted upgrade worker %s: %w", w.ConnectionID, processErr)
			}
			if !processMatches {
				m.mu.Lock()
				adopted.PID = 0
				adopted.Status = types.StatusError
				m.mu.Unlock()
			} else {
				healthCtx, healthCancel := context.WithCancel(m.ctx)
				adopted.healthCancel = healthCancel
				m.wg.Add(1)
				go m.healthCheckWorker(healthCtx, w.ConnectionID, w.LaunchID)
			}
			continue
		}

		// Check every intent before deciding whether to skip it. A stopped or
		// unlinking row may represent a crash between persisting intent and
		// signaling the old process, and must not leave that child orphaned.
		expectedBinary := m.config.WhatsAppBinaryPath
		if w.ArtifactSHA256 != "" {
			artifact, artifactErr := m.resolveArtifact(w.ArtifactVersion, w.ArtifactSHA256)
			if artifactErr != nil {
				return fmt.Errorf("validate persisted worker artifact %s: %w", w.ConnectionID, artifactErr)
			}
			expectedBinary = artifact.BinaryPath
		}
		processMatches, processErr := m.isExpectedWorkerProcessAtPath(w.PID, w.CompanyID, w.ConnectionID, expectedBinary, w.WorkerUID, w.WorkerGID)
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
				ArtifactVersion: w.ArtifactVersion, ArtifactSHA256: w.ArtifactSHA256,
				BinaryPath: expectedBinary, WorkerUID: w.WorkerUID, WorkerGID: w.WorkerGID,
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
					ArtifactVersion: w.ArtifactVersion, ArtifactSHA256: w.ArtifactSHA256,
					BinaryPath: expectedBinary, WorkerUID: w.WorkerUID, WorkerGID: w.WorkerGID,
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
			ID:              w.ConnectionID,
			LaunchID:        w.LaunchID,
			DesiredState:    w.DesiredState,
			CompanyID:       w.CompanyID,
			ConnectionID:    w.ConnectionID,
			TenantSchema:    w.TenantSchema,
			DatabaseURL:     databaseURL,
			Status:          w.Status,
			PID:             w.PID,
			StartedAt:       w.StartedAt,
			LastActivity:    w.LastHeartbeat,
			RestartCount:    w.RestartCount,
			ArtifactVersion: w.ArtifactVersion,
			ArtifactSHA256:  w.ArtifactSHA256,
			BinaryPath:      expectedBinary,
			WorkerUID:       w.WorkerUID,
			WorkerGID:       w.WorkerGID,
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

// runNodeLease renews this node's ownership lease. Losing the lease is losing
// the authority to run workers: another node may take over this node's
// connections once the lease has been expired past the takeover margin, so an
// instance that cannot renew must terminate its own workers first.
func (m *Manager) runNodeLease(ctx context.Context) {
	defer m.wg.Done()

	interval := m.config.NodeLeaseDuration / 4
	if interval < time.Second {
		interval = time.Second
	}

	// Renewal I/O must not be the lease watchdog. A half-open PostgreSQL
	// connection can leave ExecContext blocked well past the database lease and
	// takeover margin, while this node's workers keep running. Keep an absolute
	// deadline in this goroutine and perform each renewal asynchronously so the
	// deadline can self-fence even when the driver never returns.
	leaseDeadline := time.Now().Add(m.config.NodeLeaseDuration)
	renewTimer := time.NewTimer(interval)
	deadlineTimer := time.NewTimer(time.Until(leaseDeadline))
	defer renewTimer.Stop()
	defer deadlineTimer.Stop()

	type renewalResult struct {
		renewed bool
		err     error
	}
	fence := func(reason string) {
		go m.selfFence(reason)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-deadlineTimer.C:
			fence("node lease could not be renewed within its duration")
			return
		case <-renewTimer.C:
			// Bound the database request too, so a cooperative driver releases its
			// connection promptly. The independent deadlineTimer remains the
			// authority when the driver does not honor cancellation.
			renewCtx, cancelRenew := context.WithDeadline(ctx, leaseDeadline)
			resultCh := make(chan renewalResult, 1)
			go func() {
				renewed, err := m.registry.RenewNodeLease(renewCtx, m.config.NodeLeaseDuration)
				resultCh <- renewalResult{renewed: renewed, err: err}
			}()

			select {
			case <-ctx.Done():
				cancelRenew()
				return
			case <-deadlineTimer.C:
				cancelRenew()
				fence("node lease could not be renewed within its duration")
				return
			case result := <-resultCh:
				cancelRenew()
				// A result racing the deadline cannot restore authority. Fence
				// conservatively even if the delayed query reports success: a peer
				// may already have observed expiry and entered takeover.
				if !time.Now().Before(leaseDeadline) {
					fence("node lease could not be renewed within its duration")
					return
				}
				if result.err != nil {
					log.Printf("Warning: node lease renewal failed (will retry): %v", result.err)
					renewTimer.Reset(interval)
					continue
				}
				if !result.renewed {
					fence("node lease expired or was taken")
					return
				}

				leaseDeadline = time.Now().Add(m.config.NodeLeaseDuration)
				if !deadlineTimer.Stop() {
					select {
					case <-deadlineTimer.C:
					default:
					}
				}
				deadlineTimer.Reset(time.Until(leaseDeadline))
				renewTimer.Reset(interval)
			}
		}
	}
}

// selfFence terminates every worker and exits the process. Runs at most once.
// Registry rows are preserved (workers are marked recovering) so a peer's
// takeover, or this node's own restart, can resume the connections. On Linux
// the workers' parent-death SIGKILL backstops this even if the graceful stop
// fails: exiting the process kills the children.
func (m *Manager) selfFence(reason string) {
	m.fenceOnce.Do(func() {
		log.Printf("SELF-FENCE: %s; terminating workers before exit", reason)
		stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := m.Stop(stopCtx); err != nil {
			log.Printf("Warning: fencing stop finished with errors: %v", err)
		}
		m.fatal(reason)
	})
}

// runNodeTakeover periodically adopts connections owned by nodes whose lease
// has been expired past the takeover margin, meaning the previous owner has
// provably self-fenced. A missed heartbeat alone never triggers takeover: two
// live whatsmeow clients on one connection's device rows can corrupt the
// session or force a customer-visible re-pair.
func (m *Manager) runNodeTakeover(ctx context.Context) {
	defer m.wg.Done()

	interval := m.config.NodeLeaseDuration / 2
	if interval < 5*time.Second {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.takeOverFailedNodes(ctx)
		}
	}
}

func (m *Manager) takeOverFailedNodes(ctx context.Context) {
	if m.config.ConnectionScope != nil && len(m.config.ConnectionScope) == 0 {
		return
	}
	m.mu.RLock()
	shuttingDown := m.shuttingDown
	m.mu.RUnlock()
	if shuttingDown || m.registry == nil || !m.config.AutoRestartEnabled {
		return
	}
	candidates, err := m.registry.ListFailedNodeWorkers(ctx, m.config.NodeTakeoverMargin)
	if err != nil {
		log.Printf("Warning: failed to list failed-node workers: %v", err)
		return
	}
	if len(candidates) == 0 {
		return
	}

	// A connection inside an unfinished rollout item belongs to the durable
	// stop-first state machine, not to crash takeover. Adopting it here could
	// overlap a source and target generation.
	upgradeOwned := make(map[string]struct{})
	if active, activeErr := m.registry.GetActiveWorkerUpgradeBatch(ctx); activeErr != nil {
		log.Printf("Warning: skipping node takeover; cannot inspect active rollout: %v", activeErr)
		return
	} else if active != nil {
		for _, item := range active.Items {
			if item.CompletedAt == nil {
				upgradeOwned[item.ConnectionID] = struct{}{}
			}
		}
	}

	for _, record := range candidates {
		if !m.connectionInScope(record.CompanyID, record.ConnectionID) {
			continue
		}
		if _, owned := upgradeOwned[record.ConnectionID]; owned {
			log.Printf("Leaving failed-node connection %s to the active rollout state machine", record.ConnectionID)
			continue
		}
		if record.RestartCount >= m.config.AutoRestartMaxRetries {
			log.Printf("Not taking over connection %s: restart budget exhausted (%d)", record.ConnectionID, record.RestartCount)
			continue
		}
		if m.config.MaxWorkers > 0 && m.WorkerCount() >= m.config.MaxWorkers {
			log.Printf("Node at local capacity (%d); deferring remaining failed-node takeovers", m.config.MaxWorkers)
			return
		}

		// Shutdown takes the write lock before setting shuttingDown and taking
		// its worker snapshot. Hold the read lock only across this row's CAS and
		// local insertion: shutdown then either sees the adopted worker, or this
		// takeover observes shutdown and performs no durable mutation.
		m.takeoverMu.RLock()
		m.mu.RLock()
		shuttingDown := m.shuttingDown
		m.mu.RUnlock()
		if shuttingDown {
			m.takeoverMu.RUnlock()
			return
		}

		takeoverCtx, cancelTakeover := context.WithTimeout(ctx, markRecoveringTimeout)
		transferred, err := m.registry.TakeOverFailedNodeWorker(takeoverCtx, record.ConnectionID, record.NodeID, m.config.NodeTakeoverMargin)
		cancelTakeover()
		if err != nil {
			// A timed-out UPDATE is ambiguous: PostgreSQL may have committed the
			// ownership transfer even though the client received an error. Resolve
			// from a fresh connection before releasing the shutdown barrier; if
			// ownership is ours, track the authoritative row locally so shutdown
			// sees it and normal restart can resume it.
			verifyCtx, cancelVerify := context.WithTimeout(context.Background(), markRecoveringTimeout)
			current, verifyErr := m.registry.GetWorker(verifyCtx, record.ConnectionID)
			cancelVerify()
			if verifyErr == nil && current != nil && current.NodeID == m.config.NodeID && current.DesiredState == DesiredStateRunning {
				log.Printf("Takeover of connection %s returned an ambiguous error but durable ownership is node %s", record.ConnectionID, m.config.NodeID)
				record = current
				transferred = true
			} else {
				if verifyErr != nil {
					// Preserve a provisional local entry before releasing the barrier.
					// Whether the UPDATE committed or not, shutdown will include this
					// launch in its recovery snapshot instead of allowing a possibly
					// transferred row to appear after the snapshot.
					provisional := &WorkerProcess{
						ID: record.ConnectionID, LaunchID: record.LaunchID,
						DesiredState: record.DesiredState, ConnectionID: record.ConnectionID,
						CompanyID: record.CompanyID, TenantSchema: record.TenantSchema,
						DatabaseURL: m.config.WorkerDatabaseURL, Status: types.StatusError,
						RestartCount: record.RestartCount, ArtifactVersion: record.ArtifactVersion,
						ArtifactSHA256: record.ArtifactSHA256, WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID,
					}
					m.mu.Lock()
					if _, exists := m.workers[record.ConnectionID]; !exists {
						m.workers[record.ConnectionID] = provisional
					}
					alreadyShuttingDown := m.shuttingDown
					m.mu.Unlock()
					m.takeoverMu.RUnlock()
					log.Printf("Error: takeover of connection %s is ambiguous and ownership verification failed: update=%v verify=%v", record.ConnectionID, err, verifyErr)
					if !alreadyShuttingDown {
						go m.selfFence("failed to resolve ambiguous node takeover for connection " + record.ConnectionID)
					}
					return
				}
				m.takeoverMu.RUnlock()
				log.Printf("Warning: takeover of connection %s from node %s failed: %v", record.ConnectionID, record.NodeID, err)
				continue
			}
		}
		if !transferred {
			m.takeoverMu.RUnlock()
			// The owner came back and renewed, or a sibling won the CAS.
			continue
		}
		log.Printf("Took over connection %s from failed node %s", record.ConnectionID, record.NodeID)

		// Carry the durable artifact identity into the respawn: with it set,
		// scheduleRestart resolves exactly the persisted artifact (and refuses
		// loudly when this host lacks it) instead of silently rewriting the
		// row to this node's default artifact through the claim upsert.
		workerProcess := &WorkerProcess{
			ID:              record.ConnectionID,
			LaunchID:        record.LaunchID,
			DesiredState:    record.DesiredState,
			ConnectionID:    record.ConnectionID,
			CompanyID:       record.CompanyID,
			TenantSchema:    record.TenantSchema,
			DatabaseURL:     m.config.WorkerDatabaseURL,
			Status:          types.StatusError,
			RestartCount:    record.RestartCount,
			ArtifactVersion: record.ArtifactVersion,
			ArtifactSHA256:  record.ArtifactSHA256,
			WorkerUID:       record.WorkerUID,
			WorkerGID:       record.WorkerGID,
		}
		m.mu.Lock()
		if _, exists := m.workers[record.ConnectionID]; exists {
			m.mu.Unlock()
			m.takeoverMu.RUnlock()
			log.Printf("Warning: connection %s already tracked locally after takeover; leaving existing entry", record.ConnectionID)
			continue
		}
		m.workers[record.ConnectionID] = workerProcess
		m.mu.Unlock()
		m.takeoverMu.RUnlock()

		m.publishConnectionStatus(record.CompanyID, record.ConnectionID, types.StatusConnecting, "recovering connection from failed orchestrator node")
		go m.scheduleRestart(workerProcess.Copy(), "taken over from failed node "+record.NodeID)
	}
}

// runAllowanceEnforcement periodically reconciles running workers against their
// company's connection allowance.
func (m *Manager) runAllowanceEnforcement(ctx context.Context) {
	defer m.wg.Done()

	ticker := time.NewTicker(m.config.AllowanceCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.enforceConnectionAllowance(ctx)
		}
	}
}

// enforceConnectionAllowance stops workers whose company may no longer run any
// connection. The API already refuses to create a connection past the
// allowance; this applies the same rule to connections that are already
// running, which nothing else does — a running worker holds a WhatsApp session
// and keeps writing inbound media regardless of what the API would permit now.
//
// Fails open by design. If the allowance cannot be read the workers are left
// alone: a database blip must never take down live WhatsApp sessions.
func (m *Manager) enforceConnectionAllowance(ctx context.Context) {
	if m.checkConnectionAllowances == nil {
		return
	}

	workers := m.ListWorkers()
	if len(workers) == 0 {
		return
	}

	seen := make(map[string]struct{}, len(workers))
	companyIDs := make([]string, 0, len(workers))
	for _, worker := range workers {
		if worker.CompanyID == "" {
			continue
		}
		if _, duplicate := seen[worker.CompanyID]; duplicate {
			continue
		}
		seen[worker.CompanyID] = struct{}{}
		companyIDs = append(companyIDs, worker.CompanyID)
	}

	blocked, err := m.checkConnectionAllowances(ctx, companyIDs)
	if err != nil {
		log.Printf("Warning: connection allowance check failed, leaving workers running: %v", err)
		return
	}
	if len(blocked) == 0 {
		return
	}

	blockedSet := make(map[string]struct{}, len(blocked))
	for _, companyID := range blocked {
		blockedSet[companyID] = struct{}{}
	}

	for _, worker := range workers {
		if _, stop := blockedSet[worker.CompanyID]; !stop {
			continue
		}
		log.Printf(
			"Stopping worker %s: company %s has no remaining connection allowance",
			worker.ConnectionID, worker.CompanyID,
		)
		// StopWorker removes the durable registry record, so a later
		// orchestrator restart does not respawn what was deliberately stopped.
		// Credentials are preserved: restoring the allowance and reconnecting
		// does not require pairing again.
		if err := m.StopWorker(
			ctx, worker.CompanyID, worker.ConnectionID, connectionAllowanceStopReason,
		); err != nil {
			log.Printf("Warning: failed to stop worker %s: %v", worker.ConnectionID, err)
		}
	}
}
