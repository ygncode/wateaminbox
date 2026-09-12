package manager

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"syscall"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

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
// Authenticated runtime edges are persisted in the registry, but that durable
// observation can still lag the surviving process during a transient NATS or
// database failure. Republishing it could overwrite the newer status already
// held by the API, so recovery must not manufacture a customer-facing event.
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
	adopted, err := m.registry.AdoptUnassignedWorkers(ctx)
	if err != nil {
		return fmt.Errorf("failed to adopt unassigned workers: %w", err)
	}
	if adopted > 0 {
		log.Printf("Adopted %d worker record(s) with no node owner as node %s", adopted, m.config.NodeID)
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
