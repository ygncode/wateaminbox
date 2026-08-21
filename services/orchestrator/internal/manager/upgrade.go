package manager

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"syscall"
	"time"

	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

var (
	ErrUpgradeUnavailable = errors.New("durable worker upgrades are unavailable")
	ErrUpgradeNoWorkers   = errors.New("no workers matched the upgrade selector")
)

const (
	workerRuntimeSignalMaxAge     = time.Minute
	workerRuntimeSignalFutureSkew = 5 * time.Second
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
		if _, err := m.fenceRolloutOwnedLaunch(
			ctx, batch, item, WorkerUpgradePhaseStop, item.SourceGeneration,
			item.SourceArtifactVersion, item.SourceArtifactSHA256, true,
		); err != nil {
			return fmt.Errorf("source changed before stop: %w", err)
		}
		if err := m.stopWorkerInternal(ctx, item.CompanyID, item.ConnectionID, "stop-first worker artifact upgrade", syscall.SIGTERM, true); err != nil {
			return fmt.Errorf("confirm source generation exit: %w", err)
		}
		advanced, err := m.registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseStop, WorkerUpgradePhaseLaunch, "", "")
		if err != nil || !advanced {
			return transitionFailure(nil, "persist confirmed source exit", advanced, err)
		}
		item.Phase = WorkerUpgradePhaseLaunch
	}

	if item.Phase == WorkerUpgradePhaseLaunch {
		if item.TargetGeneration == "" {
			planned, err := newLaunchID()
			if err != nil {
				return err
			}
			reserved, err := m.registry.ReserveWorkerUpgradeGeneration(
				ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
				item.SourceGeneration, WorkerUpgradePhaseLaunch, "target_generation", planned,
			)
			if err != nil || !reserved {
				return transitionFailure(nil, "reserve target generation", reserved, err)
			}
			item.TargetGeneration = planned
		}

		current, exists := m.GetWorkerStatus(item.ConnectionID)
		targetMatches := exists && current.PID > 0 && current.LaunchID == item.TargetGeneration &&
			current.CompanyID == item.CompanyID && current.TenantSchema == item.TenantSchema &&
			m.workerMatchesArtifactContent(current, target)
		if !targetMatches {
			relaunched, err := m.relaunchDeadReservedGeneration(
				ctx, batch, item, WorkerUpgradePhaseLaunch, item.TargetGeneration, target,
			)
			if err != nil {
				return fmt.Errorf("recover reserved target claim: %w", err)
			}
			if relaunched {
				current, exists = m.GetWorkerStatus(item.ConnectionID)
				targetMatches = exists && current.PID > 0 && current.LaunchID == item.TargetGeneration &&
					m.workerMatchesArtifactContent(current, target)
			}
		}
		if exists && current.PID > 0 && !targetMatches {
			return errors.New("refusing to stop an unowned generation before target launch")
		}
		if !targetMatches {
			record, err := m.fenceRolloutOwnedLaunch(
				ctx, batch, item, WorkerUpgradePhaseLaunch, item.SourceGeneration,
				item.SourceArtifactVersion, item.SourceArtifactSHA256, false,
			)
			if err != nil {
				return fmt.Errorf("source changed before target claim: %w", err)
			}
			installRolloutPredecessor(m, item, record, target.BinaryPath)
			if err := m.spawnWorkerArtifactWithLaunch(
				ctx, item.CompanyID, item.ConnectionID, item.TenantSchema,
				m.config.DatabaseURL, false, 1, target, item.TargetGeneration,
			); err != nil {
				return fmt.Errorf("launch reserved target artifact: %w", err)
			}
			current, exists = m.GetWorkerStatus(item.ConnectionID)
		}
		if !exists || current.PID <= 0 || current.LaunchID != item.TargetGeneration ||
			current.CompanyID != item.CompanyID || current.TenantSchema != item.TenantSchema ||
			!m.workerMatchesArtifactContent(current, target) {
			return errors.New("reserved target launch lost tenant, process, or artifact ownership")
		}
		advanced, err := m.registry.AdvanceWorkerUpgradeItem(ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID, item.SourceGeneration, WorkerUpgradePhaseLaunch, WorkerUpgradePhaseVerify, item.TargetGeneration, "")
		if err != nil || !advanced {
			return transitionFailure(nil, "persist target generation", advanced, err)
		}
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
		current, exists = m.GetWorkerStatus(item.ConnectionID)
		if !exists || current.LaunchID != item.TargetGeneration ||
			!m.workerIsReady(item.ConnectionID, item.CompanyID, item.TargetGeneration) {
			return errors.New("target disconnected or changed during readiness verification")
		}
		completed, err := m.registry.CompleteWorkerUpgradeItem(
			ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
			item.SourceGeneration, WorkerUpgradePhaseVerify, liveFence(current),
		)
		if err != nil || !completed {
			return transitionFailure(nil, "persist verified target", completed, err)
		}
	}
	return nil
}

func liveFence(worker *WorkerProcess) WorkerUpgradeLiveFence {
	return WorkerUpgradeLiveFence{
		LaunchID: worker.LaunchID, ArtifactVersion: worker.ArtifactVersion,
		ArtifactSHA256: worker.ArtifactSHA256, WorkerUID: worker.WorkerUID,
		WorkerGID: worker.WorkerGID,
	}
}

func (m *Manager) fenceRolloutOwnedLaunch(
	ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem,
	itemPhase, generation, artifactVersion, artifactSHA256 string,
	requireLiveMap bool,
) (*WorkerRecord, error) {
	record, err := m.registry.GetWorker(ctx, item.ConnectionID)
	if err != nil {
		return nil, fmt.Errorf("read rollout-owned registry launch: %w", err)
	}
	if record == nil || record.CompanyID != item.CompanyID || record.TenantSchema != item.TenantSchema ||
		record.ConnectionID != item.ConnectionID || record.LaunchID != generation ||
		record.DesiredState != DesiredStateRunning || record.ArtifactVersion != artifactVersion ||
		!strings.EqualFold(record.ArtifactSHA256, artifactSHA256) {
		return nil, errors.New("durable rollout-owned generation is missing or changed")
	}
	if err := validateWorkerIdentity(record.WorkerUID, record.WorkerGID); err != nil {
		return nil, fmt.Errorf("durable rollout-owned credentials: %w", err)
	}
	if requireLiveMap {
		worker, exists := m.GetWorkerStatus(item.ConnectionID)
		if !exists || worker.PID <= 0 || worker.LaunchID != record.LaunchID ||
			worker.CompanyID != record.CompanyID || worker.TenantSchema != record.TenantSchema ||
			worker.ArtifactVersion != record.ArtifactVersion ||
			!strings.EqualFold(worker.ArtifactSHA256, record.ArtifactSHA256) ||
			worker.WorkerUID != record.WorkerUID || worker.WorkerGID != record.WorkerGID {
			return nil, errors.New("in-memory rollout generation does not match durable ownership")
		}
	}
	fenced, err := m.registry.FenceWorkerUpgradeOwnedLaunch(
		ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
		item.SourceGeneration, itemPhase, WorkerUpgradeLiveFence{
			LaunchID: record.LaunchID, ArtifactVersion: record.ArtifactVersion,
			ArtifactSHA256: record.ArtifactSHA256, WorkerUID: record.WorkerUID,
			WorkerGID: record.WorkerGID,
		},
	)
	if err != nil || !fenced {
		return nil, transitionFailure(nil, "CAS-fence rollout-owned launch", fenced, err)
	}
	return record, nil
}

// relaunchDeadReservedGeneration handles the Pdeathsig crash boundary after a
// registry claim but before the item phase/generation transition commits. The
// recovered map must prove that the exact reserved process is dead; the
// registry CAS then relaunches that same reserved generation ID with fresh
// credentials and readiness authority.
func (m *Manager) relaunchDeadReservedGeneration(
	ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem,
	phase, generation string, artifact WorkerArtifact,
) (bool, error) {
	worker, exists := m.GetWorkerStatus(item.ConnectionID)
	if !exists || worker.PID > 0 || worker.LaunchID != generation ||
		worker.CompanyID != item.CompanyID || worker.TenantSchema != item.TenantSchema ||
		worker.ArtifactVersion != artifact.Version ||
		!strings.EqualFold(worker.ArtifactSHA256, artifact.SHA256) {
		return false, nil
	}
	record, err := m.fenceRolloutOwnedLaunch(
		ctx, batch, item, phase, generation, artifact.Version, artifact.SHA256, false,
	)
	if err != nil {
		return false, fmt.Errorf("fence dead reserved generation: %w", err)
	}
	if worker.WorkerUID != record.WorkerUID || worker.WorkerGID != record.WorkerGID {
		return false, errors.New("dead reserved generation credentials changed during recovery")
	}
	installRolloutPredecessor(m, item, record, artifact.BinaryPath)
	if m.reservedRelaunch != nil {
		if err := m.reservedRelaunch(ctx, item, artifact, generation); err != nil {
			return false, fmt.Errorf("relaunch dead reserved generation: %w", err)
		}
	} else if err := m.spawnWorkerArtifactWithLaunch(
		ctx, item.CompanyID, item.ConnectionID, item.TenantSchema,
		m.config.DatabaseURL, false, 1, artifact, generation,
	); err != nil {
		return false, fmt.Errorf("relaunch dead reserved generation: %w", err)
	}
	return true, nil
}

func installRolloutPredecessor(m *Manager, item *WorkerUpgradeItem, record *WorkerRecord, binaryPath string) {
	m.mu.Lock()
	m.workers[item.ConnectionID] = &WorkerProcess{
		ID: item.ConnectionID, LaunchID: record.LaunchID, DesiredState: DesiredStateRunning,
		CompanyID: item.CompanyID, ConnectionID: item.ConnectionID, TenantSchema: item.TenantSchema,
		DatabaseURL: m.config.DatabaseURL, Status: "error", ArtifactVersion: record.ArtifactVersion,
		ArtifactSHA256: record.ArtifactSHA256, BinaryPath: binaryPath,
		WorkerUID: record.WorkerUID, WorkerGID: record.WorkerGID,
	}
	m.mu.Unlock()
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
	previousTarget := item.TargetGeneration
	current, exists := m.GetWorkerStatus(item.ConnectionID)
	if item.RecoveryGeneration == "" {
		if _, err := m.fenceRolloutOwnedLaunch(
			ctx, batch, item, WorkerUpgradePhaseRecovery, previousTarget,
			target.Version, target.SHA256, true,
		); err != nil {
			return fmt.Errorf("target changed before readiness refresh reservation: %w", err)
		}
		planned, err := newLaunchID()
		if err != nil {
			return err
		}
		reserved, err := m.registry.ReserveWorkerUpgradeGeneration(
			ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
			item.SourceGeneration, WorkerUpgradePhaseRecovery, "recovery_generation", planned,
		)
		if err != nil || !reserved {
			return transitionFailure(nil, "reserve readiness refresh generation", reserved, err)
		}
		item.RecoveryGeneration = planned
	}

	refreshedMatches := exists && current.PID > 0 && current.LaunchID == item.RecoveryGeneration &&
		current.CompanyID == item.CompanyID && current.TenantSchema == item.TenantSchema &&
		m.workerMatchesArtifactContent(current, target)
	if !refreshedMatches {
		relaunched, err := m.relaunchDeadReservedGeneration(
			ctx, batch, item, WorkerUpgradePhaseRecovery, item.RecoveryGeneration, target,
		)
		if err != nil {
			return fmt.Errorf("recover reserved readiness-refresh claim: %w", err)
		}
		if relaunched {
			current, exists = m.GetWorkerStatus(item.ConnectionID)
			refreshedMatches = exists && current.PID > 0 && current.LaunchID == item.RecoveryGeneration &&
				m.workerMatchesArtifactContent(current, target)
		}
	}
	if exists && current.PID > 0 && !refreshedMatches {
		if current.LaunchID != previousTarget || !m.workerMatchesArtifactContent(current, target) {
			return errors.New("refusing to stop an unowned generation during readiness refresh")
		}
		if _, err := m.fenceRolloutOwnedLaunch(
			ctx, batch, item, WorkerUpgradePhaseRecovery, previousTarget,
			target.Version, target.SHA256, true,
		); err != nil {
			return fmt.Errorf("target changed immediately before readiness refresh stop: %w", err)
		}
		if err := m.stopWorkerInternal(ctx, item.CompanyID, item.ConnectionID, "refresh rollout readiness authority", syscall.SIGTERM, true); err != nil {
			return fmt.Errorf("stop target before readiness authority refresh: %w", err)
		}
		current, exists = nil, false
	}
	if !refreshedMatches {
		record, err := m.fenceRolloutOwnedLaunch(
			ctx, batch, item, WorkerUpgradePhaseRecovery, previousTarget,
			target.Version, target.SHA256, false,
		)
		if err != nil {
			return fmt.Errorf("target changed before readiness refresh claim: %w", err)
		}
		installRolloutPredecessor(m, item, record, target.BinaryPath)
		if err := m.spawnWorkerArtifactWithLaunch(
			ctx, item.CompanyID, item.ConnectionID, item.TenantSchema,
			m.config.DatabaseURL, false, 1, target, item.RecoveryGeneration,
		); err != nil {
			return fmt.Errorf("relaunch reserved target with readiness authority: %w", err)
		}
	}
	refreshed, exists := m.GetWorkerStatus(item.ConnectionID)
	if !exists || refreshed.PID <= 0 || refreshed.LaunchID != item.RecoveryGeneration ||
		!m.workerMatchesArtifactContent(refreshed, target) {
		return errors.New("reserved re-authorized target launch disappeared")
	}
	advanced, err := m.registry.CompleteWorkerUpgradeVerifyRefresh(
		ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
		item.SourceGeneration, previousTarget, item.RecoveryGeneration,
	)
	if err != nil || !advanced {
		return transitionFailure(nil, "persist exact refreshed target generation", advanced, err)
	}
	item.TargetGeneration = item.RecoveryGeneration
	item.RecoveryGeneration = ""
	item.Phase = WorkerUpgradePhaseVerify
	return nil
}

func (m *Manager) rollbackWorkerUpgrade(ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem) error {
	unlock := m.lockLifecycle(item.ConnectionID)
	defer unlock()
	source, err := m.resolveArtifact(item.SourceArtifactVersion, item.SourceArtifactSHA256)
	if err != nil {
		return fmt.Errorf("rollback source validation failed: %w", err)
	}

	fencePredecessor := func(requireLiveMap bool) (*WorkerRecord, error) {
		record, getErr := m.registry.GetWorker(ctx, item.ConnectionID)
		if getErr != nil {
			return nil, getErr
		}
		if record == nil {
			return nil, errors.New("rollback-owned registry generation is missing")
		}
		version, digest := "", ""
		switch {
		case record.LaunchID == item.RecoveryGeneration && item.RecoveryGeneration != "":
			version, digest = batch.TargetArtifactVersion, batch.TargetArtifactSHA256
		case record.LaunchID == item.TargetGeneration && item.TargetGeneration != "":
			version, digest = batch.TargetArtifactVersion, batch.TargetArtifactSHA256
		case record.LaunchID == item.SourceGeneration:
			version, digest = item.SourceArtifactVersion, item.SourceArtifactSHA256
		default:
			return nil, errors.New("rollback predecessor is not the snapshotted source or reserved target/recovery generation")
		}
		return m.fenceRolloutOwnedLaunch(
			ctx, batch, item, WorkerUpgradePhaseRollback, record.LaunchID,
			version, digest, requireLiveMap,
		)
	}

	current, exists := m.GetWorkerStatus(item.ConnectionID)
	rollbackMatches := exists && current.PID > 0 && item.RollbackGeneration != "" &&
		current.LaunchID == item.RollbackGeneration && current.CompanyID == item.CompanyID &&
		current.TenantSchema == item.TenantSchema && m.workerMatchesArtifactContent(current, source)
	if item.RollbackGeneration != "" && !rollbackMatches {
		relaunched, err := m.relaunchDeadReservedGeneration(
			ctx, batch, item, WorkerUpgradePhaseRollback, item.RollbackGeneration, source,
		)
		if err != nil {
			return fmt.Errorf("recover reserved rollback claim: %w", err)
		}
		if relaunched {
			current, exists = m.GetWorkerStatus(item.ConnectionID)
			rollbackMatches = exists && current.PID > 0 && current.LaunchID == item.RollbackGeneration &&
				m.workerMatchesArtifactContent(current, source)
		}
	}
	if item.RollbackGeneration == "" {
		if _, err := fencePredecessor(exists && current.PID > 0); err != nil {
			return fmt.Errorf("rollback predecessor changed before reservation: %w", err)
		}
		planned, err := newLaunchID()
		if err != nil {
			return err
		}
		reserved, err := m.registry.ReserveWorkerUpgradeGeneration(
			ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
			item.SourceGeneration, WorkerUpgradePhaseRollback, "rollback_generation", planned,
		)
		if err != nil || !reserved {
			return transitionFailure(nil, "reserve rollback generation", reserved, err)
		}
		item.RollbackGeneration = planned
	}

	if exists && current.PID > 0 && !rollbackMatches {
		if _, err := fencePredecessor(true); err != nil {
			return fmt.Errorf("rollback predecessor changed immediately before stop: %w", err)
		}
		if err := m.stopWorkerInternal(ctx, item.CompanyID, item.ConnectionID, "batch-wide worker artifact rollback", syscall.SIGTERM, true); err != nil {
			return fmt.Errorf("rollback could not confirm current generation exit: %w", err)
		}
		current, exists = nil, false
	}
	if !rollbackMatches {
		record, err := fencePredecessor(false)
		if err != nil {
			return fmt.Errorf("rollback predecessor changed before source claim: %w", err)
		}
		m.mu.Lock()
		delete(m.workers, item.ConnectionID)
		m.mu.Unlock()
		installRolloutPredecessor(m, item, record, source.BinaryPath)
		if err := m.spawnWorkerArtifactWithLaunch(
			ctx, item.CompanyID, item.ConnectionID, item.TenantSchema,
			m.config.DatabaseURL, false, 1, source, item.RollbackGeneration,
		); err != nil {
			return fmt.Errorf("reserved rollback launch failed: %w", err)
		}
	}
	rollback, exists := m.GetWorkerStatus(item.ConnectionID)
	if !exists || rollback.PID <= 0 || rollback.LaunchID != item.RollbackGeneration ||
		rollback.CompanyID != item.CompanyID || rollback.TenantSchema != item.TenantSchema ||
		!m.workerMatchesArtifactContent(rollback, source) {
		return errors.New("reserved rollback launch disappeared or changed")
	}
	readyCtx, cancel := context.WithTimeout(ctx, m.config.RolloutReadyTimeout)
	err = m.waitWorkerReady(readyCtx, rollback.LaunchID)
	cancel()
	if err != nil {
		return fmt.Errorf("rollback readiness failed: %w", err)
	}
	rollback, exists = m.GetWorkerStatus(item.ConnectionID)
	if !exists || rollback.LaunchID != item.RollbackGeneration ||
		!m.workerIsReady(item.ConnectionID, item.CompanyID, rollback.LaunchID) {
		return errors.New("rollback disconnected or changed during readiness verification")
	}
	completed, err := m.registry.CompleteWorkerUpgradeItem(
		ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
		item.SourceGeneration, WorkerUpgradePhaseRollback, liveFence(rollback),
	)
	if err != nil || !completed {
		return transitionFailure(nil, "persist successful rollback", completed, err)
	}
	return nil
}

func (m *Manager) haltRollbackFailure(ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem, cause error) {
	m.persistUpgradeHalt(ctx, batch, item, cause)
	log.Printf("HALTED worker rollback %s at connection %s: %v", batch.ID, item.ConnectionID, cause)
}

func (m *Manager) haltUpgrade(ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem, cause error) {
	m.persistUpgradeHalt(ctx, batch, item, cause)
	log.Printf("HALTED worker upgrade %s: %v", batch.ID, cause)
}

func (m *Manager) persistUpgradeHalt(ctx context.Context, batch *WorkerUpgradeBatch, item *WorkerUpgradeItem, cause error) {
	if batch == nil || item == nil || item.CompletedAt != nil ||
		item.Phase == WorkerUpgradePhaseHalted || batch.Phase == WorkerUpgradePhaseHalted {
		return
	}
	halted, err := m.registry.HaltWorkerUpgrade(
		ctx, batch.ID, item.CompanyID, item.TenantSchema, item.ConnectionID,
		item.SourceGeneration, item.Phase, batch.Phase, item.TargetGeneration, cause.Error(),
	)
	if err != nil || !halted {
		log.Printf("CRITICAL: failed to transactionally halt worker upgrade %s: halted=%t error=%v", batch.ID, halted, err)
	}
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
	signalTime, err := time.Parse(time.RFC3339Nano, status.Timestamp)
	if err != nil {
		return
	}
	now := time.Now().UTC()
	if signalTime.Before(now.Add(-workerRuntimeSignalMaxAge)) ||
		signalTime.After(now.Add(workerRuntimeSignalFutureSkew)) {
		return
	}
	m.mu.Lock()
	worker, ok := m.workers[status.ConnectionID]
	if !ok || worker.CompanyID != status.CompanyID || worker.LaunchID != status.LaunchID ||
		worker.ArtifactVersion != status.ArtifactVersion ||
		!sharednats.VerifyWorkerRuntimeStatus(status, worker.readinessToken) ||
		!signalTime.After(worker.LastRuntimeSignalAt) {
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
		// A negative edge invalidates the entire readiness chain. Only a newer
		// process-ready/connected/authenticated sequence can restore it.
		worker.ProcessReady = false
		worker.RuntimeConnected = false
		worker.Authenticated = false
	default:
		m.mu.Unlock()
		return
	}
	worker.LastRuntimeSignalAt = signalTime
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
