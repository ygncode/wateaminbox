package manager

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func addRunningArtifactWorker(manager *Manager, position int, version, digest string) {
	connectionID := fmt.Sprintf("connection-%d", position)
	manager.workers[connectionID] = &WorkerProcess{
		ID: connectionID, LaunchID: fmt.Sprintf("launch-%d", position),
		DesiredState: DesiredStateRunning, CompanyID: fmt.Sprintf("company-%d", position),
		ConnectionID: connectionID, TenantSchema: fmt.Sprintf("tenant_company_%d", position),
		PID: position + 100, ArtifactVersion: version, ArtifactSHA256: digest,
	}
}

func TestStartWorkerUpgradeTreatsBootstrapAliasAsTargetContent(t *testing.T) {
	root := t.TempDir()
	body := []byte("first production worker artifact")
	digest := writeArtifact(t, root, "bootstrap", body)
	targetVersion := "sha256-" + digest
	require.Equal(t, digest, writeArtifact(t, root, targetVersion, body))

	manager := New(Config{ArtifactRoot: root})
	manager.registry = &WorkerRegistry{} // Equal content exits before persistence.
	addRunningArtifactWorker(manager, 0, "bootstrap", digest)

	batch, err := manager.StartWorkerUpgrade(context.Background(), WorkerUpgradeRequest{
		TargetArtifactVersion: targetVersion,
		TargetArtifactSHA256:  digest,
	})
	require.ErrorIs(t, err, ErrUpgradeNoWorkers)
	require.Nil(t, batch)
}

func TestStartWorkerUpgradeSkipsMixedAliasesWithEqualValidatedContent(t *testing.T) {
	root := t.TempDir()
	body := []byte("identical immutable worker bytes")
	digest := writeArtifact(t, root, "bootstrap", body)
	targetVersion := "sha256-" + digest
	aliases := []string{"bootstrap", "release-current", targetVersion}
	for _, alias := range aliases[1:] {
		require.Equal(t, digest, writeArtifact(t, root, alias, body))
	}

	manager := New(Config{ArtifactRoot: root})
	manager.registry = &WorkerRegistry{}
	for position, alias := range aliases {
		addRunningArtifactWorker(manager, position, alias, digest)
	}

	batch, err := manager.StartWorkerUpgrade(context.Background(), WorkerUpgradeRequest{
		TargetArtifactVersion: targetVersion,
		TargetArtifactSHA256:  digest,
	})
	require.ErrorIs(t, err, ErrUpgradeNoWorkers)
	require.Nil(t, batch)
}

func TestWorkerArtifactNoOpMatchesValidatedDigestAcrossAliases(t *testing.T) {
	root := t.TempDir()
	body := []byte("same no-op content")
	digest := writeArtifact(t, root, "bootstrap", body)
	targetVersion := "sha256-" + digest
	require.Equal(t, digest, writeArtifact(t, root, targetVersion, body))

	manager := New(Config{ArtifactRoot: root})
	target, err := manager.resolveArtifact(targetVersion, digest)
	require.NoError(t, err)
	require.True(t, manager.workerMatchesArtifactContent(&WorkerProcess{
		ArtifactVersion: "bootstrap", ArtifactSHA256: digest,
	}, target))

	bootstrapPath := filepath.Join(root, "bootstrap", "whatsapp-worker")
	require.NoError(t, os.Chmod(bootstrapPath, 0o755))
	require.NoError(t, os.WriteFile(bootstrapPath, []byte("changed"), 0o555))
	require.False(t, manager.workerMatchesArtifactContent(&WorkerProcess{
		ArtifactVersion: "bootstrap", ArtifactSHA256: digest,
	}, target), "digest equality must not bypass file validation")
}

func TestStartWorkerUpgradeDoesNotSkipUnvalidatedEqualDigestAlias(t *testing.T) {
	root := t.TempDir()
	targetBody := []byte("target bytes")
	digest := writeArtifact(t, root, "bootstrap", targetBody)
	targetVersion := "sha256-" + digest
	require.Equal(t, digest, writeArtifact(t, root, targetVersion, targetBody))

	// The registry still claims the target digest, but bootstrap was replaced.
	bootstrapPath := filepath.Join(root, "bootstrap", "whatsapp-worker")
	require.NoError(t, os.Chmod(bootstrapPath, 0o755))
	require.NoError(t, os.WriteFile(bootstrapPath, []byte("tampered bytes"), 0o555))
	manager := New(Config{ArtifactRoot: root})
	manager.registry = &WorkerRegistry{}
	addRunningArtifactWorker(manager, 0, "bootstrap", digest)

	batch, err := manager.StartWorkerUpgrade(context.Background(), WorkerUpgradeRequest{
		TargetArtifactVersion: targetVersion,
		TargetArtifactSHA256:  digest,
	})
	require.ErrorContains(t, err, "source artifact")
	require.ErrorContains(t, err, "mismatch")
	require.Nil(t, batch)
}
