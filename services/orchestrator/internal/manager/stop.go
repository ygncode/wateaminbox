package manager

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

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
