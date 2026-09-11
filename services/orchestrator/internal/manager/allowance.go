package manager

import (
	"context"
	"log"
	"time"
)

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
