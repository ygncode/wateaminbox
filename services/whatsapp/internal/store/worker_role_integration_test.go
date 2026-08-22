package store

import (
	"context"
	"os"
	"testing"
)

func TestWorkerStoreRejectsControlPlaneDatabaseCredential(t *testing.T) {
	workerURL := os.Getenv("WORKER_TEST_DATABASE_URL")
	managerURL := os.Getenv("DATABASE_URL")
	if workerURL == "" || managerURL == "" {
		t.Skip("set WORKER_TEST_DATABASE_URL and DATABASE_URL")
	}
	connectionID := "00000000-0000-4000-8000-000000000072"
	worker, err := NewPGContainer(context.Background(), PGConfig{
		DatabaseURL: workerURL, ConnectionID: connectionID,
		RequiredRole: "wateaminbox_worker",
	})
	if err != nil {
		t.Fatalf("restricted role rejected: %v", err)
	}
	_ = worker.Close()

	if privileged, privilegedErr := NewPGContainer(context.Background(), PGConfig{
		DatabaseURL: managerURL, ConnectionID: connectionID,
		RequiredRole: "wateaminbox_worker",
	}); privilegedErr == nil {
		_ = privileged.Close()
		t.Fatal("manager/control-plane database credential was accepted by worker")
	}
}
