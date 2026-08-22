package manager

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStopFirstArtifactReplacementNeverOverlaps(t *testing.T) {
	directory := t.TempDir()
	oldStarted := filepath.Join(directory, "old-started")
	newStarted := filepath.Join(directory, "new-started")
	overlap := filepath.Join(directory, "overlap")
	sourcePath := filepath.Join(directory, "source-worker")
	targetPath := filepath.Join(directory, "target-worker")

	sourceScript := fmt.Sprintf("#!/bin/sh\ntouch %q\ntrap 'exit 0' TERM INT\nwhile :; do sleep 0.02; done\n", oldStarted)
	require.NoError(t, os.WriteFile(sourcePath, []byte(sourceScript), 0o555))

	manager := New(Config{HealthCheckInterval: time.Hour})
	manager.ctx, manager.cancel = context.WithCancel(context.Background())
	t.Cleanup(func() {
		manager.cancel()
		if current, exists := manager.GetWorkerStatus("connection"); exists && current.PID > 0 {
			unlock := manager.lockLifecycle("connection")
			_ = manager.stopWorkerInternal(context.Background(), "company", "connection", "test cleanup", syscall.SIGTERM, true)
			unlock()
		}
		manager.wg.Wait()
	})

	unlock := manager.lockLifecycle("connection")
	require.NoError(t, manager.spawnWorkerArtifact(
		context.Background(), "company", "connection", "tenant_company", "postgres://unused", false, 0,
		WorkerArtifact{Version: "v1", SHA256: "source", BinaryPath: sourcePath},
	))
	require.Eventually(t, func() bool {
		_, err := os.Stat(oldStarted)
		return err == nil
	}, time.Second, 10*time.Millisecond)
	source, exists := manager.GetWorkerStatus("connection")
	require.True(t, exists)
	targetScript := fmt.Sprintf(
		"#!/bin/sh\nkill -0 %d 2>/dev/null && touch %q\ntouch %q\ntrap 'exit 0' TERM INT\nwhile :; do sleep 0.02; done\n",
		source.PID, overlap, newStarted,
	)
	require.NoError(t, os.WriteFile(targetPath, []byte(targetScript), 0o555))

	// This is the same serialized stop/reap/launch sequence used by the rollout
	// state machine: spawn cannot execute until waitForWorkerExit confirms old.
	require.NoError(t, manager.stopWorkerInternal(
		context.Background(), "company", "connection", "upgrade", syscall.SIGTERM, true,
	))
	require.NoError(t, manager.spawnWorkerArtifact(
		context.Background(), "company", "connection", "tenant_company", "postgres://unused", false, 0,
		WorkerArtifact{Version: "v2", SHA256: "target", BinaryPath: targetPath},
	))
	unlock()

	require.Eventually(t, func() bool {
		_, err := os.Stat(newStarted)
		return err == nil
	}, time.Second, 10*time.Millisecond)
	_, overlapErr := os.Stat(overlap)
	assert.ErrorIs(t, overlapErr, os.ErrNotExist, "target observed source before its confirmed exit")
}
