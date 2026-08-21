package manager

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"syscall"

	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

var (
	ErrUpgradeUnavailable = errors.New("durable worker upgrades are unavailable")
	ErrUpgradeNoWorkers   = errors.New("no workers matched the upgrade selector")
)

// WorkerUpgradeRequest selects a retained immutable artifact and optionally
// scopes the rollout to one tenant/company or one connection. Empty selectors
// mean all currently managed running workers.
type WorkerUpgradeRequest struct {
	TargetArtifactVersion string `json:"target_artifact_version"`
	TargetArtifactSHA256  string `json:"target_artifact_sha256"`
	CompanyID             string `json:"company_id,omitempty"`
	ConnectionID          string `json:"connection_id,omitempty"`
}

// StartWorkerUpgrade snapshots every exact tenant-owned launch in one database
// transaction before the asynchronous runner signals any process.
func (m *Manager) StartWorkerUpgrade(ctx context.Context, request WorkerUpgradeRequest) (*WorkerUpgradeBatch, error) {
	if m.registry == nil {
		return nil, ErrUpgradeUnavailable
	}
	if request.ConnectionID != "" && request.CompanyID == "" {
		return nil, fmt.Errorf("company_id is required with connection_id")
	}
	target, err := m.resolveArtifact(request.TargetArtifactVersion, request.TargetArtifactSHA256)
	if err != nil {
		return nil, err
	}

	// Freeze every lifecycle entry point before taking the generation snapshot.
	// On success the lock is deliberately handed to the runner goroutine, so no
	// stop/spawn/unlink/restart can slip between durable intent and the first
	// stop-first item.
	if !m.rolloutMu.TryLock() {
		return nil, ErrWorkerUpgradeBatchActive
	}
	lockHandedToRunner := false
	defer func() {
		if !lockHandedToRunner {
			m.rolloutMu.Unlock()
		}
	}()
	workers := m.ListWorkers()
	sort.Slice(workers, func(i, j int) bool {
		if workers[i].CompanyID == workers[j].CompanyID {
			return workers[i].ConnectionID < workers[j].ConnectionID
		}
		return workers[i].CompanyID < workers[j].CompanyID
	})
	intents := make([]WorkerUpgradeItemIntent, 0, len(workers))
	for _, worker := range workers {
		if request.CompanyID != "" && worker.CompanyID != request.CompanyID {
			continue
		}
		if request.ConnectionID != "" && worker.ConnectionID != request.ConnectionID {
			continue
		}
		if worker.DesiredState != DesiredStateRunning || worker.PID <= 0 {
			return nil, fmt.Errorf("worker %s is not a live desired-running generation", worker.ConnectionID)
		}
		if worker.LaunchID == "" || worker.CompanyID == "" || worker.TenantSchema == "" {
			return nil, fmt.Errorf("worker %s lacks tenant or generation identity", worker.ConnectionID)
		}
		// Validate the retained source before comparing content identity. Version
		// names are aliases (not rollout identity): bootstrap and sha256-<digest>
		// may legitimately point at the same immutable bytes.
		source, err := m.resolveArtifact(worker.ArtifactVersion, worker.ArtifactSHA256)
		if err != nil {
			return nil, fmt.Errorf("source artifact for worker %s is not rollback-safe: %w", worker.ConnectionID, err)
		}
		if strings.EqualFold(source.SHA256, target.SHA256) {
			continue
		}
		intents = append(intents, WorkerUpgradeItemIntent{
			Position:              len(intents),
			CompanyID:             worker.CompanyID,
			TenantSchema:          worker.TenantSchema,
			ConnectionID:          worker.ConnectionID,
			SourceGeneration:      worker.LaunchID,
			SourceArtifactVersion: worker.ArtifactVersion,
			SourceArtifactSHA256:  worker.ArtifactSHA256,
		})
	}
	if len(intents) == 0 {
		return nil, ErrUpgradeNoWorkers
	}
	batch, err := m.registry.CreateWorkerUpgradeBatch(ctx, target.Version, target.SHA256, intents)
	if err != nil {
		return nil, err
	}
	lockHandedToRunner = true
	m.startWorkerUpgradeRunnerLocked(batch.ID)
	return batch, nil
}

func (m *Manager) GetWorkerUpgrade(ctx context.Context, id string) (*WorkerUpgradeBatch, error) {
	if m.registry == nil {
		return nil, ErrUpgradeUnavailable
	}
	return m.registry.GetWorkerUpgradeBatch(ctx, id)
}

func (m *Manager) GetActiveWorkerUpgrade(ctx context.Context) (*WorkerUpgradeBatch, error) {
	if m.registry == nil {
		return nil, ErrUpgradeUnavailable
	}
	return m.registry.GetActiveWorkerUpgradeBatch(ctx)
}

// RetryWorkerUpgradeRollback is the only supported transition out of halted.
// It retains the original tenant/source-generation snapshot and merely asks the
// same fail-closed rollback state machine to retry one selected connection.
func (m *Manager) RetryWorkerUpgradeRollback(ctx context.Context, batchID, connectionID string) (*WorkerUpgradeBatch, error) {
	if m.registry == nil {
		return nil, ErrUpgradeUnavailable
	}
	if !m.rolloutMu.TryLock() {
		return nil, ErrWorkerUpgradeBatchActive
	}
	lockHandedToRunner := false
	defer func() {
		if !lockHandedToRunner {
			m.rolloutMu.Unlock()
		}
	}()

	batch, err := m.registry.GetWorkerUpgradeBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if batch == nil || batch.Phase != WorkerUpgradePhaseHalted || batch.CompletedAt != nil {
		return nil, fmt.Errorf("worker upgrade batch is not an active halted batch")
	}
	var selected *WorkerUpgradeItem
	for _, item := range batch.Items {
		if item.CompletedAt == nil && item.ConnectionID == connectionID && item.Phase == WorkerUpgradePhaseHalted {
			selected = item
			break
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("connection is not the actionable halted rollback item")
	}
	if _, err = m.resolveArtifact(selected.SourceArtifactVersion, selected.SourceArtifactSHA256); err != nil {
		return nil, fmt.Errorf("rollback source artifact is unsafe: %w", err)
	}
	resumed, err := m.registry.ResumeHaltedWorkerUpgradeRollback(ctx, batchID, connectionID)
	if err != nil {
		return nil, err
	}
	if !resumed {
		return nil, fmt.Errorf("halted rollout generation changed before retry")
	}
	batch, err = m.registry.GetWorkerUpgradeBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	lockHandedToRunner = true
	m.startWorkerUpgradeRunnerLocked(batchID)
	return batch, nil
}

// RecoverWorkerUpgrade resumes the single database-enforced active batch. It
// is called only after persisted worker launches have been adopted/reconciled
// and before command consumption begins.
func (m *Manager) RecoverWorkerUpgrade(ctx context.Context) error {
	if m.registry == nil {
		return nil
	}
	batch, err := m.registry.GetActiveWorkerUpgradeBatch(ctx)
	if err != nil || batch == nil {
		return err
	}
	if batch.Phase == WorkerUpgradePhaseHalted {
		log.Printf("Worker upgrade %s remains halted for operator intervention: %s", batch.ID, batch.LastError)
		return nil
	}
	// Acquire the writer gate synchronously. Start() invokes this before command
	// subscription, so no command or delayed crash callback can mutate a launch
	// between durable recovery discovery and runner ownership.
	m.rolloutMu.Lock()
	if ctx.Err() != nil {
		m.rolloutMu.Unlock()
		return ctx.Err()
	}
	m.startWorkerUpgradeRunnerLocked(batch.ID)
	return nil
}

func (m *Manager) startWorkerUpgradeRunnerLocked(batchID string) {
	m.rolloutWG.Add(1)
	go func() {
		defer m.rolloutWG.Done()
		m.runWorkerUpgradeLocked(batchID)
	}()
}

// runWorkerUpgradeLocked always releases rolloutMu. StartWorkerUpgrade hands it
// an already-held lock; crash recovery acquires through runWorkerUpgrade.
func (m *Manager) runWorkerUpgradeLocked(batchID string) {
	defer m.rolloutMu.Unlock()

	ctx := m.rolloutCtx
	if ctx == nil {
		ctx = context.Background()
	}
	batch, err := m.registry.GetWorkerUpgradeBatch(ctx, batchID)
	if err != nil || batch == nil || batch.CompletedAt != nil || batch.Phase == WorkerUpgradePhaseHalted {
		if err != nil {
			log.Printf("Load worker upgrade %s: %v", batchID, err)
		}
		return
	}
	if batch.Phase == WorkerUpgradePhaseRollback {
		m.runWorkerUpgradeRollbackBatch(ctx, batch)
		return
	}
	var firstPending *WorkerUpgradeItem
	for _, item := range batch.Items {
		if item.CompletedAt == nil {
			firstPending = item
			break
		}
	}
	if firstPending == nil {
		if completed, completeErr := m.registry.CompleteWorkerUpgradeBatch(ctx, batch.ID, batch.Phase, "completed"); completeErr != nil || !completed {
			log.Printf("Complete recovered worker upgrade %s: completed=%t error=%v", batch.ID, completed, completeErr)
		}
		return
	}
	target, err := m.resolveArtifact(batch.TargetArtifactVersion, batch.TargetArtifactSHA256)
	if err != nil {
		cause := fmt.Errorf("target artifact validation failed: %w", err)
		began, beginErr := m.registry.BeginWorkerUpgradeRollback(
			ctx, batch.ID, firstPending.CompanyID, firstPending.TenantSchema,
			firstPending.ConnectionID, firstPending.SourceGeneration,
			firstPending.Phase, firstPending.TargetGeneration, cause.Error(),
		)
		if beginErr != nil || !began {
			m.haltUpgrade(ctx, batch, firstPending, transitionFailure(cause, "persist batch-wide rollback", began, beginErr))
			return
		}
		rollbackBatch, loadErr := m.registry.GetWorkerUpgradeBatch(ctx, batch.ID)
		if loadErr != nil || rollbackBatch == nil {
			m.haltUpgrade(ctx, batch, firstPending, transitionFailure(cause, "reload batch-wide rollback", rollbackBatch != nil, loadErr))
			return
		}
		m.runWorkerUpgradeRollbackBatch(ctx, rollbackBatch)
		return
	}
	for _, item := range batch.Items {
		if item.CompletedAt != nil {
			continue
		}
		if item.Phase == WorkerUpgradePhaseHalted {
			return
		}
		itemErr := m.runWorkerUpgradeItem(ctx, batch, item, target)
		if itemErr == nil {
			continue
		}
		if ctx.Err() != nil {
			log.Printf("Paused worker upgrade %s during orchestrator shutdown: %v", batch.ID, itemErr)
			return
		}
		began, beginErr := m.registry.BeginWorkerUpgradeRollback(
			ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
			item.SourceGeneration, item.Phase, item.TargetGeneration, itemErr.Error(),
		)
		if beginErr != nil || !began {
			m.haltUpgrade(ctx, batch, item, transitionFailure(itemErr, "persist batch-wide rollback", began, beginErr))
			return
		}
		rollbackBatch, loadErr := m.registry.GetWorkerUpgradeBatch(ctx, batch.ID)
		if loadErr != nil || rollbackBatch == nil {
			m.haltUpgrade(ctx, batch, item, transitionFailure(itemErr, "reload batch-wide rollback", rollbackBatch != nil, loadErr))
			return
		}
		m.runWorkerUpgradeRollbackBatch(ctx, rollbackBatch)
		return
	}
	if completed, completeErr := m.registry.CompleteWorkerUpgradeBatch(ctx, batch.ID, batch.Phase, "completed"); completeErr != nil || !completed {
		log.Printf("Complete worker upgrade %s: completed=%t error=%v", batch.ID, completed, completeErr)
	}
}

func pendingRollbackItemsReverse(batch *WorkerUpgradeBatch) []*WorkerUpgradeItem {
	items := make([]*WorkerUpgradeItem, 0, len(batch.Items))
	for index := len(batch.Items) - 1; index >= 0; index-- {
		item := batch.Items[index]
		if item.CompletedAt == nil && item.Phase != WorkerUpgradePhaseCanceled {
			items = append(items, item)
		}
	}
	return items
}

func (m *Manager) runWorkerUpgradeRollbackBatch(ctx context.Context, batch *WorkerUpgradeBatch) {
	for _, item := range pendingRollbackItemsReverse(batch) {
		if item.Phase == WorkerUpgradePhaseHalted {
			return
		}
		if item.Phase != WorkerUpgradePhaseRollback {
			m.haltRollbackFailure(ctx, batch, item, fmt.Errorf("unexpected pending rollback phase %q", item.Phase))
			return
		}
		if err := m.rollbackWorkerUpgrade(ctx, batch, item); err != nil {
			if ctx.Err() != nil {
				log.Printf("Paused worker rollback %s during orchestrator shutdown: %v", batch.ID, err)
				return
			}
			m.haltRollbackFailure(ctx, batch, item, err)
			return
		}
	}
	if completed, err := m.registry.CompleteWorkerUpgradeBatch(ctx, batch.ID, WorkerUpgradePhaseRollback, "rolled_back"); err != nil || !completed {
		log.Printf("Complete batch-wide worker rollback %s: completed=%t error=%v", batch.ID, completed, err)
	}
}

func (m *Manager) runWorkerUpgradeItem(ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem, target WorkerArtifact) error {
	unlock := m.lockLifecycle(item.ConnectionID)
	defer unlock()

	if err := m.validateUpgradeOwnership(item); err != nil {
		return err
	}
	if item.Phase == WorkerUpgradePhaseRecovery {
		if err := m.refreshWorkerUpgradeTarget(ctx, batch, item, target); err != nil {
			return err
		}
	}
	if item.Phase == WorkerUpgradePhaseStop {
		worker, _ := m.GetWorkerStatus(item.ConnectionID)
		if worker != nil && worker.PID > 0 {
			if err := m.stopWorkerInternal(ctx, item.CompanyID, item.ConnectionID, "stop-first worker artifact upgrade", syscall.SIGTERM, true); err != nil {
				return fmt.Errorf("confirm source generation exit: %w", err)
			}
		} else if worker != nil {
			m.mu.Lock()
			delete(m.workers, item.ConnectionID)
			m.mu.Unlock()
		}
		advanced, err := m.registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseStop, WorkerUpgradePhaseLaunch, "", "")
		if err != nil || !advanced {
			return transitionFailure(nil, "persist confirmed source exit", advanced, err)
		}
		item.Phase = WorkerUpgradePhaseLaunch
	}

	if item.Phase == WorkerUpgradePhaseLaunch {
		current, exists := m.GetWorkerStatus(item.ConnectionID)
		targetMatches := exists && current.PID > 0 && m.workerMatchesArtifactContent(current, target)
		if exists && current.PID > 0 && !targetMatches {
			if err := m.stopWorkerInternal(ctx, item.CompanyID, item.ConnectionID, "reconfirm stop-first upgrade boundary", syscall.SIGTERM, true); err != nil {
				return fmt.Errorf("stop unexpected generation before target launch: %w", err)
			}
			current, exists = nil, false
		}
		if !targetMatches {
			m.installUpgradePredecessor(item, current)
			if err := m.spawnWorkerArtifact(ctx, item.CompanyID, item.ConnectionID, item.TenantSchema, m.config.DatabaseURL, false, 1, target); err != nil {
				return fmt.Errorf("launch target artifact: %w", err)
			}
			current, exists = m.GetWorkerStatus(item.ConnectionID)
		}
		if !exists || current.PID <= 0 || current.CompanyID != item.CompanyID || current.TenantSchema != item.TenantSchema ||
			!m.workerMatchesArtifactContent(current, target) {
			return errors.New("target launch lost tenant, process, or artifact ownership")
		}
		advanced, err := m.registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseLaunch, WorkerUpgradePhaseVerify, current.LaunchID, "")
		if err != nil || !advanced {
			return transitionFailure(nil, "persist target generation", advanced, err)
		}
		item.TargetGeneration = current.LaunchID
		item.Phase = WorkerUpgradePhaseVerify
	}

	if item.Phase == WorkerUpgradePhaseVerify {
		current, exists := m.GetWorkerStatus(item.ConnectionID)
		if !exists || current.LaunchID != item.TargetGeneration || current.CompanyID != item.CompanyID ||
			current.TenantSchema != item.TenantSchema || !m.workerMatchesArtifactContent(current, target) {
			return errors.New("exact target generation changed during readiness verification")
		}
		if !m.workerHasReadinessToken(item.ConnectionID, item.TargetGeneration) {
			advanced, err := m.registry.BeginWorkerUpgradeVerifyRefresh(
				ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
				item.SourceGeneration, item.TargetGeneration,
			)
			if err != nil || !advanced {
				return transitionFailure(nil, "persist verify authority refresh", advanced, err)
			}
			item.Phase = WorkerUpgradePhaseRecovery
			if err := m.refreshWorkerUpgradeTarget(ctx, batch, item, target); err != nil {
				return err
			}
			current, exists = m.GetWorkerStatus(item.ConnectionID)
			if !exists {
				return errors.New("re-authorized target launch disappeared")
			}
		}
		readyCtx, cancel := context.WithTimeout(ctx, m.config.RolloutReadyTimeout)
		err := m.waitWorkerReady(readyCtx, current.LaunchID)
		cancel()
		if err != nil {
			return fmt.Errorf("target readiness failed: %w", err)
		}
		if current.LaunchID != item.TargetGeneration || !m.workerIsReady(item.ConnectionID, item.CompanyID, item.TargetGeneration) {
			return errors.New("target disconnected or changed during readiness verification")
		}
		completed, err := m.registry.CompleteWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseVerify)
		if err != nil || !completed {
			return transitionFailure(nil, "persist verified target", completed, err)
		}
	}
	return nil
}

func (m *Manager) validateUpgradeOwnership(item *WorkerUpgradeItem) error {
	worker, exists := m.GetWorkerStatus(item.ConnectionID)
	if !exists {
		return nil // process may have exited at a durable recovery boundary
	}
	if worker.CompanyID != item.CompanyID || worker.TenantSchema != item.TenantSchema {
		return fmt.Errorf("worker tenant ownership changed")
	}
	if item.Phase == WorkerUpgradePhaseStop && worker.LaunchID != item.SourceGeneration {
		return fmt.Errorf("source generation changed before stop")
	}
	return nil
}

func (m *Manager) installUpgradePredecessor(item *WorkerUpgradeItem, current *WorkerProcess) {
	if current != nil {
		return
	}
	m.mu.Lock()
	m.workers[item.ConnectionID] = &WorkerProcess{
		ID: item.ConnectionID, LaunchID: item.SourceGeneration, DesiredState: DesiredStateRunning,
		CompanyID: item.CompanyID, ConnectionID: item.ConnectionID, TenantSchema: item.TenantSchema,
		DatabaseURL: m.config.DatabaseURL, Status: "error", ArtifactVersion: item.SourceArtifactVersion,
		ArtifactSHA256: item.SourceArtifactSHA256,
	}
	m.mu.Unlock()
}

func (m *Manager) refreshWorkerUpgradeTarget(ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem, target WorkerArtifact) error {
	current, exists := m.GetWorkerStatus(item.ConnectionID)
	if exists && (current.CompanyID != item.CompanyID || current.TenantSchema != item.TenantSchema || !m.workerMatchesArtifactContent(current, target)) {
		return errors.New("verify refresh found a non-target or cross-tenant generation")
	}
	if exists && current.PID > 0 {
		if err := m.stopWorkerInternal(ctx, item.CompanyID, item.ConnectionID, "refresh rollout readiness authority", syscall.SIGTERM, true); err != nil {
			return fmt.Errorf("stop target before readiness authority refresh: %w", err)
		}
	}
	record, err := m.registry.GetWorker(ctx, item.ConnectionID)
	if err != nil {
		return fmt.Errorf("inspect verify refresh predecessor: %w", err)
	}
	if record == nil || record.CompanyID != item.CompanyID || record.TenantSchema != item.TenantSchema ||
		record.ArtifactVersion != target.Version || !strings.EqualFold(record.ArtifactSHA256, target.SHA256) {
		return errors.New("verify refresh predecessor lost exact target ownership")
	}
	if err := validateWorkerIdentity(record.WorkerUID, record.WorkerGID); err != nil {
		return fmt.Errorf("verify refresh predecessor credentials: %w", err)
	}
	m.mu.Lock()
	m.workers[item.ConnectionID] = &WorkerProcess{
		ID: item.ConnectionID, LaunchID: record.LaunchID, DesiredState: DesiredStateRunning,
		CompanyID: item.CompanyID, ConnectionID: item.ConnectionID, TenantSchema: item.TenantSchema,
		DatabaseURL: m.config.DatabaseURL, Status: "error", ArtifactVersion: record.ArtifactVersion,
		ArtifactSHA256: record.ArtifactSHA256, BinaryPath: target.BinaryPath,
		WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID,
	}
	m.mu.Unlock()
	previousTarget := item.TargetGeneration
	if err := m.spawnWorkerArtifact(ctx, item.CompanyID, item.ConnectionID, item.TenantSchema, m.config.DatabaseURL, false, 1, target); err != nil {
		return fmt.Errorf("relaunch target with readiness authority: %w", err)
	}
	refreshed, exists := m.GetWorkerStatus(item.ConnectionID)
	if !exists || refreshed.PID <= 0 || !m.workerMatchesArtifactContent(refreshed, target) {
		return errors.New("re-authorized exact target launch disappeared")
	}
	advanced, err := m.registry.CompleteWorkerUpgradeVerifyRefresh(
		ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
		item.SourceGeneration, previousTarget, refreshed.LaunchID,
	)
	if err != nil || !advanced {
		return transitionFailure(nil, "persist exact refreshed target generation", advanced, err)
	}
	item.TargetGeneration = refreshed.LaunchID
	item.Phase = WorkerUpgradePhaseVerify
	return nil
}

func (m *Manager) rollbackWorkerUpgrade(ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem) error {
	unlock := m.lockLifecycle(item.ConnectionID)
	defer unlock()
	current, exists := m.GetWorkerStatus(item.ConnectionID)
	if exists && current.PID > 0 {
		if err := m.stopWorkerInternal(ctx, item.CompanyID, item.ConnectionID, "batch-wide worker artifact rollback", syscall.SIGTERM, true); err != nil {
			return fmt.Errorf("rollback could not confirm current generation exit: %w", err)
		}
	}
	source, err := m.resolveArtifact(item.SourceArtifactVersion, item.SourceArtifactSHA256)
	if err != nil {
		return fmt.Errorf("rollback source validation failed: %w", err)
	}
	m.mu.Lock()
	delete(m.workers, item.ConnectionID)
	m.mu.Unlock()
	record, err := m.registry.GetWorker(ctx, item.ConnectionID)
	if err != nil {
		return fmt.Errorf("inspect rollback predecessor: %w", err)
	}
	if record == nil || record.CompanyID != item.CompanyID || record.TenantSchema != item.TenantSchema {
		return errors.New("rollback predecessor lost tenant ownership")
	}
	if err := validateWorkerIdentity(record.WorkerUID, record.WorkerGID); err != nil {
		return fmt.Errorf("rollback predecessor credentials: %w", err)
	}
	m.mu.Lock()
	m.workers[item.ConnectionID] = &WorkerProcess{
		ID: item.ConnectionID, LaunchID: record.LaunchID, DesiredState: DesiredStateRunning,
		CompanyID: item.CompanyID, ConnectionID: item.ConnectionID, TenantSchema: item.TenantSchema,
		DatabaseURL: m.config.DatabaseURL, Status: "error", ArtifactVersion: record.ArtifactVersion,
		ArtifactSHA256: record.ArtifactSHA256, WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID,
	}
	m.mu.Unlock()
	if err := m.spawnWorkerArtifact(ctx, item.CompanyID, item.ConnectionID, item.TenantSchema, m.config.DatabaseURL, false, 1, source); err != nil {
		return fmt.Errorf("rollback launch failed: %w", err)
	}
	rollback, exists := m.GetWorkerStatus(item.ConnectionID)
	if !exists {
		return errors.New("rollback launch disappeared")
	}
	readyCtx, cancel := context.WithTimeout(ctx, m.config.RolloutReadyTimeout)
	err = m.waitWorkerReady(readyCtx, rollback.LaunchID)
	cancel()
	if err != nil {
		return fmt.Errorf("rollback readiness failed: %w", err)
	}
	if !m.workerIsReady(item.ConnectionID, item.CompanyID, rollback.LaunchID) {
		return errors.New("rollback disconnected during readiness verification")
	}
	completed, err := m.registry.CompleteWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseRollback)
	if err != nil || !completed {
		return transitionFailure(nil, "persist successful rollback", completed, err)
	}
	return nil
}

func (m *Manager) haltRollbackFailure(ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem, cause error) {
	if item != nil && item.CompletedAt == nil && item.Phase != WorkerUpgradePhaseHalted {
		_, _ = m.registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, item.Phase, WorkerUpgradePhaseHalted, item.TargetGeneration, cause.Error())
	}
	if batch.Phase != WorkerUpgradePhaseHalted {
		_, _ = m.registry.AdvanceWorkerUpgradeBatch(ctx, batch.ID, batch.Phase, WorkerUpgradePhaseHalted, cause.Error())
	}
	log.Printf("HALTED worker rollback %s at connection %s: %v", batch.ID, item.ConnectionID, cause)
}

func (m *Manager) haltUpgrade(ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem, cause error) {
	if item != nil && item.CompletedAt == nil && item.Phase != WorkerUpgradePhaseHalted {
		_, _ = m.registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, item.Phase, WorkerUpgradePhaseHalted, item.TargetGeneration, cause.Error())
	}
	if batch.Phase != WorkerUpgradePhaseHalted {
		_, _ = m.registry.AdvanceWorkerUpgradeBatch(ctx, batch.ID, batch.Phase, WorkerUpgradePhaseHalted, cause.Error())
	}
	log.Printf("HALTED worker upgrade %s: %v", batch.ID, cause)
}

func transitionFailure(cause error, action string, updated bool, err error) error {
	message := fmt.Sprintf("%s: updated=%t", action, updated)
	if cause != nil {
		message = cause.Error() + "; " + message
	}
	if err != nil {
		return fmt.Errorf("%s: %w", message, err)
	}
	return errors.New(message)
}

func (m *Manager) workerMatchesArtifactContent(worker *WorkerProcess, target WorkerArtifact) bool {
	if worker == nil {
		return false
	}
	current, err := m.resolveArtifact(worker.ArtifactVersion, worker.ArtifactSHA256)
	return err == nil && strings.EqualFold(current.SHA256, target.SHA256)
}

func (m *Manager) workerHasReadinessToken(connectionID, launchID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	worker, ok := m.workers[connectionID]
	return ok && worker.LaunchID == launchID && worker.readinessToken != ""
}

func (m *Manager) workerIsReady(connectionID, companyID, launchID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	worker, ok := m.workers[connectionID]
	return ok && worker.CompanyID == companyID && worker.LaunchID == launchID &&
		worker.ProcessReady && worker.RuntimeConnected && worker.Authenticated
}

func (m *Manager) waitWorkerReady(ctx context.Context, launchID string) error {
	// Register the waiter while holding readinessMu, then inspect the flags.
	// RecordWorkerRuntimeStatus publishes flags before taking the same mutex, so
	// a signal can neither slip between the inspection and registration nor be
	// lost when it arrives first.
	m.readinessMu.Lock()
	m.mu.RLock()
	for _, worker := range m.workers {
		if worker.LaunchID == launchID && worker.ProcessReady && worker.RuntimeConnected && worker.Authenticated {
			m.mu.RUnlock()
			m.readinessMu.Unlock()
			return nil
		}
	}
	m.mu.RUnlock()
	ready := m.readiness[launchID]
	if ready == nil {
		ready = make(chan struct{})
		m.readiness[launchID] = ready
	}
	m.readinessMu.Unlock()
	select {
	case <-ready:
		return nil
	case <-ctx.Done():
		m.readinessMu.Lock()
		if m.readiness[launchID] == ready {
			delete(m.readiness, launchID)
		}
		m.readinessMu.Unlock()
		return ctx.Err()
	}
}

// RecordWorkerRuntimeStatus is the NATS callback and a focused-test seam. It
// rejects stale, cross-tenant, cross-generation, and wrong-artifact signals.
func (m *Manager) RecordWorkerRuntimeStatus(status sharednats.WorkerRuntimeStatus) {
	m.mu.Lock()
	worker, ok := m.workers[status.ConnectionID]
	if !ok || worker.CompanyID != status.CompanyID || worker.LaunchID != status.LaunchID ||
		worker.ArtifactVersion != status.ArtifactVersion ||
		!sharednats.VerifyWorkerRuntimeStatus(status, worker.readinessToken) {
		m.mu.Unlock()
		return
	}
	switch status.Status {
	case sharednats.WorkerRuntimeStatusProcessReady:
		worker.ProcessReady = true
	case sharednats.WorkerRuntimeStatusConnected:
		worker.RuntimeConnected = true
		worker.Status = "connected"
	case sharednats.WorkerRuntimeStatusAuthenticated:
		worker.Authenticated = true
	case sharednats.WorkerRuntimeStatusDisconnected:
		worker.RuntimeConnected = false
		worker.Authenticated = false
	default:
		m.mu.Unlock()
		return
	}
	complete := worker.ProcessReady && worker.RuntimeConnected && worker.Authenticated
	m.mu.Unlock()
	if !complete {
		return
	}
	m.readinessMu.Lock()
	if ready := m.readiness[status.LaunchID]; ready != nil {
		close(ready)
		delete(m.readiness, status.LaunchID)
	}
	m.readinessMu.Unlock()
}
