package manager

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	gnats "github.com/nats-io/nats.go"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/nats"
)

// Config holds the configuration for the process manager.
type Config struct {
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

	// persistWorkerRuntimeStatus keeps the registry's operational status aligned
	// with authenticated runtime edges. Keeping this as a seam makes the NATS
	// status path testable without a database.
	persistWorkerRuntimeStatus func(context.Context, string, string, string, string) error

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
			m.persistWorkerRuntimeStatus = registry.UpdateRuntimeStatusLaunch
			m.checkConnectionAllowances = registry.CompaniesWithoutConnectionAllowance
			log.Println("Worker registry initialized successfully")

			// Claim the node identity before touching a single durable row.
			// A live lease for this node means another instance is (or very
			// recently was) running as it; recovering here would produce two
			// orchestrators respawning one node's connections.
			if err := registry.RegisterNodeLease(m.ctx, m.config.NodeLeaseDuration, m.config.MaxWorkers); err != nil {
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

func (m *Manager) lockLifecycle(connectionID string) func() {
	h := fnv.New32a()
	_, _ = h.Write([]byte(connectionID))
	lock := &m.lifecycle[h.Sum32()%uint32(len(m.lifecycle))]
	lock.Lock()
	return lock.Unlock
}

// markRecoveringTimeout bounds the single registry write that shutdown performs
// before signalling any worker. It is deliberately far below the shutdown
// budget in main.go: the write is bookkeeping, and the workers' sessions are
// what the budget is for.
const markRecoveringTimeout = 5 * time.Second

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
