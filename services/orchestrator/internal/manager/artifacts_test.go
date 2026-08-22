package manager

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func writeArtifact(t *testing.T, root, version string, body []byte) string {
	t.Helper()
	directory := filepath.Join(root, version)
	require.NoError(t, os.MkdirAll(directory, 0o755))
	path := filepath.Join(directory, "whatsapp-worker")
	require.NoError(t, os.WriteFile(path, body, 0o555))
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func TestResolveArtifactValidatesPathModeAndDigest(t *testing.T) {
	root := t.TempDir()
	digest := writeArtifact(t, root, "release-2026.03.1", []byte("immutable worker"))
	manager := New(Config{ArtifactRoot: root})

	artifact, err := manager.resolveArtifact("release-2026.03.1", digest)
	require.NoError(t, err)
	require.Equal(t, "release-2026.03.1", artifact.Version)
	require.Equal(t, digest, artifact.SHA256)
	require.Equal(t, "whatsapp-worker", filepath.Base(artifact.BinaryPath))
	require.Contains(t, artifact.BinaryPath, filepath.Join("release-2026.03.1", "whatsapp-worker"))
}

func TestResolveArtifactRejectsTraversalAndDigestMismatch(t *testing.T) {
	root := t.TempDir()
	digest := writeArtifact(t, root, "safe", []byte("worker"))
	manager := New(Config{ArtifactRoot: root})

	for _, version := range []string{"../safe", "/safe", "safe/child", "..", " safe"} {
		_, err := manager.resolveArtifact(version, digest)
		require.Error(t, err, version)
	}
	_, err := manager.resolveArtifact("safe", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	require.ErrorContains(t, err, "mismatch")
}

func TestResolveArtifactRejectsSymlinkAndNonExecutable(t *testing.T) {
	root := t.TempDir()
	digest := writeArtifact(t, root, "real", []byte("worker"))
	manager := New(Config{ArtifactRoot: root})

	require.NoError(t, os.Mkdir(filepath.Join(root, "linked"), 0o755))
	require.NoError(t, os.Symlink(filepath.Join(root, "real", "whatsapp-worker"), filepath.Join(root, "linked", "whatsapp-worker")))
	_, err := manager.resolveArtifact("linked", digest)
	require.ErrorContains(t, err, "symlink")

	plainDigest := writeArtifact(t, root, "plain", []byte("plain"))
	require.NoError(t, os.Chmod(filepath.Join(root, "plain", "whatsapp-worker"), 0o444))
	_, err = manager.resolveArtifact("plain", plainDigest)
	require.ErrorContains(t, err, "executable")
}
