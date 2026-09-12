package manager

import (
	"context"
	"log"
	"math/rand/v2"
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

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
