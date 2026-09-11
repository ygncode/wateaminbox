package manager

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// TestGetWorkerStatus_NotFound tests getting status of non-existent worker.
func TestGetWorkerStatus_NotFound(t *testing.T) {
	m := New(Config{})

	worker, exists := m.GetWorkerStatus("non-existent-id")

	assert.False(t, exists, "should not find non-existent worker")
	assert.Nil(t, worker, "worker should be nil when not found")
}

// TestGetWorkerStatus_Exists tests getting status of existing worker.
func TestGetWorkerStatus_Exists(t *testing.T) {
	m := New(Config{})

	// Manually add a worker for testing
	testWorker := &WorkerProcess{
		ID:           "test-connection-123",
		CompanyID:    "company-456",
		ConnectionID: "test-connection-123",
		TenantSchema: "tenant_company_456",
		Status:       types.StatusConnected,
		PID:          12345,
		StartedAt:    time.Now().Add(-1 * time.Hour),
		LastActivity: time.Now().Add(-5 * time.Minute),
	}
	m.workers["test-connection-123"] = testWorker

	worker, exists := m.GetWorkerStatus("test-connection-123")

	assert.True(t, exists, "should find existing worker")
	require.NotNil(t, worker, "worker should not be nil")
	assert.Equal(t, "test-connection-123", worker.ID)
	assert.Equal(t, "company-456", worker.CompanyID)
	assert.Equal(t, types.StatusConnected, worker.Status)
	assert.Equal(t, 12345, worker.PID)
}

// TestGetWorkerStatus_ReturnsCopy tests that GetWorkerStatus returns a copy.
func TestGetWorkerStatus_ReturnsCopy(t *testing.T) {
	m := New(Config{})

	testWorker := &WorkerProcess{
		ID:           "test-id",
		CompanyID:    "company-id",
		ConnectionID: "test-id",
		Status:       types.StatusConnected,
	}
	m.workers["test-id"] = testWorker

	worker, _ := m.GetWorkerStatus("test-id")

	// Modify the returned copy
	worker.Status = types.StatusError

	// Original should be unchanged
	assert.Equal(t, types.StatusConnected, m.workers["test-id"].Status, "original worker should be unchanged")
}

// TestListWorkers_Empty tests listing workers when none exist.
func TestListWorkers_Empty(t *testing.T) {
	m := New(Config{})

	workers := m.ListWorkers()

	assert.Empty(t, workers, "should return empty slice when no workers")
	assert.NotNil(t, workers, "should return non-nil slice")
}

// TestListWorkers_Multiple tests listing multiple workers.
func TestListWorkers_Multiple(t *testing.T) {
	m := New(Config{})

	// Add multiple workers
	m.workers["conn-1"] = &WorkerProcess{
		ID:           "conn-1",
		CompanyID:    "company-a",
		ConnectionID: "conn-1",
		Status:       types.StatusConnected,
	}
	m.workers["conn-2"] = &WorkerProcess{
		ID:           "conn-2",
		CompanyID:    "company-b",
		ConnectionID: "conn-2",
		Status:       types.StatusConnecting,
	}
	m.workers["conn-3"] = &WorkerProcess{
		ID:           "conn-3",
		CompanyID:    "company-a",
		ConnectionID: "conn-3",
		Status:       types.StatusError,
	}

	workers := m.ListWorkers()

	assert.Len(t, workers, 3, "should return all workers")

	// Verify all workers are present (order not guaranteed)
	ids := make(map[string]bool)
	for _, w := range workers {
		ids[w.ID] = true
	}
	assert.True(t, ids["conn-1"], "should contain conn-1")
	assert.True(t, ids["conn-2"], "should contain conn-2")
	assert.True(t, ids["conn-3"], "should contain conn-3")
}

// TestListWorkersByCompany_Empty tests filtering when no workers match.
func TestListWorkersByCompany_Empty(t *testing.T) {
	m := New(Config{})

	m.workers["conn-1"] = &WorkerProcess{
		ID:        "conn-1",
		CompanyID: "company-a",
	}

	workers := m.ListWorkersByCompany("company-x")

	assert.Empty(t, workers, "should return empty slice when no workers match")
}

// TestListWorkersByCompany_Filtered tests filtering workers by company.
func TestListWorkersByCompany_Filtered(t *testing.T) {
	m := New(Config{})

	m.workers["conn-1"] = &WorkerProcess{
		ID:        "conn-1",
		CompanyID: "company-a",
	}
	m.workers["conn-2"] = &WorkerProcess{
		ID:        "conn-2",
		CompanyID: "company-b",
	}
	m.workers["conn-3"] = &WorkerProcess{
		ID:        "conn-3",
		CompanyID: "company-a",
	}

	workers := m.ListWorkersByCompany("company-a")

	assert.Len(t, workers, 2, "should return only company-a workers")
	for _, w := range workers {
		assert.Equal(t, "company-a", w.CompanyID, "all workers should belong to company-a")
	}
}

// TestUpdateWorkerStatus_Exists tests updating status of existing worker.
func TestUpdateWorkerStatus_Exists(t *testing.T) {
	m := New(Config{})

	initialTime := time.Now().Add(-1 * time.Hour)
	m.workers["conn-1"] = &WorkerProcess{
		ID:           "conn-1",
		Status:       types.StatusConnecting,
		LastActivity: initialTime,
	}

	m.UpdateWorkerStatus("conn-1", types.StatusConnected)

	assert.Equal(t, types.StatusConnected, m.workers["conn-1"].Status, "status should be updated")
	assert.True(t, m.workers["conn-1"].LastActivity.After(initialTime), "last activity should be updated")
}

// TestUpdateWorkerStatus_NotFound tests updating status of non-existent worker.
func TestUpdateWorkerStatus_NotFound(t *testing.T) {
	m := New(Config{})

	// Should not panic
	m.UpdateWorkerStatus("non-existent", types.StatusConnected)

	// Verify no worker was created
	assert.Empty(t, m.workers)
}

// TestUpdateWorkerActivity_Exists tests updating activity time.
func TestUpdateWorkerActivity_Exists(t *testing.T) {
	m := New(Config{})

	initialTime := time.Now().Add(-1 * time.Hour)
	m.workers["conn-1"] = &WorkerProcess{
		ID:           "conn-1",
		LastActivity: initialTime,
	}

	m.UpdateWorkerActivity("conn-1")

	assert.True(t, m.workers["conn-1"].LastActivity.After(initialTime), "last activity should be updated")
}

// TestUpdateWorkerActivity_NotFound tests updating activity of non-existent worker.
func TestUpdateWorkerActivity_NotFound(t *testing.T) {
	m := New(Config{})

	// Should not panic
	m.UpdateWorkerActivity("non-existent")

	// Verify no worker was created
	assert.Empty(t, m.workers)
}

// TestWorkerCount_Empty tests counting workers when none exist.
func TestWorkerCount_Empty(t *testing.T) {
	m := New(Config{})

	count := m.WorkerCount()

	assert.Equal(t, 0, count, "should return 0 when no workers")
}

// TestWorkerCount_Multiple tests counting multiple workers.
func TestWorkerCount_Multiple(t *testing.T) {
	m := New(Config{})

	m.workers["conn-1"] = &WorkerProcess{ID: "conn-1"}
	m.workers["conn-2"] = &WorkerProcess{ID: "conn-2"}
	m.workers["conn-3"] = &WorkerProcess{ID: "conn-3"}

	count := m.WorkerCount()

	assert.Equal(t, 3, count, "should return correct count")
}

// TestGetStartedAt tests getting the manager start time.
func TestGetStartedAt(t *testing.T) {
	before := time.Now()
	m := New(Config{})
	after := time.Now()

	startedAt := m.GetStartedAt()

	assert.True(t, startedAt.After(before) || startedAt.Equal(before), "started time should be >= before")
	assert.True(t, startedAt.Before(after) || startedAt.Equal(after), "started time should be <= after")
}

// TestConcurrentAccess tests thread-safety of worker operations.
func TestConcurrentAccess(t *testing.T) {
	m := New(Config{})

	// Pre-populate with some workers
	for i := 0; i < 10; i++ {
		id := string(rune('a' + i))
		m.workers[id] = &WorkerProcess{
			ID:        id,
			CompanyID: "company",
			Status:    types.StatusConnected,
		}
	}

	done := make(chan bool)

	// Concurrent reads
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				_ = m.ListWorkers()
				_ = m.WorkerCount()
				_, _ = m.GetWorkerStatus("a")
			}
			done <- true
		}()
	}

	// Concurrent status updates
	for i := 0; i < 5; i++ {
		go func(idx int) {
			for j := 0; j < 100; j++ {
				id := string(rune('a' + (idx % 10)))
				m.UpdateWorkerStatus(id, types.StatusConnected)
				m.UpdateWorkerActivity(id)
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify integrity
	assert.Equal(t, 10, m.WorkerCount(), "worker count should remain consistent")
}

// TestWorkerProcess_Fields tests WorkerProcess field access.
func TestWorkerProcess_Fields(t *testing.T) {
	now := time.Now()
	worker := &WorkerProcess{
		ID:           "worker-123",
		CompanyID:    "company-456",
		ConnectionID: "conn-789",
		TenantSchema: "tenant_company_456",
		DatabaseURL:  "postgres://localhost/db",
		Status:       types.StatusConnected,
		PID:          54321,
		StartedAt:    now,
		LastActivity: now,
	}

	assert.Equal(t, "worker-123", worker.ID)
	assert.Equal(t, "company-456", worker.CompanyID)
	assert.Equal(t, "conn-789", worker.ConnectionID)
	assert.Equal(t, "tenant_company_456", worker.TenantSchema)
	assert.Equal(t, "postgres://localhost/db", worker.DatabaseURL)
	assert.Equal(t, types.StatusConnected, worker.Status)
	assert.Equal(t, 54321, worker.PID)
	assert.Equal(t, now, worker.StartedAt)
	assert.Equal(t, now, worker.LastActivity)
}

// BenchmarkListWorkers benchmarks the ListWorkers operation.
func BenchmarkListWorkers(b *testing.B) {
	m := New(Config{})

	// Add 100 workers
	for i := 0; i < 100; i++ {
		id := string(rune(i))
		m.workers[id] = &WorkerProcess{
			ID:        id,
			CompanyID: "company",
			Status:    types.StatusConnected,
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.ListWorkers()
	}
}

// BenchmarkGetWorkerStatus benchmarks the GetWorkerStatus operation.
func BenchmarkGetWorkerStatus(b *testing.B) {
	m := New(Config{})

	m.workers["test-id"] = &WorkerProcess{
		ID:        "test-id",
		CompanyID: "company",
		Status:    types.StatusConnected,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = m.GetWorkerStatus("test-id")
	}
}

// BenchmarkUpdateWorkerStatus benchmarks the UpdateWorkerStatus operation.
func BenchmarkUpdateWorkerStatus(b *testing.B) {
	m := New(Config{})

	m.workers["test-id"] = &WorkerProcess{
		ID:           "test-id",
		Status:       types.StatusConnecting,
		LastActivity: time.Now(),
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.UpdateWorkerStatus("test-id", types.StatusConnected)
	}
}

// BenchmarkWorkerCount benchmarks the WorkerCount operation.
func BenchmarkWorkerCount(b *testing.B) {
	m := New(Config{})

	for i := 0; i < 100; i++ {
		id := string(rune(i))
		m.workers[id] = &WorkerProcess{ID: id}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.WorkerCount()
	}
}

// Integration-style tests that require more setup
// These test the interaction between components
