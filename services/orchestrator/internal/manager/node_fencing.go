package manager

import (
	"context"
	"log"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

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
