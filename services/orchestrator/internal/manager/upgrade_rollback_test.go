package manager

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPendingBatchRollbackRunsEveryTouchedItemInReverse(t *testing.T) {
	now := time.Now()
	batch := &WorkerUpgradeBatch{Items: []*WorkerUpgradeItem{
		{Position: 0, Phase: WorkerUpgradePhaseRollback},
		{Position: 1, Phase: WorkerUpgradePhaseRollback},
		{Position: 2, Phase: WorkerUpgradePhaseRollback},
		{Position: 3, Phase: WorkerUpgradePhaseCanceled, Result: WorkerUpgradeItemResultCanceledUntouched, CompletedAt: &now},
	}}
	pending := pendingRollbackItemsReverse(batch)
	require.Len(t, pending, 3)
	assert.Equal(t, []int{2, 1, 0}, []int{pending[0].Position, pending[1].Position, pending[2].Position})
}

func TestRollbackFailureHaltsOnlyActionableItemAndBatch(t *testing.T) {
	registry, mock := newMockRegistry(t)
	batch := &WorkerUpgradeBatch{ID: "batch", Phase: WorkerUpgradePhaseRollback}
	item := &WorkerUpgradeItem{
		ID: "failed", BatchID: "batch", CompanyID: "company", TenantSchema: "tenant_company",
		ConnectionID: "connection", SourceGeneration: "source", TargetGeneration: "target",
		Phase: WorkerUpgradePhaseRollback,
	}
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_items SET phase = $1")).
		WithArgs(WorkerUpgradePhaseHalted, "target", "rollback failed", "batch", "company", "tenant_company", "connection", "source", WorkerUpgradePhaseRollback).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_upgrade_batches SET phase = $1")).
		WithArgs(WorkerUpgradePhaseHalted, "rollback failed", "batch", WorkerUpgradePhaseRollback).
		WillReturnResult(sqlmock.NewResult(0, 1))

	manager := New(Config{})
	manager.registry = registry
	manager.haltRollbackFailure(context.Background(), batch, item, errors.New("rollback failed"))
	require.NoError(t, mock.ExpectationsWereMet(), "pending earlier rollbacks must remain pending, not be mass-halted")
}
