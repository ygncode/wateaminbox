package manager

import (
	"context"
	crand "crypto/rand"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
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
