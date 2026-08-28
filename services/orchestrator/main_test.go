package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// recordingManagerStopper verifies startup-failure cleanup without constructing
// a manager with live NATS or database dependencies.
type recordingManagerStopper struct {
	stopped     bool
	hasDeadline bool
}

func (s *recordingManagerStopper) Stop(ctx context.Context) error {
	s.stopped = true
	_, s.hasDeadline = ctx.Deadline()
	return nil
}

func TestLoadHTTPBearerTokenReadsFileAndStripsWorkerInheritableEnvironment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "control-token")
	require.NoError(t, os.WriteFile(path, []byte("fresh-control-authority-1234567890abcdef\n"), 0o600))
	t.Setenv("HTTP_BEARER_TOKEN_FILE", path)

	token, err := loadHTTPBearerToken()
	require.NoError(t, err)
	require.Equal(t, "fresh-control-authority-1234567890abcdef", token)
	require.Empty(t, os.Getenv("HTTP_BEARER_TOKEN"))
	require.Empty(t, os.Getenv("HTTP_BEARER_TOKEN_FILE"))
}

func TestLoadHTTPBearerTokenRejectsGroupReadableFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "control-token")
	require.NoError(t, os.WriteFile(path, []byte("fresh-control-authority-1234567890abcdef\n"), 0o640))
	t.Setenv("HTTP_BEARER_TOKEN_FILE", path)

	_, err := loadHTTPBearerToken()
	require.ErrorContains(t, err, "root-only regular file")
}

func TestStopManagerAfterStartupFailureUsesBoundedCleanup(t *testing.T) {
	stopper := &recordingManagerStopper{}

	stopManagerAfterStartupFailure(stopper)

	require.True(t, stopper.stopped, "startup failure must release the node lease before process exit")
	require.True(t, stopper.hasDeadline, "startup cleanup must not hang indefinitely")
}
